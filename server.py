"""Local HTTP server and API gateway for War Thunder Dual-Screen Tactical Map."""

from __future__ import annotations

import argparse
import json
import mimetypes
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from core.route_store import RouteStore
from core.wt_client import WarThunderClient

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
CONFIG_PATH = BASE_DIR / "config.json"


def load_app_config() -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "wt_host": "http://localhost:8111",
        "server_host": "0.0.0.0",
        "server_port": 8123,
        "poll_hz": 8,
        "request_timeout_sec": 0.3,
        "indicators_speed_multiplier": 3.6,
        "default_show_allies": True,
        "default_show_enemies": True,
        "default_show_caps": True,
        "default_show_spawns": True,
        "player_trail_length": 45,
    }
    if CONFIG_PATH.exists():
        try:
            with CONFIG_PATH.open("r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                defaults.update(loaded)
        except Exception:
            pass
    return defaults


class TargetControlQueue:
    """Thread-safe ring buffer of target-cycling actions (next/prev/clear)."""

    VALID_ACTIONS = ("next", "prev", "clear")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seq = 0
        self._actions: deque[dict[str, Any]] = deque(maxlen=32)
        self.global_hotkeys_backend: str | None = None

    def push(self, action: str) -> int:
        if action not in self.VALID_ACTIONS:
            raise ValueError(f"Invalid target action: {action}")
        with self._lock:
            self._seq += 1
            self._actions.append({"seq": self._seq, "action": action, "ts": time.time()})
            return self._seq

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "seq": self._seq,
                "actions": list(self._actions),
                "global_hotkeys": self.global_hotkeys_backend is not None,
                "backend": self.global_hotkeys_backend,
            }


def start_optional_hotkey_listener(queue: TargetControlQueue) -> Any:
    """Optionally listen for global Numpad hotkeys via pynput or keyboard.

    Degrades gracefully when neither optional package is installed so the server
    always starts cleanly with zero extra dependencies.
    """
    vk_map = {
        107: "next",   # VK_ADD (Numpad +)
        100: "next",   # VK_NUMPAD4
        109: "prev",   # VK_SUBTRACT (Numpad -)
        97: "prev",    # VK_NUMPAD1
        111: "clear",  # VK_DIVIDE (Numpad /)
        96: "clear",   # VK_NUMPAD0
    }

    try:
        from pynput import keyboard as pynput_kb  # type: ignore

        def _on_press(key: Any) -> None:
            vk = getattr(key, "vk", None)
            if vk in vk_map:
                queue.push(vk_map[vk])

        listener = pynput_kb.Listener(on_press=_on_press, daemon=True)
        listener.start()
        queue.global_hotkeys_backend = "pynput"
        print("[WT Tactical Map] 全局小键盘热键已启用 (pynput): +/4 下一个, -/1 上一个, //0 取消锁定")
        return listener.stop
    except ImportError:
        pass
    except Exception as exc:
        print(f"[WT Tactical Map] pynput 热键初始化失败，尝试降级: {exc}")

    try:
        import keyboard as kb  # type: ignore

        kp_map = {
            "+": "next",
            "add": "next",
            "num +": "next",
            "4": "next",
            "num 4": "next",
            "-": "prev",
            "subtract": "prev",
            "num -": "prev",
            "1": "prev",
            "num 1": "prev",
            "/": "clear",
            "divide": "clear",
            "num /": "clear",
            "0": "clear",
            "num 0": "clear",
        }

        def _on_kb_event(event: Any) -> None:
            if getattr(event, "event_type", None) != "down":
                return
            name = str(getattr(event, "name", "") or "").lower()
            is_kp = bool(getattr(event, "is_keypad", False))
            if is_kp or name in ("add", "subtract", "divide", "num +", "num -", "num /"):
                action = kp_map.get(name)
                if action:
                    queue.push(action)

        hook = kb.hook(_on_kb_event)
        queue.global_hotkeys_backend = "keyboard"
        print("[WT Tactical Map] 全局小键盘热键已启用 (keyboard): +/4 下一个, -/1 上一个, //0 取消锁定")
        return lambda: kb.unhook(hook)
    except ImportError:
        print(
            "[WT Tactical Map] 未安装 pynput/keyboard，后台全局小键盘热键已跳过"
            "（聚焦网页仍支持小键盘/Tab；如需切到游戏后全局热键，可运行 pip install pynput）。"
        )
    except Exception as exc:
        print(f"[WT Tactical Map] 全局热键监听不可用，已优雅降级: {exc}")

    return lambda: None


class TacticalHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        app_config: dict[str, Any],
        route_store: RouteStore,
        wt_client: WarThunderClient,
        target_control: TargetControlQueue,
    ) -> None:
        self.app_config = app_config
        self.route_store = route_store
        self.wt_client = wt_client
        self.target_control = target_control
        self.preset_img_cache: dict[str, tuple[bytes, str]] = {}
        self.preset_img_lock = threading.Lock()
        super().__init__(server_address, handler_class)


class TacticalRequestHandler(BaseHTTPRequestHandler):
    server: TacticalHTTPServer

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress high-frequency 8Hz polling logs; keep unexpected HTTP errors visible
        if args and len(args) >= 2:
            status_str = str(args[1])
            if status_str.startswith(("2", "3")):
                return
        sys.stderr.write(f"[HTTP] {self.address_string()} - {format % args}\n")

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status: int, content_type: str, data: bytes, cache: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if not cache:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 5 * 1024 * 1024:
            raise ValueError("Invalid request body length")
        raw = self.rfile.read(length)
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def _serve_safe_file(self, root_dir: Path, rel_path: str, cache: bool = False) -> None:
        clean_rel = urllib.parse.unquote(rel_path).lstrip("/")
        target = (root_dir / clean_rel).resolve()
        root_resolved = root_dir.resolve()
        try:
            target.relative_to(root_resolved)
        except ValueError:
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Forbidden path"})
            return

        if not target.exists() or not target.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "File not found"})
            return

        ctype, _ = mimetypes.guess_type(str(target))
        if target.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif target.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif target.suffix == ".html":
            ctype = "text/html; charset=utf-8"
        elif not ctype:
            ctype = "application/octet-stream"

        data = target.read_bytes()
        self._send_bytes(HTTPStatus.OK, ctype, data, cache=cache)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/state":
                state = self.server.wt_client.get_state()
                state["ui_defaults"] = {
                    "poll_hz": self.server.app_config.get("poll_hz", 8),
                    "show_allies": self.server.app_config.get("default_show_allies", True),
                    "show_enemies": self.server.app_config.get("default_show_enemies", True),
                    "show_caps": self.server.app_config.get("default_show_caps", True),
                    "show_spawns": self.server.app_config.get("default_show_spawns", True),
                    "player_trail_length": self.server.app_config.get("player_trail_length", 45),
                }
                state["target_control"] = self.server.target_control.snapshot()
                self._send_json(HTTPStatus.OK, state)
                return

            if path in ("/api/map.img", "/api/map_img", "/api/map_img.jpg"):
                img_bytes, img_type, _ = self.server.wt_client.get_map_image()
                if not img_bytes:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "Map image unavailable"})
                    return
                self._send_bytes(HTTPStatus.OK, img_type, img_bytes, cache=False)
                return

            if path == "/api/preset_map_img":
                qs = urllib.parse.parse_qs(parsed.query)
                map_id = str((qs.get("map_id") or [""])[0]).strip()
                if not map_id:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing map_id"})
                    return
                result = self._resolve_preset_map_image(map_id)
                if result is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "Preset map image unavailable"})
                    return
                img_bytes, img_type = result
                self._send_bytes(HTTPStatus.OK, img_type, img_bytes, cache=False)
                return

            if path == "/api/routes":
                payload = {
                    "config": self.server.route_store.load(),
                    "available_overlays": self.server.route_store.list_overlay_pngs(),
                }
                self._send_json(HTTPStatus.OK, payload)
                return

            if path.startswith("/overlays/"):
                rel = path[len("/overlays/") :]
                self._serve_safe_file(self.server.route_store.overlays_dir, rel, cache=False)
                return

            if path == "/" or path == "/index.html":
                self._serve_safe_file(WEB_DIR, "index.html", cache=False)
                return

            if path == "/favicon.ico":
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return

            if path.startswith(("/css/", "/js/")):
                self._serve_safe_file(WEB_DIR, path, cache=False)
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as exc:  # never let a handler thread die without a response
            self._send_internal_error(exc)

    def _resolve_preset_map_image(self, map_id: str) -> tuple[bytes, str] | None:
        """Serve local routes/maps/<map_id>.* or fetch/cache upstream workbench map image."""
        config = self.server.route_store.load()
        maps = config.get("maps", {}) if isinstance(config, dict) else {}
        entry = maps.get(map_id)
        if not isinstance(entry, dict):
            return None

        # 1. Local custom map image under routes/maps/<map_id>.(png|jpg|jpeg|webp)
        maps_dir = (self.server.route_store.routes_dir / "maps").resolve()
        if maps_dir.exists() and maps_dir.is_dir():
            for ext, mime in (
                (".png", "image/png"),
                (".jpg", "image/jpeg"),
                (".jpeg", "image/jpeg"),
                (".webp", "image/webp"),
            ):
                candidate = (maps_dir / f"{map_id}{ext}").resolve()
                try:
                    candidate.relative_to(maps_dir)
                except ValueError:
                    continue
                if candidate.is_file():
                    return candidate.read_bytes(), mime

        # 2. Built-in mock arena image
        if map_id == "mock_tactical_arena":
            from core.mock_provider import MockProvider

            return MockProvider().get_map_image()

        # 3. Cached or upstream workbench_meta.assets URL (thumbnail first, then base)
        with self.server.preset_img_lock:
            cached = self.server.preset_img_cache.get(map_id)
            if cached:
                return cached

        assets = (entry.get("workbench_meta") or {}).get("assets") or {}
        urls: list[str] = []
        for u in assets.get("thumbnail_urls") or []:
            if isinstance(u, str) and u.startswith(("http://", "https://")):
                urls.append(u)
        base_url = assets.get("base_url")
        if isinstance(base_url, str) and base_url.startswith(("http://", "https://")):
            urls.append(base_url)

        for url in urls:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "wt-tactical-map"})
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    data = resp.read()
                    ctype = resp.headers.get("Content-Type", "").split(";")[0].strip() or "image/webp"
                if data:
                    with self.server.preset_img_lock:
                        self.server.preset_img_cache[map_id] = (data, ctype)
                    return data, ctype
            except Exception:
                continue
        return None

    def _send_internal_error(self, exc: Exception) -> None:
        sys.stderr.write(f"[HTTP] 500 {self.command} {self.path}: {type(exc).__name__}: {exc}\n")
        try:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(exc).__name__}: {exc}"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json_body()
        except json.JSONDecodeError as exc:  # subclass of ValueError: must be caught first
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid JSON: {exc}"})
            return
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

        try:
            if path == "/api/routes/save":
                map_id = str(body.get("map_id", "")).strip()
                if not map_id:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing map_id"})
                    return
                vector_layers = body.get("vector_layers", [])
                png_layers = body.get("png_layers")
                map_name = body.get("map_name")
                if not isinstance(vector_layers, list):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "vector_layers must be a list"})
                    return
                updated = self.server.route_store.save_map_layers(
                    map_id=map_id,
                    vector_layers=vector_layers,
                    png_layers=png_layers if isinstance(png_layers, list) else None,
                    map_name=str(map_name).strip() if map_name else None,
                )
                self.server.wt_client.refresh_match()
                self._send_json(HTTPStatus.OK, {"ok": True, "map_id": map_id, "map": updated})
                return

            if path == "/api/maps/bind":
                map_id = str(body.get("map_id", "")).strip()
                signature = str(body.get("signature", "")).strip()
                if not map_id or not signature:
                    self._send_json(
                        HTTPStatus.BAD_REQUEST,
                        {"error": "Both map_id and signature are required"},
                    )
                    return
                physical_hint = body.get("physical_hint")
                map_name = body.get("map_name")
                updated_config = self.server.route_store.bind_signature(
                    map_id=map_id,
                    signature=signature,
                    physical_hint=physical_hint if isinstance(physical_hint, dict) else None,
                    map_name=str(map_name).strip() if map_name else None,
                )
                self.server.wt_client.refresh_match()
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "config": updated_config,
                        "available_overlays": self.server.route_store.list_overlay_pngs(),
                    },
                )
                return

            if path == "/api/maps/create":
                map_id = str(body.get("map_id", "")).strip()
                name = str(body.get("name", "")).strip()
                if not map_id or not name:
                    self._send_json(
                        HTTPStatus.BAD_REQUEST,
                        {"error": "Both map_id and name are required"},
                    )
                    return
                signature = str(body.get("signature", "")).strip()
                physical_hint = body.get("physical_hint")
                updated_config = self.server.route_store.create_map(
                    map_id=map_id,
                    name=name,
                    signature=signature,
                    physical_hint=physical_hint if isinstance(physical_hint, dict) else None,
                )
                self.server.wt_client.refresh_match()
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "map_id": map_id,
                        "config": updated_config,
                        "available_overlays": self.server.route_store.list_overlay_pngs(),
                    },
                )
                return

            if path == "/api/control/target":
                action = str(body.get("action", "")).strip().lower()
                seq = self.server.target_control.push(action)
                self._send_json(HTTPStatus.OK, {"ok": True, "seq": seq, "action": action})
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as exc:
            self._send_internal_error(exc)


