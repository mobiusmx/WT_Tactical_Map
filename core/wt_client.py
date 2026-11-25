"""Background poller for War Thunder's official local 8111 web interface.

Polling cadence is split per endpoint (2026-11 rework):
    /map_info.json  ->  map_info_hz    (default 1 Hz: map identity, generation, bounds)
    /map_obj.json   ->  poll_hz        (default 8 Hz: units, zones, spawns)
    /map_img.jpg    ->  only when map_generation changes (retry throttled)
    /indicators     ->  indicators_hz  (default 2 Hz: speed/gear; /state as fallback)

Connection hardening (2026-11-25):
* auto-probes 127.0.0.1 and localhost once and sticks to whichever answers fast
  (on this machine "localhost" resolves to ::1 first and hangs ~2 s, which the old
  request_timeout_sec=0.3 turned into a silent standby);
* every request goes through an opener with ProxyHandler({}), so a system/browser
  proxy can never hijack localhost traffic;
* request/image failures are no longer swallowed: the concrete exception type +
  reason is printed to the terminal and stored in ``freshness[<endpoint>].error``.

Each endpoint keeps its own "last ok" timestamp so the UI can tell "no enemies
nearby" apart from "the game stopped answering", and so a single slow request
degrades that endpoint only instead of freezing the whole frame.  Long failures
turn ``freshness[<endpoint>].stale`` on first; only after ``standby_grace_sec``
does the state fall back to the standby page.

``map_generation`` changes bump ``match.seq`` and refresh ``match.started_ts`` so
per-match UI state (trail, temporary waypoint) can be reset.  All new keys are
additive: existing fields of ``get_state()`` keep their old shape.
"""

from __future__ import annotations

import copy
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit

from core.map_matcher import compute_image_signature, extract_physical_hint, match_map
from core.mock_provider import MockProvider
from core.route_store import RouteStore

ENDPOINTS = ("map_info", "map_obj", "map_img", "indicators")

# Real clients serve the map at /map.img; older docs/proxies used /map_img.jpg.
IMG_PATHS = ("/map.img", "/map_img.jpg")


def _parse_rgb(obj: dict[str, Any]) -> tuple[int, int, int] | None:
    """Extract (r, g, b) from 8111 object's color[] array, color list, or CSS/hex string."""
    for field in (obj.get("color[]"), obj.get("color")):
        if isinstance(field, (list, tuple)) and len(field) >= 3:
            try:
                return int(field[0]), int(field[1]), int(field[2])
            except (TypeError, ValueError):
                pass

    raw = str(obj.get("color", "") or "").strip()
    if raw.startswith("#"):
        hex_part = raw[1:]
        if len(hex_part) == 6:
            try:
                return (
                    int(hex_part[0:2], 16),
                    int(hex_part[2:4], 16),
                    int(hex_part[4:6], 16),
                )
            except ValueError:
                pass
        elif len(hex_part) == 3:
            try:
                return (
                    int(hex_part[0] * 2, 16),
                    int(hex_part[1] * 2, 16),
                    int(hex_part[2] * 2, 16),
                )
            except ValueError:
                pass
    elif raw.lower().startswith("rgb(") and raw.endswith(")"):
        parts = [p.strip() for p in raw[4:-1].split(",")]
        if len(parts) >= 3:
            try:
                return int(float(parts[0])), int(float(parts[1])), int(float(parts[2]))
            except ValueError:
                pass
    return None


def _is_hostile_color(obj: dict[str, Any]) -> bool:
    """Detect enemy red / orange-red color (including scouted & hit-lit icons)."""
    rgb = _parse_rgb(obj)
    if rgb is None:
        return False
    r, g, b = rgb
    return (r >= 150 and r > b + 50 and r > g + 35) or (r >= 180 and g <= 145 and b <= 110)


def _is_yellow_ping_color(obj: dict[str, Any]) -> bool:
    """Detect yellow / amber squad or attention ping colors."""
    rgb = _parse_rgb(obj)
    if rgb is None:
        return False
    r, g, b = rgb
    return r >= 180 and g >= 160 and b <= 130


