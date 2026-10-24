import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { handlePaymentsApi } = await tsImport('../src/payments.ts', import.meta.url);
const { handleSubscriptions } = await tsImport('../src/subscriptions.ts', import.meta.url);
const { handleDreamCoin, dreamCoinRebatePreview } = await tsImport('../src/dream-coin.ts', import.meta.url);
const { guaguaSignature } = await tsImport('../src/guagua.ts', import.meta.url);
const MID = 'M200147', SECRET = 'a'.repeat(32), CHANNEL = '3333', CALLBACK_IP = '136.110.35.126';
const PAY_URL = 'https://alipay.dthzf001.cn/pay/submit/2026101611165122908/';
let store, DB;
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
async function migrate(database) {
  for (const file of migrations) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated guagua store")}}', d1Databases: { DB: 'guagua-tests' } }));
  DB = await store.getD1Database('DB');
  await migrate(DB);
});
after(async () => { await store?.dispose(); });

function sign(parameters) { return guaguaSignature(parameters, SECRET); }
async function fixture() {
  const user = { id: randomUUID(), email: `${randomUUID()}@guagua.example.test`, nickname: '瓜瓜测试', isGuest: false, role: 'user', version: 0 };
  await DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id, user.email, user.nickname, Date.now()).run();
  const env = { DB, APP_ORIGINS: 'https://qingyu.invalid', PAYMENT_PROVIDER: 'guagua', PAYMENTS_ACCEPTING_ENABLED: 'true',
    GUAGUA_ENABLED: 'true', GUAGUA_MID: MID, GUAGUA_SECRET: SECRET, GUAGUA_CHANNEL_CODE: CHANNEL, CREDIT_BILLING_ENABLED: 'false' };
  const api = { calls: [], paid: false, failCreate: false,
    async fetch(input, init) {
      const url = new URL(input);
      assert.equal(url.hostname, 'rfbseviekzlmamu7arwo.itxt002.xyz');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'manual');
      const body = new URLSearchParams(init.body);
      const parameters = Object.fromEntries(body.entries());
      assert.equal(parameters.sign, sign(parameters));
      assert.equal(parameters.mid, MID);
      this.calls.push(url.pathname);
      if (url.pathname.endsWith('/CreateOrderPay')) {
        if (this.failCreate) return Response.json({ status: 1, errMsg: '通道维护', result: null });
        assert.equal(parameters.channelCode, CHANNEL);
        assert.equal(parameters.money, '28.00');
        return Response.json({ status: 0, errMsg: null, result: { tid: `BB${parameters.merOrderTid}`, merOrderTid: parameters.merOrderTid, payUrl: PAY_URL, payOrderStatus: 0, money: 28 } });
      }
      assert.equal(url.pathname.endsWith('/QueryPayOrder'), true);
      return Response.json({ status: 0, errMsg: null, result: { tid: `BB${parameters.merOrderTid}`, merOrderTid: parameters.merOrderTid, payUrl: PAY_URL, payOrderStatus: this.paid ? 1 : 0, money: '28.00' } });
    } };
  return { user, env, api };
}
async function call(f, path, { method = 'GET', body, user = f.user, headers = {}, options = {} } = {}) {
  const request = new Request(`https://qingyu.invalid${path}`, { method, headers: { 'CF-Connecting-IP': f.user.id, ...headers,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let response;
  try { response = await handlePaymentsApi(request, f.env, user, { guaguaFetch: f.api.fetch.bind(f.api), ...options }); }
  catch (error) { if (!Number.isInteger(error.status)) throw error; response = Response.json({ error: error.message }, { status: error.status }); }
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
function expect(result, status) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }

test('documented signature sorts keys and appends the secret', () => {
  const digest = sign({ money: '100.00', mid: 'M200002', channelCode: '3333', merOrderTid: '2310140101445119', notifyUrl: 'https://localhost:44311' });
  assert.equal(digest, createHash('md5').update('channelCode=3333&merOrderTid=2310140101445119&mid=M200002&money=100.00&notifyUrl=https://localhost:44311&' + SECRET).digest('hex'));
});

test('checkout opens the allowlisted cashier and notify grants credit once', async () => {
  const f = await fixture();
  const config = expect(await call(f, '/v1/payments/config'), 200);
  assert.equal(config.provider, 'guagua');
  assert.equal(config.enabled, true);
  assert.deepEqual(config.methods, [{ id: 'wxpay', label: '微信支付' }]);
  const created = expect(await call(f, '/v1/payments/checkout', { method: 'POST', body: { provider: 'guagua', method: 'wxpay', packageId: 'cny_28', accountId: f.user.id, requestId: randomUUID(), mode: 'live' } }), 201);
  assert.match(created.checkoutUrl, /^https:\/\/qingyu\.invalid\/api\/payments\/guagua\/checkout\/gg_/);
  assert.equal(created.order.credits, 2800);
  const redirect = await call(f, `/v1/payments/guagua/checkout/${created.order.id}`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('Location'), PAY_URL);
  const row = await DB.prepare('SELECT * FROM guagua_orders WHERE id=?').bind(created.order.id).first();
  const payload = { merOrderTid: row.mer_order_tid, tid: row.provider_trade_no, money: '28.00', status: 1 };
  payload.sign = sign(payload);
  const denied = expect(await call(f, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': '1.2.3.4' } }), 403);
  assert.equal(denied.error, '支付回调来源无效。');
  const credited = expect(await call(f, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP } }), 200);
  assert.equal(credited, 'success');
  const replay = expect(await call(f, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP } }), 200);
  assert.equal(replay, 'success');
  const wallet = expect(await call(f, '/v1/payments/wallet'), 200);
  assert.equal(wallet.balance, 2800);
  assert.equal(wallet.orders.filter(order => order.status === 'paid').length, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM guagua_credit_ledger WHERE order_id=?').bind(row.id).first()).n, 1);
});

test('wrong amount does not grant and query can compensate a missed callback', async () => {
  const f = await fixture();
  const created = expect(await call(f, '/v1/payments/checkout', { method: 'POST', body: { provider: 'guagua', method: 'wxpay', packageId: 'cny_28', accountId: f.user.id, requestId: randomUUID(), mode: 'live' } }), 201);
  const row = await DB.prepare('SELECT * FROM guagua_orders WHERE id=?').bind(created.order.id).first();
  const bad = { merOrderTid: row.mer_order_tid, tid: row.provider_trade_no, money: '1.00', status: 1 };
  bad.sign = sign(bad);
  expect(await call(f, '/v1/payments/guagua/notify', { method: 'POST', body: bad, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP } }), 400);
  assert.equal((await DB.prepare('SELECT paid_at FROM guagua_orders WHERE id=?').bind(row.id).first()).paid_at, null);
  f.api.paid = true;
  const detail = expect(await call(f, `/v1/payments/orders/${row.id}`), 200);
  assert.equal(detail.order.status, 'paid');
  assert.equal(detail.balance, 2800);
});

test('WeChat VIP checkout opens a membership and does not grant recharge credit', async () => {
  const f = await fixture();
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  await DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash, f.user.id, now + 86400000, now).run();
  const plan = { id: 'vip_monthly', label: '晴屿 VIP', revision: 2, amountMinor: 2800, currency: 'cny', durationDays: 30, dailyCredits: 500, maxClaims: 30, timezone: 'Asia/Shanghai' };
  const env = { ...f.env, SUBSCRIPTION_ENABLED: 'true', SUBSCRIPTION_PLANS_JSON: JSON.stringify([plan]) };
  const requestId = randomUUID();
  const createdResponse = await handleSubscriptions(new Request('https://qingyu.invalid/v1/subscriptions/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `qingyu_session=${token}`, 'CF-Connecting-IP': f.user.id },
    body: JSON.stringify({ accountId: f.user.id, planId: plan.id, planRevision: plan.revision, requestId, provider: 'zpay', mode: 'live', method: 'wxpay' }),
  }), env, f.user, { guaguaFetch: f.api.fetch.bind(f.api) });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201, JSON.stringify(created));
  assert.equal(created.order.method, 'wxpay');
  assert.match(created.checkoutUrl, /^https:\/\/qingyu\.invalid\/api\/payments\/guagua\/vip\/checkout\/sp_/);
  const redirect = await call(f, `/v1/payments/guagua/vip/checkout/${created.order.id}`, { env });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('Location'), PAY_URL);
  const row = await DB.prepare('SELECT * FROM guagua_vip_orders WHERE subscription_order_id=?').bind(created.order.id).first();
  const payload = { merOrderTid: row.mer_order_tid, tid: row.provider_trade_no, money: '28.00', status: 1, sign: '' };
  payload.sign = sign(payload);
  const notified = expect(await call(f, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP }, env }), 200);
  assert.equal(notified, 'success');
  expect(await call(f, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP }, env }), 200);
  const overviewResponse = await handleSubscriptions(new Request('https://qingyu.invalid/v1/subscriptions', {
    headers: { Cookie: `qingyu_session=${token}`, 'CF-Connecting-IP': f.user.id },
  }), env, f.user);
  const overview = await overviewResponse.json();
  assert.equal(overviewResponse.status, 200, JSON.stringify(overview));
  assert.equal(overview.subscriptions.length, 1);
  assert.equal(overview.subscriptions[0].status, 'active');
  assert.equal(overview.subscriptions[0].dailyCredits, 500);
  assert.equal(overview.balance, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_periods WHERE order_id=?').bind(created.order.id).first()).n, 1);
  assert.equal((await DB.prepare('SELECT COALESCE(SUM(credits),0) AS n FROM guagua_credit_ledger WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('invited WeChat payments credit dream coin once, then exchange and withdrawal keep one ledger', async () => {
  assert.equal(dreamCoinRebatePreview(2800, 0, 0), 560);
  assert.equal(dreamCoinRebatePreview(2800, 11 * 86400000, 0), 280);
  const invitee = await fixture();
  const inviter = { id: randomUUID(), email: `${randomUUID()}@dream.example.test`, nickname: '邀请人', isGuest: false, role: 'user', version: 0 };
  const now = Date.now();
  const code = `XM${inviter.id.replace(/-/g, '').slice(0, 30).toUpperCase()}`;
  await DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at,referral_code) VALUES(?,?,?,0,?,?)').bind(inviter.id, inviter.email, inviter.nickname, now, code).run();
  await DB.prepare('INSERT INTO referral_events(id,inviter_id,invitee_id,referral_code,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(), inviter.id, invitee.user.id, code, now).run();
  async function pay() {
    const created = expect(await call(invitee, '/v1/payments/checkout', { method: 'POST', body: { provider: 'guagua', method: 'wxpay', packageId: 'cny_28', accountId: invitee.user.id, requestId: randomUUID(), mode: 'live' } }), 201);
    const row = await DB.prepare('SELECT * FROM guagua_orders WHERE id=?').bind(created.order.id).first();
    const payload = { merOrderTid: row.mer_order_tid, tid: row.provider_trade_no, money: '28.00', status: 1 };
    payload.sign = sign(payload);
    expect(await call(invitee, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP } }), 200);
    expect(await call(invitee, '/v1/payments/guagua/notify', { method: 'POST', body: payload, user: null, headers: { 'CF-Connecting-IP': CALLBACK_IP } }), 200);
    return row.id;
  }
  await pay();
  await pay();
  async function dream(path, body, actor = inviter) {
    try {
      const response = await handleDreamCoin(new Request(`https://qingyu.invalid${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': actor.id }, body: body ? JSON.stringify(body) : undefined }), invitee.env, actor);
      return { status: response.status, data: await response.json() };
    } catch (error) { return { status: error.status, data: { error: error.message } }; }
  }
  const wallet = expect(await dream('/v1/dream-coin'), 200);
  assert.equal(wallet.balanceFen, 1120);
  assert.equal(wallet.entries.filter(entry => entry.kind === 'invite_rebate').length, 2);
  const exchanged = expect(await dream('/v1/dream-coin/exchange', { amountFen: 100 }), 201);
  assert.equal(exchanged.balanceFen, 1020);
  assert.equal((await DB.prepare('SELECT balance FROM credit_usage_balances WHERE user_id=?').bind(inviter.id).first()).balance, 100);
  const withdrawn = expect(await dream('/v1/dream-coin/withdrawals', { amountFen: 1000, payoutAccount: 'dream@example.test' }), 201);
  assert.equal(withdrawn.balanceFen, 20);
  assert.equal(withdrawn.withdrawals[0].status, 'pending');
  const blocked = await dream('/v1/dream-coin/withdrawals', { amountFen: 1000, payoutAccount: 'dream@example.test' });
  assert.equal(blocked.status, 409);
  const admin = { ...inviter, role: 'super' };
  const rejected = expect(await dream(`/v1/dream-coin/withdrawals/${withdrawn.withdrawals[0].id}`, { status: 'rejected' }, admin), 200);
  assert.equal(rejected.status, 'rejected');
  const restored = expect(await dream('/v1/dream-coin'), 200);
  assert.equal(restored.balanceFen, 1020);
  const again = expect(await dream('/v1/dream-coin/withdrawals', { amountFen: 1000, payoutAccount: 'dream@example.test' }), 201);
  expect(await dream(`/v1/dream-coin/withdrawals/${again.withdrawals[0].id}`, { status: 'paid' }, admin), 200);
  const closed = await dream('/v1/dream-coin/withdrawals', { amountFen: 1000, payoutAccount: 'dream@example.test' });
  assert.equal(closed.status, 409);
  assert.equal((await dream('/v1/dream-coin')).data.balanceFen, 20);
});
