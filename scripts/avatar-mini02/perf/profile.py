"""Two local end-to-end synthetic trials plus sampled host/GPU telemetry; no user audio saved."""
import asyncio,base64,json,time,subprocess,contextlib
from pathlib import Path
import numpy as np,soundfile as sf,websockets,httpx
ROOT=Path('/data/zrc/dyt/avatar-mini02');OUT=ROOT/'perf';OUT.mkdir(exist_ok=True)
async def trial(index):
 async with httpx.AsyncClient() as client:
  assert not (await client.get('http://127.0.0.1:8027/health')).json()['active'],'User session active; skip benchmark'
 wave,sr=sf.read('/data/zrc/dyt/voice-mini01/voice-mini01-input.wav',dtype='float32');assert sr==16000
 t=time.monotonic();events=[];ready=asyncio.Event();sent=0;feeding_done=None
 async with websockets.connect('ws://127.0.0.1:8027/session',max_size=4*1024*1024,ping_timeout=120) as ws:
  async def feed():
   nonlocal sent,feeding_done
   await ready.wait();position=0
   while True:
    chunk=np.zeros(16000,dtype=np.float32);part=wave[position:position+16000];chunk[:len(part)]=part;position+=16000
    if not len(part) and feeding_done is None:feeding_done=time.monotonic()-t
    await ws.send(json.dumps({'type':'speech','active':bool(len(part))}))
    await ws.send(json.dumps({'type':'audio','audio':base64.b64encode(chunk.tobytes()).decode()}));sent+=1
    await asyncio.sleep(1)
  feeder=asyncio.create_task(feed())
  try:
   while True:
    e=json.loads(await asyncio.wait_for(ws.recv(),150));elapsed=round(time.monotonic()-t,3)
    record={k:v for k,v in e.items() if k not in ('text','session_id','url')};record['at']=elapsed;events.append(record)
    if e['type']=='ready':ready.set()
    if e['type']=='error':raise RuntimeError(str(e))
    if e['type']=='video':
     async with httpx.AsyncClient() as client:
      tt=time.monotonic();r=await client.get('http://127.0.0.1:8027'+e['url']);r.raise_for_status();download=time.monotonic()-tt
     first=lambda kind:next((x['at'] for x in events if x['type']==kind),None)
     result={'trial':index,'input_audio_s':len(wave)/sr,'sent_input_blocks':sent,'user_end_at':feeding_done,'ready_at':first('ready'),'first_text_at':first('text'),'first_audio_at':first('voice'),'render_start_at':first('rendering'),'video_at':elapsed,'render_ms':e['render_ms'],'local_download_s':download,'video_bytes':len(r.content),'events':events}
     (OUT/f'trial-{index}.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='events'}),flush=True);return
  finally:
   feeder.cancel();await asyncio.gather(feeder,return_exceptions=True)
   with contextlib.suppress(Exception):await ws.send(json.dumps({'type':'end'}))
async def main():
 with (OUT/'gpu.csv').open('w') as gpu,(OUT/'vmstat.txt').open('w') as vm:
  g=subprocess.Popen(['nvidia-smi','--query-gpu=timestamp,index,utilization.gpu,utilization.memory,memory.used,power.draw,temperature.gpu,clocks.sm','--format=csv,noheader,nounits','-l','1'],stdout=gpu)
  v=subprocess.Popen(['vmstat','-w','1'],stdout=vm)
  try:
   for i in range(1,3):await asyncio.wait_for(trial(i),180);await asyncio.sleep(3)
  finally:
   g.terminate();v.terminate();g.wait();v.wait()
asyncio.run(main())
