"""Synthetic Chinese audio smoke test; not a browser latency benchmark."""
import asyncio
import base64
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import websockets

ROOT = Path('/data/zrc/dyt/voice-mini01')

async def main():
    samples, sr = sf.read(ROOT / 'voice-mini01-input.wav', dtype='float32')
    assert sr == 16000
    events, audio, texts = [], [], []
    start = time.perf_counter()
    ready = asyncio.Event()
    async with websockets.connect('ws://127.0.0.1:8016/v1/realtime?mode=audio', max_size=32*1024*1024) as ws:
        async def send():
            await ready.wait()
            for i in range(45):
                chunk = np.zeros(16000, dtype=np.float32)
                part = samples[i*16000:(i+1)*16000]
                chunk[:len(part)] = part
                await ws.send(json.dumps({'type':'input.append','input':{
                    'input_id':f'chunk_{i}', 'audio':base64.b64encode(chunk.tobytes()).decode(),
                    'force_listen': 25 <= i <= 27}}))
                await asyncio.sleep(1)
        task = asyncio.create_task(send())
        try:
            async with asyncio.timeout(65):
                async for raw in ws:
                    event = json.loads(raw)
                    event['client_ms'] = round((time.perf_counter()-start)*1000, 2)
                    if event.get('audio'):
                        audio.append(np.frombuffer(base64.b64decode(event.pop('audio')), dtype='<f4').copy())
                    events.append(event)
                    if event['type'] == 'session.queue_done':
                        await ws.send(json.dumps({'type':'session.init','payload':{'system_prompt':'你是语音助手，请用中文简短回答。'}}))
                    elif event['type'] == 'session.created':
                        ready.set()
                    elif event['type'] == 'error':
                        break
                    if event.get('kind') == 'text':
                        texts.append(event.get('text',''))
                    if task.done():
                        break
        except TimeoutError:
            events.append({'type':'probe.timeout'})
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await ws.send(json.dumps({'type':'session.close','reason':'user_stop'}))
    report = {'text':''.join(texts),'audio_chunks':len(audio),'events':events}
    (ROOT/'probe-full.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    if audio:
        sf.write(ROOT/'probe-output.wav',np.concatenate(audio),24000)
    print(json.dumps({'text':report['text'],'audio_chunks':len(audio)},ensure_ascii=False))

asyncio.run(main())
