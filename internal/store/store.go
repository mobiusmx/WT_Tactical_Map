package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const MaxBackupFiles = 30

type Candidate struct {
	MapID string `json:"map_id"`
	Name  string `json:"name"`
	Score int    `json:"score"`
}

type MatchResult struct {
	MatchedID *string     `json:"matched_id"`
	MatchType string      `json:"match_type"`
	Candidates []Candidate `json:"candidates"`
}

type RouteStore struct {
	BaseDir     string
	RoutesDir   string
	OverlaysDir string
	BackupsDir  string
	MapsDir     string
	ConfigPath  string

	mu            sync.Mutex
	inMemConfig   map[string]any
	readOnlyDisk  bool
	defaultConfig []byte
}

func NewRouteStore(baseDir string, embeddedDefaultRoutes []byte) (*RouteStore, error) {
	routesDir := filepath.Join(baseDir, "routes")
	overlaysDir := filepath.Join(routesDir, "overlays")
	backupsDir := filepath.Join(routesDir, "backups")
	mapsDir := filepath.Join(routesDir, "maps")
	configPath := filepath.Join(routesDir, "routes_config.json")

	rs := &RouteStore{
		BaseDir:       baseDir,
		RoutesDir:     routesDir,
		OverlaysDir:   overlaysDir,
		BackupsDir:    backupsDir,
		MapsDir:       mapsDir,
		ConfigPath:    configPath,
		defaultConfig: embeddedDefaultRoutes,
	}

	_ = os.MkdirAll(routesDir, 0o755)
	_ = os.MkdirAll(overlaysDir, 0o755)
	_ = os.MkdirAll(backupsDir, 0o755)

	if _, err := os.Stat(configPath); os.IsNotExist(err) && len(embeddedDefaultRoutes) > 0 {
		if writeErr := os.WriteFile(configPath, embeddedDefaultRoutes, 0o644); writeErr != nil {
			rs.readOnlyDisk = true
			var parsed map[string]any
			if err := json.Unmarshal(embeddedDefaultRoutes, &parsed); err == nil {
				rs.inMemConfig = parsed
			}
		}
	} else if len(embeddedDefaultRoutes) > 0 {
		rs.mergeEmbeddedDefaults(embeddedDefaultRoutes)
	}

	return rs, nil
}

func countVectorElements(layers []any) int {
	total := 0
	for _, raw := range layers {
		l, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if elems, ok := l["elements"].([]any); ok {
			total += len(elems)
		}
	}
	return total
}

func (rs *RouteStore) mergeEmbeddedDefaults(embedded []byte) {
	var embCfg map[string]any
	if json.Unmarshal(embedded, &embCfg) != nil {
		return
	}
	embMaps, _ := embCfg["maps"].(map[string]any)
	if len(embMaps) == 0 {
		return
	}

	rs.mu.Lock()
	defer rs.mu.Unlock()
	diskCfg := rs.loadLocked()
	diskMaps, _ := diskCfg["maps"].(map[string]any)
	if diskMaps == nil {
		return
	}

	changed := false
	for mapID, rawEmb := range embMaps {
		embEntry, ok := rawEmb.(map[string]any)
		if !ok {
			continue
		}
		diskEntry, exists := diskMaps[mapID].(map[string]any)
		if !exists {
			diskMaps[mapID] = deepCopyMap(embEntry)
			changed = true
			continue
		}

		// Backfill empty vector_layers when embedded has routes
		diskVec, _ := diskEntry["vector_layers"].([]any)
		embVec, _ := embEntry["vector_layers"].([]any)
		if countVectorElements(diskVec) == 0 && countVectorElements(embVec) > 0 {
			diskEntry["vector_layers"] = embVec
			changed = true
		}

		// Merge missing png_layers (e.g. newly added @木炉 route maps)
		diskPng, _ := diskEntry["png_layers"].([]any)
		embPng, _ := embEntry["png_layers"].([]any)
		if len(embPng) > 0 {
			seen := map[string]bool{}
			for _, rawP := range diskPng {
				if pm, ok := rawP.(map[string]any); ok {
					if f, ok := pm["file"].(string); ok && f != "" {
						seen[f] = true
					}
				}
			}
			for _, rawP := range embPng {
				if pm, ok := rawP.(map[string]any); ok {
					if f, ok := pm["file"].(string); ok && f != "" && !seen[f] {
						diskPng = append(diskPng, pm)
						seen[f] = true
						changed = true
					}
				}
			}
			diskEntry["png_layers"] = diskPng
		}
	}

	if changed {
		_ = rs.writeAtomicLocked(diskCfg, false)
	}
}

