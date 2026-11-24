"""ComfyUI extension. Private, immutable ZIP archives on AutoDL's persistent disk."""
import base64
import datetime
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import zipfile
from aiohttp import web
from server import PromptServer

ROOT = Path(os.environ.get("PENCIL_ARCHIVE_DIR", "/root/autodl-tmp/pencil-archives"))
TOKEN_FILE = Path(os.environ.get("PENCIL_ARCHIVE_TOKEN_FILE", "/root/.pencil-archive-token"))
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

def folder(request):
    token = os.environ.get("DRAMA_ARCHIVE_TOKEN") or (TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else "")
    if not token or not hmac.compare_digest(request.headers.get("Authorization", ""), "Bearer " + token):
        raise web.HTTPUnauthorized()
    vault = request.headers.get("X-Archive-Vault", "")
    if not UUID.fullmatch(vault):
        raise web.HTTPBadRequest()
    path = ROOT / vault
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path

@PromptServer.instance.routes.get("/pencil/archives")
async def list_archives(request):
    path = folder(request)
    archive_id = request.query.get("id")
    if archive_id:
        if not UUID.fullmatch(archive_id):
            raise web.HTTPBadRequest()
        target = path / (archive_id + ".zip")
        if not target.is_file():
            raise web.HTTPNotFound()
        part = request.query.get("part", "0")
        if not part.isdigit() or int(part) > 1023:
            raise web.HTTPBadRequest()
        with target.open("rb") as source:
            source.seek(int(part) * 512 * 1024)
            data = source.read(512 * 1024)
        return web.Response(body=data, headers={"Content-Type": "application/octet-stream", "X-Archive-Size": str(target.stat().st_size)})
    archives = []
    for meta in path.glob("*.json"):
        if meta.with_suffix(".zip").exists():
            archives.append(json.loads(meta.read_text()))
    return web.json_response({"archives": sorted(archives, key=lambda x: x["savedAt"], reverse=True)})

@PromptServer.instance.routes.post("/pencil/archives")
async def upload_archive(request):
    path = folder(request)
    if request.content_length and request.content_length > 800000:
        raise web.HTTPRequestEntityTooLarge(max_size=800000, actual_size=request.content_length)
    body = await request.json()
    archive_id, index, total = body.get("id", ""), body.get("index"), body.get("total")
    if not UUID.fullmatch(archive_id) or type(index) is not int or type(total) is not int or not 0 <= index < total <= 1024:
        raise web.HTTPBadRequest()
    if (path / (archive_id + ".zip")).exists():
        raise web.HTTPConflict()
    try:
        chunk = base64.b64decode(body.get("data", ""), validate=True)
    except Exception:
        raise web.HTTPBadRequest()
    if not chunk or len(chunk) > 512 * 1024:
        raise web.HTTPBadRequest()
    parts = path / (archive_id + ".parts")
    parts.mkdir(exist_ok=True)
    (parts / str(index)).write_bytes(chunk)
    if index != total - 1:
        return web.json_response({"ok": True})
    if not all((parts / str(i)).is_file() for i in range(total)):
        raise web.HTTPBadRequest(text="Missing chunks")
    temp = path / (archive_id + ".tmp")
    try:
        with temp.open("wb") as output:
            for i in range(total):
                with (parts / str(i)).open("rb") as source:
                    shutil.copyfileobj(source, output)
        with zipfile.ZipFile(temp) as archive:
            infos=archive.infolist()
            if sum(i.file_size for i in infos)>512*1024*1024 or any(i.filename.startswith("/") or ".." in Path(i.filename).parts for i in infos):
                raise ValueError("Invalid archive")
            info=archive.getinfo("project.json")
            if info.file_size>4*1024*1024:
                raise ValueError("Manifest too large")
            doc=json.loads(archive.read("project.json"))
            if doc.get("format")!="pencil-drama" or doc.get("version")!=2:
                raise ValueError("Invalid format")
        meta={"id":archive_id,"title":str(doc.get("title","未命名短剧"))[:300],"savedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()}
        (path / (archive_id + ".json")).write_text(json.dumps(meta,ensure_ascii=False))
        temp.replace(path / (archive_id + ".zip"))
        shutil.rmtree(parts)
    except (ValueError,KeyError,zipfile.BadZipFile):
        temp.unlink(missing_ok=True)
        raise web.HTTPBadRequest(text="Invalid archive")
    return web.json_response({"ok":True,"id":archive_id})

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
