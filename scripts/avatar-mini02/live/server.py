"""Loopback-only voice/avatar bridge. Persistent microphone; epoch-based cancellation."""
import asyncio, base64, contextlib, json, shutil, time, uuid, logging
from pathlib import Path
import numpy as np
import soundfile as sf
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from gradio_client import Client, handle_file

ROOT=Path('/data/zrc/dyt/avatar-mini02')
HERE=Path(__file__).parent
SESSIONS={}
LOCK=asyncio.Lock()
app=FastAPI()
logger=logging.getLogger("uvicorn.error")

@app.get('/')
async def index(): return FileResponse(HERE/'index.html')
@app.get('/preview')
async def preview(): return FileResponse(HERE/'preview.html')
@app.get('/av-player.js')
async def av_player(): return FileResponse(HERE/'av-player.js',media_type='application/javascript')
@app.get('/stream-player.js')
async def stream_player(): return FileResponse(HERE/'stream-player.js',media_type='application/javascript')
@app.get('/sample.mp4')
async def sample(): return FileResponse(ROOT/'output/speech-v2.mp4')
@app.get('/mic.js')
async def mic(): return FileResponse(HERE/'mic.js',media_type='application/javascript')
@app.get('/motions.js')
async def motions_js(): return FileResponse(HERE/'motions.js',media_type='application/javascript')
@app.get('/behaviors/{name}.mp4')
async def behavior(name:str):
    if name not in ('listening','thinking','smiling','nodding'): raise HTTPException(404)
    return FileResponse(ROOT/'output/behaviors-v2'/f'{name}.mp4')
@app.get('/idle.mp4')
async def idle():
    clip=ROOT/'output/behaviors-v2/smiling.mp4'
    if not clip.exists(): clip=ROOT/'output/idle-v2-loop.mp4'
    return FileResponse(clip,headers={'Cache-Control':'no-cache'})
@app.get('/media/{session}/{name}')
async def media(session:str,name:str):
    if session not in SESSIONS or not name.endswith('.mp4') or Path(name).name!=name:
        raise HTTPException(404)
    file=SESSIONS[session]/name
    if not file.is_file(): raise HTTPException(404)
    return FileResponse(file)
@app.get('/health')
async def health(): return {'status':'ready','mode':'streaming-video','voice':'MiniCPM-o 4.5','avatar':'SoulX-FlashHead Lite','portrait':'virtual-host-v2','active':LOCK.locked()}

