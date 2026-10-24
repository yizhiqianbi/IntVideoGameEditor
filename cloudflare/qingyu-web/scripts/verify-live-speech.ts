import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { reviewCompanionResponse } from '../src/server/companion-review';
const run=promisify(execFile);
const root=new URL('../',import.meta.url);
const env=Object.fromEntries((await readFile(new URL('.dev.vars',root),'utf8')).trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),JSON.parse(line.slice(at+1))];}));
const directory=new URL('.runtime/native-media-live/',root);await mkdir(directory,{recursive:true});
const file=new URL('voice.mp3',directory);
const accountId='beb85098-4676-412f-bd17-faf3f025196a';
const start=Date.now();
try{
  const {stdout}=await run('/opt/homebrew/Caskroom/miniconda/base/bin/python3.13',[fileURLToPath(new URL('verify-native-media-adapter.py',import.meta.url)),fileURLToPath(file)],{timeout:100_000,maxBuffer:32_000,env:{PATH:process.env.PATH,
    HTTPS_PROXY:process.env.HTTPS_PROXY,HTTP_PROXY:process.env.HTTP_PROXY,ALL_PROXY:process.env.ALL_PROXY,
    COMPANION_OPENROUTER_BASE_URL:env.CHAT_BASE_URL,COMPANION_OPENROUTER_API_KEY:env.CHAT_API_KEY,
    COMPANION_MEDIA_REVIEW_SECRET:env.COMPANION_MEDIA_REVIEW_SECRET,COMPANION_REVIEW_MODEL:env.MODERATION_MODEL,
    COMPANION_ACCOUNT_ID:accountId,COMPANION_PROFILE:'classic',MAIBOT_INSTANCE_DIR:fileURLToPath(directory),
  }});
  const adapter=JSON.parse(stdout);if(adapter.error)throw new Error(adapter.error);
  const audio=await readFile(file);const sha256=createHash('sha256').update(audio).digest('hex');
  const proof=JSON.parse(await readFile(new URL(`data/qingyu-reviewed-speech/${sha256}.json`,directory),'utf8'));
  await reviewCompanionResponse(Response.json({messages:[{role:'assistant',media:[{kind:'voice',url:`data:audio/mpeg;base64,${audio.toString('base64')}`,qingyuSpeechReview:proof}]}]}),env,fetch,{accountId,profile:'classic'});
  const {stdout:probe}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',fileURLToPath(file)]);
  const evidence={checkedAt:new Date().toISOString(),scope:'Qingyu media adapter + actual provider + Python source proof + native-byte transport contract + public verification; full native bot/container not started',provider:'OpenRouter',model:'x-ai/grok-voice-tts-1.0',voice:'rex',reviewModel:env.MODERATION_MODEL,sourceText:proof.text,bytes:audio.length,sha256,durationSeconds:Number(JSON.parse(probe).format.duration),durationMs:Date.now()-start,passed:true};
  await copyFile(file,new URL('../../../output/playwright/qingyu/reviewed-voice-preview.mp3',import.meta.url));
  await writeFile(new URL('evidence/live-reviewed-speech.json',root),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}catch(error:any){
  const evidence={checkedAt:new Date().toISOString(),passed:false,error:String(error.message??'media adapter failed').replaceAll(env.CHAT_API_KEY,'[redacted]').slice(0,500)};
  await writeFile(new URL('evidence/live-reviewed-speech.json',root),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));process.exitCode=1;
}
