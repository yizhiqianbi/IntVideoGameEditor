import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const origin='http://localhost:3011';
const statePath='output/gpu-verification.json';mkdirSync('output',{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const started=Date.now();
let state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
async function request(path,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(55000)});const d=await r.json();if(!r.ok)throw new Error(d.error||r.statusText);return d;}
while(!state.taskId){
 const health=await request('/api/drama/health');
 if(health.ready){
  // Persist an intent before submitting: never silently resubmit an uncertain request.
  if(state.submitting)throw new Error('Previous submit uncertain. Inspect ComfyUI queue before retrying.');
  state={submitting:true};writeFileSync(statePath,JSON.stringify(state));
  const task=await request('/api/drama/video',{provider:'comfy',action:'create',mode:'t2v',prompt:'A small orange cat walks slowly through a sunlit garden. One continuous locked camera shot. Natural real-time walking pace. Soft afternoon light, gentle breeze, quiet birdsong. No titles, no subtitles.',aspectRatio:'16:9'});
  state={...task,started:new Date().toISOString()};writeFileSync(statePath,JSON.stringify(state));console.log('GPU smoke test submitted',task.taskId);break;
 }
 if(Date.now()-started>4*60*60*1000)throw new Error('Model preparation exceeded four hours');
 await sleep(15000);
}
while(state.status!=='COMPLETED'){
 const d=await request('/api/drama/video',{provider:'comfy',action:'status',mode:'t2v',taskId:state.taskId});
 if(d.status!==state.status)console.log('GPU smoke test',d.status);
 state={...state,...d};writeFileSync(statePath,JSON.stringify(state,null,2));
 if(d.status==='FAILED')throw new Error(d.error);
 if(d.status==='COMPLETED')break;
 if(Date.now()-started>5*60*60*1000)throw new Error('Verification timed out');
 await sleep(10000);
}
const response=await fetch(origin+state.videoUrl);if(!response.ok)throw new Error('Video playback proxy failed');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length<1000)throw new Error('Video is empty');writeFileSync('output/gpu-verification.mp4',bytes);console.log('Verified MP4 through local workbench',bytes.length,'bytes',state.videoUrl);
