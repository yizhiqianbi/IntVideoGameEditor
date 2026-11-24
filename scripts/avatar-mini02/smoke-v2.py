from pathlib import Path
import shutil, time
from gradio_client import Client, handle_file
root=Path('/data/zrc/dyt/avatar-mini02')
t=time.time()
r=Client('http://127.0.0.1:8026',download_files=False).predict(handle_file(str(root/'virtual-host-v2.png')),handle_file(str(root/'sample.wav')),api_name='/render_avatar')
shutil.copyfile(r[1]['video']['path'],root/'output/speech-v2.mp4')
print('SPEECH_V2_READY',round(time.time()-t,2),flush=True)
