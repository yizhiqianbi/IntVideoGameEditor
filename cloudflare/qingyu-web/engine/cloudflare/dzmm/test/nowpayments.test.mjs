import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
const { handleNowpayments, canonicalNowpayments } = await tsImport('../src/nowpayments.ts', import.meta.url);
const { handleSubscriptions, readSubscriptions } = await tsImport('../src/subscriptions.ts', import.meta.url);
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const KEY='np_isolated_api_key', SECRET='np_isolated_ipn_secret', ADDRESS='T'+'1'.repeat(33), DAY=86400000;
const BASE=Date.parse('2026-10-13T00:00:00Z');
const migrationNames=(await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
let store,DB,nextPaymentId=1;
async function migrate(db,files=migrationNames){for(const f of files){const sql=await readFile(new URL('../migrations/'+f,import.meta.url),'utf8');await db.batch(splitSqlStatements(sql).filter(Boolean).map(s=>db.prepare(s)));}}
function memory(name){return new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',modules:true,script:'export default {fetch(){return new Response("isolated nowpayments store")}}',d1Databases:{DB:name}}));}
before(async()=>{store=memory('isolated-nowpayments');DB=await store.getD1Database('DB');await migrate(DB);});
after(async()=>{await store?.dispose();});
async function fixture(){const user={id:randomUUID(),email:`${randomUUID()}@np.example.test`,nickname:'原创 USDT 测试用户',isGuest:false,role:'user',version:0};const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
 await DB.batch([DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id,user.email,user.nickname,BASE),DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash,user.id,BASE+365*DAY,BASE)]);
 const env={DB,APP_ORIGINS:'https://qingyu.invalid',NOWPAYMENTS_ENABLED:'true',NOWPAYMENTS_API_KEY:KEY,NOWPAYMENTS_IPN_SECRET:SECRET,NOWPAYMENTS_PAY_CURRENCY:'usdttrc20',PAYMENTS_ACCEPTING_ENABLED:'false',PAYMENT_PROVIDER:'zpay',ZPAY_ENABLED:'true',ZPAY_PID:'12345678',ZPAY_KEY:'isolated_zpay_prior_key',ZPAY_ALIPAY_CHANNEL_ID:'123',SUBSCRIPTION_ENABLED:'true'};
 const api={calls:[],payments:new Map(),next:1,lose:false,bad:null,reject:false,minAmount:11.2,minFailure:null,minPair:{},async fetch(input,init={}){const url=new URL(input);assert.equal(url.origin,'https://api.nowpayments.io');assert.equal(new Headers(init.headers).get('x-api-key'),KEY);assert.equal(init.redirect,'manual');this.calls.push({path:url.pathname,method:init.method,query:url.search});
   if(url.pathname==='/v1/min-amount'){assert.equal(init.method,'GET');assert.deepEqual(Object.fromEntries(url.searchParams),{currency_from:'usdttrc20',currency_to:'usdttrc20',is_fixed_rate:'false',is_fee_paid_by_user:'false'});if(this.minFailure==='throw')throw new Error('private supplier error '+KEY);if(this.minFailure==='redirect')return new Response(null,{status:302,headers:{Location:'https://foreign.example'}});if(this.minFailure==='status')return Response.json({secret:KEY},{status:503});if(this.minFailure==='invalid-json')return new Response('private invalid '+KEY);return Response.json({min_amount:this.minAmount,...this.minPair});}
   if(url.pathname==='/v1/payment'&&init.method==='POST'){const b=JSON.parse(init.body);assert.equal(b.pay_amount,15);assert.equal(b.pay_currency,'usdttrc20');assert.equal(b.price_currency,'usd');assert.equal(b.price_amount,15);assert.equal(b.is_fixed_rate,false);assert.equal(b.is_fee_paid_by_user,false);assert.equal(b.ipn_callback_url,'https://qingyu.invalid/api/payments/nowpayments/ipn');if(this.reject)return Response.json({message:'isolated rejection'},{status:422});
    const payment={payment_id:String(nextPaymentId++),payment_status:'waiting',pay_address:ADDRESS,pay_amount:b.pay_amount,actually_paid:0,pay_currency:b.pay_currency,price_amount:b.price_amount,price_currency:b.price_currency,order_id:b.order_id,invoice_id:null};this.payments.set(payment.payment_id,payment);if(this.lose){this.lose=false;throw new Error('isolated provider response lost');}return Response.json({...payment,...this.bad});}
   const payment=this.payments.get(url.pathname.split('/').at(-1));assert.ok(payment,'mock requires original payment id');return Response.json(payment);
 }};return{user,token,hash,env,api};}
