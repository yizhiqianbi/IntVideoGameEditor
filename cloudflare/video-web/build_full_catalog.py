import json, os, time
ROOT='/Users/pencil/Documents/IntVideoGameEditor'
inv=json.load(open(ROOT+'/hgtv_public_inventory.json'))
progress_path=ROOT+'/cloudflare/video-web/full_import_progress.json'
progress=json.load(open(progress_path)).get('items',{}) if os.path.exists(progress_path) else {}
items=[]
for d in inv['dramas']:
    for e in d.get('episodes',[]):
        eid=str(e.get('id'))
        rec=progress.get(eid)
        if not rec or rec.get('status')!='success': continue
        p=e.get('play') or {}
        items.append({'id':eid,'dramaId':str(d['id']),'title':d['title'],'episode':e.get('title') or f"第{e.get('ep','')}集",'file':f"{eid}.mp4",'mediaKey':f"video/full/{eid}.mp4",'posterKey':'posters/001.jpg','category':d.get('category_id') and 'AI短剧' or '短剧','badge':'已导入','source':'已授权全量导入'})
items.sort(key=lambda x:int(x['id']),reverse=True)
out={'brand':'叙梦短剧','updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'categories':['首页','AI短剧','漫剧','专题','排行榜','最新'],'items':items,'importedCount':len(items),'sourceDramaCount':len(inv['dramas'])}
json.dump(out,open(ROOT+'/cloudflare/video-web/public/catalog.json','w'),ensure_ascii=False,indent=2)
print(json.dumps({'importedCount':len(items),'sourceDramaCount':len(inv['dramas'])},ensure_ascii=False))
