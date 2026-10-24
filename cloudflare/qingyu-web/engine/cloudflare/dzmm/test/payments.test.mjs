import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Actual D1, disposable in-memory workerd storage, with Stripe replaced only through
// the handler's dependency injection. No network request or real credential is used.
const { handlePaymentsApi } = await tsImport('../src/payments.ts', import.meta.url);
const SECRET = 'whsec_isolated_payment_fixture';
const KEY = 'sk_test_isolated_payment_fixture';
const LIVE_SECRET = 'whsec_isolated_live_payment_fixture';
const LIVE_KEY = 'sk_live_isolated_payment_fixture';
const LIVE_ACCOUNT = 'acct_IsolatedLivePaymentFixture';
async function migrate(database, files) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    const statements = splitSqlStatements(source).filter(value => value.trim());
    await database.batch(statements.map(sql => database.prepare(sql)));
  }
}
let mf, DB;
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true, script: 'export default {fetch(){return new Response("isolated store")}}', d1Databases: { DB: 'isolated-payments' } }));
  DB = await mf.getD1Database('DB');
  await migrate(DB, ['0001_initial.sql', '0004_super_accounts.sql', '0007_task_claims.sql', '0008_payments.sql', '0009_payment_modes.sql', '0011_zpay_payments.sql', '0012_zpay_recharge_tiers.sql', '0013_subscriptions.sql', '0015_credit_usage.sql']);
  await DB.batch([
    DB.prepare(`CREATE TABLE guagua_orders (id TEXT PRIMARY KEY, user_id TEXT, package_id TEXT, amount_minor INTEGER, currency TEXT, credits INTEGER,
      refunded_credits INTEGER, refunded_amount_minor INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER, paid_at INTEGER, checkout_url TEXT, method TEXT)`),
    DB.prepare(`CREATE TABLE guagua_credit_ledger (id INTEGER PRIMARY KEY, order_id TEXT, user_id TEXT, credits INTEGER, kind TEXT)`),
  ]);
});
after(async () => { await mf?.dispose(); });
const sid = prefix => prefix + randomUUID().replaceAll('-', '');
class StripeMock {
  sessions = new Map(); intents = new Map(); charges = new Map(); refunds = new Map(); idempotency = new Map(); calls = [];
  createCount = 0; loseCreateResponse = false;
  account = { id: LIVE_ACCOUNT, object: 'account', charges_enabled: true, details_submitted: true };
  fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.stripe.com');
    assert.equal(init.redirect, 'manual');
    const authorization = new Headers(init.headers).get('Authorization');
    assert.ok([`Bearer ${KEY}`, `Bearer ${LIVE_KEY}`].includes(authorization));
    const livemode = authorization === `Bearer ${LIVE_KEY}`;
    this.calls.push({ path: url.pathname, query: url.search, method: init.method, mode: livemode ? 'live' : 'test' });
    if (url.pathname === '/v1/account') return Response.json(this.account);
    const parameters = new URLSearchParams(init.body);
    if (url.pathname === '/v1/checkout/sessions' && init.method === 'POST') {
      this.parameters = parameters;
      const key = new Headers(init.headers).get('Idempotency-Key');
      assert.ok(key.startsWith('qingyu-checkout-pay_'));
      let session = this.idempotency.get(key);
      if (!session) {
        this.createCount++;
        const id = sid(livemode ? 'cs_live_' : 'cs_test_');
        session = { id, object: 'checkout.session', mode: 'payment', livemode, status: 'open', payment_status: 'unpaid',
          amount_total: Number(parameters.get('line_items[0][price_data][unit_amount]')), currency: parameters.get('line_items[0][price_data][currency]'),
          client_reference_id: parameters.get('client_reference_id'), url: `https://checkout.stripe.com/c/pay/${id}`, payment_intent: null,
          metadata: Object.fromEntries(['app', 'order_id', 'user_id', 'package_id', 'credits'].map(name => [name, parameters.get(`metadata[${name}]`)])) };
        this.idempotency.set(key, session); this.sessions.set(id, session);
      }
      if (this.loseCreateResponse) { this.loseCreateResponse = false; throw new Error('simulated response lost after Stripe created session'); }
      return Response.json(session);
    }
    if (url.pathname === '/v1/checkout/sessions') {
      return Response.json({ object: 'list', has_more: false, data: [...this.sessions.values()].filter(item => (typeof item.payment_intent === 'string' ? item.payment_intent : item.payment_intent?.id) === url.searchParams.get('payment_intent')) });
    }
    if (url.pathname.startsWith('/v1/checkout/sessions/')) return Response.json(this.sessions.get(url.pathname.split('/').at(-1)));
    if (url.pathname.startsWith('/v1/payment_intents/')) return Response.json(this.intents.get(url.pathname.split('/').at(-1)));
    if (url.pathname.startsWith('/v1/charges/')) return Response.json(this.charges.get(url.pathname.split('/').at(-1)));
    if (url.pathname === '/v1/refunds') {
      const charge = url.searchParams.get('charge');
      return Response.json({ object: 'list', has_more: false, data: [...this.refunds.values()].filter(item => item.charge === charge) });
    }
    if (url.pathname.startsWith('/v1/refunds/')) return Response.json(this.refunds.get(url.pathname.split('/').at(-1)));
    throw new Error(`unmocked Stripe API ${url.pathname}`);
  };
  pay(id) {
    const session = this.sessions.get(id);
    const intentId = session.payment_intent ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id) : sid('pi_'), chargeId = sid('ch_');
    const charge = { id: chargeId, object: 'charge', livemode: session.livemode, amount: session.amount_total, currency: 'usd', paid: true, captured: true, amount_refunded: 0, payment_intent: intentId };
    const intent = { id: intentId, object: 'payment_intent', livemode: session.livemode, currency: 'usd', amount: session.amount_total, amount_received: session.amount_total, status: 'succeeded', latest_charge: charge };
    this.intents.set(intentId, intent); this.charges.set(chargeId, charge);
    Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: intent });
    return { session, intent, charge };
  }
  refund(charge, amount, status = 'succeeded') {
    const refund = { id: sid('re_'), object: 'refund', amount, currency: 'usd', charge: charge.id, payment_intent: charge.payment_intent, status };
    this.refunds.set(refund.id, refund);
    return refund;
  }
}
function liveEnv(env) { return { ...env, STRIPE_PAYMENT_MODE: 'live', STRIPE_LIVE_SECRET_KEY: LIVE_KEY, STRIPE_LIVE_WEBHOOK_SECRET: LIVE_SECRET, STRIPE_LIVE_ACCOUNT_ID: LIVE_ACCOUNT }; }
async function fixture(mode = 'test') {
  const user = { id: randomUUID(), email: `${randomUUID()}@payments.example.test`, nickname: '隔离支付用户', isGuest: false, role: 'user', version: 0 };
  await DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id, user.email, user.nickname, Date.now()).run();
  const stripe = new StripeMock();
  const env = { DB, APP_ORIGINS: 'https://qingyu.invalid', STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PAYMENT_MODE: mode,
    PAYMENTS_ACCEPTING_ENABLED: 'true' };
  return { user, stripe, env: mode === 'live' ? liveEnv(env) : env };
}
async function call(f, path, { method = 'GET', body, raw, headers = {}, user = f.user, env = f.env, options = {} } = {}) {
  const request = new Request(`https://qingyu.invalid${path}`, { method,
    headers: { 'CF-Connecting-IP': f.user.id, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  let response;
  try { response = await handlePaymentsApi(request, env, user, { stripeFetch: f.stripe.fetch, ...options }); }
  catch (error) { if (!Number.isInteger(error.status)) throw error; response = Response.json({ error: error.message }, { status: error.status }); }
  assert.ok(response);
  const data = await response.json();
  return { status: response.status, data };
}
function expect(result, ...statuses) { assert.ok(statuses.includes(result.status), JSON.stringify(result)); return result.data; }
async function checkout(f, extra = {}, args = {}) {
  return call(f, '/v1/payments/checkout', { method: 'POST', body: { accountId: f.user.id, packageId: 'usd_1', requestId: randomUUID(), mode: f.env.STRIPE_PAYMENT_MODE ?? 'test', ...extra }, ...args });
}
async function wallet(f, args = {}) { return expect(await call(f, '/v1/payments/wallet', args), 200); }
async function storedOrder(order) { return DB.prepare('SELECT * FROM payment_orders WHERE id=?').bind(order.id).first(); }
function event(type, object, extra = {}) { return { id: sid('evt_'), object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object }, ...extra }; }
function signed(raw, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
}
async function hook(f, value, args = {}) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const { headers, secret = f.env.STRIPE_PAYMENT_MODE === 'live' ? LIVE_SECRET : SECRET, ...rest } = args;
  return call(f, '/v1/payments/webhook', { method: 'POST', raw, headers: { 'Stripe-Signature': signed(raw, undefined, secret), 'Content-Type': 'application/json', ...headers }, ...rest });
}

test('public configuration is explicitly test-only, fixed price and independent of model billing', async () => {
  const f = await fixture();
  const config = expect(await call(f, '/v1/payments/config', { user: null }), 200);
  assert.equal(config.enabled, true); assert.equal(config.mode, 'test'); assert.equal(config.testMode, true); assert.equal(config.modelBillingLinked, false);
  assert.deepEqual(config.packages.map(item => [item.id, item.amountMinor, item.credits]), [['usd_1', 100, 100], ['usd_5', 500, 500], ['usd_10', 1000, 1000]]);
  const disabled = expect(await call(f, '/v1/payments/config', { env: { ...f.env, STRIPE_SECRET_KEY: undefined } }), 200);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.note, 'Stripe 测试充值尚未配置，请稍后再试。');
  assert.match(config.note, /充值 Credit.*任务、邀请奖励/);
  const live = { ...f.env, STRIPE_PAYMENT_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture' };
  assert.equal(expect(await call(f, '/v1/payments/config', { env: live }), 200).enabled, false);
  expect(await checkout(f, {}, { env: live }), 503);
  assert.doesNotMatch(JSON.stringify(config), /sk_test_|whsec_/);
});

test('new collection is closed by default without writing an order or calling Stripe', async () => {
  const f = await fixture(), paused = { ...f.env, PAYMENTS_ACCEPTING_ENABLED: undefined };
  const config = expect(await call(f, '/v1/payments/config', { user: null, env: paused }), 200);
  assert.equal(config.enabled, false); assert.equal(config.note, '收款暂时关闭，已有订单和会员权益不受影响。');
  expect(await checkout(f, {}, { env: paused }), 503);
  assert.equal(f.stripe.createCount, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM payment_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('formal account and matching accountId are required and client amounts cannot influence prices', async () => {
  const f = await fixture();
  expect(await call(f, '/v1/payments/wallet', { user: null }), 401);
  expect(await checkout(f, {}, { user: { ...f.user, isGuest: true } }), 403);
  expect(await checkout(f, { accountId: randomUUID() }), 401);
  for (const extra of [{ amount: 1 }, { credits: 9999 }, { userId: randomUUID() }, { currency: 'eur' }, { returnUrl: 'https://foreign.example' }]) expect(await checkout(f, extra), 400);
  expect(await checkout(f, { provider: 'zpay' }), 409);
  expect(await checkout(f, { packageId: 'fake' }), 400); expect(await checkout(f, { requestId: 'bad\0uuid' }), 400);
  expect(await checkout(f, {}, { env: { ...f.env, PAYMENTS_RETURN_ORIGIN: 'https://foreign.example' } }), 503);
  expect(await call(f, '/v1/payments/checkout'), 405);
  expect(await call(f, '/v1/payments/wallet', { method: 'POST', body: {} }), 405);
  assert.equal((await wallet(f)).balance, 0); assert.equal(f.stripe.createCount, 0);
});

test('checkout is idempotent under concurrency and fixes amount, metadata and safe return URLs on the server', async () => {
  const f = await fixture(), requestId = randomUUID();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => checkout(f, { requestId: i % 2 ? requestId.toUpperCase() : requestId,
    ...(i % 2 ? { provider: 'stripe' } : {}) })));
  results.forEach(result => expect(result, 200, 201));
  assert.equal(new Set(results.map(result => result.data.order.id)).size, 1); assert.equal(f.stripe.createCount, 1);
  const order = results[0].data.order;
  assert.equal(f.stripe.parameters.get('mode'), 'payment'); assert.equal(f.stripe.parameters.get('line_items[0][price_data][unit_amount]'), '100');
  assert.equal(f.stripe.parameters.get('managed_payments[enabled]'), 'false');
  assert.equal(f.stripe.parameters.get('payment_method_types[0]'), 'card');
  assert.equal(f.stripe.parameters.get('metadata[user_id]'), f.user.id); assert.equal(f.stripe.parameters.get('metadata[credits]'), '100');
  assert.equal(f.stripe.parameters.get('line_items[0][price_data][product_data][name]'), '晴屿测试充值 · 100 充值点数');
  assert.equal(f.stripe.parameters.get('success_url'), `https://qingyu.invalid/?payment_order=${order.id}&payment=success#recharge`);
  assert.equal(f.stripe.parameters.get('cancel_url'), `https://qingyu.invalid/?payment_order=${order.id}&payment=cancel#recharge`);
  expect(await checkout(f, { requestId, packageId: 'usd_5' }), 409);
  const stranger = await fixture(); expect(await call(stranger, `/v1/payments/orders/${order.id}`), 404);
  assert.deepEqual((await wallet(stranger)).orders, []); assert.equal((await wallet(f)).balance, 0);
});

test('uncertain Stripe creation and D1 write failures recover using one session and old unknown requests never recreate', async () => {
  const f = await fixture(), requestId = randomUUID();
  f.stripe.loseCreateResponse = true;
  expect(await checkout(f, { requestId }), 503);
  const recovered = expect(await checkout(f, { requestId }), 200);
  assert.equal(f.stripe.createCount, 1); assert.ok(recovered.checkoutUrl.startsWith('https://checkout.stripe.com/'));
  let fail = true;
  const brokenDB = { prepare(sql) {
    const statement = DB.prepare(sql);
    if (!sql.startsWith('UPDATE payment_orders SET stripe_session_id')) return statement;
    return { bind(...args) { const bound = statement.bind(...args); return { run() { if (fail) { fail = false; throw new Error('simulated D1 write lost'); } return bound.run(); } }; } };
  }, batch: statements => DB.batch(statements) };
  const second = randomUUID();
  await assert.rejects(checkout(f, { requestId: second }, { env: { ...f.env, DB: brokenDB } }), /simulated D1/);
  const before = f.stripe.createCount;
  expect(await checkout(f, { requestId: second }), 200); assert.equal(f.stripe.createCount, before);
  const third = randomUUID(); f.stripe.loseCreateResponse = true;
  expect(await checkout(f, { requestId: third }), 503);
  await DB.prepare('UPDATE payment_orders SET created_at=? WHERE user_id=? AND request_id=?').bind(Date.now() - 24 * 3600000, f.user.id, third).run();
  const calls = f.stripe.calls.length; expect(await checkout(f, { requestId: third }), 409); assert.equal(f.stripe.calls.length, calls);
});

test('webhook verifies untouched raw bytes, timestamps, multiple signatures and streaming body limits', async () => {
  const f = await fixture();
  const raw = JSON.stringify(event('unused.event', { note: '中文 原始字节' }));
  expect(await hook(f, raw), 200);
  expect(await hook(f, `${raw} `, { headers: { 'Stripe-Signature': signed(raw) } }), 400);
  expect(await hook(f, raw, { headers: { 'Stripe-Signature': signed(raw, Math.floor(Date.now() / 1000) - 301) } }), 400);
  expect(await hook(f, raw, { headers: { 'Stripe-Signature': signed(raw, Math.floor(Date.now() / 1000) + 301) } }), 400);
  expect(await hook(f, raw, { headers: { 'Stripe-Signature': `${signed(raw)},v1=${'0'.repeat(64)}` } }), 200);
  expect(await hook(f, raw, { headers: { 'Stripe-Signature': '' } }), 400);
  expect(await hook(f, 'x'.repeat(262145)), 413);
  expect(await hook(f, raw, { headers: { 'Content-Length': '262145' } }), 413);
  expect(await hook(f, event('unused.event', {}, { livemode: true })), 400);
  expect(await call(f, '/v1/payments/webhook'), 405);
  assert.equal((await wallet(f)).balance, 0);
});

test('paid events are reverified with Stripe and concurrent duplicates grant exactly once without community-state writes', async () => {
  const f = await fixture();
  const result = expect(await checkout(f), 201), row = await storedOrder(result.order);
  // The browser return status never grants credits; nor does a signed paid-looking
  // event whose canonical Stripe session is still unpaid.
  expect(await call(f, `/v1/payments/orders/${row.id}?payment=success`), 200);
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id, payment_status: 'paid', amount_total: 1 })), 200);
  assert.equal((await wallet(f)).balance, 0);
  f.stripe.pay(row.stripe_session_id);
  await DB.prepare("INSERT INTO task_claims(user_id,task_id,period,points,claimed_at) VALUES(?,'first_conversation','once',5,?)").bind(f.user.id, Date.now()).run();
  const paid = event('checkout.session.completed', { id: row.stripe_session_id });
  const results = await Promise.all(Array.from({ length: 20 }, () => hook(f, paid)));
  results.forEach(result => expect(result, 200));
  assert.equal((await wallet(f)).balance, 100); assert.equal((await wallet(f)).totalPurchased, 100);
  const count = await DB.prepare("SELECT COUNT(*) AS count FROM payment_credit_ledger WHERE order_id=? AND kind='purchase'").bind(row.id).first();
  assert.equal(count.count, 1); assert.equal((await DB.prepare('SELECT SUM(points) AS points FROM task_claims WHERE user_id=?').bind(f.user.id).first()).points, 5);
  // Payment commits while an order GET is in flight. Details and balance must
  // come from the same D1 snapshot, rather than pairing a stale row with new money.
  const concurrent = await fixture(), pending = await storedOrder(expect(await checkout(concurrent), 201).order);
  concurrent.stripe.pay(pending.stripe_session_id);
  let committed = false;
  const interleavedDB = { prepare: sql => DB.prepare(sql), async batch(statements) {
    if (!committed) { committed = true; expect(await hook(concurrent, event('checkout.session.completed', { id: pending.stripe_session_id })), 200); }
    return DB.batch(statements);
  } };
  const detail = expect(await call(concurrent, `/v1/payments/orders/${pending.id}`, { env: { ...concurrent.env, DB: interleavedDB } }), 200);
  assert.equal(detail.order.status, 'paid'); assert.equal(detail.balance, 100);
  assert.deepEqual(detail.orders.find(order => order.id === pending.id), detail.order);
});

