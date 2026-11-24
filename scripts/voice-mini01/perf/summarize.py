import json,statistics,sys
from pathlib import Path
p=Path(sys.argv[1]);data=json.loads(p.read_text());out=[]
for run in data['runs']:
 rows=[x for x in run['records'] if not x['listen'] and x['audio_s']>0]
 steady=[x for x in rows if x['n_tts_tokens']==25 and .99<x['audio_s']<1.01]
 if not rows:continue
 s={'name':run['name'],'threads':run['threads'],'speech_blocks':len(rows),'steady_blocks':len(steady),'audio_s':sum(x['audio_s']for x in rows),'rtf':sum(x['prefill_ms']+x['generate_ms']+x['finalize_ms']for x in rows)/1000/sum(x['audio_s']for x in rows)}
 for k in ['prefill_ms','generate_ms','finalize_ms','cost_llm_ms','cost_tts_ms','cost_token2wav_ms']:
  vals=[x[k]for x in steady if x.get(k)is not None]
  if vals:s[k]=statistics.median(vals)
 out.append(s)
print(json.dumps(out,indent=2));p.with_name('ab-summary.json').write_text(json.dumps(out,indent=2))
