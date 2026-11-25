"""Offline mock 8111 telemetry and tactical map generator for testing without the game."""

from __future__ import annotations

import math
import struct
import time
import zlib
from typing import Any

from core.map_matcher import compute_image_signature


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = chunk_type + data
    crc = zlib.crc32(chunk) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)


def _generate_mock_map_png(size: int = 512) -> bytes:
    """Generate a deterministic dark tactical map PNG using Python stdlib only."""
    # RGB framebuffer initialized with deep tactical slate
    buf = bytearray(size * size * 3)
    base_r, base_g, base_b = 22, 30, 38

    def set_pixel(x: int, y: int, r: int, g: int, b: int) -> None:
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 3
            buf[idx] = r
            buf[idx + 1] = g
            buf[idx + 2] = b

    def fill_rect(x0: int, y0: int, w: int, h: int, r: int, g: int, b: int) -> None:
        x1 = min(size, max(0, x0 + w))
        y1 = min(size, max(0, y0 + h))
        x0c = max(0, x0)
        y0c = max(0, y0)
        for py in range(y0c, y1):
            row_start = py * size * 3
            for px in range(x0c, x1):
                idx = row_start + px * 3
                buf[idx] = r
                buf[idx + 1] = g
                buf[idx + 2] = b

    def draw_thick_line(
        x0: float, y0: float, x1: float, y1: float, radius: int, r: int, g: int, b: int
    ) -> None:
        steps = max(int(math.hypot(x1 - x0, y1 - y0) * 1.5), 1)
        for i in range(steps + 1):
            t = i / steps
            cx = int(x0 + (x1 - x0) * t)
            cy = int(y0 + (y1 - y0) * t)
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if dx * dx + dy * dy <= radius * radius + 1:
                        set_pixel(cx + dx, cy + dy, r, g, b)

    # Background + subtle contour bands
    for y in range(size):
        row_start = y * size * 3
        for x in range(size):
            # Soft elevation variation
            elev = math.sin(x * 0.018) * math.cos(y * 0.015) + math.sin((x + y) * 0.01) * 0.5
            delta = int(elev * 6)
            idx = row_start + x * 3
            buf[idx] = max(12, min(48, base_r + delta))
            buf[idx + 1] = max(16, min(56, base_g + delta))
            buf[idx + 2] = max(20, min(64, base_b + delta))

    # Winding river from top-center-right toward bottom-left
    river_points: list[tuple[float, float]] = []
    for i in range(90):
        t = i / 89.0
        rx = size * (0.78 - 0.56 * t + 0.06 * math.sin(t * math.pi * 2.5))
        ry = size * (0.0 + 1.0 * t)
        river_points.append((rx, ry))
    for i in range(len(river_points) - 1):
        draw_thick_line(
            river_points[i][0],
            river_points[i][1],
            river_points[i + 1][0],
            river_points[i + 1][1],
            11,
            18,
            46,
            68,
        )

    # Main tactical road network
    roads = [
        ((0.14, 0.84), (0.24, 0.34)),
        ((0.24, 0.34), (0.50, 0.50)),
        ((0.50, 0.50), (0.76, 0.66)),
        ((0.76, 0.66), (0.86, 0.16)),
        ((0.14, 0.84), (0.50, 0.50)),
        ((0.50, 0.50), (0.86, 0.16)),
        ((0.24, 0.34), (0.52, 0.18)),
        ((0.52, 0.18), (0.86, 0.16)),
    ]
    for (ax, ay), (bx, by) in roads:
        draw_thick_line(ax * size, ay * size, bx * size, by * size, 3, 52, 58, 66)

    # Town blocks near central capture point B and west ridge
    blocks = [
        (225, 225, 18, 14),
        (252, 222, 20, 16),
        (278, 232, 16, 20),
        (228, 260, 22, 16),
        (262, 266, 18, 18),
        (110, 160, 16, 14),
        (132, 166, 14, 18),
        (372, 326, 18, 14),
        (396, 332, 16, 16),
    ]
    for bx, by, bw, bh in blocks:
        fill_rect(bx, by, bw, bh, 48, 56, 66)

    # 8x8 tactical grid overlay
    step = size // 8
    for g in range(1, 8):
        pos = g * step
        for i in range(size):
            # Horizontal grid line
            idx_h = (pos * size + i) * 3
            buf[idx_h] = min(255, buf[idx_h] + 18)
            buf[idx_h + 1] = min(255, buf[idx_h + 1] + 22)
            buf[idx_h + 2] = min(255, buf[idx_h + 2] + 26)
            # Vertical grid line
            idx_v = (i * size + pos) * 3
            buf[idx_v] = min(255, buf[idx_v] + 18)
            buf[idx_v + 1] = min(255, buf[idx_v + 1] + 22)
            buf[idx_v + 2] = min(255, buf[idx_v + 2] + 26)

    # Encode RGB framebuffer into PNG scanlines (filter type 0 per row)
    raw_rows = bytearray()
    stride = size * 3
    for y in range(size):
        raw_rows.append(0)
        start = y * stride
        raw_rows.extend(buf[start : start + stride])

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), level=6)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