test('currency, amount, mode and identity mismatches are rejected despite a valid webhook signature', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order);
  const { session } = f.stripe.pay(row.stripe_session_id);
  for (const mutation of [
    () => { session.currency = 'eur'; }, () => { session.amount_total = 1; }, () => { session.mode = 'subscription'; },
    () => { session.livemode = true; }, () => { session.metadata.user_id = randomUUID(); }, () => { session.metadata.credits = '99999'; },
    () => { session.client_reference_id = 'other'; }, () => { session.id = sid('cs_test_'); },
  ]) {
    const saved = structuredClone(session); mutation();
    expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 400);
    Object.assign(session, saved);
  }
  const { intent, charge } = f.stripe.pay(row.stripe_session_id);
  session.payment_intent = intent.id;
  const savedIntentId = intent.id; intent.id = sid('pi_');
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 400); intent.id = savedIntentId;
  intent.latest_charge = charge.id;
  const savedChargeId = charge.id; charge.id = sid('ch_');
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 400); charge.id = savedChargeId;
  session.payment_intent = intent; intent.latest_charge = charge;
  const otherRow = await storedOrder(expect(await checkout(f), 201).order), otherPaid = f.stripe.pay(otherRow.stripe_session_id);
  const refund = f.stripe.refund(charge, 20);
  const conflicting = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/v1/checkout/sessions' && url.searchParams.has('payment_intent')) return Response.json({ object: 'list', has_more: false, data: [otherPaid.session] });
    return f.stripe.fetch(input, init);
  };
  expect(await hook(f, event('refund.created', { id: refund.id }), { options: { stripeFetch: conflicting } }), 400);
  const savedRefundId = refund.id; refund.id = sid('re_');
  expect(await hook(f, event('refund.created', { id: savedRefundId })), 502); refund.id = savedRefundId;
  const foreignCharge = { ...charge, id: sid('ch_') }; f.stripe.charges.set(foreignCharge.id, foreignCharge);
  expect(await hook(f, event('charge.refunded', { id: foreignCharge.id })), 400);
  assert.equal((await wallet(f)).balance, 0);
});

