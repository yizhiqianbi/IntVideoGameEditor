// Offline synthetic DOM harness. No browser, environment, storage or model calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\nboot\(\);\s*$/, '') + '\nglobalThis.ui = {state,acceptSession,scheduleInitiative,initiativeEligible,requestInitiative,cancelInitiative,announcePresence,sendTurn,setDraft,renderMessages,updateControls,dirtySessions,initiativeAttempts,initiativeFailures,loadSession,flushOutbox,boot,checkPendingResult};';
class Element {
  constructor() { this.children=[];this.dataset={};this.style={};this.value='';this.hidden=false;this.open=false;this.events={};this.scrollHeight=1000;this.clientHeight=1000;this.scrollTop=0;this.classList={add(){},remove(){},toggle(){},contains(){return false;}}; }
  append(...items) { for(const item of items){item.parentElement=this;this.children.push(item);} }
  replaceChildren(...items) { this.children=[];this.append(...items); }
  get lastElementChild() { return this.children.at(-1); }
  setAttribute(name,value) { this[name]=value; }
  addEventListener(name,callback) { this.events[name]=callback; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() {}
  close() { this.open=false;this.events.close?.(); }
  showModal() { this.open=true; }
  setCustomValidity() {}
  reportValidity() {}
}
const html=fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
function session({id='fixture',plan='plan-a',revision=0,budget=0,expires=60000}={}) {
 const at=new Date().toISOString();
 return {id,revision,characterId:'yume',mode:'ai',createdAt:at,updatedAt:at,locale:'auto',effectiveLocale:'zh',messages:[{id:'opening',role:'assistant',text:'开场',createdAt:at}],memories:[],receipts:[],state:{mood:'playful',relationship:'',moodReason:''},characterBeat:{scope:'fictional-character',focus:'想起一件小事'},initiative:{enabled:true,pausedUntilUser:false,budgetUsed:budget,pending:plan?{id:plan,kind:'reconsider',notBefore:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+expires).toISOString()}:null}};
}
function harness(saved = {}) {
 const storage=new Map(Object.entries(saved));
 const elements=new Map(ids.map(id=>[id,new Element()]));const timers=new Map();let timerId=0;
 const document={hidden:false,getElementById:id=>elements.get(id),querySelector:()=>new Element(),querySelectorAll:()=>[],createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){}};
 const sandbox={document,window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}},localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},crypto:{randomUUID},fetch:async(path)=>{if(path==='/api/sessions')return Response.json({sessions:[]});throw new Error(`Unexpected fetch ${path}`);},AbortController,DOMException,TextDecoder,Uint8Array,Response,requestAnimationFrame:callback=>callback(),setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),console};
 vm.runInNewContext(source,sandbox);sandbox.ui.state.health={characters:[{id:'yume',name:'Yume',initials:'Y',subtitle:'可爱',description:'介绍'}],provider:{configured:true,model:'fixture',defaultMode:'ai'}};
 sandbox.ui.acceptSession(session());return Object.assign(sandbox,{elements,timers,storage});
}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const drainInput = h => { if(h.ui.state.inputTimer) h.clearTimeout(h.ui.state.inputTimer); h.ui.state.inputTimer=null; return h.ui.flushOutbox(); };
const startTurn = h => { void h.ui.sendTurn(); return drainInput(h); };
let checks=0;const ok=(value,message)=>{assert.ok(value,message);checks++;};
{
 const h=harness();ok(h.ui.state.initiativeCandidate.planId==='plan-a','Load adopts plan without user anchor');ok([...h.timers.values()].some(timer=>timer.delay===2000),'Due plan schedules minimum two seconds');
 h.ui.setDraft('fixture','正在输入，还没发完');h.ui.scheduleInitiative();ok(h.timers.size===0,'Typing a segment blocks proactive follow-up scheduling');
 h.ui.setDraft('fixture','');h.ui.scheduleInitiative();ok(h.timers.size===1,'Clearing the composer re-arms the proactive timer');
 h.ui.state.session.initiative.budgetUsed=3;h.ui.scheduleInitiative();ok(h.timers.size===0,'Budget three stops legacy follow-up scheduling');
 h.ui.state.session.initiative.budgetUsed=0;h.ui.state.session.initiative.pausedUntilUser=true;h.ui.scheduleInitiative();ok(h.timers.size===0,'Quiet pause stops scheduling');
}
{
 const h=harness();h.ui.state.session.initiative.budgetUsed=3;h.ui.state.session.initiative.pending.opportunityId='life-thread:1';h.ui.scheduleInitiative();
 ok(h.timers.size===1,'A concrete life opportunity can schedule after the legacy budget is spent');
 h.ui.state.session.initiative.pending=null;h.ui.state.initiativeCandidate=null;h.ui.state.session.agency={nextAt:new Date(Date.now()+60000).toISOString()};h.ui.scheduleInitiative();
 ok(h.timers.size===1&&h.ui.state.agencyTimer!==null,'A future life event schedules presence without a follow-up plan');
 let paths=[];h.fetch=async path=>{paths.push(path);const fresh=session({plan:null,budget:3,revision:1});fresh.agency={nextAt:null};return Response.json({session:fresh});};
 const wake=h.timers.get(h.ui.state.agencyTimer);h.timers.delete(h.ui.state.agencyTimer);wake.callback();await flush();
 ok(paths.length===1&&paths[0].endsWith('/presence'),'The life timer only requests a cheap presence check');
 ok(h.timers.size===0,'No remaining life event stops the wake-up chain');
 h.ui.state.session.agency={nextAt:new Date(Date.now()+60000).toISOString()};h.ui.setDraft('fixture','下一句还没写完');h.ui.scheduleInitiative();
 ok(h.timers.size===0,'An unfinished draft blocks life wake-ups');
 h.ui.setDraft('fixture','');h.document.hidden=true;h.ui.scheduleInitiative();ok(h.timers.size===0,'A hidden page blocks life wake-ups');
 h.document.hidden=false;h.ui.state.session.initiative.pausedUntilUser=true;h.ui.scheduleInitiative();ok(h.timers.size===0,'Quiet pause blocks life wake-ups');
}
{
 const h=harness();h.fetch=(path,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError'))));
 const run=h.ui.requestInitiative(h.ui.state.initiativeCandidate);await flush();h.ui.cancelInitiative({reread:false});await run;
 ok(!h.ui.initiativeAttempts.has('fixture:plan-a'),'Cancel releases same plan');ok(!h.ui.initiativeFailures.has('fixture:plan-a'),'Cancel does not add failure');h.ui.dirtySessions.clear();h.ui.scheduleInitiative();ok(h.timers.size===1,'Aborted plan resumes');
}
{
 const h=harness();let requests=0;h.fetch=async(path)=>{requests++;if(path.endsWith('/presence'))return Response.json({session:session()});return Response.json({error:'fixture failure'},{status:503});};
 await h.ui.requestInitiative(h.ui.state.initiativeCandidate);ok(h.ui.initiativeFailures.has('fixture:plan-a'),'Failure pauses this plan');ok(h.timers.size===0,'Failure has no retry loop');await h.ui.announcePresence({retry:true});ok(h.timers.size===1,'Presence can reconsider failure');ok(requests===2,'Exactly one generation and one presence');
}
{
 const h=harness();let obsolete=0;let presence=0;h.fetch=async(path)=>{if(path.endsWith('/presence')){presence++;return Response.json({session:session({plan:'fresh-plan',revision:1})});}obsolete++;throw new Error('old intent must not run');};
 h.ui.acceptSession(session({plan:'expired-plan',expires:-1000}));await flush();ok(presence===1&&obsolete===0,'Expired plan refreshes before generation');ok(h.ui.state.initiativeCandidate.planId==='fresh-plan','New presence plan is adopted');
}
{
 const h=harness();const bodies=[];
 h.fetch=async(path,options)=>{if(path.endsWith('/messages')){bodies.push(JSON.parse(options.body));return Response.json({session:session({revision:1})});}return Response.json({sessions:[]});};
 h.ui.setDraft('fixture','第一段');await h.ui.sendTurn();const firstTimer=h.ui.state.inputTimer;
 h.ui.setDraft('fixture','第二段');await h.ui.sendTurn();
 ok(bodies.length===0&&h.ui.state.outbox.length===2,'Rapid Enter sends remain local during the debounce window');
 ok(!h.timers.has(firstTimer)&&h.timers.get(h.ui.state.inputTimer).delay<=700,'Each new segment resets the 700 ms settle timer');
 ok(h.elements.get('message-input').value==='','Each submitted segment clears the composer immediately');
 ok(JSON.parse(h.storage.get('character-chat:outbox')).length===2,'Queued segments survive refresh in storage');
 h.ui.scheduleInitiative();ok(h.ui.state.initiativeTimer===null,'Queued segments suppress proactive messages');
 await drainInput(h);
 ok(bodies.length===1&&bodies[0].text==='第一段\n第二段','Rapid segments become one model input in original order');
 ok(h.ui.state.outbox.length===0&&!h.storage.has('character-chat:outbox'),'Committed queue is cleared from memory and storage');
}
{
 const h=harness();let control;const bodies=[];let interruptedId;let firstSignal;
 h.fetch=async(path,options)=>{
   if(path.endsWith('/interrupt')){interruptedId=JSON.parse(options.body).requestId;return Response.json({session:session({plan:null}),interrupted:true});}
   if(!path.endsWith('/messages'))return Response.json({sessions:[]});
   bodies.push(JSON.parse(options.body));
   if(bodies.length===1){firstSignal=options.signal;return new Response(new ReadableStream({start(controller){control=controller;options.signal.addEventListener('abort',()=>controller.error(new DOMException('abort','AbortError')));}}),{headers:{'content-type':'application/x-ndjson'}});}
   const committed=session({revision:1,plan:null});committed.messages.push({id:'new-user',role:'user',text:bodies[1].text},{id:'new-reply',role:'assistant',text:'看到你补充的啦。'});return Response.json({session:committed});
 };
 h.ui.setDraft('fixture','第一段');const run=startTurn(h);await flush();
 control.enqueue(new TextEncoder().encode('{"type":"message","index":0,"text":"还没说完的旧回复"}\n'));await flush();
 h.ui.setDraft('fixture','第二段');h.ui.updateControls();ok(!h.elements.get('send-message').disabled,'Send remains enabled during model generation');await h.ui.sendTurn();
 ok(firstSignal.aborted,'A new sent segment aborts the old stream immediately');await run;
 ok(interruptedId===bodies[0].requestId,'Cancellation is reconciled with the exact old request ID');
 ok(h.ui.state.outbox.map(item=>item.text).join('|')==='第一段|第二段','Uncommitted input is restored before the new segment');
 ok(h.elements.get('messages').children.every(row=>!row.dataset.messageId?.startsWith('stream:')),'Superseded provisional reply disappears');
 h.ui.setDraft('fixture','还在写的第三句');await drainInput(h);
 ok(bodies.length===2&&bodies[1].text==='第一段\n第二段'&&bodies[1].revision===0,'Replanned request sees all uncommitted input at the current revision');
 ok(bodies[1].requestId!==bodies[0].requestId,'A changed input gets a new idempotency key');
 ok(h.elements.get('message-input').value==='还在写的第三句','Replanning preserves the next unsent draft');
}
{
 const h=harness();const bodies=[];let initialRequest;
 h.fetch=async(path,options)=>{
   if(path.endsWith('/interrupt')){const committed=session({revision:1,plan:null});committed.receipts=[{requestId:initialRequest}];return Response.json({session:committed,interrupted:false});}
   if(!path.endsWith('/messages'))return Response.json({sessions:[]});
   const body=JSON.parse(options.body);bodies.push(body);
   if(bodies.length===1){initialRequest=body.requestId;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError'))));}
   return Response.json({session:session({revision:2,plan:null})});
 };
 h.ui.setDraft('fixture','已提交的一句');const run=startTurn(h);await flush();h.ui.setDraft('fixture','新补充');await h.ui.sendTurn();await run;await drainInput(h);
 ok(bodies[1].text==='新补充'&&bodies[1].revision===1,'A commit that wins the interrupt race is not resent');
}
{
 const h=harness();let releaseRead;const bodies=[];h.ui.dirtySessions.add('fixture');
 h.fetch=async(path,options)=>{
   if(path==='/api/sessions/fixture')return new Promise(resolve=>{releaseRead=()=>resolve(Response.json({session:session({revision:1,plan:null})}));});
   if(path.endsWith('/messages')){bodies.push(JSON.parse(options.body));return Response.json({session:session({revision:2,plan:null})});}
   return Response.json({sessions:[]});
 };
 h.ui.setDraft('fixture','第一段');const run=startTurn(h);await flush();ok(h.ui.state.starting,'Initial send exposes its reconciliation phase');
 h.ui.setDraft('fixture','第二段');await h.ui.sendTurn();ok(h.ui.state.outbox.length===2,'Input entered during reconciliation joins the pending batch');
 releaseRead();await run;
 ok(bodies.length===1&&bodies[0].text==='第一段\n第二段'&&bodies[0].revision===1,'Reconciliation batches all segments against the fresh revision');
}
{
 const h=harness();let interruptions=0;const bodies=[];
 h.fetch=async(path,options)=>{
   if(path.endsWith('/interrupt')){interruptions++;if(interruptions===1)throw new Error('offline');return Response.json({session:session({plan:null})});}
   if(!path.endsWith('/messages'))return Response.json({sessions:[]});
   bodies.push(JSON.parse(options.body));return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError'))));
 };
 h.ui.setDraft('fixture','旧输入');const run=startTurn(h);await flush();h.ui.setDraft('fixture','新输入');await h.ui.sendTurn();await run;
 const oldId=h.ui.state.pending.requestId;
 ok(h.ui.state.pending.superseded&&h.ui.state.outbox.length===1,'Uncertain interrupt retains the pending receipt and new queue');
 ok(h.ui.state.inputTimer===null,'Uncertain interrupt never blindly resends');
 await h.ui.sendTurn(true);
 ok(interruptions===2&&bodies.length===1&&h.ui.state.pending===null,'Retry reconciles cancellation without replaying the obsolete prompt');
 ok(h.ui.state.outbox.map(item=>item.text).join('|')==='旧输入|新输入','Retry restores uncommitted input once');
 ok(oldId===bodies[0].requestId,'The original receipt key remains stable during interruption recovery');
}
{
 const h=harness();let control;h.fetch=async(path,options)=>{if(path.endsWith('/messages')){const body=JSON.parse(options.body);ok(body.stream===true,'Foreground requests NDJSON');return new Response(new ReadableStream({start(controller){control=controller;}}),{headers:{'content-type':'application/x-ndjson'}});}return Response.json({sessions:[]});};
 h.ui.setDraft('fixture','你好');const run=startTurn(h);await flush();ok(h.elements.get('message-input').value==='','Clears sent draft');ok(h.elements.get('message-input').readOnly===false,'Generation allows typing');
 control.enqueue(new TextEncoder().encode('{"type":"message","index":0,"text":"第一句"}\n'));await flush();ok(h.ui.state.stream.messages.length===1,'First part arrives before commit');h.ui.setDraft('fixture','我在等的时候写下一句');
 control.enqueue(new TextEncoder().encode('{"type":"message","index":1,"text":"第二句"}\n'));const committed=session({plan:'next-plan',revision:1});committed.messages.push({id:'user',role:'user',text:'你好',createdAt:new Date().toISOString()},{id:'assistant-1',role:'assistant',text:'第一句',createdAt:new Date().toISOString(),turnId:'turn'},{id:'assistant-2',role:'assistant',text:'第二句',createdAt:new Date().toISOString(),turnId:'turn'});control.enqueue(new TextEncoder().encode(JSON.stringify({type:'done',session:committed})+'\n'));control.close();await run;
 ok(h.elements.get('message-input').value==='我在等的时候写下一句','Commit preserves next draft');ok(h.ui.state.pending===null&&h.ui.state.stream===null,'Commit clears request and provisional output');ok(h.elements.get('messages').children.filter(row=>row.dataset.messageId?.startsWith('stream:')).length===0,'Committed rows replace provisional rows');ok(h.elements.get('messages').children.length===4,'No duplicate message parts');ok(h.ui.state.playback===null,'Streamed parts do not replay');
}
{
 const h=harness();let control;h.fetch=async()=>new Response(new ReadableStream({start(controller){control=controller;}}),{headers:{'content-type':'application/x-ndjson'}});h.ui.setDraft('fixture','原句');const run=startTurn(h);await flush();control.enqueue(new TextEncoder().encode('{"type":"message","index":0,"text":"临时一句"}\n'));await flush();h.ui.setDraft('fixture','后面想说的话');control.enqueue(new TextEncoder().encode('{"type":"error","error":"本次未完成","code":"UPSTREAM"}\n'));control.close();await run;
 ok(h.ui.state.pending?.text==='原句','Stream error keeps request');ok(h.elements.get('message-input').value==='后面想说的话','Stream error keeps new draft');ok(h.elements.get('messages').children.every(row=>!row.dataset.messageId?.startsWith('stream:')),'Stream error removes temporary output');ok(h.elements.get('retry-send').hidden===false,'Stream error offers retry');
}
{
 const h=harness();const committed=session({revision:1});h.fetch=async(path)=>path.endsWith('/messages')?Response.json({session:committed}):Response.json({sessions:[]});h.ui.setDraft('fixture','你好');await startTurn(h);ok(h.ui.state.pending===null&&h.ui.state.session.revision===1,'JSON idempotent replay is accepted');
}
{
 const h=harness();let control;const fresh=session({revision:4,plan:'newer'});h.fetch=async(path)=>path.endsWith('/messages')?new Response(new ReadableStream({start(controller){control=controller;}}),{headers:{'content-type':'application/x-ndjson'}}):Response.json({session:fresh});h.ui.setDraft('fixture','原句');const run=startTurn(h);await flush();h.ui.setDraft('fixture','新草稿');control.enqueue(new TextEncoder().encode('{"type":"error","error":"版本已更新","code":"STALE"}\n'));control.close();await run;ok(h.ui.state.pending?.revision===4,'Stale request rebases pending revision after reading');ok(h.elements.get('message-input').value==='新草稿','Stale recovery preserves changed draft');
}
{
 const h=harness();const bodies=[];
 h.fetch=async(path,options)=>{
   if(path.endsWith('/messages')){bodies.push(JSON.parse(options.body));return bodies.length===1?Response.json({error:'正在处理',code:'BUSY'},{status:409}):Response.json({session:session({revision:1,plan:null})});}
   if(path==='/api/sessions/fixture')return Response.json({session:session({plan:null})});return Response.json({sessions:[]});
 };
 h.ui.setDraft('fixture','不要丢');await startTurn(h);await h.ui.sendTurn(true);
 ok(bodies.length===2&&bodies[0].requestId===bodies[1].requestId,'BUSY retry preserves the same idempotency key');
}
{
 const pending={sessionId:'fixture',text:'尚未确认',requestId:'old-request',revision:0,locale:'auto',superseded:true,segments:[{id:'segment-old',sessionId:'fixture',text:'尚未确认'}]};
 const queued={id:'segment-new',sessionId:'fixture',text:'已经补充',createdAt:new Date().toISOString()};
 const h=harness({'character-chat:last-session':'fixture','character-chat:pending-turn':JSON.stringify(pending),'character-chat:outbox':JSON.stringify([queued]),'character-chat:drafts':JSON.stringify({fixture:'还没发送的草稿'})});
 const health=h.ui.state.health;h.ui.state.session=null;
 h.fetch=async(path)=>{
   if(path==='/api/health')return Response.json(health);
   if(path==='/api/sessions')return Response.json({sessions:[session({plan:null})]});
   if(path==='/api/sessions/fixture')return Response.json({session:session({plan:null})});throw new Error('Should not generate while a receipt is uncertain');
 };
 await h.ui.boot();
 ok(h.ui.state.pending?.requestId==='old-request'&&h.ui.state.pending.superseded,'Refresh recovers an interrupted pending receipt');
 ok(h.ui.state.outbox.length===1&&h.ui.state.outbox[0].text==='已经补充','Refresh recovers queued segments alongside the pending turn');
 ok(h.elements.get('message-input').value==='还没发送的草稿','Refresh keeps the next draft instead of overwriting it with pending input');
 ok(h.ui.state.inputTimer===null&&h.ui.state.initiativeTimer===null,'Recovery waits for confirmation before generation or proactive output');
}
{
 const h=harness();let releaseInterrupt;let messageCalls=0;
 h.fetch=async(path,options)=>{
   if(path.endsWith('/interrupt'))return new Promise(resolve=>{releaseInterrupt=()=>resolve(Response.json({session:session({plan:null})}));});
   if(path.endsWith('/messages')){messageCalls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError'))));}
   throw new Error('Should not switch sessions during input');
 };
 h.ui.setDraft('fixture','第一段');const run=startTurn(h);await flush();
 h.ui.setDraft('fixture','第二段');await h.ui.sendTurn();await flush();
 h.ui.setDraft('fixture','第三段');await h.ui.sendTurn();
 await h.ui.loadSession('another-session');
 ok(h.ui.state.session.id==='fixture'&&messageCalls===1,'An interrupt in progress cannot change the input session');
 releaseInterrupt();await run;
 ok(h.ui.state.outbox.map(item=>item.text).join('|')==='第一段|第二段|第三段','A third segment entered during cancellation is preserved in order');
 ok(h.ui.state.outbox.every(item=>item.sessionId==='fixture'),'Recovered segments keep their original session ownership');
}
{
 const h=harness();let reads=0;const bodies=[];h.ui.dirtySessions.add('fixture');
 h.fetch=async(path,options)=>{
   if(path==='/api/sessions/fixture'){reads++;if(reads===1)throw new Error('offline');return Response.json({session:session({plan:null})});}
   if(path.endsWith('/messages')){bodies.push(JSON.parse(options.body));return Response.json({session:session({revision:1,plan:null})});}
   return Response.json({sessions:[]});
 };
 h.ui.setDraft('fixture','保留在队列');await startTurn(h);
 ok(h.ui.state.outbox.length===1&&h.ui.state.inputTimer===null,'Failed preparation preserves the queue without an automatic retry loop');
 await h.ui.sendTurn(true);
 ok(bodies.length===1&&bodies[0].text==='保留在队列','Retry can resume a queued turn before a request ID was assigned');
}
{
 const queued={id:'segment-recovered',sessionId:'fixture',text:'上次还没发送',createdAt:new Date().toISOString()};
 const h=harness({'character-chat:last-session':'other','character-chat:outbox':JSON.stringify([queued])});
 const health=h.ui.state.health;h.ui.state.session=null;
 h.fetch=async(path)=>{
   if(path==='/api/health')return Response.json(health);
   if(path==='/api/sessions')return Response.json({sessions:[session({id:'other',plan:null}),session({plan:null})]});
   if(path==='/api/sessions/fixture')return Response.json({session:session({plan:null})});throw new Error('Should restore the queue owner');
 };
 await h.ui.boot();
 ok(h.ui.state.session?.id==='fixture','A restored queue selects its owning session instead of the remembered unrelated session');
 ok(h.ui.state.outbox.length===1&&h.ui.state.inputTimer!==null,'A restored queue with no uncertain receipt resumes after a short settle window');
}
console.log(`PASS ${checks} isolated UI checks`);
