#!/usr/bin/env python3
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor')
PROGRESS = ROOT / 'huangguoai_dump/import_progress.json'
while True:
    result = subprocess.run(['python3', str(ROOT / 'import_huangguo_multipart.py')], cwd=ROOT, env={**os.environ, 'HG_WORKERS': os.environ.get('HG_WORKERS', '8')})
    try:
        data = json.loads(PROGRESS.read_text())
        success = sum(v.get('status') == 'success' for v in data.get('items', {}).values())
        total = int(data.get('total') or 0)
    except Exception:
        success = 0
        total = 0
    print({'importerExit': result.returncode, 'success': success, 'total': total}, flush=True)
    if total and success >= total:
        break
    time.sleep(10)