test('delayed success, failed payments and expiry follow retrieved state while credited orders cannot be downgraded', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order);
  const session = f.stripe.sessions.get(row.stripe_session_id);
  session.status = 'complete';
  session.payment_intent = { id: sid('pi_'), object: 'payment_intent', livemode: false, currency: 'usd', amount: 100, status: 'processing' };
  expect(await hook(f, event('checkout.session.completed', { id: session.id })), 200);
  assert.equal((await wallet(f)).balance, 0); assert.equal((await wallet(f)).orders[0].status, 'pending');
  session.payment_intent.status = 'requires_payment_method';
  expect(await hook(f, event('checkout.session.async_payment_failed', { id: session.id })), 200);
  assert.equal((await wallet(f)).orders[0].status, 'failed');
  f.stripe.pay(session.id);
  expect(await hook(f, event('checkout.session.async_payment_succeeded', { id: session.id })), 200);
  assert.equal((await wallet(f)).balance, 100);
  session.status = 'expired'; session.payment_status = 'unpaid';
  expect(await hook(f, event('checkout.session.expired', { id: session.id })), 200);
  assert.equal((await wallet(f)).balance, 100); assert.equal((await wallet(f)).orders[0].status, 'paid');
  const empty = await fixture(), expired = await storedOrder(expect(await checkout(empty), 201).order);
  empty.stripe.sessions.get(expired.stripe_session_id).status = 'expired';
  expect(await hook(empty, event('checkout.session.expired', { id: expired.stripe_session_id })), 200);
  assert.equal((await wallet(empty)).balance, 0); assert.equal((await wallet(empty)).orders[0].status, 'expired');
});