_MOCK_PNG_BYTES: bytes = _generate_mock_map_png()
_MOCK_SIGNATURE: str = compute_image_signature(_MOCK_PNG_BYTES)


def get_mock_image_signature() -> str:
    """Return the deterministic SHA-256 prefix of the mock map image."""
    return _MOCK_SIGNATURE


class MockProvider:
    """Provides simulated War Thunder 8111 API responses for offline development and demos."""

    def __init__(self) -> None:
        self._start_time = time.monotonic()

    def get_map_info(self) -> dict[str, Any]:
        return {
            "valid": True,
            "map_generation": 1,
            "map_min": [-1024.0, -1024.0],
            "map_max": [1024.0, 1024.0],
            "grid_size": [2048.0, 2048.0],
            "grid_steps": [256.0, 256.0],
            "grid_zero": [-1024.0, 1024.0],
            "hud_type": 0,
        }

    def get_map_image(self) -> tuple[bytes, str]:
        return _MOCK_PNG_BYTES, "image/png"

    def _player_pose(self, t: float) -> tuple[float, float, float, float]:
        # Smooth west-flank loop simulating a light tank rushing A -> north flank
        waypoints = [
            (0.15, 0.83),
            (0.14, 0.62),
            (0.18, 0.41),
            (0.26, 0.25),
            (0.45, 0.19),
            (0.60, 0.27),
            (0.42, 0.42),
            (0.24, 0.56),
        ]
        n = len(waypoints)
        progress = (t * 0.18) % n
        idx = int(progress)
        frac = progress - idx
        p0 = waypoints[idx]
        p1 = waypoints[(idx + 1) % n]
        x = p0[0] + (p1[0] - p0[0]) * frac
        y = p0[1] + (p1[1] - p0[1]) * frac
        vx = p1[0] - p0[0]
        vy = p1[1] - p0[1]
        norm = math.hypot(vx, vy) or 1.0
        return x, y, vx / norm, vy / norm

    def get_map_objects(self) -> list[dict[str, Any]]:
        t = time.monotonic() - self._start_time
        px, py, pdx, pdy = self._player_pose(t)

        objects: list[dict[str, Any]] = [
            # Spawn points
            {
                "type": "respawn_base_tank",
                "color": "#174DFF",
                "color[]": [23, 77, 255],
                "blink": 0,
                "icon": "none",
                "x": 0.14,
                "y": 0.84,
            },
            {
                "type": "respawn_base_tank",
                "color": "#174DFF",
                "color[]": [23, 77, 255],
                "blink": 0,
                "icon": "none",
                "x": 0.22,
                "y": 0.88,
            },
            {
                "type": "respawn_base_tank",
                "color": "#fa0C00",
                "color[]": [250, 12, 0],
                "blink": 0,
                "icon": "none",
                "x": 0.86,
                "y": 0.16,
            },
            {
                "type": "respawn_base_tank",
                "color": "#fa0C00",
                "color[]": [250, 12, 0],
                "blink": 0,
                "icon": "none",
                "x": 0.78,
                "y": 0.12,
            },
            # Capture zones A, B (blinking contested), C
            {
                "type": "capture_zone",
                "color": "#174DFF",
                "color[]": [23, 77, 255],
                "blink": 0,
                "icon": "capture_zone",
                "x": 0.24,
                "y": 0.34,
            },
            {
                "type": "capture_zone",
                "color": "#FFFFFF",
                "color[]": [255, 255, 255],
                "blink": 1,
                "icon": "capture_zone",
                "x": 0.50,
                "y": 0.50,
            },
            {
                "type": "capture_zone",
                "color": "#fa0C00",
                "color[]": [250, 12, 0],
                "blink": 0,
                "icon": "capture_zone",
                "x": 0.76,
                "y": 0.66,
            },
            # Allies (3 blue team + 1 green squadmate)
            {
                "type": "ground_model",
                "color": "#30E64B",
                "color[]": [48, 230, 75],
                "blink": 0,
                "icon": "HeavyTank",
                "x": 0.43 + 0.02 * math.sin(t * 0.4),
                "y": 0.53 - 0.015 * math.cos(t * 0.4),
                "dx": 0.70,
                "dy": -0.71,
            },
            {
                "type": "ground_model",
                "color": "#174DFF",
                "color[]": [23, 77, 255],
                "blink": 0,
                "icon": "MediumTank",
                "x": 0.27 + 0.025 * math.cos(t * 0.3),
                "y": 0.37 + 0.01 * math.sin(t * 0.3),
                "dx": 0.85,
                "dy": 0.52,
            },
            {
                "type": "ground_model",
                "color": "#174DFF",
                "color[]": [23, 77, 255],
                "blink": 0,
                "icon": "TankDestroyer",
                "x": 0.34,
                "y": 0.66 + 0.015 * math.sin(t * 0.25),
                "dx": 0.60,
                "dy": -0.80,
            },
            {
                "type": "ground_model",
                "color": "#174DFF",
                "color[]": [23, 77, 255],
                "blink": 0,
                "icon": "SPAA",
                "x": 0.19,
                "y": 0.79,
                "dx": 0.30,
                "dy": -0.95,
            },
            # Spotted enemies near B and C
            {
                "type": "ground_model",
                "color": "#fa0C00",
                "color[]": [250, 12, 0],
                "blink": 0,
                "icon": "MediumTank",
                "x": 0.55 + 0.02 * math.sin(t * 0.5),
                "y": 0.46 + 0.02 * math.cos(t * 0.5),
                "dx": -0.75,
                "dy": 0.66,
            },
            {
                "type": "ground_model",
                "color": "#fa0C00",
                "color[]": [250, 12, 0],
                "blink": 0,
                "icon": "HeavyTank",
                "x": 0.72 - 0.02 * math.cos(t * 0.35),
                "y": 0.61 + 0.015 * math.sin(t * 0.35),
                "dx": -0.85,
                "dy": -0.52,
            },
            # Player (light tank)
            {
                "type": "ground_model",
                "color": "#faC81E",
                "color[]": [250, 200, 30],
                "blink": 0,
                "icon": "Player",
                "x": round(px, 5),
                "y": round(py, 5),
                "dx": round(pdx, 5),
                "dy": round(pdy, 5),
            },
        ]
        return objects

    def get_indicators(self) -> dict[str, Any]:
        t = time.monotonic() - self._start_time
        speed_kmh = 50.0 + 11.5 * math.sin(t * 0.75)  # 38.5 ~ 61.5 km/h
        gear = 4 if speed_kmh < 47 else (5 if speed_kmh < 56 else 6)
        return {
            "valid": True,
            "army": "tank",
            "type": "us_m18_hellcat",
            "speed": round(speed_kmh / 3.6, 3),
            "gear": gear,
        }

    def get_state(self) -> dict[str, Any]:
        return {"valid": False}