def _is_green_squad_color(obj: dict[str, Any]) -> bool:
    """Detect green squadmate color."""
    rgb = _parse_rgb(obj)
    if rgb is None:
        return False
    r, g, b = rgb
    return g >= 140 and g > r + 25 and g > b + 25


_VEHICLE_TYPES = (
    "ground_model",
    "aircraft",
    "tank",
    "ship",
    "helicopter",
    "wheeled",
    "tracked",
    "ground_unit",
    "vehicle",
)

_VEHICLE_ICON_HINTS = (
    "tank",
    "spaa",
    "fighter",
    "bomber",
    "assault",
    "heli",
    "destroyer",
    "boat",
    "ship",
    "artillery",
    "aaa",
    "tracked",
    "wheeled",
)


def _classify_object(obj: dict[str, Any]) -> dict[str, Any]:
    """Attach a semantic tactical 'role' field to an 8111 map_obj entry."""
    enriched = dict(obj)
    obj_type = str(obj.get("type", "") or "").strip()
    type_low = obj_type.lower()
    icon = str(obj.get("icon", "") or "").strip()
    icon_low = icon.lower()
    try:
        blink = int(obj.get("blink", 0) or 0)
    except (TypeError, ValueError):
        blink = 0
    has_xy = isinstance(obj.get("x"), (int, float)) and isinstance(obj.get("y"), (int, float))

    if icon_low == "player":
        role = "player"
    elif "capture_zone" in type_low or icon_low == "capture_zone":
        role = "capture_zone"
    elif type_low.startswith("respawn_base"):
        role = "spawn_enemy" if _is_hostile_color(obj) else "spawn_ally"
    elif type_low == "airfield":
        role = "airfield"
    elif type_low in ("bombing_point", "defending_point"):
        role = "other"
    elif any(k in type_low or k in icon_low for k in ("scout", "spotted", "tracked_enemy")):
        role = "enemy"
        enriched["scouted"] = True
    elif type_low in _VEHICLE_TYPES or any(k in icon_low for k in _VEHICLE_ICON_HINTS):
        if _is_hostile_color(obj):
            role = "enemy"
            enriched["scouted"] = bool(blink > 0 or "scout" in icon_low or "scout" in type_low)
        else:
            role = "ally"
    elif has_xy and (
        any(k in type_low for k in ("attention", "ping", "marker", "point", "squad", "waypoint"))
        or any(k in icon_low for k in ("attention", "ping", "marker", "squad", "exclamation"))
    ):
        if _is_hostile_color(obj) and "exclamation" in icon_low:
            role = "enemy"
            enriched["scouted"] = True
        else:
            role = "ping"
            enriched["ping_kind"] = (
                "squad"
                if (
                    "squad" in type_low
                    or "squad" in icon_low
                    or _is_green_squad_color(obj)
                    or _is_yellow_ping_color(obj)
                )
                else "team"
            )
    elif has_xy and _is_hostile_color(obj):
        role = "enemy"
        enriched["scouted"] = bool(blink > 0)
    elif has_xy and (blink > 0 or _is_yellow_ping_color(obj)):
        role = "ping"
        enriched["ping_kind"] = "squad" if _is_yellow_ping_color(obj) else "team"
    else:
        role = "other"

    enriched["role"] = role
    return enriched


def _empty_telemetry() -> dict[str, Any]:
    return {
        "speed_kmh": None,
        "speed_raw": None,
        "speed_raw_unit": None,
        "speed_factor": None,
        "gear": None,
        "army": None,
        "vehicle_type": None,
    }


def _host_candidates(raw_host: str) -> list[str]:
    """Return the loopback spellings worth probing for a localhost-style URL."""
    raw = (raw_host or "http://localhost:8111").rstrip("/")
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower()
    port = parts.port or 8111
    path = parts.path or ""

    if host in ("localhost", "127.0.0.1", "::1"):
        candidates = [
            f"http://127.0.0.1:{port}{path}",
            f"http://localhost:{port}{path}",
        ]
    else:
        candidates = [raw]

    unique: list[str] = []
    for item in candidates:
        if item not in unique:
            unique.append(item)
    return unique


