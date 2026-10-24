import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {tsImport} from 'tsx/esm/api';
const {handleGeneration}=await tsImport('../src/generation.ts',import.meta.url);
const {reserveCreditUsage,finalizeCreditUsage}=await tsImport('../src/credit-usage.ts',import.meta.url);
const {GENERATION_MODELS,freezeGenerationPolicy,generationCharge,readGenerationPolicy}=await tsImport('../src/generation-provider.ts',import.meta.url);
const {parseReferenceImage}=await tsImport('../src/generation-references.ts',import.meta.url);
const IMAGE='x-ai/grok-imagine-image-2.0',VIDEO='x-ai/grok-imagine-video-1.5-lite';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
const MP4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
let store,DB,MEDIA;
before(async()=>{store=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',modules:true,script:'export default {fetch(){return new Response("isolated generation")}}',d1Databases:{DB:'generation-isolated'},r2Buckets:{MEDIA:'generation-isolated'}}));DB=await store.getD1Database('DB');MEDIA=await store.getR2Bucket('MEDIA');
 for(const file of(await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');await DB.batch(splitSqlStatements(sql).filter(s=>s.trim()).map(s=>DB.prepare(s)));}});
after(async()=>{await store?.dispose();});
async function fixture({balance=1000,guest=false}={}){const now=Date.now(),id=randomUUID(),token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');const user={id,email:null,nickname:'原创测试者',isGuest:guest,role:'user',version:0};await DB.batch([DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,?,\'user\',?)').bind(id,user.nickname,Number(guest),now),DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash,id,now+86400000,now)]);
 if(balance)await DB.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(),id,balance,'isolated test',now).run();const f={now,user,token,hash,calls:[],pollStatus:'completed',providerCost:undefined};f.env={DB,MEDIA,APP_ORIGINS:'https://qingyu.invalid',GENERATION_ENABLED:'true',GENERATION_OPENROUTER_API_KEY:'mock-only-key',GENERATION_USD_TO_CNY:'6.704588'};
 f.fetch=async(url,init={})=>{assert.ok(url.startsWith('https://openrouter.ai/api/v1/'),url);assert.equal(init.redirect,'manual');f.calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});if(url.endsWith('/images'))return Response.json({data:[{b64_json:PNG.toString('base64')}],...(f.providerCost!==undefined?{usage:{cost:f.providerCost}}:{})});if(url.endsWith('/videos')&&init.method==='POST')return Response.json({id:'job-test-'+randomUUID(),status:'pending'},{status:202});if(url.includes('/content'))return new Response(MP4,{headers:{'Content-Type':'video/mp4'}});return Response.json({id:url.split('/').at(-1),status:f.pollStatus,...(f.providerCost!==undefined?{usage:{cost:f.providerCost}}:{})});};return f;}
