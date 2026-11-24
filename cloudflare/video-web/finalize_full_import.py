import json,os,time,subprocess
ROOT='/Users/pencil/Documents/IntVideoGameEditor'; WEB=ROOT+'/cloudflare/video-web'; PROGRESS=WEB+'/full_import_progress.json'; TOTAL=1190

def state():
 d=json.load(open(PROGRESS)); items=d.get('items',{}); return items,sum(v.get('status')=='success' for v in items.values()),sum(v.get('status')=='failed' for v in items.values())
while True:
 items,ok,failed=state(); print('watch',ok,'/',TOTAL,'failed',failed,flush=True)
 if ok+failed>=TOTAL: break
 time.sleep(60)
# Retry failed objects once the main pass has drained, then re-check.
if failed:
 print('retrying failed objects',flush=True)
 subprocess.run(['python3',WEB+'/import_public_hgtv.py'],cwd=WEB,check=False)
 items,ok,failed=state(); print('after retry',ok,failed,flush=True)
subprocess.run(['python3',WEB+'/build_full_catalog.py'],cwd=WEB,check=True)
subprocess.run(['npm','run','check'],cwd=WEB,check=True)
subprocess.run(['npm','run','deploy'],cwd=WEB,check=True)
print('FINALIZED',ok,failed,flush=True)