async function call(f,path,{method='GET',body,raw,user=f.user,env=f.env,headers={},options={}}={}){const request=new Request('https://qingyu.invalid'+path,{method,headers:{Cookie:'qingyu_session='+f.token,'CF-Connecting-IP':f.user.id,...(body||raw?{'Content-Type':'application/json'}:{}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))});let response;try{response=await handleNowpayments(request,env,user,{now:()=>BASE,nowpaymentsFetch:f.api.fetch.bind(f.api),...options});}catch(e){if(!Number.isInteger(e.status))throw e;response=Response.json({error:e.message,...e.details},{status:e.status});}assert.ok(response);return{status:response.status,data:await response.json()};}
function expect(result,...statuses){assert.ok(statuses.includes(result.status),JSON.stringify(result));return result.data;}
function checkout(f,extra={},args={}){return call(f,'/v1/nowpayments/checkout',{method:'POST',body:{accountId:f.user.id,planId:'vip_quarterly',planRevision:1,requestId:randomUUID(),provider:'nowpayments',mode:'live',payCurrency:'usdttrc20',...extra},...args});}
function signature(value){return createHmac('sha512',SECRET).update(JSON.stringify(canonicalNowpayments(value))).digest('hex');}
function notify(f,value,args={}){return call(f,'/v1/payments/nowpayments/ipn',{method:'POST',raw:JSON.stringify(value),user:null,headers:{'x-nowpayments-sig':signature(value)},...args});}
async function paid(f,order){const p=f.api.payments.get(order.paymentId);Object.assign(p,{payment_status:'finished',actually_paid:p.pay_amount,outcome_amount:14.95,outcome_currency:'usdttrc20'});return p;}

async function historicalMonthly(db,userId,api,{complete=false,unknown=false,ledgerId=1001}={}) {
 const orderId=`sp_${randomUUID()}`,requestId=randomUUID(),paymentId=String(nextPaymentId++),periodId=`sub_${randomUUID()}`,eventId=`np_old_${randomUUID()}`,claimId=`sc_${randomUUID()}`;
 const payment={payment_id:paymentId,payment_status:complete?'finished':'waiting',pay_address:ADDRESS,pay_amount:5,actually_paid:complete?5:0,pay_currency:'usdttrc20',price_amount:5,price_currency:'usd',order_id:orderId,invoice_id:null};
 const statements=[db.prepare("INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,currency,duration_days,daily_credits,max_claims,timezone,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,status,created_at,updated_at,paid_at,provider,amount_scale) VALUES(?,?,?,'vip_monthly',2,'晴屿历史月卡',5000000,'usdt',30,100,30,'Asia/Shanghai','usdt',?,NULL,NULL,'历史5 USDT / 30天',?,?,?, ?,?,'nowpayments',6)")
  .bind(orderId,userId,requestId,String(nextPaymentId).padStart(32,'2'),unknown?'':`https://qingyu.invalid/?np_order=${orderId}#recharge`,complete?'paid':'pending',BASE,BASE,complete?BASE:null),
  db.prepare("INSERT INTO nowpayments_invoices(order_id,payment_id,pay_currency,creation_state,creation_token,provider_status,pay_address,pay_amount,actually_paid,created_at,updated_at) VALUES(?,?,'usdttrc20',?, ?,?,?,?, ?,?,?)")
  .bind(orderId,unknown?null:paymentId,unknown?'unknown':'ready',randomUUID(),unknown?null:payment.payment_status,unknown?null:ADDRESS,unknown?null:'5',complete?'5':null,BASE,BASE)];
 if(!unknown)statements.push(db.prepare('INSERT INTO nowpayments_payment_bindings VALUES(?,?,?)').bind(paymentId,orderId,BASE));
 if(complete)statements.push(db.prepare("INSERT INTO subscription_events VALUES(?,'notify',?,?,?,?)").bind(eventId,orderId,'np_'+paymentId,randomUUID(),BASE),
  db.prepare('INSERT INTO subscription_periods VALUES(?,?,?,?,?,?,NULL,?)').bind(periodId,userId,orderId,eventId,BASE,BASE+30*DAY,BASE),
  db.prepare('INSERT INTO subscription_daily_claims VALUES(?,?,?,?,?,100,?,?)').bind(claimId,userId,periodId,randomUUID(),'2026-10-13',BASE,randomUUID()),
  db.prepare("INSERT INTO subscription_credit_ledger VALUES(?,?,?,'daily_grant',100,?)").bind(ledgerId,userId,claimId,BASE));
 await db.batch(statements);api?.payments.set(paymentId,payment);
 return {id:orderId,requestId,paymentId,periodId,payment};
}

