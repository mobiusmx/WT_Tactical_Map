package mock

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"sync"
	"time"

	"wt-tactical-map/internal/store"
)

var (
	once          sync.Once
	mockPNGBytes  []byte
	mockSignature string
)

func generateMockPNG(size int) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	baseR, baseG, baseB := 22.0, 30.0, 38.0

	clampByte := func(v float64) uint8 {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return uint8(v)
	}

	setPixel := func(x, y int, r, g, b uint8) {
		if x >= 0 && x < size && y >= 0 && y < size {
			img.SetNRGBA(x, y, color.NRGBA{R: r, G: g, B: b, A: 255})
		}
	}

	drawThickLine := func(x0, y0, x1, y1 float64, radius int, r, g, b uint8) {
		steps := int(math.Hypot(x1-x0, y1-y0) * 1.5)
		if steps < 1 {
			steps = 1
		}
		for i := 0; i <= steps; i++ {
			t := float64(i) / float64(steps)
			cx := int(x0 + (x1-x0)*t)
			cy := int(y0 + (y1-y0)*t)
			for dy := -radius; dy <= radius; dy++ {
				for dx := -radius; dx <= radius; dx++ {
					if dx*dx+dy*dy <= radius*radius+1 {
						setPixel(cx+dx, cy+dy, r, g, b)
					}
				}
			}
		}
	}

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			elev := math.Sin(float64(x)*0.018)*math.Cos(float64(y)*0.015) + math.Sin(float64(x+y)*0.01)*0.5
			delta := elev * 6.0
			r := clampByte(math.Max(12, math.Min(48, baseR+delta)))
			g := clampByte(math.Max(16, math.Min(56, baseG+delta)))
			b := clampByte(math.Max(20, math.Min(64, baseB+delta)))
			img.SetNRGBA(x, y, color.NRGBA{R: r, G: g, B: b, A: 255})
		}
	}

	river := make([][2]float64, 90)
	for i := 0; i < 90; i++ {
		t := float64(i) / 89.0
		rx := float64(size) * (0.78 - 0.56*t + 0.06*math.Sin(t*math.Pi*2.5))
		ry := float64(size) * t
		river[i] = [2]float64{rx, ry}
	}
	for i := 0; i < len(river)-1; i++ {
		drawThickLine(river[i][0], river[i][1], river[i+1][0], river[i+1][1], 11, 18, 46, 68)
	}

	roads := [][4]float64{
		{0.14, 0.84, 0.24, 0.34},
		{0.24, 0.34, 0.50, 0.50},
		{0.50, 0.50, 0.76, 0.66},
		{0.76, 0.66, 0.86, 0.16},
		{0.14, 0.84, 0.50, 0.50},
		{0.50, 0.50, 0.86, 0.16},
		{0.24, 0.34, 0.52, 0.18},
		{0.52, 0.18, 0.86, 0.16},
	}
	for _, rd := range roads {
		drawThickLine(rd[0]*float64(size), rd[1]*float64(size), rd[2]*float64(size), rd[3]*float64(size), 3, 52, 58, 66)
	}

	blocks := [][4]int{
		{225, 225, 18, 14}, {252, 222, 20, 16}, {278, 232, 16, 20},
		{228, 260, 22, 16}, {262, 266, 18, 18}, {110, 160, 16, 14},
		{132, 166, 14, 18}, {372, 326, 18, 14}, {396, 332, 16, 16},
	}
	for _, blk := range blocks {
		for py := blk[1]; py < blk[1]+blk[3]; py++ {
			for px := blk[0]; px < blk[0]+blk[2]; px++ {
				setPixel(px, py, 48, 56, 66)
			}
		}
	}

	step := size / 8
	for g := 1; g < 8; g++ {
		pos := g * step
		for i := 0; i < size; i++ {
			cH := img.NRGBAAt(i, pos)
			img.SetNRGBA(i, pos, color.NRGBA{R: clampByte(float64(cH.R) + 18), G: clampByte(float64(cH.G) + 22), B: clampByte(float64(cH.B) + 26), A: 255})
			cV := img.NRGBAAt(pos, i)
			img.SetNRGBA(pos, i, color.NRGBA{R: clampByte(float64(cV.R) + 18), G: clampByte(float64(cV.G) + 22), B: clampByte(float64(cV.B) + 26), A: 255})
		}
	}

	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func initMockImage() {
	once.Do(func() {
		mockPNGBytes = generateMockPNG(512)
		mockSignature = store.ComputeImageSignature(mockPNGBytes)
	})
}

func GetMockImageSignature() string {
	initMockImage()
	return mockSignature
}

type Provider struct {
	startTime time.Time
}