func ComputeImageSignature(imgBytes []byte) string {
	if len(imgBytes) == 0 {
		return ""
	}
	sum := sha256.Sum256(imgBytes)
	return hex.EncodeToString(sum[:])[:16]
}

func roundFloat(v float64, decimals int) float64 {
	pow := math.Pow(10, float64(decimals))
	return math.Round(v*pow) / pow
}

func safeFloatPair(v any) ([]float64, bool) {
	arr, ok := v.([]any)
	if !ok || len(arr) < 2 {
		if fArr, ok2 := v.([]float64); ok2 && len(fArr) >= 2 {
			return []float64{roundFloat(fArr[0], 3), roundFloat(fArr[1], 3)}, true
		}
		return nil, false
	}
	f0, ok0 := toFloat64(arr[0])
	f1, ok1 := toFloat64(arr[1])
	if !ok0 || !ok1 {
		return nil, false
	}
	return []float64{roundFloat(f0, 3), roundFloat(f1, 3)}, true
}

func toFloat64(v any) (float64, bool) {
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

func ExtractPhysicalHint(mapInfo map[string]any) map[string]any {
	if mapInfo == nil {
		return map[string]any{}
	}
	hint := map[string]any{}
	var mapMin, mapMax []float64
	if p, ok := safeFloatPair(mapInfo["map_min"]); ok {
		hint["map_min"] = p
		mapMin = p
	}
	if p, ok := safeFloatPair(mapInfo["map_max"]); ok {
		hint["map_max"] = p
		mapMax = p
	}
	if p, ok := safeFloatPair(mapInfo["grid_size"]); ok {
		hint["grid_size"] = p
	}
	if p, ok := safeFloatPair(mapInfo["grid_steps"]); ok {
		hint["grid_steps"] = p
	}
	if p, ok := safeFloatPair(mapInfo["grid_zero"]); ok {
		hint["grid_zero"] = p
	}
	if len(mapMin) == 2 && len(mapMax) == 2 {
		hint["width_m"] = roundFloat(math.Abs(mapMax[0]-mapMin[0]), 2)
		hint["height_m"] = roundFloat(math.Abs(mapMax[1]-mapMin[1]), 2)
	}
	return hint
}

func pairEqual(a, b any) bool {
	pa, okA := safeFloatPair(a)
	pb, okB := safeFloatPair(b)
	if !okA || !okB {
		return false
	}
	return pa[0] == pb[0] && pa[1] == pb[1]
}

func physicalSimilarity(curHint, savedHint map[string]any) int {
	if len(curHint) == 0 || len(savedHint) == 0 {
		return 0
	}
	score := 0
	for _, k := range []string{"map_min", "map_max", "grid_steps", "grid_size"} {
		if curVal, ok1 := curHint[k]; ok1 {
			if savedVal, ok2 := savedHint[k]; ok2 && pairEqual(curVal, savedVal) {
				score++
			}
		}
	}
	return score
}

func MatchMap(signature string, mapInfo map[string]any, routesConfig map[string]any) MatchResult {
	mapsRaw, _ := routesConfig["maps"].(map[string]any)
	curHint := ExtractPhysicalHint(mapInfo)

	if signature != "" {
		for mapID, rawEntry := range mapsRaw {
			entry, ok := rawEntry.(map[string]any)
			if !ok {
				continue
			}
			sigs, _ := entry["signatures"].([]any)
			for _, s := range sigs {
				if str, ok := s.(string); ok && str == signature {
					name := mapID
					if n, ok := entry["name"].(string); ok && n != "" {
						name = n
					}
					matched := mapID
					return MatchResult{
						MatchedID: &matched,
						MatchType: "exact",
						Candidates: []Candidate{{
							MapID: mapID,
							Name:  name,
							Score: 100,
						}},
					}
				}
			}
		}
	}

	candidates := []Candidate{}
	fullHits := []string{}
	for mapID, rawEntry := range mapsRaw {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}
		bestScore := 0
		hints, _ := entry["physical_hints"].([]any)
		for _, rawHint := range hints {
			if hMap, ok := rawHint.(map[string]any); ok {
				s := physicalSimilarity(curHint, hMap)
				if s > bestScore {
					bestScore = s
				}
			}
		}
		if bestScore > 0 {
			name := mapID
			if n, ok := entry["name"].(string); ok && n != "" {
				name = n
			}
			candidates = append(candidates, Candidate{
				MapID: mapID,
				Name:  name,
				Score: bestScore,
			})
			if bestScore >= 4 {
				fullHits = append(fullHits, mapID)
			}
		}
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		return candidates[i].Name < candidates[j].Name
	})

	if len(fullHits) == 1 {
		matched := fullHits[0]
		return MatchResult{
			MatchedID:  &matched,
			MatchType:  "physical",
			Candidates: candidates,
		}
	}
	if len(fullHits) > 1 {
		fam := baseMapFamily(fullHits[0])
		sameFamily := true
		baseID := ""
		for _, id := range fullHits {
			if baseMapFamily(id) != fam {
				sameFamily = false
				break
			}
			if strings.EqualFold(id, fam) {
				baseID = id
			}
		}
		if sameFamily {
			if baseID == "" {
				baseID = fullHits[0]
			}
			return MatchResult{
				MatchedID:  &baseID,
				MatchType:  "physical",
				Candidates: candidates,
			}
		}
	}

	return MatchResult{
		MatchedID:  nil,
		MatchType:  "none",
		Candidates: candidates,
	}
}

