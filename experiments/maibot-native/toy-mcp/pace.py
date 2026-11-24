"""用 Jev 看最近几句对话，决定模拟玩具的震速。不连接真实硬件。"""

from __future__ import annotations

import json
import os
import sys
import threading
import tomllib
import urllib.error
import urllib.request

MODEL = "typesafe/jev-1.14"
ENDPOINT = "https://openrouter.ai/api/alpha/decisions"

_STOP_EXACT = {"停", "停下", "不要", "不想", "太痛"}
_STOP_PHRASES = ("太痛", "停下", "停一下", "不要了", "不想要", "不想继续")
_KEEP_GOING = ("不要停", "别停", "不准停")


def wants_stop(text: str) -> bool:
    raw = "".join(str(text or "").split())
    if any(phrase in raw for phrase in _KEEP_GOING):
        return False
    if raw in _STOP_EXACT:
        return True
    return any(phrase in raw for phrase in _STOP_PHRASES)


def level_from_answers(answers: dict) -> tuple[int, str]:
    halt = float((answers.get("halt") or {}).get("noul") or 0)
    moving = float((answers.get("moving") or {}).get("noul") or 0)
    score = float((answers.get("pace") or {}).get("score") or 0)
    if halt >= 0.65 or moving < 0.42:
        return 0, "off"
    score = max(0.0, min(4.0, score))
    intensity = max(4, min(20, 4 + round(score / 4 * 16)))
    if score < 1.3:
        pattern = "pulse"
    elif score < 2.6:
        pattern = "wave"
    else:
        pattern = "escalate"
    return intensity, pattern


def _key() -> str:
    value = os.environ.get("COMPANION_OPENROUTER_API_KEY", "").strip()
    if value:
        return value
    root = os.environ.get("MAIBOT_INSTANCE_DIR", "").strip()
    if not root:
        raise RuntimeError("没有 OpenRouter 密钥")
    parsed = tomllib.loads(open(os.path.join(root, "config", "model_config.toml"), "rb").read().decode("utf-8"))
    providers = parsed.get("api_providers") or []
    provider = providers[0] if providers and isinstance(providers[0], dict) else {}
    key = str(provider.get("api_key") or "").strip()
    if not key:
        raise RuntimeError("没有 OpenRouter 密钥")
    return key


def ask(messages: list[dict]) -> dict:
    state = {
        "scene": "两个成年人的私密角色扮演。右边是一只模拟玩具，只根据最新几句决定震速。",
        "messages": messages[-8:],
    }
    payload = {
        "model": os.environ.get("TOY_PACE_MODEL", MODEL),
        "state": state,
        "questions": {
            "halt": {
                "type": "noul",
                "instructions": "最新一条用户的话是在要求停下、拒绝，或说太痛吗？",
                "criteria": {
                    "true": "用户要停、拒绝继续，或说痛。",
                    "false": "用户没有要求停下。说不要停，是在要求继续。",
                },
            },
            "moving": {
                "type": "noul",
                "instructions": "按最新几句，模拟玩具现在应该震动吗？",
                "criteria": {
                    "true": "正在亲热、脱衣服、命令继续，或明确要玩具动。",
                    "false": "只是打招呼、闲聊、问在不在，没有进入这件事。",
                },
            },
            "pace": {
                "type": "score",
                "instructions": "如果要震，这一下该有多快？只看最新几句，前面的平静对话不算数。",
                "criteria": [
                    "还没开始，只要很轻的一下。",
                    "刚贴上来或在解衣服，慢。",
                    "正在做，节奏稳定。",
                    "对方要更快、更重，或动作已经急。",
                    "到了最猛的一下，或对方明确要最快。",
                ],
            },
        },
    }
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Jev 没有给出震速：{error.code} {detail}") from error
    answers = body.get("answers")
    if not isinstance(answers, dict):
        raise RuntimeError("Jev 没有返回决定")
    return answers


def decide(messages: list[dict]) -> tuple[int, str]:
    cleaned = []
    for message in messages:
        text = str(message.get("text") or "").strip()
        if not text or text == "[语音]":
            continue
        role = "user" if message.get("role") == "user" else "bot"
        cleaned.append({"role": role, "text": text[:400]})
    if not cleaned:
        return 0, "off"
    latest_user = next((item["text"] for item in reversed(cleaned) if item["role"] == "user"), "")
    if wants_stop(latest_user):
        return 0, "off"
    return level_from_answers(ask(cleaned))


class Follower:
    def __init__(self, device, bridge) -> None:
        self.device = device
        self.bridge = bridge
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._seen = ""
        self._suspended = False
        self._applied: tuple[int, str] | None = None

    def start(self) -> None:
        threading.Thread(target=self._loop, name="toy-pace", daemon=True).start()

    def suspend(self) -> None:
        with self._lock:
            self._suspended = True
            self._applied = None

    def _loop(self) -> None:
        while not self._stop.wait(2):
            try:
                self._once()
            except Exception as error:  # noqa: BLE001 - 震速失败不能拖垮页面。
                sys.stderr.write(f"pace {error}\n")

    def _once(self) -> None:
        messages = self.bridge.snapshot().get("messages") or []
        signature = "\n".join(f"{item.get('id')}:{item.get('text')}" for item in messages[-8:])
        with self._lock:
            if signature != self._seen:
                self._seen = signature
                self._suspended = False
                self._applied = None
            suspended = self._suspended
            applied = self._applied
        if suspended or not signature:
            return
        if applied is not None:
            intensity, pattern = applied
            if intensity > 0:
                self.device.hold(90)
            return
        intensity, pattern = decide(messages)
        with self._lock:
            if self._seen != signature or self._suspended:
                return
        if intensity <= 0:
            if self.device.status().get("running"):
                self.device.stop()
        else:
            self.device.set(intensity, pattern, 90)
        with self._lock:
            if self._seen == signature and not self._suspended:
                self._applied = (intensity, pattern)
        sys.stderr.write(f"pace {intensity} {pattern}\n")