test('refund before completed recovers the Stripe session and atomically records only net credits', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order);
  const { charge } = f.stripe.pay(row.stripe_session_id);
  f.stripe.refund(charge, 30);
  assert.equal(row.stripe_payment_intent_id, null);
  const result = expect(await hook(f, event('charge.refunded', { id: charge.id, metadata: { user_id: 'forged' } })), 200);
  assert.equal(result.processed, true); assert.equal((await wallet(f)).balance, 70);
  assert.equal((await wallet(f)).totalPurchased, 100); assert.equal((await wallet(f)).totalRefunded, 30);
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 200);
  assert.equal((await wallet(f)).balance, 70);
});

test('partial and full refunds apply verified cumulative differences once under duplicate delivery', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order), { charge } = f.stripe.pay(row.stripe_session_id);
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 200);
  const first = f.stripe.refund(charge, 20), refundEvent = event('refund.created', { id: first.id });
  expect(await hook(f, refundEvent), 200); expect(await hook(f, refundEvent), 200);
  assert.equal((await wallet(f)).balance, 80);
  f.stripe.refund(charge, 10);
  expect(await hook(f, event('charge.refunded', { id: charge.id })), 200); assert.equal((await wallet(f)).balance, 70);
  f.stripe.refund(charge, 70);
  const final = event('charge.refunded', { id: charge.id });
  (await Promise.all(Array.from({ length: 12 }, () => hook(f, final)))).forEach(result => expect(result, 200));
  assert.equal((await wallet(f)).balance, 0); assert.equal((await wallet(f)).totalRefunded, 100); assert.equal((await wallet(f)).orders[0].status, 'refunded');
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 200); assert.equal((await wallet(f)).balance, 0);
});

