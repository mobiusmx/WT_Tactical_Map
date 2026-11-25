"""Import ground maps and tactical routes from MrTreasure/war-thunder-workbench.

Fetches data/ground-maps.json, data/map-recommendations.json, and
data/map-recommendations/*.svg via sparse git clone (or --source-dir),
converts all vector paths to [0.0, 1.0] normalized coordinates, and writes
them into routes/routes_config.json via RouteStore (preserving backups and
existing custom/mock maps).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.route_store import RouteStore  # noqa: E402

DEFAULT_REPO_URL = "https://github.com/MrTreasure/war-thunder-workbench.git"
REFERENCE_LAYER_ID = "workbench_reference_routes"
REFERENCE_LAYER_NAME = "攻略参考走线"

LEGACY_TO_CANONICAL = {
    "advance_to_the_rhine": "avg_rheinland",
    "poland": "avg_poland",
    "normandy": "avg_normandy",
    "sinai": "avg_egypt_sinai",
    "abandoned_factory": "avg_abandoned_factory",
    "kuban": "avg_krymsk",
    "ardennes": "avg_ardennes",
}

HALO_STROKES = {"#10170e", "#091318", "#000000", "black"}

_PATH_TOKEN_RE = re.compile(
    r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?"
)


def _find_git_exe() -> str:
    found = shutil.which("git")
    if found:
        return found
    win_git = Path(r"C:\Program Files\Git\cmd\git.exe")
    if win_git.exists():
        return str(win_git)
    raise RuntimeError("git executable not found in PATH or C:\\Program Files\\Git\\cmd\\git.exe")


def _rmtree_force(path: Path) -> None:
    if not path.exists():
        return

    def _on_rm_error(func: Any, p: str, _exc: Any) -> None:
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onerror=_on_rm_error)


def _sparse_clone_workbench(repo_url: str, target_dir: Path) -> None:
    _rmtree_force(target_dir)
    git_exe = _find_git_exe()
    subprocess.run(
        [
            git_exe,
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--sparse",
            repo_url,
            str(target_dir),
        ],
        check=True,
    )
    subprocess.run(
        [
            git_exe,
            "-C",
            str(target_dir),
            "sparse-checkout",
            "set",
            "--no-cone",
            "data/ground-maps.json",
            "data/map-recommendations.json",
            "data/map-recommendations/*.svg",
        ],
        check=True,
    )


def _round4(value: float) -> float:
    return round(float(value), 4)


def _apply_matrix(
    x: float, y: float, matrix: list[float]
) -> tuple[float, float]:
    """Transform SVG pixel (x, y) into [0.0, 1.0] normalized map space."""
    a, b, c, d, e, f = matrix
    nx = (a * x + c * y + e) / 1000.0
    ny = (b * x + d * y + f) / 1000.0
    return nx, ny


def _sample_cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 6,
) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = (
            mt * mt * mt * p0[0]
            + 3 * mt * mt * t * p1[0]
            + 3 * mt * t * t * p2[0]
            + t * t * t * p3[0]
        )
        y = (
            mt * mt * mt * p0[1]
            + 3 * mt * mt * t * p1[1]
            + 3 * mt * t * t * p2[1]
            + t * t * t * p3[1]
        )
        pts.append((x, y))
    return pts


def _sample_quad(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    steps: int = 5,
) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def _parse_svg_path_d(d: str) -> list[tuple[list[tuple[float, float]], bool]]:
    """Parse an SVG path 'd' attribute into subpaths of (points, is_closed)."""
    tokens = _PATH_TOKEN_RE.findall(d or "")
    subpaths: list[tuple[list[tuple[float, float]], bool]] = []
    current_pts: list[tuple[float, float]] = []
    is_closed = False

    cx, cy = 0.0, 0.0
    sx, sy = 0.0, 0.0
    last_ctrl_cubic: tuple[float, float] | None = None
    last_ctrl_quad: tuple[float, float] | None = None
    last_cmd = ""

    i = 0
    n = len(tokens)

    def has_num(idx: int) -> bool:
        return idx < n and not tokens[idx].isalpha()

    def next_num() -> float:
        nonlocal i
        val = float(tokens[i])
        i += 1
        return val

    def flush_subpath() -> None:
        nonlocal current_pts, is_closed
        if current_pts:
            subpaths.append((current_pts, is_closed))
        current_pts = []
        is_closed = False

    cmd = ""
    while i < n:
        tok = tokens[i]
        if tok.isalpha():
            cmd = tok
            i += 1
            if cmd in ("Z", "z"):
                if current_pts:
                    is_closed = True
                    cx, cy = sx, sy
                    last_ctrl_cubic = None
                    last_ctrl_quad = None
                last_cmd = cmd
                continue
        elif not cmd:
            break

        if cmd in ("M", "m"):
            first = True
            while has_num(i):
                x = next_num()
                y = next_num()
                if cmd == "m":
                    x += cx
                    y += cy
                if first:
                    flush_subpath()
                    cx, cy = x, y
                    sx, sy = x, y
                    current_pts.append((cx, cy))
                    first = False
                else:
                    cx, cy = x, y
                    current_pts.append((cx, cy))
                last_ctrl_cubic = None
                last_ctrl_quad = None
            cmd = "L" if cmd == "M" else "l"
            last_cmd = cmd
        elif cmd in ("L", "l"):
            while has_num(i):
                x = next_num()
                y = next_num()
                if cmd == "l":
                    x += cx
                    y += cy
                cx, cy = x, y
                current_pts.append((cx, cy))
                last_ctrl_cubic = None
                last_ctrl_quad = None
            last_cmd = cmd
        elif cmd in ("H", "h"):
            while has_num(i):
                x = next_num()
                if cmd == "h":
                    x += cx
                cx = x
                current_pts.append((cx, cy))
                last_ctrl_cubic = None
                last_ctrl_quad = None
            last_cmd = cmd
        elif cmd in ("V", "v"):
            while has_num(i):
                y = next_num()
                if cmd == "v":
                    y += cy
                cy = y
                current_pts.append((cx, cy))
                last_ctrl_cubic = None
                last_ctrl_quad = None
            last_cmd = cmd
        elif cmd in ("C", "c"):
            while has_num(i):
                x1, y1, x2, y2, x, y = (
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                )
                if cmd == "c":
                    x1 += cx
                    y1 += cy
                    x2 += cx
                    y2 += cy
                    x += cx
                    y += cy
                current_pts.extend(_sample_cubic((cx, cy), (x1, y1), (x2, y2), (x, y)))
                last_ctrl_cubic = (x2, y2)
                last_ctrl_quad = None
                cx, cy = x, y
            last_cmd = cmd
        elif cmd in ("S", "s"):
            while has_num(i):
                x2, y2, x, y = next_num(), next_num(), next_num(), next_num()
                if cmd == "s":
                    x2 += cx
                    y2 += cy
                    x += cx
                    y += cy
                if last_cmd in ("C", "c", "S", "s") and last_ctrl_cubic is not None:
                    x1 = 2 * cx - last_ctrl_cubic[0]
                    y1 = 2 * cy - last_ctrl_cubic[1]
                else:
                    x1, y1 = cx, cy
                current_pts.extend(_sample_cubic((cx, cy), (x1, y1), (x2, y2), (x, y)))
                last_ctrl_cubic = (x2, y2)
                last_ctrl_quad = None
                cx, cy = x, y
                last_cmd = cmd
        elif cmd in ("Q", "q"):
            while has_num(i):
                x1, y1, x, y = next_num(), next_num(), next_num(), next_num()
                if cmd == "q":
                    x1 += cx
                    y1 += cy
                    x += cx
                    y += cy
                current_pts.extend(_sample_quad((cx, cy), (x1, y1), (x, y)))
                last_ctrl_quad = (x1, y1)
                last_ctrl_cubic = None
                cx, cy = x, y
            last_cmd = cmd
        elif cmd in ("T", "t"):
            while has_num(i):
                x, y = next_num(), next_num()
                if cmd == "t":
                    x += cx
                    y += cy
                if last_cmd in ("Q", "q", "T", "t") and last_ctrl_quad is not None:
                    x1 = 2 * cx - last_ctrl_quad[0]
                    y1 = 2 * cy - last_ctrl_quad[1]
                else:
                    x1, y1 = cx, cy
                current_pts.extend(_sample_quad((cx, cy), (x1, y1), (x, y)))
                last_ctrl_quad = (x1, y1)
                last_ctrl_cubic = None
                cx, cy = x, y
                last_cmd = cmd
        elif cmd in ("A", "a"):
            while has_num(i):
                _rx, _ry, _rot, _laf, _sf, x, y = (
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                    next_num(),
                )
                if cmd == "a":
                    x += cx
                    y += cy
                cx, cy = x, y
                current_pts.append((cx, cy))
                last_ctrl_cubic = None
                last_ctrl_quad = None
            last_cmd = cmd
        else:
            break

    flush_subpath()
    return subpaths


def _parse_points_attr(points_str: str) -> list[tuple[float, float]]:
    nums = [float(x) for x in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", points_str or "")]
    return [(nums[j], nums[j + 1]) for j in range(0, len(nums) - 1, 2)]


def _simplify_points(pts: list[tuple[float, float]], min_dist: float = 0.0005) -> list[list[float]]:
    out: list[list[float]] = []
    for x, y in pts:
        if not out or math.hypot(x - out[-1][0], y - out[-1][1]) >= min_dist:
            out.append([_round4(x), _round4(y)])
    if len(out) == 1 and len(pts) >= 2:
        out.append([_round4(pts[-1][0]), _round4(pts[-1][1])])
    return out


def _is_halo_element(attrib: dict[str, str]) -> bool:
    stroke = attrib.get("stroke", "").strip().lower()
    if stroke in HALO_STROKES:
        return True
    opacity_str = attrib.get("stroke-opacity", "").strip()
    if opacity_str and stroke.startswith("#"):
        try:
            if float(opacity_str) <= 0.6 and stroke in ("#10170e", "#091318", "#000000"):
                return True
        except ValueError:
            pass
    return False


def _local_tag(elem: ET.Element) -> str:
    tag = elem.tag
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _convert_svg_route(
    svg_path: Path,
    route_meta: dict[str, Any],
    stats: dict[str, Any],
) -> list[dict[str, Any]]:
    tree = ET.parse(svg_path)
    root = tree.getroot()
    matrix = route_meta.get("matrix")
    if not isinstance(matrix, list) or len(matrix) != 6:
        raise ValueError(f"Missing or invalid matrix in {route_meta.get('id')}")

    route_label = str(route_meta.get("label", "") or "").strip()
    elements: list[dict[str, Any]] = []
    primary_labeled = False

    def walk(node: ET.Element) -> None:
        nonlocal primary_labeled
        tag = _local_tag(node)
        if tag in ("defs", "marker", "title", "style"):
            return

        if tag == "g":
            if node.attrib.get("transform"):
                stats["group_transforms_seen"] += 1
            for child in node:
                walk(child)
            return

        if _is_halo_element(node.attrib):
            stats["halo_skipped"] += 1
            return

        stroke = node.attrib.get("stroke", "").strip()
        fill = node.attrib.get("fill", "").strip()
        color = stroke if stroke and stroke != "none" else (fill if fill and fill != "none" else "#38bdf8")
        has_arrow = bool(node.attrib.get("marker-end"))
        is_dashed = bool(node.attrib.get("stroke-dasharray"))

        subpaths: list[tuple[list[tuple[float, float]], bool]] = []
        if tag == "path":
            subpaths = _parse_svg_path_d(node.attrib.get("d", ""))
        elif tag == "line":
            x1 = float(node.attrib.get("x1", 0))
            y1 = float(node.attrib.get("y1", 0))
            x2 = float(node.attrib.get("x2", 0))
            y2 = float(node.attrib.get("y2", 0))
            subpaths = [([(x1, y1), (x2, y2)], False)]
        elif tag in ("polyline", "polygon"):
            pts = _parse_points_attr(node.attrib.get("points", ""))
            if len(pts) >= 2:
                subpaths = [(pts, tag == "polygon")]
        elif tag == "circle":
            cx = float(node.attrib.get("cx", 0))
            cy = float(node.attrib.get("cy", 0))
            r = float(node.attrib.get("r", 0))
            subpaths = [([(cx - r, cy - r), (cx + r, cy + r)], True)]
        elif tag == "ellipse":
            cx = float(node.attrib.get("cx", 0))
            cy = float(node.attrib.get("cy", 0))
            rx = float(node.attrib.get("rx", 0))
            ry = float(node.attrib.get("ry", 0))
            subpaths = [([(cx - rx, cy - ry), (cx + rx, cy + ry)], True)]
        elif tag == "rect":
            x = float(node.attrib.get("x", 0))
            y = float(node.attrib.get("y", 0))
            w = float(node.attrib.get("width", 0))
            h = float(node.attrib.get("height", 0))
            subpaths = [([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True)]
        else:
            if tag not in ("svg", "text", "tspan"):
                stats["unsupported_tags"][tag] = stats["unsupported_tags"].get(tag, 0) + 1
            for child in node:
                walk(child)
            return

        for raw_pts, closed in subpaths:
            if not raw_pts:
                continue
            norm_pts = [_apply_matrix(px, py, matrix) for px, py in raw_pts]
            for nx, ny in norm_pts:
                stats["min_x"] = min(stats["min_x"], nx)
                stats["max_x"] = max(stats["max_x"], nx)
                stats["min_y"] = min(stats["min_y"], ny)
                stats["max_y"] = max(stats["max_y"], ny)
                if nx < 0.0 or nx > 1.0 or ny < 0.0 or ny > 1.0:
                    stats["out_of_bounds_points"] += 1
                stats["total_points"] += 1

            if closed:
                xs = [p[0] for p in norm_pts]
                ys = [p[1] for p in norm_pts]
                min_x, max_x = min(xs), max(xs)
                min_y, max_y = min(ys), max(ys)
                cx = (min_x + max_x) / 2.0
                cy = (min_y + max_y) / 2.0
                span = max(max_x - min_x, max_y - min_y)
                if span < 0.025:
                    elements.append(
                        {
                            "kind": "marker",
                            "icon": "sniper",
                            "color": color,
                            "label": "",
                            "point": [_round4(cx), _round4(cy)],
                        }
                    )
                    stats["markers"] += 1
                else:
                    elements.append(
                        {
                            "kind": "zone",
                            "color": color,
                            "label": "",
                            "point": [_round4(cx), _round4(cy)],
                            "radius": _round4(span / 2.0),
                        }
                    )
                    stats["zones"] += 1
            else:
                simplified = _simplify_points(norm_pts)
                if len(simplified) < 2:
                    continue
                lbl = ""
                if not primary_labeled and route_label:
                    lbl = route_label
                    primary_labeled = True
                elements.append(
                    {
                        "kind": "polyline",
                        "arrow": has_arrow,
                        "dashed": is_dashed,
                        "width": 3,
                        "color": color,
                        "label": lbl,
                        "points": simplified,
                    }
                )
                stats["polylines"] += 1

    walk(root)
    return elements


def _extract_physical_hint(gm_map: dict[str, Any]) -> dict[str, Any] | None:
    bounds = gm_map.get("bounds")
    if not (isinstance(bounds, list) and len(bounds) == 2):
        return None
    p0, p1 = bounds[0], bounds[1]
    if not (isinstance(p0, list) and isinstance(p1, list) and len(p0) >= 2 and len(p1) >= 2):
        return None
    hint: dict[str, Any] = {
        "map_min": [round(float(p0[0]), 3), round(float(p0[1]), 3)],
        "map_max": [round(float(p1[0]), 3), round(float(p1[1]), 3)],
        "width_m": round(abs(float(p1[0]) - float(p0[0])), 2),
        "height_m": round(abs(float(p1[1]) - float(p0[1])), 2),
    }

    raw_params = (gm_map.get("grid") or {}).get("raw_grid_parameters") or []
    for pair in raw_params:
        if isinstance(pair, list) and len(pair) == 2:
            key, val = pair[0], pair[1]
            if key == "tankGridSteps" and isinstance(val, list) and len(val) >= 2:
                hint["grid_steps"] = [round(float(val[0]), 3), round(float(val[1]), 3)]
            elif key == "tankGridSize" and isinstance(val, list) and len(val) >= 2:
                hint["grid_size"] = [round(float(val[0]), 3), round(float(val[1]), 3)]
    return hint


def _format_display_name(gm_map: dict[str, Any]) -> str:
    cn = str(gm_map.get("name", "") or "").strip()
    en = str(gm_map.get("english", "") or "").strip()
    mid = str(gm_map.get("id", "") or "").strip()
    if en and en != mid and en != cn:
        return f"{cn} ({en})" if cn else en
    return cn or mid


def _migrate_legacy_stubs(maps_dict: dict[str, Any], valid_canonical_ids: set[str]) -> int:
    migrated_count = 0
    for legacy_id, canonical_id in LEGACY_TO_CANONICAL.items():
        if legacy_id not in maps_dict or canonical_id not in valid_canonical_ids:
            continue
        legacy_entry = maps_dict[legacy_id]
        canon_entry = maps_dict[canonical_id]

        # Preserve any user-bound signatures, physical hints, or png layers
        for sig in legacy_entry.get("signatures", []):
            if sig and sig not in canon_entry.setdefault("signatures", []):
                canon_entry["signatures"].append(sig)
        for hint in legacy_entry.get("physical_hints", []):
            if hint and hint not in canon_entry.setdefault("physical_hints", []):
                canon_entry["physical_hints"].append(hint)
        for png in legacy_entry.get("png_layers", []):
            if png and png not in canon_entry.setdefault("png_layers", []):
                canon_entry["png_layers"].append(png)

        # Preserve any non-empty custom vector layers
        for vlayer in legacy_entry.get("vector_layers", []):
            if isinstance(vlayer, dict) and vlayer.get("elements"):
                existing_ids = {l.get("id") for l in canon_entry.get("vector_layers", [])}
                if vlayer.get("id") not in existing_ids:
                    canon_entry.setdefault("vector_layers", []).append(vlayer)

        del maps_dict[legacy_id]
        migrated_count += 1
    return migrated_count


def run_import(source_dir: Path, dry_run: bool = False) -> dict[str, Any]:
    gm_path = source_dir / "data" / "ground-maps.json"
    rec_path = source_dir / "data" / "map-recommendations.json"
    svg_dir = source_dir / "data" / "map-recommendations"

    gm_data = json.loads(gm_path.read_text(encoding="utf-8"))
    rec_data = json.loads(rec_path.read_text(encoding="utf-8"))

    gm_maps = gm_data.get("maps", [])
    rec_routes = rec_data.get("routes", [])

    # Convert all SVG routes grouped by mapId
    stats: dict[str, Any] = {
        "maps_imported": 0,
        "layouts_total": 0,
        "routes_total": len(rec_routes),
        "routes_imported": 0,
        "maps_with_routes": 0,
        "polylines": 0,
        "markers": 0,
        "zones": 0,
        "halo_skipped": 0,
        "group_transforms_seen": 0,
        "unsupported_tags": {},
        "min_x": 999.0,
        "max_x": -999.0,
        "min_y": 999.0,
        "max_y": -999.0,
        "total_points": 0,
        "out_of_bounds_points": 0,
        "point_errors": [],
        "legacy_deduped": 0,
    }

    routes_by_map: dict[str, list[dict[str, Any]]] = {}
    for route in rec_routes:
        svg_file = svg_dir / str(route.get("svg", ""))
        if not svg_file.exists():
            continue
        els = _convert_svg_route(svg_file, route, stats)
        if els:
            map_id = str(route["mapId"])
            routes_by_map.setdefault(map_id, []).extend(els)
            stats["routes_imported"] += 1
        if isinstance(route.get("pointError"), (int, float)):
            stats["point_errors"].append(float(route["pointError"]))

    store = RouteStore(BASE_DIR)
    config = store.load()
    maps_dict = config.setdefault("maps", {})

    canonical_ids: set[str] = set()
    for gm_map in gm_maps:
        map_id = str(gm_map["id"])
        canonical_ids.add(map_id)
        stats["maps_imported"] += 1
        layouts = gm_map.get("layouts", [])
        stats["layouts_total"] += len(layouts)

        existing = maps_dict.get(map_id, {})
        existing_sigs = list(existing.get("signatures", []))
        existing_hints = list(existing.get("physical_hints", []))
        existing_pngs = list(existing.get("png_layers", []))
        existing_v_layers = [
            l
            for l in existing.get("vector_layers", [])
            if isinstance(l, dict) and l.get("id") != REFERENCE_LAYER_ID
        ]

        hint = _extract_physical_hint(gm_map)
        if hint and hint not in existing_hints:
            existing_hints.append(hint)

        ref_elements = routes_by_map.get(map_id, [])
        vector_layers: list[dict[str, Any]] = []
        if ref_elements:
            stats["maps_with_routes"] += 1
            vector_layers.append(
                {
                    "id": REFERENCE_LAYER_ID,
                    "name": REFERENCE_LAYER_NAME,
                    "category": "reference",
                    "color": "#38bdf8",
                    "visible": True,
                    "elements": ref_elements,
                }
            )
        vector_layers.extend(existing_v_layers)

        if not vector_layers:
            vector_layers = [
                {
                    "id": "opening_flank",
                    "name": "开局抢点绕后线",
                    "category": "flank",
                    "color": "#00e5ff",
                    "visible": True,
                    "elements": [],
                }
            ]

        maps_dict[map_id] = {
            "name": _format_display_name(gm_map),
            "signatures": existing_sigs,
            "physical_hints": existing_hints,
            "png_layers": existing_pngs,
            "vector_layers": vector_layers,
            "workbench_meta": {
                "layouts_count": len(layouts),
                "layouts": [
                    {
                        "id": str(l.get("id", "")),
                        "name": str(l.get("name", "")),
                        "postfix": str(l.get("postfix", "")),
                    }
                    for l in layouts
                ],
                "guides": gm_map.get("guides", []),
                "assets": {
                    "base_url": (gm_map.get("base") or {}).get("url"),
                    "contour_url": (gm_map.get("contourImage") or {}).get("url"),
                    "thumbnail_urls": [
                        t.get("image", {}).get("url")
                        for t in gm_map.get("thumbnails", [])
                        if isinstance(t, dict) and isinstance(t.get("image"), dict)
                    ],
                },
            },
        }

    stats["legacy_deduped"] = _migrate_legacy_stubs(maps_dict, canonical_ids)

    if not dry_run:
        store.save(config)

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Import maps and routes from war-thunder-workbench")
    parser.add_argument("--source-dir", type=Path, help="Use an existing local clone instead of cloning")
    parser.add_argument("--repo-url", default=DEFAULT_REPO_URL)
    parser.add_argument("--keep-cache", action="store_true", help="Keep temporary cloned repository")
    parser.add_argument("--dry-run", action="store_true", help="Analyze without writing routes_config.json")
    args = parser.parse_args()

    tmp_dir = BASE_DIR / "scripts" / "_tmp_workbench"
    src_dir = args.source_dir
    created_tmp = False

    try:
        if src_dir is None:
            print(f"[import] 正在稀疏克隆 {args.repo_url} ...")
            _sparse_clone_workbench(args.repo_url, tmp_dir)
            src_dir = tmp_dir
            created_tmp = True

        stats = run_import(src_dir, dry_run=args.dry_run)
        errs = stats.pop("point_errors", [])
        avg_err = round(sum(errs) / len(errs), 6) if errs else 0.0
        max_err = round(max(errs), 6) if errs else 0.0
        stats["point_error_avg"] = avg_err
        stats["point_error_max"] = max_err

        print("[import] 导入完成:", json.dumps(stats, ensure_ascii=False, indent=2))
    finally:
        if created_tmp and not args.keep_cache:
            _rmtree_force(tmp_dir)


if __name__ == "__main__":
    main()