class WarThunderClient:
    """Polls http://localhost:8111 (or MockProvider) in a background daemon thread."""

    def __init__(
        self,
        app_config: dict[str, Any],
        route_store: RouteStore,
        mock_mode: bool = False,
    ) -> None:
        self.configured_host = str(app_config.get("wt_host", "http://localhost:8111")).rstrip("/")
        self.host_candidates = _host_candidates(self.configured_host)
        self.base_url = self.host_candidates[0]
        self.poll_hz = max(1.0, float(app_config.get("poll_hz", 8)))
        self.poll_interval = 1.0 / self.poll_hz
        self.map_info_hz = max(0.2, float(app_config.get("map_info_hz", 1)))
        self.indicators_hz = max(0.5, float(app_config.get("indicators_hz", 2)))
        self.map_info_interval = 1.0 / self.map_info_hz
        self.indicators_interval = 1.0 / self.indicators_hz
        self.timeout_sec = max(0.3, float(app_config.get("request_timeout_sec", 0.5)))
        self.probe_timeout_sec = max(0.5, float(app_config.get("host_probe_timeout_sec", 1.5)))
        self.stale_after_sec = max(0.5, float(app_config.get("stale_after_sec", 2.0)))
        self.stale_after_ms = int(self.stale_after_sec * 1000)
        self.standby_grace_sec = max(
            self.stale_after_sec, float(app_config.get("standby_grace_sec", 3.0))
        )
        self.speed_multiplier = float(app_config.get("indicators_speed_multiplier", 3.6))
        # Ground/naval 8111 "speed" is already km/h; only aircraft report m/s.
        self.ground_speed_multiplier = float(app_config.get("ground_speed_multiplier", 1.0))
        self.route_store = route_store
        self.mock_mode = mock_mode
        self._mock = MockProvider() if mock_mode else None

        # Never let a system/browser proxy hijack localhost requests.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

        # Throttle clocks (monotonic).
        self._next_map_info_at = 0.0
        self._next_indicators_at = 0.0
        self._next_probe_at = 0.0
        self._next_img_retry_at = 0.0
        self._host_ok_at = 0.0

        # Cached endpoint payloads.
        self._cached_map_info: dict[str, Any] = {}
        self._cached_raw_objects: list[dict[str, Any]] = []
        self._cached_telemetry: dict[str, Any] = _empty_telemetry()

        # Per-endpoint freshness bookkeeping (wall clock).
        self._last_ok_wall: dict[str, float | None] = {name: None for name in ENDPOINTS}
        self._last_error: dict[str, str | None] = {name: None for name in ENDPOINTS}
        self._last_log_at: dict[str, float] = {}

        # Map image cache.
        self._cached_generation: Any = None
        self._cached_img_bytes: bytes = b""
        self._cached_img_type: str = "image/jpeg"
        self._cached_signature: str = ""
        self._cached_map_info_key: Any = None
        self._img_fetched_at: float = 0.0
        self._img_path: str = IMG_PATHS[0]

        # Match lifecycle (map_generation).
        self._match_seq = 0
        self._match_started_ts: float | None = None
        self._match_generation: Any = None

        self._state: dict[str, Any] = self._standby_state()

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._poll_loop, name="wt-8111-poller", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=1.5)

    def get_state(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._state)

    def get_map_image(self) -> tuple[bytes, str, int | None]:
        with self._lock:
            return self._cached_img_bytes, self._cached_img_type, self._cached_generation

    def refresh_match(self) -> None:
        """Re-run map matching immediately after routes_config.json changes."""
        with self._lock:
            signature = self._cached_signature
            map_info = self._state.get("map_info")
            status = self._state.get("status")
        if status != "active" or not signature:
            return
        routes_config = self.route_store.load()
        match_result = match_map(signature, map_info, routes_config)
        with self._lock:
            self._state["matched_map_id"] = match_result["matched_id"]
            self._state["match_type"] = match_result["match_type"]
            self._state["candidates"] = match_result["candidates"]

    # ------------------------------------------------------------------
    # diagnostics
    # ------------------------------------------------------------------
    def _log(self, key: str, message: str, min_interval: float = 5.0) -> None:
        now = time.monotonic()
        if now - self._last_log_at.get(key, 0.0) < min_interval:
            return
        self._last_log_at[key] = now
        print(message, file=sys.stderr, flush=True)

    def _mark_ok(self, name: str) -> None:
        had_error = self._last_error[name]
        self._last_ok_wall[name] = time.time()
        self._last_error[name] = None
        if had_error:
            self._log(f"{name}:recovered", f"[WT-8111] {name} 已恢复正常")

    def _mark_error(self, name: str, exc: object, page: str = "") -> None:
        if isinstance(exc, BaseException):
            message = f"{type(exc).__name__}: {exc}"
        else:
            message = str(exc)
        message = message[:300]
        prefix = f"GET {page} -> " if page else ""
        self._last_error[name] = prefix + message
        self._log(f"{name}:error", f"[WT-8111] {name} 请求失败: {prefix}{message}")

    def _age_sec(self, name: str) -> float | None:
        ok_ts = self._last_ok_wall[name]
        return None if ok_ts is None else (time.time() - ok_ts)

    def _speed_factor(self, army: Any) -> float:
        """Factor that converts ``/indicators`` speed into km/h.

        Ground and naval vehicles already report km/h in ``speed`` (an M18 at
        ~51 km/h turned into 184 with the old blanket x3.6), while aircraft report
        m/s and keep the configured ``indicators_speed_multiplier``.  MockProvider
        deliberately emits m/s, so mock mode always uses the air multiplier.
        """
        if self.mock_mode:
            return self.speed_multiplier
        label = str(army or "").strip().lower()
        if not label:
            return self.speed_multiplier
        if "air" in label or "heli" in label:
            return self.speed_multiplier
        return self.ground_speed_multiplier

    def _freshness(self) -> dict[str, Any]:
        now = time.time()
        out: dict[str, Any] = {}
        for name in ENDPOINTS:
            ok_ts = self._last_ok_wall[name]
            age_ms = None if ok_ts is None else max(0, int((now - ok_ts) * 1000))
            if name == "map_img":
                # The image is intentionally cached per map_generation, so age alone
                # is not a problem: only a failed fetch counts as "stale".
                stale = self._last_error[name] is not None or ok_ts is None
            else:
                stale = age_ms is None or age_ms > self.stale_after_ms
            out[name] = {
                "last_ok_ts": ok_ts,
                "age_ms": age_ms,
                "stale": stale,
                "error": self._last_error[name],
            }
        return out

    def _match_info(self) -> dict[str, Any]:
        return {
            "seq": self._match_seq,
            "started_ts": self._match_started_ts,
            "generation": self._match_generation,
        }

    def _note_generation(self, generation: Any) -> None:
        """Bump the match counter when map_generation changes (new battle)."""
        if self._match_seq == 0:
            self._match_seq = 1
            self._match_started_ts = time.time()
            self._match_generation = generation
            return
        if generation is None or self._match_generation is None:
            return
        if generation != self._match_generation:
            self._match_seq += 1
            self._match_started_ts = time.time()
            self._match_generation = generation

    # ------------------------------------------------------------------
    # 8111 access (proxy-free, host auto-detected)
    # ------------------------------------------------------------------
    def _pick_host(self) -> str:
        """Return a base URL that answered a recent probe; print why when none do."""
        now = time.monotonic()
        if now - self._host_ok_at < 30.0 and self.base_url:
            return self.base_url
        if now < self._next_probe_at:
            # Still inside the failure backoff window: fail fast without hammering.
            raise urllib.error.URLError(self._last_error.get("host") or "8111 暂不可达，稍后重试")

        errors: list[str] = []
        for base in self.host_candidates:
            url = f"{base}/map_info.json"
            started = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with self._opener.open(req, timeout=self.probe_timeout_sec) as resp:
                    resp.read(2048)
                elapsed_ms = (time.monotonic() - started) * 1000
                if base != self.base_url:
                    self._log("host:switch", f"[WT-8111] 已切换 8111 地址: {base}")
                self.base_url = base
                self._host_ok_at = time.monotonic()
                self._last_error["host"] = None
                self._log("host:ok", f"[WT-8111] 8111 已连接: {base} ({elapsed_ms:.0f} ms)")
                return base
            except Exception as exc:
                errors.append(f"{base} -> {type(exc).__name__}: {exc}")

        detail = " | ".join(errors) if errors else "无可用候选地址"
        message = f"8111 连接失败（已尝试 {', '.join(self.host_candidates)}）: {detail}"
        self._last_error["host"] = message[:400]
        self._next_probe_at = time.monotonic() + 2.0
        self._log("host:fail", f"[WT-8111] {message}", min_interval=2.0)
        raise urllib.error.URLError(message)

    def _open(self, path: str, timeout: float) -> Any:
        base = self._pick_host()
        url = f"{base}{path}"
        req = urllib.request.Request(
            url,
            headers={"Accept": "*/*", "Cache-Control": "no-cache", "Pragma": "no-cache"},
        )
        return self._opener.open(req, timeout=timeout)

    def _fetch_bytes(self, path: str) -> bytes:
        try:
            with self._open(path, self.timeout_sec) as resp:
                data = resp.read()
        except urllib.error.HTTPError:
            # The host answered (e.g. 404 on one image path): no need to re-probe.
            self._host_ok_at = time.monotonic()
            raise
        except Exception:
            self._host_ok_at = 0.0  # force a re-probe on the next call
            raise
        self._host_ok_at = time.monotonic()
        return data

    def _fetch_json(self, path: str) -> Any:
        raw = self._fetch_bytes(path)
        return json.loads(raw.decode("utf-8", errors="replace"))

    def _extract_telemetry(self) -> dict[str, Any]:
        speed_kmh: int | None = None
        gear: int | str | None = None
        army: str | None = None
        vehicle_type: str | None = None

        indicators: dict[str, Any] = {}
        ok = False
        try:
            if self._mock is not None:
                indicators = self._mock.get_indicators()
            else:
                data = self._fetch_json("/indicators")
                if isinstance(data, dict):
                    indicators = data
            if isinstance(indicators, dict) and indicators.get("valid"):
                ok = True
        except Exception as exc:
            indicators = {}
            self._mark_error("indicators", exc, "/indicators")

        raw_speed_used: float | None = None
        speed_factor: float | None = None

        if indicators.get("valid"):
            army = indicators.get("army")
            gear = indicators.get("gear")
            vehicle_type = indicators.get("type")
            raw_speed = indicators.get("speed")
            if raw_speed is not None:
                try:
                    value = abs(float(raw_speed))
                    factor = self._speed_factor(army)
                    speed_kmh = round(value * factor)
                    raw_speed_used, speed_factor = value, factor
                except (TypeError, ValueError):
                    speed_kmh = None

        if speed_kmh is None:
            state_data: dict[str, Any] = {}
            try:
                if self._mock is not None:
                    state_data = self._mock.get_state()
                else:
                    data = self._fetch_json("/state")
                    if isinstance(data, dict):
                        state_data = data
            except Exception as exc:
                if self._last_error["indicators"] is None:
                    self._mark_error("indicators", exc, "/state")
                state_data = {}

            if state_data.get("valid"):
                for key in ("IAS, km/h", "TAS, km/h", "speed"):
                    if key in state_data:
                        try:
                            val = abs(float(state_data[key]))
                            # "IAS, km/h" / "TAS, km/h" are already km/h; bare
                            # "speed" follows the same per-army unit as indicators.
                            factor = 1.0 if key != "speed" else self._speed_factor(army)
                            speed_kmh = round(val * factor)
                            raw_speed_used, speed_factor = val, factor
                            ok = True
                            break
                        except (TypeError, ValueError):
                            pass

        if ok:
            self._mark_ok("indicators")
        elif self._last_error["indicators"] is None:
            self._mark_error("indicators", "indicators 与 state 均无有效数据", "/indicators")

        return {
            "speed_kmh": speed_kmh,
            "speed_raw": raw_speed_used,
            "speed_raw_unit": (
                None if speed_factor is None else ("km/h" if speed_factor == 1.0 else "m/s")
            ),
            "speed_factor": speed_factor,
            "gear": gear,
            "army": army,
            "vehicle_type": vehicle_type,
        }

    # ------------------------------------------------------------------
    # state snapshots
    # ------------------------------------------------------------------
    def _standby_state(self) -> dict[str, Any]:
        return {
            "status": "standby",
            "mock_mode": self.mock_mode,
            "map_generation": None,
            "map_signature": "",
            "map_info": None,
            "physical_hint": {},
            "matched_map_id": None,
            "match_type": "none",
            "candidates": [],
            "objects": [],
            "telemetry": _empty_telemetry(),
            "timestamp": time.time(),
            # additive fields (2026-11): per-endpoint freshness + match lifecycle
            "freshness": self._freshness(),
            "match": self._match_info(),
            "source_host": self.base_url,
        }

    @staticmethod
    def _map_info_fingerprint(map_info: dict[str, Any]) -> tuple[Any, ...]:
        def _t(v: Any) -> tuple[Any, ...]:
            return tuple(v) if isinstance(v, (list, tuple)) else ()

        return (
            _t(map_info.get("map_min")),
            _t(map_info.get("map_max")),
            _t(map_info.get("grid_size")),
            _t(map_info.get("grid_steps")),
            _t(map_info.get("grid_zero")),
            map_info.get("hud_type"),
        )

    def _set_standby(self) -> None:
        self._cached_map_info = {}
        self._cached_raw_objects = []
        self._cached_telemetry = _empty_telemetry()
        self._next_indicators_at = 0.0
        with self._lock:
            self._cached_generation = None
            self._cached_img_bytes = b""
            self._cached_signature = ""
            self._cached_map_info_key = None
            self._img_fetched_at = 0.0
            self._next_img_retry_at = 0.0
            self._state = self._standby_state()

    # ------------------------------------------------------------------
    # polling
    # ------------------------------------------------------------------
    def _fetch_map_image(self, generation: Any) -> bytes:
        """Try /map.img first, then the legacy /map_img.jpg, and remember the winner."""
        gen_q = generation if generation is not None else int(time.time())
        candidates = [self._img_path] + [p for p in IMG_PATHS if p != self._img_path]
        last_exc: Exception | None = None
        for path in candidates:
            try:
                data = self._fetch_bytes(f"{path}?gen={gen_q}")
            except urllib.error.HTTPError as exc:
                last_exc = exc
                if exc.code in (400, 403, 404):
                    continue
                raise
            if not data:
                last_exc = ValueError(f"{path} 返回空图片")
                continue
            if path != self._img_path:
                self._img_path = path
                self._log("img:path", f"[WT-8111] 地图图片端点已切换为 {path}")
            return data
        raise last_exc or RuntimeError("地图图片获取失败")

    def _load_image(self, generation: Any, info_key: Any = None) -> str:
        """Fetch the map image (throttled retry) and return the current signature."""
        if time.monotonic() < self._next_img_retry_at:
            return self._cached_signature

        if self._mock is not None:
            img_bytes, img_type = self._mock.get_map_image()
            self._mark_ok("map_img")
        else:
            try:
                img_bytes = self._fetch_map_image(generation)
                img_type = "image/jpeg"
                self._mark_ok("map_img")
            except Exception as exc:
                self._mark_error("map_img", exc, self._img_path)
                self._next_img_retry_at = time.monotonic() + 2.0
                return self._cached_signature

        signature = compute_image_signature(img_bytes)
        with self._lock:
            self._cached_generation = generation
            self._cached_img_bytes = img_bytes
            self._cached_img_type = img_type
            self._cached_signature = signature
            if info_key is not None:
                self._cached_map_info_key = info_key
        self._img_fetched_at = time.time()
        return signature

    def _poll_once(self) -> bool:
        """Execute one poll cycle. Returns True if in an active match, False if standby."""
        now = time.monotonic()

        # -- 1) map_info: throttled to map_info_hz -------------------------
        if self._mock is not None:
            self._cached_map_info = self._mock.get_map_info()
            self._mark_ok("map_info")
        elif now >= self._next_map_info_at:
            self._next_map_info_at = now + self.map_info_interval
            try:
                data = self._fetch_json("/map_info.json")
                if not isinstance(data, dict):
                    raise ValueError("map_info.json is not an object")
                self._cached_map_info = data
                self._mark_ok("map_info")
            except Exception as exc:
                self._mark_error("map_info", exc, "/map_info.json")

        map_info = self._cached_map_info
        if not isinstance(map_info, dict) or map_info.get("valid") is not True:
            self._set_standby()
            self._next_map_info_at = 0.0
            return False

        info_age = self._age_sec("map_info")
        if info_age is not None and info_age > self.standby_grace_sec:
            # map_info keeps failing: do not show a frozen battlefield.
            self._set_standby()
            self._next_map_info_at = 0.0
            return False

        # -- 2) map image: refresh on generation or map_info bounds change --
        generation = map_info.get("map_generation")
        info_key = self._map_info_fingerprint(map_info)
        gen_changed = (
            generation is not None
            and self._cached_generation is not None
            and generation != self._cached_generation
        )
        bounds_changed = (
            self._cached_map_info_key is not None and info_key != self._cached_map_info_key
        )
        map_changed = gen_changed or bounds_changed

        self._note_generation(generation)
        if bounds_changed and not gen_changed and self._match_seq > 0:
            self._match_seq += 1
            self._match_started_ts = time.time()

        if map_changed:
            with self._lock:
                self._cached_img_bytes = b""
                self._cached_signature = ""
            self._next_img_retry_at = 0.0

        need_image = (
            not self._cached_img_bytes
            or map_changed
            or (generation is None and (time.time() - self._img_fetched_at) > 5.0)
        )

        if need_image:
            signature = self._load_image(generation, info_key)
        else:
            if self._cached_map_info_key is None:
                self._cached_map_info_key = info_key
            signature = self._cached_signature

        # -- 3) map_obj: every poll_hz tick --------------------------------
        if self._mock is not None:
            raw_objects = self._mock.get_map_objects()
            self._cached_raw_objects = raw_objects if isinstance(raw_objects, list) else []
            self._mark_ok("map_obj")
        else:
            try:
                raw = self._fetch_json("/map_obj.json")
                self._cached_raw_objects = raw if isinstance(raw, list) else []
                self._mark_ok("map_obj")
            except Exception as exc:
                self._mark_error("map_obj", exc, "/map_obj.json")
                obj_age = self._age_sec("map_obj")
                if obj_age is None or obj_age > self.standby_grace_sec:
                    self._set_standby()
                    self._next_map_info_at = 0.0
                    return False

        objects = [
            _classify_object(obj)
            for obj in self._cached_raw_objects
            if isinstance(obj, dict)
        ]

        # -- 4) indicators: throttled to indicators_hz ---------------------
        if self._mock is not None:
            telemetry = self._extract_telemetry()
        elif now >= self._next_indicators_at:
            self._next_indicators_at = time.monotonic() + self.indicators_interval
            telemetry = self._extract_telemetry()
        else:
            telemetry = self._cached_telemetry

        self._cached_telemetry = telemetry

        routes_config = self.route_store.load()
        match_result = match_map(signature, map_info, routes_config)
        physical_hint = extract_physical_hint(map_info)

        with self._lock:
            self._state = {
                "status": "active",
                "mock_mode": self.mock_mode,
                "map_generation": generation,
                "map_signature": signature,
                "map_info": map_info,
                "physical_hint": physical_hint,
                "matched_map_id": match_result["matched_id"],
                "match_type": match_result["match_type"],
                "candidates": match_result["candidates"],
                "objects": objects,
                "telemetry": telemetry,
                "timestamp": time.time(),
                # additive fields (2026-11): per-endpoint freshness + match lifecycle
                "freshness": self._freshness(),
                "match": self._match_info(),
                "source_host": self.base_url,
            }
        return True

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            tick_start = time.monotonic()
            active = False
            try:
                active = self._poll_once()
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                self._log("loop:error", f"[WT-8111] 轮询异常: {type(exc).__name__}: {exc}")
                self._set_standby()
                active = False
            except Exception as exc:  # never let the poller thread die silently
                self._log("loop:error", f"[WT-8111] 轮询异常: {type(exc).__name__}: {exc}")
                self._set_standby()
                active = False

            target_wait = self.poll_interval if active else 0.5
            elapsed = time.monotonic() - tick_start
            remaining = target_wait - elapsed
            if remaining > 0:
                self._stop_event.wait(remaining)
