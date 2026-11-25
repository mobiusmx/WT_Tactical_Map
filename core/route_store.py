"""Persistent storage and automatic backup manager for tactical routes and map bindings."""

from __future__ import annotations

import copy
import json
import os
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from core.mock_provider import get_mock_image_signature

MAX_BACKUP_FILES = 30


def _build_default_config() -> dict[str, Any]:
    """Build initial routes_config.json with preset maps and mock demo routes."""
    preset_maps = {
        "advance_to_the_rhine": "莱茵河畔 (Advance to the Rhine)",
        "poland": "波兰 (Poland)",
        "normandy": "诺曼底 (Normandy)",
        "sinai": "西奈 (Sinai)",
        "abandoned_factory": "废弃工厂 (Abandoned Factory)",
        "kuban": "库班 (Kuban)",
        "ardennes": "阿登 (Ardennes)",
    }

    maps: dict[str, Any] = {}
    for map_id, display_name in preset_maps.items():
        maps[map_id] = {
            "name": display_name,
            "signatures": [],
            "physical_hints": [],
            "png_layers": [],
            "vector_layers": [
                {
                    "id": "opening_flank",
                    "name": "开局抢点绕后线",
                    "category": "flank",
                    "color": "#00e5ff",
                    "visible": True,
                    "elements": [],
                },
                {
                    "id": "endgame_rotate",
                    "name": "残局转移线",
                    "category": "rotate",
                    "color": "#f59e0b",
                    "visible": False,
                    "elements": [],
                },
            ],
        }

    maps["mock_tactical_arena"] = {
        "name": "模拟演习场 (Mock Arena)",
        "signatures": [get_mock_image_signature()],
        "physical_hints": [
            {
                "map_min": [-1024.0, -1024.0],
                "map_max": [1024.0, 1024.0],
                "grid_size": [2048.0, 2048.0],
                "grid_steps": [256.0, 256.0],
                "grid_zero": [-1024.0, 1024.0],
                "width_m": 2048.0,
                "height_m": 2048.0,
            }
        ],
        "png_layers": [],
        "vector_layers": [
            {
                "id": "opening_flank",
                "name": "开局抢点绕后线",
                "category": "flank",
                "color": "#00e5ff",
                "visible": True,
                "elements": [
                    {
                        "kind": "polyline",
                        "arrow": True,
                        "dashed": False,
                        "width": 3,
                        "label": "轻坦开局绕后偷侧",
                        "points": [
                            [0.14, 0.83],
                            [0.13, 0.60],
                            [0.17, 0.36],
                            [0.27, 0.21],
                            [0.48, 0.17],
                            [0.64, 0.26],
                        ],
                    }
                ],
            },
            {
                "id": "endgame_rotate",
                "name": "残局转移线",
                "category": "rotate",
                "color": "#f59e0b",
                "visible": False,
                "elements": [
                    {
                        "kind": "polyline",
                        "arrow": True,
                        "dashed": True,
                        "width": 3,
                        "label": "侧翼转中路支援",
                        "points": [
                            [0.24, 0.35],
                            [0.36, 0.44],
                            [0.49, 0.50],
                            [0.65, 0.58],
                        ],
                    }
                ],
            },
            {
                "id": "key_positions",
                "name": "常规卡点与高危交火区",
                "category": "positions",
                "color": "#ef4444",
                "visible": True,
                "elements": [
                    {
                        "kind": "marker",
                        "icon": "sniper",
                        "label": "常规架枪位",
                        "point": [0.35, 0.39],
                    },
                    {
                        "kind": "marker",
                        "icon": "sniper",
                        "label": "防绕后监视点",
                        "point": [0.62, 0.30],
                    },
                    {
                        "kind": "zone",
                        "label": "高危交火区",
                        "point": [0.50, 0.50],
                        "radius": 0.085,
                    },
                ],
            },
        ],
    }

    return {"version": 1, "maps": maps}


