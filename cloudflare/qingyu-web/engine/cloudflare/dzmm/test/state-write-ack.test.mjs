import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises';
import { before,after,test } from 'node:test';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';
const {fetchRequest}=await tsImport('../src/app.ts',import.meta.url);
const {DZMM_INITIAL_STATE,hydrateDzmmState}=await tsImport('../../../src/lib/dzmm-storage.ts',import.meta.url);
const {parseCharacterImport,parsePrivateCharacter}=await tsImport('../../../src/lib/dzmm-characters.ts',import.meta.url);
const {createDzmmStoryMemory}=await tsImport('../../../src/lib/dzmm-story-memory.ts',import.meta.url);
const origin='https://original-state-ack.example.test',report=new URL('../../../output/xumeng/iteration/heartbeat-20261014-state-write-ack/dev/target-results.json',import.meta.url);
const owned=[],cases=[],requests=[];let store,DB,MEDIA,migrations,cleanup,originalFetch,externalCalls=0;
before(async()=>{
 store=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',modules:true,script:'export default {fetch(){return new Response("isolated original state acknowledgement")}}',d1Databases:{DB:'state-write-ack-'+randomUUID()},r2Buckets:{MEDIA:'state-write-ack-'+randomUUID()}}));
 DB=await store.getD1Database('DB');MEDIA=await store.getR2Bucket('MEDIA');
 migrations=(await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
 assert.ok(migrations.includes('0038_nowpayments_quarterly_membership.sql'));
 for(const name of migrations)await DB.batch(splitSqlStatements(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).filter(sql=>sql.trim()).map(sql=>DB.prepare(sql)));
 originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalCalls++;throw new Error('No external provider or production requests in state ACK tests');};
});
after(async()=>{
 try {
  for(const id of owned)await DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
  const counts={};for(const table of ['users','sessions','characters','conversations','messages','favorites','preferences'])counts[table]=(await DB.prepare('SELECT COUNT(*) n FROM '+table).first()).n;
  cleanup={counts,r2Objects:(await MEDIA.list()).objects.length};assert.ok(Object.values(counts).every(value=>value===0));assert.equal(cleanup.r2Objects,0);assert.equal(externalCalls,0);
 } finally {
  if(originalFetch)globalThis.fetch=originalFetch;await store?.dispose();
  await mkdir(new URL('.',report),{recursive:true});await writeFile(report,JSON.stringify({layer:'Actual authenticated original app/data with disposable 38-migration D1/R2; mutation interleaves happen only after a real native batch completes.',cases,requests,migrations,cleanup,disposed:true,externalCalls,modelCalls:0,providerCalls:0,productionOperations:0},null,2)+'\n');
 }
});
function check(name,run){test(name,async()=>{try{await run();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});throw error;}});}
function expect(result,status=200){assert.equal(result.status,status,JSON.stringify(result.data));return result.data;}
async function api(f,path='/v1/state',{method='GET',body,database=DB,token=f.tokens.A}={}){
 const response=await fetchRequest(new Request(origin+path,{method,headers:{Origin:origin,Cookie:'qingyu_session='+token,'CF-Connecting-IP':f.id,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB:database,MEDIA,APP_ORIGINS:origin});
 const data=await response.json();requests.push({path,method,status:response.status,submittedVersion:body?.version??null,responseVersion:data.version??null});return{status:response.status,data};
}
const snapshot=async f=>expect(await api(f));
const save=(f,state,version,options={})=>api(f,'/v1/state',{method:'PUT',body:{accountId:f.id,state,version},...options});
const append=(state,text)=>{const next=structuredClone(state);next.custom[0].description=text;next.conversations[0].messages.push({id:'original-'+randomUUID(),role:'user',content:text});next.conversations[0].updatedAt++;return next;};
async function fixture({seed=true,metadata=false}={}){
 const f={id:randomUUID(),tokens:{A:randomBytes(32).toString('hex'),B:randomBytes(32).toString('hex')}};owned.push(f.id);const now=Date.now();
 await DB.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,0,?,?)').bind(f.id,f.id+'@ack.example.test','原创雾港记录员','user',now).run();
 for(const token of Object.values(f.tokens))await DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),f.id,now+3600000,now).run();
 const privateId='local-'+randomUUID();const draft={version:1,characterBook:{name:'原创海港记录',description:'私有未完成世界书',scanDepth:10,entries:[{id:'port',name:'海港',content:'档案馆保存原创潮汐记录。',keysText:'海港',secondaryText:'',enabled:true,constant:false},{id:'draft',name:'未完成记事',content:'仍待填写的原创记事',keysText:'',secondaryText:'',enabled:true,constant:false}]}};
 const character=(metadata?parsePrivateCharacter:parseCharacterImport)({id:privateId,name:'原创成年雾港地图员',author:'原创测试记录员',description:'初始原创航线',personality:'谨慎耐心',scenario:'原创雾港档案室',firstMessage:'请先核对灯塔坐标。',tags:['原创'],cover:'',...(metadata?{authoringDraft:draft}:{})},privateId);
 const conversation={id:'private-'+randomUUID(),characterId:privateId,title:'原创海港航线',updatedAt:now,messages:[{id:'opening-'+randomUUID(),role:'assistant',content:'请先核对灯塔坐标。'},{id:'reply-'+randomUUID(),role:'user',content:'我正在整理原创航线。'}]};
 if(metadata){conversation.opening={version:1,kind:'opening',source:'history',messages:[]};conversation.worldClockMode='story';conversation.storyMemory=createDzmmStoryMemory({summary:'记录员正在整理航线。',scene:'原创雾港档案室',completed:[],pending:['核对灯塔坐标'],relationships:[],items:[]},conversation.messages);}
 const raw={...structuredClone(DZMM_INITIAL_STATE),custom:[character],conversations:[conversation],favorites:[privateId],preferences:{...DZMM_INITIAL_STATE.preferences,nickname:'原创雾港记录员'}};
 const hydrated=hydrateDzmmState(JSON.stringify(raw));assert.deepEqual(hydrated.warnings,[]);f.initial=hydrated.state;f.seed=seed?expect(await save(f,f.initial,0)):await snapshot(f);return f;
}
function interleave({afterRead,afterCas}={}){
 const prepared=new WeakMap(),batches=[];let reads=0,writes=0;
 function make(sql,bindings=[]){const actual=DB.prepare(sql).bind(...bindings);const wrapper={bind(...values){return make(sql,values);},first(...args){return actual.first(...args);},all(...args){return actual.all(...args);},run(...args){return actual.run(...args);}};prepared.set(wrapper,{actual,sql,bindings});return wrapper;}
 const database={prepare:sql=>make(sql),async batch(statements){const description=statements.map(value=>prepared.get(value)),isCas=description[0]?.sql.startsWith('UPDATE users SET version=version+1,mutation_token=');const results=await DB.batch(statements.map((value,index)=>description[index]?.actual??value));
  batches.push({isCas,queries:description.map(value=>value?.sql??''),changes:results[0].meta.changes,statementCount:statements.length});
  if(isCas){writes++;if(afterCas)await afterCas(results,batches.at(-1));}else{reads++;if(reads===1&&afterRead)await afterRead(results,batches.at(-1));}return results;},batches,get readBatches(){return reads;},get mutationBatches(){return writes;}};return database;
}
function atomicAck(database,casChanges=1){assert.equal(database.readBatches,1);assert.equal(database.mutationBatches,1);const batch=database.batches.find(value=>value.isCas);assert.equal(batch.changes,casChanges);assert.equal(batch.queries.slice(-6).filter(value=>value.startsWith('SELECT ')).length,6);assert.ok(batch.queries.at(-6).includes('version,role,email_verified_at,password_hash'));}

