"""Synthetic integration test. No microphone/audio perception claims."""
import asyncio,base64,json,time,contextlib
from pathlib import Path
import numpy as np
import soundfile as sf
import websockets
import httpx
ROOT=Path('/data/zrc/dyt/avatar-mini02')
async def main():
    wave,sr=sf.read('/data/zrc/dyt/voice-mini01/voice-mini01-input.wav',dtype='float32');assert sr==16000
    events=[];ready=asyncio.Event();position=0;interrupted=False;version=0;video=False
    async with websockets.connect('ws://127.0.0.1:8027/session',ping_timeout=120) as ws:
        async def input_stream():
            nonlocal position
            await ready.wait()
            while True:
                chunk=np.zeros(16000,dtype=np.float32)
                part=wave[position:position+16000];chunk[:len(part)]=part
                await ws.send(json.dumps({'type':'speech','active':bool(len(part))}))
                await ws.send(json.dumps({'type':'audio','audio':base64.b64encode(chunk.tobytes()).decode()}))
                position+=16000
                await asyncio.sleep(1)
        task=asyncio.create_task(input_stream());started=time.monotonic()
        try:
            while time.monotonic()-started<180:
                event=json.loads(await asyncio.wait_for(ws.recv(),90))
                event['test_elapsed']=round(time.monotonic()-started,2);events.append(event)
                if event['type']=='ready':ready.set()
                elif event['type']=='rendering' and not interrupted:
                    await ws.send(json.dumps({'type':'interrupt'}));interrupted=True
                elif event['type']=='cancel_ack':position=0
                elif event['type']=='interrupted':version=event['epoch']
                elif event['type']=='video':
                    assert interrupted and event['epoch']==version==1
                    async with httpx.AsyncClient() as client:
                        result=await client.get('http://127.0.0.1:8027'+event['url']);assert result.status_code==200 and len(result.content)>10000
                    video=True;break
                elif event['type']=='error':raise RuntimeError(event['message'])
            assert video,'No current-epoch video delivered'
        finally:
            task.cancel();await asyncio.gather(task,return_exceptions=True)
            with contextlib.suppress(Exception):await ws.send(json.dumps({'type':'end'}))
            (ROOT/'live-test.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
    print(json.dumps({'passed':video,'events':len(events),'elapsed':round(time.monotonic()-started,2)},ensure_ascii=False))
asyncio.run(asyncio.wait_for(main(),150))
