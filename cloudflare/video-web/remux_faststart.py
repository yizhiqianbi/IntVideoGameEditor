#!/usr/bin/env python3
"""Replace fragmented episode MP4s with progressive faststart MP4s.

Downloads one object at a time, remuxes without re-encoding, and uploads it
back to the same key through the authorized multipart import API.
"""
import json, os, re, shutil, subprocess, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

WEB = os.path.dirname(os.path.abspath(__file__))
TOKEN = open(os.path.join(WEB, ".import_token")).read().strip()
BASE = "https://video.xumengchat.top"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
PROGRESS = os.path.join(WEB, "faststart-progress.json")
CHUNK = 8 * 1024 * 1024
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36"
HDR = {"x-import-token": TOKEN}
KEY = re.compile(r"^video/huangguo/([0-9]{4,8})/ep-([0-9]{3})\.mp4$")
lock = threading.Lock()


def load_progress():
    if not os.path.exists(PROGRESS):
        return {}
    try:
        body = json.load(open(PROGRESS))
    except Exception:
        return {}
    items = body.get("items", body) if isinstance(body, dict) else {}
    return items if isinstance(items, dict) else {}


progress = load_progress()


def save():
    tmp = PROGRESS + ".tmp"
    with open(tmp, "w") as handle:
        json.dump({
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "items": progress,
        }, handle, ensure_ascii=False)
    os.replace(tmp, PROGRESS)


def api(method, path, **kwargs):
    last = ""
    for attempt in range(4):
        try:
            response = requests.request(method, BASE + path, timeout=900, **kwargs)
            if response.status_code < 300:
                return response
            last = f"{response.status_code} {response.text[-300:]}"
        except Exception as exc:
            last = repr(exc)
        time.sleep(2 + attempt)
    raise RuntimeError(last)


def top_boxes(path, limit=8):
    found = []
    size = os.path.getsize(path)
    with open(path, "rb") as handle:
        pos = 0
        while pos + 8 <= size and len(found) < limit:
            handle.seek(pos)
            header = handle.read(16)
            box_size = int.from_bytes(header[:4], "big")
            box_type = header[4:8].decode("latin1", "replace")
            header_size = 8
            if box_size == 1:
                if len(header) < 16:
                    break
                box_size = int.from_bytes(header[8:16], "big")
                header_size = 16
            if box_size < header_size:
                break
            found.append((box_type, pos, box_size))
            pos += box_size
    return found


def is_faststart(path):
    found = top_boxes(path)
    moov = next((box for box in found if box[0] == "moov"), None)
    mdat = next((box for box in found if box[0] == "mdat"), None)
    if any(box[0] == "moof" for box in found) or not moov or not mdat:
        return False
    return moov[1] < mdat[1] and moov[2] >= 2048


def header_is_faststart(data):
    pos = 0
    moov = None
    while pos + 8 <= len(data):
        box_size = int.from_bytes(data[pos:pos + 4], "big")
        box_type = data[pos + 4:pos + 8].decode("latin1", "replace")
        header_size = 8
        if box_size == 1:
            if pos + 16 > len(data):
                break
            box_size = int.from_bytes(data[pos + 8:pos + 16], "big")
            header_size = 16
        if box_size < header_size:
            return False
        if box_type == "moof":
            return False
        if box_type == "moov":
            moov = box_size
            break
        if pos + box_size > len(data):
            break
        pos += box_size
    return bool(moov and moov >= 2048)


def duration_of(path):
    run = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, timeout=180,
    )
    if run.returncode != 0:
        raise RuntimeError(run.stderr[-500:])
    value = float(run.stdout.strip() or "0")
    if value <= 0.5:
        raise RuntimeError(f"duration {value}")
    return value


def free_bytes():
    return shutil.disk_usage("/tmp").free


def wait_for_disk(need):
    while free_bytes() < need:
        time.sleep(15)


def download(url, dest):
    part = dest + ".part"
    run = subprocess.run(
        ["curl", "-fL", "--retry", "5", "--retry-all-errors", "--retry-delay", "2", "-A", UA, "-o", part, url],
        capture_output=True, text=True, timeout=3600,
    )
    if run.returncode != 0:
        raise RuntimeError((run.stderr or "download failed")[-500:])
    os.replace(part, dest)


def remux(src, dest):
    run = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-c", "copy", "-movflags", "+faststart", dest],
        capture_output=True, timeout=1800,
    )
    if run.returncode != 0:
        raise RuntimeError(run.stderr.decode("utf-8", "replace")[-1500:])


