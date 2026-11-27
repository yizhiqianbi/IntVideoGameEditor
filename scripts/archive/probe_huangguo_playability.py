#!/usr/bin/env python3
import html, json, os, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

BASE='https://huangguoai.com'
ROOT=Path('/Users/pencil/Documents/IntVideoGameEditor/huangguoai_dump')
CAT=ROOT/'catalog.json'
OUT=ROOT/'playability.json'
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36'

def fetch(url):
    s=requests.Session()
    for attempt in range(4):
        try:
            r=s.get(url,headers={'User-Agent':UA},timeout=(10,45))
            if r.status_code==200:return r.text
        except Exception: pass
        time.sleep(1+attempt)
    raise RuntimeError('detail fetch failed')

def one(rec):
    t=fetch(rec['url'])
    m=re.search(r'<script[^>]+id=["\']videoInitialData["\'][^>]*>(.*?)</script>',t,re.S|re.I)
    if not m: raise RuntimeError('videoInitialData missing')
    d=json.loads(html.unescape(m.group(1)))
    known={}
    for ep,u in (d.get('epPlaySrcs') or {}).items():
        n=int(ep)
        if n>0 and u: known[n]={'episode':n,'playlistUrl':u,'hevcUrl':(d.get('epPlaySrcsHevc') or {}).get(str(ep),'') or ''}
    # The page only preloads the current episode and its neighbor. The rest are listed in trackingEpisodes.
    for ep in (d.get('trackingEpisodes') or {}):
        n=int(ep)
        if n>0 and n not in known: known[n]={'episode':n,'playlistUrl':'','hevcUrl':''}
    eps=[known[n] for n in sorted(known)]
    total=d.get('total') or d.get('tracking',{}).get('total_episode') or rec.get('totalEpisodes')
    return {'id':str(d.get('id') or rec['id']),'title':d.get('title') or rec['title'],'category':rec.get('category',''),'tags':d.get('tags') or rec.get('tags',[]),'coverUrl':d.get('posterSrc') or rec.get('coverUrl',''),'totalEpisodes':total,'episodes':eps,'url':rec['url']}

def main():
    records=json.loads(CAT.read_text())['items']
    old={}
    if OUT.exists():
        try: old={x['id']:x for x in json.loads(OUT.read_text()).get('items',[])}
        except Exception: pass
    todo=records if os.environ.get('HG_REFRESH') == '1' else [r for r in records if r['id'] not in old]
    print({'total':len(records),'already':len(old),'todo':len(todo)},flush=True)
    with ThreadPoolExecutor(max_workers=16) as ex:
        fs={ex.submit(one,r):r for r in todo}
        for n,f in enumerate(as_completed(fs),1):
            r=fs[f]
            try: old[r['id']]=f.result()
            except Exception as e:
                prev=old.get(r['id'])
                if prev and prev.get('episodes'): prev['error']=repr(e)
                else: old[r['id']]={'id':r['id'],'title':r['title'],'url':r['url'],'episodes':[],'error':repr(e)}
            if n%100==0 or n==len(todo):
                OUT.write_text(json.dumps({'source':BASE,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'items':sorted(old.values(),key=lambda x:int(x['id']) if str(x.get('id','')).isdigit() else 0,reverse=True)},ensure_ascii=False,indent=2))
                print({'done':n,'total':len(todo),'id':r['id'],'episodes':len(old[r['id']].get('episodes',[]))},flush=True)
    items=sorted(old.values(),key=lambda x:int(x['id']) if str(x.get('id','')).isdigit() else 0,reverse=True)
    OUT.write_text(json.dumps({'source':BASE,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'items':items},ensure_ascii=False,indent=2))
    print({'items':len(items),'playableEpisodes':sum(len(x.get('episodes',[])) for x in items),'errors':sum(bool(x.get('error')) for x in items)},flush=True)
if __name__=='__main__':main()
