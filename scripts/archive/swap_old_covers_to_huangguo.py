#!/usr/bin/env python3
import json
import shutil
import time
from pathlib import Path

ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor')
SITE = ROOT / 'cloudflare/video-web'
DUMP = ROOT / 'huangguoai_dump'
catalog_path = SITE / 'public/catalog.json'
catalog = json.loads(catalog_path.read_text())
source = json.loads((DUMP / 'playability.json').read_text()).get('items', [])
cover_progress = json.loads((DUMP / 'cover_upload_progress.json').read_text()).get('items', {})

by_title = {}
for series in source:
    sid = str(series.get('id'))
    cover = cover_progress.get(sid, {})
    if cover.get('status') != 'success':
        continue
    ext = Path(cover.get('path', '')).suffix.lower() or '.jpg'
    by_title.setdefault(str(series.get('title') or '').strip(), f'posters/huangguo/{sid}{ext}')

backup = catalog_path.with_name(f'catalog.before_cover_swap.{time.strftime("%Y%m%d-%H%M%S")}.json')
shutil.copy2(catalog_path, backup)
changed = 0
unmatched = 0
for item in catalog.get('items', []):
    if str(item.get('id', '')).startswith('hg-'):
        continue
    title = str(item.get('title') or '').strip()
    poster = by_title.get(title)
    if poster:
        item['posterKey'] = poster
        item['coverSource'] = '黄果公开封面授权导入'
        changed += 1
    else:
        unmatched += 1

catalog['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'changedItems': changed, 'unmatchedOldItems': unmatched, 'backup': str(backup)}, ensure_ascii=False))
