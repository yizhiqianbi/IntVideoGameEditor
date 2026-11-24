import json, os, shutil, subprocess, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin
import requests

ROOT = '/Users/pencil/Documents/IntVideoGameEditor'
WEB = ROOT + '/cloudflare/video-web'
INV = ROOT + '/hgtv_hls_estimate.json'
PROGRESS = WEB + '/full_import_progress.json'
TOKEN = open(WEB + '/.import_token').read().strip()
BASE = 'https://video.xumengchat.top'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
PART_SIZE = 8 * 1024 * 1024
HEADERS = {'x-import-token': TOKEN}
lock = threading.Lock()
progress = json.load(open(PROGRESS)).get('items', {})

TASKS = []
for item in json.load(open(INV))['items']:
    if item.get('status') == 200 and item.get('playlist_url'):
        TASKS.append({'episodeId': str(item['episode_id']), 'dramaId': str(item['drama_id']),
                      'dramaTitle': item['drama_title'], 'ep': item.get('ep'), 'title': item.get('title'),
                      'playlistUrl': item['playlist_url'], 'key': f"video/full/{item['episode_id']}.mp4"})

def save():
    tmp = PROGRESS + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'total': len(TASKS), 'items': progress}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PROGRESS)

def get(url, timeout=60):
    last = ''
    for attempt in range(6):
        try:
            r = requests.get(url, timeout=timeout)
            if r.status_code == 200 and r.content:
                return r
            last = f'http {r.status_code}'
        except Exception as exc:
            last = repr(exc)
        time.sleep(min(2 + attempt, 10))
    raise RuntimeError(f'GET failed {url}: {last}')

def playlist_segments(url):
    outer = get(url).text
    lines = [x.strip() for x in outer.splitlines() if x.strip() and not x.startswith('#')]
    if not lines:
        raise RuntimeError('empty playlist')
    inner = urljoin(url, lines[-1])
    body = get(inner).text
    segs = [urljoin(inner, x.strip()) for x in body.splitlines() if x.strip() and not x.startswith('#')]
    if not segs:
        raise RuntimeError('empty media playlist')
    return segs

def download_segment(args):
    idx, url, dest = args
    path = os.path.join(dest, f'{idx:06d}.ts')
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return idx, path
    last = ''
    for attempt in range(8):
        tmp = path + '.part'
        try:
            with requests.get(url, timeout=60, stream=True) as r:
                if r.status_code != 200:
                    raise RuntimeError(f'http {r.status_code}')
                expected = int(r.headers.get('content-length') or 0)
                size = 0
                with open(tmp, 'wb') as f:
                    for chunk in r.iter_content(256 * 1024):
                        if chunk:
                            f.write(chunk); size += len(chunk)
                if expected and size != expected:
                    raise RuntimeError(f'truncated {size}/{expected}')
            os.replace(tmp, path)
            return idx, path
        except Exception as exc:
            last = repr(exc)
            try: os.unlink(tmp)
            except FileNotFoundError: pass
            time.sleep(min(1 + attempt, 10))
    raise RuntimeError(f'segment {idx} failed: {last}')

def api(method, path, **kwargs):
    for attempt in range(4):
        try:
            r = requests.request(method, BASE + path, timeout=900, **kwargs)
            if r.status_code < 300:
                return r
            err = f'{r.status_code} {r.text[-500:]}'
        except Exception as exc:
            err = repr(exc)
        time.sleep(3 + attempt)
    raise RuntimeError(err)

def upload_file(key, mp4_path):
    started = api('POST', '/api/import/multipart/start', headers=HEADERS, json={'key': key, 'contentType': 'video/mp4'}).json()
    upload_id = started['uploadId']; parts = []
    try:
        with open(mp4_path, 'rb') as f:
            n = 1
            while True:
                data = f.read(PART_SIZE)
                if not data: break
                h = {**HEADERS, 'x-key': key, 'x-upload-id': upload_id, 'x-part-number': str(n)}
                resp = api('PUT', '/api/import/multipart/part', headers=h, data=data)
                parts.append({'partNumber': n, 'etag': resp.json()['etag']})
                n += 1
        api('POST', '/api/import/multipart/complete', headers=HEADERS, json={'key': key, 'uploadId': upload_id, 'parts': parts})
    except Exception:
        try: api('POST', '/api/import/multipart/abort', headers=HEADERS, json={'key': key, 'uploadId': upload_id})
        except Exception: pass
        raise

def upload_task(item):
    eid = item['episodeId']
    with lock:
        prev = progress.get(eid)
        if prev and prev.get('status') == 'success': return prev
        if prev and prev.get('status') == 'failed' and 'source host v.lzcdn34.com unavailable' in prev.get('error', ''): return prev
        progress[eid] = {**item, 'status': 'segmenting', 'upload': 'multipart'}; save()
    work = tempfile.mkdtemp(prefix=f'xumeng-{eid}-')
    try:
        segs = playlist_segments(item['playlistUrl'])
        print('segments', eid, len(segs), flush=True)
        with ThreadPoolExecutor(max_workers=6) as ex:
            futures = [ex.submit(download_segment, (i, u, work)) for i, u in enumerate(segs)]
            for i, future in enumerate(as_completed(futures), 1):
                future.result()
                if i % 100 == 0: print('downloaded', eid, i, '/', len(segs), flush=True)
        concat = os.path.join(work, 'concat.txt')
        with open(concat, 'w') as f:
            for i in range(len(segs)):
                f.write("file '%s'\n" % os.path.join(work, f'{i:06d}.ts').replace("'", "'\\''"))
        mp4 = os.path.join(work, 'video.mp4')
        cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
               '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', mp4]
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if run.returncode != 0: raise RuntimeError(run.stderr[-2000:])
        upload_file(item['key'], mp4)
        rec = {**item, 'status': 'success', 'upload': 'segmented-multipart'}
        with lock: progress[eid] = rec; save()
        return rec
    except Exception as exc:
        rec = {**item, 'status': 'failed', 'error': f'{type(exc).__name__}: {exc}'[-2000:], 'upload': 'segmented-multipart'}
        with lock: progress[eid] = rec; save()
        return rec
    finally:
        shutil.rmtree(work, ignore_errors=True)

pending = [x for x in TASKS if progress.get(x['episodeId'], {}).get('status') != 'success' and 'source host v.lzcdn34.com unavailable' not in progress.get(x['episodeId'], {}).get('error', '')]
only = os.environ.get('ONLY_EPISODE')
if only: pending = [x for x in pending if x['episodeId'] == only]
print('segmented_tasks', len(pending), flush=True)
with ThreadPoolExecutor(max_workers=2) as ex:
    futures = [ex.submit(upload_task, item) for item in pending]
    for idx, future in enumerate(as_completed(futures), 1):
        rec = future.result(); print(idx, '/', len(pending), rec.get('status'), rec.get('episodeId'), flush=True)
with lock: save()
print('done', sum(v.get('status') == 'success' for v in progress.values()), sum(v.get('status') == 'failed' for v in progress.values()), flush=True)
