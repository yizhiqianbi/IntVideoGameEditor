#!/usr/bin/env python3
import json, os, time, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

ROOT=Path('/Users/pencil/Documents/IntVideoGameEditor')
WEB=ROOT/'cloudflare/video-web'
DUMP=ROOT/'huangguoai_dump'
PROGRESS=DUMP/'cover_upload_progress.json'
TOKEN=(WEB/'.import_token').read_text().strip()
BASE='https://video.xumengchat.top'
HDR={'x-import-token':TOKEN}
catalog=json.loads((DUMP/'catalog.json').read_text())['items']
tasks=[]
for rec in catalog:
    p=DUMP/rec['coverPath']
    if p.exists(): tasks.append({'id':rec['id'],'title':rec['title'],'path':str(p),'key':f"posters/huangguo/{rec['id']}{p.suffix.lower()}"})
if PROGRESS.exists():
    try:progress=json.loads(PROGRESS.read_text()).get('items',{})
    except Exception:progress={}
else:progress={}
lock=threading.Lock()
def save():
    t=str(PROGRESS)+'.tmp';Path(t).write_text(json.dumps({'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'total':len(tasks),'items':progress},ensure_ascii=False,indent=2));os.replace(t,PROGRESS)
def api(method,path,**kw):
    last=''
    for i in range(4):
        try:
            r=requests.request(method,BASE+path,timeout=180,**kw)
            if r.status_code<300:return r
            last=f'{r.status_code} {r.text[-300:]}'
        except Exception as e:last=repr(e)
        time.sleep(2+i)
    raise RuntimeError(last)
def one(x):
    with lock:
        if progress.get(x['id'],{}).get('status')=='success':return progress[x['id']]
        progress[x['id']]={**x,'status':'uploading'};save()
    uid=None
    try:
        uid=api('POST','/api/import/multipart/start',headers=HDR,json={'key':x['key'],'contentType':'image/jpeg'}).json()['uploadId']
        data=Path(x['path']).read_bytes(); h={**HDR,'x-key':x['key'],'x-upload-id':uid,'x-part-number':'1'}
        et=api('PUT','/api/import/multipart/part',headers=h,data=data).json()['etag']
        api('POST','/api/import/multipart/complete',headers=HDR,json={'key':x['key'],'uploadId':uid,'parts':[{'partNumber':1,'etag':et}]})
        r={**x,'status':'success'}
    except Exception as e:
        if uid:
            try:api('POST','/api/import/multipart/abort',headers=HDR,json={'key':x['key'],'uploadId':uid})
            except Exception:pass
        r={**x,'status':'failed','error':repr(e)}
    with lock:progress[x['id']]=r;save()
    return r
todo=[x for x in tasks if progress.get(x['id'],{}).get('status')!='success']
print({'total':len(tasks),'pending':len(todo),'success':sum(v.get('status')=='success' for v in progress.values())},flush=True)
with ThreadPoolExecutor(max_workers=4) as ex:
    fs=[ex.submit(one,x) for x in todo]
    for i,f in enumerate(as_completed(fs),1):
        r=f.result();
        if i%25==0 or r.get('status')=='failed':print({'done':i,'total':len(todo),'status':r.get('status'),'id':r.get('id')},flush=True)
print({'success':sum(v.get('status')=='success' for v in progress.values()),'failed':sum(v.get('status')=='failed' for v in progress.values())},flush=True)
