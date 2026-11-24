import json,requests,re,os,time
from concurrent.futures import ThreadPoolExecutor,as_completed
inv=json.load(open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_public_inventory.json'))
items=[]
for d in inv['dramas']:
 for e in d.get('episodes',[]):
  p=e.get('play',{})
  if p.get('can_play') and p.get('play_url'):
   items.append({'drama_id':d['id'],'drama_title':d['title'],'episode_id':e['id'],'ep':e.get('ep'),'title':e.get('title'),'playlist_url':p['play_url']})
H={'User-Agent':'Mozilla/5.0 (compatible; HGTV-public-estimate/1.0)'}
def one(x):
 try:
  r=requests.get(x['playlist_url'],headers=H,timeout=20); x['status']=r.status_code;x['bytes']=len(r.content);x['text']=r.text
  lines=[z.strip() for z in r.text.splitlines() if z.strip()]
  x['segments']=sum(1 for z in lines if not z.startswith('#'))
  x['duration_s']=sum(float(m.group(1)) for z in lines if (m:=re.match(r'#EXTINF:([0-9.]+)',z)))
  x['error']=None
 except Exception as ex:x['status']=None;x['bytes']=0;x['segments']=0;x['duration_s']=0;x['text']='';x['error']=str(ex)
 return x
out=[]
with ThreadPoolExecutor(max_workers=20) as ex:
 fs=[ex.submit(one,x) for x in items]
 for i,f in enumerate(as_completed(fs),1):
  out.append(f.result())
  if i%100==0:print(i,flush=True)
summary={'playlist_count':len(out),'ok_playlists':sum(x.get('status')==200 for x in out),'failed_playlists':sum(x.get('status')!=200 for x in out),'total_duration_s':sum(x.get('duration_s',0) for x in out),'total_segments':sum(x.get('segments',0) for x in out),'total_playlist_bytes':sum(x.get('bytes',0) for x in out)}
json.dump({'summary':summary,'items':out},open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_hls_estimate.json','w'),ensure_ascii=False)
print(json.dumps(summary,ensure_ascii=False))
