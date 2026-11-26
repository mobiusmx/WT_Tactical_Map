package wtclient

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"wt-tactical-map/internal/mock"
	"wt-tactical-map/internal/store"
)

var endpoints = []string{"map_info", "map_obj", "map_img", "indicators"}
var imgPaths = []string{"/map.img", "/map_img.jpg"}

type AppConfig struct {
	WTHost                    string  `json:"wt_host"`
	ServerHost                string  `json:"server_host"`
	ServerPort                int     `json:"server_port"`
	PollHz                    float64 `json:"poll_hz"`
	MapInfoHz                 float64 `json:"map_info_hz"`
	IndicatorsHz              float64 `json:"indicators_hz"`
	RequestTimeoutSec         float64 `json:"request_timeout_sec"`
	HostProbeTimeoutSec       float64 `json:"host_probe_timeout_sec"`
	StaleAfterSec             float64 `json:"stale_after_sec"`
	StandbyGraceSec           float64 `json:"standby_grace_sec"`
	IndicatorsSpeedMultiplier float64 `json:"indicators_speed_multiplier"`
	GroundSpeedMultiplier     float64 `json:"ground_speed_multiplier"`
	DefaultShowAllies         bool    `json:"default_show_allies"`
	DefaultShowEnemies        bool    `json:"default_show_enemies"`
	DefaultShowCaps           bool    `json:"default_show_caps"`
	DefaultShowSpawns         bool    `json:"default_show_spawns"`
	PlayerTrailLength         int     `json:"player_trail_length"`
}

func DefaultAppConfig() AppConfig {
	return AppConfig{
		WTHost:                    "http://localhost:8111",
		ServerHost:                "0.0.0.0",
		ServerPort:                8123,
		PollHz:                    8,
		MapInfoHz:                 1,
		IndicatorsHz:              2,
		RequestTimeoutSec:         0.5,
		HostProbeTimeoutSec:       1.5,
		StaleAfterSec:             2.0,
		StandbyGraceSec:           3.0,
		IndicatorsSpeedMultiplier: 3.6,
		GroundSpeedMultiplier:     1.0,
		DefaultShowAllies:         true,
		DefaultShowEnemies:        true,
		DefaultShowCaps:           true,
		DefaultShowSpawns:         true,
		PlayerTrailLength:         45,
	}
}

func parseRGB(obj map[string]any) (int, int, int, bool) {
	for _, key := range []string{"color[]", "color"} {
		if arr, ok := obj[key].([]any); ok && len(arr) >= 3 {
			r, ok0 := toInt(arr[0])
			g, ok1 := toInt(arr[1])
			b, ok2 := toInt(arr[2])
			if ok0 && ok1 && ok2 {
				return r, g, b, true
			}
		}
	}
	raw, _ := obj["color"].(string)
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "#") {
		h := raw[1:]
		if len(h) == 6 {
			r, e1 := strconv.ParseInt(h[0:2], 16, 32)
			g, e2 := strconv.ParseInt(h[2:4], 16, 32)
			b, e3 := strconv.ParseInt(h[4:6], 16, 32)
			if e1 == nil && e2 == nil && e3 == nil {
				return int(r), int(g), int(b), true
			}
		} else if len(h) == 3 {
			r, e1 := strconv.ParseInt(strings.Repeat(string(h[0]), 2), 16, 32)
			g, e2 := strconv.ParseInt(strings.Repeat(string(h[1]), 2), 16, 32)
			b, e3 := strconv.ParseInt(strings.Repeat(string(h[2]), 2), 16, 32)
			if e1 == nil && e2 == nil && e3 == nil {
				return int(r), int(g), int(b), true
			}
		}
	} else if strings.HasPrefix(strings.ToLower(raw), "rgb(") && strings.HasSuffix(raw, ")") {
		parts := strings.Split(raw[4:len(raw)-1], ",")
		if len(parts) >= 3 {
			r, e1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
			g, e2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			b, e3 := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
			if e1 == nil && e2 == nil && e3 == nil {
				return int(r), int(g), int(b), true
			}
		}
	}
	return 0, 0, 0, false
}

