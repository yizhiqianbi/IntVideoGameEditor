"""Opt-in removal of model-inserted padding only; default remains upstream-compatible."""
from pathlib import Path
p=Path('/data/zrc/dyt/voice-mini01/upstream/MiniCPMO45/modeling_minicpmo_unified.py')
s=p.read_text()
old='if not is_last_chunk and len(audio_waveform) < min_samples:'
new='if os.environ.get("MINI01_PAD_AUDIO", "1") == "1" and not is_last_chunk and len(audio_waveform) < min_samples:'
if new not in s:
 assert s.count(old)==1
 backup=p.with_suffix('.py.before-padding-opt')
 if not backup.exists():backup.write_text(s)
 p.write_text(s.replace(old,new))
print('Padding flag installed; behavior unchanged unless MINI01_PAD_AUDIO=0')
