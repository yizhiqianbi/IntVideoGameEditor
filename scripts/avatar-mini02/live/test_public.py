import asyncio,base64,json,time
from pathlib import Path
import numpy as np,soundfile as sf,httpx,websockets
ROOT=Path('/data/zrc/dyt/avatar-mini02')
async def main():
 origin=(ROOT/'public-origin.txt').read_text().strip();cfg=json.loads((ROOT/'public-access.json').read_text())
 wave,sr=sf.read('/data/zrc/dyt/voice-mini01/voice-mini01-input.wav',dtype='float32');assert sr==16000
 ready=asyncio.Event();t=time.monotonic()
 async with websockets.connect(origin.replace('https:','wss:')+'/session',origin=origin,additional_headers={'Cookie':'avatar_access='+cfg['session']},max_size=4*1024*1024,ping_timeout=60) as ws:
  async def feed():
   await ready.wait();position=0
   while True:
    chunk=np.zeros(16000,dtype=np.float32);part=wave[position:position+16000];chunk[:len(part)]=part
    await ws.send(json.dumps({'type':'speech','active':bool(len(part))}))
    await ws.send(json.dumps({'type':'audio','audio':base64.b64encode(chunk.tobytes()).decode()}));position+=16000;await asyncio.sleep(1)
  task=asyncio.create_task(feed())
  try:
   if True:
    async for msg in ws:
     e=json.loads(msg);print(round(time.monotonic()-t,1),e,flush=True)
     if e['type']=='ready':ready.set()
     if e['type']=='error':raise RuntimeError(str(e))
     if e['type']=='video':
      async with httpx.AsyncClient() as client:
       r=await client.get(origin+e['url'],cookies={'avatar_access':cfg['session']},timeout=60);r.raise_for_status();assert len(r.content)>10000
       (ROOT/'output/public-test-reply.mp4').write_bytes(r.content)
      print('PUBLIC_VIDEO_PASS',len(r.content),flush=True);return
   raise RuntimeError('Disconnected without video')
  finally:task.cancel();await asyncio.gather(task,return_exceptions=True);await ws.send(json.dumps({'type':'end'}))
asyncio.run(asyncio.wait_for(main(),180))