func baseMapFamily(mapID string) string {
	low := strings.ToLower(strings.TrimSpace(mapID))
	low = strings.TrimSuffix(low, "_snow")
	low = strings.TrimSuffix(low, "_winter")
	return low
}

func deepCopyMap(src map[string]any) map[string]any {
	raw, err := json.Marshal(src)
	if err != nil {
		return map[string]any{"version": 1, "maps": map[string]any{}}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return map[string]any{"version": 1, "maps": map[string]any{}}
	}
	return out
}

func (rs *RouteStore) loadLocked() map[string]any {
	if rs.readOnlyDisk && rs.inMemConfig != nil {
		return deepCopyMap(rs.inMemConfig)
	}
	raw, err := os.ReadFile(rs.ConfigPath)
	if err != nil && len(rs.defaultConfig) > 0 {
		raw = rs.defaultConfig
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil || data == nil {
		data = map[string]any{"version": 1, "maps": map[string]any{}}
	}
	if _, ok := data["maps"].(map[string]any); !ok {
		data["maps"] = map[string]any{}
	}
	return data
}

func (rs *RouteStore) writeAtomicLocked(cfg map[string]any, createBackup bool) error {
	if rs.readOnlyDisk {
		rs.inMemConfig = deepCopyMap(cfg)
		return nil
	}
	if createBackup {
		if _, err := os.Stat(rs.ConfigPath); err == nil {
			stamp := time.Now().Format("20060102_150405.000000")
			stamp = strings.ReplaceAll(stamp, ".", "_")
			bakPath := filepath.Join(rs.BackupsDir, fmt.Sprintf("routes_config.bak-%s.json", stamp))
			if orig, err := os.ReadFile(rs.ConfigPath); err == nil {
				_ = os.WriteFile(bakPath, orig, 0o644)
				rs.pruneOldBackupsLocked()
			}
		}
	}
	encoded, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	tmpPath := rs.ConfigPath + ".tmp"
	if err := os.WriteFile(tmpPath, encoded, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, rs.ConfigPath)
}

func (rs *RouteStore) pruneOldBackupsLocked() {
	entries, err := os.ReadDir(rs.BackupsDir)
	if err != nil {
		return
	}
	type bakFile struct {
		path    string
		modTime time.Time
	}
	var list []bakFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, "routes_config.bak-") && strings.HasSuffix(name, ".json") {
			info, err := e.Info()
			if err == nil {
				list = append(list, bakFile{
					path:    filepath.Join(rs.BackupsDir, name),
					modTime: info.ModTime(),
				})
			}
		}
	}
	if len(list) <= MaxBackupFiles {
		return
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].modTime.After(list[j].modTime)
	})
	for _, old := range list[MaxBackupFiles:] {
		_ = os.Remove(old.path)
	}
}

func (rs *RouteStore) Load() map[string]any {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	return rs.loadLocked()
}