test('asynchronous refund failure restores credits once and stale success cannot remove them again', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order), { charge } = f.stripe.pay(row.stripe_session_id);
  const refund = f.stripe.refund(charge, 40);
  expect(await hook(f, event('refund.created', { id: refund.id })), 200); assert.equal((await wallet(f)).balance, 60);
  refund.status = 'failed';
  const failed = event('refund.failed', { id: refund.id });
  expect(await hook(f, failed), 200); expect(await hook(f, failed), 200);
  assert.equal((await wallet(f)).balance, 100); assert.equal((await wallet(f)).totalRefunded, 0);
  refund.status = 'succeeded'; // A concurrent older API snapshot arrives after failure.
  expect(await hook(f, event('refund.updated', { id: refund.id })), 200); assert.equal((await wallet(f)).balance, 100);
  const second = f.stripe.refund(charge, 20);
  expect(await hook(f, event('refund.created', { id: second.id })), 200); assert.equal((await wallet(f)).balance, 80);
  assert.equal((await wallet(f)).totalRefunded, 20);
});

test('pending, failed and canceled refund attempts do not remove credits and mutable refund amounts are rejected', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order), { charge } = f.stripe.pay(row.stripe_session_id);
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id })), 200);
  const refund = f.stripe.refund(charge, 20, 'pending');
  expect(await hook(f, event('refund.created', { id: refund.id })), 200); assert.equal((await wallet(f)).balance, 100);
  refund.status = 'canceled';
  expect(await hook(f, event('refund.updated', { id: refund.id })), 200); assert.equal((await wallet(f)).balance, 100);
  refund.amount = 21;
  expect(await hook(f, event('refund.updated', { id: refund.id })), 400); assert.equal((await wallet(f)).balance, 100);
});