func toInt(v any) (int, bool) {
	switch t := v.(type) {
	case float64:
		return int(t), true
	case int:
		return t, true
	case json.Number:
		n, err := t.Int64()
		return int(n), err == nil
	default:
		return 0, false
	}
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func isHostileColor(obj map[string]any) bool {
	r, g, b, ok := parseRGB(obj)
	if !ok {
		return false
	}
	return (r >= 150 && r > b+50 && r > g+35) || (r >= 180 && g <= 145 && b <= 110)
}

func isYellowPingColor(obj map[string]any) bool {
	r, g, b, ok := parseRGB(obj)
	if !ok {
		return false
	}
	return r >= 180 && g >= 160 && b <= 130
}

func isGreenSquadColor(obj map[string]any) bool {
	r, g, b, ok := parseRGB(obj)
	if !ok {
		return false
	}
	return g >= 140 && g > r+25 && g > b+25
}

func inferGroundClass(iconLow, typeLow string) string {
	switch {
	case strings.Contains(iconLow, "spaa") || strings.Contains(iconLow, "aaa") || strings.Contains(typeLow, "spaa"):
		return "spaa"
	case strings.Contains(iconLow, "heavy"):
		return "heavy_tank"
	case strings.Contains(iconLow, "medium"):
		return "medium_tank"
	case strings.Contains(iconLow, "light") || strings.Contains(iconLow, "wheeled") || strings.Contains(iconLow, "recon"):
		return "light_tank"
	case strings.Contains(iconLow, "destroyer") || strings.Contains(iconLow, "spg") || strings.Contains(iconLow, "atgm"):
		return "tank_destroyer"
	default:
		return ""
	}
}

var vehicleTypes = map[string]bool{
	"ground_model": true, "aircraft": true, "tank": true, "ship": true,
	"helicopter": true, "wheeled": true, "tracked": true, "ground_unit": true, "vehicle": true,
}

var vehicleIconHints = []string{
	"tank", "spaa", "fighter", "bomber", "assault", "heli",
	"destroyer", "boat", "ship", "artillery", "aaa", "tracked", "wheeled",
}

func containsAny(s string, subs []string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func classifyObject(obj map[string]any) map[string]any {
	enriched := make(map[string]any, len(obj)+4)
	for k, v := range obj {
		enriched[k] = v
	}
	objType, _ := obj["type"].(string)
	typeLow := strings.ToLower(strings.TrimSpace(objType))
	icon, _ := obj["icon"].(string)
	iconLow := strings.ToLower(strings.TrimSpace(icon))
	blink, _ := toInt(obj["blink"])
	_, okX := toFloat(obj["x"])
	_, okY := toFloat(obj["y"])
	hasXY := okX && okY

	role := "other"
	switch {
	case iconLow == "player":
		role = "player"
	case strings.Contains(typeLow, "capture_zone") || iconLow == "capture_zone":
		role = "capture_zone"
	case strings.HasPrefix(typeLow, "respawn_base"):
		if isHostileColor(obj) {
			role = "spawn_enemy"
		} else {
			role = "spawn_ally"
		}
	case typeLow == "airfield":
		role = "airfield"
	case typeLow == "bombing_point" || typeLow == "defending_point":
		role = "other"
	case containsAny(typeLow, []string{"scout", "spotted", "tracked_enemy"}) || containsAny(iconLow, []string{"scout", "spotted", "tracked_enemy"}):
		role = "enemy"
		enriched["scouted"] = true
	case vehicleTypes[typeLow] || containsAny(iconLow, vehicleIconHints):
		if isHostileColor(obj) {
			role = "enemy"
			enriched["scouted"] = blink > 0 || strings.Contains(iconLow, "scout") || strings.Contains(typeLow, "scout")
		} else {
			role = "ally"
		}
	case hasXY && (containsAny(typeLow, []string{"attention", "ping", "marker", "point", "squad", "waypoint"}) ||
		containsAny(iconLow, []string{"attention", "ping", "marker", "squad", "exclamation"})):
		if isHostileColor(obj) && strings.Contains(iconLow, "exclamation") {
			role = "enemy"
			enriched["scouted"] = true
		} else {
			role = "ping"
			if strings.Contains(typeLow, "squad") || strings.Contains(iconLow, "squad") || isGreenSquadColor(obj) || isYellowPingColor(obj) {
				enriched["ping_kind"] = "squad"
			} else {
				enriched["ping_kind"] = "team"
			}
		}
	case hasXY && isHostileColor(obj):
		role = "enemy"
		enriched["scouted"] = blink > 0
	case hasXY && (blink > 0 || isYellowPingColor(obj)):
		role = "ping"
		if isYellowPingColor(obj) {
			enriched["ping_kind"] = "squad"
		} else {
			enriched["ping_kind"] = "team"
		}
	}

	if gc := inferGroundClass(iconLow, typeLow); gc != "" {
		enriched["ground_class"] = gc
	}
	enriched["role"] = role
	return enriched
}

func emptyTelemetry() map[string]any {
	return map[string]any{
		"valid":          false,
		"speed_kmh":      nil,
		"speed_raw":      nil,
		"speed_raw_unit": nil,
		"speed_factor":   nil,
		"gear":           nil,
		"army":           nil,
		"vehicle_type":   nil,
	}
}

func hostCandidates(rawHost string) []string {
	raw := strings.TrimRight(rawHost, "/")
	if raw == "" {
		raw = "http://localhost:8111"
	}
	u, err := url.Parse(raw)
	if err != nil {
		return []string{"http://127.0.0.1:8111", "http://localhost:8111"}
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" {
		port = "8111"
	}
	path := u.Path
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return []string{
			fmt.Sprintf("http://127.0.0.1:%s%s", port, path),
			fmt.Sprintf("http://localhost:%s%s", port, path),
		}
	}
	return []string{raw}
}

type Client struct {
	cfg           AppConfig
	routeStore    *store.RouteStore
	mockMode      bool
	mock          *mock.Provider
	candidates    []string
	baseURL       string
	httpClient    *http.Client
	probeClient   *http.Client

	pollInterval       time.Duration
	mapInfoInterval    time.Duration
	indicatorsInterval time.Duration
	staleAfterMs       int64
	standbyGrace       time.Duration

	mu              sync.Mutex
	stopCh          chan struct{}
	wg              sync.WaitGroup
	nextMapInfoAt   time.Time
	nextIndicatorsAt time.Time
	nextProbeAt     time.Time
	nextImgRetryAt  time.Time
	hostOkAt        time.Time

	cachedMapInfo    map[string]any
	cachedRawObjects []map[string]any
	cachedTelemetry  map[string]any

	lastOkWall map[string]*float64
	lastError  map[string]*string
	hostError  string
	lastLogAt  map[string]time.Time

	cachedGeneration any
	cachedImgBytes   []byte
	cachedImgType    string
	cachedSignature  string
	cachedInfoKey    string
	imgFetchedAt     time.Time
	imgPath          string

	matchSeq       int
	matchStartedTs *float64
	matchGen       any

	state map[string]any
}

func NewClient(cfg AppConfig, rs *store.RouteStore, mockMode bool) *Client {
	cands := hostCandidates(cfg.WTHost)
	timeout := time.Duration(math.Max(0.3, cfg.RequestTimeoutSec) * float64(time.Second))
	probeTimeout := time.Duration(math.Max(0.5, cfg.HostProbeTimeoutSec) * float64(time.Second))
	noProxyTransport := &http.Transport{Proxy: nil}

	c := &Client{
		cfg:                cfg,
		routeStore:         rs,
		mockMode:           mockMode,
		candidates:         cands,
		baseURL:            cands[0],
		httpClient:         &http.Client{Timeout: timeout, Transport: noProxyTransport},
		probeClient:        &http.Client{Timeout: probeTimeout, Transport: noProxyTransport},
		pollInterval:       time.Duration(float64(time.Second) / math.Max(1.0, cfg.PollHz)),
		mapInfoInterval:    time.Duration(float64(time.Second) / math.Max(0.2, cfg.MapInfoHz)),
		indicatorsInterval: time.Duration(float64(time.Second) / math.Max(0.5, cfg.IndicatorsHz)),
		staleAfterMs:       int64(math.Max(0.5, cfg.StaleAfterSec) * 1000),
		standbyGrace:       time.Duration(math.Max(math.Max(0.5, cfg.StaleAfterSec), cfg.StandbyGraceSec) * float64(time.Second)),
		stopCh:             make(chan struct{}),
		cachedTelemetry:    emptyTelemetry(),
		lastOkWall:         map[string]*float64{},
		lastError:          map[string]*string{},
		lastLogAt:          map[string]time.Time{},
		cachedImgType:      "image/jpeg",
		imgPath:            imgPaths[0],
	}
	if mockMode {
		c.mock = mock.NewProvider()
	}
	c.state = c.standbyState()
	return c
}

func (c *Client) Start() {
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		c.pollLoop()
	}()
}

