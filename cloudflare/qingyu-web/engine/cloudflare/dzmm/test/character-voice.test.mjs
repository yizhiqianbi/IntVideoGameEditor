import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { handleCharacterVoice, CHARACTER_VOICE_MODEL, characterVoiceFingerprint } = await tsImport('../src/character-voice.ts', import.meta.url);
const { handleChatMedia } = await tsImport('../src/chat-media.ts', import.meta.url);
const BASE = Date.parse('2026-10-10T02:00:00Z'), DAY = 86400000;
const MP3 = Uint8Array.from([73,68,51,4,0,0,0,0,0,0,...Array(118).fill(0)]);
let store, DB, MEDIA;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate:'2026-10-01', modules:true,
    script:'export default {fetch(){return new Response("isolated character voice")}}', d1Databases:{DB:'character-voice-test'}, r2Buckets:{MEDIA:'character-voice-test'} }));
  DB = await store.getD1Database('DB'); MEDIA = await store.getR2Bucket('MEDIA');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort())
    await DB.batch(splitSqlStatements(await readFile(new URL(`../migrations/${file}`, import.meta.url),'utf8')).filter(part => part.trim()).map(part => DB.prepare(part)));
});
after(async () => { await store?.dispose(); });
async function fixture({vip=true, guest=false, role='user'}={}) {
  const user = {id:randomUUID(), email:null, nickname:'朗读测试用户', isGuest:guest, role, version:0};
  const token = randomBytes(32).toString('hex'), hash = createHash('sha256').update(token).digest('hex');
  await DB.batch([
    DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,?,?,?)').bind(user.id,user.nickname,Number(guest),role,BASE),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash,user.id,Date.now()+366*DAY,BASE),
  ]);
  const f = {user,token,hash,now:BASE,calls:[]};
  f.env = {DB,MEDIA,AI:{async run(model,input){f.calls.push({model,input});return MP3;}},CHAT_MEDIA_ENABLED:'true',APP_ORIGINS:'https://qingyu.invalid'};
  if (vip) {
    const order = randomUUID(), event = randomUUID(), period = randomUUID();
    await DB.batch([
      DB.prepare(`INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,duration_days,daily_credits,max_claims,timezone,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,status,created_at,updated_at)
        VALUES(?,?,?,'monthly_basic',1,'VIP',2800,30,100,30,'Asia/Shanghai','alipay',?,'test','test','VIP','/test','paid',?,?)`).bind(order,user.id,randomUUID(),Array.from(randomUUID().replaceAll('-','')).map(char=>parseInt(char,16)%10).join(''),BASE,BASE),
      DB.prepare("INSERT INTO subscription_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at) VALUES(?,'notify',?,?,?,?)").bind(event,order,randomUUID(),randomUUID(),BASE),
      DB.prepare('INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(period,user.id,order,event,BASE-1000,BASE-1000+30*DAY,BASE),
    ]);
  }
  return f;
}
async function call(f,path,{method='GET',body,headers={},env=f.env,options={}}={}) {
  const request = new Request(`https://qingyu.invalid${path}`,{method,headers:{Cookie:`qingyu_session=${f.token}`,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  let response;
  try {response = await handleCharacterVoice(request,env,f.user,{now:()=>f.now,...options});}
  catch(error){if(!Number.isInteger(error.status))throw error;response=Response.json({error:error.message,...error.details},{status:error.status});}
  assert.ok(response);
  return {status:response.status,headers:response.headers,data:response.headers.get('Content-Type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer())};
}
function generate(f,extra={},args={}){return call(f,'/v1/character-voice/generate',{method:'POST',body:{accountId:f.user.id,name:'林舟',sourceKey:'novel:work-1:cast-1',text:'**你好**，今天一起去看海吧。',...extra},...args});}
function expect(result,status){assert.equal(result.status,status,JSON.stringify(result.data));return result.data;}
const usage = async f => (await DB.prepare("SELECT status,COUNT(*) n FROM chat_media_usage WHERE user_id=? GROUP BY status").bind(f.user.id).all()).results;
const row = async f => DB.prepare('SELECT * FROM character_voice_assets WHERE user_id=? ORDER BY created_at DESC').bind(f.user.id).first();
const bucket = overrides => ({head:MEDIA.head.bind(MEDIA),get:MEDIA.get.bind(MEDIA),put:MEDIA.put.bind(MEDIA),delete:MEDIA.delete.bind(MEDIA),...overrides});
async function seedUsage(f,count){for(let i=0;i<count;i++)await DB.prepare("INSERT INTO chat_media_usage(id,user_id,asset_id,kind,day_key,status,created_at,expires_at) VALUES(?,?,?,'audio','2026-10-10','ready',?,?)").bind(randomUUID(),f.user.id,randomUUID(),BASE,BASE+120000).run();}

function withVidu(f,overrides={}) {
  f.voiceCalls=[];f.configuredCalls=0;
  f.env.VIDU_VOICE={async configured(){f.configuredCalls++;return true;},async generate(input){f.voiceCalls.push(input);
    return {bytes:MP3.slice().buffer,mimeType:'audio/mpeg',providerCredits:10,taskId:randomUUID()};},...overrides};
  return f;
}

test('strict inputs forbid cross-account, prompt/voice injection, oversized text and unsafe keys without provider calls',async()=>{
  const f=await fixture(),other=await fixture();
  for(const extra of [{voice:'Tina'},{prompt:'bad'},{text:'字'.repeat(801)},{text:''},{text:'\0'},{name:''},{sourceKey:'../private'},{sourceKey:'x'.repeat(281)}])expect(await generate(f,extra),400);
  expect(await generate(f,{accountId:other.user.id}),409);expect(await call(f,'/v1/character-voice?accountId=x'),400);
  expect(await call(f,'/v1/character-voice/generate'),405);expect(await call(f,'/v1/character-voice',{method:'POST'}),405);
  assert.equal(f.calls.length,0);assert.deepEqual(await usage(f),[]);
});
test('guest, missing expired revoked VIP and revoked sessions cannot generate; Super has existing unlimited preview',async()=>{
  for(const args of [{vip:false},{guest:true}]){const f=await fixture(args);expect(await generate(f),403);assert.equal(f.calls.length,0);}
  const expired=await fixture();expired.now+=31*DAY;expect(await generate(expired),403);
  const revoked=await fixture();await DB.prepare('UPDATE subscription_periods SET revoked_at=? WHERE user_id=?').bind(BASE,revoked.user.id).run();expect(await generate(revoked),403);
  const loggedOut=await fixture();await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(loggedOut.hash).run();expect(await generate(loggedOut),401);
  expect(await call(loggedOut,'/v1/character-voice'),401);
  const superUser=await fixture({vip:false,role:'super'});await seedUsage(superUser,20);const state=expect(await call(superUser,'/v1/character-voice'),200);
  assert.equal(state.quotaUnlimited,true);assert.equal(state.vip.active,false);expect(await generate(superUser),201);
});
test('default Chinese reading uses only cleaned editable text and stores private fingerprinted assets',async()=>{
  const f=await fixture(),asset=expect(await generate(f),201).asset;
  assert.deepEqual(f.calls,[{model:CHARACTER_VOICE_MODEL,input:{prompt:'你好，今天一起去看海吧。',lang:'zh'}}]);
  assert.equal(asset.sourceHash,characterVoiceFingerprint('林舟','novel:work-1:cast-1','**你好**，今天一起去看海吧。'));
  assert.equal(asset.audioTextChars,Array.from('你好，今天一起去看海吧。').length);
  const stored=await row(f),object=await MEDIA.head(stored.object_key);
  assert.deepEqual(object.customMetadata,{ownerId:f.user.id,assetId:asset.id,sourceHash:asset.sourceHash});
  assert.deepEqual(expect(await call(f,`/v1/character-voice/assets/${asset.id}`),200),MP3);
  assert.equal((await call(f,`/v1/character-voice/assets/${asset.id}`)).headers.get('Cache-Control'),'private, no-store');
  const other=await fixture();expect(await call(other,`/v1/character-voice/assets/${asset.id}`),404);
});
test('same-user cache survives quota exhaustion and only same name/source/text/model reuses the asset',async()=>{
  const f=await fixture(),first=expect(await generate(f),201).asset;
  assert.equal(expect(await generate(f),200).asset.id,first.id);assert.equal(f.calls.length,1);
  const renamed=expect(await generate(f,{name:'林舟二'}),201).asset;assert.notEqual(renamed.id,first.id);
  const changedSource=expect(await generate(f,{sourceKey:'character:other'}),201).asset;assert.notEqual(changedSource.id,first.id);
  await seedUsage(f,17);assert.equal(expect(await call(f,'/v1/character-voice'),200).usage.audio,20);
  assert.equal(expect(await generate(f),200).asset.id,first.id);expect(await generate(f,{text:'另一句。'}),429);assert.equal(f.calls.length,3);
});
test('last shared chat audio quota slot is reserved atomically across competing character requests',async()=>{
  const f=await fixture();await seedUsage(f,19);
  const results=await Promise.all([generate(f,{text:'第一句。'}),generate(f,{text:'第二句。'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,429]);assert.equal(f.calls.length,1);
  assert.equal(expect(await call(f,'/v1/character-voice'),200).usage.audio,20);
});
test('character reading and real chat-media generation race for the same last audio receipt',async()=>{
  const f=await fixture();await seedUsage(f,19);const conversation=randomUUID(),message=randomUUID();
  await DB.batch([
    DB.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,?,?,?,?)').bind(f.user.id,conversation,randomUUID(),'额度并发测试',BASE),
    DB.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,?,?,?,?,0)').bind(f.user.id,conversation,message,'assistant','聊天中的一段台词。'),
  ]);
  const chat=async()=>{
    const req=new Request('https://qingyu.invalid/v1/chat-media/generate',{method:'POST',headers:{Cookie:`qingyu_session=${f.token}`,'Content-Type':'application/json'},body:JSON.stringify({accountId:f.user.id,conversationId:conversation,messageId:message,kind:'audio'})});
    try{return (await handleChatMedia(req,f.env,f.user,{now:()=>f.now})).status;}catch(error){return error.status;}
  };
  const [reading,chatStatus]=await Promise.all([generate(f),chat()]);assert.deepEqual([reading.status,chatStatus].sort(),[201,429]);
  assert.equal(f.calls.length,1);assert.equal(expect(await call(f,'/v1/character-voice'),200).usage.audio,20);
});
test('same-source race makes only one provider call and pending receipts count in the shared quota',async()=>{
  const f=await fixture();let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),start=new Promise(resolve=>{started=resolve;});
  f.env.AI={async run(){f.calls.push({});started();await gate;return MP3;}};
  const first=generate(f);await start;
  assert.equal(expect(await call(f,'/v1/character-voice'),200).usage.audio,1);expect(await generate(f),409);
  release();expect(await first,201);assert.equal(f.calls.length,1);
});
test('provider malformed output, transport failure and timeout release reservations without exposing provider diagnostics',async()=>{
  for(const provider of [async()=>({audio:'data:secret'}),async()=>new Uint8Array(0),async()=>{throw new Error('provider secret');},async()=>new Promise(()=>{})]){
    const f=await fixture();f.env.AI={run:provider};const result=await generate(f,{}, {options:{audioTimeoutMs:5}});
    assert.ok([502,504].includes(result.status));assert.ok(!result.data.error.includes('secret'));
    assert.deepEqual(await usage(f),[{status:'failed',n:1}]);assert.equal((await row(f)).status,'failed');
  }
});
test('binary, base64 and streamed audio use shared MIME checks while markup-only input consumes nothing',async()=>{
  for(const output of [{audio:Buffer.from(MP3).toString('base64')},new ReadableStream({start(c){c.enqueue(MP3);c.close();}})]){
    const f=await fixture();f.env.AI={async run(){return output;}};assert.equal(expect(await generate(f),201).asset.mimeType,'audio/mpeg');
  }
  const f=await fixture();expect(await generate(f,{text:'```code``` https://example.test'}),400);assert.deepEqual(await usage(f),[]);
});
test('session revoked during object upload cannot commit and deletes the inaccessible object',async()=>{
  const f=await fixture();f.env.MEDIA=bucket({async put(...args){const result=await MEDIA.put(...args);await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run();return result;}});
  expect(await generate(f),401);const stored=await row(f);assert.equal(stored.status,'failed');assert.equal(await MEDIA.head(stored.object_key),null);
  assert.deepEqual(await usage(f),[{status:'failed',n:1}]);
});
test('VIP revoked during upload and expired processing reservations cannot commit or remain charged',async()=>{
  const f=await fixture();f.env.MEDIA=bucket({async put(...args){const result=await MEDIA.put(...args);await DB.prepare('UPDATE subscription_periods SET revoked_at=? WHERE user_id=?').bind(BASE,f.user.id).run();return result;}});
  expect(await generate(f),409);assert.equal((await row(f)).status,'failed');assert.deepEqual(await usage(f),[{status:'failed',n:1}]);
  const late=await fixture();late.env.AI={async run(){late.now+=121000;return MP3;}};expect(await generate(late),409);
  assert.equal((await row(late)).status,'failed');assert.deepEqual(await usage(late),[{status:'failed',n:1}]);
});
test('missing or mismatched R2 cached asset is invalidated without reclaiming successful usage',async()=>{
  const f=await fixture(),first=expect(await generate(f),201).asset,stored=await row(f);
  await MEDIA.delete(stored.object_key);expect(await generate(f),409);
  const replacement=expect(await generate(f),201).asset;assert.equal(first.id,replacement.id);assert.equal(f.calls.length,2);
  assert.deepEqual(await usage(f),[{status:'ready',n:2}]);
  const updated=await row(f);await MEDIA.put(updated.object_key,MP3,{customMetadata:{ownerId:'other',assetId:replacement.id,sourceHash:replacement.sourceHash}});
  expect(await call(f,`/v1/character-voice/assets/${replacement.id}`),404);assert.equal((await row(f)).status,'failed');
});
test('asset seek ranges validate and preserve private MIME metadata; deleting owner cascades assets and receipts',async()=>{
  const f=await fixture(),a=expect(await generate(f),201).asset,path=`/v1/character-voice/assets/${a.id}`;
  const partial=await call(f,path,{headers:{Range:'bytes=10-19'}});expect(partial,206);assert.equal(partial.data.length,10);
  assert.equal(partial.headers.get('Content-Range'),`bytes 10-19/${MP3.length}`);
  for(const range of ['bytes=','bytes=999-','bytes=1-0','bytes=1-2,4-5'])expect(await call(f,path,{headers:{Range:range}}),416);
  const usageBefore=(await usage(f)).length;assert.equal(usageBefore,1);
  await DB.prepare('DELETE FROM users WHERE id=?').bind(f.user.id).run();assert.equal(await row(f),null);assert.deepEqual(await usage(f),[]);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('speech directory includes only enabled and configured providers without requiring AI for Vidu',async()=>{
  const f=await fixture();assert.deepEqual(expect(await call(f,'/v1/character-voice'),200).speechVoices,['melotts']);
  withVidu(f);const all=expect(await call(f,'/v1/character-voice'),200).speechVoices;
  assert.equal(all.length,9);assert.ok(all.includes('female-yujie'));assert.ok(all.includes('male-qn-jingying'));
  delete f.env.AI;const viduOnly=expect(await call(f,'/v1/character-voice'),200);assert.equal(viduOnly.enabled,true);
  assert.deepEqual(viduOnly.speechVoices,all.filter(id=>id!=='melotts'));
  expect(await generate(f,{voiceId:'female-yujie'}),201);assert.equal(f.calls.length,0);assert.equal(f.voiceCalls.length,1);
  for(const configured of [async()=>false,async()=>{throw Error('secret config');}]){
    f.env.VIDU_VOICE.configured=configured;const result=expect(await call(f,'/v1/character-voice'),200);
    assert.equal(result.enabled,false);assert.deepEqual(result.speechVoices,[]);
  }
  f.env.CHAT_MEDIA_ENABLED='false';f.env.VIDU_VOICE.configured=async()=>true;
  assert.deepEqual(expect(await call(f,'/v1/character-voice'),200).speechVoices,[]);
});
test('unknown and disconnected voices fail before reservation or provider calls without a default fallback',async()=>{
  const f=withVidu(await fixture());
  for(const voiceId of ['Tina','unknown','',null,{},7])expect(await generate(f,{voiceId}),400);
  assert.equal(f.configuredCalls,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.calls,[]);
  f.env.VIDU_VOICE.configured=async()=>false;
  assert.equal(expect(await generate(f,{voiceId:'female-yujie'}),503).code,'voice_provider_unavailable');
  delete f.env.VIDU_VOICE;expect(await generate(f,{voiceId:'female-yujie'}),503);
  assert.deepEqual(await usage(f),[]);assert.deepEqual(f.calls,[]);
});
test('Vidu voices send cleaned text and exact voice IDs, with separate private cache and shared usage for each voice',async()=>{
  const f=withVidu(await fixture()),text='**你好**，今天一起去看海吧。';
  const first=expect(await generate(f,{voiceId:'female-yujie'}),201).asset;
  assert.equal(first.model,'vidu-tts');assert.equal(first.voiceId,'female-yujie');
  const raw=JSON.stringify({name:'林舟',sourceKey:'novel:work-1:cast-1',text,model:'vidu-tts',voiceId:'female-yujie'});
  assert.equal(first.sourceHash,createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(f.voiceCalls,[{text:'你好，今天一起去看海吧。',voiceId:'female-yujie'}]);assert.equal(f.calls.length,0);
  assert.equal(expect(await generate(f,{voiceId:'female-yujie'}),200).asset.id,first.id);
  const second=expect(await generate(f,{voiceId:'female-shaonv'}),201).asset;assert.notEqual(second.id,first.id);assert.notEqual(second.sourceHash,first.sourceHash);
  const defaultVoice=expect(await generate(f),201).asset;assert.equal(defaultVoice.voiceId,'melotts');assert.notEqual(defaultVoice.id,first.id);
  assert.equal(expect(await generate(f,{voiceId:'melotts'}),200).asset.id,defaultVoice.id);
  assert.equal(f.voiceCalls.length,2);assert.equal(f.calls.length,1);assert.deepEqual(await usage(f),[{status:'ready',n:3}]);
  assert.deepEqual(expect(await call(f,`/v1/character-voice/assets/${first.id}`),200),MP3);
  const other=withVidu(await fixture());expect(await call(other,`/v1/character-voice/assets/${first.id}`),404);
});
test('Vidu errors malformed RPC metadata wrong MIME oversized audio and timeout release quota without fallback or diagnostics',async()=>{
  const valid={bytes:MP3.slice().buffer,mimeType:'audio/mpeg',providerCredits:10,taskId:'task-1'};
  const corruptWav=Uint8Array.from([...Buffer.from('RIFF'),0,0,0,0,...Buffer.from('WAVE'),...Array(32).fill(0)]).buffer;
  for(const provider of [async()=>{throw Error('provider secret key');},async()=>null,async()=>({...valid,bytes:new ArrayBuffer(0)}),
    async()=>({...valid,mimeType:'audio/wav'}),async()=>({...valid,bytes:corruptWav,mimeType:'audio/wav'}),
    async()=>({...valid,providerCredits:NaN}),async()=>({...valid,taskId:'\0secret'}),
    async()=>({...valid,bytes:new ArrayBuffer(13*1024*1024)}),async()=>new Promise(()=>{})]){
    const f=withVidu(await fixture(),{generate:provider}),result=await generate(f,{voiceId:'female-yujie'},{options:{audioTimeoutMs:30}});
    assert.ok([502,504].includes(result.status));assert.ok(!result.data.error.includes('secret'));
    assert.deepEqual(await usage(f),[{status:'failed',n:1}]);assert.equal((await row(f)).status,'failed');
    assert.equal(await MEDIA.head((await row(f)).object_key),null);assert.equal(f.calls.length,0);
    assert.equal(expect(await call(f,'/v1/character-voice'),200).usage.audio,0);
  }
});
test('different Vidu voices compete atomically for the final shared quota slot and session revocation blocks commit',async()=>{
  const f=withVidu(await fixture());await seedUsage(f,19);
  const results=await Promise.all([generate(f,{voiceId:'female-yujie'}),generate(f,{voiceId:'female-shaonv'})]);
  assert.deepEqual(results.map(result=>result.status).sort(),[201,429]);assert.equal(f.voiceCalls.length,1);assert.equal(f.calls.length,0);
  assert.equal(expect(await call(f,'/v1/character-voice'),200).usage.audio,20);
  const loggedOut=withVidu(await fixture());loggedOut.env.MEDIA=bucket({async put(...args){const result=await MEDIA.put(...args);
    await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(loggedOut.hash).run();return result;}});
  expect(await generate(loggedOut,{voiceId:'female-yujie'}),401);
  const stored=await row(loggedOut);assert.equal(stored.status,'failed');assert.equal(await MEDIA.head(stored.object_key),null);
  assert.deepEqual(await usage(loggedOut),[{status:'failed',n:1}]);assert.equal(loggedOut.calls.length,0);
});
test('legacy records without a voice field retain default fingerprint cache and private asset access',async()=>{
  const f=await fixture(),id=randomUUID(),token=randomUUID(),text='**你好**，今天一起去看海吧。',sourceKey='novel:work-1:cast-1';
  const sourceHash=createHash('sha256').update(JSON.stringify({name:'林舟',sourceKey,text,model:CHARACTER_VOICE_MODEL})).digest('hex');
  const objectKey=`character-voice/${f.user.id}/${id}/${token}.audio`;
  await DB.prepare(`INSERT INTO character_voice_assets(id,user_id,name,source_key,source_text,source_hash,model,status,processing_token,object_key,mime_type,byte_length,audio_text_chars,total_text_chars,created_at,updated_at)
    VALUES(?,?,'林舟',?,?,?,?,'ready',?,?,'audio/mpeg',?,16,20,?,?)`).bind(id,f.user.id,sourceKey,text,sourceHash,CHARACTER_VOICE_MODEL,token,objectKey,MP3.length,BASE,BASE).run();
  await MEDIA.put(objectKey,MP3,{httpMetadata:{contentType:'audio/mpeg'},customMetadata:{ownerId:f.user.id,assetId:id,sourceHash}});
  const cached=expect(await generate(f),200).asset;assert.equal(cached.id,id);assert.equal(cached.voiceId,'melotts');
  assert.equal((await row(f)).voice_id,'melotts');assert.equal(f.calls.length,0);assert.deepEqual(await usage(f),[]);
  assert.equal(expect(await generate(f,{voiceId:'melotts'}),200).asset.id,id);
  assert.deepEqual(expect(await call(f,`/v1/character-voice/assets/${id}`),200),MP3);
});
