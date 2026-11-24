"""Offline single-GPU A/B; no user recordings; writes progress after every unit."""
import os,time,json,random,base64,statistics
from pathlib import Path
import numpy as np,soundfile as sf,torch
from config import get_config
from core.processors.unified import UnifiedProcessor
ROOT=Path('/data/zrc/dyt/voice-mini01');OUT=ROOT/'perf';OUT.mkdir(exist_ok=True)
default_threads=torch.get_num_threads()
torch.set_num_threads(4)
cfg=get_config()
p=UnifiedProcessor(model_path=str(ROOT/'models/MiniCPM-o-4_5'),ref_audio_path=cfg.ref_audio_path,compile=False,attn_implementation='sdpa',chat_vocoder=cfg.chat_vocoder)
wave,sr=sf.read(ROOT/'voice-mini01-input.wav',dtype='float32');assert sr==16000
runs=[]
def trial(name,threads):
 torch.set_num_threads(threads);random.seed(42);np.random.seed(42);torch.manual_seed(42);torch.cuda.manual_seed_all(42)
 v=p.set_duplex_mode();v.prepare(system_prompt_text='你是中文虚拟陪伴助手小玥。请自然友好地与用户聊天，每次只回答一到两句，尽量不超过25个汉字。')
 records=[];run={'name':name,'threads':threads,'records':records};runs.append(run)
 for i in range(18):
  chunk=np.zeros(16000,np.float32);part=wave[i*16000:(i+1)*16000];chunk[:len(part)]=part
  t=time.perf_counter();pf=v.prefill(audio_waveform=chunk);pf_s=time.perf_counter()-t
  t=time.perf_counter();r=v.generate(force_listen=i<4);gen=time.perf_counter()-t
  t=time.perf_counter();v.finalize();final=time.perf_counter()-t
  raw=base64.b64decode(r.audio_data) if r.audio_data else b''
  row={'i':i,'listen':r.is_listen,'audio_s':len(raw)/4/24000,'prefill_ms':pf_s*1000,'generate_ms':gen*1000,'finalize_ms':final*1000}
  for k in ['cost_llm_ms','cost_tts_prep_ms','cost_tts_ms','cost_token2wav_ms','n_tokens','n_tts_tokens']:row[k]=getattr(r,k,None)
  records.append(row);(OUT/'ab.json').write_text(json.dumps({'default_threads':default_threads,'runs':runs},indent=2));print('UNIT',name,json.dumps(row),flush=True)
  if r.end_of_turn and any(x['audio_s'] for x in records):break
 v.stop()
 for k in ['prefill_ms','generate_ms','finalize_ms','cost_llm_ms','cost_tts_ms','cost_token2wav_ms']:
  vals=[x[k] for x in records if not x['listen'] and x['audio_s']>0 and x.get(k) is not None]
  if vals:run[k+'_median']=statistics.median(vals)
 run['audio_s']=sum(x['audio_s'] for x in records if not x['listen'])
 run['speak_rtf']=sum((x['prefill_ms']+x['generate_ms']+x['finalize_ms'])/1000 for x in records if not x['listen'] and x['audio_s']>0)/max(.01,run['audio_s'])
 print('SUMMARY',json.dumps({k:v for k,v in run.items() if k!='records'}),flush=True)
 (OUT/'ab.json').write_text(json.dumps({'default_threads':default_threads,'runs':runs},indent=2))
for n in dict.fromkeys([default_threads,4,1,8]):trial('eager-'+str(n),n)
best=min(runs,key=lambda r:r['speak_rtf'] if r['audio_s'] else float('inf'))['threads']
torch.set_num_threads(best)
print('COMPILE_BEGIN',best,flush=True)
p.model.apply_torch_compile(mode='default',dynamic=True)
trial('compiled-cold',best)
trial('compiled-warm',best)