test('late nonfinal IPN and incomplete finished replay retain confirmed payment metadata and one membership', async () => {
 const f=await fixture(), order=expect(await checkout(f),201).order, final=await paid(f,order);
 expect(await notify(f,final),200);
 const late={...final,payment_status:'waiting',actually_paid:0}; delete late.outcome_amount;delete late.outcome_currency;
 expect(await notify(f,late),200);
 const replay={...final}; delete replay.outcome_amount; replay.outcome_currency=null;
 expect(await notify(f,replay),200);
 const stored=await DB.prepare('SELECT provider_status,actually_paid,outcome_amount,outcome_currency FROM nowpayments_invoices WHERE order_id=?').bind(order.id).first();
 assert.deepEqual(stored,{provider_status:'finished',actually_paid:'15',outcome_amount:'14.95',outcome_currency:'usdttrc20'});
 assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,1);
});

test('explicit config fixed exact 15 USDT / 90 days / 90 claims manual renewal and disabled without credentials or confirmed TRC20 network',async()=>{const f=await fixture();const good=expect(await call(f,'/v1/nowpayments/config',{user:null}),200);assert.equal(good.enabled,true);assert.equal(good.autoRenew,false);assert.equal(good.plans[0].amountAtomic,15000000);assert.equal(good.plans[0].decimals,6);assert.equal(good.plans[0].currency,'usdt');assert.equal(good.plans[0].id,'vip_quarterly');assert.equal(good.plans[0].revision,1);assert.equal(good.plans[0].durationDays,90);assert.equal(good.plans[0].dailyCredits,500);assert.equal(good.plans[0].maxClaims,90);assert.doesNotMatch(JSON.stringify(good),new RegExp(KEY+'|'+SECRET));
 for(const changes of[{NOWPAYMENTS_ENABLED:undefined},{NOWPAYMENTS_ENABLED:'TRUE'},{NOWPAYMENTS_API_KEY:undefined},{NOWPAYMENTS_IPN_SECRET:undefined},{NOWPAYMENTS_PAY_CURRENCY:undefined},{NOWPAYMENTS_PAY_CURRENCY:'usdterc20'}]){const env={...f.env,...changes};assert.equal(expect(await call(f,'/v1/nowpayments/config',{env,user:null}),200).enabled,false);expect(await checkout(f,{}, {env}),503);}assert.equal(f.api.calls.length,0);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n,0);});

test('formal owner/session/revision/network guard rejects mutable price and foreign identities before provider or order',async()=>{const f=await fixture();for(const extra of[{amountAtomic:1},{price_amount:1},{planRevision:2},{payCurrency:'usdterc20'},{accountId:randomUUID()},{requestId:'invalid'}])expect(await checkout(f,extra),400,409);expect(await checkout(f,{}, {user:{...f.user,isGuest:true}}),403);await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run();expect(await checkout(f),401);assert.equal(f.api.calls.length,0);});

test('twenty concurrent same-request checkouts create exactly one direct payment with no forged hosted URL',async()=>{const f=await fixture(),requestId=randomUUID();const results=await Promise.all(Array.from({length:20},()=>checkout(f,{requestId})));results.forEach(r=>expect(r,200,201));assert.equal(f.api.calls.filter(c=>c.method==='POST').length,1);const recovered=expect(await call(f,'/v1/nowpayments/requests/'+requestId),200).order;assert.equal(recovered.status,'pending');assert.equal(recovered.payAmount,'15');assert.equal(recovered.payAddress,ADDRESS);assert.equal(recovered.membershipActivated,false);assert.equal(recovered.checkoutUrl,`https://qingyu.invalid/?np_order=${recovered.id}#recharge`);assert.equal(recovered.amountAtomic,15000000);assert.equal(recovered.currency,'usdt');assert.equal(recovered.decimals,6);});

test('unknown create response persists and neither same nor distinct request blindly rePOSTs; signed authoritative original can recover',async()=>{const f=await fixture(),requestId=randomUUID();f.api.lose=true;const result=expect(await checkout(f,{requestId}),201).order;assert.equal(result.status,'unknown');assert.equal(result.paymentId,null);assert.equal(result.payAddress,null);expect(await checkout(f,{requestId}),200);expect(await checkout(f),409);const recovery=expect(await call(f,'/v1/nowpayments/requests/'+requestId),200).order;assert.equal(recovery.status,'unknown');assert.equal(f.api.calls.filter(c=>c.method==='POST').length,1);const payment=[...f.api.payments.values()][0];Object.assign(payment,{payment_status:'finished',actually_paid:15});expect(await notify(f,payment),200);const restored=expect(await call(f,'/v1/nowpayments/requests/'+requestId),200).order;assert.equal(restored.membershipActivated,true);assert.equal(restored.paymentId,payment.payment_id);});