class RouteStore:
    """Thread-safe JSON storage for map signatures, vector routes, and PNG overlay metadata."""

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)
        self.routes_dir = self.base_dir / "routes"
        self.overlays_dir = self.routes_dir / "overlays"
        self.backups_dir = self.routes_dir / "backups"
        self.config_path = self.routes_dir / "routes_config.json"
        self._lock = threading.Lock()

        self.routes_dir.mkdir(parents=True, exist_ok=True)
        self.overlays_dir.mkdir(parents=True, exist_ok=True)
        self.backups_dir.mkdir(parents=True, exist_ok=True)

        if not self.config_path.exists():
            self._write_atomic(_build_default_config(), create_backup=False)

    def load(self) -> dict[str, Any]:
        with self._lock:
            with self.config_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict) or not isinstance(data.get("maps"), dict):
                data = _build_default_config()
            return copy.deepcopy(data)

    def _prune_old_backups(self) -> None:
        backups = sorted(
            self.backups_dir.glob("routes_config.bak-*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for obsolete in backups[MAX_BACKUP_FILES:]:
            try:
                obsolete.unlink()
            except OSError:
                pass

    def _write_atomic(self, config: dict[str, Any], create_backup: bool = True) -> None:
        if create_backup and self.config_path.exists():
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            backup_path = self.backups_dir / f"routes_config.bak-{stamp}.json"
            shutil.copy2(self.config_path, backup_path)
            self._prune_old_backups()

        tmp_path = self.config_path.with_suffix(".json.tmp")
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(config, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp_path, self.config_path)

    def save(self, config: dict[str, Any]) -> None:
        with self._lock:
            self._write_atomic(config, create_backup=True)

    def save_map_layers(
        self,
        map_id: str,
        vector_layers: list[dict[str, Any]],
        png_layers: list[dict[str, Any]] | None = None,
        map_name: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            with self.config_path.open("r", encoding="utf-8") as fh:
                config = json.load(fh)
            maps = config.setdefault("maps", {})
            entry = maps.setdefault(
                map_id,
                {
                    "name": map_name or map_id,
                    "signatures": [],
                    "physical_hints": [],
                    "png_layers": [],
                    "vector_layers": [],
                },
            )
            if map_name:
                entry["name"] = map_name
            entry["vector_layers"] = vector_layers
            if png_layers is not None:
                entry["png_layers"] = png_layers
            self._write_atomic(config, create_backup=True)
            return copy.deepcopy(entry)

    def bind_signature(
        self,
        map_id: str,
        signature: str,
        physical_hint: dict[str, Any] | None = None,
        map_name: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            with self.config_path.open("r", encoding="utf-8") as fh:
                config = json.load(fh)
            maps = config.setdefault("maps", {})

            if signature:
                for other_entry in maps.values():
                    if isinstance(other_entry, dict) and isinstance(
                        other_entry.get("signatures"), list
                    ):
                        other_entry["signatures"] = [
                            s for s in other_entry["signatures"] if s != signature
                        ]

            entry = maps.setdefault(
                map_id,
                {
                    "name": map_name or map_id,
                    "signatures": [],
                    "physical_hints": [],
                    "png_layers": [],
                    "vector_layers": [],
                },
            )
            if map_name:
                entry["name"] = map_name
            if signature and signature not in entry.setdefault("signatures", []):
                entry["signatures"].append(signature)
            if physical_hint:
                hints = entry.setdefault("physical_hints", [])
                if physical_hint not in hints:
                    hints.append(physical_hint)

            self._write_atomic(config, create_backup=True)
            return copy.deepcopy(config)

    def create_map(
        self,
        map_id: str,
        name: str,
        signature: str = "",
        physical_hint: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            with self.config_path.open("r", encoding="utf-8") as fh:
                config = json.load(fh)
            maps = config.setdefault("maps", {})
            if map_id in maps:
                raise ValueError(f"Map ID already exists: {map_id}")

            if signature:
                for other_entry in maps.values():
                    if isinstance(other_entry, dict) and isinstance(
                        other_entry.get("signatures"), list
                    ):
                        other_entry["signatures"] = [
                            s for s in other_entry["signatures"] if s != signature
                        ]

            maps[map_id] = {
                "name": name,
                "signatures": [signature] if signature else [],
                "physical_hints": [physical_hint] if physical_hint else [],
                "png_layers": [],
                "vector_layers": [
                    {
                        "id": "opening_flank",
                        "name": "开局抢点绕后线",
                        "category": "flank",
                        "color": "#00e5ff",
                        "visible": True,
                        "elements": [],
                    }
                ],
            }
            self._write_atomic(config, create_backup=True)
            return copy.deepcopy(config)

    def list_overlay_pngs(self) -> list[str]:
        if not self.overlays_dir.exists():
            return []
        files = sorted(
            f.name
            for f in self.overlays_dir.iterdir()
            if f.is_file() and f.suffix.lower() == ".png"
        )
        return [f"overlays/{name}" for name in files]
