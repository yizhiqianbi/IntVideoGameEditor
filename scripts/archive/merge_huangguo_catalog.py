#!/usr/bin/env python3
import json
import time
from pathlib import Path

ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor')
SITE = ROOT / 'cloudflare/video-web'
DUMP = ROOT / 'huangguoai_dump'

catalog = json.loads((SITE / 'public/catalog.json').read_text())
playability = json.loads((DUMP / 'playability.json').read_text())
video_progress = json.loads((DUMP / 'import_progress.json').read_text()).get('items', {})
cover_progress = json.loads((DUMP / 'cover_upload_progress.json').read_text()).get('items', {})

old_items = [item for item in catalog.get('items', []) if not str(item.get('id', '')).startswith('hg-')]
hg_items = []
for series in playability.get('items', []):
    sid = str(series['id'])
    cover = cover_progress.get(sid, {})
    if cover.get('status') != 'success':
        continue
    cover_path = Path(cover.get('path', ''))
    ext = cover_path.suffix.lower() or '.jpg'
    poster_key = f'posters/huangguo/{sid}{ext}'
    for ep in series.get('episodes', []):
        eno = int(ep['episode'])
        task = video_progress.get(f'{sid}:{eno}', {})
        if task.get('status') != 'success':
            continue
        hg_items.append({
            'id': f'hg-{sid}-{eno}',
            'dramaId': f'hg-{sid}',
            'title': series.get('title') or sid,
            'episode': f'第{eno:02d}集',
            'file': f'hg-{sid}-{eno}.mp4',
            'mediaKey': task.get('key') or f'video/huangguo/{sid}/ep-{eno:03d}.mp4',
            'posterKey': poster_key,
            'category': series.get('category') or 'AI成人短剧',
            'badge': '已导入',
            'source': '黄果公开HLS授权导入',
        })

hg_items.sort(key=lambda x: (int(x['dramaId'].split('-')[1]), int(x['episode'].replace('第', '').replace('集', ''))), reverse=True)
catalog['brand'] = catalog.get('brand') or '叙梦短剧'
catalog['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
catalog['items'] = hg_items + old_items
catalog['importedCount'] = len(catalog['items'])
catalog['sourceDramaCount'] = len({x['dramaId'] for x in catalog['items']})
(SITE / 'public/catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'huangguoImported': len(hg_items), 'totalItems': len(catalog['items']), 'coversReady': sum(v.get('status') == 'success' for v in cover_progress.values())}, ensure_ascii=False))