test('provider definite rejection is failed and bad pay amount/address never exposes a cashier or creates entitlement',async()=>{for(const bad of[{pay_amount:15.1},{pay_currency:'usdterc20'},{pay_address:'https://wrong.example'}, {price_currency:'eur'}]){const f=await fixture();f.api.bad=bad;const o=expect(await checkout(f),201).order;assert.equal(o.status,'unknown');assert.equal(o.checkoutUrl,null);assert.equal(o.payAddress,null);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,0);}const f=await fixture();f.api.reject=true;const o=expect(await checkout(f),201).order;assert.equal(o.status,'failed');});

test('SHA512 IPN recursively sorts objects preserving arrays and rejects bad signatures before provider calls',async()=>{assert.equal(JSON.stringify(canonicalNowpayments({z:[{z:2,a:1},0],a:{b:3,a:2}})),'{"a":{"a":2,"b":3},"z":[{"a":1,"z":2},0]}');const f=await fixture(),order=expect(await checkout(f),201).order,payment=await paid(f,order),before=f.api.calls.length;expect(await notify(f,payment,{headers:{'x-nowpayments-sig':'0'.repeat(128)}}),400);expect(await call(f,'/v1/payments/nowpayments/ipn',{method:'POST',raw:'[]',headers:{'x-nowpayments-sig':'0'.repeat(128)}}),400);assert.equal(f.api.calls.length,before);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,0);});

test('signed incorrect identity amount currency network and partial statuses never grant even when provider later finished',async()=>{const f=await fixture(),o=expect(await checkout(f),201).order,p=await paid(f,o);for(const change of[{order_id:`sp_${randomUUID()}`},{pay_amount:14.99},{price_amount:16},{price_currency:'usdt'},{pay_currency:'usdterc20'},{pay_address:'T'+'2'.repeat(33)},{actually_paid:14.99}])expect(await notify(f,{...p,...change}),400);for(const status of['waiting','confirming','confirmed','sending','partially_paid']){expect(await notify(f,{...p,payment_status:status}),200);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,0);}Object.assign(p,{payment_status:'partially_paid',actually_paid:14.99});expect(await notify(f,p),200);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,0);});

test('verified finished concurrent IPN/query grants one period; merchant gate pause preserves fulfillment and daily Credit',async()=>{const f=await fixture(),o=expect(await checkout(f),201).order,p=await paid(f,o),env={...f.env,NOWPAYMENTS_ENABLED:'false'};const results=await Promise.all(Array.from({length:20},(_,i)=>i%2?notify(f,p,{env}):call(f,'/v1/nowpayments/orders/'+o.id,{env})));results.forEach(r=>expect(r,200));const overview=await readSubscriptions(env,f.user,BASE);assert.equal(overview.subscriptions.length,1);assert.equal(overview.balance,0);const period=overview.subscriptions[0];assert.equal(period.expiresAt-period.startsAt,90*DAY);const req=new Request('https://qingyu.invalid/v1/subscriptions/checkin',{method:'POST',headers:{Cookie:'qingyu_session='+f.token,'Content-Type':'application/json','CF-Connecting-IP':f.user.id},body:JSON.stringify({accountId:f.user.id,subscriptionId:period.id,requestId:randomUUID(),provider:'zpay',mode:'live'})});const response=await handleSubscriptions(req,env,f.user,{now:()=>BASE});assert.equal(response.status,201);assert.equal((await response.json()).balance,500);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscription_periods WHERE order_id=?').bind(o.id).first()).n,1);});

test('distinct successful manual renewals queue periods, isolate owners and preserve USDT units in actual admin reads',async()=>{const f=await fixture(),a=expect(await checkout(f),201).order;expect(await notify(f,await paid(f,a)),200);const b=expect(await checkout(f),201).order;expect(await notify(f,await paid(f,b)),200);const overview=await readSubscriptions(f.env,f.user,BASE);assert.equal(overview.subscriptions.length,2);assert.equal(overview.subscriptions[1].startsAt,overview.subscriptions[0].expiresAt);const other=await fixture();expect(await call(other,'/v1/nowpayments/orders/'+a.id),404);assert.equal(expect(await call(other,'/v1/nowpayments/requests/'+a.requestId),200).order,null);
 await DB.prepare("UPDATE users SET role='super' WHERE id=?").bind(f.user.id).run();
 const admin=async path=>{const res=await fetchRequest(new Request('https://qingyu.invalid'+path,{headers:{Cookie:'qingyu_session='+f.token}}),f.env);assert.equal(res.status,200);return res.json();};
 const orders=await admin('/v1/admin/orders?userId='+f.user.id);assert.equal(orders.items.length,2);orders.items.forEach(o=>{assert.equal(o.amountMinor,15000000);assert.equal(o.amountScale,6);assert.equal(o.currency,'usdt');assert.equal(o.provider,'nowpayments');});
 const summary=await admin('/v1/admin/overview'),usdt=summary.revenue.find(r=>r.currency==='usdt'&&r.provider==='nowpayments');assert.ok(usdt);assert.equal(usdt.amountScale,6);assert.equal(usdt.amountMinor,usdt.paidOrders*15000000);assert.equal(summary.revenue.some(r=>r.currency==='cny'&&r.provider==='nowpayments'),false);
});

test('one provider payment cannot fulfill two local orders and forged API facts cannot activate',async()=>{const f=await fixture(),a=expect(await checkout(f),201).order,b=expect(await checkout(f),201).order,p=await paid(f,a);expect(await notify(f,{...p,order_id:b.id}),400);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,0);const saved=p.order_id;p.order_id=b.id;expect(await call(f,'/v1/nowpayments/orders/'+a.id),400);p.order_id=saved;expect(await notify(f,p),200);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,1);});

