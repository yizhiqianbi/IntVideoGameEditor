"""把本机 MaiBot WebUI 的一路私聊接到工作室页面。令牌只留在服务端。"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import websockets

SESSION_ID = "7f3a1c2e-6b48-4d19-a0e5-91c4d8b2f6aa"
ORIGIN = "http://127.0.0.1:18002"


class ChatBridge:
    def __init__(self, instance_dir: Path, origin: str = ORIGIN) -> None:
        self.instance_dir = instance_dir
        self.origin = origin.rstrip("/")
        self.session_id = SESSION_ID
        self._messages: list[dict] = []
        self._voices: dict[str, tuple[str, bytes]] = {}
        self._connected = False
        self._typing = False
        self._detail = "正在连接麦麦"
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._started = threading.Event()
        self._stop = threading.Event()
        self._pending: dict[str, asyncio.Future] = {}
        self._socket = None
        self._handshake = None

    def start(self) -> None:
        threading.Thread(target=self._run, name="maibot-chat", daemon=True).start()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "connected": self._connected,
                "typing": self._typing,
                "detail": self._detail,
                "name": "沈酌",
                "messages": [dict(item) for item in self._messages[-40:]],
            }

    def voice(self, voice_id: str) -> tuple[str, bytes] | None:
        with self._lock:
            return self._voices.get(voice_id)

    def send(self, text: str) -> None:
        cleaned = " ".join(text.split())[:800].strip()
        if not cleaned:
            raise ValueError("先写一句")
        if self._loop is None or not self._started.is_set() or not self._connected:
            raise RuntimeError(self._detail or "麦麦还没连上")
        future = asyncio.run_coroutine_threadsafe(self._send(cleaned), self._loop)
        future.result(timeout=25)

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._started.set()
        self._loop.run_until_complete(self._forever())

    async def _forever(self) -> None:
        while not self._stop.is_set():
            try:
                await self._session()
            except Exception as error:  # noqa: BLE001 - the page stays up while MaiBot restarts.
                self._mark(False, False, _public_error(error))
            await asyncio.sleep(2)

    async def _session(self) -> None:
        token = await asyncio.to_thread(self._ws_token)
        url = self.origin.replace("http://", "ws://", 1) + f"/api/webui/ws?token={token}"
        async with websockets.connect(url, open_timeout=8, max_size=8 * 1024 * 1024) as socket:
            self._socket = socket
            self._pending = {}
            self._handshake = asyncio.get_running_loop().create_future()
            reader = asyncio.create_task(self._read(socket))
            try:
                await asyncio.wait_for(self._handshake, 8)
                await self._call("session.open", {
                    "user_id": f"webui_user_{self.session_id}",
                    "user_name": "你",
                    "restore": True,
                    "client": {"type": "webui", "name": "XUMENG Studio", "version": "1"},
                })
                self._mark(True, False, "已连接")
                await reader
            finally:
                self._socket = None
                if not reader.done():
                    reader.cancel()
                self._mark(False, False, "正在重连麦麦")

    async def _read(self, socket) -> None:
        async for raw in socket:
            packet = json.loads(raw)
            if packet.get("op") == "event" and packet.get("domain") == "system" and packet.get("event") == "ready":
                if self._handshake and not self._handshake.done():
                    self._handshake.set_result(None)
                continue
            if packet.get("op") == "response":
                future = self._pending.pop(str(packet.get("id") or ""), None)
                if future and not future.done():
                    if packet.get("ok"):
                        future.set_result(packet.get("data"))
                    else:
                        future.set_exception(RuntimeError("麦麦没有收下这句"))
                continue
            if packet.get("op") == "event" and packet.get("domain") == "chat" and packet.get("session") == self.session_id:
                self._on_event(str(packet.get("event") or ""), packet.get("data") or {})

    async def _send(self, text: str) -> None:
        item = {
            "id": "local-" + uuid.uuid4().hex,
            "role": "user",
            "text": text,
            "voices": [],
            "time": time.time(),
        }
        self._add(item)
        try:
            await self._call("message.send", {"content": text, "user_name": "你"})
        except Exception:
            self._drop(item["id"])
            raise

    async def _call(self, method: str, data: dict) -> dict:
        socket = self._socket
        if socket is None:
            raise RuntimeError("麦麦还没连上")
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        await socket.send(json.dumps({
            "op": "call",
            "id": request_id,
            "domain": "chat",
            "method": method,
            "session": self.session_id,
            "data": data,
        }))
        return await asyncio.wait_for(future, 20)

    def _on_event(self, event: str, data: dict) -> None:
        if event == "history":
            items = []
            for message in data.get("messages") or []:
                if isinstance(message, dict):
                    item = self._pack(
                        "bot" if message.get("is_bot") else "user",
                        str(message.get("id") or ""),
                        str(message.get("content") or ""),
                        message.get("segments") or [],
                        float(message.get("timestamp") or 0),
                    )
                    if item["text"] or item["voices"]:
                        items.append(item)
            with self._lock:
                self._messages = items[-40:]
            return
        if event == "typing":
            self._mark(True, bool(data.get("is_typing")), "已连接")
            return
        if event == "bot_message":
            self._add(self._pack("bot", str(data.get("message_id") or ""), str(data.get("content") or ""), data.get("segments") or [], float(data.get("timestamp") or time.time())))
            self._mark(True, False, "已连接")
            return
        if event == "error":
            self._add(self._pack("system", "", str(data.get("content") or "这句没有送出去"), [], time.time()))

    def _pack(self, role: str, message_id: str, content: str, segments: list, stamp: float) -> dict:
        text_parts: list[str] = []
        voices: list[str] = []
        for segment in segments if isinstance(segments, list) else []:
            if not isinstance(segment, dict):
                continue
            payload = segment.get("data")
            if segment.get("type") == "text" and isinstance(payload, str):
                piece = payload.strip()
                if piece and piece not in text_parts:
                    text_parts.append(piece)
            if segment.get("type") == "voice" and isinstance(payload, str):
                voice_id = self._store_voice(payload)
                if voice_id:
                    voices.append(voice_id)
        # 纯文本摘要会把被引用的上一句拼在正文前面。有正文段时只留正文，避免同一句出现两次。
        if not text_parts and content.strip():
            text_parts = [content.strip()]
        return {
            "id": message_id or uuid.uuid4().hex,
            "role": role,
            "text": "\n".join(text_parts).strip(),
            "voices": voices,
            "time": stamp,
        }

    def _store_voice(self, payload: str) -> str:
        mime, raw = _decode_audio(payload)
        if not raw:
            return ""
        voice_id = uuid.uuid4().hex
        with self._lock:
            self._voices[voice_id] = (mime, raw)
            if len(self._voices) > 24:
                for old in list(self._voices)[:-24]:
                    self._voices.pop(old, None)
        return voice_id

    def _add(self, item: dict) -> None:
        if not item.get("text") and not item.get("voices"):
            return
        with self._lock:
            if any(existing.get("id") == item["id"] for existing in self._messages):
                return
            self._messages.append(item)
            self._messages = self._messages[-40:]

    def _drop(self, message_id: str) -> None:
        with self._lock:
            self._messages = [item for item in self._messages if item.get("id") != message_id]

    def _mark(self, connected: bool, typing: bool, detail: str) -> None:
        with self._lock:
            self._connected = connected
            self._typing = typing
            self._detail = detail

    def _ws_token(self) -> str:
        credentials = json.loads((self.instance_dir / "data" / "webui.json").read_text(encoding="utf-8"))
        access = str(credentials.get("access_token") or "")
        if not access:
            raise RuntimeError("麦麦还没准备好登录")
        request = urllib.request.Request(
            self.origin + "/api/webui/ws-token",
            headers={"Cookie": f"maibot_session={access}"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        token = payload.get("token") if isinstance(payload, dict) else ""
        if not isinstance(payload, dict) or payload.get("success") is not True or not isinstance(token, str) or not token:
            raise RuntimeError("麦麦还没打开聊天")
        return token


def _decode_audio(payload: str) -> tuple[str, bytes]:
    if not payload.startswith("data:audio/") or "," not in payload:
        return "", b""
    header, encoded = payload.split(",", 1)
    mime = header[5:].split(";", 1)[0].strip().lower() or "audio/wav"
    try:
        raw = base64.b64decode(encoded, validate=False)
    except (ValueError, binascii.Error):
        return "", b""
    if raw.startswith(b"ID3") or (len(raw) > 2 and raw[0] == 0xFF and (raw[1] & 0xE0) == 0xE0):
        mime = "audio/mpeg"
    elif len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WAVE":
        mime = "audio/wav"
    return mime, raw


def _public_error(error: Exception) -> str:
    if isinstance(error, (ConnectionRefusedError, urllib.error.URLError, TimeoutError, OSError, asyncio.TimeoutError)):
        return "麦麦还没启动"
    text = str(error).strip()
    if text.startswith("麦麦"):
        return text
    return "麦麦还没连上"
