"""Internal streaming transport. One model owner; cancellation never overlaps GPU work."""
import asyncio
import base64
import contextlib
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from collections import deque
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import gradio as gr

MODEL_LOCK = threading.Lock()


def encode(frames, audio, output, fps, encoder='libx264'):
    """One encode, muxed fragmented MP4, suitable for sequential MSE append."""
    rgb = np.concatenate([f.numpy().astype(np.uint8) for f in frames])
    with tempfile.TemporaryDirectory(prefix='avatar-encode-') as temp:
        wav = Path(temp) / 'audio.wav'
        sf.write(wav, audio, 16000)
        def run(codec):
            args = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                    '-s', f'{rgb.shape[2]}x{rgb.shape[1]}', '-r', str(fps), '-i', 'pipe:0',
                    '-i', str(wav), '-c:v', codec, '-pix_fmt', 'yuv420p', '-profile:v', 'main',
                    '-level:v', '3.1', '-bf', '0', '-g', str(len(rgb)), '-threads', '2']
            args += ['-preset', 'fast', '-rc', 'vbr', '-cq', '23'] if codec == 'h264_nvenc' else ['-preset', 'ultrafast', '-crf', '23']
            args += ['-c:a', 'aac', '-b:a', '96k', '-ar', '16000', '-movflags',
                     '+frag_keyframe+delay_moov+default_base_moof', str(output)]
            p = subprocess.run(args, input=rgb.tobytes(), capture_output=True, timeout=30)
            if p.returncode:
                raise RuntimeError(p.stderr.decode()[-1500:])
        try:
            run(encoder)
        except RuntimeError:
            if encoder != 'h264_nvenc': raise
            encoder = 'libx264'
            run(encoder)
    return encoder


def mount(model):
    api = FastAPI()

    @api.websocket('/stream-avatar')
    async def stream(ws: WebSocket):
        await ws.accept()
        incoming = queue.Queue(maxsize=64)
        results = queue.Queue()
        acknowledgements = asyncio.Queue()
        outputs = []
        stopped = threading.Event()
        def worker():
            # Shared with the Gradio preview; lock only released after CUDA work completes.
            with MODEL_LOCK:
                if stopped.is_set(): return
                try:
                    if model.pipeline is None:
                        model.pipeline = model.get_pipeline(1, 'models/SoulX-FlashHead-1_3B', 'lite', 'models/wav2vec2-base-960h')
                    model.get_base_data(model.pipeline, str(model.ROOT/'virtual-host-v2.png'), 9999, False)
                    p = model.get_infer_params()
                    motion = p['motion_frames_num']
                    n = (p['frame_num']-motion)*24000//p['tgt_fps']
                    buf = deque([0.]*(16000*p['cached_audio_duration']), maxlen=16000*p['cached_audio_duration'])
                    pending = np.zeros(0, np.float32)
                    frames, audio, timings = [], [], []
                    index = 0
                    target = model.ROOT/'stream-output'/uuid.uuid4().hex
                    target.mkdir(parents=True)
                    outputs.append(target)
                    results.put({'type':'ready', 'chunk_seconds':2*n/24000})
                    ended = False
                    while not stopped.is_set():
                        if len(pending) < n and not ended:
                            try: item = incoming.get(timeout=1)
                            except queue.Empty: continue
                            if item is None: ended = True
                            else: pending = np.concatenate((pending, item))
                        if len(pending) < n and not ended: continue
                        if not len(pending) and not frames and ended: break
                        if len(pending):
                            block = pending[:n]; pending = pending[n:]
                            block = np.pad(block, (0,n-len(block)))
                            chunk = resample_poly(block, 2, 3).astype(np.float32)
                            buf.extend(chunk.tolist())
                            started = time.perf_counter()
                            end = p['cached_audio_duration']*p['tgt_fps']
                            emb = model.get_audio_embedding(model.pipeline, np.asarray(buf,np.float32),end-p['frame_num'],end)
                            f = model.run_pipeline(model.pipeline,emb)[motion:].cpu()
                            timings.append(time.perf_counter()-started)
                            frames.append(f); audio.append(chunk)
                        if stopped.is_set(): break
                        if len(frames)==2 or (ended and not len(pending) and frames):
                            started=time.perf_counter(); path=target/f'{index}.mp4'
                            codec=encode(frames,np.concatenate(audio),path,p['tgt_fps'])
                            duration=sum(len(a) for a in audio)/16000
                            results.put({'type':'segment','path':str(path),'index':index,'duration':duration,
                                         'infer_ms':round(sum(timings)*1000),'encode_ms':round((time.perf_counter()-started)*1000),'encoder':codec})
                            index+=1; frames=[];audio=[];timings=[]
                    if not stopped.is_set():results.put({'type':'done','segments':index})
                except Exception as exc:
                    results.put({'type':'error','message':str(exc)})
                finally:
                    results.put({'type':'worker_exit'})
        thread = threading.Thread(target=worker,daemon=True)
        thread.start()
        async def receive():
            total = 0
            while True:
                e=await ws.receive_json()
                if e['type']=='audio':
                    raw=base64.b64decode(e['audio'],validate=True)
                    if len(raw)>4*24000*4 or len(raw)%4:raise ValueError('Invalid audio block')
                    samples=np.frombuffer(raw,dtype='<f4').copy();total+=len(samples)
                    if total>31*24000 or not np.isfinite(samples).all():raise ValueError('Audio limit exceeded')
                    incoming.put_nowait(samples)
                elif e['type']=='end':incoming.put_nowait(None)
                elif e['type']=='ack':await acknowledgements.put(e['index'])
                elif e['type']=='cancel':return
        async def send():
            while True:
                try:e=results.get_nowait()
                except queue.Empty:await asyncio.sleep(.02);continue
                if e['type']=='worker_exit':return
                await ws.send_json(e)
                if e['type']=='segment':
                    ack=await asyncio.wait_for(acknowledgements.get(),60)
                    if ack!=e['index']:raise ValueError('Segment acknowledgement mismatch')
                if e['type'] in ('done','error'):return
        tasks=[asyncio.create_task(receive()),asyncio.create_task(send())]
        try:
            done,_=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
            for task in done:task.result()
        except WebSocketDisconnect:pass
        finally:
            stopped.set()
            for task in tasks:task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            # Don't release model ownership while inference/encoding is still running.
            await asyncio.to_thread(thread.join)
            with contextlib.suppress(Exception):await ws.close()
            for folder in outputs:shutil.rmtree(folder,ignore_errors=True)
    return gr.mount_gradio_app(api,model.app,path='/',allowed_paths=[str(model.ROOT/'virtual-host-v2.png'),str(model.ROOT/'sample.wav'),str(model.OUT)])