test('actual app keeps origin checks except the exact signed IPN and raw bad callbacks cannot touch orders',async()=>{const f=await fixture();const req=new Request('https://qingyu.invalid/v1/nowpayments/checkout',{method:'POST',headers:{Origin:'https://foreign.example',Cookie:'qingyu_session='+f.token,'Content-Type':'application/json'},body:'{}'});assert.equal((await fetchRequest(req,f.env)).status,403);const ipn=new Request('https://qingyu.invalid/v1/payments/nowpayments/ipn',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json','x-nowpayments-sig':'0'.repeat(128)},body:'{}'});assert.equal((await fetchRequest(ipn,f.env)).status,400);});

test('migration retains historical CNY rights all ledger rows/sequence and balance with FKs and demo guards enforced',async()=>{const local=memory('np-migration');try{const db=await local.getD1Database('DB');await migrate(db,migrationNames.filter(n=>n<'0037'));const u=randomUUID(),o=`sp_${randomUUID()}`,period=`sub_${randomUUID()}`,claim=`sc_${randomUUID()}`;await db.batch([
 db.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(u,'original-migration@example.test','历史原创会员',BASE),
 db.prepare("INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,duration_days,daily_credits,max_claims,timezone,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,status,created_at,updated_at,paid_at) VALUES(?,?,?,'old_vip',1,'历史月卡',2800,30,100,30,'Asia/Shanghai','alipay',?,'123','456','历史会员','https://qingyu.invalid/old','paid',?,?,?)").bind(o,u,randomUUID(),'1'.repeat(32),BASE,BASE,BASE),
 db.prepare("INSERT INTO subscription_events VALUES('old_event','notify',?,'old_trade','old_token',?)").bind(o,BASE),
 db.prepare("INSERT INTO subscription_periods VALUES(?,?,?,'old_event',?,?,NULL,?)").bind(period,u,o,BASE,BASE+30*DAY,BASE),
 db.prepare('INSERT INTO subscription_daily_claims VALUES(?,?,?,?,?,100,?,?)').bind(claim,u,period,randomUUID(),'2026-10-13',BASE,'old_claim_token'),
 db.prepare("INSERT INTO subscription_credit_ledger(id,user_id,claim_id,kind,credits,created_at) VALUES(999,?,?,'daily_grant',100,?)").bind(u,claim,BASE),
 db.prepare("UPDATE sqlite_sequence SET seq=1001 WHERE name='subscription_credit_ledger'")]);
 const tables=['subscription_orders','subscription_events','subscription_periods','subscription_daily_claims','subscription_credit_ledger','zpay_payment_bindings'];const beforeRows=await Promise.all(tables.map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()));const balanceBefore=await db.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(u).first();await migrate(db,['0037_nowpayments_membership.sql']);
 for(let i=0;i<tables.length;i++){const rows=(await db.prepare('SELECT * FROM '+tables[i]+' ORDER BY 1').all()).results;if(tables[i]==='subscription_orders')rows.forEach(row=>{assert.equal(row.provider,'zpay');assert.equal(row.amount_scale,2);delete row.provider;delete row.amount_scale;});assert.deepEqual(rows,beforeRows[i].results);}
 assert.deepEqual(await db.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(u).first(),balanceBefore);assert.equal((await db.prepare("SELECT seq FROM sqlite_sequence WHERE name='subscription_credit_ledger'").first()).seq,1001);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name IN ('forum_demo_deny_subscription_orders_insert','forum_demo_deny_subscription_credit_ledger_update')").first()).n,2);
 }finally{await local.dispose();}});


test('live minimum uses exact current TRC20 payout route; above-plan decimal precision fails before provider POST or order storage',async()=>{
 const f=await fixture(),requestId=randomUUID();f.api.minAmount='15.000000000000000001';
 const blocked=expect(await checkout(f,{requestId}),503);assert.equal(blocked.code,'nowpayments_minimum_exceeds_plan');assert.equal(blocked.minimumAmount,f.api.minAmount);assert.equal(blocked.payCurrency,'usdttrc20');
 assert.equal(f.api.calls.filter(c=>c.method==='POST').length,0);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n,0);
 assert.equal(expect(await call(f,'/v1/nowpayments/requests/'+requestId),200).order,null);
 f.api.minAmount='15.000000000000000000';const receipt=expect(await checkout(f,{requestId}),201).order;assert.equal(receipt.amountAtomic,15000000);assert.equal(receipt.durationDays,90);assert.equal(receipt.dailyCredits,500);assert.equal(receipt.maxClaims,90);assert.equal(receipt.timezone,'Asia/Shanghai');
 assert.equal(f.api.calls.filter(c=>c.path==='/v1/min-amount').length,2);assert.equal(f.api.calls.filter(c=>c.method==='POST').length,1);
});

test('unavailable redirect invalid and nonpositive minimum responses fail closed without raw secrets, invoices or local orders',async()=>{
 for(const bad of[undefined,null,true,[],{},0,-1,'0','-1','NaN','Infinity','1e1','01','15x','15.','15.0000000000000000001',' 11.2']){
  const f=await fixture();f.api.minAmount=bad;const result=expect(await checkout(f),503);assert.equal(result.code,'nowpayments_minimum_unavailable');assert.doesNotMatch(JSON.stringify(result),new RegExp(KEY+'|'+SECRET));
  assert.equal(f.api.calls.length,1);assert.equal(f.api.calls[0].path,'/v1/min-amount');assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n,0);
 }
 for(const failure of['throw','redirect','status','invalid-json']){
  const f=await fixture();f.api.minFailure=failure;const result=expect(await checkout(f),503);assert.equal(result.code,'nowpayments_minimum_unavailable');assert.doesNotMatch(JSON.stringify(result),new RegExp(KEY+'|'+SECRET+'|private'));
  assert.equal(f.api.calls.filter(c=>c.method==='POST').length,0);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM nowpayments_invoices i JOIN subscription_orders o ON o.id=i.order_id WHERE o.user_id=?').bind(f.user.id).first()).n,0);
 }
});

