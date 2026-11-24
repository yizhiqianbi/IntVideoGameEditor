#!/usr/bin/env python3
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor')
SITE = ROOT / 'cloudflare/video-web'
progress = json.loads((SITE / 'full_import_progress.json').read_text()).get('items', {})
keys = sorted({str(item.get('key')) for item in progress.values() if item.get('status') == 'success' and str(item.get('key', '')).startswith('video/full/')})
wrangler = str(SITE / 'node_modules/.bin/wrangler')

def delete(key):
    result = subprocess.run([wrangler, 'r2', 'object', 'delete', f'dzmm-media/{key}', '--remote', '-y'], cwd=SITE, capture_output=True, text=True, timeout=180)
    return {'key': key, 'ok': result.returncode == 0, 'output': (result.stdout + result.stderr)[-500:]}

results = []
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(delete, key) for key in keys]
    for idx, future in enumerate(as_completed(futures), 1):
        item = future.result()
        results.append(item)
        if idx % 25 == 0 or idx == len(keys):
            print({'done': idx, 'total': len(keys), 'failed': sum(not x['ok'] for x in results)}, flush=True)

out = ROOT / 'legacy_r2_delete_results.json'
out.write_text(json.dumps({'keys': keys, 'results': results}, ensure_ascii=False, indent=2) + '\n')
print({'total': len(keys), 'deleted': sum(x['ok'] for x in results), 'failed': sum(not x['ok'] for x in results), 'report': str(out)}, flush=True)
