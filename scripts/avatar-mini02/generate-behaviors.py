"""Generate silent portrait motion clips with the installed MiniMax H3 I2V workflow.
No CSS transforms or reversed frames are used to synthesize the actions.
"""
import json, time, shutil
from pathlib import Path
import requests
ROOT=Path('/data/zrc/dyt/avatar-mini02')
OUT=ROOT/'output/behaviors-v2'; OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:6006'
with (ROOT/'virtual-host-v2.png').open('rb') as f:
    image=requests.post(BASE+'/upload/image',files={'image':('avatar-v2.png',f,'image/png')},data={'overwrite':'true'},timeout=60).json()['name']
ACTIONS={
'nodding':'She gently nods her head down and up twice in warm agreement. Her neck and chin actually articulate, her hair moves naturally. Her shoulders and the background stay steady. Her lips stay closed. She returns to the original relaxed head position.',
'smiling':'Her expression gradually brightens into a warm, charming, relaxed smile. Her cheeks lift and eyes softly narrow with genuine happiness, then she returns to the initial subtle smile. Lips stay closed. A natural blink and subtle breathing.',
'listening':'She listens attentively with soft direct eye contact, slightly tilts her head with curiosity, naturally blinks once and breathes gently. Her lips remain still and closed; she is not speaking. Then her head returns to its original position.',
 'thinking':'She quietly considers a thought, her eyes glance slightly upward and to the side, her brows subtly lift, and her head tilts a little. Her lips remain closed; she is not speaking. She returns her gaze and head to the initial camera-facing position.'}
def graph(action,seed):
    g={}
    def node(i,t,**kw):g[str(i)]={'class_type':t,'inputs':kw}
    node(1,'UNETLoader',unet_name='minimax_h3_fl2va_pruned_int8_convrot.safetensors',weight_dtype='default')
    node(2,'CLIPLoader',clip_name='qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type='minimax',device='default')
    node(3,'VAELoader',vae_name='minimax_h3_video_vae_fp16.safetensors')
    node(5,'LoraLoaderModelOnly',model=['1',0],lora_name='minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',strength_model=1)
    node(20,'LoadImage',image=image)
    node(7,'MiniMaxH3ImageToVideo',clip=['2',0],vae=['3',0],prompt='Locked-off portrait video of the same adult woman. '+action+' Preserve her identity, clothing, lighting and composition. No camera movement, no zoom, no cuts, no talking, no text. Subtle lifelike facial performance.',width=480,height=480,length=124,first_frame=['20',0],last_frame=['20',0])
    node(8,'RandomNoise',noise_seed=seed)
    node(9,'KSamplerSelect',sampler_name='euler')
    node(10,'BasicScheduler',model=['5',0],scheduler='beta',steps=8,denoise=1)
    node(11,'BasicGuider',model=['5',0],conditioning=['7',0])
    node(12,'SamplerCustomAdvanced',noise=['8',0],guider=['11',0],sampler=['9',0],sigmas=['10',0],latent_image=['7',1])
    node(13,'VAEDecode',samples=['12',0],vae=['3',0])
    node(15,'CreateVideo',images=['13',0],fps=24,bit_depth=8)
    node(16,'SaveVideo',video=['15',0],filename_prefix='avatar-behaviors/v2',format='mp4',codec='h264')
    return g
for i,(name,action) in enumerate(ACTIONS.items()):
    if (OUT/f'{name}.mp4').exists():continue
    started=time.time();g=graph(action,20260927+i)
    (OUT/f'{name}-workflow.json').write_text(json.dumps(g,indent=2))
    r=requests.post(BASE+'/prompt',json={'prompt':g,'client_id':'avatar-behaviors-v2'},timeout=60)
    if not r.ok:raise RuntimeError(r.text)
    pid=r.json()['prompt_id'];print(name,'queued',pid,flush=True)
    (OUT/f'{name}-job.json').write_text(json.dumps({'prompt_id':pid,'action':action}))
    while True:
        h=requests.get(BASE+'/history/'+pid,timeout=30).json().get(pid)
        if h:
            if h.get('status',{}).get('status_str')=='error':raise RuntimeError(json.dumps(h['status']))
            files=[]
            for out in h.get('outputs',{}).values():
                for key in ('images','gifs','videos'):
                    files.extend(x for x in out.get(key,[]) if x.get('filename','').endswith('.mp4'))
            if files:
                src=Path('/data/zrc/dyt/ComfyUI/output')/files[0].get('subfolder','')/files[0]['filename']
                shutil.copyfile(src,OUT/f'{name}.mp4')
                print(name,'READY',round(time.time()-started,1),flush=True);break
            if h.get('status',{}).get('completed'):raise RuntimeError('No output video: '+str(h))
        time.sleep(5)
print('ALL_BEHAVIORS_READY',flush=True)
