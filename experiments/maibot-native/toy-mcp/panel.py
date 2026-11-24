"""工作室页面：左边麦麦聊天，右边模拟玩具。只监听 127.0.0.1。"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from chat_bridge import ChatBridge
from device import Device
from pace import Follower

HOST = "127.0.0.1"
PORT = 18765
ROOT = Path(__file__).resolve().parent
INSTANCE = Path(os.environ.get(
    "MAIBOT_INSTANCE_DIR",
    "/Users/pencil/Documents/IntVideoGameEditor/experiments/maibot-native/instance-intimate",
))
PAGE = (ROOT / "studio.html").read_text(encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    device = Device()
    bridge = ChatBridge(INSTANCE, os.environ.get("MAIBOT_WEBUI_URL", "http://127.0.0.1:18002"))
    pace = Follower(device, bridge)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/state":
            self._json(self.device.status())
            return
        if path == "/chat":
            self._json(self.bridge.snapshot())
            return
        if path.startswith("/voice/"):
            voice_id = path.removeprefix("/voice/")
            if len(voice_id) != 32 or not voice_id.isalnum():
                self.send_error(404)
                return
            found = self.bridge.voice(voice_id)
            if found is None:
                self.send_error(404)
                return
            mime, raw = found
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
            return
        if path in {"/", "/index.html"}:
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            payload = json.loads(self.rfile.read(min(length, 16_384)).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json({"error": "请求不是 JSON"}, status=400)
            return
        try:
            if path == "/command":
                self.pace.suspend()
                if payload.get("stop"):
                    state = self.device.stop()
                else:
                    state = self.device.set(int(payload.get("intensity", 0)), str(payload.get("pattern", "steady")), int(payload.get("seconds", 20)))
                self._json(state)
                return
            if path == "/chat":
                self.bridge.send(str(payload.get("text") or ""))
                self._json(self.bridge.snapshot())
                return
        except (ValueError, TypeError, RuntimeError, TimeoutError) as error:
            self._json({"error": str(error)}, status=400)
            return
        self.send_error(404)

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s\n" % (fmt % args))


def main() -> None:
    Handler.bridge.start()
    if os.environ.get("TOY_PACE") == "1":
        Handler.pace.start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
