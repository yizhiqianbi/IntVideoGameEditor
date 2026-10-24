import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Real D1 batches and constraints; every provider response is local and mocked.
const { handleSubscriptions } = await tsImport('../src/subscriptions.ts', import.meta.url);
const { handlePaymentsApi } = await tsImport('../src/payments.ts', import.meta.url);
const DAY = 86400000, PID = '12345678', KEY = 'isolated_subscription_key_2026';
const BASE = Date.parse('2026-10-05T02:00:00Z');
const plan = (extra = {}) => ({ id: 'monthly_basic', label: '月卡测试', revision: 1, amountMinor: 2800, currency: 'cny',
  durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: 'Asia/Shanghai', ...extra });
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
let store, DB;
function memoryStore(id) { return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
  script: 'export default {fetch(){return new Response("isolated subscription store")}}', d1Databases: { DB: id } })); }
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => { store = memoryStore('subscription-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });
async function fixture(database = DB) {
  const user = { id: randomUUID(), email: `${randomUUID()}@subscription.example.test`, nickname: '订阅测试用户', isGuest: false, role: 'user', version: 0 };
  const token = randomBytes(32).toString('hex'), hash = createHash('sha256').update(token).digest('hex');
  await database.batch([
    database.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id, user.email, user.nickname, BASE),
    database.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash, user.id, BASE + 365 * DAY, BASE),
  ]);
  const env = { DB: database, APP_ORIGINS: 'https://qingyu.invalid', PAYMENT_PROVIDER: 'zpay', ZPAY_ENABLED: 'true', ZPAY_PID: PID, ZPAY_KEY: KEY,
    ZPAY_ALIPAY_CHANNEL_ID: '123', ZPAY_WXPAY_CHANNEL_ID: '456', SUBSCRIPTION_ENABLED: 'true', SUBSCRIPTION_PLANS_JSON: JSON.stringify([plan()]),
    PAYMENTS_ACCEPTING_ENABLED: 'true' };
  const api = { result: { code: -1 }, calls: [], async fetch(input, init) {
    const url = new URL(input); assert.equal(url.origin, 'https://zpayz.cn'); assert.equal(url.pathname, '/api.php');
    assert.equal(url.searchParams.get('act'), 'order'); assert.equal(url.searchParams.get('key'), KEY); assert.equal(url.searchParams.get('pid'), PID);
    assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal); this.calls.push(url.searchParams.get('out_trade_no'));
    return Response.json(this.result);
  } };
  return { user, env, api, token, hash, now: BASE };
}
async function call(f, path, { method = 'GET', body, user = f.user, env = f.env, options = {}, cookie = f.token, payment = false } = {}) {
  const request = new Request(`https://qingyu.invalid${path}`, { method, headers: { 'CF-Connecting-IP': f.user.id,
    ...(cookie ? { Cookie: `qingyu_session=${cookie}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let response;
  try { response = await (payment ? handlePaymentsApi : handleSubscriptions)(request, env, user, { now: () => f.now, zpayFetch: f.api.fetch.bind(f.api), ...options }); }
  catch (error) { if (!Number.isInteger(error.status)) throw error; response = Response.json({ error: error.message, ...error.details }, { status: error.status }); }
  assert.ok(response); const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
function expect(result, ...statuses) { assert.ok(statuses.includes(result.status), JSON.stringify({ status: result.status, data: result.data })); return result.data; }
function checkout(f, extra = {}, args = {}) { return call(f, '/v1/subscriptions/checkout', { method: 'POST', body: { accountId: f.user.id,
  planId: 'monthly_basic', planRevision: 1, requestId: randomUUID(), provider: 'zpay', mode: 'live', method: 'alipay', ...extra }, ...args }); }
async function newOrder(f, extra = {}) { const result = expect(await checkout(f, extra), 201); return f.env.DB.prepare('SELECT * FROM subscription_orders WHERE id=?').bind(result.order.id).first(); }
function sign(parameters) { return createHash('md5').update(Object.entries(parameters).filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== '')
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('&') + KEY).digest('hex'); }
function callback(order, changes = {}) { const params = { pid: order.merchant_pid, type: order.method, name: order.payment_name,
  money: `${order.amount_minor / 100}.00`, out_trade_no: order.out_trade_no, trade_no: randomUUID().replaceAll('-', ''), param: order.id, trade_status: 'TRADE_SUCCESS', sign_type: 'MD5', ...changes };
  params.sign = sign(params); return params; }
function notify(f, row, changes = {}, args = {}) { return call(f, `/v1/payments/zpay/subscription/notify?${new URLSearchParams(callback(row, changes))}`, { user: null, cookie: null, ...args }); }
async function overview(f, args = {}) { return expect(await call(f, '/v1/subscriptions', args), 200); }
function checkin(f, subscriptionId, extra = {}, args = {}) { return call(f, '/v1/subscriptions/checkin', { method: 'POST', body: { accountId: f.user.id,
  subscriptionId, requestId: randomUUID(), provider: 'zpay', mode: 'live', ...extra }, ...args }); }
async function activate(f, extra = {}) { const row = await newOrder(f, extra); expect(await notify(f, row), 200); return { row, period: (await overview(f)).subscriptions.find(item => item.orderId === row.id) }; }
function queryFact(row, changes = {}) { return { code: 1, pid: PID, type: row.method, name: row.payment_name, money: `${row.amount_minor / 100}.00`,
  out_trade_no: row.out_trade_no, trade_no: randomUUID().replaceAll('-', ''), param: row.id, status: 1, ...changes }; }

test('subscriptions default closed and strict versioned plan configuration never manufactures purchasable draft rights', async () => {
  const f = await fixture();
  const defaultConfig = expect(await call(f, '/v1/subscriptions/config', { user: null, env: { ...f.env, SUBSCRIPTION_ENABLED: undefined, SUBSCRIPTION_PLANS_JSON: undefined } }), 200);
  assert.equal(defaultConfig.enabled, false); assert.deepEqual(defaultConfig.plans, []); assert.equal(defaultConfig.autoRenew, false);
  const good = expect(await call(f, '/v1/subscriptions/config', { user: null }), 200); assert.equal(good.enabled, true); assert.equal(good.renewal, 'manual'); assert.equal(good.timezone, 'Asia/Shanghai');
  assert.deepEqual(good.plans, [plan()]); assert.equal(good.modelBillingLinked, false); assert.ok(!JSON.stringify(good).includes(KEY));
  for (const config of ['bad-json', '{}', JSON.stringify([plan(), plan()]), JSON.stringify([plan({ dailyCredits: 0 })]), JSON.stringify([plan({ durationDays: 31 })]),
    JSON.stringify([plan({ maxClaims: 31 })]), JSON.stringify([plan({ revision: 0 })]), JSON.stringify([plan({ currency: 'usd' })]),
    JSON.stringify([plan({ timezone: 'UTC' })]), JSON.stringify([plan({ amountMinor: 0.1 })]), JSON.stringify([plan({ evil: 'extra' })]), 'x'.repeat(16385)]) {
    const env = { ...f.env, SUBSCRIPTION_PLANS_JSON: config }; assert.equal(expect(await call(f, '/v1/subscriptions/config', { user: null, env }), 200).enabled, false);
    expect(await checkout(f, {}, { env }), 503);
  }
  for (const changes of [{ SUBSCRIPTION_ENABLED: 'false' }, { SUBSCRIPTION_ENABLED: 'TRUE' }, { ZPAY_ENABLED: 'false' }, { PAYMENT_PROVIDER: 'stripe' }, { ZPAY_KEY: undefined }]) {
    const env = { ...f.env, ...changes }; assert.equal(expect(await call(f, '/v1/subscriptions/config', { env }), 200).enabled, false); expect(await checkout(f, {}, { env }), 503);
  }
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('new subscription collection is closed by default without writing an order', async () => {
  const f = await fixture(), paused = { ...f.env, PAYMENTS_ACCEPTING_ENABLED: undefined };
  const config = expect(await call(f, '/v1/subscriptions/config', { user: null, env: paused }), 200);
  assert.equal(config.enabled, false); assert.equal(config.note, '收款暂时关闭，已有订单和会员权益不受影响。');
  expect(await checkout(f, {}, { env: paused }), 503);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('checkout pins formal account and plan revision, rejects mutable benefits, and checks the session inside SQL', async () => {
  const f = await fixture(); expect(await checkout(f, {}, { user: null, cookie: null }), 401); expect(await checkout(f, {}, { user: { ...f.user, isGuest: true } }), 403);
  expect(await checkout(f, { accountId: randomUUID() }), 409); expect(await checkout(f, { planRevision: 2 }), 409); expect(await checkout(f, { planRevision: undefined }), 409);
  for (const extra of [{ amountMinor: 1 }, { dailyCredits: 10000 }, { maxClaims: 100 }, { expiresAt: null }, { notify_url: 'https://evil.example' },
    { method: ['alipay'] }, { planId: 'unknown' }, { requestId: 'bad' }]) expect(await checkout(f, extra), 400);
  for (const extra of [{ provider: 'stripe' }, { mode: 'test' }]) expect(await checkout(f, extra), 409);
  await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run(); expect(await checkout(f), 401);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
  expect(await call(f, '/v1/subscriptions/checkout'), 405); expect(await call(f, '/v1/subscriptions/config', { method: 'POST', body: {} }), 405);
});

test('concurrent checkout freezes one price and entitlement, with a strictly bound nonce-CSP same-site form', async () => {
  const f = await fixture(), requestId = randomUUID();
  const results = await Promise.all(Array.from({ length: 20 }, () => checkout(f, { requestId })));
  results.forEach(result => expect(result, 200, 201)); assert.equal(new Set(results.map(result => result.data.order.id)).size, 1);
  const row = await DB.prepare('SELECT * FROM subscription_orders WHERE id=?').bind(results[0].data.order.id).first();
  assert.equal(row.amount_minor, 2800); assert.equal(row.daily_credits, 100); assert.equal(row.plan_revision, 1); assert.equal(results[0].data.order.subscriptionId, null);
  assert.equal(results[0].data.checkoutUrl, `https://qingyu.invalid/api/payments/zpay/subscription/checkout/${row.id}`);
  assert.match(row.out_trade_no, /^[1-9]\d{31}$/); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_payment_bindings WHERE subscription_order_id=?').bind(row.id).first()).n, 1);
  const stranger = await fixture(); expect(await call(stranger, `/v1/payments/zpay/subscription/checkout/${row.id}`), 404);
  const form = await call(f, `/v1/payments/zpay/subscription/checkout/${row.id}`); expect(form, 200);
  const fields = Object.fromEntries([...form.data.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(([, name, value]) => [name, value.replaceAll('&amp;', '&')]));
  assert.equal(fields.money, '28.00'); assert.equal(fields.param, row.id); assert.equal(fields.sign, sign(fields));
  assert.equal(fields.notify_url, 'https://qingyu.invalid/api/payments/zpay/subscription/notify'); assert.equal(fields.return_url, 'https://qingyu.invalid/api/payments/zpay/subscription/return');
  assert.match(form.headers.get('Content-Security-Policy'), /form-action https:\/\/zpayz\.cn/); assert.match(form.data, /<script nonce="[a-f0-9]+">/);
  assert.equal(form.headers.get('Referrer-Policy'), 'no-referrer'); assert.equal(form.headers.get('Cache-Control'), 'no-store'); assert.ok(!form.data.includes(KEY));
  const updated = { ...f.env, SUBSCRIPTION_PLANS_JSON: JSON.stringify([plan({ revision: 2, amountMinor: 8800, dailyCredits: 350 })]) };
  expect(await checkout(f, { requestId, planRevision: 2 }, { env: updated }), 409);
  // Historical order claims are based on its immutable snapshot, not today's catalogue.
  expect(await notify(f, row, {}, { env: { ...updated, SUBSCRIPTION_ENABLED: 'false' } }), 200);
  const state = await overview(f); assert.equal(state.subscriptions[0].dailyCredits, 100); assert.equal(state.subscriptions[0].planRevision, 1); assert.equal(state.balance, 0);
});

test('lost checkout receipts recover the frozen order by request UUID using only owner-bound SELECTs and no provider calls', async () => {
  const f = await fixture(), requestId = randomUUID();
  // The create has committed; the caller can lose this response and retain only its request UUID.
  expect(await checkout(f, { requestId, method: 'wxpay' }), 201);
  const original = await DB.prepare('SELECT * FROM subscription_orders WHERE user_id=? AND request_id=?').bind(f.user.id, requestId).first();
  const reads = [], readOnly = { prepare(sql) {
    assert.match(sql.trim(), /^SELECT\b/i, 'receipt lookup must not mutate D1 or rate-limit'); reads.push(sql); return DB.prepare(sql);
  }, batch() { assert.fail('receipt lookup must not activate, claim, or read a mutable overview'); } };
  const providerForbidden = async () => assert.fail('receipt lookup must not query the provider');
  const scenarios = [f.env,
    { ...f.env, SUBSCRIPTION_PLANS_JSON: JSON.stringify([plan({ id: 'another_plan', revision: 2, amountMinor: 8800, dailyCredits: 350 })]) },
    { ...f.env, SUBSCRIPTION_ENABLED: 'false', ZPAY_ENABLED: 'false', PAYMENT_PROVIDER: 'stripe', ZPAY_KEY: undefined, SUBSCRIPTION_PLANS_JSON: 'bad-json' }];
  for (const scenario of scenarios) {
    const result = await call(f, `/v1/subscriptions/requests/${requestId.toUpperCase()}`, { user: null,
      env: { ...scenario, DB: readOnly }, options: { zpayFetch: providerForbidden } });
    const receipt = expect(result, 200);
    assert.deepEqual(Object.keys(receipt).sort(), ['accountId', 'mode', 'order', 'provider', 'requestId', 'testMode']);
    assert.equal(receipt.accountId, f.user.id); assert.equal(receipt.requestId, requestId);
    assert.equal(receipt.provider, 'zpay'); assert.equal(receipt.mode, 'live'); assert.equal(receipt.testMode, false);
    assert.equal(receipt.order.id, original.id); assert.equal(receipt.order.accountId, f.user.id); assert.equal(receipt.order.planId, 'monthly_basic');
    assert.equal(receipt.order.planRevision, 1); assert.equal(receipt.order.method, 'wxpay'); assert.equal(receipt.order.label, '月卡测试');
    assert.equal(receipt.order.amountMinor, 2800); assert.equal(receipt.order.dailyCredits, 100); assert.equal(receipt.order.durationDays, 30);
    assert.equal(receipt.order.maxClaims, 30); assert.equal(receipt.order.timezone, 'Asia/Shanghai'); assert.equal(receipt.order.currency, 'cny');
    assert.equal(receipt.order.status, 'pending'); assert.equal(receipt.order.subscriptionId, null); assert.equal(receipt.order.paidAt, null);
    assert.equal(receipt.order.checkoutUrl, original.checkout_url); assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.ok(!JSON.stringify(receipt).includes(KEY));
    for (const field of ['merchant_pid', 'channel_id', 'payment_name', 'out_trade_no', 'provider_trade_no', 'ZPAY_KEY']) assert.ok(!(field in receipt.order));
  }
  assert.equal(reads.length, scenarios.length * 2); // Session SELECT and owner-bound order SELECT only.
  assert.equal(f.api.calls.length, 0);
  assert.deepEqual(await DB.prepare('SELECT * FROM subscription_orders WHERE id=?').bind(original.id).first(), original);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_payment_bindings WHERE subscription_order_id=?').bind(original.id).first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_events WHERE order_id=?').bind(original.id).first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_periods WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('request receipts return null for uncommitted or foreign requests and the same UUID is scoped to each account', async () => {
  const owner = await fixture(), stranger = await fixture(), requestId = randomUUID(), row = await newOrder(owner, { requestId });
  const missingId = randomUUID(), missing = expect(await call(owner, `/v1/subscriptions/requests/${missingId}`), 200);
  assert.equal(missing.order, null); assert.equal(missing.requestId, missingId); assert.equal(missing.accountId, owner.user.id);
  const foreign = expect(await call(stranger, `/v1/subscriptions/requests/${requestId}`, { user: null }), 200);
  assert.equal(foreign.order, null); assert.equal(foreign.accountId, stranger.user.id); assert.equal(foreign.requestId, requestId);
  assert.ok(!JSON.stringify(foreign).includes(owner.user.id)); assert.ok(!JSON.stringify(foreign).includes(row.id));
  const own = await newOrder(stranger, { requestId, method: 'wxpay' });
  assert.equal(expect(await call(owner, `/v1/subscriptions/requests/${requestId}`), 200).order.id, row.id);
  const recovered = expect(await call(stranger, `/v1/subscriptions/requests/${requestId}`), 200).order;
  assert.equal(recovered.id, own.id); assert.equal(recovered.method, 'wxpay'); assert.equal(recovered.accountId, stranger.user.id);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_orders WHERE request_id=?').bind(requestId).first()).n, 2);
});

test('request recovery requires a current formal session, a UUID, and GET before reading an order', async () => {
  const f = await fixture(), row = await newOrder(f), path = `/v1/subscriptions/requests/${row.request_id}`;
  expect(await call(f, path, { user: null, cookie: null }), 401);
  expect(await call(f, path, { user: null, cookie: randomBytes(32).toString('hex') }), 401);
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) expect(await call(f, path, { method }), 405);
  for (const requestId of ['invalid', row.id, 'null', `${row.request_id}x`, '%27OR%201%3D1']) {
    expect(await call(f, `/v1/subscriptions/requests/${requestId}`), 400);
  }
  await DB.prepare('UPDATE users SET is_guest=1 WHERE id=?').bind(f.user.id).run();
  expect(await call(f, path, { user: null }), 403);
  await DB.prepare('UPDATE users SET is_guest=0 WHERE id=?').bind(f.user.id).run();
  await DB.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(f.hash).run();
  expect(await call(f, path, { user: null }), 401);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_orders WHERE user_id=?').bind(f.user.id).first()).n, 1);
});

test('paid request receipts include the existing subscription identity without querying or activating again', async () => {
  const f = await fixture(), { row, period } = await activate(f);
  const original = await DB.prepare('SELECT * FROM subscription_orders WHERE id=?').bind(row.id).first();
  const events = (await DB.prepare('SELECT * FROM subscription_events WHERE order_id=?').bind(row.id).all()).results;
  const receipt = expect(await call(f, `/v1/subscriptions/requests/${row.request_id}`, {
    options: { zpayFetch: async () => assert.fail('paid receipt must not query the provider') } }), 200);
  assert.equal(receipt.order.id, row.id); assert.equal(receipt.order.subscriptionId, period.id); assert.equal(receipt.order.status, 'paid');
  assert.equal(receipt.order.paidAt, original.paid_at); assert.equal(f.api.calls.length, 0);
  assert.deepEqual(await DB.prepare('SELECT * FROM subscription_orders WHERE id=?').bind(row.id).first(), original);
  assert.deepEqual((await DB.prepare('SELECT * FROM subscription_events WHERE order_id=?').bind(row.id).all()).results, events);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_periods WHERE order_id=?').bind(row.id).first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('subscription callbacks reject signature, exact amount, merchant, channel and frozen-name mismatches before activation', async () => {
  const f = await fixture(), row = await newOrder(f), valid = callback(row);
  expect(await call(f, `/v1/payments/zpay/subscription/notify?${new URLSearchParams({ ...valid, sign: '0'.repeat(32) })}`, { user: null }), 400);
  expect(await call(f, `/v1/payments/zpay/subscription/notify?${new URLSearchParams(valid)}&money=28.00`, { user: null }), 400);
  expect(await call(f, `/v1/payments/zpay/subscription/notify?${new URLSearchParams(valid)}&padding=${'x'.repeat(9000)}`, { user: null }), 400);
  for (const changes of [{ money: '1.00' }, { money: '28.001' }, { money: '2.8e1' }, { pid: 'another' }, { type: 'wxpay' }, { name: 'changed' },
    { param: `zp_${randomUUID()}` }, { out_trade_no: '8'.repeat(32) }, { trade_no: 'bad id' }, { sign_type: 'SHA256' }]) expect(await notify(f, row, changes), 400);
  expect(await notify(f, row, { trade_status: 'WAIT_BUYER_PAY' }), 200); assert.deepEqual((await overview(f)).subscriptions, []); assert.equal((await overview(f)).balance, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_events WHERE order_id=?').bind(row.id).first()).n, 0);
});

test('browser return never activates or grants and redirects only to a canonical bound subscription receipt', async () => {
  const f = await fixture(), row = await newOrder(f), params = callback(row);
  const returned = await call(f, `/v1/payments/zpay/subscription/return?${new URLSearchParams(params)}`, { user: null });
  assert.equal(returned.status, 303); assert.equal(returned.headers.get('Location'), `https://qingyu.invalid/?payment_order=${row.id}&payment=success#recharge`);
  assert.deepEqual((await overview(f)).subscriptions, []); assert.equal((await overview(f)).balance, 0);
  const invalid = await call(f, `/v1/payments/zpay/subscription/return?${new URLSearchParams({ ...params, sign: '0'.repeat(32) })}`, { user: null });
  assert.equal(invalid.headers.get('Location'), 'https://qingyu.invalid/#recharge');
  expect(await notify(f, row), 200); const form = await call(f, `/v1/payments/zpay/subscription/checkout/${row.id}`); assert.equal(form.status, 303); assert.equal(form.headers.get('Location'), returned.headers.get('Location'));
});

test('twenty concurrent payment notifications create one thirty-day period and grant no upfront daily credits', async () => {
  const f = await fixture(), row = await newOrder(f), trade_no = 'sameSubscriptionTrade';
  const results = await Promise.all(Array.from({ length: 20 }, () => notify(f, row, { trade_no })));
  results.forEach(result => { expect(result, 200); assert.equal(result.data, 'success'); });
  const state = await overview(f); assert.equal(state.subscriptions.length, 1); assert.equal(state.balance, 0); assert.equal(state.totalSubscriptionGranted, 0);
  assert.equal(state.subscriptions[0].startsAt, BASE); assert.equal(state.subscriptions[0].expiresAt, BASE + 30 * DAY); assert.equal(state.subscriptions[0].claimsCount, 0);
  const detail = expect(await call(f, `/v1/subscriptions/orders/${row.id}`), 200); assert.equal(detail.order.subscriptionId, state.subscriptions[0].id);
  assert.equal(detail.order.status, 'paid'); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_events WHERE order_id=?').bind(row.id).first()).n, 1);
});

test('concurrent distinct purchases queue consecutive periods and one transaction number cannot buy two subscriptions', async () => {
  const f = await fixture(), rows = await Promise.all(Array.from({ length: 3 }, () => newOrder(f)));
  (await Promise.all(rows.map(row => notify(f, row)))).forEach(result => expect(result, 200));
  const periods = (await overview(f)).subscriptions.sort((a, b) => a.startsAt - b.startsAt);
  assert.equal(periods.length, 3); assert.deepEqual(periods.map(period => period.startsAt), [BASE, BASE + 30 * DAY, BASE + 60 * DAY]);
  assert.deepEqual(periods.map(period => period.expiresAt), [BASE + 30 * DAY, BASE + 60 * DAY, BASE + 90 * DAY]);
  assert.equal(periods.filter(period => period.status === 'active').length, 1);
  expect(await checkin(f, periods[1].id), 409); assert.equal((await overview(f)).balance, 0);
  const a = await newOrder(f), b = await newOrder(f), trade_no = 'sharedSubscriptionTrade';
  const race = await Promise.all([notify(f, a, { trade_no }), notify(f, b, { trade_no })]);
  assert.equal(race.filter(result => result.status === 200).length, 1); assert.equal(race.filter(result => result.status === 400).length, 1);
  assert.equal((await overview(f)).subscriptions.length, 4);
});

test('recharge and subscription payment facts racing with the same provider trade fulfill only one business intent', async () => {
  const f = await fixture(), subscription = await newOrder(f);
  const recharge = expect(await call(f, '/v1/payments/checkout', { payment: true, method: 'POST', body: { accountId: f.user.id, requestId: randomUUID(),
    provider: 'zpay', mode: 'live', method: 'alipay', packageId: 'cny_28' } }), 201);
  const rechargeRow = await DB.prepare('SELECT * FROM zpay_orders WHERE id=?').bind(recharge.order.id).first(), trade_no = 'sharedRechargeAndSubscriptionTrade';
  const results = await Promise.all([notify(f, subscription, { trade_no }), call(f, `/v1/payments/zpay/notify?${new URLSearchParams(callback(rechargeRow, { trade_no }))}`, { payment: true, user: null })]);
  assert.equal(results.filter(result => result.status === 200).length, 1); assert.equal(results.filter(result => result.status === 400).length, 1);
  const state = await overview(f); assert.equal((state.balance === 2800 ? 1 : 0) + state.subscriptions.length, 1); assert.ok([0, 2800].includes(state.balance));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_payment_bindings WHERE provider_trade_no=?').bind(trade_no).first()).n, 1);
  const stranger = await fixture(), strangerOrder = await newOrder(stranger); expect(await notify(stranger, strangerOrder, { trade_no }), 400); assert.deepEqual((await overview(stranger)).subscriptions, []);
});

test('pending query verifies canonical identity and query/notify races activate once while unpaid and network failures do not revoke', async () => {
  const f = await fixture(), row = await newOrder(f); f.api.result = queryFact(row, { status: 0 });
  assert.equal(expect(await call(f, `/v1/subscriptions/orders/${row.id}`), 200).order.status, 'pending');
  for (const changes of [{ money: '1.00' }, { pid: 'another' }, { type: 'wxpay' }, { name: 'other' }, { param: `sp_${randomUUID()}` }, { status: 2 }]) {
    f.api.result = queryFact(row, changes); expect(await call(f, `/v1/subscriptions/orders/${row.id}`), 400, 502);
  }
  expect(await call(f, `/v1/subscriptions/orders/${row.id}`, { options: { zpayFetch: async () => new Response(null, { status: 302 }) } }), 503);
  assert.deepEqual((await overview(f)).subscriptions, []);
  let release, started; const start = new Promise(resolve => { started = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const fact = queryFact(row), detail = call(f, `/v1/subscriptions/orders/${row.id}`, { options: { zpayFetch: async () => { started(); await hold; return Response.json(fact); } } });
  await start; expect(await notify(f, row, { trade_no: fact.trade_no }), 200); release();
  assert.equal(expect(await detail, 200).order.status, 'paid'); assert.equal((await overview(f)).subscriptions.length, 1);
  const calls = f.api.calls.length; f.api.result = queryFact(row, { status: 0 }); expect(await call(f, `/v1/subscriptions/orders/${row.id}`), 200);
  assert.equal(f.api.calls.length, calls); assert.equal((await overview(f)).subscriptions[0].status, 'active');
});

test('concurrent daily claims grant one exact credit receipt even when new purchases and payment configuration are disabled', async () => {
  const f = await fixture(), { period } = await activate(f), disabled = { ...f.env, SUBSCRIPTION_ENABLED: 'false', ZPAY_ENABLED: 'false', PAYMENT_PROVIDER: 'stripe', ZPAY_KEY: undefined };
  const results = await Promise.all(Array.from({ length: 20 }, () => checkin(f, period.id, {}, { env: disabled })));
  assert.equal(results.filter(result => result.status === 201).length, 1); results.forEach(result => expect(result, 200, 201));
  assert.equal(new Set(results.map(result => result.data.claim.id)).size, 1);
  const state = await overview(f); assert.equal(state.balance, 100); assert.equal(state.totalSubscriptionGranted, 100); assert.equal(state.checkin.claimed, true); assert.equal(state.checkin.claimable, false);
  assert.equal(state.subscriptions[0].claimsCount, 1); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n, 1);
  const wallet = expect(await call(f, '/v1/payments/wallet', { payment: true }), 200); assert.equal(wallet.balance, 100); assert.equal(wallet.totalPurchased, 0); assert.equal(wallet.totalSubscriptionGranted, 100);
});

test('daily eligibility resets at Shanghai midnight, not UTC midnight, using only server time', async () => {
  const f = await fixture(); f.now = Date.parse('2026-10-05T15:00:00Z'); const { period } = await activate(f);
  f.now = Date.parse('2026-10-05T15:59:59.999Z'); const first = expect(await checkin(f, period.id), 201);
  assert.equal(first.claim.dayKey, '2026-10-05'); assert.equal(first.checkin.resetAt, Date.parse('2026-10-05T16:00:00Z'));
  f.now++; const next = expect(await checkin(f, period.id), 201); assert.equal(next.claim.dayKey, '2026-10-06'); assert.equal(next.balance, 200);
  f.now = Date.parse('2026-10-06T00:00:00Z'); expect(await checkin(f, period.id), 200); assert.equal((await overview(f)).balance, 200);
  assert.equal((await overview(f)).checkin.resetAt, Date.parse('2026-10-06T16:00:00Z'));
});

test('checkin samples the Shanghai date after async rate limits and rejects a period that expires during that wait', async () => {
  for (const expiresDuringWait of [false, true]) {
    const f = await fixture(); f.now = Date.parse('2026-10-07T15:59:59.999Z');
    const before = f.now, after = before + 1000, { period } = await activate(f);
    if (expiresDuringWait) {
      const expires = before + 1;
      await DB.prepare('UPDATE subscription_periods SET starts_at=?,expires_at=? WHERE id=?').bind(expires - 30 * DAY, expires, period.id).run();
    }
    const delayed = { prepare(sql) {
      const statement = DB.prepare(sql);
      if (!sql.includes('INSERT INTO auth_rate_limits')) return statement;
      return { bind(...values) { const bound = statement.bind(...values); return { async first() {
        const result = await bound.first(); f.now = after; return result;
      } }; } };
    }, batch: statements => DB.batch(statements) };
    const result = await checkin(f, period.id, {}, { env: { ...f.env, DB: delayed } });
    if (expiresDuringWait) {
      expect(result, 409);
      assert.equal(result.data.overview.serverTime, after);
      assert.equal(result.data.overview.checkin.dayKey, '2026-10-08');
      assert.equal(result.data.overview.subscriptions[0].status, 'expired');
      assert.equal(result.data.overview.balance, 0);
    } else {
      const claimed = expect(result, 201);
      assert.equal(claimed.serverTime, after);
      assert.equal(claimed.claim.dayKey, '2026-10-08');
      assert.equal(claimed.checkin.claimed, true);
      assert.equal(claimed.balance, 100);
    }
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_daily_claims WHERE user_id=? AND day_key=?').bind(f.user.id, '2026-10-07').first()).n, 0);
  }
});

test('production D1 clock denies an expired period even when the application sampled an older valid time', async () => {
  const f = await fixture(), { period } = await activate(f);
  const realNow = Date.now, expiredAt = realNow() - 1000;
  await DB.prepare('UPDATE subscription_periods SET starts_at=?,expires_at=? WHERE id=?').bind(expiredAt - 30 * DAY, expiredAt, period.id).run();
  const sampled = expiredAt - 1;
  try {
    Date.now = () => sampled;
    const rejected = expect(await checkin(f, period.id, {}, { options: { now: undefined } }), 409);
    assert.ok(rejected.overview.serverTime >= expiredAt);
    assert.equal(rejected.overview.subscriptions[0].status, 'expired');
    assert.equal(rejected.overview.checkin.claimable, false);
  } finally { Date.now = realNow; }
  assert.equal((await overview(f, { options: { now: realNow } })).subscriptions[0].status, 'expired');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_daily_claims WHERE user_id=?').bind(f.user.id).first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('a day change while D1 is executing returns a fresh conflict overview rather than an old-day receipt', async () => {
  const f = await fixture(); f.now = Date.parse('2026-10-07T15:59:59.999Z');
  const { period } = await activate(f), after = f.now + 1000;
  const delayed = { prepare: sql => DB.prepare(sql), async batch(statements) {
    const result = await DB.batch(statements); f.now = after; return result;
  } };
  const result = expect(await checkin(f, period.id, {}, { env: { ...f.env, DB: delayed } }), 409);
  assert.equal(result.overview.serverTime, after);
  assert.equal(result.overview.checkin.dayKey, '2026-10-08');
  assert.equal(result.overview.checkin.claimable, true);
  assert.equal(result.overview.balance, 100); // The pre-midnight commit remains earned.
  const receipt = expect(await checkin(f, period.id), 201);
  assert.equal(receipt.claim.dayKey, '2026-10-08');
  assert.equal(receipt.balance, 200);
});

test('rolling thirty-day periods permit at most thirty daily claims and earned credits persist after exact expiry', async () => {
  const f = await fixture(), { period } = await activate(f);
  for (let i = 0; i < 30; i++) { f.now = BASE + i * DAY; expect(await checkin(f, period.id), 201); }
  f.now = period.expiresAt - 1; const before = await overview(f); assert.equal(before.subscriptions[0].status, 'active'); assert.equal(before.checkin.claimable, false);
  expect(await checkin(f, period.id), 409); assert.equal(before.balance, 3000);
  f.now = period.expiresAt; assert.equal((await overview(f)).subscriptions[0].status, 'expired'); expect(await checkin(f, period.id), 409);
  f.now += 100 * DAY; assert.equal((await overview(f)).balance, 3000); assert.equal((await overview(f)).totalSubscriptionGranted, 3000);
});

test('renewal boundary cannot double a daily grant and uses each paid period frozen benefit after the next reset', async () => {
  const f = await fixture(), first = await activate(f); f.env.SUBSCRIPTION_PLANS_JSON = JSON.stringify([plan({ revision: 2, dailyCredits: 350, amountMinor: 8800 })]);
  const second = await activate(f, { planRevision: 2 }); assert.equal(second.period.status, 'queued'); assert.equal(second.period.startsAt, first.period.expiresAt);
  f.now = first.period.expiresAt - 1; expect(await checkin(f, first.period.id), 201);
  f.now++; expect(await checkin(f, second.period.id), 409); assert.equal((await overview(f)).balance, 100);
  assert.equal((await overview(f)).checkin.subscriptionId, first.period.id); // Today's receipt stays bound to the period that granted it.
  f.now = (await overview(f)).checkin.resetAt; const next = expect(await checkin(f, second.period.id), 201); assert.equal(next.claim.credits, 350); assert.equal(next.balance, 450);
});

test('claims reject stale accounts, forged days and credits, queued/foreign/revoked periods, and revoked sessions inside the transaction', async () => {
  const f = await fixture(), { period } = await activate(f), stranger = await fixture(), foreign = await activate(stranger);
  expect(await checkin(f, period.id, { accountId: stranger.user.id }), 409); expect(await checkin(f, foreign.period.id), 409);
  for (const extra of [{ credits: 99999 }, { dayKey: 'tomorrow' }, { expiresAt: null }, { subscriptionId: 'invalid' }, { requestId: 'invalid' }]) expect(await checkin(f, period.id, extra), 400);
  expect(await checkin(f, period.id, {}, { user: { ...f.user, isGuest: true } }), 403);
  await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run(); expect(await checkin(f, period.id), 409);
  assert.equal((await overview(f)).balance, 0);
  await DB.prepare('UPDATE subscription_periods SET revoked_at=? WHERE id=?').bind(BASE, foreign.period.id).run(); expect(await checkin(stranger, foreign.period.id), 409);
  assert.equal((await overview(stranger)).subscriptions[0].status, 'revoked'); assert.equal((await overview(stranger)).balance, 0);
});

test('a claim receipt remains consistent when its period expires or is revoked later on the same Shanghai day', async () => {
  const f = await fixture(), { period } = await activate(f); f.now = period.expiresAt - 1;
  const receipt = expect(await checkin(f, period.id), 201); f.now++;
  const expired = await overview(f); assert.equal(expired.checkin.claimed, true); assert.equal(expired.checkin.subscriptionId, period.id);
  assert.equal(expired.checkin.claimable, false); assert.equal(expired.checkin.rewardCredits, receipt.claim.credits); assert.equal(expired.balance, 100);
  await DB.prepare('UPDATE subscription_periods SET revoked_at=? WHERE id=?').bind(f.now, period.id).run();
  const revoked = await overview(f); assert.equal(revoked.checkin.subscriptionId, period.id); assert.equal(revoked.checkin.claimedAt, receipt.claim.claimedAt);
});

test('D1 failures roll back payment activation and daily grants together so unchanged signed facts and claim requests can retry', async () => {
  const f = await fixture(), row = await newOrder(f), fact = { trade_no: 'rollbackSubscriptionTrade' };
  const brokenActivation = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare('UPDATE subscription_orders SET daily_credits=0 WHERE id=?').bind(row.id)]) };
  await assert.rejects(notify(f, row, fact, { env: { ...f.env, DB: brokenActivation } }), /CHECK constraint/);
  assert.deepEqual((await overview(f)).subscriptions, []); assert.equal((await DB.prepare('SELECT provider_trade_no FROM zpay_payment_bindings WHERE subscription_order_id=?').bind(row.id).first()).provider_trade_no, null);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_events WHERE order_id=?').bind(row.id).first()).n, 0);
  expect(await notify(f, row, fact), 200); const period = (await overview(f)).subscriptions[0];
  const brokenClaim = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare('UPDATE subscription_daily_claims SET credits=0 WHERE user_id=?').bind(f.user.id)]) };
  const requestId = randomUUID(); await assert.rejects(checkin(f, period.id, { requestId }, { env: { ...f.env, DB: brokenClaim } }), /CHECK constraint/);
  assert.equal((await overview(f)).balance, 0); assert.equal((await overview(f)).checkin.claimed, false);
  expect(await checkin(f, period.id, { requestId }), 201); expect(await checkin(f, period.id, { requestId }), 200); assert.equal((await overview(f)).balance, 100);
});

test('subscription migration preserves every old payment row, sequence and community claim while backfilling paid and pending trade bindings', async () => {
  const migrationStore = memoryStore('subscription-migration-tests');
  try {
    const database = await migrationStore.getD1Database('DB'); await migrate(database, migrations.filter(file => file < '0013_subscriptions.sql'));
    const f = await fixture(database), now = BASE, paidId = `zp_${randomUUID()}`, pendingId = `zp_${randomUUID()}`, stripeId = `pay_${randomUUID()}`;
    function orderStatement(id, outTradeNo, status, tradeNo) { return database.prepare(`INSERT INTO zpay_orders(id,user_id,request_id,package_id,amount_minor,credits,method,out_trade_no,
      merchant_pid,channel_id,payment_name,provider_trade_no,checkout_url,status,created_at,updated_at,paid_at,refunded_amount_minor,refunded_credits)
      VALUES(?,?,?,'cny_1',100,100,'alipay',?,?,'123','历史100点',?,?,?,1,2,?,20,20)`).bind(id, f.user.id, randomUUID(), outTradeNo, PID, tradeNo, `https://qingyu.invalid/api/payments/zpay/checkout/${id}`, status, status === 'paid' ? now : null); }
    await database.batch([
      orderStatement(paidId, '1'.repeat(32), 'paid', 'historicalPaidTrade'), orderStatement(pendingId, '2'.repeat(32), 'pending', null),
      database.prepare("INSERT INTO zpay_events VALUES('old_zp_event','notify',?,'historicalPaidTrade','oldToken',1)").bind(paidId),
      database.prepare("INSERT INTO zpay_credit_ledger VALUES(17,?,?,'old_zp_event','purchase',100,1)").bind(paidId, f.user.id),
      database.prepare("INSERT INTO zpay_refund_state VALUES('old_zp_refund',?,20,'confirmed','proof123',2,1,2)").bind(paidId),
      database.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at) VALUES(?,?,?,'usd_5',500,500,'test','paid',1,2,2)").bind(stripeId, f.user.id, randomUUID()),
      database.prepare("INSERT INTO payment_events VALUES('old_stripe_event','charge.refunded',?,'oldStripeToken',1)").bind(stripeId),
      database.prepare("INSERT INTO payment_refunds VALUES('old_stripe_refund',?,20,'usd',1,1,2)").bind(stripeId),
      database.prepare("INSERT INTO payment_credit_ledger VALUES(23,?,?,'old_stripe_event','purchase',500,1)").bind(stripeId, f.user.id),
      database.prepare("INSERT INTO task_claims VALUES(?,'daily_checkin',?,5,?,?)").bind(f.user.id, new Date(now).toISOString().slice(0, 10), now, now + 30 * DAY),
    ]);
    const tables = ['users', 'sessions', 'zpay_orders', 'zpay_events', 'zpay_credit_ledger', 'zpay_refund_state', 'payment_orders', 'payment_events', 'payment_refunds', 'payment_credit_ledger', 'task_claims'];
    const snapshots = await Promise.all(tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const sequences = (await database.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('payment_credit_ledger','zpay_credit_ledger') ORDER BY name").all()).results;
    await migrate(database, ['0013_subscriptions.sql']);
    for (let i = 0; i < tables.length; i++) assert.deepEqual((await database.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results, snapshots[i].results);
    assert.deepEqual((await database.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('payment_credit_ledger','zpay_credit_ledger') ORDER BY name").all()).results, sequences);
    assert.equal(await database.prepare("SELECT seq FROM sqlite_sequence WHERE name='subscription_credit_ledger'").first(), null);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
    const bindings = (await database.prepare('SELECT * FROM zpay_payment_bindings ORDER BY out_trade_no').all()).results;
    assert.equal(bindings.length, 2); assert.equal(bindings[0].recharge_order_id, paidId); assert.equal(bindings[0].provider_trade_no, 'historicalPaidTrade'); assert.equal(bindings[1].provider_trade_no, null);
    const historical = await database.prepare('SELECT * FROM zpay_orders WHERE id=?').bind(pendingId).first();
    // The assertions above isolate 0013's original data-retention guarantee.
    // Current handlers require the current provider/precision schema afterward.
    await migrate(database, migrations.filter(file => file > '0013_subscriptions.sql'));
    expect(await call(f, `/v1/payments/zpay/notify?${new URLSearchParams(callback(historical))}`, { payment: true, user: null }), 200);
    assert.equal((await overview(f)).balance, 205); assert.equal((await overview(f)).totalSubscriptionGranted, 0); // Test paid and reward Credit share the wallet.
    const subscription = await newOrder(f); expect(await notify(f, subscription, { trade_no: 'historicalPaidTrade' }), 400); assert.deepEqual((await overview(f)).subscriptions, []);
  } finally { await migrationStore.dispose(); }
});

test('actual Worker serves the reviewed VIP catalogue while local purchases remain disabled', { skip: !process.env.DZMM_TEST_BASE_URL }, async () => {
  const response = await fetch(`${process.env.DZMM_TEST_BASE_URL}/v1/subscriptions/config`); assert.equal(response.status, 200);
  const config = await response.json(); assert.equal(config.enabled, false); assert.equal(config.autoRenew, false);
  assert.deepEqual(config.plans, [{ id: 'vip_monthly', label: '晴屿 VIP', revision: 2, amountMinor: 2800,
    currency: 'cny', durationDays: 30, dailyCredits: 500, maxClaims: 30, timezone: 'Asia/Shanghai' }]);
});
