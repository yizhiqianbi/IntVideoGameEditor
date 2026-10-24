"""晴屿全年龄媒体动作。

动作由 MaiBot 原生 Planner 选择，插件只负责把已经选择的媒体生成并发送到
当前 stream。模型密钥只从容器环境读取，媒体以原生 image/emoji/voice segment
发送，后续由 gateway 统一归一化为前端的 message.media。
"""

from __future__ import annotations

import asyncio
import base64
import html
import json
import os
import random
import re
import time
import tomllib
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, HTTPRedirectHandler, build_opener
from urllib.parse import urlsplit

from .review import review_content, speech_review_scope, record_reviewed_speech

from maibot_sdk import Action, MaiBotPlugin
from maibot_sdk.types import ActivationType


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise HTTPError(request.full_url, code, "Redirect refused", headers, fp)


urlopen = build_opener(_NoRedirect()).open

_MAX_PROMPT = 1800
_MAX_SPEECH = 900
_MAX_BYTES = 8 * 1024 * 1024
_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
_DEFAULT_IMAGE_MODEL = "x-ai/grok-imagine-image-2.0"
_DEFAULT_TTS_MODEL = "x-ai/grok-voice-tts-1.0"
_DEFAULT_TTS_VOICE = "rex"
_SAFE_DATA_URL = re.compile(r"^data:([a-z0-9.+-]+/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$", re.I)


def _env(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default) or "").strip()


def _base_url() -> str:
    value = _env("COMPANION_OPENROUTER_BASE_URL") or _configured_provider().get("base_url", _DEFAULT_BASE_URL)
    value = value.rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != "openrouter.ai" or parsed.username or parsed.password or parsed.port or parsed.path != "/api/v1" or parsed.query or parsed.fragment:
        raise RuntimeError("媒体服务只允许通过 OpenRouter HTTPS 端点调用")
    return value


def _key() -> str:
    value = _env("COMPANION_OPENROUTER_API_KEY") or _configured_provider().get("api_key", "")
    if not value or "\n" in value or "\r" in value:
        raise RuntimeError("媒体服务尚未配置 OpenRouter 密钥")
    return value


def _configured_provider() -> dict[str, str]:
    """Read the already-private native provider config for local/dev runs.

    Production injects the same values as container environment variables. The
    fallback keeps the local native instance useful without asking developers to
    duplicate a secret into a shell profile.
    """

    root = _env("MAIBOT_INSTANCE_DIR", "/var/lib/qingyu-companion/instance")
    try:
        parsed = tomllib.loads(open(os.path.join(root, "config", "model_config.toml"), "rb").read().decode("utf-8"))
        providers = parsed.get("api_providers") or []
        provider = providers[0] if isinstance(providers, list) and providers and isinstance(providers[0], dict) else {}
        return {"api_key": str(provider.get("api_key") or "").strip(), "base_url": str(provider.get("base_url") or "").strip()}
    except (OSError, ValueError, TypeError, IndexError):
        return {}


def _decode_data_url(value: str, expected_prefixes: tuple[str, ...]) -> tuple[str, str]:
    match = _SAFE_DATA_URL.match(value.strip())
    if not match:
        raise RuntimeError("媒体服务返回了不受支持的内容")
    mime, raw = match.group(1).lower(), re.sub(r"\s+", "", match.group(2))
    if not any(mime.startswith(prefix) for prefix in expected_prefixes):
        raise RuntimeError("媒体服务返回了错误的媒体类型")
    try:
        decoded = base64.b64decode(raw, validate=True)
    except Exception as error:
        raise RuntimeError("媒体服务返回了损坏的 Base64") from error
    if not decoded or len(decoded) > _MAX_BYTES:
        raise RuntimeError("媒体服务返回的文件过大")
    return mime, base64.b64encode(decoded).decode("ascii")


def generate_fallback_emoji(mood: str) -> tuple[str, str]:
    """Create a tiny local sticker when the native emoji library is empty.

    MaiBot's emoji manager is intentionally still preferred.  A fresh native
    instance can have zero imported packs, though, which used to turn an
    explicit "send me a sticker" request into plain text.  This fallback is a
    deterministic, no-network SVG sticker and keeps the public media contract
    intact until an operator imports a real pack.
    """

    cleaned = " ".join(str(mood or "可爱").split())[:18] or "可爱"
    choices = (
        ("开心", "😚", "收到啦"),
        ("委屈", "🥺", "你哄哄我"),
        ("撒娇", "🥰", "就想黏你"),
        ("无语", "🙄", "哼哼"),
        ("想念", "🫶", "有在想你"),
    )
    icon, caption = "🐰", cleaned
    for marker, candidate, text in choices:
        if marker in cleaned:
            icon, caption = candidate, text
            break
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="320" viewBox="0 0 512 320">
  <rect width="512" height="320" rx="52" fill="#fff0f6"/>
  <circle cx="256" cy="130" r="94" fill="#ffd7e8"/>
  <text x="256" y="174" text-anchor="middle" font-size="126">{html.escape(icon)}</text>
  <text x="256" y="258" text-anchor="middle" fill="#9b3562" font-size="28" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">{html.escape(caption)}</text>
