#!/usr/bin/env python3
import json
import shutil
import time
from pathlib import Path

path = Path('/Users/pencil/Documents/IntVideoGameEditor/cloudflare/video-web/public/catalog.json')
data = json.loads(path.read_text())
backup = path.with_name(f'catalog.before_legacy_delete.{time.strftime("%Y%m%d-%H%M%S")}.json')
shutil.copy2(path, backup)
old = [item for item in data.get('items', []) if not str(item.get('id', '')).startswith('hg-')]
data['items'] = [item for item in data.get('items', []) if str(item.get('id', '')).startswith('hg-')]
data['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
data['importedCount'] = len(data['items'])
data['sourceDramaCount'] = len({item.get('dramaId') for item in data['items']})
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'removedCatalogItems': len(old), 'remainingItems': len(data['items']), 'backup': str(backup)}, ensure_ascii=False))
