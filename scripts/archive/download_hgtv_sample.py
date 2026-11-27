import json,os,re,subprocess,shutil,time
inv=json.load(open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_public_inventory.json'))
outdir='/Users/pencil/Documents/IntVideoGameEditor/hgtv_sample'
os.makedirs(outdir,exist_ok=True)
# One public playable first episode from each of the first ten dramas.
selected=[]
for d in inv['dramas']:
    eps=[e for e in d.get('episodes',[]) if e.get('play',{}).get('can_play') and e.get('play',{}).get('play_url')]
    if not eps: continue
    selected.append({'drama_id':d['id'],'drama_title':d['title'],'episode_id':eps[0]['id'],'ep':eps[0].get('ep'),'episode_title':eps[0].get('title'),'playlist_url':eps[0]['play']['play_url']})
    if len(selected)>=10:break

def safe(s):
    s=re.sub(r'[^\w\u4e00-\u9fff.-]+','_',str(s),flags=re.UNICODE).strip('._')
    return (s or 'video')[:80]
records=[]
for idx,item in enumerate(selected,1):
    fn=f'{idx:03d}_{safe(item["drama_title"])}_ep{item["ep"] or ""}_{item["episode_id"]}.mp4'
    path=os.path.join(outdir,fn)
    rec={**item,'file':path,'status':'existing' if os.path.exists(path) and os.path.getsize(path)>0 else 'pending'}
    if rec['status']=='pending':
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-protocol_whitelist','file,http,https,tcp,tls,crypto','-i',item['playlist_url'],'-c','copy','-movflags','+faststart','-y',path]
        print('downloading',idx,item['episode_id'],flush=True)
        p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=300)
        if p.returncode!=0:
            rec['status']='failed';rec['error']=p.stderr[-2000:]
        else: rec['status']='downloaded'
    if os.path.exists(path): rec['bytes']=os.path.getsize(path)
    records.append(rec)
    print(rec['status'],idx,rec.get('bytes',0),flush=True)
json.dump({'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'count':len(records),'records':records},open(os.path.join(outdir,'sample_manifest.json'),'w'),ensure_ascii=False,indent=2)
print(json.dumps({'ok':sum(r['status'] in ('downloaded','existing') for r in records),'failed':sum(r['status']=='failed' for r in records),'bytes':sum(r.get('bytes',0) for r in records)},ensure_ascii=False))