func (c *Client) Stop() {
	close(c.stopCh)
	c.wg.Wait()
}

func (c *Client) GetState() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	raw, _ := json.Marshal(c.state)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

func (c *Client) GetMapImage() ([]byte, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.cachedImgBytes) == 0 {
		return nil, ""
	}
	cp := make([]byte, len(c.cachedImgBytes))
	copy(cp, c.cachedImgBytes)
	return cp, c.cachedImgType
}

func (c *Client) RefreshMatch() {
	c.mu.Lock()
	sig := c.cachedSignature
	mapInfo, _ := c.state["map_info"].(map[string]any)
	status, _ := c.state["status"].(string)
	c.mu.Unlock()

	if status != "active" || sig == "" {
		return
	}
	cfg := c.routeStore.Load()
	mr := store.MatchMap(sig, mapInfo, cfg)
	c.mu.Lock()
	c.state["matched_map_id"] = mr.MatchedID
	c.state["match_type"] = mr.MatchType
	c.state["candidates"] = mr.Candidates
	c.mu.Unlock()
}

func (c *Client) logThrottled(key, msg string, minInterval time.Duration) {
	now := time.Now()
	if last, ok := c.lastLogAt[key]; ok && now.Sub(last) < minInterval {
		return
	}
	c.lastLogAt[key] = now
	fmt.Fprintln(os.Stderr, msg)
}

