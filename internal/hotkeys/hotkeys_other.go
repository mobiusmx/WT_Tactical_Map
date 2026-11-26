//go:build !windows

package hotkeys

import (
	"fmt"
	"sync"
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
	return map[string]any{
		"seq":            q.seq,
		"actions":        cp,
		"global_hotkeys": false,
		"backend":        nil,
	}
}

func StartGlobalNumpadListener(q *TargetControlQueue) func() {
	return func() {}
}
