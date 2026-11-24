"""Chunked still uploads into Comfy input/pencil_stills."""
import asyncio
import base64
import re
from pathlib import Path
from aiohttp import web
import folder_paths
from server import PromptServer

ROOT = Path(folder_paths.get_input_directory()) / "pencil_stills"
ROOT.mkdir(exist_ok=True)
LOCK = asyncio.Lock()
EXTS = {"png", "jpg", "jpeg", "webp"}
MAX_CHUNK = 4 * 1024 * 1024
MAX_BYTES = 512 * 1024 * 1024
MAX_CHUNKS = 256
NODE_CLASS_MAPPINGS = {}


def dest(media_id, ext="bin"):
    if not re.fullmatch(r"[a-f0-9]{32}", media_id):
        raise ValueError("图片 ID 无效")
    if ext not in EXTS and ext != "bin":
        raise ValueError("图片格式无效")
    return ROOT / f"{media_id}.{ext}"


@PromptServer.instance.routes.post("/pencil/input-image")
async def upload(request):
    try:
        data = await request.json()
        media_id = data["id"]
        ext = str(data.get("ext") or "png").lower()
        if ext == "jpeg":
            ext = "jpg"
        if ext not in EXTS:
            raise ValueError("图片请使用 PNG、JPEG 或 WebP")
        index, total = data["index"], data["total"]
        if type(index) is not int or type(total) is not int or not 0 <= index < total <= MAX_CHUNKS:
            raise ValueError("分片数量无效")
        chunk = base64.b64decode(data["data"], validate=True)
        if not 0 < len(chunk) <= MAX_CHUNK:
            raise ValueError("分片过大")
        path = dest(media_id, "bin")
        meta = path.with_suffix(".idx")
        async with LOCK:
            if dest(media_id, ext).exists():
                raise ValueError("图片已上传，请使用新的 ID")
            next_index = int(meta.read_text()) if meta.exists() else 0
            if index != next_index:
                raise ValueError("分片顺序错误，请重新上传")
            size = path.stat().st_size if path.exists() else 0
            if size + len(chunk) > MAX_BYTES:
                raise ValueError("参考图没有写完，请重新上传")
            with path.open("ab") as handle:
                handle.write(chunk)
            if index == total - 1:
                if meta.exists():
                    meta.unlink()
                final = dest(media_id, ext)
                path.rename(final)
                return web.json_response(
                    {
                        "file": f"pencil_stills/{final.name}",
                        "size": size + len(chunk),
                    }
                )
            meta.write_text(str(index + 1))
            return web.json_response({"uploaded": index + 1, "total": total})
    except Exception as error:
        return web.json_response({"error": str(error)}, status=400)