test('a failing D1 batch rolls event, purchase and refund facts back together and retry grants once', async () => {
  const f = await fixture(), row = await storedOrder(expect(await checkout(f), 201).order), { charge } = f.stripe.pay(row.stripe_session_id);
  f.stripe.refund(charge, 25);
  const value = event('checkout.session.completed', { id: row.stripe_session_id });
  const brokenDB = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'refund_adjustment',0,?)").bind(row.id, f.user.id, value.id, Date.now())]) };
  await assert.rejects(hook(f, value, { env: { ...f.env, DB: brokenDB } }), /CHECK constraint/);
  assert.equal((await wallet(f)).balance, 0);
  assert.equal(await DB.prepare('SELECT event_id FROM payment_events WHERE event_id=?').bind(value.id).first(), null);
  assert.equal((await storedOrder(row)).paid_at, null);
  expect(await hook(f, value), 200); assert.equal((await wallet(f)).balance, 75);
});

test('live configuration requires correctly paired credentials and an account pin before any order is written', async () => {
  const f = await fixture('live');
  const ready = expect(await call(f, '/v1/payments/config', { user: null }), 200);
  assert.equal(ready.enabled, true); assert.equal(ready.mode, 'live'); assert.equal(ready.testMode, false);
  assert.match(ready.note, /真实扣款/); assert.doesNotMatch(JSON.stringify(ready), /sk_live_|whsec_|acct_/);
  for (const env of [
    { ...f.env, STRIPE_LIVE_SECRET_KEY: undefined },
    { ...f.env, STRIPE_LIVE_WEBHOOK_SECRET: undefined },
    { ...f.env, STRIPE_LIVE_SECRET_KEY: KEY },
    { ...f.env, STRIPE_LIVE_ACCOUNT_ID: undefined },
    { ...f.env, STRIPE_LIVE_ACCOUNT_ID: 'not-an-account' },
    { ...f.env, STRIPE_PAYMENT_MODE: 'invalid' },
  ]) {
    const config = expect(await call(f, '/v1/payments/config', { env }), 200);
    assert.equal(config.enabled, false);
    if (env.STRIPE_PAYMENT_MODE === 'live') assert.match(config.note, /尚未开通.*激活/);
    expect(await checkout(f, {}, { env }), 503);
  }
  for (const mode of ['test', undefined, 'invalid']) expect(await checkout(f, { mode }), 409);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM payment_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
  assert.equal(f.stripe.calls.length, 0);
  // An unspecified mode continues to mean test, but a live generic key cannot
  // accidentally switch that default or authorize a test checkout.
  const defaultTest = { ...f.env, STRIPE_PAYMENT_MODE: undefined, STRIPE_LIVE_SECRET_KEY: undefined, STRIPE_LIVE_WEBHOOK_SECRET: undefined };
  assert.equal(expect(await call(f, '/v1/payments/config', { env: defaultTest }), 200).mode, 'test');
  assert.equal(expect(await call(f, '/v1/payments/config', { env: { ...defaultTest, STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: LIVE_SECRET } }), 200).enabled, false);
});

test('live checkout verifies account activation and pin, charges the server price and grants exactly once', async () => {
  const f = await fixture('live'), requestId = randomUUID();
  for (const state of [
    { id: LIVE_ACCOUNT, charges_enabled: false, details_submitted: true },
    { id: LIVE_ACCOUNT, charges_enabled: true, details_submitted: false },
    { id: 'acct_other', charges_enabled: true, details_submitted: true },
  ]) {
    f.stripe.account = { object: 'account', ...state };
    expect(await checkout(f, { requestId }), 503);
    assert.equal(f.stripe.createCount, 0); assert.equal((await wallet(f)).balance, 0);
  }
  f.stripe.account = { object: 'account', id: LIVE_ACCOUNT, charges_enabled: true, details_submitted: true };
  const results = await Promise.all(Array.from({ length: 12 }, () => checkout(f, { requestId })));
  results.forEach(result => expect(result, 200, 201));
  assert.equal(f.stripe.createCount, 1); assert.equal(new Set(results.map(result => result.data.order.id)).size, 1);
  const result = results[0].data, row = await storedOrder(result.order);
  assert.equal(result.mode, 'live'); assert.equal(result.testMode, false); assert.equal(row.mode, 'live');
  assert.ok(row.stripe_session_id.startsWith('cs_live_'));
  assert.equal(f.stripe.parameters.get('line_items[0][price_data][product_data][name]'), '晴屿充值 · 100 充值点数');
  assert.equal(f.stripe.parameters.get('line_items[0][price_data][unit_amount]'), '100');
  assert.equal(f.stripe.parameters.get('managed_payments[enabled]'), 'false');
  assert.equal((await wallet(f)).balance, 0);
  f.stripe.pay(row.stripe_session_id);
  const paid = event('checkout.session.completed', { id: row.stripe_session_id }, { livemode: true });
  (await Promise.all(Array.from({ length: 12 }, () => hook(f, paid)))).forEach(response => expect(response, 200));
  assert.equal((await wallet(f)).balance, 100); assert.equal((await wallet(f)).totalPurchased, 100);
  assert.equal((await wallet(f)).orders[0].mode, 'live');
  assert.ok(f.stripe.calls.every(call => call.mode === 'live'));
  // A known checkout URL stays recoverable when Stripe account status changes.
  f.stripe.account.charges_enabled = false;
  const before = f.stripe.calls.length;
  expect(await checkout(f, { requestId }), 200); assert.equal(f.stripe.calls.length, before);
});

