"""Live diagnostic tool to inspect War Thunder 8111 /map_obj.json objects and roles.

Usage:
    python scripts/inspect_8111_objects.py
    python scripts/inspect_8111_objects.py --watch 20
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.wt_client import _classify_object  # noqa: E402


def fetch_map_objects(host: str = "http://127.0.0.1:8111") -> list[dict[str, Any]]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(f"{host.rstrip('/')}/map_obj.json", headers={"Accept": "application/json"})
    with opener.open(req, timeout=1.0) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
    return data if isinstance(data, list) else []


def print_snapshot(objects: list[dict[str, Any]]) -> None:
    role_counts: dict[str, int] = {}
    interesting: list[dict[str, Any]] = []

    for obj in objects:
        if not isinstance(obj, dict):
            continue
        classified = _classify_object(obj)
        role = classified.get("role", "other")
        role_counts[role] = role_counts.get(role, 0) + 1
        blink = int(obj.get("blink", 0) or 0) if str(obj.get("blink", "")).lstrip("-").isdigit() else 0
        if role in ("enemy", "ping", "other") or blink > 0:
            interesting.append(classified)

    print(f"[8111] 共 {len(objects)} 个对象 | 分类统计: {json.dumps(role_counts, ensure_ascii=False)}")
    if not interesting:
        print("[8111] 当前未检测到敌军(enemy)、报点(ping)、闪烁(blink>0)或未分类(other)对象。")
        return

    print(f"[8111] 关键对象 ({len(interesting)}):")
    for item in interesting:
        print("  ", json.dumps(item, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect live 8111 /map_obj.json objects")
    parser.add_argument("--host", default="http://127.0.0.1:8111")
    parser.add_argument("--watch", type=float, default=0.0, help="Monitor continuously for N seconds (4Hz)")
    args = parser.parse_args()

    if args.watch <= 0:
        objs = fetch_map_objects(args.host)
        print_snapshot(objs)
        return

    deadline = time.monotonic() + args.watch
    seen_keys: set[str] = set()
    print(f"[8111] 持续监听 {args.watch:.0f}s 中（4Hz）... 对局中出现敌军/侦察/队友标点时将立即打印：")
    while time.monotonic() < deadline:
        try:
            objs = fetch_map_objects(args.host)
        except Exception as exc:
            print(f"[8111] 请求失败: {exc}")
            time.sleep(0.5)
            continue

        for obj in objs:
            if not isinstance(obj, dict):
                continue
            classified = _classify_object(obj)
            role = classified.get("role")
            blink = classified.get("blink", 0)
            if role in ("enemy", "ping", "other") or (isinstance(blink, int) and blink > 0):
                sig = json.dumps(
                    {
                        "role": role,
                        "type": obj.get("type"),
                        "icon": obj.get("icon"),
                        "color": obj.get("color"),
                        "blink": blink,
                        "x": round(float(obj["x"]), 3) if isinstance(obj.get("x"), (int, float)) else None,
                        "y": round(float(obj["y"]), 3) if isinstance(obj.get("y"), (int, float)) else None,
                    },
                    sort_keys=True,
                    ensure_ascii=False,
                )
                if sig not in seen_keys:
                    seen_keys.add(sig)
                    print(f"[{time.strftime('%H:%M:%S')}] {json.dumps(classified, ensure_ascii=False)}")
        time.sleep(0.25)


if __name__ == "__main__":
    main()
