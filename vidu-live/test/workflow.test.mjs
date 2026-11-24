import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStudio } from '../server.mjs';
import { generationPayload, referencePayload } from '../protocol.mjs';
const avatar = 'https://example.com/avatar.png';
async function harness(t, options = {}) {
  const app=createStudio(options); await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{app.end('test complete');app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
  const status=async()=>(await fetch(url+'/api/status')).json();const {csrf}=await status();
  const post=async(route,body,headers={})=>{const res=await fetch(url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':csrf,...headers},body:JSON.stringify(body)});return{code:res.status,data:await res.json()};};
  return{url,status,post};
}
test('rehearsal accepts danmaku and references, blocks duplicate start and sends nothing upstream',async t=>{
  let calls=0;const h=await harness(t,{request:()=>{calls++;throw Error('must not call');}});
  assert.equal((await h.post('danmaku',{text:'hello'})).code,400);
  assert.equal((await h.post('start',{mode:'rehearsal',avatar,persona:'主持人'})).code,200);
  assert.equal((await h.post('start',{mode:'rehearsal',avatar,persona:'主持人'})).code,400);
  assert.equal((await h.post('danmaku',{text:'挥手',name:'观众'})).code,200);
  assert.equal((await h.post('references',{images:[{url:avatar,kind:'garment'}]})).code,200);
  const state=await h.status();assert.equal(state.events.find(e=>e.type==='danmaku').data.text,'挥手');
  await h.post('stop',{});assert.equal((await h.status()).session.status,'ended');
  assert.equal((await h.post('danmaku',{text:'late'})).code,400);assert.equal(calls,0);
});
test('CSRF and cross-origin requests cannot change local configuration',async t=>{
  const h=await harness(t);assert.equal((await h.post('config',{region:'cn',key:'secret'},{'X-Studio-Token':'bad'})).code,403);
  assert.equal((await h.post('config',{region:'cn',key:'secret'},{Origin:'https://untrusted.example'})).code,403);
  assert.equal((await h.status()).configured,false);
});
test('real S2 uses documented auth, initialization, text 99, references 11 and hangup 5',async t=>{
  let socket,requestBody,headers;
  class FakeSocket extends EventEmitter { constructor(url,options){super();this.readyState=1;this.frames=[];this.url=url;this.options=options;socket=this;queueMicrotask(()=>this.emit('open'));}send(data){this.frames.push(JSON.parse(data));}close(){this.readyState=3;this.emit('close');}}
  const h=await harness(t,{initialKey:'test-key',Socket:FakeSocket,request:async(url,options)=>{headers=options.headers;requestBody=JSON.parse(options.body);return new Response(JSON.stringify({live:{id:'123456'},rtc:{token:'rtc-token',user_id:'viewer'}}));}});
  await h.post('start',{mode:'real',control:'auto',avatar,persona:'中文主持人'});
  assert.equal(requestBody.model,'vidu-s2');assert.equal(Object.hasOwn(requestBody,'idle_timeout_seconds'),false);assert.equal(headers.Authorization,'Token test-key');assert.match(socket.url,/\/live\/ws\/live\/connect/);
  assert.equal(socket.frames[0].type,1);assert.equal((await h.post('danmaku',{text:'early'})).code,400);
  socket.emit('message',JSON.stringify({type:2,payload:{conn_init_ack:{success:true}}}));
  await h.post('danmaku',{text:'你好',name:'A'});assert.equal(socket.frames.at(-1).type,99);assert.equal(socket.frames.at(-1).payload.text_msg.content,'A说：你好');
  await h.post('references',{images:[{url:avatar,kind:'background'}]});assert.equal(socket.frames.at(-1).type,11);
  assert.ok(!JSON.stringify(await h.status()).includes('test-key'));
  await h.post('stop',{});assert.equal(socket.frames.at(-1).type,5);assert.equal(socket.readyState,3);
});
test('upstream close ends the local session and blocks future input',async t=>{
  let socket;
  class Socket extends EventEmitter {constructor(){super();socket=this;this.readyState=1;queueMicrotask(()=>this.emit('open'));}send(){}close(){this.readyState=3;}}
  const h=await harness(t,{initialKey:'key',Socket,request:async()=>new Response(JSON.stringify({live:{id:'42'},rtc:{}}))});
  await h.post('start',{mode:'real',control:'auto',avatar,persona:'主播'});socket.emit('close');assert.equal((await h.status()).session.status,'ended');
});
test('generation submission and polling preserve account and redact key',async t=>{
  const requests=[];
  const h=await harness(t,{initialKey:'first-key',request:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(options.method==='POST'?{task_id:'task1',state:'created'}:{state:'success',creations:[{url:'https://example.com/result.png'}]}));}});
  assert.equal((await h.post('generate',{kind:'image',prompt:'一件蓝色夹克',images:[]})).code,200);
  await h.post('config',{region:'global',key:'second-key'});
  const result=await h.post('task',{id:'task1'});assert.equal(result.data.state,'success');assert.equal(requests[1].options.headers.Authorization,'Token first-key');
  assert.match(requests[1].url,/api.vidu.cn\/ent\/v2\/tasks\/task1\/creations/);assert.ok(!JSON.stringify(await h.status()).includes('first-key'));
});
test('model routing, invalid inputs and oversized references',()=>{
  assert.equal(generationPayload('image','scene').body.model,'viduq2');
  assert.equal(generationPayload('video','scene').path,'/ent/v2/text2video');
  assert.equal(generationPayload('video','scene',[avatar]).path,'/ent/v2/reference2video');
  assert.throws(()=>generationPayload('audio','scene'));
  assert.throws(()=>referencePayload([]));assert.throws(()=>referencePayload([{url:'javascript:alert(1)',kind:'object'}]));
  assert.throws(()=>referencePayload([{url:avatar,kind:'invalid'}]));
  assert.throws(()=>referencePayload(Array(3).fill({url:'data:image/png;base64,'+'A'.repeat(6*1024*1024),kind:'object'})));
});

test('performance mode uses realtime, forwards danmaku and sends direction as instructions',async t=>{
  let socket,creation;
  class Socket extends EventEmitter {constructor(url){super();socket=this;this.url=url;this.frames=[];this.readyState=1;queueMicrotask(()=>this.emit('open'));}send(data){assert.equal(typeof data,'string');this.frames.push(JSON.parse(data));}close(){this.readyState=3;}}
  const h=await harness(t,{initialKey:'key',Socket,request:async(url,options)=>{creation={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({live:{id:'performance-1'},rtc:{token:'viewer-token',user_id:'viewer'}}));}});
  const start=await h.post('start',{mode:'real',avatar,persona:'中文主播'});assert.equal(start.code,200);assert.equal(start.data.session.control,'performance');assert.match(creation.url,/s_avatar\/realtime$/);assert.match(creation.body.avatar.persona,/不要朗读指令/);assert.equal(creation.body.rtc_info,undefined);
  assert.equal((await h.post('execute',{intent:'欢迎观众'})).code,400);
  socket.emit('message',JSON.stringify({type:2,payload:{conn_init_ack:{success:true}}}));
  assert.equal((await h.post('danmaku',{text:'你好',name:'观众A'})).code,200);assert.deepEqual(socket.frames.map(f=>f.type),[1,99]);assert.equal(socket.frames.at(-1).payload.text_msg.content,'观众A说：你好');assert.equal((await h.status()).events.find(e=>e.type==='danmaku').data.delivery,'已发送至 S2');
  assert.equal((await h.post('execute',{intent:'欢迎观众',emotion:'开心',motion:'挥手'})).code,200);
  assert.equal(socket.frames.at(-1).type,99);const content=socket.frames.at(-1).payload.text_msg.content;assert.match(content,/回应方向：欢迎观众/);assert.match(content,/情绪：开心/);assert.match(content,/动作：挥手/);assert.match(content,/自行组织/);
  assert.equal((await h.post('execute',{})).code,400);
  await h.post('stop',{});assert.equal((await h.post('execute',{motion:'挥手'})).code,400);
});
test('empty or invalid upstream responses preserve HTTP diagnostics without retrying', async t=>{
  for(const [raw,status,expected] of [['',502,/空响应.*HTTP 502/],['<html>bad gateway</html>',503,/非 JSON.*HTTP 503/],['null',200,/无效数据/]]) {
    let calls=0;
    const h=await harness(t,{initialKey:'key',request:async()=>{calls++;return new Response(raw,{status,headers:{'content-type':'text/html'}});}});
    const r=await h.post('start',{mode:'real',avatar});assert.equal(r.code,400);assert.match(r.data.error,expected);assert.equal(calls,1);
    const state=await h.status();assert.equal(state.session,null);assert.equal(state.lastStartError.message,r.data.error);assert.equal(state.events.at(-1).type,'start_error');assert.ok(!JSON.stringify(state).includes('<html>'));
  }
});
