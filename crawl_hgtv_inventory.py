import json, time, requests
from concurrent.futures import ThreadPoolExecutor, as_completed
BASE='https://hgxml.00api-agy5u.com/api'
H={'User-Agent':'Mozilla/5.0 (compatible; HGTV-public-inventory/1.0)','Accept':'application/json'}
S=requests.Session(); S.headers.update(H)

def get(path):
    r=S.get(BASE+path,timeout=30)
    r.raise_for_status(); return r.json()

dramas=[]
for page in range(1,1000):
    d=get(f'/app/filter?page={page}&pageSize=40')
    batch=d.get('list') or []
    if not batch: break
    dramas.extend(batch)
    print('drama page',page,'batch',len(batch),'total',len(dramas),flush=True)
    if not d.get('hasMore'): break
    time.sleep(.15)
print('dramas',len(dramas),flush=True)

def one(drama):
    did=drama['id']
    eps=get(f'/app/dramas/{did}/episodes').get('list') or []
    out=[]
    for e in eps:
        pid=e.get('id')
        try: p=get(f'/app/play/{pid}')
        except Exception as ex: p={'error':str(ex)}
        out.append({**e,'play':p})
    return {**drama,'episodes':out}

items=[]
with ThreadPoolExecutor(max_workers=8) as ex:
    futs=[ex.submit(one,d) for d in dramas]
    for i,f in enumerate(as_completed(futs),1):
        try: items.append(f.result())
        except Exception as e: print('drama error',repr(e),flush=True)
        if i%20==0: print('processed',i,flush=True)
items.sort(key=lambda x:x.get('id',0),reverse=True)
free=[e for d in items for e in d.get('episodes',[]) if e.get('play',{}).get('can_play') and e.get('play',{}).get('play_url')]
all_eps=[e for d in items for e in d.get('episodes',[])]
summary={'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'api_base':BASE,'drama_count':len(items),'episode_count':len(all_eps),'public_playable_episode_count':len(free),'vip_or_unplayable_episode_count':len(all_eps)-len(free)}
json.dump({'summary':summary,'dramas':items},open('/Users/pencil/Documents/IntVideoGameEditor/hgtv_public_inventory.json','w'),ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False))
