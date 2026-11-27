#!/usr/bin/env python3
import json
import subprocess
import time
from pathlib import Path

ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor')
DUMP = ROOT / 'huangguoai_dump'
SITE = ROOT / 'cloudflare/video-web'

def progress(path):
    data = json.loads(path.read_text())
    items = data.get('items', {}).values()
    counts = {}
    for item in items:
        status = item.get('status', 'unknown')
        counts[status] = counts.get(status, 0) + 1
    return data.get('total', 0), counts

last_signature = None
while True:
    try:
        video_total, video_counts = progress(DUMP / 'import_progress.json')
        cover_total, cover_counts = progress(DUMP / 'cover_upload_progress.json')
        signature = (video_counts.get('success', 0), video_counts.get('failed', 0), cover_counts.get('success', 0), cover_counts.get('failed', 0))
        complete = video_counts.get('success', 0) + video_counts.get('failed', 0) >= video_total and cover_counts.get('success', 0) + cover_counts.get('failed', 0) >= cover_total
        if signature != last_signature:
            print({'video': video_counts, 'covers': cover_counts}, flush=True)
            subprocess.run(['python3', str(ROOT / 'merge_huangguo_catalog.py')], cwd=ROOT, check=True)
            result = subprocess.run(['npm', 'run', 'deploy'], cwd=SITE, capture_output=True, text=True)
            print({'deploy': result.returncode, 'tail': (result.stdout + result.stderr)[-800:]}, flush=True)
            last_signature = signature
        if complete:
            print('all import tasks settled; final catalog deployed', flush=True)
            break
    except Exception as exc:
        print({'watcherError': repr(exc)}, flush=True)
    time.sleep(600)
