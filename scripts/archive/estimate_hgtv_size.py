import json,requests,re,urllib.parse,time
from concurrent.futures import ThreadPoolExecutor,as_completed
x=json.load(open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_hls_estimate.json'))['items']
H={'User-Agent':'Mozilla/5.0 (compatible; HGTV-public-estimate/1.0)'}

def parse(i):
 lines=[z.strip() for z in i.get('text','').splitlines() if z.strip()]
 segs=[z for z in lines if not z.startswith('#')]
 durs=[]
 for z in lines:
  m=re.match(r'#EXTINF:([0-9.]+)',z)
  if m:durs.append(float(m.group(1)))
 samples=[]
 if segs:samples.append((0,segs[0],durs[0] if durs else 0))
 if len(segs)>1:samples.append((len(segs)-1,segs[-1],durs[-1] if durs else 0))
 return i,samples,len(segs),sum(durs)

def head(t):
 i,idx,seg,dur=t
 try:
  u=urllib.parse.urljoin(i['playlist_url'],seg);r=requests.head(u,headers=H,timeout=20)
  return idx,r.status_code,int(r.headers.get('content-length') or 0),dur
 except Exception:return idx,None,0,dur

tasks=[]; meta=[]
for i in x:
 if i.get('status')!=200:continue
 rec,samples,n,dur=parse(i);meta.append((i,samples,n,dur))
 for idx,seg,sdur in samples:tasks.append((i,idx,seg,sdur))
res=[]
with ThreadPoolExecutor(max_workers=24) as ex:
 fs=[ex.submit(head,t) for t in tasks]
 for j,f in enumerate(as_completed(fs),1):
  res.append(f.result())
  if j%500==0: print(j,flush=True)
# Estimate bytes per playlist from duration-weighted average segment bytes of first/last; use ratio bytes/duration.
by={}
for i,idx,size,dur in res:by.setdefault(id(i),[]).append((size,dur))
# id works because same objects retained
est_total=0; known=0
rows=[]
for i,samples,n,dur in meta:
 vals=by.get(id(i),[])
 rates=[size/sdur for size,sdur in vals if size>0 and sdur>0]
 if rates:
  rate=sum(rates)/len(rates); est=rate*dur; known+=1;est_total+=est
 else:rate=0;est=0
 rows.append({'episode_id':i.get('episode_id'),'playlist_url':i['playlist_url'],'duration_s':dur,'segments':n,'sample_rates':rates,'estimated_bytes':int(est)})
summary={'playlists':len(meta),'playlists_with_head':known,'estimated_bytes':int(est_total),'estimated_gib':est_total/1024**3,'estimated_hours':sum(r['duration_s'] for r in rows)/3600,'head_requests':len(tasks)}
json.dump({'summary':summary,'items':rows},open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_size_estimate.json','w'),ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False))
