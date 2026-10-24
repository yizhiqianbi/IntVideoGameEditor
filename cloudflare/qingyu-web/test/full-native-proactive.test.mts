import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../engine/companion-native/runtime/gateway.mjs';
import { createController } from '../engine/companion-native/runtime/control.mjs';
const TIME = Date.now();
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'qingyu-proactive-'));
  let calls = 0, fail = false;
  const native = { connected: true, opened: new Set<string>(), async connect() {}, async open() {}, async proactive() { calls++; if (fail) throw new Error('lost ack'); return {queued:true}; }, close() {} };
  let gateway = await createGateway({instanceDir:directory, nativeClient:native, now:()=>TIME});
  const {session} = await gateway.create({characterId:'yume'});
  const current = gateway.sessions.get(session.id);
  current.messages = [{id:'user-native-id',role:'user',text:'今天排练很顺利。',createdAt:new Date(TIME-100_000).toISOString()},
    {id:'assistant-id',role:'assistant',text:'那一段旋律终于找到结尾了。',createdAt:new Date(TIME-60_000).toISOString()}];
  return { directory, native, current, session, get calls(){return calls;}, get gateway(){return gateway;}, fail(){fail=true;},
    async restore(){await gateway.close(); gateway=await createGateway({instanceDir:directory,nativeClient:native,now:()=>TIME});},
    async close(){await gateway.close();await rm(directory,{recursive:true,force:true});} };
}
test('native proactive intent is persisted once across concurrent calls and gateway restoration, with no fabricated message', async()=>{
  const f=await fixture();try {
    const before=structuredClone(f.current.messages);
    const results=await Promise.all([f.gateway.proactive(f.session.id,{userMessageId:'user-native-id'}),f.gateway.proactive(f.session.id,{userMessageId:'user-native-id'})]);
    assert.equal(f.calls,1);assert.equal(results[0].queued,true);assert.equal(results[1].replayed,true);
    assert.deepEqual(f.current.messages,before);
    const stored=JSON.parse(await readFile(join(f.directory,'gateway-sessions',`${f.session.id}.json`),'utf8'));
    assert.equal(stored.proactiveRequests['message:user-native-id'].status,'queued');
    await f.restore();assert.equal((await f.gateway.proactive(f.session.id,{userMessageId:'user-native-id'})).replayed,true);assert.equal(f.calls,1);
  }finally{await f.close();}
});
test('lost native acknowledgement remains uncertain and never causes a duplicate wake-up',async()=>{
  const f=await fixture();try{
    f.fail();assert.equal((await f.gateway.proactive(f.session.id,{userMessageId:'user-native-id'})).reason,'delivery-uncertain');
    await f.restore();assert.equal((await f.gateway.proactive(f.session.id,{userMessageId:'user-native-id'})).replayed,true);assert.equal(f.calls,1);
  }finally{await f.close();}
});
test('quiet requests, newer messages, recent replies, invalid timestamps and active typing suppress proactive work',async()=>{
  for(const condition of ['quiet','new-user','recent','invalid-time','typing']){
    const f=await fixture();try{
      if(condition==='quiet')f.current.messages[0].text='今晚先忙，晚安。';
      if(condition==='new-user')f.current.messages.push({id:'later',role:'user',text:'等等',createdAt:new Date(TIME-50_000).toISOString()});
      if(condition==='recent')f.current.messages[1].createdAt=new Date(TIME-10_000).toISOString();
      if(condition==='invalid-time')f.current.messages[0].createdAt='invalid';
      if(condition==='typing')f.current.typing=true;
      assert.equal((await f.gateway.proactive(f.session.id,{userMessageId:'user-native-id'})).queued,false);assert.equal(f.calls,0);
    }finally{await f.close();}
  }
});
test('browser intent cannot enter a native proactive task and the private controller exposes only the dedicated route',async()=>{
  const f=await fixture();try{
    await assert.rejects(()=>f.gateway.proactive(f.session.id,{userMessageId:'user-native-id',intent:'browser instruction'}),{code:'INVALID_MESSAGE'});
    const paths:string[]=[];
    const token='isolated-controller-token-'.repeat(2);
    const server=createController({token,lifecycle:{health:()=>({ready:true}),proxy:async(path:string)=>{paths.push(path);return {status:202,contentType:'application/json',body:JSON.stringify({queued:true})};}} as any});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address() as any;
      const response=await fetch(`http://127.0.0.1:${address.port}/api/sessions/${f.session.id}/proactive`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({userMessageId:'user-native-id'})});
      assert.equal(response.status,202);assert.equal(paths.length,1);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }finally{await f.close();}
});