func (rs *RouteStore) SaveMapLayers(mapID string, vectorLayers []any, pngLayers []any, mapName string) (map[string]any, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	cfg := rs.loadLocked()
	maps, _ := cfg["maps"].(map[string]any)
	if maps == nil {
		maps = map[string]any{}
		cfg["maps"] = maps
	}
	entry, _ := maps[mapID].(map[string]any)
	if entry == nil {
		name := mapName
		if name == "" {
			name = mapID
		}
		entry = map[string]any{
			"name":           name,
			"signatures":     []any{},
			"physical_hints": []any{},
			"png_layers":     []any{},
			"vector_layers":  []any{},
		}
		maps[mapID] = entry
	}
	if mapName != "" {
		entry["name"] = mapName
	}
	entry["vector_layers"] = vectorLayers
	if pngLayers != nil {
		entry["png_layers"] = pngLayers
	}
	if err := rs.writeAtomicLocked(cfg, true); err != nil {
		return nil, err
	}
	return deepCopyMap(entry), nil
}

func (rs *RouteStore) BindSignature(mapID, signature string, physicalHint map[string]any, mapName string) (map[string]any, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	cfg := rs.loadLocked()
	maps, _ := cfg["maps"].(map[string]any)
	if maps == nil {
		maps = map[string]any{}
		cfg["maps"] = maps
	}

	if signature != "" {
		for _, rawOther := range maps {
			other, ok := rawOther.(map[string]any)
			if !ok {
				continue
			}
			sigs, _ := other["signatures"].([]any)
			filtered := make([]any, 0, len(sigs))
			for _, s := range sigs {
				if str, ok := s.(string); ok && str != signature {
					filtered = append(filtered, str)
				}
			}
			other["signatures"] = filtered
		}
	}

	entry, _ := maps[mapID].(map[string]any)
	if entry == nil {
		name := mapName
		if name == "" {
			name = mapID
		}
		entry = map[string]any{
			"name":           name,
			"signatures":     []any{},
			"physical_hints": []any{},
			"png_layers":     []any{},
			"vector_layers":  []any{},
		}
		maps[mapID] = entry
	}
	if mapName != "" {
		entry["name"] = mapName
	}
	if signature != "" {
		sigs, _ := entry["signatures"].([]any)
		sigs = append(sigs, signature)
		entry["signatures"] = sigs
	}
	if len(physicalHint) > 0 {
		hints, _ := entry["physical_hints"].([]any)
		encodedNew, _ := json.Marshal(physicalHint)
		dup := false
		for _, h := range hints {
			if encodedOld, _ := json.Marshal(h); string(encodedOld) == string(encodedNew) {
				dup = true
				break
			}
		}
		if !dup {
			entry["physical_hints"] = append(hints, physicalHint)
		}
	}

	if err := rs.writeAtomicLocked(cfg, true); err != nil {
		return nil, err
	}
	return deepCopyMap(cfg), nil
}

func (rs *RouteStore) CreateMap(mapID, name, signature string, physicalHint map[string]any) (map[string]any, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	cfg := rs.loadLocked()
	maps, _ := cfg["maps"].(map[string]any)
	if maps == nil {
		maps = map[string]any{}
		cfg["maps"] = maps
	}
	if _, exists := maps[mapID]; exists {
		return nil, fmt.Errorf("map_id '%s' already exists", mapID)
	}

	if signature != "" {
		for _, rawOther := range maps {
			other, ok := rawOther.(map[string]any)
			if !ok {
				continue
			}
			sigs, _ := other["signatures"].([]any)
			filtered := make([]any, 0, len(sigs))
			for _, s := range sigs {
				if str, ok := s.(string); ok && str != signature {
					filtered = append(filtered, str)
				}
			}
			other["signatures"] = filtered
		}
	}

	sigs := []any{}
	if signature != "" {
		sigs = append(sigs, signature)
	}
	hints := []any{}
	if len(physicalHint) > 0 {
		hints = append(hints, physicalHint)
	}

	maps[mapID] = map[string]any{
		"name":           name,
		"signatures":     sigs,
		"physical_hints": hints,
		"png_layers":     []any{},
		"vector_layers": []any{
			map[string]any{
				"id":       "opening_flank",
				"name":     "开局抢点绕后线",
				"category": "flank",
				"color":    "#00e5ff",
				"visible":  true,
				"elements": []any{},
			},
		},
	}

	if err := rs.writeAtomicLocked(cfg, true); err != nil {
		return nil, err
	}
	return deepCopyMap(cfg), nil
}

func (rs *RouteStore) ListOverlayPNGs() []string {
	out := []string{}
	_ = filepath.WalkDir(rs.OverlaysDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d == nil || d.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(d.Name()), ".png") {
			rel, err := filepath.Rel(rs.RoutesDir, path)
			if err == nil {
				out = append(out, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	sort.Strings(out)
	return out
}