check('after a real A commit B appends before ACK; A keeps its own snapshot and the next old-branch edit conflicts',async()=>{
 const f=await fixture(),a=append(f.seed.state,'A页核对北码头'),bodies={};
 const db=interleave({afterCas:async()=>{const current=await snapshot(f);assert.equal(current.version,2);bodies.B=expect(await save(f,append(current.state,'B页补充南码头潮汐'),current.version,{token:f.tokens.B}));}});
 const ack=expect(await save(f,a,1,{database:db}));atomicAck(db);assert.equal(ack.version,2);assert.deepEqual(ack.state,a);assert.equal(bodies.B.version,3);
 const edited=structuredClone(a);edited.conversations[0].title='A页后续旧分支编辑';const conflict=expect(await save(f,edited,ack.version),409);assert.equal(conflict.version,3);assert.deepEqual(conflict.state,bodies.B.state);assert.deepEqual((await snapshot(f)).state,bodies.B.state);
});
check('after A commit B deletes the conversation before ACK; the A snapshot cannot adopt B deletion revision',async()=>{
 const f=await fixture(),a=append(f.seed.state,'A页保留完整航线'),db=interleave({afterCas:async()=>{const current=await snapshot(f),next=structuredClone(current.state);next.conversations=[];expect(await save(f,next,current.version,{token:f.tokens.B}));}});
 const ack=expect(await save(f,a,1,{database:db}));atomicAck(db);assert.equal(ack.version,2);assert.deepEqual(ack.state,a);assert.equal((await snapshot(f)).state.conversations.length,0);expect(await save(f,append(ack.state,'A旧分支再追加'),ack.version),409);assert.equal((await snapshot(f)).state.conversations.length,0);
});
check('resource PATCH acknowledgement has coherent own preference nickname and actual user fields before a later writer',async()=>{
 const f=await fixture();await DB.prepare('UPDATE users SET email_verified_at=? WHERE id=?').bind(Date.now(),f.id).run();
 const db=interleave({afterCas:async()=>{const current=await snapshot(f),next=structuredClone(current.state);next.preferences.nickname='B页新记录名';expect(await save(f,next,current.version,{token:f.tokens.B}));}});
 const ack=expect(await api(f,'/v1/preferences',{method:'PATCH',body:{preferences:{nickname:'A页记录名'},version:1},database:db}));atomicAck(db);assert.equal(ack.version,2);assert.equal(ack.state.preferences.nickname,'A页记录名');assert.equal(ack.user.nickname,'A页记录名');assert.equal(ack.user.role,'user');assert.equal(ack.user.emailVerified,true);assert.equal(ack.user.hasPassword,false);assert.equal(ack.user.passwordSetupRequired,true);assert.equal((await snapshot(f)).user.nickname,'B页新记录名');
});
check('real failed CAS is token-gated and its same-batch conflict snapshot stays coherent despite a subsequent writer',async()=>{
 const f=await fixture();let b2,b3;const db=interleave({afterRead:async()=>{b2=expect(await save(f,append(f.seed.state,'B先提交的航线'),1,{token:f.tokens.B}));},afterCas:async results=>{assert.equal(results[0].meta.changes,0);b3=expect(await save(f,append(b2.state,'B回包前进一步追加'),2,{token:f.tokens.B}));}});
 const conflict=expect(await save(f,append(f.seed.state,'A不应提交的旧航线'),1,{database:db}),409);atomicAck(db,0);assert.equal(conflict.version,2);assert.deepEqual(conflict.state,b2.state);assert.equal((await snapshot(f)).version,3);assert.deepEqual((await snapshot(f)).state,b3.state);
});
check('initialized no-op does not mutate or adopt a newer version; a later real edit still conflicts',async()=>{
 const f=await fixture();let b2;const db=interleave({afterRead:async()=>{b2=expect(await save(f,append(f.seed.state,'B在no-op读取后追加'),1,{token:f.tokens.B}));}});
 const ack=expect(await save(f,f.seed.state,1,{database:db}));assert.equal(db.readBatches,1);assert.equal(db.mutationBatches,0);assert.equal(ack.version,1);assert.deepEqual(ack.state,f.seed.state);expect(await save(f,append(ack.state,'A随后真实编辑'),ack.version),409);assert.deepEqual((await snapshot(f)).state,b2.state);
});
check('empty first initialization returns its own version one even when an independent writer immediately advances it',async()=>{
 const f=await fixture({seed:false});const empty=f.seed.state;let later;const db=interleave({afterCas:async()=>{const current=await snapshot(f),next=structuredClone(current.state);next.preferences.persona='B首次初始化后个人背景';later=expect(await save(f,next,1,{token:f.tokens.B}));}});
 const ack=expect(await save(f,empty,0,{database:db}));atomicAck(db);assert.equal(ack.version,1);assert.equal(ack.initialized,true);assert.deepEqual(ack.state,empty);assert.equal(later.version,2);assert.equal((await snapshot(f)).state.preferences.persona,'B首次初始化后个人背景');
});
check('cross-account state identity is rejected before mutation and a foreign owner cannot gain acknowledgement contents',async()=>{
 const owner=await fixture(),other=await fixture(),db=interleave();
 const rejected=expect(await api(owner,'/v1/state',{method:'PUT',body:{accountId:other.id,state:other.seed.state,version:1},database:db}),401);assert.equal(db.mutationBatches,0);assert.equal(rejected.state,undefined);assert.equal(rejected.user,undefined);assert.deepEqual((await snapshot(owner)).state,owner.seed.state);assert.deepEqual((await snapshot(other)).state,other.seed.state);
});
check('an actual D1 message constraint failure rolls CAS token preferences and entity deltas back without a saved ACK',async()=>{
 const f=await fixture(),before=await snapshot(f),prior=await DB.prepare('SELECT version,mutation_token,nickname FROM users WHERE id=?').bind(f.id).first();
 await DB.prepare("CREATE TRIGGER original_ack_abort BEFORE INSERT ON messages WHEN NEW.content='original ACK forced rollback' BEGIN SELECT RAISE(ABORT,'Original isolated ACK rollback'); END").run();
 try{const next=append(before.state,'original ACK forced rollback');next.preferences.nickname='未提交的偏好昵称';const result=await save(f,next,before.version);expect(result,500);assert.equal(result.data.state,undefined);assert.deepEqual(await DB.prepare('SELECT version,mutation_token,nickname FROM users WHERE id=?').bind(f.id).first(),prior);assert.deepEqual(await snapshot(f),before);}finally{await DB.prepare('DROP TRIGGER original_ack_abort').run();}
});
check('shared hydration retains old-client draft metadata and safely ignores damaged optional stored metadata',async()=>{
 const f=await fixture({metadata:true}),previous=f.seed;assert.ok(previous.state.custom[0].authoringDraft);assert.ok(previous.state.conversations[0].storyMemory);assert.ok(previous.state.conversations[0].opening);
 const legacy=structuredClone(previous.state);delete legacy.custom[0].authoringDraft;legacy.preferences.persona='旧客户端继续整理原创航线';const retained=expect(await save(f,legacy,previous.version));assert.deepEqual(retained.state.custom[0].authoringDraft,previous.state.custom[0].authoringDraft);assert.deepEqual(retained.state.conversations[0].storyMemory,previous.state.conversations[0].storyMemory);assert.deepEqual(retained.state.conversations[0].opening,previous.state.conversations[0].opening);
 await DB.batch([DB.prepare("UPDATE characters SET context_json=json_set(context_json,'$.authoringDraft',json('{\"version\":0}')) WHERE user_id=?").bind(f.id),DB.prepare("UPDATE conversations SET opening_json='{\"version\":0}',story_memory_json='{\"version\":0}',world_state_json='{\"version\":0}' WHERE user_id=?").bind(f.id)]);
 const damaged=await snapshot(f);assert.equal(damaged.state.custom[0].authoringDraft,undefined);for(const field of ['storyMemory','opening','worldState'])assert.equal(damaged.state.conversations[0][field],undefined);assert.deepEqual(damaged.state.conversations[0].messages,previous.state.conversations[0].messages);
 const next=structuredClone(damaged.state);next.preferences.persona='损坏元数据后正常同步';const saved=expect(await save(f,next,damaged.version));assert.deepEqual(saved,await snapshot(f));assert.equal(saved.user.role,'user');
});
