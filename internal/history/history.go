package history

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const MaxHistoryRecords = 100

type MatchInput struct {
	MapName          string  `json:"map_name"`
	Vehicle          string  `json:"vehicle"`
	DurationSec      int     `json:"duration_sec"`
	DistanceM        int     `json:"distance_m"`
	MaxSpeedKmh      int     `json:"max_speed_kmh"`
	SelfDeaths       int     `json:"self_deaths"`
	NearbyAllyLosses int     `json:"nearby_ally_losses"`
	StrategyTier     string  `json:"strategy_tier"`
	Timestamp        float64 `json:"timestamp,omitempty"`
}

type MatchRecord struct {
	ID               string  `json:"id"`
	Timestamp        int64   `json:"timestamp"`
	MapName          string  `json:"map_name"`
	Vehicle          string  `json:"vehicle"`
	DurationSec      int     `json:"duration_sec"`
	DistanceM        int     `json:"distance_m"`
	MaxSpeedKmh      int     `json:"max_speed_kmh"`
	SelfDeaths       int     `json:"self_deaths"`
	NearbyAllyLosses int     `json:"nearby_ally_losses"`
	StrategyTier     string  `json:"strategy_tier"`
	Score            int     `json:"score"`
	Delta            int     `json:"delta"`
	Source           string  `json:"source"` // "rule" | "ai"
	Comment          string  `json:"comment"`
	FallbackNote     string  `json:"fallback_note,omitempty"`
}

type Summary struct {
	Count       int     `json:"count"`
	LatestScore *int    `json:"latest_score"`
	AvgScore    float64 `json:"avg_score"`
	Delta       int     `json:"delta"`
	Trend       string  `json:"trend"`      // "up" | "down" | "flat"
	TrendText   string  `json:"trend_text"` // "上升" | "下降" | "波动平稳"
}