test('test balances and callbacks stay isolated after switching to live, including historical refunds', async () => {
  const f = await fixture(), requestId = randomUUID(), testEnv = f.env;
  const testRow = await storedOrder(expect(await checkout(f, { requestId }), 201).order);
  const testPayment = f.stripe.pay(testRow.stripe_session_id);
  expect(await hook(f, event('checkout.session.completed', { id: testRow.stripe_session_id })), 200);
  assert.equal((await wallet(f)).balance, 100);
  f.env = liveEnv(f.env);
  assert.equal((await wallet(f)).balance, 0); assert.deepEqual((await wallet(f)).orders, []);
  expect(await call(f, `/v1/payments/orders/${testRow.id}`), 404);
  expect(await checkout(f, { requestId, mode: 'test' }), 409);
  const liveRow = await storedOrder(expect(await checkout(f, { requestId }), 201).order);
  assert.notEqual(liveRow.id, testRow.id);
  f.stripe.refund(testPayment.charge, 25);
  const before = f.stripe.calls.length;
  expect(await hook(f, event('charge.refunded', { id: testPayment.charge.id }), { secret: SECRET }), 200);
  assert.ok(f.stripe.calls.slice(before).every(call => call.mode === 'test'));
  assert.equal((await wallet(f)).balance, 0);
  assert.equal((await wallet(f, { env: testEnv })).balance, 75);
  assert.equal((await wallet(f, { env: testEnv })).totalRefunded, 25);
  const livePayment = f.stripe.pay(liveRow.stripe_session_id);
  expect(await hook(f, event('checkout.session.completed', { id: liveRow.stripe_session_id }, { livemode: true })), 200);
  f.stripe.refund(livePayment.charge, 40);
  expect(await hook(f, event('charge.refunded', { id: livePayment.charge.id }, { livemode: true })), 200);
  assert.equal((await wallet(f)).balance, 60); assert.equal((await wallet(f)).totalRefunded, 40);
  assert.equal((await wallet(f, { env: testEnv })).balance, 75);
  const pendingTest = await fixture(), pendingEnv = pendingTest.env;
  const pendingRow = await storedOrder(expect(await checkout(pendingTest), 201).order);
  pendingTest.stripe.pay(pendingRow.stripe_session_id);
  pendingTest.env = { ...pendingTest.env, STRIPE_PAYMENT_MODE: 'live', STRIPE_LIVE_ACCOUNT_ID: LIVE_ACCOUNT };
  assert.equal(expect(await call(pendingTest, '/v1/payments/config'), 200).enabled, false);
  expect(await hook(pendingTest, event('checkout.session.completed', { id: pendingRow.stripe_session_id }), { secret: SECRET }), 200);
  assert.equal((await wallet(pendingTest)).balance, 0); assert.equal((await wallet(pendingTest, { env: pendingEnv })).balance, 100);
});

test('signed live callbacks reject test sessions, intents, charges, refunds and test order ownership', async () => {
  const f = await fixture('live'), row = await storedOrder(expect(await checkout(f), 201).order);
  const { session, intent, charge } = f.stripe.pay(row.stripe_session_id);
  const callback = () => event('checkout.session.completed', { id: row.stripe_session_id }, { livemode: true });
  expect(await hook(f, callback(), { secret: SECRET }), 400);
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id }), { secret: LIVE_SECRET }), 400);
  expect(await hook(f, event('checkout.session.completed', { id: sid('cs_test_') }, { livemode: true })), 502);
  expect(await hook(f, event('checkout.session.completed', { id: row.stripe_session_id, livemode: false }, { livemode: true })), 400);
  for (const object of [session, intent, charge]) {
    object.livemode = false; expect(await hook(f, callback()), 400); object.livemode = true;
  }
  const refund = f.stripe.refund(charge, 20); refund.livemode = false;
  expect(await hook(f, callback()), 502);
  expect(await hook(f, event('refund.created', { id: refund.id }, { livemode: true })), 502);
  refund.livemode = true;
  const testResponse = expect(await checkout(f, { mode: 'test' }, { env: { ...f.env, STRIPE_PAYMENT_MODE: 'test' } }), 201);
  const saved = structuredClone(session);
  Object.assign(session.metadata, { order_id: testResponse.order.id }); session.client_reference_id = testResponse.order.id;
  expect(await hook(f, callback()), 400);
  Object.assign(session, saved);
  assert.equal((await wallet(f)).balance, 0);
  const valid = callback(); expect(await hook(f, valid), 200); assert.equal((await wallet(f)).balance, 80);
  // Deduplication must not let an already processed event bypass mode matching.
  expect(await hook(f, { ...valid, livemode: false }, { secret: SECRET }), 400);
});