func NewProvider() *Provider {
	initMockImage()
	return &Provider{startTime: time.Now()}
}

func (p *Provider) GetMapInfo() map[string]any {
	return map[string]any{
		"valid":          true,
		"map_generation": 1,
		"map_min":        []float64{-1024.0, -1024.0},
		"map_max":        []float64{1024.0, 1024.0},
		"grid_size":      []float64{2048.0, 2048.0},
		"grid_steps":     []float64{256.0, 256.0},
		"grid_zero":      []float64{-1024.0, 1024.0},
		"hud_type":       0,
	}
}

func (p *Provider) GetMapImage() ([]byte, string) {
	initMockImage()
	return mockPNGBytes, "image/png"
}

func (p *Provider) GetMapObjects() []map[string]any {
	t := time.Since(p.startTime).Seconds()
	route := [][2]float64{
		{0.14, 0.83},
		{0.13, 0.60},
		{0.17, 0.36},
		{0.27, 0.21},
		{0.48, 0.17},
		{0.64, 0.26},
	}
	cycle := math.Mod(t, 28.0) / 28.0
	segFloat := cycle * float64(len(route)-1)
	idx := int(math.Min(float64(len(route)-2), math.Floor(segFloat)))
	frac := segFloat - float64(idx)
	p0, p1 := route[idx], route[idx+1]
	px := p0[0] + (p1[0]-p0[0])*frac
	py := p0[1] + (p1[1]-p0[1])*frac
	dx := p1[0] - p0[0]
	dy := p1[1] - p0[1]
	norm := math.Hypot(dx, dy)
	if norm < 1e-6 {
		norm = 1
	}

	return []map[string]any{
		{"type": "respawn_base_tank", "icon": "respawn_base_tank", "color": "#174DFF", "x": 0.14, "y": 0.84},
		{"type": "respawn_base_tank", "icon": "respawn_base_tank", "color": "#FF2020", "x": 0.86, "y": 0.16},
		{"type": "capture_zone", "icon": "capture_zone", "color": "#174DFF", "blink": 0, "x": 0.24, "y": 0.34},
		{"type": "capture_zone", "icon": "capture_zone", "color": "#FFFFFF", "blink": 1, "x": 0.50, "y": 0.50},
		{"type": "capture_zone", "icon": "capture_zone", "color": "#FF2020", "blink": 0, "x": 0.76, "y": 0.66},
		{
			"type": "ground_model", "icon": "Player", "color": "#FACC15",
			"x": math.Round(px*10000) / 10000, "y": math.Round(py*10000) / 10000,
			"dx": math.Round((dx/norm)*1000) / 1000, "dy": math.Round((dy/norm)*1000) / 1000,
		},
		{"type": "ground_model", "icon": "HeavyTank", "color": "#174DFF", "x": 0.43 + 0.015*math.Sin(t*0.5), "y": 0.53, "dx": 0.72, "dy": -0.69},
		{"type": "ground_model", "icon": "MediumTank", "color": "#174DFF", "x": 0.48, "y": 0.47 + 0.02*math.Cos(t*0.6), "dx": 0.80, "dy": -0.60},
		{"type": "ground_model", "icon": "MediumTank", "color": "#174DFF", "x": 0.34, "y": 0.39, "dx": 0.65, "dy": -0.76},
		{"type": "ground_model", "icon": "LightTank", "color": "#38BDF8", "x": 0.23, "y": 0.32 + 0.015*math.Sin(t*0.8), "dx": 0.40, "dy": -0.92},
		{"type": "ground_model", "icon": "TankDestroyer", "color": "#174DFF", "x": 0.39, "y": 0.60, "dx": 0.78, "dy": -0.62},
		{"type": "ground_model", "icon": "SPAA", "color": "#174DFF", "x": 0.20, "y": 0.76, "dx": 0.50, "dy": -0.86},
		{"type": "ground_model", "icon": "MediumTank", "color": "#FF2020", "blink": 1, "x": 0.61 + 0.03*math.Sin(t*0.4), "y": 0.29, "dx": -0.82, "dy": 0.57},
		{"type": "ground_model", "icon": "HeavyTank", "color": "#FF2020", "blink": 0, "x": 0.67, "y": 0.48 + 0.025*math.Cos(t*0.5), "dx": -0.70, "dy": 0.71},
	}
}

func (p *Provider) GetIndicators() map[string]any {
	t := time.Since(p.startTime).Seconds()
	speedMs := 14.5 + 3.2*math.Sin(t*0.7)
	return map[string]any{
		"valid": true,
		"army":  "tank",
		"type":  "us_m18_hellcat",
		"speed": math.Round(speedMs*100) / 100,
		"gear":  4,
	}
}