test('existing ready and unknown quarterly requests recover unchanged even when minimum rises or becomes unavailable',async()=>{
 for(const lose of[false,true]){const f=await fixture(),requestId=randomUUID();f.api.lose=lose;const created=expect(await checkout(f,{requestId}),201).order;const calls=f.api.calls.length;f.api.minAmount='999';f.api.minFailure='throw';
  const restored=expect(await checkout(f,{requestId}),200).order;assert.deepEqual(restored,created);assert.equal(f.api.calls.length,calls);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n,1);
 }
});

test('historical 5 USDT / 30-day ready and unknown requests retain snapshot and settle once after quarterly catalogue upgrade',async()=>{
 for(const unknown of[false,true]){const f=await fixture(),old=await historicalMonthly(DB,f.user.id,f.api,{unknown});f.api.minFailure='throw';
  const restored=expect(await checkout(f,{requestId:old.requestId,planId:'vip_monthly',planRevision:2}),200).order;assert.equal(restored.amountAtomic,5000000);assert.equal(restored.durationDays,30);assert.equal(restored.maxClaims,30);assert.equal(restored.dailyCredits,100);assert.equal(restored.planId,'vip_monthly');assert.equal(f.api.calls.length,0);
  expect(await checkout(f,{requestId:old.requestId}),409);assert.equal(f.api.calls.length,0);
  expect(await notify(f,{...old.payment,payment_status:'finished',pay_amount:15,actually_paid:15}),400);assert.equal((await readSubscriptions(f.env,f.user,BASE)).subscriptions.length,0);
  Object.assign(old.payment,{payment_status:'finished',actually_paid:5});expect(await notify(f,old.payment),200);expect(await notify(f,old.payment),200);
  const overview=await readSubscriptions(f.env,f.user,BASE);assert.equal(overview.subscriptions.length,1);const period=overview.subscriptions[0];assert.equal(period.expiresAt-period.startsAt,30*DAY);assert.equal(period.maxClaims,30);assert.equal(period.dailyCredits,100);
  const receipt=expect(await call(f,'/v1/nowpayments/requests/'+old.requestId),200).order;assert.equal(receipt.amountAtomic,5000000);assert.equal(receipt.payAmount,'5');assert.equal(receipt.membershipActivated,true);assert.equal(f.api.calls.filter(c=>c.method==='POST').length,0);
 }
});

