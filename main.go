package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"wt-tactical-map/internal/hotkeys"
	"wt-tactical-map/internal/mock"
	"wt-tactical-map/internal/store"
	"wt-tactical-map/internal/wtclient"
)

type cachedPresetImg struct {
	data        []byte
	contentType string
}

type serverCtx struct {
	appCfg      wtclient.AppConfig
	routeStore  *store.RouteStore
	wtClient    *wtclient.Client
	targetCtrl  *hotkeys.TargetControlQueue
	devMode     bool
	baseDir     string
	httpClient  *http.Client
	presetMu    sync.Mutex
	presetCache map[string]cachedPresetImg
}

func loadAppConfig(baseDir string) wtclient.AppConfig {
	cfg := wtclient.DefaultAppConfig()
	if len(EmbeddedDefaultConfig) > 0 {
		_ = json.Unmarshal(EmbeddedDefaultConfig, &cfg)
	}
	diskCfg := filepath.Join(baseDir, "config.json")
	if raw, err := os.ReadFile(diskCfg); err == nil {
		_ = json.Unmarshal(raw, &cfg)
	}
	return cfg
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, `{"error":"json marshal failed"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func writeBytesNoCache(w http.ResponseWriter, status int, contentType string, data []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

func (s *serverCtx) serveWebAsset(w http.ResponseWriter, relPath string) {
	clean := strings.TrimPrefix(filepath.ToSlash(filepath.Clean("/"+relPath)), "/")
	if clean == "" || clean == "." {
		clean = "index.html"
	}

	var data []byte
	var err error
	if s.devMode {
		diskPath := filepath.Join(s.baseDir, "web", filepath.FromSlash(clean))
		data, err = os.ReadFile(diskPath)
	} else {
		data, err = fs.ReadFile(EmbeddedWebFS, "web/"+clean)
	}
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "File not found"})
		return
	}

	ext := strings.ToLower(filepath.Ext(clean))
	ctype := mime.TypeByExtension(ext)
	switch ext {
	case ".js":
		ctype = "application/javascript; charset=utf-8"
	case ".css":
		ctype = "text/css; charset=utf-8"
	case ".html":
		ctype = "text/html; charset=utf-8"
	case ".svg":
		ctype = "image/svg+xml; charset=utf-8"
	default:
		if ctype == "" {
			ctype = "application/octet-stream"
		}
	}
	writeBytesNoCache(w, http.StatusOK, ctype, data)
}

func (s *serverCtx) resolvePresetMapImage(mapID string) ([]byte, string, bool) {
	cfg := s.routeStore.Load()
	mapsRaw, _ := cfg["maps"].(map[string]any)
	entry, _ := mapsRaw[mapID].(map[string]any)
	if entry == nil {
		return nil, "", false
	}

	for _, pair := range []struct{ ext, mime string }{
		{".png", "image/png"},
		{".jpg", "image/jpeg"},
		{".jpeg", "image/jpeg"},
		{".webp", "image/webp"},
	} {
		cand := filepath.Join(s.routeStore.MapsDir, mapID+pair.ext)
		if data, err := os.ReadFile(cand); err == nil && len(data) > 0 {
			return data, pair.mime, true
		}
	}

	if mapID == "mock_tactical_arena" {
		d, ct := mock.NewProvider().GetMapImage()
		return d, ct, true
	}

	s.presetMu.Lock()
	if cached, ok := s.presetCache[mapID]; ok {
		s.presetMu.Unlock()
		return cached.data, cached.contentType, true
	}
	s.presetMu.Unlock()

	meta, _ := entry["workbench_meta"].(map[string]any)
	assets, _ := meta["assets"].(map[string]any)
	urls := []string{}
	if thumbs, ok := assets["thumbnail_urls"].([]any); ok {
		for _, u := range thumbs {
			if str, ok := u.(string); ok && (strings.HasPrefix(str, "http://") || strings.HasPrefix(str, "https://")) {
				urls = append(urls, str)
			}
		}
	}
	if baseURL, ok := assets["base_url"].(string); ok && (strings.HasPrefix(baseURL, "http://") || strings.HasPrefix(baseURL, "https://")) {
		urls = append(urls, baseURL)
	}

	for _, u := range urls {
		req, _ := http.NewRequest("GET", u, nil)
		req.Header.Set("User-Agent", "wt-tactical-map/2.0")
		resp, err := s.httpClient.Do(req)
		if err != nil {
			continue
		}
		data, err := io.ReadAll(resp.Body)
		ct := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
		_ = resp.Body.Close()
		if err == nil && len(data) > 0 {
			if ct == "" {
				ct = "image/webp"
			}
			s.presetMu.Lock()
			s.presetCache[mapID] = cachedPresetImg{data: data, contentType: ct}
			s.presetMu.Unlock()
			return data, ct, true
		}
	}
	return nil, "", false
}

func (s *serverCtx) handleHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	if r.Method == http.MethodGet {
		switch {
		case path == "/api/state":
			st := s.wtClient.GetState()
			st["ui_defaults"] = map[string]any{
				"poll_hz":             s.appCfg.PollHz,
				"show_allies":         s.appCfg.DefaultShowAllies,
				"show_enemies":        s.appCfg.DefaultShowEnemies,
				"show_caps":           s.appCfg.DefaultShowCaps,
				"show_spawns":         s.appCfg.DefaultShowSpawns,
				"player_trail_length": s.appCfg.PlayerTrailLength,
			}
			st["target_control"] = s.targetCtrl.Snapshot()
			writeJSON(w, http.StatusOK, st)
			return

		case path == "/api/map.img" || path == "/api/map_img" || path == "/api/map_img.jpg":
			data, ct := s.wtClient.GetMapImage()
			if len(data) == 0 {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "Map image unavailable"})
				return
			}
			writeBytesNoCache(w, http.StatusOK, ct, data)
			return

		case path == "/api/preset_map_img":
			mapID := strings.TrimSpace(r.URL.Query().Get("map_id"))
			if mapID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing map_id"})
				return
			}
			data, ct, ok := s.resolvePresetMapImage(mapID)
			if !ok {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "Preset map image unavailable"})
				return
			}
			writeBytesNoCache(w, http.StatusOK, ct, data)
			return

		case path == "/api/routes":
			writeJSON(w, http.StatusOK, map[string]any{
				"config":             s.routeStore.Load(),
				"available_overlays": s.routeStore.ListOverlayPNGs(),
			})
			return

		case strings.HasPrefix(path, "/overlays/"):
			rel := strings.TrimPrefix(path, "/overlays/")
			clean := filepath.Clean(rel)
			full := filepath.Join(s.routeStore.OverlaysDir, clean)
			absRoot, _ := filepath.Abs(s.routeStore.OverlaysDir)
			absTarget, _ := filepath.Abs(full)
			if !strings.HasPrefix(absTarget, absRoot) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Forbidden path"})
				return
			}
			data, err := os.ReadFile(absTarget)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "File not found"})
				return
			}
			writeBytesNoCache(w, http.StatusOK, "image/png", data)
			return

		case path == "/" || path == "/index.html":
			s.serveWebAsset(w, "index.html")
			return

		case path == "/favicon.ico":
			w.WriteHeader(http.StatusNoContent)
			return

		case strings.HasPrefix(path, "/css/") || strings.HasPrefix(path, "/js/") || strings.HasPrefix(path, "/icons/"):
			s.serveWebAsset(w, strings.TrimPrefix(path, "/"))
			return

		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
			return
		}
	}

	if r.Method == http.MethodPost {
		rawBody, err := io.ReadAll(io.LimitReader(r.Body, 5*1024*1024))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}
		var body map[string]any
		if err := json.Unmarshal(rawBody, &body); err != nil || body == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
			return
		}

		switch path {
		case "/api/routes/save":
			mapID, _ := body["map_id"].(string)
			mapID = strings.TrimSpace(mapID)
			if mapID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing map_id"})
				return
			}
			vLayers, ok := body["vector_layers"].([]any)
			if !ok {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "vector_layers must be a list"})
				return
			}
			var pLayers []any
			if rawP, ok := body["png_layers"].([]any); ok {
				pLayers = rawP
			}
			mapName, _ := body["map_name"].(string)
			updated, err := s.routeStore.SaveMapLayers(mapID, vLayers, pLayers, strings.TrimSpace(mapName))
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			s.wtClient.RefreshMatch()
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "map_id": mapID, "map": updated})
			return

		case "/api/maps/bind":
			mapID, _ := body["map_id"].(string)
			sig, _ := body["signature"].(string)
			mapID = strings.TrimSpace(mapID)
			sig = strings.TrimSpace(sig)
			if mapID == "" || sig == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Both map_id and signature are required"})
				return
			}
			physHint, _ := body["physical_hint"].(map[string]any)
			mapName, _ := body["map_name"].(string)
			updatedCfg, err := s.routeStore.BindSignature(mapID, sig, physHint, strings.TrimSpace(mapName))
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			s.wtClient.RefreshMatch()
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":                 true,
				"config":             updatedCfg,
				"available_overlays": s.routeStore.ListOverlayPNGs(),
			})
			return

		case "/api/maps/create":
			mapID, _ := body["map_id"].(string)
			name, _ := body["name"].(string)
			mapID = strings.TrimSpace(mapID)
			name = strings.TrimSpace(name)
			if mapID == "" || name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Both map_id and name are required"})
				return
			}
			sig, _ := body["signature"].(string)
			physHint, _ := body["physical_hint"].(map[string]any)
			updatedCfg, err := s.routeStore.CreateMap(mapID, name, strings.TrimSpace(sig), physHint)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			s.wtClient.RefreshMatch()
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":                 true,
				"map_id":             mapID,
				"config":             updatedCfg,
				"available_overlays": s.routeStore.ListOverlayPNGs(),
			})
			return

		case "/api/control/target":
			action, _ := body["action"].(string)
			action = strings.TrimSpace(strings.ToLower(action))
			seq, err := s.targetCtrl.Push(action)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "seq": seq, "action": action})
			return

		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
			return
		}
	}

	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
}

func detectLANIPv4() []string {
	cands := []string{}
	if conn, err := net.DialTimeout("udp", "8.8.8.8:80", 300*time.Millisecond); err == nil {
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok && addr.IP != nil {
			cands = append(cands, addr.IP.String())
		}
		_ = conn.Close()
	}
	if ifaces, err := net.Interfaces(); err == nil {
		for _, iface := range ifaces {
			if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
				continue
			}
			addrs, _ := iface.Addrs()
			for _, a := range addrs {
				var ip net.IP
				switch v := a.(type) {
				case *net.IPNet:
					ip = v.IP
				case *net.IPAddr:
					ip = v.IP
				}
				if ip != nil && ip.To4() != nil {
					cands = append(cands, ip.String())
				}
			}
		}
	}

	unique := []string{}
	seen := map[string]bool{}
	for _, ip := range cands {
		if ip == "" || strings.HasPrefix(ip, "127.") || strings.HasPrefix(ip, "169.254.") || strings.HasPrefix(ip, "0.") {
			continue
		}
		if !seen[ip] {
			seen[ip] = true
			unique = append(unique, ip)
		}
	}

	isVirtual := func(ip string) bool {
		if !strings.HasPrefix(ip, "172.") {
			return false
		}
		parts := strings.Split(ip, ".")
		if len(parts) < 2 {
			return false
		}
		n, err := strconv.Atoi(parts[1])
		return err == nil && n >= 16 && n <= 31
	}

	realIPs := []string{}
	for _, ip := range unique {
		if !isVirtual(ip) {
			realIPs = append(realIPs, ip)
		}
	}
	if len(realIPs) > 0 {
		unique = realIPs
	}

	rank := func(ip string) int {
		switch {
		case strings.HasPrefix(ip, "192.168."):
			return 0
		case strings.HasPrefix(ip, "10."):
			return 1
		case strings.HasPrefix(ip, "172."):
			return 2
		default:
			return 3
		}
	}
	sort.Slice(unique, func(i, j int) bool {
		return rank(unique[i]) < rank(unique[j])
	})
	return unique
}

func openBrowser(urlStr string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", urlStr).Start()
	case "darwin":
		_ = exec.Command("open", urlStr).Start()
	default:
		_ = exec.Command("xdg-open", urlStr).Start()
	}
}

func resolveBaseDir() string {
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		if _, err := os.Stat(filepath.Join(dir, "routes", "routes_config.json")); err == nil {
			return dir
		}
	}
	wd, err := os.Getwd()
	if err == nil {
		if _, err := os.Stat(filepath.Join(wd, "routes", "routes_config.json")); err == nil {
			return wd
		}
		return wd
	}
	return "."
}

func main() {
	baseDir := resolveBaseDir()
	appCfg := loadAppConfig(baseDir)

	hostFlag := flag.String("host", appCfg.ServerHost, "Bind host address")
	portFlag := flag.Int("port", appCfg.ServerPort, "Bind HTTP port")
	mockFlag := flag.Bool("mock", false, "Enable offline mock 8111 data mode")
	noBrowser := flag.Bool("no-browser", false, "Do not open browser automatically")
	devFlag := flag.Bool("dev", false, "Serve web/ assets from disk instead of embedded FS")
	flag.Parse()

	rs, err := store.NewRouteStore(baseDir, EmbeddedRoutesConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[WT Tactical Map] 初始化 RouteStore 失败: %v\n", err)
		os.Exit(1)
	}

	client := wtclient.NewClient(appCfg, rs, *mockFlag)
	client.Start()
	defer client.Stop()

	targetCtrl := hotkeys.NewTargetControlQueue()
	stopHotkeys := hotkeys.StartGlobalNumpadListener(targetCtrl)
	defer stopHotkeys()

	srvCtx := &serverCtx{
		appCfg:      appCfg,
		routeStore:  rs,
		wtClient:    client,
		targetCtrl:  targetCtrl,
		devMode:     *devFlag,
		baseDir:     baseDir,
		httpClient:  &http.Client{Timeout: 4 * time.Second},
		presetCache: make(map[string]cachedPresetImg),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", srvCtx.handleHTTP)

	addr := net.JoinHostPort(*hostFlag, strconv.Itoa(*portFlag))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[WT Tactical Map] 监听 %s 失败: %v\n", addr, err)
		os.Exit(1)
	}

	modeLabel := fmt.Sprintf("实时模式 (8111 @ %.0fHz)", appCfg.PollHz)
	if *mockFlag {
		modeLabel = "MOCK 演示模式"
	}
	fmt.Printf("[WT Tactical Map v2.0 Go] 服务已启动: 监听 %s | %s\n", addr, modeLabel)
	fmt.Println("")
	fmt.Println("==================================================================")
	fmt.Printf("[WT Tactical Map] 本机访问:        http://127.0.0.1:%d\n", *portFlag)
	if *hostFlag == "0.0.0.0" || *hostFlag == "" || *hostFlag == "::" {
		for _, ip := range detectLANIPv4() {
			fmt.Printf("[WT Tactical Map] 手机局域网访问:  http://%s:%d\n", ip, *portFlag)
		}
		fmt.Println("[WT Tactical Map] 手机与电脑需连同一个 Wi-Fi；首次启动如弹防火墙，请允许「专用网络」。")
	}
	fmt.Println("==================================================================")
	fmt.Println("[WT Tactical Map] 按 Ctrl+C 退出服务")

	browserHost := *hostFlag
	if browserHost == "0.0.0.0" || browserHost == "" || browserHost == "::" {
		browserHost = "127.0.0.1"
	}
	browserURL := fmt.Sprintf("http://%s:%d", browserHost, *portFlag)
	if !*noBrowser {
		time.AfterFunc(600*time.Millisecond, func() {
			openBrowser(browserURL)
		})
	}

	httpSrv := &http.Server{Handler: mux}
	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	select {
	case <-sigCh:
		fmt.Println("\n[WT Tactical Map] 正在关闭服务...")
	case err := <-errCh:
		fmt.Fprintf(os.Stderr, "[WT Tactical Map] HTTP 服务异常退出: %v\n", err)
	}
	_ = httpSrv.Close()
}
