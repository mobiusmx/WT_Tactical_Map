//go:build windows

package hotkeys

import (
	"fmt"
	"sync"
	"syscall"
	"time"
)

type ActionItem struct {
	Seq    int     `json:"seq"`
	Action string  `json:"action"`
	Ts     float64 `json:"ts"`
}

type TargetControlQueue struct {
	mu      sync.Mutex
	seq     int
	actions []ActionItem
	backend string
}

func NewTargetControlQueue() *TargetControlQueue {
	return &TargetControlQueue{actions: make([]ActionItem, 0, 32)}
}

func (q *TargetControlQueue) Push(action string) (int, error) {
	if action != "next" && action != "prev" && action != "clear" {
		return 0, fmt.Errorf("invalid target action: %s", action)
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.seq++
	q.actions = append(q.actions, ActionItem{
		Seq:    q.seq,
		Action: action,
		Ts:     float64(time.Now().UnixNano()) / 1e9,
	})
	if len(q.actions) > 32 {
		q.actions = append([]ActionItem(nil), q.actions[len(q.actions)-32:]...)
	}
	return q.seq, nil
}

func (q *TargetControlQueue) Snapshot() map[string]any {
	q.mu.Lock()
	defer q.mu.Unlock()
	cp := make([]ActionItem, len(q.actions))
	copy(cp, q.actions)
	var backend any
	if q.backend != "" {
		backend = q.backend
	}
	return map[string]any{
		"seq":            q.seq,
		"actions":        cp,
		"global_hotkeys": q.backend != "",
		"backend":        backend,
	}
}

func StartGlobalNumpadListener(q *TargetControlQueue) func() {
	user32 := syscall.NewLazyDLL("user32.dll")
	getAsyncKeyState := user32.NewProc("GetAsyncKeyState")
	if err := getAsyncKeyState.Find(); err != nil {
		fmt.Println("[WT Tactical Map] 全局小键盘热键不可用，已优雅降级:", err)
		return func() {}
	}

	vkMap := map[uintptr]string{
		0x6B: "next",  // VK_ADD (Numpad +)
		0x64: "next",  // VK_NUMPAD4
		0x6D: "prev",  // VK_SUBTRACT (Numpad -)
		0x61: "prev",  // VK_NUMPAD1
		0x6F: "clear", // VK_DIVIDE (Numpad /)
		0x60: "clear", // VK_NUMPAD0
	}

	q.mu.Lock()
	q.backend = "win32_GetAsyncKeyState"
	q.mu.Unlock()
	fmt.Println("[WT Tactical Map] 全局小键盘热键已启用 (Win32): +/4 下一个, -/1 上一个, //0 取消锁定")

	stopCh := make(chan struct{})
	prevDown := make(map[uintptr]bool, len(vkMap))

	go func() {
		ticker := time.NewTicker(40 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				for vk, action := range vkMap {
					r1, _, _ := getAsyncKeyState.Call(vk)
					down := (r1 & 0x8000) != 0
					if down && !prevDown[vk] {
						_, _ = q.Push(action)
					}
					prevDown[vk] = down
				}
			}
		}
	}()

	return func() {
		close(stopCh)
	}
}