test('mode-specific named credentials override compatible generic fallback without mixing secrets', async () => {
  const f = await fixture('live');
  const genericLive = { ...f.env, STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: LIVE_SECRET,
    STRIPE_LIVE_SECRET_KEY: undefined, STRIPE_LIVE_WEBHOOK_SECRET: undefined,
    STRIPE_TEST_SECRET_KEY: KEY, STRIPE_TEST_WEBHOOK_SECRET: SECRET };
  expect(await checkout(f, {}, { env: genericLive }), 201);
  const badOverride = { ...genericLive, STRIPE_LIVE_SECRET_KEY: KEY };
  assert.equal(expect(await call(f, '/v1/payments/config', { env: badOverride }), 200).enabled, false);
  expect(await checkout(f, {}, { env: badOverride }), 503);
  const missingPair = { ...f.env, STRIPE_LIVE_WEBHOOK_SECRET: undefined };
  assert.equal(expect(await call(f, '/v1/payments/config', { env: missingPair }), 200).enabled, false);
  assert.ok(f.stripe.calls.every(call => call.mode === 'live'));
});

test('mode migration preserves every existing test order, event, sticky refund and ledger row with foreign keys enforced', async () => {
  const store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("migration store")}}', d1Databases: { DB: 'migration-payments' } }));
  try {
    const database = await store.getD1Database('DB');
    await migrate(database, ['0001_initial.sql', '0008_payments.sql']);
    const userId = randomUUID(), orderId = `pay_${randomUUID()}`, requestId = randomUUID(), now = Date.now();
    await database.batch([
      database.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(userId, 'migration@payments.example.test', '迁移用户', now),
      database.prepare(`INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,stripe_session_id,stripe_payment_intent_id,status,refunded_amount_minor,refunded_credits,created_at,updated_at,paid_at)
        VALUES(?,?,?,'usd_1',100,100,'cs_test_existing','pi_existing','partially_refunded',20,20,?,?,?)`).bind(orderId, userId, requestId, now, now, now),
      database.prepare("INSERT INTO payment_events VALUES('evt_existing','charge.refunded',?,'existingtoken',?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_refunds VALUES('re_existing',?,20,'usd',1,0,?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_refunds VALUES('re_failed',?,10,'usd',1,1,?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,'evt_existing','purchase',100,?)").bind(orderId, userId, now),
      database.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,'evt_existing','refund_adjustment',-20,?)").bind(orderId, userId, now),
      database.prepare("INSERT INTO payment_events VALUES('evt_removed','refund.failed',?,'removedtoken',?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_credit_ledger(id,order_id,user_id,source_event_id,kind,credits,created_at) VALUES(999,?,?,'evt_removed','refund_adjustment',1,?)").bind(orderId, userId, now),
      database.prepare("DELETE FROM payment_events WHERE event_id='evt_removed'"),
    ]);
    const tables = ['payment_orders', 'payment_events', 'payment_refunds', 'payment_credit_ledger'];
    const beforeRows = await Promise.all(tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    await migrate(database, ['0009_payment_modes.sql']);
    for (let i = 0; i < tables.length; i++) assert.deepEqual((await database.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results, beforeRows[i].results);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.equal((await database.prepare("SELECT seq FROM sqlite_sequence WHERE name='payment_credit_ledger'").first()).seq, 999);
    await database.batch([
      database.prepare("INSERT INTO payment_events VALUES('evt_after','refund.failed',?,'aftertoken',?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,'evt_after','refund_adjustment',1,?)").bind(orderId, userId, now),
    ]);
    assert.equal((await database.prepare("SELECT id FROM payment_credit_ledger WHERE source_event_id='evt_after'").first()).id, 1000);
    const otherOrder = `pay_${randomUUID()}`;
    await database.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,created_at,updated_at) VALUES(?,?,?,'usd_1',100,100,'live',?,?)").bind(otherOrder, userId, requestId, now, now).run();
    const env = { DB: database, STRIPE_PAYMENT_MODE: 'live' }, user = { id: userId, isGuest: false };
    await migrate(database, ['0011_zpay_payments.sql', '0012_zpay_recharge_tiers.sql', '0013_subscriptions.sql', '0015_credit_usage.sql']);
    await database.batch([
      database.prepare(`CREATE TABLE guagua_orders (id TEXT PRIMARY KEY, user_id TEXT, package_id TEXT, amount_minor INTEGER, currency TEXT, credits INTEGER,
        refunded_credits INTEGER, refunded_amount_minor INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER, paid_at INTEGER, checkout_url TEXT, method TEXT)`),
      database.prepare(`CREATE TABLE guagua_credit_ledger (id INTEGER PRIMARY KEY, order_id TEXT, user_id TEXT, credits INTEGER, kind TEXT)`),
    ]);
    const response = await handlePaymentsApi(new Request('https://qingyu.invalid/v1/payments/wallet'), env, user);
    const liveWallet = await response.json(); assert.equal(liveWallet.balance, 0); assert.equal(liveWallet.orders.length, 1); assert.equal(liveWallet.orders[0].id, otherOrder);
    await assert.rejects(database.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,created_at,updated_at) VALUES(?,?,?,'usd_1',100,100,'invalid',?,?)").bind(`pay_${randomUUID()}`, userId, randomUUID(), now, now).run(), /CHECK constraint/);
    await database.prepare('DELETE FROM payment_orders WHERE id=?').bind(orderId).run();
    for (const table of tables.slice(1)) assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM payment_orders').first()).n, 1);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await store.dispose(); }
});
