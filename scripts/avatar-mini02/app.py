"""Local-only SoulX-FlashHead Lite preview; serialized model access."""
import os
os.environ.setdefault('GRADIO_ANALYTICS_ENABLED', 'False')
import time
import uuid
import shutil
from pathlib import Path
from collections import deque
import numpy as np
import torch
import librosa
import soundfile as sf
import gradio as gr
from flash_head.inference import get_pipeline, get_base_data, get_infer_params, get_audio_embedding, run_pipeline
from gradio_app_streaming import save_video_with_audio
import flash_head.src.pipeline.flash_head_pipeline as engine
# First preview uses eager execution; compilation is an opt-in optimization.
engine.COMPILE_MODEL = os.environ.get('AVATAR_COMPILE') == '1'
engine.COMPILE_VAE = os.environ.get('AVATAR_COMPILE') == '1'

ROOT=Path('/data/zrc/dyt/avatar-mini02')
OUT=ROOT/'output'
OUT.mkdir(exist_ok=True)
pipeline=None

def _render(portrait, audio):
    global pipeline
    if not portrait or not audio:
        raise gr.Error('请提供头像和音频。')
    wave,_=librosa.load(audio, sr=16000, mono=True, duration=31)
    if not 0.5 <= len(wave)/16000 <= 30:
        raise gr.Error('预览音频长度需为 0.5–30 秒。')
    started=time.perf_counter()
    if pipeline is None:
        yield None,None,'正在加载模型，首次启动需要稍等。'
        pipeline=get_pipeline(1,'models/SoulX-FlashHead-1_3B','lite','models/wav2vec2-base-960h')
    get_base_data(pipeline,portrait,9999,False)
    p=get_infer_params()
    motion=p['motion_frames_num']; step=p['frame_num']-motion
    n=step*16000//p['tgt_fps']
    wave=np.pad(wave,(0,(-len(wave))%n))
    chunks=wave.reshape(-1,n)
    buf=deque([0.0]*(16000*p['cached_audio_duration']),maxlen=16000*p['cached_audio_duration'])
    job=OUT/uuid.uuid4().hex
    job.mkdir()
    all_frames=[]; segment_frames=[]; segment_audio=[]
    for i,chunk in enumerate(chunks):
        buf.extend(chunk.tolist())
        end=p['cached_audio_duration']*p['tgt_fps']
        emb=get_audio_embedding(pipeline,np.asarray(buf,dtype=np.float32),end-p['frame_num'],end)
        frames=run_pipeline(pipeline,emb)[motion:].cpu()
        all_frames.append(frames);segment_frames.append(frames);segment_audio.append(chunk)
        if len(segment_frames)==3 or i==len(chunks)-1:
            wav=job/f'segment-{i}.wav'; mp4=job/f'segment-{i}.mp4'
            sf.write(wav,np.concatenate(segment_audio),16000)
            save_video_with_audio(segment_frames,str(mp4),str(wav),p['tgt_fps'])
            yield str(mp4),None,f'已生成 {i+1}/{len(chunks)} 段 · 用时 {time.perf_counter()-started:.1f}s'
            segment_frames=[];segment_audio=[]
    fullwav=job/'speech.wav'; full=job/'avatar.mp4'
    sf.write(fullwav,wave,16000)
    save_video_with_audio(all_frames,str(full),str(fullwav),p['tgt_fps'])
    if not (OUT/'speech-v2.mp4').exists():
        shutil.copyfile(full,OUT/'speech-v2.mp4')
    elapsed=time.perf_counter()-started
    duration=len(wave)/16000
    yield None,str(full),f'完成 · 视频 {duration:.1f}s · 总耗时 {elapsed:.1f}s（含初始化与编码）'

def render(portrait, audio):
    from streaming import MODEL_LOCK
    with MODEL_LOCK:
        yield from _render(portrait, audio)

css='body,.gradio-container{background:#160f12!important;color:#f6eeee!important} .gradio-container{max-width:1160px!important} h1{color:#edb0b9!important}'
with gr.Blocks(title='数字人 · Mini 02',css=css,theme=gr.themes.Base(primary_hue='rose')) as app:
    gr.Markdown('# 数字人 · Mini 02\nSoulX-FlashHead Lite / 独立数字人服务 · 原创虚拟形象\n\n音频驱动的视频效果预览。此页尚未接入实时双工会话、抢话和取消。')
    gr.HTML('<iframe src="http://localhost:8027/preview" title="数字人循环播放预览" allow="autoplay" style="width:100%;height:610px;border:0;border-radius:14px"></iframe>')
    with gr.Row():
        with gr.Column():
            portrait=gr.Image(value=str(ROOT/'virtual-host-v2.png'),type='filepath',label='虚拟形象',height=360)
            audio=gr.Audio(value=str(ROOT/'sample.wav'),type='filepath',label='驱动音频 · 可上传或录音（最长30秒）',sources=['upload','microphone'])
            button=gr.Button('生成数字人预览',variant='primary')
        with gr.Column():
            video=gr.Video(label='分段预览',streaming=True,autoplay=True,height=420)
            final=gr.Video(value=lambda: str(OUT/'speech-v2.mp4') if (OUT/'speech-v2.mp4').exists() else None,label='完整视频 · 可下载')
            status=gr.Textbox(label='运行状态',interactive=False)
    button.click(render,[portrait,audio],[video,final,status],concurrency_limit=1,api_name='render_avatar')
app.queue(max_size=3,default_concurrency_limit=1)
if __name__=='__main__':
    import sys, uvicorn
    from streaming import mount
    uvicorn.run(mount(sys.modules[__name__]),host='127.0.0.1',port=8026,ws_ping_interval=20,ws_ping_timeout=120)
