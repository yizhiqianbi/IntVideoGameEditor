import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewedSpeechText } from '../src/server/reviewed-speech';
import { reviewCompanionResponse } from '../src/server/companion-review';
import { createGateway } from '../engine/companion-native/runtime/gateway.mjs';
const accountId='00000000-0000-4000-8000-000000000001';
const scope={accountId,profile:'classic' as const};
const secret='fixture-secret-not-deployment-'.repeat(2);
const env={COMPANION_MEDIA_REVIEW_SECRET:secret,MODERATION_BASE_URL:'https://review.test/v1',MODERATION_API_KEY:'fixture',MODERATION_MODEL:'fixture'};
const bytes=Buffer.from('ID3-fixture-binary-audio');
const url='data:audio/mpeg;base64,'+bytes.toString('base64');
function proof(){
  const data={version:1,kind:'audio',accountId,profile:'classic',sha256:createHash('sha256').update(bytes).digest('hex'),text:'今天也想听听你的故事。',reviewedAt:Date.now()};
  return {...data,signature:createHmac('sha256',secret).update(JSON.stringify([1,'audio',data.accountId,data.profile,data.sha256,data.text,data.reviewedAt])).digest('hex')};
}
test('reviewed native speech requires matching bytes, owner, character, transcript and signature',async()=>{
  const good=proof();assert.equal(await reviewedSpeechText(url,good,env,scope),good.text);
  for(const [audio,changed,owner]of[
    [url,{...good,text:'changed source'},scope],
    [url,{...good,signature:'0'.repeat(64)},scope],
    [url,{...good,reviewedAt:Date.now()+600_000},scope],
    [url,{...good,unexpected:true},scope],
    [url,good,{...scope,accountId:'other'}],
    [url,good,{...scope,profile:'traveler'}],
    ['data:audio/mpeg;base64,'+Buffer.from('different-audio').toString('base64'),good,scope],
    ['https://cdn.test/audio.mp3',good,scope],
  ] as const) await assert.rejects(()=>reviewedSpeechText(audio,changed,env,owner as any));
});
test('a valid speech proof still requires semantic review of the actual TTS source before release',async()=>{
  const clip={kind:'voice',url,qingyuSpeechReview:proof()};let checked='';
  const f=(async(_url:unknown,init:any)=>{checked=JSON.parse(init.body).input;return Response.json({results:[{flagged:false}]});})as typeof fetch;
  const response=Response.json({messages:[{role:'assistant',text:'你好。',media:[clip]}]});
  assert.equal(await reviewCompanionResponse(response,env,f,scope),response);
  assert.ok(checked.includes(clip.qingyuSpeechReview.text));
  await assert.rejects(()=>reviewCompanionResponse(response,env,(async()=>Response.json({results:[{flagged:true}]}))as typeof fetch,scope));
});
test('native transport attaches only the content-addressed private speech record and persists it with the real native event',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'qingyu-speech-transport-'));
  const native={connected:true,opened:new Set(),async connect(){},async open(){},close(){}};
  const gateway=await createGateway({instanceDir:directory,nativeClient:native});
  try{
    const {session}=await gateway.create({characterId:'yume'});
    const good=proof();const records=join(directory,'data','qingyu-reviewed-speech');await mkdir(records,{recursive:true});
    await writeFile(join(records,`${good.sha256}.json`),JSON.stringify(good),{mode:0o600});
    await (native as any).onEvent(session.id,'bot_message',{message_id:'native-voice',timestamp:Date.now()/1000,segments:[{type:'voice',data:url}]});
    const read=await gateway.read(session.id);const media=read.session.messages[0].media[0];
    assert.deepEqual(media.qingyuSpeechReview,good);
    assert.equal(await reviewedSpeechText(media.url,media.qingyuSpeechReview,env,scope),good.text);
  }finally{await gateway.close();await rm(directory,{recursive:true,force:true});}
});


test('the actual Python speech-record writer produces the exact signature consumed by the public Worker',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'qingyu-speech-cross-language-'));
  try{
    const script=`import importlib.util,json,sys,base64
spec=importlib.util.spec_from_file_location("qy_review",sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(module.record_reviewed_speech(base64.b64decode(sys.argv[2]),sys.argv[3]),ensure_ascii=False))`;
    const output=execFileSync('python3',['-c',script,fileURLToPath(new URL('../engine/companion-native/plugins/xumeng_media/review.py',import.meta.url)),bytes.toString('base64'),'一起听听海风。'],{
      encoding:'utf8',env:{PATH:process.env.PATH,MAIBOT_INSTANCE_DIR:directory,COMPANION_ACCOUNT_ID:accountId,COMPANION_PROFILE:scope.profile,COMPANION_MEDIA_REVIEW_SECRET:secret},
    });
    const generated=JSON.parse(output);
    assert.equal(await reviewedSpeechText(url,generated,env,scope),'一起听听海风。');
  }finally{await rm(directory,{recursive:true,force:true});}
});
