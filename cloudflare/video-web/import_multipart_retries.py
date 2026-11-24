import json, os, shutil, subprocess, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

ROOT = '/Users/pencil/Documents/IntVideoGameEditor'
WEB = ROOT + '/cloudflare/video-web'
INV = ROOT + '/hgtv_hls_estimate.json'
PROGRESS = WEB + '/full_import_progress.json'
TOKEN = open(WEB + '/.import_token').read().strip()
BASE = 'https://video.xumengchat.top'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
CHUNK = 8 * 1024 * 1024
TASKS = []
for item in json.load(open(INV))['items']:
    if item.get('status') == 200 and item.get('playlist_url'):
        TASKS.append({
            'episodeId': str(item['episode_id']),
            'dramaId': str(item['drama_id']),
            'dramaTitle': item['drama_title'],
            'ep': item.get('ep'),
            'title': item.get('title'),
            'playlistUrl': item['playlist_url'],
            'key': f"video/full/{item['episode_id']}.mp4",
        })

lock = threading.Lock()
progress = json.load(open(PROGRESS)).get('items', {})

def save():
    tmp = PROGRESS + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'total': len(TASKS), 'items': progress}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PROGRESS)

def request_with_retry(method, url, **kwargs):
    last = ''
    for _ in range(3):
        try:
            r = requests.request(method, url, timeout=900, **kwargs)
            if r.status_code < 300:
                return r
            last = f'{r.status_code} {r.text[-500:]}'
        except Exception as exc:
            last = repr(exc)
        time.sleep(3)
    raise RuntimeError(last or 'request failed')

def upload(item):
    eid = item['episodeId']
    with lock:
        prev = progress.get(eid)
        if prev and prev.get('status') == 'success':
            return prev
        if prev and prev.get('status') == 'failed' and 'source host v.lzcdn34.com unavailable' in prev.get('error', ''):
            return prev
        progress[eid] = {**item, 'status': 'uploading', 'upload': 'multipart'}
        save()
    last = ''
    headers = {'x-import-token': TOKEN}
    for attempt in range(1, 4):
        upload_id = None
        work = None
        try:
            work = tempfile.mkdtemp(prefix='hgtv-fast-')
            out = os.path.join(work, 'episode.mp4')
            cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                   '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '8', '-rw_timeout', '120000000',
                   '-i', item['playlistUrl'], '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out]
            proc = subprocess.run(cmd, capture_output=True, timeout=2100)
            if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg exit={proc.returncode} {proc.stderr.decode('utf-8', 'replace')[-2000:]}")
            started = request_with_retry('POST', BASE + '/api/import/multipart/start', headers=headers, json={'key': item['key'], 'contentType': 'video/mp4'})
            upload_id = started.json()['uploadId']
            parts = []
            part_no = 1
            with open(out, 'rb') as handle:
                while True:
                    data = handle.read(CHUNK)
                    if not data:
                        break
                    print('upload_part', item['episodeId'], part_no, len(data), flush=True)
                    part_headers = {**headers, 'x-key': item['key'], 'x-upload-id': upload_id, 'x-part-number': str(part_no)}
                    resp = request_with_retry('PUT', BASE + '/api/import/multipart/part', headers=part_headers, data=data)
                    parts.append({'partNumber': part_no, 'etag': resp.json()['etag']})
                    part_no += 1
            if not parts:
                raise RuntimeError('ffmpeg produced no media')
            request_with_retry('POST', BASE + '/api/import/multipart/complete', headers=headers, json={'key': item['key'], 'uploadId': upload_id, 'parts': parts})
            rec = {**item, 'status': 'success', 'attempts': attempt, 'upload': 'multipart'}
            with lock:
                progress[eid] = rec
                save()
            return rec
        except Exception as exc:
            last = f'{type(exc).__name__}: {exc}'
            if upload_id:
                try: requests.post(BASE + '/api/import/multipart/abort', headers=headers, json={'key': item['key'], 'uploadId': upload_id}, timeout=30)
                except Exception: pass
            time.sleep(3)
        finally:
            if work:
                shutil.rmtree(work, ignore_errors=True)
    rec = {**item, 'status': 'failed', 'error': last[-2000:], 'upload': 'multipart'}
    with lock:
        progress[eid] = rec
        save()
    return rec

pending = [x for x in TASKS if progress.get(x['episodeId'], {}).get('status') != 'success' and 'source host v.lzcdn34.com unavailable' not in progress.get(x['episodeId'], {}).get('error', '')]
only = os.environ.get('ONLY_EPISODE')
if only:
    pending = [x for x in pending if x['episodeId'] == only]
print('multipart_tasks', len(pending), 'existing_success', sum(v.get('status') == 'success' for v in progress.values()), flush=True)
with ThreadPoolExecutor(max_workers=2) as ex:
    futures = [ex.submit(upload, item) for item in pending]
    for idx, future in enumerate(as_completed(futures), 1):
        rec = future.result()
        print(idx, '/', len(pending), rec.get('status'), rec.get('episodeId'), flush=True)
with lock:
    save()
print('done', sum(v.get('status') == 'success' for v in progress.values()), sum(v.get('status') == 'failed' for v in progress.values()), flush=True)