@app.websocket('/session')
async def session(ws:WebSocket):
    origin=ws.headers.get('origin')
    if origin and origin not in ('http://localhost:8027','http://127.0.0.1:8027'):
        await ws.close(1008);return
    await ws.accept()
    if LOCK.locked():
        await ws.send_json({'type':'error','message':'当前已有一个交互会话，请先结束另一个页面的会话。'});await ws.close();return
    async with LOCK:
        sid=uuid.uuid4().hex
        folder=ROOT/'live-sessions'/sid;folder.mkdir(parents=True)
        SESSIONS[sid]=folder
        epoch=0;seq=0;ready=False;user_speaking=False
        blocked=False;barrier=0;force_remaining=0
        audio=[];texts=[];invalid=set();response_id=None
        render_task=None;job=None;closed=False;rendering=False
        render_tasks=set(); stream_queue=None; reply_serial=0; reply_samples=0
        phase="connecting";phase_since=time.monotonic();last_input=time.monotonic()
        send_lock=asyncio.Lock()
        async def emit(kind,**kwargs):
            nonlocal phase,phase_since
            if kind in ('ready','queue','text','voice','rendering','video','error','interrupted'):
                new_phase={'ready':'listening','queue':'queue','text':'voice','voice':'voice','rendering':'rendering','video':'video_ready','error':'error','interrupted':'listening'}[kind]
                if new_phase!=phase:
                    phase=new_phase;phase_since=time.monotonic();logger.info('session=%s epoch=%s phase=%s',sid,epoch,phase)
            if not closed:
                async with send_lock: await ws.send_json({'type':kind,'epoch':epoch,**kwargs})
        async def heartbeat():
            while True:
                await asyncio.sleep(5)
                await emit('progress',phase=phase,elapsed_s=round(time.monotonic()-phase_since),input_age_s=round(time.monotonic()-last_input))
        def reset_buffer():
            nonlocal audio,texts,response_id
            audio=[];texts=[];response_id=None
        async def cancel():
            nonlocal stream_queue,render_task,rendering,reply_samples
            stream_queue=None;reply_samples=0
            for task in list(render_tasks):task.cancel()
            await asyncio.gather(*list(render_tasks),return_exceptions=True)
            render_tasks.clear();render_task=None;rendering=False
        async def render_stream(inputs,version,reply,previous):
            started=time.perf_counter()
            try:
                if previous:
                    with contextlib.suppress(asyncio.CancelledError):await previous
                if version!=epoch:return
                async with websockets.connect('ws://127.0.0.1:8026/stream-avatar',max_size=4*1024*1024,ping_timeout=120) as avatar:
                    async def upload():
                        while True:
                            block=await inputs.get()
                            if block is None:
                                await avatar.send(json.dumps({'type':'end'}));return
                            await avatar.send(json.dumps({'type':'audio','audio':base64.b64encode(block.astype('<f4').tobytes()).decode()}))
                    sender=asyncio.create_task(upload())
                    try:
                        while True:
                            e=json.loads(await asyncio.wait_for(avatar.recv(),120))
                            if version!=epoch:return
                            if e['type']=='segment':
                                source=Path(e['path']).resolve()
                                if not source.is_relative_to((ROOT/'stream-output').resolve()):raise ValueError('Unexpected output location')
                                target=folder/f'{reply}-{e["index"]}.mp4'
                                await asyncio.to_thread(shutil.copyfile,source,target)
                                source.unlink(missing_ok=True)
                                await avatar.send(json.dumps({'type':'ack','index':e['index']}))
                                if version!=epoch:return
                                await emit('video',reply_id=reply,segment=e['index'],duration=e['duration'],streaming=True,
                                           url=f'/media/{sid}/{target.name}',render_ms=round((time.perf_counter()-started)*1000),
                                           infer_ms=e['infer_ms'],encode_ms=e['encode_ms'],encoder=e['encoder'])
                            elif e['type']=='done':
                                await emit('video_done',reply_id=reply,segments=e['segments']);return
                            elif e['type']=='error':raise RuntimeError(e['message'])
                    finally:
                        sender.cancel();await asyncio.gather(sender,return_exceptions=True)
            except asyncio.CancelledError:raise
            except Exception as exc:
                logger.exception('session=%s streaming render failed',sid)
                if version==epoch:await emit('error',message=f'数字人生成失败：{exc}')
        async def push_audio(block):
            nonlocal stream_queue,render_task,reply_serial,reply_samples,rendering
            if stream_queue is None:
                reply_serial+=1;reply_samples=0;rendering=True
                stream_queue=asyncio.Queue(maxsize=64)
                previous=render_task
                render_task=asyncio.create_task(render_stream(stream_queue,epoch,str(reply_serial),previous))
                render_tasks.add(render_task);render_task.add_done_callback(render_tasks.discard)
                await emit('rendering',audio_seconds=0,reply_id=str(reply_serial),streaming=True)
            reply_samples+=len(block)
            stream_queue.put_nowait(block)
        async def finish_reply():
            nonlocal stream_queue,reply_samples
            if stream_queue is not None:
                stream_queue.put_nowait(None);stream_queue=None
            reply_samples=0;reset_buffer()
        # The browser supplies the character card once per session. Keep the
        # default for legacy clients, but bound the override before it reaches
        # the upstream MiniCPM service.
        system_prompt='你是中文虚拟陪伴助手小玥。请自然友好地与用户聊天，每次只回答一到两句，尽量不超过25个汉字。用户插话时停止旧话题，听清新的请求。不要声称自己是通义千问或其他公司的助手。'
        heartbeat_task=asyncio.create_task(heartbeat())
        try:
            async with websockets.connect('ws://127.0.0.1:8016/v1/realtime?mode=audio',max_size=4*1024*1024,open_timeout=30,ping_interval=20,ping_timeout=120) as voice:
                async def browser_input():
                    nonlocal epoch,seq,blocked,barrier,force_remaining,user_speaking,last_input,system_prompt
                    while True:
                        msg=await ws.receive_json();last_input=time.monotonic()
                        kind=msg.get('type')
                        if kind=='end':return
                        if kind=='init':
                            candidate=msg.get('system_prompt')
                            if isinstance(candidate,str) and candidate.strip(): system_prompt=candidate.strip()[:5000]
                            continue
                        if kind=='speech':
                            user_speaking=bool(msg.get('active'))
                            continue
                        if kind=='interrupt':
                            epoch+=1;blocked=True;barrier=seq+1;force_remaining=2
                            if response_id:invalid.add(response_id)
                            reset_buffer();await cancel()
                            await emit('interrupted',history_truncated=False)
                        elif kind=='audio' and ready:
                            encoded=msg.get('audio','')
                            if len(encoded)>90000:raise ValueError('Audio block too large')
                            raw=base64.b64decode(encoded,validate=True)
                            if msg.get('format')=='pcm16':
                                if len(raw)!=32000:raise ValueError('Expected 1s PCM16 16kHz')
                                encoded=base64.b64encode((np.frombuffer(raw,dtype='<i2').astype('<f4')/32768).tobytes()).decode()
                            elif len(raw)!=64000:raise ValueError('Expected 1s mono float32 16kHz')
                            seq+=1
                            force=user_speaking or force_remaining>0
                            if force_remaining:force_remaining-=1
                            await voice.send(json.dumps({'type':'input.append','input':{'audio':encoded,'input_id':str(seq),'force_listen':force}}))
                async def voice_output():
                    nonlocal ready,blocked,response_id
                    async for raw in voice:
                        e=json.loads(raw);kind=e.get('type')
                        if kind=='session.queue_done':
                            await voice.send(json.dumps({'type':'session.init','payload':{'system_prompt':system_prompt}}))
                        elif kind=='session.created':
                            ready=True;await emit('ready',session_id=sid)
                        elif kind in ('session.queued','session.queue_update'):await emit('queue',position=e.get('position'))
                        elif kind=='error':await emit('error',message=str(e.get('error')));return
                        elif kind=='session.closed':await emit('closed',reason=e.get('reason'));return
                        elif kind=='response.output.delta':
                            branch=e.get('kind');rid=e.get('response_id')
                            if blocked:
                                try:ack=int(e.get('input_id') or -1)
                                except ValueError:ack=-1
                                if branch=='listen' and ack>=barrier:
                                    blocked=False;await emit('cancel_ack')
                                continue
                            if rid and rid in invalid:continue
                            if branch=='listen':await finish_reply()
                            elif branch=='text':
                                response_id=rid;texts.append(e.get('text',''))
                                await emit('text',text=''.join(texts))
                            elif branch=='audio':
                                response_id=rid
                                block=np.frombuffer(base64.b64decode(e['audio']),dtype='<f4').copy()
                                await push_audio(block)
                                await emit('voice',audio_seconds=round(reply_samples/24000,2))
                                if reply_samples>=24*24000:
                                    if rid:invalid.add(rid)
                                    await finish_reply()
                tasks=[asyncio.create_task(browser_input()),asyncio.create_task(voice_output())]
                try:
                    done,_=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
                    for task in done:task.result()
                finally:
                    for task in tasks:task.cancel()
                    await asyncio.gather(*tasks,return_exceptions=True)
                    with contextlib.suppress(Exception):await voice.send(json.dumps({'type':'session.close','reason':'user_stop'}))
        except WebSocketDisconnect:
            logger.info('session=%s browser disconnected',sid)
        except websockets.ConnectionClosed as exc:
            logger.warning('session=%s voice disconnected: %s',sid,exc)
            with contextlib.suppress(Exception):await emit('error',message='语音服务连接中断：'+str(exc)[:180])
        except Exception as exc:
            with contextlib.suppress(Exception):await emit('error',message=str(exc))
        finally:
            closed=True;heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task,return_exceptions=True)
            await cancel()
            SESSIONS.pop(sid,None)
            shutil.rmtree(folder,ignore_errors=True)
            with contextlib.suppress(Exception):await ws.close()