function body(f,kind='image',extra={}){return {accountId:f.user.id,kind,modelId:kind==='image'?IMAGE:VIDEO,prompt:'普通原创场景：雨后森林里的小木屋。',aspectRatio:kind==='image'?'1:1':'16:9',...(kind==='video'?{duration:5}:{}),...extra};}
async function call(f,path,{method='GET',body:payload,headers={},env=f.env,fetcher=f.fetch}={}){let response;const request=new Request('https://qingyu.invalid'+path,{method,headers:{Cookie:`qingyu_session=${f.token}`,...headers,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});try{response=await handleGeneration(request,env,f.user,{now:()=>f.now,fetch:fetcher});}catch(e){if(!e.status)throw e;response=Response.json({error:e.message,...e.details},{status:e.status});}assert.ok(response);const bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,headers:response.headers,data:response.headers.get('Content-Type')?.includes('json')?JSON.parse(bytes.toString()):bytes};}
function expect(r,s){assert.equal(r.status,s,JSON.stringify(r.data));return r.data;}
async function create(f,kind='image',extra={},args={}){const model=GENERATION_MODELS.find(m=>m.id===(extra.modelId??(kind==='image'?IMAGE:VIDEO)))??GENERATION_MODELS.find(m=>m.id===(kind==='image'?IMAGE:VIDEO));const duration=kind==='video'?(model.durations.includes(extra.duration??5)?extra.duration??5:model.durations[0]):undefined;const expectedMaxCredits=freezeGenerationPolicy(model,duration,Number(f.env.GENERATION_USD_TO_CNY)).maxCredits;return call(f,'/v1/generation/jobs',{method:'POST',body:body(f,kind,{requestId:randomUUID(),expectedMaxCredits,...extra}),...args});}
async function wallet(f){return DB.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(f.user.id).first();}
async function row(f,id){return DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND id=?').bind(f.user.id,id).first();}
async function uploadReference(f,extra={},args={}){return call(f,'/v1/generation/references',{method:'POST',body:{accountId:f.user.id,name:'原创森林参考.png',dataUrl:`data:image/png;base64,${PNG.toString('base64')}`,...extra},...args});}
async function referenceQuote(f,reference,kind='image',extra={}){return expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f,kind,{referenceImageId:reference.id,...extra})}),200).quote;}
test('reference uploads are private immutable R2 files and do not call models or charge Credit',async()=>{
 const f=await fixture(),other=await fixture(),r=expect(await uploadReference(f),201).reference;
 assert.equal(r.name,'原创森林参考.png');assert.equal(r.mimeType,'image/png');assert.equal(r.width,1);assert.equal(r.height,1);assert.equal(r.byteLength,PNG.length);
 assert.deepEqual(expect(await call(f,`/v1/generation/references/${r.id}`),200).reference,r);
 assert.deepEqual(expect(await call(f,`/v1/generation/reference-assets/${r.id}`),200),PNG);
 for(const path of[`/v1/generation/references/${r.id}`,`/v1/generation/reference-assets/${r.id}`])assert.equal(expect(await call(other,path),404).code,'generation_reference_missing');
 expect(await call(other,`/v1/generation/references/${r.id}`,{method:'DELETE'}),404);expect(await call(f,`/v1/generation/reference-assets/${r.id}`,{headers:{Cookie:''}}),401);
 expect(await uploadReference(f,{name:'../traversal.png'}),400);expect(await uploadReference(f,{accountId:other.user.id}),409);expect(await uploadReference(await fixture({guest:true})),403);
 assert.equal(f.calls.length,0);assert.equal((await wallet(f)).balance,1000);assert.equal(r.contentHash,undefined);assert.equal(r.objectKey,undefined);
});
test('reference validation rejects URLs, forged MIME, oversized files and impossible dimensions before a provider call',async()=>{
 const f=await fixture();for(const dataUrl of['https://private.example/file.png',`data:image/jpeg;base64,${PNG.toString('base64')}`,'data:image/png;base64,a===' ])expect(await uploadReference(f,{dataUrl}),400);
 expect(await uploadReference(f,{dataUrl:'data:image/png;base64,'+'A'.repeat(3*1024*1024)}),400);
 const huge=Buffer.from(PNG);huge.writeUInt32BE(8193,16);expect(await uploadReference(f,{dataUrl:`data:image/png;base64,${huge.toString('base64')}`}),400);
 assert.throws(()=>parseReferenceImage('data:image/png;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64')),error=>error.status===400);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_references WHERE user_id=?').bind(f.user.id).first()).n,0);assert.equal(f.calls.length,0);
});
test('image reference quote freezes input-image fee and private bytes reach input_references exactly once',async()=>{
 const f=await fixture(),r=expect(await uploadReference(f),201).reference,q=await referenceQuote(f,r),requestId=randomUUID();assert.deepEqual(q,{estimatedCredits:101,maxCredits:121});
 expect(await create(f,'image',{referenceImageId:r.id,expectedMaxCredits:97}),409);assert.equal((await wallet(f)).reserved_credits,0);assert.equal(f.calls.length,0);
 const job=expect(await create(f,'image',{requestId,referenceImageId:r.id,expectedMaxCredits:q.maxCredits}),201).job;assert.equal(job.status,'ready');assert.equal(job.chargedCredits,101);assert.deepEqual(job.referenceImage,r);
 assert.deepEqual(f.calls[0].body.input_references,[{type:'image_url',image_url:{url:`data:image/png;base64,${PNG.toString('base64')}`}}]);assert.equal(f.calls[0].body.frame_images,undefined);
 const snapshot=await row(f,job.id),policy=JSON.parse(snapshot.policy_json);assert.equal(policy.referenceImages,1);assert.equal(policy.referenceUnitUsd,0.01);assert.equal(JSON.parse(snapshot.reference_json).id,r.id);
 assert.deepEqual(expect(await call(f,`/v1/generation/requests/${requestId}`),200).job,job);
 const r2=expect(await uploadReference(f,{name:'另一张参考.png'}),201).reference;expect(await create(f,'image',{requestId,referenceImageId:r2.id,expectedMaxCredits:q.maxCredits}),409);
 expect(await call(f,`/v1/generation/references/${r.id}`,{method:'DELETE'}),200);
 assert.deepEqual(expect(await create(f,'image',{requestId,referenceImageId:r.id,expectedMaxCredits:q.maxCredits}),200).job,job);assert.equal(f.calls.length,1);
 expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f,'image',{referenceImageId:r.id})}),404);
});
test('video reference is a frozen first frame, active deletion is blocked and completion preserves 3x input fee',async()=>{
 const f=await fixture(),r=expect(await uploadReference(f),201).reference,q=await referenceQuote(f,r,'video');assert.deepEqual(q,{estimatedCredits:322,maxCredits:387});
 const job=expect(await create(f,'video',{referenceImageId:r.id,expectedMaxCredits:q.maxCredits}),201).job;
 assert.deepEqual(f.calls[0].body.frame_images,[{type:'image_url',image_url:{url:`data:image/png;base64,${PNG.toString('base64')}`},frame_type:'first_frame'}]);assert.equal(f.calls[0].body.input_references,undefined);
 assert.equal(expect(await call(f,`/v1/generation/references/${r.id}`,{method:'DELETE'}),409).code,'generation_reference_in_use');
 const done=expect(await call(f,`/v1/generation/jobs/${job.id}`),200).job;assert.equal(done.status,'ready');assert.equal(done.chargedCredits,322);assert.deepEqual(done.referenceImage,r);
 expect(await call(f,`/v1/generation/references/${r.id}`,{method:'DELETE'}),200);assert.equal((await wallet(f)).balance,678);
});
test('reference capability and source integrity errors cannot reserve or silently ignore input',async()=>{
 const f=await fixture(),other=await fixture(),r=expect(await uploadReference(f),201).reference,model=GENERATION_MODELS.find(m=>m.id===IMAGE),q=await referenceQuote(f,r);
 assert.equal(expect(await call(other,'/v1/generation/quote',{method:'POST',body:body(other,'image',{referenceImageId:r.id})}),404).code,'generation_reference_missing');
 assert.throws(()=>freezeGenerationPolicy({...model,supportsReferenceImage:false},undefined,6.704588,1),error=>error.status===400);
 expect(await create(f,'image',{referenceImageId:r.id,input_references:[{type:'video_url',video_url:{url:'https://unknown.example/video.mp4'}}],expectedMaxCredits:q.maxCredits}),400);
 const refRow=await DB.prepare('SELECT * FROM generation_references WHERE id=?').bind(r.id).first();await MEDIA.put(refRow.object_key,PNG,{customMetadata:{ownerId:other.user.id,referenceId:r.id,contentHash:refRow.content_hash}});
 assert.equal(expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f,'image',{referenceImageId:r.id})}),404).code,'generation_reference_missing');
 expect(await create(f,'image',{referenceImageId:r.id,expectedMaxCredits:q.maxCredits}),404);assert.equal((await wallet(f)).reserved_credits,0);assert.equal(f.calls.length,0);
});
test('reference removal between quote/read and job INSERT is atomic and cannot create a paid request',async()=>{
 const f=await fixture(),r=expect(await uploadReference(f),201).reference,q=await referenceQuote(f,r);let erased=false;
 const env={...f.env,DB:{prepare:DB.prepare.bind(DB),async batch(statements){if(!erased&&statements.length===2){erased=true;expect(await call(f,`/v1/generation/references/${r.id}`,{method:'DELETE'}),200);}return DB.batch(statements);}}};
 assert.equal(expect(await create(f,'image',{referenceImageId:r.id,expectedMaxCredits:q.maxCredits},{env}),404).code,'generation_reference_missing');assert.equal(erased,true);assert.equal(f.calls.length,0);assert.equal((await wallet(f)).reserved_credits,0);
});
test('expired sources fail explicitly and a later upload removes old R2 files while readonly job recovery retains the snapshot',async()=>{
 const f=await fixture(),r=expect(await uploadReference(f),201).reference,q=await referenceQuote(f,r),requestId=randomUUID(),job=expect(await create(f,'image',{referenceImageId:r.id,expectedMaxCredits:q.maxCredits,requestId}),201).job;
 const source=await DB.prepare('SELECT * FROM generation_references WHERE id=?').bind(r.id).first();f.now=source.expires_at+1;
 await DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(f.now+86400000,f.hash).run();
 expect(await call(f,`/v1/generation/references/${r.id}`),404);assert.equal(expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f,'image',{referenceImageId:r.id})}),404).code,'generation_reference_missing');
 assert.deepEqual(expect(await call(f,`/v1/generation/requests/${requestId}`),200).job,job);expect(await uploadReference(f,{name:'新的参考.png'}),201);assert.equal(await MEDIA.get(source.object_key),null);assert.equal(await DB.prepare('SELECT id FROM generation_references WHERE id=?').bind(r.id).first(),null);assert.equal(f.calls.length,1);
});
test('lost upload INSERT acknowledgment and failed confirming SELECT never deletes a committed private source',async()=>{
 const f=await fixture();let committed=false;
 const env={...f.env,DB:{prepare(sql){const statement=DB.prepare(sql);if(sql.startsWith('INSERT INTO generation_references'))return {bind(...args){const bound=statement.bind(...args);return {async run(){await bound.run();committed=true;throw new Error('lost upload acknowledgment');}};}};
  if(committed&&sql.startsWith('SELECT id FROM generation_references WHERE id='))return {bind(){return {async first(){throw new Error('confirmation unavailable');}};}};return statement;}}};
 await assert.rejects(uploadReference(f,{}, {env}),/lost upload acknowledgment/);const source=await DB.prepare('SELECT * FROM generation_references WHERE user_id=?').bind(f.user.id).first();assert.ok(source);assert.deepEqual(Buffer.from(await (await MEDIA.get(source.object_key)).arrayBuffer()),PNG);assert.equal(f.calls.length,0);
});
test('fixed official models and 3x cost, precise cents conversion and reserve 120%',async()=>{const f=await fixture(),config=expect(await call(f,'/v1/generation/config'),200);assert.equal(config.enabled,true);assert.equal(config.costMultiplier,3);assert.equal(config.models.length,5);assert.deepEqual(expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f)}),200).quote,{estimatedCredits:81,maxCredits:97});assert.deepEqual(expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f,'video')}),200).quote,{estimatedCredits:302,maxCredits:363});const p=freezeGenerationPolicy(GENERATION_MODELS.find(m=>m.id==='alibaba/wan-3.0'),3,6.704588);assert.equal(p.estimatedUsd,0.3);assert.equal(p.maxUsd,0.36);assert.equal(p.estimatedCredits,generationCharge(0.3,6.704588));assert.equal(f.calls.length,0);});
test('strict account/session/guest/capability guard rejects client price and provider URL',async()=>{const f=await fixture(),other=await fixture();for(const extra of[{credits:1},{cost:0},{providerUrl:'https://evil.test'},{resolution:'2K'},{duration:5},{modelId:'evil/model'},{aspectRatio:'auto'},{templateId:'../escape'},{requestId:'bad'}])expect(await create(f,'image',extra),400);expect(await create(f,'image',{accountId:other.user.id}),409);expect(await create(await fixture({guest:true})),403);expect(await create(f,'image',{}, {headers:{Cookie:''}}),401);expect(await create(f,'image',{}, {env:{...f.env,GENERATION_ENABLED:'false'}}),503);await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run();expect(await create(f),401);assert.equal(f.calls.length,0);});
test('disabled generation rejects image and video quote/create without jobs, holds or provider calls',async()=>{
 const f=await fixture();f.env.GENERATION_ENABLED='false';
 assert.equal(expect(await call(f,'/v1/generation/config'),200).enabled,false);
 for(const kind of['image','video']){
  expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f,kind)}),503);
  expect(await create(f,kind),503);
 }
 assert.equal(f.calls.length,0);
 assert.equal((await wallet(f)).reserved_credits,0);
 assert.equal((await wallet(f)).total_spent,0);
 assert.equal((await wallet(f)).balance,1000);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_jobs WHERE user_id=?').bind(f.user.id).first()).n,0);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n,0);
});
test('disabled generation with unavailable provider retains ready assets/replays and releases unfinished hold at expiry',async()=>{
 const f=await fixture({balance:2000}),imageRequest=randomUUID(),videoRequest=randomUUID(),pendingRequest=randomUUID();
 const image=expect(await create(f,'image',{requestId:imageRequest}),201).job;
 const video=expect(await create(f,'video',{requestId:videoRequest}),201).job;
 const readyVideo=expect(await call(f,`/v1/generation/jobs/${video.id}`),200).job;
 assert.equal(image.status,'ready');assert.equal(readyVideo.status,'ready');
 const pending=expect(await create(f,'video',{requestId:pendingRequest}),201).job;
 assert.equal(pending.status,'processing');assert.equal(pending.reservedCredits,363);
 const callsBeforeClose=f.calls.length,balanceBeforeClose=await wallet(f),pendingBeforeClose=await row(f,pending.id);
 assert.equal(callsBeforeClose,5);assert.equal(balanceBeforeClose.total_spent,image.chargedCredits+readyVideo.chargedCredits);
 assert.equal(balanceBeforeClose.reserved_credits,pending.reservedCredits);
 f.env.GENERATION_ENABLED='false';f.env.GENERATION_OPENROUTER_API_KEY=undefined;f.now+=2100;
 // A missing provider credential prevents polling; existing private results remain readable.
 f.pollStatus='completed';
 const history=expect(await call(f,'/v1/generation/jobs'),200).jobs;
 assert.equal(history.length,3);
 assert.deepEqual(history.find(job=>job.id===image.id),image);
 assert.deepEqual(history.find(job=>job.id===readyVideo.id),readyVideo);
 assert.deepEqual(expect(await call(f,`/v1/generation/assets/${image.id}`),200),PNG);
 assert.deepEqual(expect(await call(f,`/v1/generation/assets/${readyVideo.id}`),200),MP4);
 assert.deepEqual(expect(await create(f,'image',{requestId:imageRequest}),200).job,image);
 assert.deepEqual(expect(await create(f,'video',{requestId:videoRequest}),200).job,readyVideo);
 assert.deepEqual(expect(await create(f,'video',{requestId:pendingRequest}),200).job,pending);
 assert.deepEqual(expect(await call(f,`/v1/generation/jobs/${pending.id}`),200).job,pending);
 assert.deepEqual(await row(f,pending.id),pendingBeforeClose);
 assert.deepEqual(await wallet(f),balanceBeforeClose);
 assert.equal(f.calls.length,callsBeforeClose);
 f.now=pending.expiresAt+1;
 const expired=expect(await call(f,`/v1/generation/jobs/${pending.id}`),200).job;
 assert.equal(expired.status,'unknown');assert.equal(expired.costBasis,'released');
 assert.equal(expired.chargedCredits,0);assert.equal(expired.reservedCredits,0);assert.equal(expired.finalizedAt,f.now);
 const balanceAfterExpiry=await wallet(f);
 assert.equal(balanceAfterExpiry.reserved_credits,0);
 assert.equal(balanceAfterExpiry.total_spent,balanceBeforeClose.total_spent);
 assert.equal(balanceAfterExpiry.balance,balanceBeforeClose.balance+pending.reservedCredits);
 assert.deepEqual((await DB.prepare('SELECT kind,credits FROM generation_credit_ledger WHERE job_id=?').bind(pending.id).first()),{kind:'release',credits:0});
 assert.deepEqual(expect(await create(f,'video',{requestId:pendingRequest}),200).job,expired);
 assert.deepEqual(expect(await call(f,'/v1/generation/jobs'),200).jobs.find(job=>job.id===readyVideo.id),readyVideo);
 assert.equal(f.calls.length,callsBeforeClose);
});
test('paused new generation still completes an existing video using its frozen price without another provider submission',async()=>{
 const f=await fixture(),requestId=randomUUID(),pending=expect(await create(f,'video',{requestId}),201).job;
 f.env.GENERATION_ENABLED='false';f.now+=2100;
 const before=await wallet(f),source=await row(f,pending.id);
 assert.equal(expect(await call(f,'/v1/generation/config'),200).enabled,false);
 assert.deepEqual(expect(await call(f,`/v1/generation/requests/${requestId}`),200).job,pending);
 assert.deepEqual(expect(await create(f,'video',{requestId}),200).job,pending);
 assert.equal(f.calls.length,1);assert.deepEqual(await wallet(f),before);
 // Settlement only needs provider/storage access; the already confirmed tariff is frozen in the job.
 const closed={...f.env,GENERATION_USD_TO_CNY:undefined};
 const completed=expect(await call(f,`/v1/generation/jobs/${pending.id}`,{env:closed}),200).job;
 assert.equal(completed.status,'ready');assert.equal(completed.chargedCredits,302);assert.equal(completed.reservedCredits,0);
 assert.equal((await row(f,pending.id)).policy_json,source.policy_json);
 assert.deepEqual(expect(await call(f,`/v1/generation/assets/${pending.id}`,{env:closed}),200),MP4);
 assert.deepEqual(expect(await call(f,`/v1/generation/jobs/${pending.id}`,{env:closed}),200).job,completed);
 assert.deepEqual(expect(await create(f,'video',{requestId}),200).job,completed);
 assert.equal(f.calls.length,3);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
 assert.equal((await wallet(f)).balance,698);assert.equal((await wallet(f)).reserved_credits,0);
 assert.deepEqual(await DB.prepare('SELECT kind,credits FROM generation_credit_ledger WHERE job_id=?').bind(pending.id).first(),{kind:'charge',credits:-302});
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE job_id=?').bind(pending.id).first()).n,1);
 expect(await create(f,'image'),503);expect(await create(f,'video'),503);assert.equal(f.calls.length,3);
});
test('image actual cost once, exact idempotency, private R2 and soft deletion preserve consumption',async()=>{const f=await fixture();f.providerCost=0.02;const requestId=randomUUID(),a=expect(await create(f,'image',{requestId}),201).job;assert.equal(a.status,'ready');assert.equal(a.chargedCredits,41);assert.equal(a.reservedCredits,0);assert.deepEqual(expect(await call(f,`/v1/generation/assets/${a.id}`),200),PNG);assert.deepEqual(expect(await create(f,'image',{requestId}),200).job,a);assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.resolution,'1K');assert.equal((await row(f,a.id)).cost_basis,'provider_usage');assert.equal((await wallet(f)).balance,959);expect(await create(f,'image',{requestId,prompt:'不同原创新场景'}),409);const other=await fixture();expect(await call(other,`/v1/generation/jobs/${a.id}`),404);expect(await call(other,`/v1/generation/assets/${a.id}`),404);expect(await call(f,`/v1/generation/jobs/${a.id}`,{method:'DELETE'}),200);assert.equal((await wallet(f)).balance,959);expect(await call(f,`/v1/generation/assets/${a.id}`),404);expect(await create(f,'image',{requestId}),410);assert.equal(f.calls.length,1);});
test('explicit frozen SKU fallback, usage charge cap and FX freeze',async()=>{const f=await fixture(),a=expect(await create(f),201).job;assert.equal(a.chargedCredits,81);assert.equal((await row(f,a.id)).cost_basis,'frozen_sku');const v=expect(await create(f,'video'),201).job;f.env.GENERATION_USD_TO_CNY='1';f.providerCost=5;const done=expect(await call(f,`/v1/generation/jobs/${v.id}`),200).job;assert.equal(done.status,'ready');assert.equal(done.chargedCredits,363);const r=await row(f,v.id);assert.equal(r.exceeds_reservation,1);assert.equal(JSON.parse(r.policy_json).usdToCny,6.704588);assert.equal(r.provider_cost_usd,5);});
test('async owner-only video poll, no audio request, fixed content and real R2 Range',async()=>{const f=await fixture();f.pollStatus='in_progress';const v=expect(await create(f,'video',{modelId:'google/veo-3.1-lite',duration:4}),201).job;assert.equal(v.status,'processing');assert.equal((await wallet(f)).reserved_credits,v.reservedCredits);assert.equal(f.calls[0].body.generate_audio,false);expect(await call(f,`/v1/generation/jobs/${v.id}`,{method:'DELETE'}),409);assert.equal(expect(await call(f,`/v1/generation/jobs/${v.id}`),200).job.status,'processing');f.now+=2100;f.pollStatus='completed';const done=expect(await call(f,`/v1/generation/jobs/${v.id}`),200).job;assert.equal(done.status,'ready');assert.equal(done.chargedCredits,242);const part=await call(f,`/v1/generation/assets/${v.id}`,{headers:{Range:'bytes=4-11'}});assert.equal(part.status,206);assert.deepEqual(part.data,MP4.subarray(4,12));assert.equal(part.headers.get('Content-Range'),`bytes 4-11/${MP4.length}`);expect(await call(f,`/v1/generation/assets/${v.id}`,{headers:{Range:'bytes=999-'}}),416);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);});
test('uncertain submit never repeats, 30min expiry returns hold without cron',async()=>{const f=await fixture(),requestId=randomUUID();let posts=0;const broken=async()=>{posts++;throw new Error('lost provider response');};const v=expect(await create(f,'video',{requestId},{fetcher:broken}),201).job;assert.equal(v.status,'unknown');assert.equal((await wallet(f)).reserved_credits,363);expect(await create(f,'video',{requestId},{fetcher:broken}),200);assert.equal(posts,1);expect(await call(f,`/v1/generation/jobs/${v.id}`,{method:'DELETE'}),409);f.now+=1800001;const expired=expect(await call(f,'/v1/generation/jobs'),200).jobs[0];assert.equal(expired.reservedCredits,0);assert.equal((await wallet(f)).balance,1000);expect(await create(f,'video',{requestId},{fetcher:broken}),200);assert.equal(posts,1);assert.equal((await row(f,v.id)).cost_basis,'released');});
test('definite rejection/failed video release; malformed output stays unknown',async()=>{const f=await fixture();assert.equal(expect(await create(f,'image',{}, {fetcher:async()=>new Response('{}',{status:400})}),201).job.status,'failed');assert.equal((await wallet(f)).balance,1000);const v=expect(await create(f,'video'),201).job;f.pollStatus='failed';assert.equal(expect(await call(f,`/v1/generation/jobs/${v.id}`),200).job.status,'failed');assert.equal((await wallet(f)).balance,1000);const invalid=async()=>Response.json({data:[{b64_json:Buffer.from('not image').toString('base64')}]});assert.equal(expect(await create(f,'image',{}, {fetcher:invalid}),201).job.status,'unknown');assert.equal((await wallet(f)).reserved_credits,97);});
test('real D1 concurrency prevents overspending and same-request race submits once',async()=>{const f=await fixture({balance:97});let finish,started;const startedP=new Promise(r=>{started=r;}),wait=new Promise(r=>{finish=r;});const gated=async(...args)=>{started();await wait;return f.fetch(...args);};const first=create(f,'image',{}, {fetcher:gated});await startedP;expect(await create(f),402);assert.equal((await wallet(f)).reserved_credits,97);finish();expect(await first,201);assert.equal(f.calls.length,1);const s=await fixture(),requestId=randomUUID();let done,enter;const entered=new Promise(r=>{enter=r;}),waiting=new Promise(r=>{done=r;});let invokes=0;const fetcher=async(...args)=>{invokes++;enter();await waiting;return s.fetch(...args);};const leading=create(s,'image',{requestId},{fetcher});await entered;assert.equal(expect(await create(s,'image',{requestId},{fetcher}),200).job.status,'processing');done();expect(await leading,201);assert.equal(invokes,1);});
test('concurrent polling claims and unique ledger settle video once',async()=>{const f=await fixture(),v=expect(await create(f,'video'),201).job;let gate,entered;const wait=new Promise(r=>{gate=r;}),enteredP=new Promise(r=>{entered=r;});let polls=0;const fetcher=async(...args)=>{if(!args[0].includes('/content')){polls++;entered();await wait;}return f.fetch(...args);};const a=call(f,`/v1/generation/jobs/${v.id}`,{fetcher});await enteredP;expect(await call(f,`/v1/generation/jobs/${v.id}`,{fetcher}),200);gate();assert.equal(expect(await a,200).job.status,'ready');assert.equal(polls,1);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE job_id=?').bind(v.id).first()).n,1);assert.equal((await wallet(f)).balance,698);});

test('old frozen price survives current registry changes, corrupted snapshot cannot charge',async()=>{const f=await fixture(),model=GENERATION_MODELS.find(m=>m.id===VIDEO),v=expect(await create(f,'video'),201).job;
 const oldUnit=model.unitUsd,oldSku=model.sku;try{model.unitUsd=0.08;model.sku='new-reviewed-sku';assert.equal(readGenerationPolicy((await row(f,v.id)).policy_json).unitUsd,0.03);assert.equal(expect(await call(f,`/v1/generation/jobs/${v.id}`),200).job.chargedCredits,302);}finally{model.unitUsd=oldUnit;model.sku=oldSku;}
 const p=freezeGenerationPolicy(model,5,6.704588);assert.throws(()=>readGenerationPolicy(JSON.stringify({...p,maxCredits:1})));assert.throws(()=>readGenerationPolicy(JSON.stringify({...p,usdToCny:'6.7'})));});
test('lost commit response preserves charged R2 asset and exact same request cannot resubmit',async()=>{const f=await fixture(),requestId=randomUUID();let triggered=false;const env={...f.env,DB:{prepare:DB.prepare.bind(DB),async batch(statements){const result=await DB.batch(statements);if(!triggered&&result[0]?.meta?.changes===1&&result.length===2&&result[1]?.meta?.last_row_id>0){const jobs=await DB.prepare("SELECT id FROM generation_jobs WHERE user_id=? AND status='ready'").bind(f.user.id).first();if(jobs){triggered=true;throw new Error('lost transaction acknowledgment');}}return result;}}};
 const a=expect(await create(f,'image',{requestId},{env}),201).job;assert.equal(a.status,'ready');assert.equal(triggered,true);assert.deepEqual(expect(await call(f,`/v1/generation/assets/${a.id}`),200),PNG);expect(await create(f,'image',{requestId}),200);assert.equal(f.calls.length,1);assert.equal((await wallet(f)).balance,919);});
test('redirect or untrusted image URL never follows provider content off approved hosts',async()=>{const f=await fixture();let downloads=0;const fetcher=async(url)=>{if(url.endsWith('/images'))return Response.json({data:[{url:'https://evil.example/asset.png'}]});downloads++;return new Response(PNG);};assert.equal(expect(await create(f,'image',{}, {fetcher}),201).job.status,'unknown');assert.equal(downloads,0);});

test('real D1 chat and media reservations share the same spendable balance in both orders',async()=>{const media=await fixture({balance:97}),chatEnv=f=>({...f.env,CREDIT_BILLING_ENABLED:'true',CREDIT_BILLING_RATES_JSON:JSON.stringify({revision:1,inputCreditsPer1000:3,outputCreditsPer1000:9})}),chatRequest=f=>new Request('https://qingyu.invalid/v1/billing/reserve',{headers:{Cookie:`qingyu_session=${f.token}`}}),chatInput=()=>({requestId:randomUUID(),operation:'chat',model:'provider/story-model',requestFingerprint:createHash('sha256').update(randomUUID()).digest('hex'),inputTokenUpperBound:0,maxOutputTokens:1000});
 let finish,entered;const wait=new Promise(r=>{finish=r;}),enter=new Promise(r=>{entered=r;});const pending=create(media,'image',{}, {fetcher:async(...args)=>{entered();await wait;return media.fetch(...args);}});await enter;
 await assert.rejects(reserveCreditUsage(chatRequest(media),chatEnv(media),media.user,chatInput()),e=>e.status===402);assert.equal((await wallet(media)).reserved_credits,97);finish();expect(await pending,201);
 const chat=await fixture({balance:97}),reserved=await reserveCreditUsage(chatRequest(chat),chatEnv(chat),chat.user,chatInput());assert.equal(reserved.receipt.reservedCredits,9);expect(await create(chat),402);assert.equal(chat.calls.length,0);assert.equal((await wallet(chat)).reserved_credits,9);
 await finalizeCreditUsage(chatEnv(chat),{reservationId:reserved.receipt.id,accountId:chat.user.id,claimToken:reserved.claimToken,outcome:'failed',hasValidOutput:false});assert.equal((await wallet(chat)).balance,97);});
test('storage failure holds unknown without resubmission; expiry exposes finalization and release basis',async()=>{const f=await fixture(),requestId=randomUUID(),env={...f.env,MEDIA:{...MEDIA,put:async()=>{throw new Error('isolated storage unavailable');}}};const job=expect(await create(f,'image',{requestId},{env}),201).job;assert.equal(job.status,'unknown');assert.equal(job.finalizedAt,null);assert.equal(job.expiresAt,job.createdAt+1800000);expect(await create(f,'image',{requestId}),200);assert.equal(f.calls.length,1);f.now+=1800001;const final=expect(await call(f,`/v1/generation/jobs/${job.id}`),200).job;assert.equal(final.costBasis,'released');assert.equal(final.finalizedAt,f.now);assert.equal(final.chargedCredits,0);assert.equal(final.reservedCredits,0);expect(await call(f,`/v1/generation/jobs/${job.id}`,{method:'DELETE'}),200);});

test('new task requires confirmed server maximum; forged or missing client maximum cannot reserve',async()=>{const f=await fixture();for(const expectedMaxCredits of[undefined,0,-1,1.5,1e9+1,'97'])expect(await create(f,'image',{expectedMaxCredits}),400);for(const expectedMaxCredits of[1,98,1e9]){const error=expect(await create(f,'image',{expectedMaxCredits}),409);assert.equal(error.code,'generation_quote_changed');assert.equal(error.maxCredits,97);}assert.equal(f.calls.length,0);assert.equal((await wallet(f)).reserved_credits,0);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_jobs WHERE user_id=?').bind(f.user.id).first()).n,0);});
test('FX increase requires new authorization and SKU cost change cannot supply tariff; original replay keeps original quote',async()=>{const f=await fixture();const quote=expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f)}),200).quote;
 f.env.GENERATION_USD_TO_CNY='10';expect(await create(f,'image',{expectedMaxCredits:quote.maxCredits}),409);assert.equal(f.calls.length,0);assert.equal((await wallet(f)).reserved_credits,0);
 const fresh=expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f)}),200).quote,requestId=randomUUID();const a=expect(await create(f,'image',{requestId,expectedMaxCredits:fresh.maxCredits}),201).job;assert.equal(a.chargedCredits,120);
 f.env.GENERATION_USD_TO_CNY='11';const replay=expect(await create(f,'image',{requestId,expectedMaxCredits:fresh.maxCredits}),200).job;assert.deepEqual(replay,a);expect(await create(f,'image',{requestId,expectedMaxCredits:999}),409);assert.equal(f.calls.length,1);
 const model=GENERATION_MODELS.find(m=>m.id===IMAGE),before=expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f)}),200).quote;const changedSku=freezeGenerationPolicy({...model,unitUsd:0.06,sku:'new-reviewed-sku'},undefined,11);assert.ok(changedSku.maxCredits>before.maxCredits);expect(await create(f,'image',{expectedMaxCredits:changedSku.maxCredits}),409);assert.equal(f.calls.length,1);
});
test('request recovery finds committed original job after lost reply and changed quote without a new hold or submission',async()=>{
 const f=await fixture(),requestId=randomUUID(),q0=expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f)}),200).quote;
 // The initial HTTP reply is unavailable to the caller; only its original request ID survives.
 expect(await create(f,'image',{requestId,expectedMaxCredits:q0.maxCredits}),201);
 const original=await DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND request_id=?').bind(f.user.id,requestId).first(),balanceBefore=await wallet(f);
 f.env.GENERATION_USD_TO_CNY='10';
 const q1=expect(await call(f,'/v1/generation/quote',{method:'POST',body:body(f)}),200).quote;
 assert.ok(q1.maxCredits>q0.maxCredits);
 expect(await create(f,'image',{requestId,expectedMaxCredits:q1.maxCredits}),409);
 const recoveredResponse=await call(f,`/v1/generation/requests/${requestId}`),recovered=expect(recoveredResponse,200);
 assert.equal(recoveredResponse.headers.get('Cache-Control'),'no-store');
 assert.equal(recovered.accountId,f.user.id);assert.equal(recovered.job.id,original.id);assert.equal(recovered.job.status,'ready');assert.equal(recovered.job.chargedCredits,81);
 assert.equal(recovered.job.requestFingerprint,undefined);assert.equal(recovered.job.policyJson,undefined);assert.equal(recovered.job.claimToken,undefined);
 assert.deepEqual(expect(await create(f,'image',{requestId,expectedMaxCredits:q0.maxCredits}),200).job,recovered.job);
 const closed={...f.env,GENERATION_ENABLED:'false',GENERATION_OPENROUTER_API_KEY:undefined,GENERATION_USD_TO_CNY:undefined,MEDIA:undefined};
 assert.deepEqual(expect(await call(f,`/v1/generation/requests/${requestId}`,{env:closed,fetcher:async()=>{throw new Error('recovery must not contact provider');}}),200),recovered);
 assert.deepEqual(await row(f,original.id),original);assert.deepEqual(await wallet(f),balanceBefore);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_jobs WHERE user_id=?').bind(f.user.id).first()).n,1);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n,1);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'POST');
 assert.deepEqual(expect(await call(f,`/v1/generation/assets/${original.id}`),200),PNG);
});
test('request recovery reads pending video without polling and expires its existing hold exactly once',async()=>{
 const f=await fixture(),requestId=randomUUID(),pending=expect(await create(f,'video',{requestId}),201).job;
 const pendingRow=await row(f,pending.id),balanceBefore=await wallet(f);f.now+=2100;f.pollStatus='completed';
 assert.deepEqual(expect(await call(f,`/v1/generation/requests/${requestId}`,{fetcher:async()=>{throw new Error('read-only recovery must not poll');}}),200).job,pending);
 assert.deepEqual(await row(f,pending.id),pendingRow);assert.deepEqual(await wallet(f),balanceBefore);assert.equal(f.calls.length,1);
 f.now=pending.expiresAt+1;f.env.GENERATION_ENABLED='false';
 const expired=expect(await call(f,`/v1/generation/requests/${requestId}`),200).job;
 assert.equal(expired.status,'unknown');assert.equal(expired.costBasis,'released');assert.equal(expired.finalizedAt,f.now);assert.equal(expired.chargedCredits,0);assert.equal(expired.reservedCredits,0);
 assert.deepEqual(expect(await call(f,`/v1/generation/requests/${requestId}`),200).job,expired);
 assert.equal((await wallet(f)).balance,1000);assert.equal((await wallet(f)).reserved_credits,0);assert.equal((await wallet(f)).total_spent,0);
 assert.deepEqual(await DB.prepare('SELECT kind,credits FROM generation_credit_ledger WHERE job_id=?').bind(pending.id).first(),{kind:'release',credits:0});
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE job_id=?').bind(pending.id).first()).n,1);assert.equal(f.calls.length,1);
});
test('missing request recovery gives explicit 404 without generation configuration, jobs, holds or provider calls',async()=>{
 for(const guest of[false,true]){
  const f=await fixture({guest}),balanceBefore=await wallet(f),env={DB,APP_ORIGINS:f.env.APP_ORIGINS,GENERATION_ENABLED:'false'};
  const missing=expect(await call(f,`/v1/generation/requests/${randomUUID()}`,{env,fetcher:async()=>{throw new Error('missing recovery must not contact provider');}}),404);
  assert.equal(missing.code,'generation_request_missing');assert.equal(missing.accountId,undefined);assert.equal(missing.job,undefined);
  assert.deepEqual(await wallet(f),balanceBefore);assert.equal(f.calls.length,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_jobs WHERE user_id=?').bind(f.user.id).first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n,0);
 }
});
test('request recovery enforces session, owner, GET and canonical UUID; deleted original returns 410',async()=>{
 const f=await fixture(),other=await fixture(),requestId=randomUUID(),job=expect(await create(f,'image',{requestId}),201).job,balanceBefore=await wallet(f),path=`/v1/generation/requests/${requestId}`;
 const forbidden=expect(await call(other,path),404);assert.equal(forbidden.code,'generation_request_missing');assert.equal(forbidden.job,undefined);
 expect(await call(f,path,{headers:{Cookie:''}}),401);expect(await call(f,path,{headers:{Cookie:`qingyu_session=${other.token}`}}),401);
 for(const method of['POST','PUT','PATCH','DELETE','HEAD'])expect(await call(f,path,{method}),405);
 for(const id of['bad','ffffffff-ffff-ffff-ffff-fffffffffffz','ffffffffffffffff-ffff-ffff-ffffffff',`${requestId}/extra`])expect(await call(f,`/v1/generation/requests/${id}`),404);
 expect(await call(f,`${path}?accountId=${other.user.id}`),400);
 assert.deepEqual(await wallet(f),balanceBefore);assert.equal(f.calls.length,1);assert.equal(other.calls.length,0);
 expect(await call(f,`/v1/generation/jobs/${job.id}`,{method:'DELETE'}),200);
 expect(await call(f,path),410);assert.equal(expect(await call(other,path),404).code,'generation_request_missing');
 await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run();expect(await call(f,path),401);
 assert.deepEqual(await wallet(f),balanceBefore);assert.equal(f.calls.length,1);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM generation_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n,1);
});
test('a studio still holds 50 credits and charges only after the image succeeds',async()=>{
 const f=await fixture({balance:250}),other=await fixture({balance:250}),requestId=randomUUID();
 const reserved=expect(await call(f,'/v1/generation/studio-stills',{method:'POST',body:{templateId:'krea2-arm-grab-doggystyle',requestId}}),201);
 assert.equal(reserved.credits,50);assert.equal(reserved.status,'reserved');assert.match(reserved.claimToken,/^[a-f0-9]{64}$/);
 assert.equal((await wallet(f)).balance,200);assert.equal((await wallet(f)).reserved_credits,50);assert.equal((await wallet(f)).total_spent,0);
 expect(await call(f,'/v1/generation/studio-stills',{method:'POST',body:{templateId:'krea2-arm-grab-doggystyle',requestId,credits:1}}),400);
 expect(await call(f,'/v1/generation/studio-stills',{method:'POST',body:{templateId:'krea2-arm-grab-doggystyle',requestId}}),409);
 expect(await call(other,`/v1/generation/studio-stills/${reserved.reservationId}/charge`,{method:'POST',body:{claimToken:reserved.claimToken}}),404);
 expect(await call(f,`/v1/generation/studio-stills/${reserved.reservationId}/charge`,{method:'POST',body:{claimToken:'0'.repeat(64)}}),404);
 assert.equal((await wallet(f)).reserved_credits,50);
 const charged=expect(await call(f,`/v1/generation/studio-stills/${reserved.reservationId}/charge`,{method:'POST',body:{claimToken:reserved.claimToken}}),200);
 assert.equal(charged.status,'charged');assert.equal(charged.credits,50);assert.equal(charged.claimToken,undefined);
 expect(await call(f,`/v1/generation/studio-stills/${reserved.reservationId}/charge`,{method:'POST',body:{claimToken:reserved.claimToken}}),200);
 expect(await call(f,`/v1/generation/studio-stills/${reserved.reservationId}/release`,{method:'POST',body:{claimToken:reserved.claimToken}}),409);
 assert.equal((await wallet(f)).balance,200);assert.equal((await wallet(f)).reserved_credits,0);assert.equal((await wallet(f)).total_spent,50);
 assert.equal(f.calls.length,0);
});
test('a failed studio still returns the hold and a short balance cannot start one',async()=>{
 const f=await fixture({balance:50}),requestId=randomUUID();
 const reserved=expect(await call(f,'/v1/generation/studio-stills',{method:'POST',body:{templateId:'krea2-arm-grab-doggystyle',requestId}}),201);
 assert.equal((await wallet(f)).balance,0);
 expect(await call(f,`/v1/generation/studio-stills/${reserved.reservationId}/release`,{method:'POST',body:{claimToken:reserved.claimToken}}),200);
 assert.equal((await wallet(f)).balance,50);assert.equal((await wallet(f)).reserved_credits,0);assert.equal((await wallet(f)).total_spent,0);
 expect(await call(await fixture({balance:49}),'/v1/generation/studio-stills',{method:'POST',body:{templateId:'krea2-arm-grab-doggystyle',requestId:randomUUID()}}),402);
 expect(await call(await fixture({guest:true,balance:1000}),'/v1/generation/studio-stills',{method:'POST',body:{templateId:'krea2-arm-grab-doggystyle',requestId:randomUUID()}}),403);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM studio_still_charges WHERE user_id=? AND status=\'charged\'').bind(f.user.id).first()).n,0);
});