type AIConfig struct {
	Enabled bool   `json:"enabled"`
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`
}

type Store struct {
	mu          sync.Mutex
	historyPath string
	aiCfgPath   string
	records     []MatchRecord
	aiCfg       AIConfig
	httpClient  *http.Client
}

func NewStore(routesDir string) *Store {
	s := &Store{
		historyPath: filepath.Join(routesDir, "match_history.json"),
		aiCfgPath:   filepath.Join(routesDir, "ai_config.json"),
		aiCfg: AIConfig{
			Enabled: false,
			BaseURL: "https://api.openai.com/v1",
			Model:   "gpt-4o-mini",
		},
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
	s.loadFromDisk()
	return s
}

func (s *Store) loadFromDisk() {
	if raw, err := os.ReadFile(s.historyPath); err == nil {
		var recs []MatchRecord
		if json.Unmarshal(raw, &recs) == nil {
			s.records = recs
		}
	}
	if raw, err := os.ReadFile(s.aiCfgPath); err == nil {
		var cfg AIConfig
		if json.Unmarshal(raw, &cfg) == nil {
			if cfg.BaseURL == "" {
				cfg.BaseURL = "https://api.openai.com/v1"
			}
			if cfg.Model == "" {
				cfg.Model = "gpt-4o-mini"
			}
			s.aiCfg = cfg
		}
	}
}

func writeJSONAtomic(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func ComputeRuleScore(in MatchInput) (int, string) {
	score := 62

	// Duration contribution (active engagement up to ~12 min)
	durMin := float64(in.DurationSec) / 60.0
	if durMin >= 1.0 {
		score += int(math.Min(16.0, durMin*1.8))
	} else {
		score -= 8
	}

	// Mobility & map presence (distance covered)
	if in.DistanceM >= 1500 {
		score += 12
	} else if in.DistanceM >= 600 {
		score += 7
	} else if in.DistanceM >= 200 {
		score += 3
	}

	// Survival penalty per own wreck
	score -= in.SelfDeaths * 11
	if in.SelfDeaths == 0 && durMin >= 2.0 {
		score += 8
	}

	// Nearby ally loss pressure
	if in.NearbyAllyLosses >= 3 && in.SelfDeaths == 0 {
		score += 5 // survived heavy flank collapse
	} else if in.NearbyAllyLosses > 0 {
		score -= in.NearbyAllyLosses * 2
	}

	score = clampInt(score, 15, 99)

	var comment string
	switch {
	case score >= 85:
		comment = fmt.Sprintf("表现稳健！驾驶 %s 机动 %dm 且存活率出色，节奏把控很好。", fallbackText(in.Vehicle, "主力载具"), in.DistanceM)
	case score >= 70:
		comment = fmt.Sprintf("中规中矩的一局：%s 推进约 %dm，战损 %d 次，注意观察友军残骸高危区。", fallbackText(in.Vehicle, "当前载具"), in.DistanceM, in.SelfDeaths)
	default:
		comment = fmt.Sprintf("本局承压较大（阵亡 %d 次 / 近距友军失守 %d 次），下局可尝试保守二线或换线绕行。", in.SelfDeaths, in.NearbyAllyLosses)
	}
	return score, comment
}

func fallbackText(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return strings.TrimSpace(s)
}

func ComputeSummary(recs []MatchRecord) Summary {
	n := len(recs)
	if n == 0 {
		return Summary{
			Count:     0,
			Trend:     "flat",
			TrendText: "暂无记录",
		}
	}
	sum := 0
	for _, r := range recs {
		sum += r.Score
	}
	avg := math.Round((float64(sum)/float64(n))*10) / 10
	latest := recs[n-1].Score
	delta := 0
	if n >= 2 {
		delta = latest - recs[n-2].Score
	}

	trend := "flat"
	trendText := "波动平稳"
	if n >= 4 {
		recentAvg := float64(recs[n-1].Score+recs[n-2].Score+recs[n-3].Score) / 3.0
		prevSum := 0
		for i := 0; i < n-3; i++ {
			prevSum += recs[i].Score
		}
		prevAvg := float64(prevSum) / float64(n-3)
		if recentAvg > prevAvg+2.5 {
			trend = "up"
			trendText = "上升趋势"
		} else if recentAvg < prevAvg-2.5 {
			trend = "down"
			trendText = "下滑趋势"
		}
	} else if n >= 2 {
		if delta >= 4 {
			trend = "up"
			trendText = "上升趋势"
		} else if delta <= -4 {
			trend = "down"
			trendText = "下滑趋势"
		}
	}

	return Summary{
		Count:       n,
		LatestScore: &latest,
		AvgScore:    avg,
		Delta:       delta,
		Trend:       trend,
		TrendText:   trendText,
	}
}

func (s *Store) GetHistory() ([]MatchRecord, Summary) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]MatchRecord, len(s.records))
	copy(cp, s.records)
	return cp, ComputeSummary(cp)
}

func (s *Store) ClearHistory() ([]MatchRecord, Summary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = []MatchRecord{}
	err := writeJSONAtomic(s.historyPath, s.records)
	return []MatchRecord{}, ComputeSummary(s.records), err
}

func maskKey(key string) string {
	k := strings.TrimSpace(key)
	if k == "" {
		return ""
	}
	if len(k) <= 8 {
		return "****"
	}
	return k[:4] + "****" + k[len(k)-4:]
}

func (s *Store) GetAIConfigMasked() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]any{
		"enabled":        s.aiCfg.Enabled,
		"base_url":       s.aiCfg.BaseURL,
		"model":          s.aiCfg.Model,
		"has_api_key":    strings.TrimSpace(s.aiCfg.APIKey) != "",
		"api_key_masked": maskKey(s.aiCfg.APIKey),
	}
}

func (s *Store) SaveAIConfig(enabled bool, baseURL, apiKey, model string) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(baseURL) != "" {
		s.aiCfg.BaseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	if strings.TrimSpace(model) != "" {
		s.aiCfg.Model = strings.TrimSpace(model)
	}
	if strings.TrimSpace(apiKey) != "" {
		s.aiCfg.APIKey = strings.TrimSpace(apiKey)
	}
	s.aiCfg.Enabled = enabled

	if err := writeJSONAtomic(s.aiCfgPath, s.aiCfg); err != nil {
		return nil, err
	}
	return map[string]any{
		"enabled":        s.aiCfg.Enabled,
		"base_url":       s.aiCfg.BaseURL,
		"model":          s.aiCfg.Model,
		"has_api_key":    strings.TrimSpace(s.aiCfg.APIKey) != "",
		"api_key_masked": maskKey(s.aiCfg.APIKey),
	}, nil
}

func (s *Store) evaluateWithAI(cfg AIConfig, in MatchInput, recent []MatchRecord) (int, string, error) {
	endpoint := strings.TrimRight(cfg.BaseURL, "/")
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}

	recentBrief := make([]string, 0, 5)
	startIdx := 0
	if len(recent) > 5 {
		startIdx = len(recent) - 5
	}
	for _, r := range recent[startIdx:] {
		recentBrief = append(recentBrief, fmt.Sprintf("[%s/%s:%d分]", r.MapName, r.Vehicle, r.Score))
	}

	userPrompt := fmt.Sprintf(
		"你是《战争雷霆》陆战历史(RB)战术复盘助手“基米”。请根据本局数据与近期历史得分，给出 0~100 的整数评分与一句简短犀利的中文战术评语（不超过 75 字，不要出现“测距”二字）。\n"+
			"本局数据：地图=%s，载具=%s，时长=%d秒，行进=%dm，极速=%dkm/h，己方阵亡=%d次，近距友军消失=%d次，策略档=%s。\n"+
			"近期战绩：%s\n"+
			"请严格只输出 JSON：{\"score\": 82, \"comment\": \"...\"}",
		fallbackText(in.MapName, "未知地图"),
		fallbackText(in.Vehicle, "未知载具"),
		in.DurationSec,
		in.DistanceM,
		in.MaxSpeedKmh,
		in.SelfDeaths,
		in.NearbyAllyLosses,
		fallbackText(in.StrategyTier, "off"),
		strings.Join(recentBrief, " "),
	)

	reqBody := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "system", "content": "只输出合法 JSON 对象，格式为 {\"score\": 整数, \"comment\": \"中文评语\"}。"},
			{"role": "user", "content": userPrompt},
		},
		"temperature": 0.4,
	}
	rawReq, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(rawReq))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	rawResp, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return 0, "", err
	}
	if resp.StatusCode >= 400 {
		return 0, "", fmt.Errorf("AI HTTP %d: %s", resp.StatusCode, string(rawResp))
	}

	var apiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(rawResp, &apiResp); err != nil || len(apiResp.Choices) == 0 {
		return 0, "", fmt.Errorf("unexpected AI response shape")
	}

	content := strings.TrimSpace(apiResp.Choices[0].Message.Content)
	// Strip optional markdown code fences
	if idx := strings.Index(content, "{"); idx >= 0 {
		if end := strings.LastIndex(content, "}"); end > idx {
			content = content[idx : end+1]
		}
	}

	var parsed struct {
		Score   int    `json:"score"`
		Comment string `json:"comment"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return 0, "", err
	}
	if parsed.Score <= 0 && parsed.Comment == "" {
		return 0, "", fmt.Errorf("empty AI JSON fields")
	}
	return clampInt(parsed.Score, 1, 100), strings.ReplaceAll(strings.TrimSpace(parsed.Comment), "测距", "定位"), nil
}

