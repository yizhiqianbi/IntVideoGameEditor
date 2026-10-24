import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { after,before,test } from 'node:test';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
const {fetchRequest}=await tsImport('../src/app.ts',import.meta.url);
const {quoteCreditUsage,reserveCreditUsage,finalizeCreditUsage,creditUsageBalanceStatement,getPendingCreditUsage,releaseExpiredCreditUsage}=await tsImport('../src/credit-usage.ts',import.meta.url);
let store,DB;
const policy={version:1,multiplier:3,usdToCny:6.704588,creditsPerCny:100,inputUsdPerMillion:2,outputUsdPerMillion:6,maxInputUsdPerMillion:4.4,maxOutputUsdPerMillion:13.2};
let env;
before(async()=>{
 store=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',modules:true,script:'export default {fetch(){return new Response("isolated admin")}}',d1Databases:{DB:'admin-super-tests'}}));
 DB=await store.getD1Database('DB');
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()) {
  const source=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');
  await DB.batch(splitSqlStatements(source).filter(s=>s.trim()).map(sql=>DB.prepare(sql)));
 }
 env={DB,APP_ORIGINS:'https://admin.example.test',CREDIT_BILLING_ENABLED:'true',CREDIT_BILLING_RATES_JSON:JSON.stringify({revision:1,inputCreditsPer1000:4.022753,outputCreditsPer1000:12.068258}),CREDIT_BILLING_COST_POLICY_JSON:JSON.stringify(policy)};
});
after(async()=>{await store?.dispose();});
async function account(role='user',guest=false) {
 const user={id:randomUUID(),email:`${randomUUID()}@admin.example.test`,nickname:'独立后台测试',role,isGuest:guest,version:0},token=randomBytes(32).toString('hex'),now=Date.now();
 const hash=createHash('sha256').update(token).digest('hex');
 await DB.batch([DB.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,?,?,?)').bind(user.id,user.email,user.nickname,guest?1:0,role,now),DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash,user.id,now+86400000,now)]);
 return {user,token,hash};
}
function request(a,path='/v1/billing/usage',body,origin='https://admin.example.test') {return new Request(`https://admin.example.test${path}`,{method:body?'POST':'GET',headers:{Cookie:`qingyu_session=${a.token}`,...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function api(a,path,body,origin){const r=await fetchRequest(request(a,path,body,origin),env);return {status:r.status,value:await r.json()};}
function input(extra={}) {return {requestId:randomUUID(),operation:'chat',model:'x-ai/grok-4.6',requestFingerprint:'a'.repeat(64),inputTokenUpperBound:10000,maxOutputTokens:2048,...extra};}
function reserve(a,value=input(),user=a.user){return reserveCreditUsage(request(a),env,user,value);}
function finish(a,r,extra={}) {return finalizeCreditUsage(env,{reservationId:r.receipt.id,accountId:a.user.id,claimToken:r.claimToken,outcome:'completed',hasValidOutput:true,usage:{promptTokens:100,completionTokens:20,providerCostUsd:0.001},...extra});}
function adjustment(actor,target,delta,requestId=randomUUID(),reason='隔离检查'){return api(actor,`/v1/admin/users/${target.user.id}/credits`,{accountId:actor.user.id,requestId,delta,reason});}
async function balance(a){return creditUsageBalanceStatement(env,a.user.id).first();}
const status=n=>e=>e.status===n;
async function trustedGrant(a,credits=1000000000,key=`isolated-grant-${randomUUID()}`) {
 const reason='隔离可信管理额度',now=Date.now();
 await DB.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?) ON CONFLICT(grant_key) DO NOTHING')
  .bind(key,a.user.id,credits,reason,now).run();return key;
}
// Only isolated SQL constructs a pre-0023 execution. New code has no exemption
// creation path; this fixture verifies already-authorized historical leases.
async function legacyExecution(a,value=input()) {
 const id=`usage_${randomUUID()}`,claimToken=randomUUID(),now=Date.now();
 await DB.prepare(`INSERT INTO super_generation_usage(id,user_id,request_id,operation,model,request_fingerprint,input_token_upper_bound,max_output_tokens,
  price_revision,input_rate,output_rate,cost_policy_json,authorization_hash,processing_token,created_at,expires_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(id,a.user.id,value.requestId,value.operation,value.model,value.requestFingerprint,value.inputTokenUpperBound,value.maxOutputTokens,1,4.022753,12.068258,
    JSON.stringify(policy),createHash('sha256').update(claimToken).digest('hex'),randomUUID(),now,now+600000).run();
 return {receipt:{id,requestId:value.requestId},claimToken};
}


test('all admin reads and writes authorize current nonguest database role; browser role and cross-origin cannot grant admin',async()=>{
 const ordinary=await account(),guest=await account('super',true),admin=await account('super');
 for(const a of [ordinary,guest]) for(const path of ['/overview','/users','/orders','/usage','/audit','/subscriptions'])assert.equal((await api(a,`/v1/admin${path}`)).status,403);
 assert.equal((await api({token:'0'.repeat(64)},'/v1/admin/overview')).status,401);
 assert.equal((await adjustment(ordinary,admin,10)).status,403);
 assert.equal((await api(admin,`/v1/admin/users/${ordinary.user.id}/credits`,{accountId:admin.user.id,requestId:randomUUID(),delta:10,reason:'隔离'},'https://attacker.example')).status,403);
 await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(admin.user.id).run();
 assert.equal((await api(admin,'/v1/admin/overview')).status,403);
});

test('admin credit adjustment changes spendable wallet once, audits actor/reason and preserves payment facts',async()=>{
 const admin=await account('super'),target=await account(),id=randomUUID();
 const results=await Promise.all(Array.from({length:6},()=>adjustment(admin,target,100,id)));
 assert.ok(results.every(r=>r.status===200||r.status===201));assert.equal(results.filter(r=>r.status===201).length,1);
 assert.equal((await balance(target)).balance,100);
 const audit=results[0].value.audit;assert.equal(audit.actorId,admin.user.id);assert.equal(audit.targetUserId,target.user.id);assert.equal(audit.reason,'隔离检查');
 assert.equal((await adjustment(admin,target,99,id)).status,409);
 assert.equal((await adjustment(admin,target,-101)).status,409);assert.equal((await balance(target)).balance,100);
 assert.equal((await adjustment(admin,target,-20)).status,201);assert.equal((await balance(target)).balance,80);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM payment_orders WHERE user_id=?').bind(target.user.id).first()).n,0);
 assert.equal((await api(admin,'/v1/admin/audit?userId='+target.user.id)).value.items.length,2);
});

test('concurrent negative adjustments cannot overdraw reserved/available credits and unrelated replay conflicts',async()=>{
 const admin=await account('super'),target=await account();await adjustment(admin,target,100);
 const results=await Promise.all(Array.from({length:8},()=>adjustment(admin,target,-30)));
 assert.equal(results.filter(r=>r.status===201).length,3);assert.equal((await balance(target)).balance,10);
 const fixed=randomUUID();assert.equal((await adjustment(admin,target,1,fixed)).status,201);
 assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/role`,{accountId:admin.user.id,requestId:fixed,role:'super',reason:'隔离检查'})).status,409);
 for(const delta of [0,1.5,1000001,'1'])assert.equal((await adjustment(admin,target,delta)).status,400);
});

test('role actions are idempotent, guests excluded, self-demotion rejected and current permissions change immediately',async()=>{
 const admin=await account('super'),target=await account(),guest=await account('user',true),id=randomUUID();
 const body={accountId:admin.user.id,requestId:id,role:'super',reason:'授权隔离管理'};
 assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/role`,body)).status,201);
 assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/role`,body)).value.replayed,true);
 assert.equal((await api(target,'/v1/admin/overview')).status,200);
 assert.equal((await api(admin,`/v1/admin/users/${admin.user.id}/role`,{...body,requestId:randomUUID(),role:'user'})).status,409);
 assert.equal((await api(admin,`/v1/admin/users/${guest.user.id}/role`,{...body,requestId:randomUUID()})).status,400);
 assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/role`,{...body,requestId:randomUUID(),role:'user'})).status,201);
 assert.equal((await api(target,'/v1/admin/overview')).status,403);
});

test('management pages return only account/order/usage metadata with bounded search pagination',async()=>{
 const admin=await account('super'),target=await account();await adjustment(admin,target,100);
 const read=await api(admin,'/v1/admin/users?q='+encodeURIComponent(target.user.email));assert.equal(read.value.total,1,JSON.stringify(read));assert.equal(read.value.items[0].availableCredits,100);
 for(const path of ['/users?limit=0','/users?limit=51','/users?offset=-1','/users?role=admin','/users?limit=1&limit=2','/usage?userId=bad','/overview?q=bad'])assert.equal((await api(admin,'/v1/admin'+path)).status,400);
 const overview=(await api(admin,'/v1/admin/overview')).value;assert.equal(overview.capabilities.privateConversations,false);assert.ok(overview.serverTime>0);
 for(const path of ['/orders','/usage','/subscriptions'])assert.equal((await api(admin,'/v1/admin'+path+'?userId='+target.user.id)).status,200);
 const serialized=JSON.stringify(overview);assert.ok(!serialized.includes('password_hash'));assert.ok(!serialized.includes('session'));
});

test('Super uses a real huge numeric balance and ordinary quote, reservation and actual-cost debit without fake payment facts',async()=>{
 const admin=await account('super'),value=input();
 await assert.rejects(quoteCreditUsage(request(admin),env,admin.user,value),status(402));await assert.rejects(reserve(admin,value),status(402));
 await trustedGrant(admin);const q=await quoteCreditUsage(request(admin),env,admin.user,value);
 assert.equal(q.availableCredits,1000000000);assert.equal(q.maxOutputTokens,value.maxOutputTokens);assert.ok(q.requiredCredits>0);assert.notEqual(q.billingExempt,true);
 const r=await reserve(admin,value);assert.notEqual(r.receipt.billingExempt,true);assert.equal(r.receipt.reservedCredits,q.requiredCredits);assert.deepEqual(r.receipt.costPolicy,policy);
 assert.equal((await balance(admin)).reserved_credits,q.requiredCredits);assert.equal((await balance(admin)).balance,1000000000-q.requiredCredits);
 const receipt=await finish(admin,r);assert.equal(receipt.chargedCredits,3);assert.equal(receipt.providerCostUsd,0.001);assert.equal(receipt.status,'settled');
 assert.equal((await balance(admin)).balance,999999997);assert.equal((await balance(admin)).reserved_credits,0);assert.equal((await balance(admin)).total_spent,3);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(admin.user.id).first()).n,1);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE user_id=?').bind(admin.user.id).first()).n,1);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM super_generation_usage WHERE user_id=?').bind(admin.user.id).first()).n,0);
 for(const table of ['payment_orders','zpay_orders','subscription_orders'])assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).bind(admin.user.id).first()).n,0);
 const usage=(await api(admin,'/v1/billing/usage')).value;assert.equal(usage.creditUnlimited,false);assert.equal(usage.billingExempt,false);assert.notEqual(usage.items[0].billingExempt,true);assert.equal(usage.availableBalance,999999997);
 const users=(await api(admin,'/v1/admin/users?q='+admin.user.id)).value;assert.equal(users.creditUnlimited,false);assert.equal(users.billingExempt,false);assert.equal(users.items[0].availableCredits,999999997);assert.equal(users.items[0].creditUnlimited,false);assert.equal(users.items[0].adminAdjustedCredits,1000000000);
 const vip=(await api(admin,'/v1/subscriptions')).value;assert.equal(vip.superAccess,true);assert.equal(vip.creditUnlimited,false);assert.equal(vip.billingExempt,false);
 const {liveWallet}=await tsImport('../src/payment-wallet.ts',import.meta.url),wallet=await liveWallet(env,admin.user,'zpay');
 assert.equal(wallet.balance,999999997);assert.equal(wallet.creditUnlimited,false);assert.equal(wallet.billingExempt,false);assert.equal(wallet.totalPurchased,0);
 assert.equal((await api(admin,'/v1/admin/usage?userId='+admin.user.id)).value.items[0].providerCostUsd,0.001);
});

test('Super concurrent replay grants one provider claim, changed fingerprints conflict and ordinary account cannot forge exemption',async()=>{
 const admin=await account('super'),value=input();await trustedGrant(admin);const results=await Promise.all(Array.from({length:6},()=>reserve(admin,value)));
 assert.equal(results.filter(r=>r.created).length,1);assert.equal(results.filter(r=>r.claimToken).length,1);
 await assert.rejects(reserve(admin,{...value,requestFingerprint:'b'.repeat(64)}),status(409));
 const ordinary=await account();await assert.rejects(reserve(ordinary,input(),{...ordinary.user,role:'super'}),status(402));
 const r=results.find(r=>r.claimToken);await assert.rejects(finish(ordinary,r),status(404));
 await assert.rejects(finish(admin,{...r,claimToken:randomUUID()}),status(404));
});

test('role transitions cannot duplicate generation or turn a frozen exempt execution into a debit',async()=>{
 const actor=await account('super'),target=await account();await adjustment(actor,target,10000);
 const v=input(),normal=await reserve(target,v);await DB.prepare("UPDATE users SET role='super' WHERE id=?").bind(target.user.id).run();
 const replay=await reserve(target,v);assert.equal(replay.created,false);assert.equal(replay.receipt.id,normal.receipt.id);assert.equal(replay.receipt.billingExempt,undefined);
 const exempt=await legacyExecution(target,input());await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(target.user.id).run();
 const repeated=await reserve(target,{requestId:exempt.receipt.requestId,operation:'chat',model:'x-ai/grok-4.6',requestFingerprint:'a'.repeat(64),inputTokenUpperBound:10000,maxOutputTokens:2048});
 assert.equal(repeated.created,false);assert.equal(repeated.receipt.billingExempt,true);
 const settled=await finish(target,exempt);assert.equal(settled.chargedCredits,0);
 await finish(target,normal);assert.ok((await balance(target)).total_spent>0);
 const q=input();await DB.prepare("UPDATE users SET role='super' WHERE id=?").bind(target.user.id).run();assert.notEqual((await quoteCreditUsage(request(target),env,target.user,q)).billingExempt,true);
 await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(target.user.id).run();const held=await reserve(target,q);assert.ok(held.receipt.reservedCredits>0);
});

test('historical exempt Super costs reconcile exactly once and expiry cannot late-settle; sessions and request fields still gate execution',async()=>{
 const admin=await account('super'),r=await legacyExecution(admin,input({operation:'memory'}));
 await finish(admin,r,{usage:undefined,generationId:'gen_isolated_super'});
 const pending=await getPendingCreditUsage(env,50);const own=pending.find(p=>p.reservationId===r.receipt.id);assert.ok(own);assert.deepEqual(own.costPolicy,policy);
 const recovered=await finalizeCreditUsage(env,{reservationId:own.reservationId,accountId:own.accountId,claimToken:own.claimToken,outcome:own.outcome,hasValidOutput:true,generationId:own.generationId,usage:{promptTokens:100,completionTokens:20,providerCostUsd:0.002}});assert.equal(recovered.providerCostUsd,0.002);assert.equal(recovered.chargedCredits,0);
 assert.equal((await finish(admin,r,{generationId:'gen_isolated_super',usage:{promptTokens:100,completionTokens:20,providerCostUsd:0.002}})).status,'settled');
 await assert.rejects(finish(admin,r,{usage:{promptTokens:100,completionTokens:20,providerCostUsd:0.003}}),status(409));
 const expired=await legacyExecution(admin);await DB.prepare('UPDATE super_generation_usage SET expires_at=? WHERE id=?').bind(Date.now()-1,expired.receipt.id).run();
 await releaseExpiredCreditUsage(env,admin.user.id);await assert.rejects(finish(admin,expired),status(409));
 await assert.rejects(reserve(admin,input({credits:0})),status(400));await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(admin.hash).run();
 await assert.rejects(reserve(admin),status(401));assert.equal((await balance(admin)).reserved_credits,0);
});

test('admin mutations recheck actor role/session at commit, reject injected authority and roll back audit with wallet on database failure',async()=>{
 for(const change of ['session','role']) {
  const actor=await account('super'),target=await account();let mutations=0;
  const proxy={prepare:sql=>DB.prepare(sql),async batch(statements){mutations++;if(mutations===1){
   if(change==='session')await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(actor.hash).run();
   else await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(actor.user.id).run();
  }return DB.batch(statements);}};
  const body={accountId:actor.user.id,requestId:randomUUID(),delta:100,reason:'提交权限检查'};
  const response=await fetchRequest(request(actor,`/v1/admin/users/${target.user.id}/credits`,body),{...env,DB:proxy});
  assert.equal(response.status,change==='session'?401:403);assert.equal((await balance(target)).balance,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM admin_audit WHERE actor_id=?').bind(actor.user.id).first()).n,0);
 }
 const admin=await account('super'),target=await account(),body={accountId:admin.user.id,requestId:randomUUID(),delta:100,reason:'事务故障检查'};
 const broken={prepare:sql=>DB.prepare(sql),batch:statements=>DB.batch([...statements,DB.prepare('SELECT * FROM intentionally_missing_admin_table')])};
 const response=await fetchRequest(request(admin,`/v1/admin/users/${target.user.id}/credits`,body),{...env,DB:broken});assert.equal(response.status,500);
 assert.equal((await balance(target)).balance,0);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM admin_audit WHERE actor_id=?').bind(admin.user.id).first()).n,0);
 for(const extra of [{role:'super'},{creditUnlimited:true},{billingExempt:true},{accountId:target.user.id}])assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/credits`,{...body,...extra})).status,400);
 assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/credits`,body)).status,201);
});

test('lost admin response is safely retried and held generation funds cannot be administratively overdrawn',async()=>{
 const admin=await account('super'),target=await account(),body={accountId:admin.user.id,requestId:randomUUID(),delta:100,reason:'丢失响应重试'};
 const lost={prepare:sql=>DB.prepare(sql),async batch(statements){await DB.batch(statements);throw Error('isolated lost response');}};
 assert.equal((await fetchRequest(request(admin,`/v1/admin/users/${target.user.id}/credits`,body),{...env,DB:lost})).status,500);
 assert.equal((await api(admin,`/v1/admin/users/${target.user.id}/credits`,body)).value.replayed,true);assert.equal((await balance(target)).balance,100);
 const r=await reserve(target,input({inputTokenUpperBound:1000,maxOutputTokens:512})),available=(await balance(target)).balance;
 assert.equal((await adjustment(admin,target,-available-1)).status,409);assert.equal((await adjustment(admin,target,-available)).status,201);
 assert.equal((await balance(target)).balance,0);await finish(target,r);assert.equal((await balance(target)).reserved_credits,0);
});

test('ordinary Super generation reservation rechecks sessions and remains billed when the role changes before commit',async()=>{
 for(const change of ['session','role']) {
  const admin=await account('super');await trustedGrant(admin);let batches=0;
  const proxy={prepare:sql=>DB.prepare(sql),async batch(statements){batches++;if(batches===1){if(change==='session')await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(admin.hash).run();else await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(admin.user.id).run();}return DB.batch(statements);}};
  if(change==='session')await assert.rejects(reserveCreditUsage(request(admin),{...env,DB:proxy},admin.user,input()),status(401));
  else {const held=await reserveCreditUsage(request(admin),{...env,DB:proxy},admin.user,input());assert.ok(held.receipt.reservedCredits>0);assert.notEqual(held.receipt.billingExempt,true);assert.equal((await finish(admin,held)).chargedCredits,3);}
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM super_generation_usage WHERE user_id=?').bind(admin.user.id).first()).n,0);
  assert.equal((await balance(admin)).reserved_credits,0);
 }
});

test('fair reconciliation schedule includes Super costs despite a full page of ambiguous regular pending usage',async()=>{
 const actor=await account('super'),ordinary=await account();await adjustment(actor,ordinary,100000);
 const normal=[];for(let i=0;i<12;i++){const r=await reserve(ordinary,input());await finish(ordinary,r,{usage:undefined,generationId:`gen_fair_regular_${i}`});normal.push(r);}
 const superRequest=await legacyExecution(actor);await finish(actor,superRequest,{usage:undefined,generationId:'gen_fair_super'});
 const first=await getPendingCreditUsage(env,10);assert.equal(first.length,10);
 const second=await getPendingCreditUsage(env,10);assert.ok([...first,...second].some(row=>row.reservationId===superRequest.receipt.id));
});

test('concurrent administrators cannot remove each other and leave the site without a Super account',async()=>{
 const a=await account('super'),b=await account('super');
 // Every audit linearizes its authorization and role mutation together. The
 // first demotion makes the other actor unauthorized for the opposing request.
 const results=await Promise.all([[a,b],[b,a]].map(([actor,target])=>api(actor,`/v1/admin/users/${target.user.id}/role`,{accountId:actor.user.id,requestId:randomUUID(),role:'user',reason:'并发权限检查'})));
 assert.equal(results.filter(r=>r.status===201).length,1);
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM users WHERE id IN (?,?) AND role='super' AND is_guest=0").bind(a.user.id,b.user.id).first()).n,1);
});

test('admin order and VIP lists read actual isolated metadata across live/test providers without checkout secrets',async()=>{
 const admin=await account('super'),target=await account(),now=Date.now();
 for(const mode of ['live','test']) {
  const order=`pay_${randomUUID()}`,event=`evt_${randomUUID()}`;
  await DB.batch([DB.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at,checkout_url) VALUES(?,?,?,'usd_1',100,100,?,'paid',?,?,?,'https://checkout.stripe.com/isolated')").bind(order,target.user.id,randomUUID(),mode,now,now,now),
   DB.prepare("INSERT INTO payment_events(event_id,event_type,order_id,processing_token,processed_at) VALUES(?,'checkout.session.completed',?,'isolated',?)").bind(event,order,now),
   DB.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',100,?)").bind(order,target.user.id,event,now)]);
 }
 const order=`sp_${randomUUID()}`,event=`sp_evt_${randomUUID()}`,period=`sub_${randomUUID()}`;
 await DB.batch([
  DB.prepare(`INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,duration_days,daily_credits,max_claims,timezone,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,status,created_at,updated_at,paid_at)
   VALUES(?,?,?,'vip_monthly',1,'隔离VIP',2800,30,100,30,'Asia/Shanghai','alipay',?,'isolated_merchant','123','隔离VIP','https://payment.example/secret','paid',?,?,?)`).bind(order,target.user.id,randomUUID(),Array.from(randomUUID().replaceAll('-','')).map(char=>parseInt(char,16)%10).join(''),now,now,now),
  DB.prepare("INSERT INTO subscription_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at) VALUES(?,'notify',?,'isolated_trade','isolated',?)").bind(event,order,now),
  DB.prepare('INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(period,target.user.id,order,event,now-1000,now-1000+30*86400000,now),
 ]);
 const orders=(await api(admin,'/v1/admin/orders?userId='+target.user.id)).value;assert.equal(orders.total,3);
 assert.deepEqual(new Set(orders.items.map(r=>r.provider)),new Set(['stripe','subscription']));assert.equal(orders.items.filter(r=>r.mode==='test').length,1);
 assert.ok(!JSON.stringify(orders).includes('isolated_merchant'));assert.ok(!JSON.stringify(orders).includes('checkout'));assert.ok(!JSON.stringify(orders).includes('isolated_trade'));
 const subscriptions=(await api(admin,'/v1/admin/subscriptions?userId='+target.user.id)).value;assert.equal(subscriptions.items[0].id,period);assert.equal(subscriptions.items[0].status,'active');assert.equal(subscriptions.items[0].dailyCredits,100);assert.equal(subscriptions.items[0].claimsCount,0);
 const users=(await api(admin,'/v1/admin/users?q='+target.user.id)).value;assert.equal(users.items[0].subscription.active,true);assert.equal(users.items[0].availableCredits,100);
 const overview=(await api(admin,'/v1/admin/overview')).value;assert.ok(overview.revenue.some(r=>r.provider==='stripe'&&r.mode==='test'&&r.amountMinor===100));
});

test('additive admin migration preserves all pre-existing rows, sequences and exact wallet facts',async()=>{
 const fresh=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',modules:true,script:'export default {fetch(){return new Response("isolated migration")}}',d1Databases:{DB:'admin-migration-preservation'}}));
 try {
  const database=await fresh.getD1Database('DB'),files=(await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  const apply=async file=>{const source=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');await database.batch(splitSqlStatements(source).filter(s=>s.trim()).map(sql=>database.prepare(sql)));};
  for(const file of files.filter(f=>f<'0022_admin_super.sql'))await apply(file);
  const user=randomUUID(),now=Date.now();await database.prepare('INSERT INTO users(id,nickname,is_guest,created_at) VALUES(?,\'迁移私人夹具\',0,?)').bind(user,now).run();
  for(const mode of ['live','test']) {
   const order=`pay_${randomUUID()}`,event=`evt_${randomUUID()}`;
   await database.batch([database.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at) VALUES(?,?,?,'usd_1',100,100,?,'paid',?,?,?)").bind(order,user,randomUUID(),mode,now,now,now),
    database.prepare("INSERT INTO payment_events(event_id,event_type,order_id,processing_token,processed_at) VALUES(?,'checkout.session.completed',?,'isolated',?)").bind(event,order,now),
    database.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',100,?)").bind(order,user,event,now)]);
  }
  const usage=`usage_${randomUUID()}`;
  await database.batch([database.prepare(`INSERT INTO credit_usage_requests(id,user_id,request_id,operation,model,request_fingerprint,price_revision,input_rate,output_rate,input_token_upper_bound,max_output_tokens,
   reserved_credits,authorization_hash,processing_token,status,charged_credits,has_valid_output,prompt_tokens,completion_tokens,outcome,created_at,expires_at,finalized_at)
   VALUES(?,?,?,'chat','isolated-model',?,1,3,9,100,100,10,?,'isolated','settled',3,1,100,100,'completed',?,?,?)`).bind(usage,user,randomUUID(),'a'.repeat(64),'b'.repeat(64),now,now+600000,now),
   database.prepare("INSERT INTO credit_usage_ledger(usage_id,user_id,kind,credits,outcome,created_at) VALUES(?,?,'charge',-3,'completed',?)").bind(usage,user,now)]);
  const tables=(await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
  const snapshot=async()=>{const facts={};for(const table of tables)facts[table]=(await database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results;return facts;};
  const before=await snapshot(),walletBefore=await database.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(user).first();assert.equal(walletBefore.balance,97);
  await apply('0022_admin_super.sql');assert.deepEqual(await snapshot(),before);assert.deepEqual(await database.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(user).first(),walletBefore);
  tables.push('admin_audit','admin_credit_adjustments','super_generation_usage');
  const beforeGrantMigration=await snapshot();await apply('0023_trusted_credit_grants.sql');
  assert.deepEqual(await snapshot(),beforeGrantMigration);assert.deepEqual(await database.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(user).first(),walletBefore);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants').first()).n,0);
  assert.equal((await database.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 } finally {await fresh.dispose();}
});


test('trusted grants are exact safe integers, keyed idempotently and never available as a public funding route',async()=>{
 const admin=await account('super'),key=`isolated-owner-${randomUUID()}`;
 await Promise.all(Array.from({length:6},()=>trustedGrant(admin,1000000000,key)));
 assert.equal((await balance(admin)).balance,1000000000);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants WHERE user_id=?').bind(admin.user.id).first()).n,1);
 await trustedGrant(admin,2000000000,key);assert.equal((await balance(admin)).balance,1000000000);
 for(const credits of [0,-1,1.5,1000000000001])await assert.rejects(DB.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(),admin.user.id,credits,'invalid isolated grant',Date.now()).run());
 await assert.rejects(DB.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(),randomUUID(),1,'nonexistent owner',Date.now()).run());
 for(const path of ['/v1/admin/grants','/v1/billing/grants','/v1/trusted-credit-grants'])assert.equal((await api(admin,path,{accountId:admin.user.id,grantKey:randomUUID(),credits:1000000000,reason:'caller grant'})).status,404);
 const value=input(),r=await reserve(admin,value),first=await finish(admin,r),duplicate=await finish(admin,r);
 assert.equal(first.chargedCredits,3);assert.deepEqual(duplicate,first);assert.equal((await balance(admin)).balance,999999997);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(r.receipt.id).first()).n,1);
});
