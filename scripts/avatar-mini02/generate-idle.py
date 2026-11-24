"""Generate a silent idle clip from the same avatar, then make a seamless ping-pong loop."""
import json, shutil, subprocess, time
from pathlib import Path
import numpy as np
import soundfile as sf
from gradio_client import Client, handle_file
root=Path('/data/zrc/dyt/avatar-mini02')
silent=root/'idle-silence.wav'
sf.write(silent,np.zeros(16000*5,dtype=np.float32),16000)
t=time.perf_counter()
result=Client('http://127.0.0.1:8026',download_files=False).predict(handle_file(str(root/'virtual-host.png')),handle_file(str(silent)),api_name='/render_avatar')
raw=root/'output/idle-source.mp4'
shutil.copyfile(result[1]['video']['path'],raw)
# Forward/reverse retains subtle movement and has matching endpoints, with no audio.
subprocess.run(['ffmpeg','-nostdin','-y','-i',str(raw),'-filter_complex','[0:v]split[a][b];[a]setpts=PTS-STARTPTS[f];[b]reverse,setpts=PTS-STARTPTS[r];[f][r]concat=n=2:v=1:a=0[v]','-map','[v]','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(root/'output/idle-loop.mp4')],check=True,capture_output=True)
(root/'idle-result.json').write_text(json.dumps({'elapsed_s':time.perf_counter()-t,'result':result,'loop':'output/idle-loop.mp4'},ensure_ascii=False,indent=2))
print('IDLE_READY',round(time.perf_counter()-t,2))
