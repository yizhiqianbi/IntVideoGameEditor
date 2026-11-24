import json
import time
from pathlib import Path
from gradio_client import Client, handle_file
root=Path('/data/zrc/dyt/avatar-mini02')
start=time.perf_counter()
client=Client('http://127.0.0.1:8026',download_files=False)
result=client.predict(handle_file(str(root/'virtual-host.png')),handle_file(str(root/'sample.wav')),api_name='/render_avatar')
report={'elapsed_s':time.perf_counter()-start,'result':result}
(root/'smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