func (c *Client) markOK(name string) {
	hadErr := c.lastError[name] != nil
	ts := float64(time.Now().UnixNano()) / 1e9
	c.lastOkWall[name] = &ts
	c.lastError[name] = nil
	if hadErr {
		c.logThrottled(name+":ok", fmt.Sprintf("[WT-8111] %s 已恢复正常", name), 5*time.Second)
	}
}

func (c *Client) markError(name string, err error, page string) {
	msg := err.Error()
	if len(msg) > 300 {
		msg = msg[:300]
	}
	if page != "" {
		msg = fmt.Sprintf("GET %s -> %s", page, msg)
	}
	c.lastError[name] = &msg
	c.logThrottled(name+":err", fmt.Sprintf("[WT-8111] %s 请求失败: %s", name, msg), 5*time.Second)
}

func (c *Client) ageSec(name string) (float64, bool) {
	ts := c.lastOkWall[name]
	if ts == nil {
		return 0, false
	}
	now := float64(time.Now().UnixNano()) / 1e9
	return now - *ts, true
}

func (c *Client) freshness() map[string]any {
	now := float64(time.Now().UnixNano()) / 1e9
	out := make(map[string]any, len(endpoints))
	for _, name := range endpoints {
		ts := c.lastOkWall[name]
		var ageMs any
		stale := true
		if ts != nil {
			ms := int64((now - *ts) * 1000)
			if ms < 0 {
				ms = 0
			}
			ageMs = ms
			if name == "map_img" {
				stale = c.lastError[name] != nil
			} else {
				stale = ms > c.staleAfterMs
			}
		}
		out[name] = map[string]any{
			"last_ok_ts": ts,
			"age_ms":     ageMs,
			"stale":      stale,
			"error":      c.lastError[name],
		}
	}
	return out
}

