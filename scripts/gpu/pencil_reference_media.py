"""Bounded reference uploads and low-resolution 24 FPS video conditioning."""
import asyncio, base64, json, math, re
from pathlib import Path
import av
import numpy as np
import torch
from aiohttp import web
import folder_paths
from server import PromptServer

ROOT = Path(folder_paths.get_input_directory()) / 'pencil_refs'
ROOT.mkdir(exist_ok=True)
LOCK = asyncio.Lock()
MAX_CHUNK = 4 * 1024 * 1024

def paths(media_id):
    if not re.fullmatch(r'[a-f0-9]{32}', media_id):
        raise ValueError('Invalid media ID')
    return ROOT / (media_id + '.bin'), ROOT / (media_id + '.idx'), ROOT / (media_id + '.json')

def inspect_file(path, kind, max_seconds=15.05):
    with av.open(str(path)) as container:
        streams = list(container.streams.video if kind == 'video' else container.streams.audio)
        if not streams:
            raise ValueError('文件中没有所选类型的轨道')
        stream = streams[0]
        duration = float(stream.duration * stream.time_base) if stream.duration else float(container.duration or 0) / av.time_base
        minimum = 0.21 if max_seconds > 15.05 else 2
        if not math.isfinite(duration) or not minimum <= duration <= max_seconds:
            raise ValueError(
                f'每段参考素材必须为 {minimum:g}–{max_seconds:g} 秒'
            )
        if kind == 'video' and (stream.width > 4096 or stream.height > 4096):
            raise ValueError('参考视频请先缩小到 4K 以下')
        return duration

@PromptServer.instance.routes.post('/pencil/references')
async def upload(request):
    try:
        data = await request.json()
        media_id, kind = data['id'], data['kind']
        if kind not in ('video', 'audio'): raise ValueError('Invalid media kind')
        path, meta_idx, meta = paths(media_id)
        index, total = data['index'], data['total']
        timeline = data.get('timeline') is True
        max_mb = (200 if kind == 'video' else 40) if timeline else (50 if kind == 'video' else 15)
        max_bytes = max_mb * 1024 * 1024
        max_seconds = 180.0 if timeline else 15.05
        max_chunks = 256
        if type(index) is not int or type(total) is not int or not 0 <= index < total <= max_chunks:
            raise ValueError('Invalid chunk count')
        chunk = base64.b64decode(data['data'], validate=True)
        if not 0 < len(chunk) <= MAX_CHUNK:
            raise ValueError('Invalid chunk size')
        async with LOCK:
            if meta.exists(): raise ValueError('素材已上传，请使用新的 ID')
            next_index = int(meta_idx.read_text()) if meta_idx.exists() else 0
            if index != next_index:
                raise ValueError('分片顺序错误，请重新上传')
            size = path.stat().st_size if path.exists() else 0
            if size + len(chunk) > max_bytes:
                raise ValueError(f'参考素材不能超过 {max_mb}MB')
            with path.open('ab') as f:
                f.write(chunk)
            if index == total - 1:
                if meta_idx.exists():
                    meta_idx.unlink()
                try:
                    duration = await asyncio.to_thread(inspect_file, path, kind, max_seconds)
                    with av.open(str(path)) as container:
                        fmt = container.format.name
                    if kind == 'video' and not ('mov' in fmt or 'mp4' in fmt): raise ValueError('视频请使用 MP4 或 MOV')
                    if kind == 'audio' and fmt not in ('wav', 'mp3'): raise ValueError('音频请使用 WAV 或 MP3')
                    filename = media_id + ('.mp4' if kind == 'video' else '.mp3' if fmt == 'mp3' else '.wav')
                    path.rename(ROOT / filename)
                    result = {'id':media_id, 'kind':kind, 'duration':duration, 'size':size + len(chunk), 'file':'pencil_refs/' + filename}
                    meta.write_text(json.dumps(result))
                    return web.json_response(result)
                except Exception:
                    path.unlink(missing_ok=True)
                    raise
            meta_idx.write_text(str(index + 1))
            return web.json_response({'uploaded':index + 1,'total':total})
    except Exception as e:
        return web.json_response({'error':str(e)}, status=400)

@PromptServer.instance.routes.get('/pencil/references/{media_id}')
async def read(request):
    try:
        _, _, meta = paths(request.match_info['media_id'])
        data = json.loads(meta.read_text())
        if request.query.get('metadata') == '1': return web.json_response(data)
        return web.FileResponse(Path(folder_paths.get_input_directory()) / data['file'])
    except Exception:
        raise web.HTTPNotFound()

class PencilLoadReferenceVideo:
    @classmethod
    def INPUT_TYPES(cls): return {'required':{'file':('STRING',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'load'
    CATEGORY = 'Pencil/References'
    def load(self, file):
        if not re.fullmatch(r'pencil_refs/[a-f0-9]{32}\.mp4',file): raise ValueError('Invalid reference file')
        path = Path(folder_paths.get_input_directory()) / file
        duration = inspect_file(path, 'video')
        frames, next_time = [], 0.0
        with av.open(str(path)) as container:
            stream = container.streams.video[0]
            scale = min(1, 512 / max(stream.width, stream.height))
            width, height = max(2, round(stream.width*scale)), max(2, round(stream.height*scale))
            first_time = None
            for index, frame in enumerate(container.decode(stream)):
                t = float(frame.time) if frame.time is not None else index / float(stream.average_rate or 24)
                if first_time is None: first_time = t
                t -= first_time
                if t + 1e-5 < next_time: continue
                arr = frame.reformat(width=width,height=height,format='rgb24').to_ndarray()
                while next_time <= t + 1e-5 and len(frames) < 360:
                    frames.append(arr)
                    next_time += 1/24
                if len(frames) >= 360: break
            target = min(360, round(duration * 24))
            while frames and len(frames) < target: frames.append(frames[-1])
        if not frames: raise ValueError('参考视频无法解码')
        return (torch.from_numpy(np.stack(frames)).float().div_(255),)

NODE_CLASS_MAPPINGS = {'PencilLoadReferenceVideo':PencilLoadReferenceVideo}
NODE_DISPLAY_NAME_MAPPINGS = {'PencilLoadReferenceVideo':'Pencil Reference Video · 24 FPS / 512px'}
