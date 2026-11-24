"""Small OpenAI-compatible service for the Qwen Image 2.1 Heretic encoder.

This service is intentionally separate from ComfyUI/H3.  It exposes the
encoder's text generation capability for prompt drafting and health checks;
the Hugging Face repository is a text-encoder checkpoint, not a complete
Qwen Image diffusion pipeline.
"""
from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoConfig, AutoProcessor, Qwen3VLForConditionalGeneration


MODEL_ID = os.getenv(
    "QWEN_IMAGE_HERETIC_MODEL",
    "pottokao/Qwen-Image-2.1-Text-Encoder-Heretic",
)
MODEL_DIR = os.getenv("QWEN_IMAGE_HERETIC_DIR", MODEL_ID)
HOST = os.getenv("QWEN_IMAGE_HERETIC_HOST", "127.0.0.1")
PORT = int(os.getenv("QWEN_IMAGE_HERETIC_PORT", "6110"))
MAX_NEW_TOKENS = int(os.getenv("QWEN_IMAGE_HERETIC_MAX_NEW_TOKENS", "512"))

print(f"[qwen-image-heretic] loading {MODEL_DIR}", flush=True)
processor = AutoProcessor.from_pretrained(MODEL_DIR)
config = AutoConfig.from_pretrained(MODEL_DIR)
# Older Qwen Image 2.1 exports omit this optional field, while recent
# Transformers reads it unconditionally for the Qwen3-VL text tower.
if getattr(config, "text_config", None) is not None and getattr(config.text_config, "rope_scaling", None) is None:
    config.text_config.rope_scaling = {"type": "default", "mrope_section": [24, 20, 20]}
model = Qwen3VLForConditionalGeneration.from_pretrained(
    MODEL_DIR,
    torch_dtype=torch.bfloat16,
    config=config,
)
device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
model.to(device)
model.eval()
generate_lock = threading.Lock()
print(f"[qwen-image-heretic] ready on {device}", flush=True)


def generate_text(messages: list[dict], max_new_tokens: int) -> str:
    chat = processor.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = processor(text=[chat], return_tensors="pt", padding=True)
    inputs = {key: value.to(device) if hasattr(value, "to") else value for key, value in inputs.items()}
    with generate_lock, torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    prompt_tokens = inputs["input_ids"].shape[-1]
    return processor.batch_decode(output[:, prompt_tokens:], skip_special_tokens=True)[0].strip()


class Handler(BaseHTTPRequestHandler):
    def _json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json({
                "service": "qwen-image-2.1-heretic-text",
                "model": MODEL_ID,
                "ready": True,
                "device": str(device),
            })
            return
        self._json({"error": "not_found"}, 404)

    def do_POST(self):
        if self.path not in ("/v1/chat/completions", "/v1/prompt"):
            self._json({"error": "not_found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 2_000_000:
                raise ValueError("request too large")
            body = json.loads(self.rfile.read(length) or b"{}")
            raw_messages = body.get("messages")
            if raw_messages is None:
                prompt = str(body.get("prompt") or "").strip()
                raw_messages = [{"role": "user", "content": prompt}]
            if not isinstance(raw_messages, list) or not raw_messages:
                raise ValueError("messages or prompt is required")
            messages = []
            for item in raw_messages:
                if not isinstance(item, dict):
                    raise ValueError("invalid message")
                content = item.get("content", "")
                if isinstance(content, list):
                    content = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
                messages.append({"role": str(item.get("role", "user")), "content": str(content)})
            answer = generate_text(messages, min(int(body.get("max_tokens", MAX_NEW_TOKENS)), 2048))
            if self.path == "/v1/prompt":
                self._json({"model": MODEL_ID, "text": answer})
            else:
                self._json({
                    "id": f"qwen-heretic-{int(time.time())}",
                    "object": "chat.completion",
                    "model": MODEL_ID,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
                })
        except Exception as error:
            self._json({"error": str(error)}, 400)

    def log_message(self, *_args):
        return


ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
