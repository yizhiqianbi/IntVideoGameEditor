import asyncio,base64,json,time,contextlib
from pathlib import Path
import numpy as np,soundfile as sf,websockets,httpx
ROOT=Path('/data/zrc/dyt/avatar-mini02')
async def main():
 async with httpx.AsyncClient() as c:
  assert not (await c.get('http://127.0.0.1:8027/health')).json()['active']
 wave,sr=sf.read('/data/zrc/dyt/voice-mini01/voice-mini01-input.wav',dtype='float32');assert sr==16000
 started=time.monotonic();ready=asyncio.Event();events=[];end=None
 async with websockets.connect('ws://127.0.0.1:8027/session',ping_timeout=120) as ws:
  async def feed():
   nonlocal end
   await ready.wait();await asyncio.sleep(2);pos=0
   while True:
    chunk=np.zeros(16000,np.float32);part=wave[pos:pos+16000];chunk[:len(part)]=part;pos+=16000
    if not len(part) and end is None:end=time.monotonic()-started
    await ws.send(json.dumps({'type':'speech','active':bool(len(part))}))
    await ws.send(json.dumps({'type':'audio','audio':base64.b64encode(chunk.tobytes()).decode()}))
    await asyncio.sleep(1)
  task=asyncio.create_task(feed())
  try:
   while True:
    e=json.loads(await asyncio.wait_for(ws.recv(),180));e['at']=round(time.monotonic()-started,3);events.append(e)
    if e['type']=='ready':ready.set()
    if e['type'] in ('video','video_done','error'):print(json.dumps(e),flush=True)
    if e['type']=='error':raise RuntimeError(e)
    if e['type']=='video':
     async with httpx.AsyncClient() as c:
      data=(await c.get('http://127.0.0.1:8027'+e['url'])).content
      (ROOT/'perf'/f'stream-{e["segment"]}.mp4').write_bytes(data)
    if e['type']=='video_done':break
  finally:
   task.cancel();await asyncio.gather(task,return_exceptions=True)
   with contextlib.suppress(Exception):await ws.send(json.dumps({'type':'end'}))
   (ROOT/'perf/stream-trial.json').write_text(json.dumps({'user_end':end,'events':events},indent=2))
asyncio.run(asyncio.wait_for(main(),90))
