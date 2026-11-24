#!/usr/bin/env python3
import html, json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

BASE = 'https://huangguoai.com'
ROOT = Path('/Users/pencil/Documents/IntVideoGameEditor/huangguoai_dump')
COVERS = ROOT / 'covers'
PAGES = ROOT / 'pages'
RECORDS = ROOT / 'records.jsonl'
ERRORS = ROOT / 'errors.jsonl'
ROOT.mkdir(parents=True, exist_ok=True)
COVERS.mkdir(parents=True, exist_ok=True)
PAGES.mkdir(parents=True, exist_ok=True)

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36'
TIMEOUT = (10, 45)

def get(url, session=None, stream=False):
    s = session or requests.Session()
    last = None
    for attempt in range(5):
        try:
            r = s.get(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,image/avif,image/webp,*/*'}, timeout=TIMEOUT, stream=stream)
            if r.status_code == 200:
                return r
            last = f'HTTP {r.status_code}'
        except Exception as exc:
            last = repr(exc)
        time.sleep(min(1 + attempt, 6))
    raise RuntimeError(f'{url}: {last}')

def sitemap_urls():
    urls = set()
    for n in range(1, 5):
        xml = get(f'{BASE}/sitemap/video/{n}.xml').text
        urls.update(re.findall(r'<loc>(https?://[^<]+/video/\d+/)</loc>', xml))
    return sorted(urls)

def parse_page(url, text):
    m = re.search(r'<script[^>]+id=["\']videoInitialData["\'][^>]*>(.*?)</script>', text, re.S | re.I)
    data = None
    if m:
        try:
            data = json.loads(html.unescape(m.group(1)))
        except Exception:
            data = None
    if not data:
        # JSON-LD is kept as a fallback for pages whose player payload is unavailable.
        for block in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', text, re.S | re.I):
            try:
                obj = json.loads(html.unescape(block))
                for item in obj.get('@graph', []) if isinstance(obj, dict) else []:
                    if item.get('@type') == 'VideoObject':
                        data = {'id': url.rstrip('/').split('/')[-1], 'title': item.get('isPartOf', {}).get('name') or item.get('name'), 'description': item.get('description', ''), 'posterSrc': (item.get('thumbnailUrl') or [None])[0], 'tags': item.get('genre') or [], 'total': None, 'ep': None}
                        break
            except Exception:
                pass
            if data: break
    if not data:
        raise RuntimeError('videoInitialData not found')
    cover = data.get('posterSrc') or data.get('coverSrc')
    cat = ''
    breadcrumb = data.get('breadcrumb') or []
    if breadcrumb:
        cat = breadcrumb[-2].get('name', '') if len(breadcrumb) > 1 else breadcrumb[0].get('name', '')
    return {
        'id': str(data.get('id') or url.rstrip('/').split('/')[-1]),
        'url': url,
        'title': data.get('title') or '',
        'category': cat,
        'tags': data.get('tags') or [],
        'description': data.get('description') or '',
        'totalEpisodes': data.get('total') or data.get('tracking', {}).get('total_episode'),
        'currentEpisode': data.get('ep'),
        'coverUrl': cover or '',
        'coverPath': '',
        'updatedAt': data.get('time') or '',
        'score': data.get('score') or '',
    }

def save_cover(rec, session):
    url = rec.get('coverUrl')
    if not url:
        return rec
    ext = Path(urlparse(url).path).suffix.lower()
    if ext not in {'.jpg', '.jpeg', '.png', '.webp'}:
        ext = '.jpg'
    path = COVERS / f"{rec['id']}{ext}"
    if not path.exists() or path.stat().st_size == 0:
        r = get(url, session=session, stream=True)
        with open(path, 'wb') as f:
            for chunk in r.iter_content(256 * 1024):
                if chunk:
                    f.write(chunk)
    rec['coverPath'] = str(path.relative_to(ROOT))
    return rec

def fetch_one(url):
    s = requests.Session()
    r = get(url, s)
    rec = parse_page(url, r.text)
    rec = save_cover(rec, s)
    return rec

def main():
    urls = sitemap_urls()
    print(json.dumps({'sitemap_urls': len(urls)}, ensure_ascii=False), flush=True)
    done = {}
    if RECORDS.exists():
        for line in RECORDS.read_text().splitlines():
            try:
                rec = json.loads(line); done[rec['id']] = rec
            except Exception:
                pass
    todo = [u for u in urls if u.rstrip('/').split('/')[-1] not in done]
    print(json.dumps({'already_done': len(done), 'todo': len(todo)}, ensure_ascii=False), flush=True)
    with RECORDS.open('a') as out, ERRORS.open('a') as err, ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_one, u): u for u in todo}
        for idx, future in enumerate(as_completed(futures), 1):
            u = futures[future]
            try:
                rec = future.result()
                out.write(json.dumps(rec, ensure_ascii=False) + '\n'); out.flush()
                done[rec['id']] = rec
                if idx % 25 == 0 or idx == len(todo):
                    print(json.dumps({'done': idx, 'total': len(todo), 'id': rec['id'], 'title': rec['title']}, ensure_ascii=False), flush=True)
            except Exception as exc:
                err.write(json.dumps({'url': u, 'error': repr(exc)}, ensure_ascii=False) + '\n'); err.flush()
                print(json.dumps({'error': repr(exc), 'url': u}, ensure_ascii=False), flush=True)
    records = sorted(done.values(), key=lambda x: int(x['id']) if str(x.get('id','')).isdigit() else 0, reverse=True)
    (ROOT / 'catalog.json').write_text(json.dumps({'source': BASE, 'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'count': len(records), 'items': records}, ensure_ascii=False, indent=2))
    print(json.dumps({'catalog': str(ROOT / 'catalog.json'), 'records': len(records)}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