def detect_lan_ipv4() -> list[str]:
    """Best-effort list of LAN IPv4 addresses using only the stdlib.

    The UDP-connect trick reveals the address of the default-route interface
    (uses no packets); hostname resolution adds any remaining adapters.  Virtual
    adapters cannot be told apart without extra dependencies, so RFC1918 ordering
    keeps the most likely Wi-Fi/Ethernet address first.
    """
    candidates: list[str] = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            candidates.append(probe.getsockname()[0])
        finally:
            probe.close()
    except OSError:
        pass
    try:
        for addr in socket.gethostbyname_ex(socket.gethostname())[2]:
            candidates.append(addr)
    except OSError:
        pass

    unique: list[str] = []
    for ip in candidates:
        if not ip or ip.startswith(("127.", "169.254.", "0.")):
            continue
        if ip not in unique:
            unique.append(ip)

    def is_virtual_range(ip: str) -> bool:
        # 172.16.0.0/12 is the usual WSL / Hyper-V / Docker vEthernet range.
        if not ip.startswith("172."):
            return False
        try:
            return 16 <= int(ip.split(".")[1]) <= 31
        except (IndexError, ValueError):
            return False

    # Drop virtual-range addresses when a real Wi-Fi/Ethernet address exists.
    real = [ip for ip in unique if not is_virtual_range(ip)]
    if real:
        unique = real

    def rank(ip: str) -> int:
        if ip.startswith("192.168."):
            return 0
        if ip.startswith("10."):
            return 1
        if ip.startswith("172."):
            return 2
        return 3

    unique.sort(key=rank)
    return unique