func (c *Client) matchInfo() map[string]any {
	return map[string]any{
		"seq":        c.matchSeq,
		"started_ts": c.matchStartedTs,
		"generation": c.matchGen,
	}
}

func (c *Client) noteGeneration(gen any) {
	if c.matchSeq == 0 {
		c.matchSeq = 1
		ts := float64(time.Now().UnixNano()) / 1e9
		c.matchStartedTs = &ts
		c.matchGen = gen
		return
	}
	if gen == nil || c.matchGen == nil {
		return
	}
	if fmt.Sprintf("%v", gen) != fmt.Sprintf("%v", c.matchGen) {
		c.matchSeq++
		ts := float64(time.Now().UnixNano()) / 1e9
		c.matchStartedTs = &ts
		c.matchGen = gen
	}
}

func (c *Client) standbyState() map[string]any {
	return map[string]any{
		"status":         "standby",
		"mock_mode":      c.mockMode,
		"map_generation": nil,
		"map_signature":  "",
		"map_info":       nil,
		"physical_hint":  map[string]any{},
		"matched_map_id": nil,
		"match_type":     "none",
		"candidates":     []any{},
		"objects":        []any{},
		"telemetry":      emptyTelemetry(),
		"timestamp":      float64(time.Now().UnixNano()) / 1e9,
		"freshness":      c.freshness(),
		"match":          c.matchInfo(),
		"source_host":    c.baseURL,
	}
}

func (c *Client) setStandby() {
	c.cachedMapInfo = nil
	c.cachedRawObjects = nil
	c.cachedTelemetry = emptyTelemetry()
	c.nextIndicatorsAt = time.Time{}

	c.mu.Lock()
	c.cachedGeneration = nil
	c.cachedImgBytes = nil
	c.cachedSignature = ""
	c.cachedInfoKey = ""
	c.imgFetchedAt = time.Time{}
	c.nextImgRetryAt = time.Time{}
	c.state = c.standbyState()
	c.mu.Unlock()
}

func (c *Client) pickHost() (string, error) {
	now := time.Now()
	if !c.hostOkAt.IsZero() && now.Sub(c.hostOkAt) < 30*time.Second && c.baseURL != "" {
		return c.baseURL, nil
	}
	if now.Before(c.nextProbeAt) {
		msg := c.hostError
		if msg == "" {
			msg = "8111 暂不可达，稍后重试"
		}
		return "", fmt.Errorf("%s", msg)
	}

	errs := []string{}
	for _, base := range c.candidates {
		started := time.Now()
		req, _ := http.NewRequest("GET", base+"/map_info.json", nil)
		req.Header.Set("Accept", "application/json")
		resp, err := c.probeClient.Do(req)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s -> %v", base, err))
			continue
		}
		_, _ = io.CopyN(io.Discard, resp.Body, 2048)
		_ = resp.Body.Close()

		elapsedMs := time.Since(started).Milliseconds()
		if base != c.baseURL {
			c.logThrottled("host:sw", fmt.Sprintf("[WT-8111] 已切换 8111 地址: %s", base), 5*time.Second)
		}
		c.baseURL = base
		c.hostOkAt = time.Now()
		c.hostError = ""
		c.logThrottled("host:ok", fmt.Sprintf("[WT-8111] 8111 已连接: %s (%d ms)", base, elapsedMs), 5*time.Second)
		return base, nil
	}

	msg := fmt.Sprintf("8111 连接失败: %s", strings.Join(errs, " | "))
	if len(msg) > 400 {
		msg = msg[:400]
	}
	c.hostError = msg
	c.nextProbeAt = time.Now().Add(2 * time.Second)
	c.logThrottled("host:fail", "[WT-8111] "+msg, 2*time.Second)
	return "", fmt.Errorf("%s", msg)
}

