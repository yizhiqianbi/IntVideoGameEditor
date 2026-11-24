import sys,time,json
from pathlib import Path
import numpy as np
sys.path.insert(0,'/data/zrc/dyt/avatar-mini02')
from streaming import encode
class Frames:
 def numpy(self):return np.zeros((48,512,512,3),dtype=np.uint8)
for codec in ['libx264','h264_nvenc']:
 for i in range(3):
  start=time.perf_counter();result=encode([Frames()],np.zeros(30720,np.float32),Path('/tmp/avatar-encode-bench.mp4'),25,codec)
  print(json.dumps({'codec':result,'seconds':round(time.perf_counter()-start,3)}),flush=True)
Path('/tmp/avatar-encode-bench.mp4').unlink(missing_ok=True)