func (s *Store) RecordMatch(in MatchInput) (MatchRecord, []MatchRecord, Summary, error) {
	s.mu.Lock()
	cfg := s.aiCfg
	recent := make([]MatchRecord, len(s.records))
	copy(recent, s.records)
	s.mu.Unlock()

	score, comment := ComputeRuleScore(in)
	source := "rule"
	fallbackNote := ""

	if cfg.Enabled && strings.TrimSpace(cfg.BaseURL) != "" && strings.TrimSpace(cfg.APIKey) != "" {
		aiScore, aiComment, err := s.evaluateWithAI(cfg, in, recent)
		if err == nil {
			score = aiScore
			if aiComment != "" {
				comment = aiComment
			}
			source = "ai"
		} else {
			fallbackNote = "AI 调用失败已回退规则打分: " + err.Error()
			if len(fallbackNote) > 160 {
				fallbackNote = fallbackNote[:160]
			}
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	delta := 0
	if len(s.records) > 0 {
		delta = score - s.records[len(s.records)-1].Score
	}

	nowSec := time.Now().Unix()
	rec := MatchRecord{
		ID:               fmt.Sprintf("m_%d", time.Now().UnixNano()),
		Timestamp:        nowSec,
		MapName:          fallbackText(in.MapName, "未知地图"),
		Vehicle:          fallbackText(in.Vehicle, "未知载具"),
		DurationSec:      in.DurationSec,
		DistanceM:        in.DistanceM,
		MaxSpeedKmh:      in.MaxSpeedKmh,
		SelfDeaths:       in.SelfDeaths,
		NearbyAllyLosses: in.NearbyAllyLosses,
		StrategyTier:     fallbackText(in.StrategyTier, "off"),
		Score:            score,
		Delta:            delta,
		Source:           source,
		Comment:          comment,
		FallbackNote:     fallbackNote,
	}

	s.records = append(s.records, rec)
	if len(s.records) > MaxHistoryRecords {
		s.records = append([]MatchRecord(nil), s.records[len(s.records)-MaxHistoryRecords:]...)
	}
	err := writeJSONAtomic(s.historyPath, s.records)

	cp := make([]MatchRecord, len(s.records))
	copy(cp, s.records)
	return rec, cp, ComputeSummary(cp), err
}
