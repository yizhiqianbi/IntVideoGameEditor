#!/usr/bin/env python3
import html, json, os, re, shutil, subprocess, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

ROOT='/Users/pencil/Documents/IntVideoGameEditor'
WEB=ROOT+'/cloudflare/video-web'
INV=ROOT+'/huangguoai_dump/playability.json'
PROGRESS=ROOT+'/huangguoai_dump/import_progress.json'
TOKEN=open(WEB+'/.import_token').read().strip()
BASE='https://video.xumengchat.top'
FFMPEG='/opt/homebrew/bin/ffmpeg'
CHUNK=8*1024*1024
HDR={'x-import-token':TOKEN}
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36'
lock=threading.Lock()

items=json.load(open(INV))['items']
TASKS=[]
for item in items:
    for ep in item.get('episodes',[]):
        TASKS.append({'id':str(item['id']),'title':item.get('title',''),'category':item.get('category',''),'tags':item.get('tags',[]),'episode':int(ep['episode']),'playlistUrl':ep['playlistUrl'],'detailUrl':item.get('url',''),'coverUrl':item.get('coverUrl',''),'key':f"video/huangguo/{item['id']}/ep-{int(ep['episode']):03d}.mp4"})
if os.path.exists(PROGRESS):
    try: progress=json.load(open(PROGRESS)).get('items',{})
    except Exception: progress={}
else: progress={}

def save():
    tmp=PROGRESS+'.tmp';
    with open(tmp,'w') as f: json.dump({'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'total':len(TASKS),'items':progress},f,ensure_ascii=False,indent=2)
    os.replace(tmp,PROGRESS)

def api(method,path,**kwargs):
    last=''
    for n in range(4):
        try:
            r=requests.request(method,BASE+path,timeout=900,**kwargs)
            if r.status_code<300:return r
            last=f'{r.status_code} {r.text[-300:]}'
        except Exception as e:last=repr(e)
        time.sleep(2+n)
    raise RuntimeError(last)

def fresh_playlist(item):
    # Detail HTML only preloads two episode addresses. Later episodes come from the public play API.
    api = f"https://huangguoai.com/api/videos/{item['id']}/play"
    for attempt in range(3):
        try:
            r = requests.get(api, params={'ep': item['episode'], 'page_texts': 0}, headers={'User-Agent': UA, 'Accept': 'application/json'}, timeout=45)
            if r.status_code == 200:
                fresh = ((r.json() or {}).get('data') or {}).get('video_url')
                if fresh:
                    return fresh
        except Exception:
            pass
        time.sleep(1 + attempt)
    detail_url = item.get('detailUrl')
    if detail_url:
        try:
            r = requests.get(detail_url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml'}, timeout=90)
            if r.status_code == 200:
                m = re.search(r'<script[^>]+id=["\']videoInitialData["\'][^>]*>(.*?)</script>', r.text, re.S | re.I)
                if m:
                    data = json.loads(html.unescape(m.group(1)))
                    fresh = (data.get('epPlaySrcs') or {}).get(str(item['episode']))
                    if fresh:
                        return fresh
        except Exception:
            pass
    if item.get('playlistUrl'):
        return item['playlistUrl']
    raise RuntimeError('play url unavailable')

def upload(item):
    key=f"{item['id']}:{item['episode']}"
    with lock:
        prev=progress.get(key)
        if prev and prev.get('status')=='success': return prev
        if prev and prev.get('status')=='failed' and 'permanent' in prev.get('error',''): return prev
        progress[key]={**item,'status':'uploading','upload':'multipart'};save()
    last=''
    for attempt in range(1,4):
        upload_id=None
        work=tempfile.mkdtemp(prefix='hg-fast-')
        try:
            playlist_url = fresh_playlist(item)
            out=os.path.join(work,'episode.mp4')
            cmd=[FFMPEG,'-hide_banner','-loglevel','error','-user_agent',UA,'-protocol_whitelist','file,http,https,tcp,tls,crypto','-http_persistent','1','-rw_timeout','120000000','-i',playlist_url,'-c','copy','-bsf:a','aac_adtstoasc','-movflags','+faststart',out]
            run=subprocess.run(cmd,capture_output=True,timeout=1800)
            if run.returncode!=0: raise RuntimeError(f"ffmpeg exit={run.returncode} {run.stderr.decode('utf-8','replace')[-1800:]}")
            if os.path.getsize(out)<1024: raise RuntimeError('empty media')
            upload_id=api('POST','/api/import/multipart/start',headers=HDR,json={'key':item['key'],'contentType':'video/mp4'}).json()['uploadId']
            parts=[];n=1
            with open(out,'rb') as fh:
                while True:
                    data=fh.read(CHUNK)
                    if not data:break
                    h={**HDR,'x-key':item['key'],'x-upload-id':upload_id,'x-part-number':str(n)}
                    r=api('PUT','/api/import/multipart/part',headers=h,data=data)
                    parts.append({'partNumber':n,'etag':r.json()['etag']});n+=1
            if not parts: raise RuntimeError('empty media')
            api('POST','/api/import/multipart/complete',headers=HDR,json={'key':item['key'],'uploadId':upload_id,'parts':parts})
            rec={**item,'status':'success','attempts':attempt,'upload':'faststart'}
            with lock:progress[key]=rec;save()
            return rec
        except Exception as exc:
            last=f'{type(exc).__name__}: {exc}'
            if upload_id:
                try:api('POST','/api/import/multipart/abort',headers=HDR,json={'key':item['key'],'uploadId':upload_id})
                except Exception:pass
            time.sleep(2+attempt)
        finally:
            shutil.rmtree(work,ignore_errors=True)
    permanent = 'HTTP 403' in last or 'HTTP 401' in last or 'empty media' in last
    rec={**item,'status':'failed','error':(('permanent: ' if permanent else '')+last)[-2000:],'upload':'multipart'}
    with lock:progress[key]=rec;save()
    return rec

pending=[]
for item in TASKS:
    k=f"{item['id']}:{item['episode']}"; prev=progress.get(k,{})
    if prev.get('status')!='success' and 'permanent' not in prev.get('error',''):pending.append(item)
only=os.environ.get('ONLY_HG_TASK')
if only:pending=[x for x in pending if f"{x['id']}:{x['episode']}"==only]
if os.environ.get('HG_ONLY_NEW') == '1':
    pending=[x for x in pending if f"{x['id']}:{x['episode']}" not in progress]
pending.sort(key=lambda x: (-int(x['id']), int(x['episode'])))
limit=int(os.environ.get('HG_LIMIT') or '0')
if limit>0: pending=pending[:limit]
print({'tasks':len(TASKS),'pending':len(pending),'success':sum(v.get('status')=='success' for v in progress.values()),'failed':sum(v.get('status')=='failed' for v in progress.values())},flush=True)
workers = int(os.environ.get('HG_WORKERS', '2'))
with ThreadPoolExecutor(max_workers=workers) as ex:
    fs=[ex.submit(upload,x) for x in pending]
    for i,f in enumerate(as_completed(fs),1):
        r=f.result(); print({'done':i,'total':len(pending),'status':r.get('status'),'id':r.get('id'),'episode':r.get('episode')},flush=True)
with lock:save()
print({'success':sum(v.get('status')=='success' for v in progress.values()),'failed':sum(v.get('status')=='failed' for v in progress.values())},flush=True)
