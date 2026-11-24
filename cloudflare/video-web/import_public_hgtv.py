import json, os, subprocess, sys, tempfile, time, threading, shutil
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT='/Users/pencil/Documents/IntVideoGameEditor'
WORKER=os.path.join(ROOT,'cloudflare/video-web')
FFMPEG='/opt/homebrew/bin/ffmpeg'
WRANGLER=os.path.join(WORKER,'node_modules/.bin/wrangler')
INV=os.path.join(ROOT,'hgtv_hls_estimate.json')
PROGRESS=os.path.join(WORKER,'full_import_progress.json')
PLAYLISTS=json.load(open(INV))['items']
TASKS=[]
for item in PLAYLISTS:
    if item.get('status')==200 and item.get('playlist_url'):
        TASKS.append({'episodeId':str(item['episode_id']),'dramaId':str(item['drama_id']),'dramaTitle':item['drama_title'],'ep':item.get('ep'),'title':item.get('title'),'playlistUrl':item['playlist_url'],'key':f"video/full/{item['episode_id']}.mp4"})

lock=threading.Lock()
if os.path.exists(PROGRESS):
    try:
        loaded=json.load(open(PROGRESS)); progress=loaded.get('items', loaded)
    except Exception: progress={}
else: progress={}

def save():
    tmp=PROGRESS+'.tmp'
    with open(tmp,'w') as f: json.dump({'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'total':len(TASKS),'items':progress},f,ensure_ascii=False,indent=2)
    os.replace(tmp,PROGRESS)

def delete_key(key):
    subprocess.run([WRANGLER,'r2','object','delete','dzmm-media/'+key,'--remote'],cwd=WORKER,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120)

def upload(item):
    eid=item['episodeId']
    with lock:
        prev=progress.get(eid)
        if prev and prev.get('status')=='success': return prev
        if prev and prev.get('status')=='failed' and 'source host v.lzcdn34.com unavailable' in prev.get('error',''):
            return prev
    last=''
    for attempt in range(1,4):
        work=tempfile.mkdtemp(prefix='hgtv-fast-')
        mp4=os.path.join(work,'episode.mp4')
        cmd=(f"'{FFMPEG}' -hide_banner -loglevel error -protocol_whitelist file,http,https,tcp,tls,crypto "
             f"-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 8 -rw_timeout 120000000 "
             f"-i '{item['playlistUrl']}' -c copy -bsf:a aac_adtstoasc -movflags +faststart '{mp4}' "
             f"&& '{WRANGLER}' r2 object put 'dzmm-media/{item['key']}' --file '{mp4}' --remote --content-type video/mp4")
        try:
            p=subprocess.Popen(['/bin/zsh','-lc',cmd],cwd=WORKER,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
            try:
                out,_=p.communicate(timeout=1800)
            except subprocess.TimeoutExpired:
                try: os.killpg(p.pid, 15)
                except Exception: pass
                try: out,_=p.communicate(timeout=30)
                except Exception:
                    try: os.killpg(p.pid, 9)
                    except Exception: pass
                    out='timeout; process group killed'
                last=f'timeout {out[-1200:]}'
                raise RuntimeError(last)
            if p.returncode==0:
                rec={**item,'status':'success','bytes':None,'attempts':attempt}
                with lock: progress[eid]=rec; save()
                shutil.rmtree(work, ignore_errors=True)
                return rec
            last=f'exit={p.returncode} {out[-1600:]}'
        except Exception as exc:
            last=f'{type(exc).__name__}: {exc}'
        shutil.rmtree(work, ignore_errors=True)
        try: delete_key(item['key'])
        except Exception: pass
    rec={**item,'status':'failed','error':last[-2000:]}
    with lock: progress[eid]=rec; save()
    return rec

print('tasks',len(TASKS),'already_success',sum(1 for v in progress.values() if v.get('status')=='success'),flush=True)
results=[]
with ThreadPoolExecutor(max_workers=3) as ex:
    futures=[ex.submit(upload,item) for item in TASKS]
    for idx,f in enumerate(as_completed(futures),1):
        rec=f.result(); results.append(rec)
        if idx%10==0 or rec.get('status')=='failed': print(idx,'/',len(TASKS),rec.get('status'),rec.get('episodeId'),rec.get('bytes',0),flush=True)
summary={'total':len(TASKS),'success':sum(1 for v in progress.values() if v.get('status')=='success'),'failed':sum(1 for v in progress.values() if v.get('status')=='failed'),'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
with lock: save()
print(json.dumps(summary,ensure_ascii=False),flush=True)
