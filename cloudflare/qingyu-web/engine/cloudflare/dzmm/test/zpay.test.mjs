import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Real D1 transactions, isolated workerd storage, provider HTTP mocked only by
// the handler's dependency injection. No credentials or remote payments exist.
const { handlePaymentsApi } = await tsImport('../src/payments.ts', import.meta.url);
const { renderZpayForm, zpaySignature } = await tsImport('../src/zpay.ts', import.meta.url);
const PID = '12345678', KEY = 'isolated_zpay_merchant_key_2026';
let store, DB;
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
function memoryStore(id) { return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
  script: 'export default {fetch(){return new Response("isolated zpay store")}}', d1Databases: { DB: id } })); }
before(async () => { store = memoryStore('zpay-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });

async function fixture() {
  const user = { id: randomUUID(), email: `${randomUUID()}@zpay.example.test`, nickname: '通道测试用户', isGuest: false, role: 'user', version: 0 };
  await DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id, user.email, user.nickname, Date.now()).run();
  const env = { DB, APP_ORIGINS: 'https://qingyu.invalid', PAYMENT_PROVIDER: 'zpay', ZPAY_ENABLED: 'true', ZPAY_PID: PID, ZPAY_KEY: KEY,
    ZPAY_ALIPAY_CHANNEL_ID: '123', ZPAY_WXPAY_CHANNEL_ID: '456', STRIPE_PAYMENT_MODE: 'test', PAYMENTS_ACCEPTING_ENABLED: 'true' };
  const api = { result: { code: -1, msg: 'not yet created' }, calls: [], fail: false,
    async fetch(input, init) {
      const url = new URL(input); assert.equal(url.origin, 'https://zpayz.cn'); assert.equal(url.pathname, '/api.php');
      assert.equal(url.searchParams.get('act'), 'order'); assert.equal(url.searchParams.get('pid'), PID); assert.equal(url.searchParams.get('key'), KEY);
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
      this.calls.push(url.searchParams.get('out_trade_no'));
      if (this.fail) throw new Error(`private provider URL ${input}`);
      return Response.json(this.result);
    } };
  return { user, env, api };
}
async function call(f, path, { method = 'GET', body, user = f.user, env = f.env, options = {} } = {}) {
  const request = new Request(`https://qingyu.invalid${path}`, { method, headers: { 'CF-Connecting-IP': f.user.id,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let response;
  try { response = await handlePaymentsApi(request, env, user, { zpayFetch: f.api.fetch.bind(f.api), ...options }); }
  catch (error) { if (!Number.isInteger(error.status)) throw error; response = Response.json({ error: error.message }, { status: error.status }); }
  assert.ok(response);
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
function expect(result, ...statuses) { assert.ok(statuses.includes(result.status), JSON.stringify({ status: result.status, data: result.data })); return result.data; }
function checkout(f, extra = {}, args = {}) { return call(f, '/v1/payments/checkout', { method: 'POST', body: { provider: 'zpay', method: 'alipay',
  accountId: f.user.id, packageId: 'cny_28', requestId: randomUUID(), mode: 'live', ...extra }, ...args }); }
async function order(f, extra = {}) { return DB.prepare('SELECT * FROM zpay_orders WHERE id=?').bind(expect(await checkout(f, extra), 201).order.id).first(); }
async function wallet(f, args = {}) { return expect(await call(f, '/v1/payments/wallet', args), 200); }
function independentSign(parameters, key = KEY) {
  return createHash('md5').update(Object.entries(parameters).filter(([name, value]) => !['sign', 'sign_type'].includes(name) && value !== '')
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => `${name}=${value}`).join('&') + key).digest('hex');
}
function callback(row, changes = {}) {
  const params = { pid: row.merchant_pid, name: row.payment_name, money: `${row.amount_minor / 100}.00`, out_trade_no: row.out_trade_no,
    trade_no: `20261004${randomUUID().replaceAll('-', '')}`, param: row.id, trade_status: 'TRADE_SUCCESS', type: row.method, sign_type: 'MD5', ...changes };
  params.sign = independentSign(params); return params;
}
function notify(f, params, args = {}) { return call(f, `/v1/payments/zpay/notify?${new URLSearchParams(params)}`, { user: null, ...args }); }
function queryFact(row, changes = {}) { return { code: 1, pid: PID, type: row.method, trade_no: `20261004${randomUUID().replaceAll('-', '')}`,
  out_trade_no: row.out_trade_no, name: row.payment_name, money: `${row.amount_minor / 100}.00`, param: row.id, status: 1, ...changes }; }
function legacyOrder(userId, major, extra = {}) {
  const id = `zp_${randomUUID()}`, timestamp = 1750000000000;
  return { id, user_id: userId, request_id: randomUUID(), package_id: `cny_${major}`, amount_minor: major * 100,
    currency: 'cny', credits: major * 100, method: 'alipay', out_trade_no: `1${String(major).padStart(31, '0')}`,
    merchant_pid: PID, channel_id: '123', payment_name: `晴屿充值点数 · ${major * 100} 点`, provider_trade_no: null,
    checkout_url: `https://qingyu.invalid/api/payments/zpay/checkout/${id}`, status: 'pending', refunded_amount_minor: 0,
    refunded_credits: 0, created_at: timestamp, updated_at: timestamp, paid_at: null, ...extra };
}
function insertHistoricalOrder(database, row) {
  const names = Object.keys(row);
  return database.prepare(`INSERT INTO zpay_orders(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).bind(...Object.values(row));
}

test('official MD5 signature excludes empty/sign fields, orders ASCII keys and signs decoded values without URL encoding', () => {
  const parameters = { b: '微信 & 点', A: '1', a: '', sign: 'ignored', sign_type: 'MD5' };
  const expected = createHash('md5').update(`A=1&b=微信 & 点${KEY}`).digest('hex');
  assert.equal(zpaySignature(parameters, KEY), expected);
  assert.notEqual(zpaySignature({ ...parameters, b: '微信%20%26%20点' }, KEY), expected);
});

test('Zpay config exposes only configured methods, fixed CNY packages and an explicit real-payment gate', async () => {
  const f = await fixture();
  const config = expect(await call(f, '/v1/payments/config', { user: null }), 200);
  assert.equal(config.provider, 'zpay'); assert.equal(config.mode, 'live'); assert.equal(config.testMode, false); assert.equal(config.currency, 'cny');
  assert.equal(config.modelBillingLinked, false); assert.equal(config.enabled, true); assert.match(config.note, /人民币真实扣款.*充值 Credit 与任务、邀请奖励/);
  assert.deepEqual(config.packages.map(pack => [pack.id, pack.amountMinor, pack.credits]), [['cny_28', 2800, 2800], ['cny_88', 8800, 8800], ['cny_188', 18800, 18800]]);
  assert.deepEqual(config.methods, [{ id: 'alipay', label: '支付宝' }, { id: 'wxpay', label: '微信支付' }]);
  assert.deepEqual(expect(await call(f, '/v1/payments/config', { env: { ...f.env, ZPAY_WXPAY_CHANNEL_ID: undefined } }), 200).methods, [{ id: 'alipay', label: '支付宝' }]);
  for (const env of [{ ...f.env, ZPAY_ENABLED: undefined }, { ...f.env, ZPAY_PID: undefined }, { ...f.env, ZPAY_KEY: undefined },
    { ...f.env, ZPAY_ALIPAY_CHANNEL_ID: '0', ZPAY_WXPAY_CHANNEL_ID: 'bad' }]) {
    assert.equal(expect(await call(f, '/v1/payments/config', { env }), 200).enabled, false); expect(await checkout(f, {}, { env }), 503);
  }
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
  assert.ok(!JSON.stringify(config).includes(KEY)); assert.ok(!JSON.stringify(config).includes(PID));
});

test('new Zpay collection is closed by default without writing an order or querying the provider', async () => {
  const f = await fixture(), paused = { ...f.env, PAYMENTS_ACCEPTING_ENABLED: undefined };
  const config = expect(await call(f, '/v1/payments/config', { user: null, env: paused }), 200);
  assert.equal(config.enabled, false); assert.equal(config.note, '收款暂时关闭，已有订单和会员权益不受影响。');
  expect(await checkout(f, {}, { env: paused }), 503);
  assert.equal(f.api.calls.length, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_orders WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('checkout requires formal ownership, pinned provider/mode/method and never accepts client amount, points or URLs', async () => {
  const f = await fixture();
  expect(await checkout(f, {}, { user: null }), 401); expect(await checkout(f, {}, { user: { ...f.user, isGuest: true } }), 403);
  expect(await checkout(f, { accountId: randomUUID() }), 401);
  for (const extra of [{ provider: 'stripe' }, { provider: undefined }, { mode: 'test' }]) expect(await checkout(f, extra), 409);
  for (const extra of [{ amount: '0.01' }, { credits: 99999 }, { currency: 'usd' }, { notify_url: 'https://foreign.example' }, { returnUrl: 'https://foreign.example' },
    { packageId: 'usd_1' }, { packageId: 'cny_1' }, { packageId: 'cny_5' }, { packageId: 'cny_10' },
    { requestId: 'bad-uuid' }, { method: 'card' }, { method: ['alipay'] }, { method: { id: 'alipay' } }]) expect(await checkout(f, extra), 400);
  expect(await checkout(f, { method: 'wxpay' }, { env: { ...f.env, ZPAY_WXPAY_CHANNEL_ID: undefined } }), 503);
  expect(await call(f, '/v1/payments/checkout'), 405); expect(await call(f, '/v1/payments/wallet', { method: 'POST', body: {} }), 405);
  assert.equal((await wallet(f)).balance, 0); assert.equal(f.api.calls.length, 0);
});

test('all three current tiers freeze exact RMB amounts and points in orders, signed forms and verified payments', async () => {
  const f = await fixture(); let purchased = 0;
  for (const [packageId, amountMinor, expectedMoney] of [['cny_28', 2800, '28.00'], ['cny_88', 8800, '88.00'], ['cny_188', 18800, '188.00']]) {
    const receipt = expect(await checkout(f, { packageId }), 201);
    assert.equal(receipt.order.packageId, packageId); assert.equal(receipt.order.amountMinor, amountMinor);
    assert.equal(receipt.order.credits, amountMinor); assert.equal(receipt.order.currency, 'cny');
    const row = await DB.prepare('SELECT * FROM zpay_orders WHERE id=?').bind(receipt.order.id).first();
    assert.equal(row.amount_minor, amountMinor); assert.equal(row.credits, amountMinor);
    const form = expect(await call(f, `/v1/payments/zpay/checkout/${row.id}`), 200);
    assert.ok(form.includes(`name="money" value="${expectedMoney}"`));
    assert.ok(form.includes(`name="name" value="晴屿 AI 对话充值点数 · ${amountMinor} 点"`));
    expect(await notify(f, callback(row, { money: '1.00' })), 400); assert.equal((await wallet(f)).balance, purchased);
    const paid = callback(row); expect(await notify(f, paid), 200); expect(await notify(f, paid), 200);
    purchased += amountMinor; assert.equal((await wallet(f)).balance, purchased); assert.equal((await wallet(f)).totalPurchased, purchased);
  }
  assert.equal(purchased, 30400);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM zpay_credit_ledger WHERE user_id=? AND kind='purchase'").bind(f.user.id).first()).n, 3);
});

test('concurrent checkout uses one local 32-digit order and a same-site unsigned checkout URL', async () => {
  const f = await fixture(), requestId = randomUUID();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => checkout(f, { requestId: i % 2 ? requestId.toUpperCase() : requestId })));
  results.forEach(result => expect(result, 200, 201));
  assert.equal(new Set(results.map(result => result.data.order.id)).size, 1);
  const data = results[0].data, row = await DB.prepare('SELECT * FROM zpay_orders WHERE id=?').bind(data.order.id).first();
  assert.match(row.out_trade_no, /^[1-9]\d{31}$/); assert.match(row.id, /^zp_[a-f0-9-]{36}$/);
  assert.equal(row.amount_minor, 2800); assert.equal(row.credits, 2800); assert.equal(row.payment_name, '晴屿 AI 对话充值点数 · 2800 点');
  assert.equal(data.provider, 'zpay'); assert.equal(data.order.provider, 'zpay'); assert.equal(data.order.method, 'alipay');
  assert.equal(data.checkoutUrl, `https://qingyu.invalid/api/payments/zpay/checkout/${row.id}`);
  assert.ok(!JSON.stringify(data).includes(KEY)); assert.ok(!JSON.stringify(data).includes('sign='));
  expect(await checkout(f, { requestId, packageId: 'cny_88' }), 409); expect(await checkout(f, { requestId, method: 'wxpay' }), 409);
  assert.equal(f.api.calls.length, 0); assert.equal((await wallet(f)).balance, 0);
});

test('owned checkout renders a nonce-CSP POST form to the official endpoint without key, URL queries or client overrides', async () => {
  const f = await fixture(), row = await order(f), stranger = await fixture();
  expect(await call(f, `/v1/payments/zpay/checkout/${row.id}`, { user: null }), 401);
  expect(await call(stranger, `/v1/payments/zpay/checkout/${row.id}`), 404);
  expect(await call(f, `/v1/payments/zpay/checkout/${row.id}`, { env: { ...f.env, ZPAY_ENABLED: 'false' } }), 503);
  const form = await call(f, `/v1/payments/zpay/checkout/${row.id}`); expect(form, 200);
  assert.match(form.data, /method="post" action="https:\/\/zpayz\.cn\/submit\.php"/);
  assert.match(form.headers.get('Content-Security-Policy'), /form-action https:\/\/zpayz\.cn/);
  const nonce = form.data.match(/<script nonce="([a-f0-9]+)">/)[1]; assert.ok(form.headers.get('Content-Security-Policy').includes(`'nonce-${nonce}'`));
  assert.equal(form.headers.get('Referrer-Policy'), 'no-referrer'); assert.equal(form.headers.get('Cache-Control'), 'no-store');
  assert.ok(!form.data.includes(KEY)); assert.ok(!form.data.includes('?sign='));
  const fields = Object.fromEntries([...form.data.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)]
    .map(([, name, value]) => [name, value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")]));
  assert.equal(fields.pid, PID); assert.equal(fields.cid, '123'); assert.equal(fields.money, '28.00'); assert.equal(fields.type, 'alipay');
  assert.equal(fields.out_trade_no, row.out_trade_no); assert.equal(fields.param, row.id);
  assert.equal(fields.notify_url, 'https://qingyu.invalid/api/payments/zpay/notify'); assert.equal(fields.return_url, 'https://qingyu.invalid/api/payments/zpay/return');
  assert.equal(fields.sign, independentSign(fields)); assert.equal((await wallet(f)).balance, 0);
});

test('checkout form policy permits the observed official cashier redirect while excluding unrelated destinations', () => {
  const form = renderZpayForm({ type: 'alipay', money: '28.00' }, KEY);
  const directives = new Map(form.headers.get('Content-Security-Policy').split(';').map(directive => {
    const [name, ...sources] = directive.trim().split(/\s+/); return [name, sources];
  }));
  const destinations = directives.get('form-action');
  assert.deepEqual(destinations, ['https://zpayz.cn', 'https://api.z-pay.cn']);
  for (const url of ['https://zpayz.cn/submit.php', 'https://api.z-pay.cn/pay.html']) {
    assert.ok(destinations.includes(new URL(url).origin), `official payment destination denied: ${url}`);
  }
  for (const url of ['https://unrelated.example/pay', 'https://api.z-pay.cn.unrelated.example/pay',
    'https://checkout.z-pay.cn/pay', 'https://api.z-pay.cn:444/pay', 'http://api.z-pay.cn/pay']) {
    assert.ok(!destinations.includes(new URL(url).origin), `unrelated payment destination permitted: ${url}`);
  }
  for (const directive of ['default-src', 'base-uri', 'frame-ancestors']) assert.deepEqual(directives.get(directive), ["'none'"]);
  assert.match(directives.get('script-src').join(' '), /^'nonce-[a-f0-9]+'$/);
});

test('signed notify rejects malformed, repeated, oversized, forged amount and mismatched identity before crediting', async () => {
  const f = await fixture(), row = await order(f), valid = callback(row);
  expect(await notify(f, { ...valid, sign: '0'.repeat(32) }), 400);
  expect(await call(f, `/v1/payments/zpay/notify?${new URLSearchParams(valid)}&money=28.00`, { user: null }), 400);
  expect(await call(f, `/v1/payments/zpay/notify?${new URLSearchParams(valid)}&padding=${'x'.repeat(9000)}`, { user: null }), 400);
  expect(await call(f, `/v1/payments/zpay/notify?${new URLSearchParams(valid)}&bad=%ZZ`, { user: null }), 400);
  for (const changes of [{ money: '1e0' }, { money: '-1.00' }, { money: '1.001' }, { money: '01.00' }, { money: '0.01' },
    { pid: 'othermerchant' }, { type: 'wxpay' }, { name: '伪造商品' }, { param: `zp_${randomUUID()}` }, { out_trade_no: '9'.repeat(32) },
    { trade_no: 'bad id' }, { sign_type: 'SHA256' }]) expect(await notify(f, callback(row, changes)), 400);
  expect(await call(f, '/v1/payments/zpay/notify', { method: 'POST', body: valid, user: null }), 405);
  assert.equal((await wallet(f)).balance, 0); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_events WHERE order_id=?').bind(row.id).first()).n, 0);
  assert.equal(f.api.calls.length, 0);
});

test('twenty concurrent verified notify deliveries grant once and ignore signed unpaid states without downgrading', async () => {
  const f = await fixture(), row = await order(f), paid = callback(row);
  expect(await notify(f, callback(row, { trade_status: 'WAIT_BUYER_PAY' })), 200); assert.equal((await wallet(f)).balance, 0);
  const results = await Promise.all(Array.from({ length: 20 }, () => notify(f, paid)));
  results.forEach(result => { expect(result, 200); assert.equal(result.data, 'success'); });
  assert.equal((await wallet(f)).balance, 2800); assert.equal((await wallet(f)).totalPurchased, 2800);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM zpay_credit_ledger WHERE order_id=? AND kind='purchase'").bind(row.id).first()).n, 1);
  expect(await notify(f, callback(row, { trade_no: paid.trade_no, money: '28.0' })), 200);
  expect(await notify(f, callback(row, { trade_no: paid.trade_no, trade_status: 'WAIT_BUYER_PAY' })), 200);
  assert.equal((await wallet(f)).balance, 2800); assert.equal((await wallet(f)).orders[0].status, 'paid');
  assert.equal(f.api.calls.length, 0);
});

test('one provider trade can bind only one local order even when different orders notify concurrently', async () => {
  const f = await fixture(), first = await order(f), second = await order(f), trade_no = '202610041234567890';
  const results = await Promise.all([notify(f, callback(first, { trade_no })), notify(f, callback(second, { trade_no }))]);
  assert.equal(results.filter(result => result.status === 200).length, 1); assert.equal(results.filter(result => result.status === 400).length, 1);
  assert.equal((await wallet(f)).balance, 2800);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_orders WHERE provider_trade_no=?').bind(trade_no).first()).n, 1);
});

test('one local order cannot accept a second provider trade while payment facts race', async () => {
  const f = await fixture(), row = await order(f);
  const results = await Promise.all([notify(f, callback(row)), notify(f, callback(row))]);
  assert.equal(results.filter(result => result.status === 200).length, 1); assert.equal(results.filter(result => result.status === 400).length, 1);
  assert.equal((await wallet(f)).balance, 2800);
});

test('a signed browser return never credits and always redirects to a canonical same-site receipt without provider parameters', async () => {
  const f = await fixture(), row = await order(f), parameters = callback(row);
  const result = await call(f, `/v1/payments/zpay/return?${new URLSearchParams(parameters)}`, { user: null });
  assert.equal(result.status, 303); assert.equal(result.headers.get('Location'), `https://qingyu.invalid/?payment_order=${row.id}&payment=success#recharge`);
  assert.equal((await wallet(f)).balance, 0);
  const invalid = await call(f, `/v1/payments/zpay/return?${new URLSearchParams({ ...parameters, sign: '0'.repeat(32) })}`, { user: null });
  assert.equal(invalid.status, 303); assert.equal(invalid.headers.get('Location'), 'https://qingyu.invalid/#recharge');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_events WHERE order_id=?').bind(row.id).first()).n, 0);
  expect(await notify(f, parameters), 200);
  const paidForm = await call(f, `/v1/payments/zpay/checkout/${row.id}`); assert.equal(paidForm.status, 303);
  assert.equal(paidForm.headers.get('Location'), result.headers.get('Location'));
});

test('pending detail verifies canonical query identity before crediting, then ignores status zero rather than inferring refund', async () => {
  const f = await fixture(), row = await order(f);
  f.api.result = queryFact(row, { status: 0 });
  const pending = expect(await call(f, `/v1/payments/orders/${row.id}`), 200); assert.equal(pending.order.status, 'pending'); assert.equal(pending.balance, 0);
  for (const changes of [{ pid: 'another' }, { out_trade_no: '8'.repeat(32) }, { type: 'wxpay' }, { money: '9.99' }, { money: '1e0' },
    { name: 'other' }, { param: `zp_${randomUUID()}` }, { status: 2 }, { pid: Number.MAX_SAFE_INTEGER + 1 }]) {
    f.api.result = queryFact(row, changes); expect(await call(f, `/v1/payments/orders/${row.id}`), 400, 502); assert.equal((await wallet(f)).balance, 0);
  }
  f.api.result = queryFact(row, { pid: Number(PID) });
  const paid = expect(await call(f, `/v1/payments/orders/${row.id}`), 200); assert.equal(paid.order.status, 'paid'); assert.equal(paid.balance, 2800);
  const before = f.api.calls.length; f.api.result.status = 0;
  const after = expect(await call(f, `/v1/payments/orders/${row.id}`), 200); assert.equal(after.balance, 2800); assert.equal(after.totalRefunded, 0);
  assert.equal(f.api.calls.length, before); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_refund_state WHERE order_id=?').bind(row.id).first()).n, 0);
  // The query starts from a pending snapshot and finishes after notify commits.
  // Its separate verified fact must not create a second purchase entry.
  const racing = await fixture(), racingRow = await order(racing), paidParameters = callback(racingRow);
  let release, started;
  const start = new Promise(resolve => { started = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const detail = call(racing, `/v1/payments/orders/${racingRow.id}`, { options: { async zpayFetch() {
    started(); await hold; return Response.json(queryFact(racingRow, { trade_no: paidParameters.trade_no }));
  } } });
  await start; expect(await notify(racing, paidParameters), 200); release();
  const reconciled = expect(await detail, 200); assert.equal(reconciled.balance, 2800);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM zpay_credit_ledger WHERE order_id=? AND kind='purchase'").bind(racingRow.id).first()).n, 1);
});

test('pending detail recovers a paid order when the provider gateway returns an invalid envelope for JSON-only requests', async () => {
  const f = await fixture(), row = await order(f);
  f.api.result = queryFact(row);
  const gateway = async (input, init) => {
    const accept = new Headers(init.headers).get('Accept');
    if (accept === 'application/json') return Response.json({ data: 'unrecognized gateway response' });
    if (accept !== '*/*') return new Response(null, { status: 406 });
    return f.api.fetch(input, init);
  };
  const paid = expect(await call(f, `/v1/payments/orders/${row.id}`, { options: { zpayFetch: gateway } }), 200);
  assert.equal(paid.order.status, 'paid'); assert.equal(paid.balance, 2800); assert.equal(f.api.calls.length, 1);
  const repeated = expect(await call(f, `/v1/payments/orders/${row.id}`, { options: { zpayFetch: gateway } }), 200);
  assert.equal(repeated.balance, 2800); assert.equal(f.api.calls.length, 1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM zpay_credit_ledger WHERE order_id=? AND kind='purchase'").bind(row.id).first()).n, 1);
});

test('query network failures and malformed provider responses never expose credentials or grant points', async () => {
  const f = await fixture(), row = await order(f); f.api.fail = true;
  const unavailable = await call(f, `/v1/payments/orders/${row.id}`); expect(unavailable, 503);
  assert.ok(!JSON.stringify(unavailable.data).includes(KEY)); assert.ok(!JSON.stringify(unavailable.data).includes('api.php'));
  for (const fetch of [async () => new Response('invalid JSON'), async () => new Response('x'.repeat(65537)),
    async () => Response.json({ error: `secret ${KEY}` }, { status: 500 }), async () => new Response(null, { status: 302, headers: { Location: 'https://foreign.example' } }),
    async () => { throw new DOMException('timeout', 'TimeoutError'); }]) {
    expect(await call(f, `/v1/payments/orders/${row.id}`, { options: { zpayFetch: fetch } }), 502, 503);
  }
  assert.equal((await wallet(f)).balance, 0);
  const stranger = await fixture(); expect(await call(stranger, `/v1/payments/orders/${row.id}`), 404); assert.equal(stranger.api.calls.length, 0);
});

test('D1 failure rolls notification, payment binding and ledger back together and the same signed retry credits once', async () => {
  const f = await fixture(), row = await order(f), parameters = callback(row);
  const brokenDB = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare("INSERT INTO zpay_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) SELECT ?,?,event_id,'refund_adjustment',0,? FROM zpay_events WHERE order_id=?")
      .bind(row.id, f.user.id, Date.now(), row.id)]) };
  await assert.rejects(notify(f, parameters, { env: { ...f.env, DB: brokenDB } }), /CHECK constraint/);
  assert.equal((await wallet(f)).balance, 0); assert.equal((await DB.prepare('SELECT paid_at FROM zpay_orders WHERE id=?').bind(row.id).first()).paid_at, null);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_events WHERE order_id=?').bind(row.id).first()).n, 0);
  expect(await notify(f, parameters), 200); assert.equal((await wallet(f)).balance, 2800);
});

test('real wallets combine Zpay and historical live Stripe points but exclude Stripe sandbox across provider switches', async () => {
  const f = await fixture(), row = await order(f); expect(await notify(f, callback(row)), 200);
  let stripeOrder;
  for (const mode of ['test', 'live']) {
    const id = `pay_${randomUUID()}`, event = `evt_${randomUUID().replaceAll('-', '')}`, now = Date.now(); if (mode === 'live') stripeOrder = id;
    await DB.batch([
      DB.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at) VALUES(?,?,?,'usd_5',500,500,?,'paid',?,?,?)").bind(id, f.user.id, randomUUID(), mode, now, now, now),
      DB.prepare("INSERT INTO payment_events VALUES(?,'checkout.session.completed',?,'historical-stripe',?)").bind(event, id, now),
      DB.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',500,?)").bind(id, f.user.id, event, now),
    ]);
  }
  const merged = await wallet(f); assert.equal(merged.provider, 'zpay'); assert.equal(merged.balance, 3300); assert.equal(merged.totalPurchased, 3300);
  assert.deepEqual(new Set(merged.orders.map(item => item.provider)), new Set(['stripe', 'zpay'])); assert.ok(merged.orders.every(item => item.mode === 'live'));
  const oldDetail = expect(await call(f, `/v1/payments/orders/${stripeOrder}`), 200); assert.equal(oldDetail.provider, 'zpay'); assert.equal(oldDetail.order.provider, 'stripe');
  const stripeEnv = { ...f.env, PAYMENT_PROVIDER: undefined, STRIPE_PAYMENT_MODE: 'live' };
  const switched = await wallet(f, { env: stripeEnv }); assert.equal(switched.provider, 'stripe'); assert.equal(switched.balance, 3300);
  assert.equal(expect(await call(f, `/v1/payments/orders/${row.id}`, { env: stripeEnv }), 200).order.provider, 'zpay');
  assert.equal((await wallet(f, { env: { ...stripeEnv, STRIPE_PAYMENT_MODE: 'test' } })).balance, 500);
});

test('historical callbacks remain available when checkout is paused or another provider is selected', async () => {
  const f = await fixture(), row = await order(f), paused = { ...f.env, ZPAY_ENABLED: 'false', PAYMENT_PROVIDER: undefined };
  expect(await notify(f, callback(row), { env: paused }), 200); assert.equal((await wallet(f)).balance, 2800);
  const secret = 'whsec_isolated_stripe_history';
  const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, object: 'event', type: 'unused.event', livemode: false, data: { object: {} } };
  const raw = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000), signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  const request = new Request('https://qingyu.invalid/v1/payments/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: raw });
  const response = await handlePaymentsApi(request, { ...f.env, STRIPE_SECRET_KEY: 'sk_test_isolated_history', STRIPE_WEBHOOK_SECRET: secret });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { received: true, processed: false });
});

test('confirmed refund state requires evidence and provider unpaid state never becomes a refund adjustment', async () => {
  const f = await fixture(), row = await order(f);
  await assert.rejects(DB.prepare("INSERT INTO zpay_refund_state(refund_id,order_id,amount_minor,status,verified_at,created_at,updated_at) VALUES(?,?,100,'confirmed',1,1,1)")
    .bind(randomUUID(), row.id).run(), /CHECK constraint/);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM zpay_refund_state WHERE order_id=?').bind(row.id).first()).n, 0);
  assert.equal((await wallet(f)).totalRefunded, 0);
  expect(await call(f, `/v1/payments/zpay/refund/${row.id}`, { method: 'POST', body: {} }), 404);
});

test('Zpay migration creates an independent graph without altering any Stripe order, event, refund or ledger row', async () => {
  const migrationStore = memoryStore('zpay-migration-tests');
  try {
    const database = await migrationStore.getD1Database('DB'); await migrate(database, migrations.filter(name => name < '0011_zpay_payments.sql'));
    const id = randomUUID(), orderId = `pay_${randomUUID()}`, now = Date.now();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,'migration@zpay.example.test','历史用户',0,?)").bind(id, now),
      database.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,created_at,updated_at,paid_at) VALUES(?,?,?,'usd_1',100,100,'test',?,?,?)").bind(orderId, id, randomUUID(), now, now, now),
      database.prepare("INSERT INTO payment_events VALUES('evt_zpay_migration','charge.refunded',?,'history',?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_refunds VALUES('re_zpay_migration',?,20,'usd',1,1,?)").bind(orderId, now),
      database.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,'evt_zpay_migration','purchase',100,?)").bind(orderId, id, now),
    ]);
    const tables = ['users', 'payment_orders', 'payment_events', 'payment_refunds', 'payment_credit_ledger'];
    const snapshots = await Promise.all(tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    await migrate(database, ['0011_zpay_payments.sql']);
    for (let i = 0; i < tables.length; i++) assert.deepEqual((await database.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results, snapshots[i].results);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM zpay_orders').first()).n, 0);
  } finally { await migrationStore.dispose(); }
});

test('tier migration preserves the historical graph and deleted ledger high-water mark while old prices still reconcile', async () => {
  const migrationStore = memoryStore('zpay-tier-history-tests');
  try {
    const database = await migrationStore.getD1Database('DB'); await migrate(database, migrations.filter(name => name < '0012_zpay_recharge_tiers.sql'));
    const f = await fixture(); f.env = { ...f.env, DB: database };
    const paid = legacyOrder(f.user.id, 1, { status: 'partially_refunded', provider_trade_no: 'legacyPaidTrade',
      refunded_amount_minor: 20, refunded_credits: 20, paid_at: 1750000000001, updated_at: 1750000000002 });
    const pending = [legacyOrder(f.user.id, 5), legacyOrder(f.user.id, 10)];
    await database.batch([
      database.prepare('INSERT INTO users(id,email,nickname,is_guest,version,created_at) VALUES(?,?,?,0,7,?)').bind(f.user.id, f.user.email, f.user.nickname, 1750000000000),
      ...[paid, ...pending].map(row => insertHistoricalOrder(database, row)),
      database.prepare("INSERT INTO zpay_events VALUES('legacy_purchase','notify',?,'legacyPaidTrade','originalToken',1750000000001)").bind(paid.id),
      database.prepare("INSERT INTO zpay_events VALUES('legacy_refund','manual_refund',?,'legacyPaidTrade','verifiedRefundToken',1750000000002)").bind(paid.id),
      database.prepare("INSERT INTO zpay_events VALUES('deleted_highwater','manual_refund',?,'legacyPaidTrade','deletedToken',1750000000003)").bind(paid.id),
      database.prepare("INSERT INTO zpay_credit_ledger VALUES(12,?,?,'legacy_purchase','purchase',100,1750000000001)").bind(paid.id, f.user.id),
      database.prepare("INSERT INTO zpay_credit_ledger VALUES(13,?,?,'legacy_refund','refund_adjustment',-20,1750000000002)").bind(paid.id, f.user.id),
      database.prepare("INSERT INTO zpay_credit_ledger VALUES(999,?,?,'deleted_highwater','refund_adjustment',-1,1750000000003)").bind(paid.id, f.user.id),
      database.prepare("INSERT INTO zpay_refund_state VALUES('legacy_confirmed',?,20,'confirmed','provider-confirmation-123',1750000000002,1750000000001,1750000000002)").bind(paid.id),
      database.prepare("INSERT INTO zpay_refund_state VALUES('legacy_review',?,5,'manual_review',NULL,NULL,1750000000001,1750000000002)").bind(pending[0].id),
      database.prepare("DELETE FROM zpay_events WHERE event_id='deleted_highwater'"),
    ]);
    const tables = ['users', 'zpay_orders', 'zpay_events', 'zpay_credit_ledger', 'zpay_refund_state'];
    const snapshots = await Promise.all(tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const seq = await database.prepare("SELECT seq FROM sqlite_sequence WHERE name='zpay_credit_ledger'").first(); assert.equal(seq.seq, 999);
    assert.equal((await database.prepare('SELECT SUM(credits) AS balance FROM zpay_credit_ledger').first()).balance, 80);
    await migrate(database, ['0012_zpay_recharge_tiers.sql']);
    for (let i = 0; i < tables.length; i++) assert.deepEqual((await database.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results, snapshots[i].results);
    assert.deepEqual(await database.prepare("SELECT seq FROM sqlite_sequence WHERE name='zpay_credit_ledger'").first(), seq);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
    await migrate(database, ['0013_subscriptions.sql', '0015_credit_usage.sql']);
    // Current wallet SQL also reads the later Guagua tables. This historical
    // database stops at credit usage, so install empty tables without replacing
    // the credit view under test.
    await database.batch([
      database.prepare(`CREATE TABLE guagua_orders (id TEXT PRIMARY KEY, user_id TEXT, package_id TEXT, amount_minor INTEGER, currency TEXT, credits INTEGER,
        refunded_credits INTEGER, refunded_amount_minor INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER, paid_at INTEGER, checkout_url TEXT, method TEXT)`),
      database.prepare(`CREATE TABLE guagua_credit_ledger (id INTEGER PRIMARY KEY, order_id TEXT, user_id TEXT, credits INTEGER, kind TEXT)`),
    ]);
    assert.equal((await wallet(f)).balance, 80);
    // The stored name and price, including older product wording, stay canonical.
    for (const row of pending) {
      const form = expect(await call(f, `/v1/payments/zpay/checkout/${row.id}`), 200);
      assert.ok(form.includes(`name="money" value="${row.amount_minor / 100}.00"`));
      assert.ok(form.includes(`name="name" value="${row.payment_name}"`));
      expect(await notify(f, callback(row, { money: '28.00' })), 400);
    }
    expect(await notify(f, callback(paid, { trade_no: paid.provider_trade_no })), 200);
    assert.equal((await wallet(f)).balance, 80); assert.equal((await wallet(f)).orders.find(row => row.id === paid.id).status, 'partially_refunded');
    for (const row of pending) { const fact = callback(row); expect(await notify(f, fact), 200); expect(await notify(f, fact), 200); }
    assert.equal((await wallet(f)).balance, 1580); assert.equal((await wallet(f)).totalPurchased, 1600); assert.equal((await wallet(f)).totalRefunded, 20);
    // Replayed purchases can consume AUTOINCREMENT values even when their
    // unique purchase constraint suppresses the row. No old ID may be reused.
    assert.ok((await database.prepare('SELECT MIN(id) AS id FROM zpay_credit_ledger WHERE id>999').first()).id > 999);
    for (const packageId of ['cny_1', 'cny_5', 'cny_10']) expect(await checkout(f, { packageId }), 400);
    for (const [packageId, amountMinor] of [['cny_28', 2800], ['cny_88', 8800], ['cny_188', 18800]]) {
      const result = expect(await checkout(f, { packageId }), 201); assert.equal(result.order.amountMinor, amountMinor); assert.equal(result.order.credits, amountMinor);
    }
    // Rebuilt uniqueness, evidence and amount/points constraints remain strict.
    await assert.rejects(database.prepare("UPDATE zpay_orders SET package_id='cny_28' WHERE id=?").bind(pending[0].id).run(), /CHECK constraint/);
    await assert.rejects(database.prepare('UPDATE zpay_orders SET credits=credits+1 WHERE id=?').bind(pending[0].id).run(), /CHECK constraint/);
    await assert.rejects(database.prepare("INSERT INTO zpay_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,'legacy_refund','purchase',100,1)").bind(paid.id, f.user.id).run(), /UNIQUE constraint/);
    await assert.rejects(database.prepare("UPDATE zpay_refund_state SET verification_reference=NULL WHERE refund_id='legacy_confirmed'").run(), /CHECK constraint/);
    const foreignKeys = (await database.prepare('PRAGMA foreign_key_list(zpay_credit_ledger)').all()).results;
    assert.deepEqual(new Set(foreignKeys.map(key => key.table)), new Set(['users', 'zpay_orders', 'zpay_events']));
    await database.prepare('DELETE FROM zpay_orders WHERE id=?').bind(pending[0].id).run();
    for (const table of ['zpay_events', 'zpay_credit_ledger', 'zpay_refund_state']) assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE order_id=?`).bind(pending[0].id).first()).n, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM zpay_orders WHERE id=?').bind(paid.id).first()).n, 1);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await migrationStore.dispose(); }
});

test('tier migration preserves both an unused empty ledger and an empty ledger with a prior high-water mark', async () => {
  for (const used of [false, true]) {
    const migrationStore = memoryStore(`zpay-tier-empty-${used}`);
    try {
      const database = await migrationStore.getD1Database('DB'); await migrate(database, migrations.filter(name => name < '0012_zpay_recharge_tiers.sql'));
      if (used) {
        const id = randomUUID(), row = legacyOrder(id, 1);
        await database.batch([
          database.prepare("INSERT INTO users(id,nickname,is_guest,created_at) VALUES(?,'已删除用户',0,1)").bind(id),
          insertHistoricalOrder(database, row),
          database.prepare("INSERT INTO zpay_events VALUES('deleted_event','notify',?,'deletedTrade','deletedToken',1)").bind(row.id),
          database.prepare("INSERT INTO zpay_credit_ledger VALUES(321,?,?,'deleted_event','purchase',100,1)").bind(row.id, id),
          database.prepare('DELETE FROM users WHERE id=?').bind(id),
        ]);
      }
      const beforeSeq = await database.prepare("SELECT seq FROM sqlite_sequence WHERE name='zpay_credit_ledger'").first();
      assert.deepEqual(beforeSeq, used ? { seq: 321 } : null);
      await migrate(database, ['0012_zpay_recharge_tiers.sql']);
      assert.deepEqual(await database.prepare("SELECT seq FROM sqlite_sequence WHERE name='zpay_credit_ledger'").first(), beforeSeq);
      for (const table of ['zpay_orders', 'zpay_events', 'zpay_credit_ledger', 'zpay_refund_state']) assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0);
      assert.deepEqual((await database.prepare("SELECT name FROM sqlite_sequence WHERE name LIKE 'zpay_%_next'").all()).results, []);
      assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
    } finally { await migrationStore.dispose(); }
  }
});