def upload(key, path):
    started = api("POST", "/api/import/multipart/start", headers=HDR, json={"key": key, "contentType": "video/mp4"}).json()
    upload_id = started["uploadId"]
    parts = []
    number = 1
    try:
        with open(path, "rb") as handle:
            while True:
                data = handle.read(CHUNK)
                if not data:
                    break
                headers = {**HDR, "x-key": key, "x-upload-id": upload_id, "x-part-number": str(number)}
                response = api("PUT", "/api/import/multipart/part", headers=headers, data=data)
                parts.append({"partNumber": number, "etag": response.json()["etag"]})
                number += 1
        if not parts:
            raise RuntimeError("empty upload")
        api("POST", "/api/import/multipart/complete", headers=HDR, json={"key": key, "uploadId": upload_id, "parts": parts})
    except Exception:
        try:
            api("POST", "/api/import/multipart/abort", headers=HDR, json={"key": key, "uploadId": upload_id})
        except Exception:
            pass
        raise


def verify_remote(key):
    response = requests.get(
        f"{BASE}/media/{key}",
        params={"check": str(int(time.time()))},
        headers={"User-Agent": UA, "Range": "bytes=0-65535"},
        timeout=90,
    )
    if response.status_code not in (200, 206):
        raise RuntimeError(f"verify http {response.status_code}")
    if not header_is_faststart(response.content):
        raise RuntimeError("uploaded object is still fragmented")


def catalog_keys():
    response = requests.get(f"{BASE}/catalog.json", headers={"User-Agent": UA, "Accept": "application/json"}, timeout=90)
    response.raise_for_status()
    body = response.json()
    keys = []
    seen = set()
    for item in body.get("items") or []:
        key = item.get("mediaKey") if isinstance(item, dict) else ""
        if not isinstance(key, str) or key in seen or not KEY.match(key):
            continue
        seen.add(key)
        keys.append(key)

    def order(key):
        match = KEY.match(key)
        return (-int(match.group(1)), int(match.group(2)))

    keys.sort(key=order)
    return keys


def remember(key, **fields):
    with lock:
        progress[key] = fields
        save()


def convert(key):
    with lock:
        previous = progress.get(key) or {}
    if previous.get("status") == "success":
        return previous
    work = tempfile.mkdtemp(prefix="faststart-")
    src = os.path.join(work, "source.mp4")
    out = os.path.join(work, "fast.mp4")
    try:
        wait_for_disk(2 * 1024 * 1024 * 1024)
        download(f"{BASE}/media/{key}", src)
        source_size = os.path.getsize(src)
        if is_faststart(src):
            record = {"status": "success", "bytes": source_size, "note": "already-faststart"}
            remember(key, **record)
            return record
        before = duration_of(src)
        remux(src, out)
        output_size = os.path.getsize(out)
        if output_size < source_size * 0.9:
            raise RuntimeError(f"remux shrank {source_size} to {output_size}")
        if not is_faststart(out):
            raise RuntimeError("remux did not put the index at the front")
        after = duration_of(out)
        if abs(after - before) > 2:
            raise RuntimeError(f"duration changed {before} -> {after}")
        upload(key, out)
        verify_remote(key)
        record = {"status": "success", "bytes": output_size, "duration": round(after, 3)}
        remember(key, **record)
        return record
    except Exception as exc:
        record = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"[-800:]}
        remember(key, **record)
        return record
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    keys = catalog_keys()
    only = os.environ.get("REMUX_ONLY", "").strip()
    if only:
        keys = [key for key in keys if key == only]
    pending = [key for key in keys if (progress.get(key) or {}).get("status") != "success"]
    limit = int(os.environ.get("REMUX_LIMIT") or "0")
    if limit > 0:
        pending = pending[:limit]
    workers = max(1, int(os.environ.get("REMUX_WORKERS") or "2"))
    print({"catalog": len(keys), "pending": len(pending), "workers": workers}, flush=True)
    if not pending:
        return

    def run(batch):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(convert, key) for key in batch]
            for index, future in enumerate(as_completed(futures), 1):
                result = future.result()
                print({"done": index, "total": len(batch), **result}, flush=True)

    run(pending)
    failed = [key for key in pending if (progress.get(key) or {}).get("status") != "success"]
    if failed:
        print({"retry": len(failed)}, flush=True)
        run(failed)
    with lock:
        save()
    print({
        "success": sum(item.get("status") == "success" for item in progress.values()),
        "failed": sum(item.get("status") == "failed" for item in progress.values()),
    }, flush=True)


if __name__ == "__main__":
    main()