test('0038 D1 migration atomically preserves complete CNY and historical USDT graph, FK integrity and ledger high-water sequence',async()=>{
 const local=memory('np-quarterly-migration');try{const db=await local.getD1Database('DB');await migrate(db,migrationNames.filter(n=>n<'0037'));
  const u=randomUUID(),o=`sp_${randomUUID()}`,period=`sub_${randomUUID()}`,claim=`sc_${randomUUID()}`;await db.batch([
   db.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(u,'quarterly-migration@example.test','原创迁移会员',BASE),
   db.prepare("INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,duration_days,daily_credits,max_claims,timezone,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,status,created_at,updated_at,paid_at,provider_trade_no) VALUES(?,?,?,'old_vip',1,'历史人民币月卡',2800,30,100,30,'Asia/Shanghai','alipay',?,'123','456','历史会员','https://qingyu.invalid/old','paid',?,?,?,'old_trade')").bind(o,u,randomUUID(),'1'.repeat(32),BASE,BASE,BASE),
   db.prepare("INSERT INTO subscription_events VALUES('cny_event','notify',?,'old_trade','old_token',?)").bind(o,BASE),
   db.prepare("INSERT INTO subscription_periods VALUES(?,?,?,'cny_event',?,?,NULL,?)").bind(period,u,o,BASE,BASE+30*DAY,BASE),
   db.prepare('INSERT INTO subscription_daily_claims VALUES(?,?,?,?,?,100,?,?)').bind(claim,u,period,randomUUID(),'2026-10-13',BASE,'cny_claim_token'),
   db.prepare("INSERT INTO subscription_credit_ledger(id,user_id,claim_id,kind,credits,created_at) VALUES(999,?,?,'daily_grant',100,?)").bind(u,claim,BASE),
   db.prepare("INSERT INTO zpay_payment_bindings(out_trade_no,merchant_pid,provider_trade_no,subscription_order_id) VALUES(?,'123','old_trade',?)").bind('1'.repeat(32),o)]);
  await migrate(db,['0037_nowpayments_membership.sql']);
  const u2=randomUUID();await db.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(u2,'old-usdt-migration@example.test','原创历史USDT会员',BASE).run();
  await historicalMonthly(db,u2,null,{complete:true,ledgerId:1005});await historicalMonthly(db,u2,null,{unknown:true});await db.prepare("UPDATE sqlite_sequence SET seq=2000 WHERE name='subscription_credit_ledger'").run();
  const tables=['subscription_orders','subscription_events','subscription_periods','subscription_daily_claims','subscription_credit_ledger','zpay_payment_bindings','nowpayments_invoices','nowpayments_payment_bindings'];
  const beforeRows=await Promise.all(tables.map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()));const balances=(await db.prepare('SELECT * FROM credit_usage_balances ORDER BY user_id').all()).results;
  // Force a failure after the entire swap to verify D1 batch rollback keeps the
  // old graph, views and sequence usable instead of leaving a half migration.
  const quarterSql=await readFile(new URL('../migrations/0038_nowpayments_quarterly_membership.sql',import.meta.url),'utf8');
  await assert.rejects(db.batch([...splitSqlStatements(quarterSql).filter(Boolean).map(sql=>db.prepare(sql)),db.prepare("INSERT INTO nowpayments_payment_bindings VALUES('bad','nonexistent',0)")]),/FOREIGN KEY/);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare('SELECT * FROM '+tables[i]+' ORDER BY 1').all()).results,beforeRows[i].results,tables[i]+' rollback');
  assert.equal((await db.prepare("SELECT seq FROM sqlite_sequence WHERE name='subscription_credit_ledger'").first()).seq,2000);
  assert.deepEqual((await db.prepare('SELECT * FROM credit_usage_balances ORDER BY user_id').all()).results,balances);
  await migrate(db,['0038_nowpayments_quarterly_membership.sql']);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare('SELECT * FROM '+tables[i]+' ORDER BY 1').all()).results,beforeRows[i].results,tables[i]);
  assert.deepEqual((await db.prepare('SELECT * FROM credit_usage_balances ORDER BY user_id').all()).results,balances);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal((await db.prepare("SELECT seq FROM sqlite_sequence WHERE name='subscription_credit_ledger'").first()).seq,2000);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name IN ('forum_demo_deny_subscription_orders_insert','forum_demo_deny_subscription_credit_ledger_update','subscription_periods_duration_insert','subscription_periods_duration_update')").first()).n,4);
  await assert.rejects(db.prepare('UPDATE subscription_periods SET expires_at=starts_at+7776000000 WHERE id=?').bind(period).run(),/immutable order duration/);
 }finally{await local.dispose();}
});

