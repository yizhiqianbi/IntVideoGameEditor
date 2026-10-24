"""Qingyu media review and per-account speech provenance. No native engine starts here."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import time
import uuid
from typing import Any, Callable

POLICY = json.loads((Path(__file__).parent / "review-policy.json").read_text(encoding="utf-8"))


def review_content(value: Any, post: Callable) -> None:
    content = [{"type": "text", "text": "将下列所有图片与文字合并审核，最终只返回一个 JSON 对象，不返回数组："}, *value] if isinstance(value, list) else json.dumps({"content": value}, ensure_ascii=False)
    model = os.environ.get("COMPANION_REVIEW_MODEL", "qwen/qwen3.6-plus")
    _, raw = post("/chat/completions", {
        "model": model,
        "stream": False, "temperature": 0, "max_tokens": 256,
        "provider": {"require_parameters": True},
        **POLICY.get("modelOptions", {}).get(model, {}),
        "messages": [{"role": "system", "content": POLICY["system"]}, {"role": "user", "content": content}],
        "response_format": POLICY["responseFormat"],
    })
    try:
        body = json.loads(raw)
        choices = body["choices"]
        if len(choices) != 1 or choices[0]["finish_reason"] != "stop" or choices[0]["message"].get("refusal"):
            raise ValueError()
        result = json.loads(choices[0]["message"]["content"])
        if set(result) != {"decision", "categories"} or result["decision"] != "allowed" or result["categories"] != []:
            raise ValueError()
    except (ValueError, KeyError, TypeError, IndexError) as error:
        raise RuntimeError("媒体内容尚未通过全年龄检查。") from error


def speech_review_scope() -> tuple[str, str, bytes]:
    secret = os.environ.get("COMPANION_MEDIA_REVIEW_SECRET", "")
    profile = os.environ.get("COMPANION_PROFILE", "classic")
    try:
        account = str(uuid.UUID(os.environ.get("COMPANION_ACCOUNT_ID", "")))
        if len(secret) < 32 or profile not in {"classic", "intimate", "traveler"}:
            raise ValueError()
    except ValueError as error:
        raise RuntimeError("语音内容检查尚未完成配置。") from error
    return account, profile, secret.encode("utf-8")


def record_reviewed_speech(raw: bytes, text: str) -> dict:
    account, profile, secret = speech_review_scope()
    proof = {"version": 1, "kind": "audio", "accountId": account, "profile": profile,
        "sha256": hashlib.sha256(raw).hexdigest(), "text": text, "reviewedAt": int(time.time() * 1000)}
    payload = json.dumps([1, "audio", account, profile, proof["sha256"], text, proof["reviewedAt"]], ensure_ascii=False, separators=(",", ":"))
    proof["signature"] = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    directory = Path(os.environ.get("MAIBOT_INSTANCE_DIR", "/var/lib/qingyu-companion/instance")) / "data/qingyu-reviewed-speech"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / f"{proof['sha256']}.json"
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        previous = json.loads(path.read_text(encoding="utf-8"))
        if any(previous.get(key) != proof[key] for key in ("version", "kind", "accountId", "profile", "sha256", "text")):
            raise RuntimeError("语音来源记录不一致，未发送这条语音。")
        return previous
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(proof, stream, ensure_ascii=False, separators=(",", ":"))
    return proof
