import json,requests,re,urllib.parse,time
from concurrent.futures import ThreadPoolExecutor,as_completed
x=json.load(open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_hls_estimate.json'))['items'];H={'User-Agent':'Mozilla/5.0'}
def one(i):
 try:
  lines=[z.strip() for z in i.get('text','').splitlines() if z.strip()]
  seg=next(z for z in lines if not z.startswith('#'));u=urllib.parse.urljoin(i['playlist_url'],seg)
  r=requests.get(u,headers={**H,'Range':'bytes=0-0'},timeout=20,stream=True)
  cr=r.headers.get('content-range','');m=re.search(r'/([0-9]+)$',cr);size=int(m.group(1)) if m else 0
  return i['episode_id'],size,r.status_code
 except Exception:return i['episode_id'],0,None
res=[]
with ThreadPoolExecutor(max_workers=24) as ex:
 fs=[ex.submit(one,i) for i in x if i.get('status')==200]
 for j,f in enumerate(as_completed(fs),1):
  res.append(f.result())
  if j%200==0:print(j,flush=True)
by={a:(b,c) for a,b,c in res}; rows=[];total=0;known=0
for i in x:
 if i.get('status')!=200:continue
 size,status=by.get(i['episode_id'],(0,None)); first_dur=next((float(m.group(1)) for z in i['text'].splitlines() if (m:=re.match(r'#EXTINF:([0-9.]+)',z))),0); rate=size/first_dur if first_dur else 0; est=rate*i['duration_s'] if rate else 0
 if size:known+=1;total+=est
 rows.append({'episode_id':i['episode_id'],'first_segment_bytes':size,'first_segment_duration_s':first_dur,'duration_s':i['duration_s'],'estimated_bytes':int(est),'status':status})
summary={'playlists':len(rows),'known_first_segments':known,'estimated_bytes':int(total),'estimated_gib':total/1024**3,'head_requests':len(res)}
json.dump({'summary':summary,'items':rows},open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_size_estimate_range.json','w'),ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False))
