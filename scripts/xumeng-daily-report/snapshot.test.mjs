import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSnapshotSql } from './snapshot.mjs';

const migrationDir = fileURLToPath(new URL('../../cloudflare/dzmm/migrations/', import.meta.url));
const startMs = Date.parse('2026-10-10T00:00:00+08:00');
const endMs = startMs + 86400000;
const snapshotMs = endMs + 9 * 3600000;
const period = { startMs, endMs, snapshotMs };
const prior = startMs - 86400000;
let serial = 0;
const uid = () => `00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const trade = () => String(++serial).padStart(32,'0');

function insert(db, table, fields) {
  const keys = Object.keys(fields);
  db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(fields));
}
function database() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrationDir).filter(f => /^\d+.*\.sql$/.test(f)).sort()) db.exec(readFileSync(`${migrationDir}/${file}`,'utf8'));
  for (const [id, guest, role, createdAt] of [['ordinary',0,'user',prior],['second',0,'user',prior],['guest',1,'user',prior],['super',0,'super',prior]]) {
    insert(db,'users',{id,nickname:`Fixture ${id}`,is_guest:guest,role,created_at:createdAt});
  }
  return db;
}
function snapshot(db) {
  const rows = db.prepare(buildSnapshotSql(period)).all();
  assert.equal(rows.length,1);
  assert.deepEqual(Object.keys(rows[0]),['users','subscriptions','payments','credits','modelUsage','generation','community','creation','feedback']);
  return Object.fromEntries(Object.entries(rows[0]).map(([key,value]) => [key,JSON.parse(value)]));
}
function stripe(db, { id = uid(), user = 'ordinary', amount = 100, paidAt = startMs, createdAt = prior, mode = 'live', status = 'paid', refunded = 0 } = {}) {
  insert(db,'payment_orders',{id,user_id:user,request_id:uid(),package_id:`usd_${amount/100}`,amount_minor:amount,currency:'usd',credits:amount,mode,status,
    refunded_amount_minor:refunded,refunded_credits:refunded,created_at:createdAt,updated_at:startMs,paid_at:paidAt});
  return id;
}
function zpay(db, { id = uid(), user = 'ordinary', paidAt = startMs, createdAt = prior, status = 'paid', refunded = 0 } = {}) {
  insert(db,'zpay_orders',{id,user_id:user,request_id:uid(),package_id:'cny_28',amount_minor:2800,currency:'cny',credits:2800,method:'alipay',out_trade_no:trade(),
    merchant_pid:'fixture',channel_id:'fixture',payment_name:'Fixture',checkout_url:'https://fixture.invalid/',status,refunded_amount_minor:refunded,refunded_credits:refunded,
    created_at:createdAt,updated_at:startMs,paid_at:paidAt});
  return id;
}
function subscription(db, { id = uid(), user = 'ordinary', paidAt = startMs, startsAt = startMs, status = 'paid', revoked = null } = {}) {
  insert(db,'subscription_orders',{id,user_id:user,request_id:uid(),plan_id:'vip_monthly',plan_revision:1,label:'Fixture VIP',amount_minor:2800,currency:'cny',duration_days:30,
    daily_credits:100,max_claims:30,timezone:'Asia/Shanghai',method:'alipay',out_trade_no:trade(),merchant_pid:'fixture',channel_id:'fixture',payment_name:'Fixture',
    checkout_url:'https://fixture.invalid/',status,created_at:paidAt??startMs,updated_at:startMs,paid_at:paidAt});
  const event = uid();
  insert(db,'subscription_events',{event_id:event,event_type:'notify',order_id:id,provider_trade_no:trade(),processing_token:'fixture',verified_at:paidAt??startMs});
  const rights = uid();
  insert(db,'subscription_periods',{id:rights,user_id:user,order_id:id,source_event_id:event,starts_at:startsAt,expires_at:startsAt+2592000000,revoked_at:revoked,created_at:paidAt??startMs});
  return { id,rights };
}
function usdtSubscription(db, { id = uid(), user = 'ordinary', paidAt = startMs, status = 'paid' } = {}) {
  insert(db,'subscription_orders',{id,user_id:user,request_id:uid(),plan_id:'vip_monthly',plan_revision:1,label:'Original USDT VIP',
    provider:'nowpayments',amount_minor:5_000_000,amount_scale:6,currency:'usdt',duration_days:30,daily_credits:100,max_claims:30,
    timezone:'Asia/Shanghai',method:'usdt',out_trade_no:trade(),merchant_pid:null,channel_id:null,payment_name:'Original USDT VIP',
    checkout_url:'https://fixture.invalid/',status,created_at:startMs,updated_at:startMs,paid_at:paidAt});
  return id;
}
function grant(db, user = 'ordinary', credits = 1500, at = startMs, reason = 'new_signup') {
  insert(db,'trusted_credit_grants',{grant_key:reason==='new_signup'?`new_signup:${user}`:uid(),user_id:user,credits,reason,created_at:at});
}
function usage(db, { user = 'ordinary', status = 'settled', at = startMs, final = startMs+1000, cost = 0.01, reserved = 20, charge = 10, tokens = 100 } = {}) {
  const id = uid();
  const settled = status==='settled', released = status==='released', pending = status==='pending';
  insert(db,'credit_usage_requests',{id,user_id:user,request_id:uid(),operation:'chat',model:'fixture-model',request_fingerprint:'a'.repeat(64),price_revision:1,input_rate:1,output_rate:1,
    input_token_upper_bound:100,max_output_tokens:100,reserved_credits:reserved,authorization_hash:'b'.repeat(64),status,charged_credits:settled?charge:0,
    has_valid_output:settled||pending?1:0,prompt_tokens:settled?tokens:null,completion_tokens:settled?tokens:null,outcome:settled||pending?'completed':released?'failed':null,
    release_reason:released?'no_valid_output':null,processing_token:'fixture',created_at:at,expires_at:at+600000,finalized_at:settled||released?final:null,
    pending_at:pending?at:null,reconciliation_token:pending?'fixture':null,provider_cost_usd:cost});
  if (settled||released) insert(db,'credit_usage_ledger',{usage_id:id,user_id:user,kind:settled?'charge':'release',credits:settled?-charge:0,outcome:settled?'completed':'failed',created_at:final});
  return id;
}
function media(db, { user='ordinary', status='ready', at=startMs, final=startMs+1000, charge=30, cost=0.1 } = {}) {
  const id=uid();
  insert(db,'generation_jobs',{id,user_id:user,request_id:uid(),request_fingerprint:'a'.repeat(64),kind:'image',model_id:'fixture-image',prompt:'Ordinary fixture',aspect_ratio:'1:1',
    duration:null,status,policy_json:'{}',reserved_credits:100,charged_credits:status==='ready'?charge:0,provider_cost_usd:cost,cost_basis:status==='ready'?'frozen_sku':null,
    processing_token:'fixture',object_key:status==='ready'?'fixture.png':null,mime_type:status==='ready'?'image/png':null,byte_length:status==='ready'?100:null,
    created_at:at,updated_at:final,expires_at:at+1800000,finalized_at:status==='ready'?final:null});
  if(status==='ready')insert(db,'generation_credit_ledger',{job_id:id,user_id:user,kind:'charge',credits:-charge,created_at:final});
  return id;
}

test('single SELECT runs against all real migrations; empty metrics are numeric and unavailable capabilities stay null', () => {
  const db=database();
  const data=snapshot(db);
  assert.equal(data.users.ordinaryRegisteredTotal,2);
  assert.equal(data.users.guestTotal,1);
  assert.equal(data.users.superTotal,1);
  assert.equal(data.subscriptions.activeVipUsersCurrent,0);
  assert.equal(data.subscriptions.refundCashflowInDay,null);
  assert.equal(data.subscriptions.automaticRenewal,false);
  assert.equal(data.generation.live,null);
  assert.deepEqual(data.payments.paid,[]);
  assert.equal(data.credits.currentAvailableCredits,0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  db.close();
});

test('new registration uses one-time atomic grant including old guest conversion; time interval is half-open', () => {
  const db=database();
  db.prepare("UPDATE users SET is_guest=0 WHERE id='guest'").run();
  grant(db,'guest',1500,startMs);
  grant(db,'ordinary',1500,endMs);
  grant(db,'second',99,startMs+1,'maintenance');
  grant(db,'super',999999,startMs,'owner');
  const data=snapshot(db);
  assert.equal(data.users.ordinaryRegisteredTotal,3);
  assert.equal(data.users.newRegistrationsByGrant,1);
  assert.equal(data.users.legacyAccountsCreatedInDay,0);
  assert.equal(data.users.activeUsersByRecordedActions,1);
  assert.deepEqual(data.credits.grants,[{source:'operator_grant',count:1,credits:99},{source:'signup_gift',count:1,credits:1500}]);
  assert.equal(data.credits.super.currentAvailableCredits,999999);
  db.close();
});

test('live paid receipts use paid_at, currencies and super are separate, refunded receipts remain gross and callbacks do not duplicate', () => {
  const db=database();
  const paid=stripe(db,{paidAt:startMs});
  stripe(db,{mode:'test',paidAt:startMs});
  stripe(db,{user:'super',amount:500,paidAt:startMs});
  stripe(db,{user:'guest',paidAt:startMs});
  stripe(db,{paidAt:endMs});
  stripe(db,{paidAt:startMs-1});
  stripe(db,{status:'pending',paidAt:null,createdAt:startMs});
  const refunded=stripe(db,{amount:500,status:'partially_refunded',refunded:100,paidAt:startMs+1});
  for(let i=0;i<2;i++)insert(db,'payment_events',{event_id:uid(),event_type:'payment',order_id:paid,processing_token:'fixture',processed_at:startMs+i});
  insert(db,'payment_refunds',{refund_id:uid(),order_id:refunded,amount_minor:100,currency:'usd',succeeded_seen:1,failed_seen:0,updated_at:startMs});
  insert(db,'payment_refunds',{refund_id:uid(),order_id:paid,amount_minor:100,currency:'usd',succeeded_seen:1,failed_seen:1,updated_at:startMs});
  const z=zpay(db,{status:'refunded',refunded:2800});
  insert(db,'zpay_refund_state',{refund_id:uid(),order_id:z,amount_minor:2800,status:'confirmed',verification_reference:'fixture',verified_at:startMs,created_at:prior,updated_at:startMs});
  subscription(db,{startsAt:startMs});
  subscription(db,{startsAt:startMs,status:'refunded',paidAt:startMs+1});
  const data=snapshot(db);
  assert.deepEqual(data.payments.paid,[
    {provider:'stripe',kind:'recharge',currency:'usd',orderCount:2,grossAmountMinor:600,refundAmountMinorCurrentlyForTheseOrders:100},
    {provider:'zpay',kind:'recharge',currency:'cny',orderCount:1,grossAmountMinor:2800,refundAmountMinorCurrentlyForTheseOrders:2800},
    {provider:'zpay',kind:'subscription',currency:'cny',orderCount:2,grossAmountMinor:5600,refundAmountMinorCurrentlyForTheseOrders:null},
  ]);
  assert.equal(data.payments.superPaid[0].grossAmountMinor,500);
  assert.equal(data.payments.refunds.length,2);
  assert.equal(data.payments.refunds[0].amountMinor,100);
  assert.equal(data.payments.refunds[1].amountMinor,2800);
  assert.equal(data.payments.createdByStatus.find(x=>x.provider==='stripe'&&x.status==='pending').orderCount,1);
  db.close();
});

test('NOWPayments paid microUSDT stays distinct from fiat; pending, guest and Super are not ordinary receipts', () => {
  const db=database();
  try {
    stripe(db,{amount:100});
    subscription(db);
    usdtSubscription(db);
    usdtSubscription(db,{paidAt:startMs+1});
    usdtSubscription(db,{status:'pending',paidAt:null});
    usdtSubscription(db,{user:'guest'});
    usdtSubscription(db,{user:'super'});
    usdtSubscription(db,{paidAt:endMs});
    const data=snapshot(db);
    assert.deepEqual(data.payments.paid,[
      {provider:'nowpayments',kind:'subscription',currency:'usdt',orderCount:2,grossAmountMinor:10_000_000,refundAmountMinorCurrentlyForTheseOrders:null,amountScale:6},
      {provider:'stripe',kind:'recharge',currency:'usd',orderCount:1,grossAmountMinor:100,refundAmountMinorCurrentlyForTheseOrders:0},
      {provider:'zpay',kind:'subscription',currency:'cny',orderCount:1,grossAmountMinor:2800,refundAmountMinorCurrentlyForTheseOrders:null},
    ]);
    assert.deepEqual(data.payments.superPaid,[
      {provider:'nowpayments',kind:'subscription',currency:'usdt',orderCount:1,grossAmountMinor:5_000_000,refundAmountMinorCurrentlyForTheseOrders:null,amountScale:6},
    ]);
    assert.equal(data.payments.createdByStatus.find(row=>row.provider==='nowpayments'&&row.status==='pending').orderCount,1);
    assert.equal(data.subscriptions.newPaidOrdersInDay,3);
    assert.equal(data.subscriptions.refundCashflowInDay,null);
    assert.equal(data.subscriptions.automaticRenewal,false);
  } finally { db.close(); }
});

test('VIP is a current entitlement snapshot: overlap deduplication, queued renewal, revoked rights and final expiry', () => {
  const db=database();
  // An overlapping historical period must not produce a second member, while
  // a paid future renewal prevents a false imminent final-expiry warning.
  const nearStart=snapshotMs+2*86400000-2592000000;
  subscription(db,{id:'first',paidAt:prior,startsAt:nearStart});
  subscription(db,{id:'second',paidAt:startMs,startsAt:nearStart});
  subscription(db,{id:'third',paidAt:startMs,startsAt:snapshotMs+2*86400000});
  subscription(db,{id:'revoked',user:'second',startsAt:startMs,revoked:startMs});
  subscription(db,{id:'owner-vip',user:'super',startsAt:startMs});
  const near=subscription(db,{id:'normal',user:'second',paidAt:startMs,startsAt:snapshotMs+3*86400000-2592000000});
  const claim=uid();
  insert(db,'subscription_daily_claims',{id:claim,user_id:'second',subscription_id:near.rights,request_id:uid(),day_key:'2026-10-10',credits:100,claimed_at:startMs,processing_token:'fixture'});
  insert(db,'subscription_credit_ledger',{user_id:'second',claim_id:claim,kind:'daily_grant',credits:100,created_at:startMs});
  const data=snapshot(db);
  assert.equal(data.subscriptions.activeVipUsersCurrent,2);
  assert.equal(data.subscriptions.activePeriodsCurrent,3);
  assert.equal(data.subscriptions.queuedPeriodsCurrent,1);
  assert.equal(data.subscriptions.expiringUsersNext7Days,1);
  assert.equal(data.subscriptions.newPaidOrdersInDay,4);
  assert.equal(data.subscriptions.firstPurchaseOrdersInDay,1);
  assert.equal(data.subscriptions.repeatPurchaseOrdersInDay,3);
  assert.equal(data.subscriptions.revokedPeriodsInDay,1);
  assert.equal(data.subscriptions.dailyClaimCount,1);
  assert.equal(data.subscriptions.dailyClaimCredits,100);
  assert.equal(data.credits.currentAvailableCredits,100);
  db.close();
});

test('Credit settlement clocks differ from request cohorts, expired holds are not charges, unknown costs remain counted', () => {
  const db=database();
  grant(db,'ordinary',1500,prior);
  grant(db,'super',1000000,prior,'owner');
  usage(db,{at:prior,final:startMs,charge:10});
  usage(db,{at:startMs,final:endMs,charge:20,cost:null});
  usage(db,{at:startMs+1000,final:startMs+2000,status:'released',cost:null});
  usage(db,{at:snapshotMs-600000,status:'reserved',cost:null}); // expiry equals now
  usage(db,{at:snapshotMs-1,status:'reserved',cost:null,reserved:25});
  usage(db,{at:startMs,final:startMs+2000,user:'super',charge:40,reserved:40});
  usage(db,{at:startMs,final:startMs+2000,user:'guest',charge:50,reserved:50});
  media(db,{at:prior,final:startMs,charge:30});
  media(db,{at:startMs,final:endMs,charge:60,cost:null});
  media(db,{at:snapshotMs-1,final:snapshotMs,status:'processing',charge:0,cost:null});
  const data=snapshot(db);
  assert.equal(data.credits.modelChargeCredits,10);
  assert.equal(data.credits.mediaChargeCredits,30);
  assert.equal(data.credits.modelReleaseCount,1);
  assert.equal(data.credits.currentReservedCredits,125);
  assert.equal(data.credits.currentAvailableCredits,1255); // 1500 - all 120 spent -125 held
  assert.equal(data.credits.super.modelChargeCredits,40);
  assert.equal(data.modelUsage.ordinary.find(r=>r.status==='settled').providerCostUnknownCount,1);
  assert.equal(data.modelUsage.ordinary.find(r=>r.status==='settled').requestsCreated,1);
  assert.equal(data.modelUsage.super[0].requestsCreated,1);
  assert.equal(data.generation.ordinary[0].providerCostUnknownCount,1);
  db.close();
});

test('sealed fictional demo authors and their content are isolated from operating registrations and forum activity', () => {
  const db=database();
  const batchId='fixture-demo';
  const manifest={schemaVersion:1,isDemo:1,batchId,sourceBatchId:'fixture',
    provenance:{kind:'fictional-demo',source:'original',batchId},
    profiles:Array.from({length:100},(_,i)=>({id:`demo-${i}`,nickname:`Fixture ${i}`,bio:'Fictional fixture author',genres:['fiction']})),
    posts:Array.from({length:140},(_,i)=>({id:`demo-post-${i}`,authorId:`demo-${i%100}`,title:'Fictional fixture post',body:'Original fixture body',category:'social',tags:[]})),
    replies:Array.from({length:180},(_,i)=>({id:`demo-reply-${i}`,postId:`demo-post-${i%140}`,authorId:`demo-${i%100}`,body:'Original fixture reply'})),
  };
  insert(db,'forum_demo_batches',{id:batchId,dataset_sha256:'a'.repeat(64),source_batch_id:'fixture',manifest_json:JSON.stringify(manifest),imported_at:startMs});
  const data=snapshot(db);
  assert.equal(data.users.demoTotal,100);
  assert.equal(data.users.ordinaryRegisteredTotal,2);
  assert.equal(data.users.guestTotal,1);
  assert.equal(data.users.newRegistrationsByGrant,0);
  assert.equal(data.users.activeUsersByRecordedActions,0);
  assert.equal(data.community.postsCreated,0);
  assert.equal(data.community.repliesCreated,0);
  assert.equal(data.community.demoPostsCreated,140);
  assert.equal(data.community.demoRepliesCreated,180);
  db.close();
});

test('private content never leaves aggregate SQL, status feedback and media receipts remain content-free', () => {
  const db=database();
  insert(db,'conversations',{user_id:'ordinary',id:'fixture-chat',character_id:'fixture-character',title:'PRIVATE SENTINEL',updated_at:startMs});
  insert(db,'messages',{user_id:'ordinary',conversation_id:'fixture-chat',id:'fixture-message',role:'assistant',content:'PRIVATE SENTINEL',position:0});
  insert(db,'chat_media_usage',{id:uid(),user_id:'ordinary',asset_id:'removed-fixture-asset',kind:'audio',day_key:'2026-10-10',status:'ready',created_at:startMs,expires_at:startMs+600000});
  insert(db,'forum_posts',{id:'fixture-post',user_id:'ordinary',title:'PRIVATE SENTINEL',body:'PRIVATE SENTINEL',category:'social',created_at:startMs,updated_at:startMs});
  insert(db,'forum_posts',{id:'super-post',user_id:'super',title:'PRIVATE SENTINEL',body:'PRIVATE SENTINEL',category:'social',created_at:startMs,updated_at:startMs});
  insert(db,'telegram_feedback',{id:'fixture-feedback',bot_id:'FIXTURE',chat_id:'PRIVATE SENTINEL',message_id:1,update_id:1,source_version:1,text:'PRIVATE SENTINEL',chat_title:'PRIVATE SENTINEL',
    sender_id:'PRIVATE SENTINEL',sender_name:'PRIVATE SENTINEL',message_at:startMs,status:'fix',created_at:startMs,updated_at:startMs});
  const data=snapshot(db);
  assert.equal(data.community.postsCreated,1);
  assert.equal(data.users.activeUsersByRecordedActions,1); // three activity sources, one account
  assert.equal(data.creation.messagesTotalCurrent,1);
  assert.equal(data.creation.conversationsUpdated,1);
  assert.deepEqual(data.generation.chatMedia,[{kind:'audio',status:'ready',requestsCreated:1,providerCostUsd:null}]);
  assert.deepEqual(data.feedback,{received:1,statusCurrent:[{status:'fix',count:1}],decisionsInDay:0});
  assert.equal(JSON.stringify(data).includes('PRIVATE SENTINEL'),false);
  assert.equal(JSON.stringify(data).includes('ordinary'),true); // cohort name, never account identity
  db.close();
});

test('invalid clocks and interpolation are rejected before SQL assembly', () => {
  for(const wrong of [NaN,Infinity,-1,1.2,'0); DROP TABLE users; --']) {
    assert.throws(()=>buildSnapshotSql({...period,startMs:wrong}),/milliseconds/);
  }
  assert.throws(()=>buildSnapshotSql({...period,endMs:startMs}),/completed/);
  assert.throws(()=>buildSnapshotSql({...period,snapshotMs:startMs}),/completed/);
  const sql=buildSnapshotSql(period);
  assert.equal(sql.split(';').length,2);
  assert.equal(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/.test(sql),false);
});

test('single snapshot executes with SQLite compound SELECT limit reduced to ten', () => {
  // Desktop SQLite permits a long UNION that remote D1 rejected. Lower the
  // actual SQLite connection limit, prove the former 13-term shape is refused,
  // then compile and execute the complete new snapshot under that same limit.
  const python = [
    'import json, sqlite3, sys',
    'payload = json.load(sys.stdin)',
    'db = sqlite3.connect(":memory:")',
    'for migration in payload["migrations"]: db.executescript(migration)',
    'db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, 10)',
    'rejected = False',
    'try: db.execute(" UNION ".join(["SELECT 1"] * 13))',
    'except sqlite3.OperationalError as error: rejected = "too many terms" in str(error)',
    'if not rejected: raise AssertionError("compound limit fixture was not rejected")',
    'cursor = db.execute(payload["sql"])',
    'row = cursor.fetchone()',
    'if cursor.fetchone() is not None: raise AssertionError("multiple result rows")',
    'print(json.dumps({"columns": [col[0] for col in cursor.description], "sections": len(row)}))',
    'db.close()',
  ].join('\n');
  const result = spawnSync('python3',['-c',python],{encoding:'utf8',maxBuffer:2*1024*1024,
    input:JSON.stringify({sql:buildSnapshotSql(period),migrations:readdirSync(migrationDir)
      .filter(f=>/^\d+.*\.sql$/.test(f)).sort().map(f=>readFileSync(`${migrationDir}/${f}`,'utf8'))})});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).sections,9);
  assert.deepEqual(JSON.parse(result.stdout).columns,['users','subscriptions','payments','credits','modelUsage','generation','community','creation','feedback']);
});
