#!/usr/bin/env python3
"""Let only a bearer token reach the local H3 ComfyUI.

Comfy stays on 127.0.0.1:6006. This gate is what a tunnel may publish.
"""

from __future__ import annotations

import hmac
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

UPSTREAM = "http://127.0.0.1:6006"
TOKEN_PATH = "/data/zrc/dyt/.h3-xumeng-token"
HOST = "127.0.0.1"
PORT = 6016
MAX_BODY = 52_000_000
REFERENCE = re.compile(r"^/pencil/references/[a-f0-9]{32}$")
HISTORY = re.compile(r"^/history/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
VIEW = re.compile(r"^filename=h3_r2v_[a-f0-9]{32}_\d{1,8}_?\.mp4&subfolder=pencil&type=output$")


def load_token() -> str:
    token = open(TOKEN_PATH, encoding="utf-8").read().strip()
    if len(token) < 32:
        raise SystemExit("H3 channel token is missing")
    return token


TOKEN = load_token()


def allowed(method: str, path: str, query: str) -> str | None:
    if method not in {"GET", "HEAD", "POST"}:
        return None
    if method == "GET" and path == "/view" and VIEW.fullmatch(query):
        return path
    if query not in {"", "metadata=1"}:
        return None
    if method == "GET" and path == "/pencil/health" and query == "":
        return path
    if method == "GET" and HISTORY.fullmatch(path) and query == "":
        return path
    if method == "POST" and path in {"/pencil/h3/prompt", "/pencil/generate/cancel", "/pencil/input-image", "/pencil/references"} and query == "":
        return path
    if method == "GET" and REFERENCE.fullmatch(path):
        return path
    return None


class Gate(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        self.forward()

    def do_HEAD(self) -> None:
        self.forward()

    def do_POST(self) -> None:
        self.forward()

    def forward(self) -> None:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {TOKEN}"
        if len(supplied) != len(expected) or not hmac.compare_digest(supplied, expected):
            self.reply(401, b'{"error":"unauthorized"}\n', "application/json")
            return
        parts = urlsplit(self.path)
        target = allowed(self.command, parts.path, parts.query)
        if target is None:
            self.reply(404, b'{"error":"not found"}\n', "application/json")
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length < 0 or length > MAX_BODY:
            self.reply(413, b'{"error":"too large"}\n', "application/json")
            return
        body = self.rfile.read(length) if length else None
        headers = {"Accept": "*/*" if parts.path == "/view" else "application/json"}
        content_type = self.headers.get("Content-Type")
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(f"{UPSTREAM}{target}{('?' + parts.query) if parts.query else ''}", data=body, headers=headers, method=self.command)
        try:
            upstream = urlopen(request, timeout=300)
        except HTTPError as error:
            payload = error.read(MAX_BODY)
            self.reply(error.code, payload, error.headers.get("Content-Type") or "application/json")
            return
        except URLError:
            self.reply(502, b'{"error":"upstream unavailable"}\n', "application/json")
            return
        with upstream:
            payload = upstream.read(MAX_BODY + 1)
            if len(payload) > MAX_BODY:
                self.reply(502, b'{"error":"upstream too large"}\n', "application/json")
                return
            self.reply(upstream.status, b"" if self.command == "HEAD" else payload, upstream.headers.get("Content-Type") or "application/octet-stream")

    def reply(self, status: int, payload: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type.split(";", 1)[0])
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def log_message(self, fmt: str, *args: object) -> None:
        return


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Gate).serve_forever()