type httpStatusError struct {
	code int
	path string
}

func (e httpStatusError) Error() string {
	return fmt.Sprintf("HTTP %d on %s", e.code, e.path)
}

func (c *Client) fetchBytes(path string) ([]byte, error) {
	base, err := c.pickHost()
	if err != nil {
		return nil, err
	}
	req, _ := http.NewRequest("GET", base+path, nil)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.hostOkAt = time.Time{}
		return nil, err
	}
	defer resp.Body.Close()
	c.hostOkAt = time.Now()
	if resp.StatusCode >= 400 {
		return nil, httpStatusError{code: resp.StatusCode, path: path}
	}
	return io.ReadAll(resp.Body)
}

func (c *Client) fetchJSON(path string, target any) error {
	raw, err := c.fetchBytes(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func (c *Client) speedFactor(army string) float64 {
	if c.mockMode {
		return c.cfg.IndicatorsSpeedMultiplier
	}
	low := strings.ToLower(strings.TrimSpace(army))
	if low == "" || strings.Contains(low, "air") || strings.Contains(low, "heli") {
		return c.cfg.IndicatorsSpeedMultiplier
	}
	return c.cfg.GroundSpeedMultiplier
}

func (c *Client) extractTelemetry() map[string]any {
	var speedKmh any
	var gear any
	var army any
	var vehicleType any
	var rawUsed any
	var factorUsed any
	valid := false

	var indicators map[string]any
	if c.mock != nil {
		indicators = c.mock.GetIndicators()
	} else {
		if err := c.fetchJSON("/indicators", &indicators); err != nil {
			c.markError("indicators", err, "/indicators")
		}
	}

	if v, ok := indicators["valid"].(bool); ok && v {
		valid = true
		army = indicators["army"]
		gear = indicators["gear"]
		vehicleType = indicators["type"]
		if rawSpd, ok := toFloat(indicators["speed"]); ok {
			armyStr, _ := army.(string)
			factor := c.speedFactor(armyStr)
			speedKmh = int(math.Round(math.Abs(rawSpd) * factor))
			rawUsed = math.Abs(rawSpd)
			factorUsed = factor
		}
	}

	if speedKmh == nil && c.mock == nil {
		var st map[string]any
		if err := c.fetchJSON("/state", &st); err == nil {
			if v, ok := st["valid"].(bool); ok && v {
				armyStr, _ := army.(string)
				for _, k := range []string{"IAS, km/h", "TAS, km/h", "speed"} {
					if val, ok := toFloat(st[k]); ok {
						factor := 1.0
						if k == "speed" {
							factor = c.speedFactor(armyStr)
						}
						speedKmh = int(math.Round(math.Abs(val) * factor))
						rawUsed = math.Abs(val)
						factorUsed = factor
						valid = true
						break
					}
				}
			}
		}
	}

	if valid {
		c.markOK("indicators")
	} else if c.lastError["indicators"] == nil {
		c.markError("indicators", fmt.Errorf("indicators 与 state 均无有效数据"), "/indicators")
	}

	var rawUnit any
	if f, ok := factorUsed.(float64); ok {
		if f == 1.0 {
			rawUnit = "km/h"
		} else {
			rawUnit = "m/s"
		}
	}

	return map[string]any{
		"valid":          valid,
		"speed_kmh":      speedKmh,
		"speed_raw":      rawUsed,
		"speed_raw_unit": rawUnit,
		"speed_factor":   factorUsed,
		"gear":           gear,
		"army":           army,
		"vehicle_type":   vehicleType,
	}
}

func mapInfoFingerprint(mi map[string]any) string {
	b, _ := json.Marshal([]any{
		mi["map_min"], mi["map_max"], mi["grid_size"],
		mi["grid_steps"], mi["grid_zero"], mi["hud_type"],
	})
	return string(b)
}

func (c *Client) fetchMapImage(gen any) ([]byte, error) {
	genQ := fmt.Sprintf("%d", time.Now().Unix())
	if gen != nil {
		genQ = fmt.Sprintf("%v", gen)
	}
	cands := append([]string{c.imgPath}, imgPaths...)
	seen := map[string]bool{}
	var lastErr error
	for _, p := range cands {
		if seen[p] {
			continue
		}
		seen[p] = true
		data, err := c.fetchBytes(fmt.Sprintf("%s?gen=%s", p, genQ))
		if err != nil {
			lastErr = err
			if se, ok := err.(httpStatusError); ok && (se.code == 400 || se.code == 403 || se.code == 404) {
				continue
			}
			return nil, err
		}
		if len(data) == 0 {
			lastErr = fmt.Errorf("%s 返回空图片", p)
			continue
		}
		if p != c.imgPath {
			c.imgPath = p
			c.logThrottled("img:path", "[WT-8111] 地图图片端点已切换为 "+p, 5*time.Second)
		}
		return data, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("地图图片获取失败")
	}
	return nil, lastErr
}

func (c *Client) loadImage(gen any, infoKey string) string {
	if time.Now().Before(c.nextImgRetryAt) {
		return c.cachedSignature
	}
	var imgBytes []byte
	var imgType string
	if c.mock != nil {
		imgBytes, imgType = c.mock.GetMapImage()
		c.markOK("map_img")
	} else {
		var err error
		imgBytes, err = c.fetchMapImage(gen)
		if err != nil {
			c.markError("map_img", err, c.imgPath)
			c.nextImgRetryAt = time.Now().Add(2 * time.Second)
			return c.cachedSignature
		}
		imgType = "image/jpeg"
		c.markOK("map_img")
	}

	sig := store.ComputeImageSignature(imgBytes)
	c.mu.Lock()
	c.cachedGeneration = gen
	c.cachedImgBytes = imgBytes
	c.cachedImgType = imgType
	c.cachedSignature = sig
	if infoKey != "" {
		c.cachedInfoKey = infoKey
	}
	c.mu.Unlock()
	c.imgFetchedAt = time.Now()
	return sig
}

func (c *Client) pollOnce() bool {
	now := time.Now()

	if c.mock != nil {
		c.cachedMapInfo = c.mock.GetMapInfo()
		c.markOK("map_info")
	} else if !now.Before(c.nextMapInfoAt) {
		c.nextMapInfoAt = now.Add(c.mapInfoInterval)
		var mi map[string]any
		if err := c.fetchJSON("/map_info.json", &mi); err != nil {
			c.markError("map_info", err, "/map_info.json")
		} else {
			c.cachedMapInfo = mi
			c.markOK("map_info")
		}
	}

	mi := c.cachedMapInfo
	valid, _ := mi["valid"].(bool)
	if mi == nil || !valid {
		c.setStandby()
		c.nextMapInfoAt = time.Time{}
		return false
	}
	if age, ok := c.ageSec("map_info"); ok && age > c.standbyGrace.Seconds() {
		c.setStandby()
		c.nextMapInfoAt = time.Time{}
		return false
	}

	gen := mi["map_generation"]
	infoKey := mapInfoFingerprint(mi)
	genChanged := gen != nil && c.cachedGeneration != nil && fmt.Sprintf("%v", gen) != fmt.Sprintf("%v", c.cachedGeneration)
	boundsChanged := c.cachedInfoKey != "" && infoKey != c.cachedInfoKey
	mapChanged := genChanged || boundsChanged

	c.noteGeneration(gen)
	if boundsChanged && !genChanged && c.matchSeq > 0 {
		c.matchSeq++
		ts := float64(time.Now().UnixNano()) / 1e9
		c.matchStartedTs = &ts
	}

	if mapChanged {
		c.mu.Lock()
		c.cachedImgBytes = nil
		c.cachedSignature = ""
		c.mu.Unlock()
		c.nextImgRetryAt = time.Time{}
	}

	needImage := len(c.cachedImgBytes) == 0 || mapChanged || (gen == nil && time.Since(c.imgFetchedAt) > 5*time.Second)
	var sig string
	if needImage {
		sig = c.loadImage(gen, infoKey)
	} else {
		if c.cachedInfoKey == "" {
			c.cachedInfoKey = infoKey
		}
		sig = c.cachedSignature
	}

	if c.mock != nil {
		c.cachedRawObjects = c.mock.GetMapObjects()
		c.markOK("map_obj")
	} else {
		var rawObjs []map[string]any
		if err := c.fetchJSON("/map_obj.json", &rawObjs); err != nil {
			c.markError("map_obj", err, "/map_obj.json")
			if age, ok := c.ageSec("map_obj"); !ok || age > c.standbyGrace.Seconds() {
				c.setStandby()
				c.nextMapInfoAt = time.Time{}
				return false
			}
		} else {
			c.cachedRawObjects = rawObjs
			c.markOK("map_obj")
		}
	}

	objs := make([]map[string]any, 0, len(c.cachedRawObjects))
	for _, o := range c.cachedRawObjects {
		if o != nil {
			objs = append(objs, classifyObject(o))
		}
	}

	var telemetry map[string]any
	if c.mock != nil || !now.Before(c.nextIndicatorsAt) {
		c.nextIndicatorsAt = time.Now().Add(c.indicatorsInterval)
		telemetry = c.extractTelemetry()
		c.cachedTelemetry = telemetry
	} else {
		telemetry = c.cachedTelemetry
	}

	cfg := c.routeStore.Load()
	mr := store.MatchMap(sig, mi, cfg)
	if c.mockMode && mr.MatchedID == nil {
		if mapsRaw, ok := cfg["maps"].(map[string]any); ok {
			if _, hasMock := mapsRaw["mock_tactical_arena"]; hasMock {
				id := "mock_tactical_arena"
				mr.MatchedID = &id
				mr.MatchType = "exact"
			}
		}
	}
	physHint := store.ExtractPhysicalHint(mi)

	c.mu.Lock()
	c.state = map[string]any{
		"status":         "active",
		"mock_mode":      c.mockMode,
		"map_generation": gen,
		"map_signature":  sig,
		"map_info":       mi,
		"physical_hint":  physHint,
		"matched_map_id": mr.MatchedID,
		"match_type":     mr.MatchType,
		"candidates":     mr.Candidates,
		"objects":        objs,
		"telemetry":      telemetry,
		"timestamp":      float64(time.Now().UnixNano()) / 1e9,
		"freshness":      c.freshness(),
		"match":          c.matchInfo(),
		"source_host":    c.baseURL,
	}
	c.mu.Unlock()
	return true
}

func (c *Client) pollLoop() {
	for {
		start := time.Now()
		active := c.pollOnce()
		wait := 500 * time.Millisecond
		if active {
			wait = c.pollInterval
		}
		elapsed := time.Since(start)
		if remaining := wait - elapsed; remaining > 0 {
			select {
			case <-c.stopCh:
				return
			case <-time.After(remaining):
			}
		} else {
			select {
			case <-c.stopCh:
				return
			default:
			}
		}
	}
}