</svg>'''
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return "image/svg+xml", encoded


def _post_json(path: str, payload: dict[str, Any], *, accept: str = "application/json") -> tuple[dict[str, str], bytes]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{_base_url()}{path}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {_key()}",
            "Content-Type": "application/json",
            "Accept": accept,
            "HTTP-Referer": "https://qingyu.invalid",
            "X-Title": "Qingyu companion",
        },
    )
    try:
        with urlopen(request, timeout=90) as response:  # noqa: S310 - URL is pinned above.
            data = response.read(_MAX_BYTES + 1)
            if len(data) > _MAX_BYTES:
                raise RuntimeError("媒体服务返回的文件过大")
            return {str(k).lower(): str(v) for k, v in response.headers.items()}, data
    except HTTPError as error:
        # Do not include response text: it can contain provider metadata or prompt content.
        raise RuntimeError(f"媒体服务暂时不可用（HTTP {error.code}）") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError("媒体服务连接超时") from error


def generate_image(prompt: str) -> tuple[str, str]:
    """Generate one image and return (mime, base64)."""

    cleaned = " ".join(str(prompt or "").split())[:_MAX_PROMPT].strip()
    if not cleaned:
        raise RuntimeError("照片描述不能为空")
    review_content(cleaned, _post_json)
    _, raw = _post_json(
        "/images",
        {
            "model": _env("COMPANION_IMAGE_MODEL", _DEFAULT_IMAGE_MODEL),
            "prompt": cleaned,
            "resolution": _env("COMPANION_IMAGE_RESOLUTION", "1K"),
            # Grok Imagine currently accepts low/medium quality.  Keep the
            # default aligned with the live OpenRouter image-model catalog;
            # callers can still override it per deployment.
            "quality": _env("COMPANION_IMAGE_QUALITY", "medium"),
            "n": 1,
        },
    )
    try:
        payload = json.loads(raw.decode("utf-8"))
        item = payload.get("data", [])[0]
    except (ValueError, IndexError, AttributeError, TypeError) as error:
        raise RuntimeError("图片服务返回格式不正确") from error
    encoded = str(item.get("b64_json") or "").strip() if isinstance(item, dict) else ""
    if not encoded:
        raise RuntimeError("图片服务没有返回图片数据")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise RuntimeError("图片服务返回的图片损坏") from error
    if not decoded or len(decoded) > _MAX_BYTES:
        raise RuntimeError("图片服务返回的文件过大")
    if decoded.startswith(b"\x89PNG"):
        mime = "image/png"
    elif decoded.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif decoded.startswith((b"RIFF", b"WEBP")):
        mime = "image/webp"
    else:
        raise RuntimeError("图片服务返回了不受支持的格式")
    review_content([{ "type": "image_url", "image_url": { "url": f"data:{mime};base64,{base64.b64encode(decoded).decode('ascii')}" } }], _post_json)
    return mime, base64.b64encode(decoded).decode("ascii")


def generate_speech(text: str) -> tuple[str, str]:
    """Generate a short voice note through OpenRouter's OpenAI-compatible TTS API."""

    cleaned = " ".join(str(text or "").split())[:_MAX_SPEECH].strip()
    if not cleaned:
        raise RuntimeError("语音内容不能为空")
    speech_review_scope()
    review_content(cleaned, _post_json)
    headers, raw = _post_json(
        "/audio/speech",
        {
            "model": _env("COMPANION_TTS_MODEL", _DEFAULT_TTS_MODEL),
            "input": cleaned,
            "voice": _env("COMPANION_TTS_VOICE", _DEFAULT_TTS_VOICE),
            "response_format": "mp3",
        },
        accept="audio/mpeg",
    )
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"audio/mpeg", "audio/mp3"} or not raw:
        raise RuntimeError("语音服务没有返回可播放的 MP3")
    record_reviewed_speech(raw, cleaned)
    return "audio/mpeg", base64.b64encode(raw).decode("ascii")


class XumengMediaPlugin(MaiBotPlugin):
    """Planner 可调用的图片、表情和语音动作。"""

    def __init__(self) -> None:
        super().__init__()
        self._last_sent: dict[tuple[str, str], float] = {}
        self._lock = asyncio.Lock()

    async def on_load(self) -> None:
        return None

    async def on_unload(self) -> None:
        return None

    async def on_config_update(self, scope: str, config_data: dict[str, object], version: str) -> None:
        # The action intentionally reads environment values per invocation so
        # model/voice rotation does not require a second plugin config schema.
        del scope, config_data, version

    async def _allow(self, stream_id: str, kind: str, force: bool = False) -> bool:
        if not stream_id:
            return False
        minimum = max(0.0, float(_env("COMPANION_MEDIA_COOLDOWN_SECONDS", "25") or 25))
        async with self._lock:
            now = time.monotonic()
            key = (stream_id, kind)
            previous = self._last_sent.get(key, 0.0)
            if not force and previous and now - previous < minimum:
                return False
            self._last_sent[key] = now
            return True

    async def _send_generated(
        self,
        stream_id: str,
        kind: str,
        generator: Callable[[], tuple[str, str]],
        *,
        force: bool = False,
    ) -> tuple[bool, str]:
        if not await self._allow(stream_id, kind, force=force):
            return False, "这类媒体刚发过，先让对方有时间回应。"
        try:
            mime, encoded = await asyncio.to_thread(generator)
            segment = {"type": kind, "content": encoded, "mime_type": mime}
            sent = await self.ctx.send.hybrid([segment], stream_id, storage_message=True)
            return bool(sent), "已发送" if sent else "发送失败"
        except Exception as error:  # noqa: BLE001 - action failure must not stop chat.
            return False, str(error)

    @Action(
        "xumeng_send_emoji",
        description="发送一张贴合当前情绪的表情包。只有确实能补充语气、撒娇或接住情绪时使用，不要连续发送。",
        activation_type=ActivationType.ALWAYS,
        action_parameters={"mood": "表情情绪，例如开心、委屈、撒娇、无语"},
        action_require=["用户明确要表情包时使用", "一句话很短且表情比解释更自然时使用", "同一轮最多发送一张"],
        associated_types=["text"],
    )
    async def send_emoji(self, stream_id: str = "", mood: str = "", **kwargs: Any):
        del kwargs
        if not await self._allow(stream_id, "emoji", force=bool(mood and any(x in mood for x in ("要", "发", "表情")))):
            return False, "表情包冷却中，先继续聊天。"
        try:
            found = await self.ctx.emoji.get_by_description(mood.strip()[:80] or "可爱", limit=3)
            if not found:
                found = await self.ctx.emoji.get_random(1)
            item = found[0] if isinstance(found, list) and found else found
            encoded = str(item.get("base64") or item.get("data") or "").strip() if isinstance(item, dict) else ""
            if not encoded:
                return False, "没有找到合适的表情包。"
            if encoded.startswith("data:"):
                match = _SAFE_DATA_URL.match(encoded)
                encoded = match.group(2) if match else ""
            sent = await self.ctx.send.emoji(encoded, stream_id, storage_message=True)
            return bool(sent), "已发送一张表情包" if sent else "发送失败"
        except Exception as error:  # noqa: BLE001
            return False, str(error)

    @Action(
        "xumeng_send_voice",
        description="把一句很短、带情绪的回复变成语音消息。只在撒娇、安慰、想念或用户明确要听声音时使用；不要把整段长回复转成语音。",
        activation_type=ActivationType.ALWAYS,
        action_parameters={"text": "要说出口的短句，通常不超过两句"},
        action_require=["用户明确要求语音时使用", "文字很难传达的撒娇或小情绪可以使用", "同一轮最多一次"],
        associated_types=["text"],
    )
    async def send_voice(self, stream_id: str = "", text: str = "", **kwargs: Any):
        del kwargs
        ok, reason = await self._send_generated(stream_id, "voice", lambda: generate_speech(text))
        return ok, "已发一条语音" if ok else reason

    @Action(
        "xumeng_send_photo",
        description="用 OpenRouter 生图后发送一张照片。照片应该像角色此刻随手拍到的生活片段，只有用户想看或聊天确实需要视觉回应时使用。",
        activation_type=ActivationType.ALWAYS,
        action_parameters={"prompt": "照片内容和氛围，简短具体，不包含用户隐私"},
        action_require=["用户明确要照片或想看你在做什么时使用", "同一轮最多一张", "不要凭空泄露真实位置或敏感信息"],
        associated_types=["text"],
    )
    async def send_photo(self, stream_id: str = "", prompt: str = "", **kwargs: Any):
        del kwargs
        ok, reason = await self._send_generated(stream_id, "image", lambda: generate_image(prompt))
        return ok, "已发一张照片" if ok else reason


def create_plugin() -> XumengMediaPlugin:
    return XumengMediaPlugin()