test('quarterly entitlement gives the 90th daily configured Credit once, keeps maximum at 90 and expires at the 90-day boundary',async()=>{
 const f=await fixture(),order=expect(await checkout(f),201).order;expect(await notify(f,await paid(f,order)),200);
 const period=(await readSubscriptions(f.env,f.user,BASE)).subscriptions[0];const statements=[];
 for(let day=0;day<89;day++){
  const claimedAt=BASE+day*DAY,claimId=`sc_${randomUUID()}`,dayKey=new Date(claimedAt+8*3600000).toISOString().slice(0,10);
  statements.push(DB.prepare('INSERT INTO subscription_daily_claims VALUES(?,?,?,?,?,500,?,?)').bind(claimId,f.user.id,period.id,randomUUID(),dayKey,claimedAt,randomUUID()),
   DB.prepare("INSERT INTO subscription_credit_ledger(user_id,claim_id,kind,credits,created_at) VALUES(?,?,'daily_grant',500,?)").bind(f.user.id,claimId,claimedAt));
 }
 await DB.batch(statements);
 const claim=async(at)=>{
  const request=new Request('https://qingyu.invalid/v1/subscriptions/checkin',{method:'POST',headers:{Cookie:'qingyu_session='+f.token,'Content-Type':'application/json','CF-Connecting-IP':f.user.id},body:JSON.stringify({accountId:f.user.id,subscriptionId:period.id,requestId:randomUUID(),provider:'zpay',mode:'live'})});
  try {const response=await handleSubscriptions(request,f.env,f.user,{now:()=>at});return{status:response.status,data:await response.json()};}
  catch(error){if(!Number.isInteger(error.status))throw error;return{status:error.status,data:{error:error.message,...error.details}};}
 };
 const last=expect(await claim(BASE+89*DAY),201);assert.equal(last.balance,45000);assert.equal(last.subscriptions[0].claimsCount,90);assert.equal(last.subscriptions[0].maxClaims,90);assert.equal(last.checkin.claimable,false);
 const duplicate=expect(await claim(BASE+89*DAY),200);assert.equal(duplicate.balance,45000);assert.equal(duplicate.subscriptions[0].claimsCount,90);
 expect(await claim(BASE+90*DAY),409);const expired=await readSubscriptions(f.env,f.user,BASE+90*DAY);assert.equal(expired.subscriptions[0].status,'expired');assert.equal(expired.balance,45000);assert.equal(expired.checkin.claimable,false);
});


test('minimum response optional currency pair must exactly match the requested TRC20 route when present',async()=>{
 for(const minPair of[{currency_from:'usdterc20'},{currency_to:'usdterc20'},{currency_from:null},{currency_to:15},{currency_from:['usdttrc20']},{currency_to:{currency:'usdttrc20'}}]){
  const f=await fixture();f.api.minPair=minPair;const result=expect(await checkout(f),503);assert.equal(result.code,'nowpayments_minimum_unavailable');
  assert.equal(f.api.calls.length,1);assert.equal(f.api.calls[0].path,'/v1/min-amount');assert.equal(f.api.calls.filter(c=>c.method==='POST').length,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n,0);
 }
 const f=await fixture();f.api.minPair={currency_from:'usdttrc20',currency_to:'usdttrc20'};expect(await checkout(f),201);assert.equal(f.api.calls.filter(c=>c.method==='POST').length,1);
});
