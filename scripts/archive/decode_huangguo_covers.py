#!/usr/bin/env python3
"""Upload the publicly decoded huangguo covers over the encrypted copies."""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor')
WEB = ROOT / 'cloudflare/video-web'
DUMP = ROOT / 'huangguoai_dump'
COVERS = DUMP / 'covers'
PROGRESS = DUMP / 'cover_decode_progress.json'
TOKEN = (WEB / '.import_token').read_text().strip()
BASE = 'https://video.xumengchat.top'
# Published by the source site's image decoder. These covers were stored still encoded.
KEY = b'f5d965df75336270'
IV = b'97b60394abc2fbe1'
HDR = {'x-import-token': TOKEN}
lock = threading.Lock()

def decode(blob: bytes):
    if len(blob) == 0 or len(blob) % 16 != 0:
        raise RuntimeError('cover is not a complete encoded block')
    decryptor = Cipher(algorithms.AES(KEY), modes.CBC(IV)).decryptor()
    plain = decryptor.update(blob) + decryptor.finalize()
    if plain.startswith(b'\xff\xd8'):
        return plain, 'image/jpeg'
    if plain.startswith(b'\x89PNG'):
        return plain, 'image/png'
    if plain.startswith(b'RIFF') and plain[8:12] == b'WEBP':
        return plain, 'image/webp'
    raise RuntimeError('decoded cover is not an image')

def load_progress():
    if not PROGRESS.exists():
        return {}
    try:
        return json.loads(PROGRESS.read_text()).get('items', {})
    except Exception:
        return {}

progress = load_progress()

def save():
    tmp = str(PROGRESS) + '.tmp'
    Path(tmp).write_text(json.dumps({'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'items': progress}, ensure_ascii=False))
    os.replace(tmp, PROGRESS)

def api(method, path, **kwargs):
    last = ''
    for attempt in range(4):
        try:
            response = requests.request(method, BASE + path, timeout=180, **kwargs)
            if response.status_code < 300:
                return response
            last = f'{response.status_code} {response.text[-180:]}'
        except Exception as exc:
            last = repr(exc)
        time.sleep(1 + attempt)
    raise RuntimeError(last)

def upload(path: Path):
    sid = path.stem
    key = f'posters/huangguo/{path.name}'
    with lock:
        if progress.get(sid, {}).get('status') == 'success':
            return progress[sid]
        progress[sid] = {'id': sid, 'key': key, 'status': 'uploading'}
        save()
    upload_id = None
    try:
        body, content_type = decode(path.read_bytes())
        upload_id = api('POST', '/api/import/multipart/start', headers=HDR, json={'key': key, 'contentType': content_type}).json()['uploadId']
        headers = {**HDR, 'x-key': key, 'x-upload-id': upload_id, 'x-part-number': '1'}
        etag = api('PUT', '/api/import/multipart/part', headers=headers, data=body).json()['etag']
        api('POST', '/api/import/multipart/complete', headers=HDR, json={'key': key, 'uploadId': upload_id, 'parts': [{'partNumber': 1, 'etag': etag}]})
        record = {'id': sid, 'key': key, 'status': 'success', 'bytes': len(body), 'type': content_type}
    except Exception as exc:
        if upload_id:
            try:
                api('POST', '/api/import/multipart/abort', headers=HDR, json={'key': key, 'uploadId': upload_id})
            except Exception:
                pass
        record = {'id': sid, 'key': key, 'status': 'failed', 'error': repr(exc)[:300]}
    with lock:
        progress[sid] = record
        save()
    return record

def main():
    files = [path for path in COVERS.iterdir() if path.is_file() and path.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}]
    files.sort(key=lambda path: int(path.stem) if path.stem.isdigit() else 0, reverse=True)
    pending = [path for path in files if progress.get(path.stem, {}).get('status') != 'success']
    print({'covers': len(files), 'pending': len(pending)}, flush=True)
    workers = int(os.environ.get('HG_COVER_WORKERS', '4'))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(upload, path) for path in pending]
        for index, future in enumerate(as_completed(futures), 1):
            record = future.result()
            if index % 100 == 0 or record.get('status') == 'failed' or index == len(pending):
                print({'done': index, 'total': len(pending), 'status': record.get('status'), 'id': record.get('id')}, flush=True)
    print({'success': sum(item.get('status') == 'success' for item in progress.values()), 'failed': sum(item.get('status') == 'failed' for item in progress.values())}, flush=True)

if __name__ == '__main__':
    main()
