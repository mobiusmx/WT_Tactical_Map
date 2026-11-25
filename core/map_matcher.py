"""Map fingerprinting and matching utilities for War Thunder 8111 map data."""

from __future__ import annotations

import hashlib
from typing import Any


def compute_image_signature(img_bytes: bytes) -> str:
    """Return the first 16 hex characters of the SHA-256 hash of map image bytes."""
    if not img_bytes:
        return ""
    return hashlib.sha256(img_bytes).hexdigest()[:16]


def _safe_float_pair(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        try:
            return [round(float(value[0]), 3), round(float(value[1]), 3)]
        except (TypeError, ValueError):
            return None
    return None


def extract_physical_hint(map_info: dict[str, Any] | None) -> dict[str, Any]:
    """Extract normalized physical dimension metadata from /map_info.json."""
    if not isinstance(map_info, dict):
        return {}

    map_min = _safe_float_pair(map_info.get("map_min"))
    map_max = _safe_float_pair(map_info.get("map_max"))
    grid_size = _safe_float_pair(map_info.get("grid_size"))
    grid_steps = _safe_float_pair(map_info.get("grid_steps"))
    grid_zero = _safe_float_pair(map_info.get("grid_zero"))

    hint: dict[str, Any] = {}
    if map_min is not None:
        hint["map_min"] = map_min
    if map_max is not None:
        hint["map_max"] = map_max
    if grid_size is not None:
        hint["grid_size"] = grid_size
    if grid_steps is not None:
        hint["grid_steps"] = grid_steps
    if grid_zero is not None:
        hint["grid_zero"] = grid_zero

    if map_min is not None and map_max is not None:
        hint["width_m"] = round(abs(map_max[0] - map_min[0]), 2)
        hint["height_m"] = round(abs(map_max[1] - map_min[1]), 2)

    return hint


def _physical_similarity(current_hint: dict[str, Any], saved_hint: dict[str, Any]) -> int:
    """Compute similarity score between two physical hints (max 4)."""
    if not current_hint or not saved_hint:
        return 0
    score = 0
    for key in ("map_min", "map_max", "grid_steps", "grid_size"):
        if key in current_hint and key in saved_hint and current_hint[key] == saved_hint[key]:
            score += 1
    return score


def match_map(
    signature: str,
    map_info: dict[str, Any] | None,
    routes_config: dict[str, Any],
) -> dict[str, Any]:
    """Match the current map image signature and physical hints against known maps."""
    maps = routes_config.get("maps", {}) if isinstance(routes_config, dict) else {}
    current_hint = extract_physical_hint(map_info)

    # 1. Exact SHA-256 signature match
    if signature:
        for map_id, entry in maps.items():
            if not isinstance(entry, dict):
                continue
            signatures = entry.get("signatures", [])
            if isinstance(signatures, list) and signature in signatures:
                return {
                    "matched_id": map_id,
                    "match_type": "exact",
                    "candidates": [
                        {
                            "map_id": map_id,
                            "name": entry.get("name", map_id),
                            "score": 100,
                        }
                    ],
                }

    # 2. Physical hint fallback for candidate suggestions
    candidates: list[dict[str, Any]] = []
    full_physical_hits: list[str] = []

    for map_id, entry in maps.items():
        if not isinstance(entry, dict):
            continue
        best_score = 0
        for saved_hint in entry.get("physical_hints", []):
            if isinstance(saved_hint, dict):
                best_score = max(best_score, _physical_similarity(current_hint, saved_hint))
        if best_score > 0:
            candidates.append(
                {
                    "map_id": map_id,
                    "name": entry.get("name", map_id),
                    "score": best_score,
                }
            )
            if best_score >= 3:
                full_physical_hits.append(map_id)

    candidates.sort(key=lambda item: (-item["score"], item["name"]))

    if len(full_physical_hits) == 1:
        return {
            "matched_id": full_physical_hits[0],
            "match_type": "physical",
            "candidates": candidates,
        }

    return {
        "matched_id": None,
        "match_type": "none",
        "candidates": candidates,
    }