def print_access_info(bind_host: str, port: int) -> None:
    """Print local + LAN URLs so a phone user can type the address manually."""
    local_url = f"http://127.0.0.1:{port}"
    print("")
    print("=" * 66)
    print(f"[WT Tactical Map] 本机访问:        {local_url}")
    if bind_host in ("0.0.0.0", "", "::"):
        lan_ips = detect_lan_ipv4()
        if lan_ips:
            for ip in lan_ips:
                print(f"[WT Tactical Map] 手机局域网访问:  http://{ip}:{port}")
            print("[WT Tactical Map] 手机与电脑需连同一个 Wi-Fi；首次启动如弹防火墙，请允许「专用网络」。")
        else:
            print("[WT Tactical Map] 未检测到局域网 IPv4 地址，请确认电脑已连接 Wi-Fi 或网线。")
        print("[WT Tactical Map] 注意: 同一局域网内的设备都能打开此页面，请只在可信网络使用。")
    else:
        print(f"[WT Tactical Map] 当前仅监听 {bind_host}，手机无法访问；")
        print("[WT Tactical Map] 用 --host 0.0.0.0 启动即可开启局域网访问。")
    print("=" * 66)
    sys.stdout.flush()


def main() -> None:
    app_config = load_app_config()

    parser = argparse.ArgumentParser(description="War Thunder Dual-Screen Tactical Map Server")
    parser.add_argument("--host", default=app_config.get("server_host", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(app_config.get("server_port", 8123)))
    parser.add_argument("--mock", action="store_true", help="Enable offline mock 8111 data mode")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    args = parser.parse_args()

    route_store = RouteStore(BASE_DIR)
    wt_client = WarThunderClient(app_config=app_config, route_store=route_store, mock_mode=args.mock)
    wt_client.start()
    target_control = TargetControlQueue()
    stop_hotkeys = start_optional_hotkey_listener(target_control)

    httpd = TacticalHTTPServer(
        (args.host, args.port),
        TacticalRequestHandler,
        app_config=app_config,
        route_store=route_store,
        wt_client=wt_client,
        target_control=target_control,
    )

    mode_label = "MOCK 演示模式" if args.mock else f"实时模式 (8111 @ {app_config.get('poll_hz', 8)}Hz)"
    print(f"[WT Tactical Map] 服务已启动: 监听 {args.host}:{args.port} | {mode_label}")
    print_access_info(args.host, args.port)
    print("[WT Tactical Map] 按 Ctrl+C 退出服务")

    browser_host = "127.0.0.1" if args.host in ("0.0.0.0", "", "::") else args.host
    browser_url = f"http://{browser_host}:{args.port}"
    if not args.no_browser:
        # Bind the URL as a default argument so the timer thread never touches
        # locals that may be gone by the time the lambda runs.
        threading.Timer(0.6, lambda target=browser_url: webbrowser.open(target)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[WT Tactical Map] 正在关闭服务...")
    finally:
        stop_hotkeys()
        wt_client.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
