import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { hashPassword } = await tsImport('../src/auth.ts', import.meta.url);
const { NEW_SIGNUP_CREDITS, passwordSignupCreditStatement, publicSignupCreditConfig } = await tsImport('../src/signup-credits.ts', import.meta.url);
const { chargeDzmmProviderCostUsd, reserveDzmmCreditCost } = await tsImport('../../../src/lib/dzmm-credit-pricing.ts', import.meta.url);
const PASSWORD = 'Ordinary-signup-test-password-2026!';
let store, DB;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("disposable signup test")}}', d1Databases: { DB: 'signup-gift-tests' } }));
  DB = await store.getD1Database('DB');
  const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(sql).filter(part => part.trim()).map(part => DB.prepare(part)));
  }
});
after(async () => { await store?.dispose(); });

function fixture() {
  const deliveries = [];
  const env = { DB, APP_ORIGINS: 'https://qingyu.invalid', STRIPE_PAYMENT_MODE: 'live', EMAIL_AUTH_ENABLED: 'true',
    EMAIL_FROM: 'login@qingyu.invalid', EMAIL_OTP_SECRET: 'disposable-signup-test-email-secret-2026',
    EMAIL: { async send(message) { deliveries.push(message); return { messageId: randomUUID() }; } } };
  return { env, deliveries, ip: randomUUID(), email: `${randomUUID()}@signup.example.test` };
}
class Client {
  constructor(f, cookie = '') { this.f = f; this.cookie = cookie; }
  async request(path, { body, env = this.f.env, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetchRequest(new Request(`https://qingyu.invalid${path}`, { method,
      headers: { Origin: 'https://qingyu.invalid', Cookie: this.cookie, 'CF-Connecting-IP': this.f.ip,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (Object.hasOwn(data, 'user')) this.user = data.user;
    return { status: response.status, data };
  }
}
function expect(result, ...statuses) { assert.ok(statuses.includes(result.status), JSON.stringify(result)); return result.data; }
function register(client, extra = {}, env) {
  return client.request('/v1/auth/register', { body: { email: client.f.email, password: PASSWORD, nickname: '普通原创测试者', ...extra }, ...(env ? { env } : {}) });
}
async function requestCode(client) {
  const result = expect(await client.request('/v1/auth/email/request', { body: { email: client.f.email } }), 200);
  return { email: client.f.email, challengeId: result.challengeId, code: client.f.deliveries.at(-1).text.match(/验证码是 (\d{6})/)[1] };
}
function verify(client, challenge, env, extra = {}) {
  return client.request('/v1/auth/email/verify', { body: { ...challenge, ...(client.user ? { accountId: client.user.id } : {}), ...extra }, ...(env ? { env } : {}) });
}
async function grants(userId) { return (await DB.prepare('SELECT * FROM trusted_credit_grants WHERE user_id=?').bind(userId).all()).results; }
async function checkGift(client, expected = NEW_SIGNUP_CREDITS) {
  const rows = await grants(client.user.id);
  assert.equal(rows.length, expected ? 1 : 0);
  if (expected) {
    assert.equal(rows[0].grant_key, `new_signup:${client.user.id}`); assert.equal(rows[0].credits, expected);
    assert.equal(rows[0].reason, 'new_signup'); assert.ok(Number.isSafeInteger(rows[0].created_at));
  }
  if (client.user.isGuest) {
    assert.equal(expected, 0);
    expect(await client.request('/v1/payments/wallet'), 403);
    const balance = await DB.prepare('SELECT balance FROM credit_usage_balances WHERE user_id=?').bind(client.user.id).first();
    assert.equal(balance.balance, 0);
    return undefined;
  }
  const wallet = expect(await client.request('/v1/payments/wallet'), 200);
  assert.equal(wallet.balance, expected); assert.equal(wallet.totalPurchased, 0); assert.equal(wallet.totalSubscriptionGranted, 0);
  assert.equal(wallet.reservedCredits, 0); assert.equal(wallet.totalSpent, 0); assert.deepEqual(wallet.orders, []);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM subscription_credit_ledger WHERE user_id=?').bind(client.user.id).first()).n, 0);
  return rows[0];
}
function brokenBatch() {
  return { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare('INSERT INTO users(id,nickname,is_guest,created_at) VALUES(?,?,9,1)').bind(randomUUID(), 'rollback marker')]) };
}
async function clearCooldown(client) {
  await DB.prepare('UPDATE email_auth_cooldowns SET requested_at=? WHERE email=?').bind(Date.now() - 61000, client.f.email).run();
}

test('public signup config describes a fixed one-time gift without a claim endpoint or DB mutation', async () => {
  const f = fixture(), client = new Client(f);
  const noDB = { ...f.env, DB: { prepare() { throw new Error('configuration must not touch the ledger'); } } };
  const config = expect(await client.request('/v1/auth/signup/config', { env: noDB }), 200);
  assert.deepEqual(config, publicSignupCreditConfig()); assert.equal(config.credits, 1500);
  assert.equal(config.targetConversationRounds, 10); assert.equal(config.oncePerAccount, true);
  assert.equal(config.includesAutomaticReplySuggestions, true); assert.equal(config.billingRule, 'actual_cost_x3');
  assert.match(config.note, /约 10 轮/); assert.match(config.note, /模型、上下文和回复长度/); assert.match(config.note, /预留并非实际扣费/);
  expect(await client.request('/v1/auth/signup/config', { body: { credits: 999999999 } }), 405);
  expect(await client.request('/v1/auth/signup/claim', { body: {} }), 404);
});

test('password signup awards exactly 1500, ignores client amounts and subsequent login never awards again', async () => {
  const f = fixture(), client = new Client(f);
  expect(await register(client, { credits: 999999999, signupCredits: -1 }), 201);
  const original = await checkGift(client);
  expect(await client.request('/v1/session'), 200);
  expect(await client.request('/v1/auth/logout', { body: {} }), 200);
  expect(await client.request('/v1/auth/login', { body: { email: f.email, password: PASSWORD } }), 200);
  assert.deepEqual(await checkGift(client), original);
  expect(await register(new Client(f)), 409);
  const row = await DB.prepare('SELECT mutation_token FROM users WHERE id=?').bind(client.user.id).first();
  assert.equal((await passwordSignupCreditStatement(f.env, client.user.id, row.mutation_token, Date.now()).run()).meta.changes, 0);
  assert.equal((await passwordSignupCreditStatement(f.env, client.user.id, randomUUID(), Date.now()).run()).meta.changes, 0);
  assert.deepEqual(await grants(client.user.id), [original]);
});

test('guest password upgrade preserves identity and private state, and simultaneous upgrades award once', async () => {
  const f = fixture(), client = new Client(f);
  const guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  await checkGift(client, 0);
  await DB.batch([
    DB.prepare("INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,'original-chat','private-original','原创测试会话',?)").bind(guest.id, Date.now()),
    DB.prepare("INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,'original-chat','original-message','user','整理灯塔的借阅记录。',0)").bind(guest.id),
    DB.prepare("INSERT INTO preferences(user_id,nickname,persona,preset,model,dark) VALUES(?,'游客原昵称','私人普通设定','默认','balanced',0)").bind(guest.id),
  ]);
  const contender = new Client(f, client.cookie);
  const outcomes = await Promise.all([register(client), register(contender, { email: `second-${f.email}` })]);
  assert.equal(outcomes.filter(result => result.status === 201).length, 1);
  assert.ok(outcomes.every(result => [201, 409].includes(result.status)));
  const winner = outcomes[0].status === 201 ? client : contender;
  assert.equal(winner.user.id, guest.id); await checkGift(winner);
  assert.equal((await DB.prepare('SELECT content FROM messages WHERE user_id=?').bind(guest.id).first()).content, '整理灯塔的借阅记录。');
  assert.equal((await DB.prepare('SELECT persona FROM preferences WHERE user_id=?').bind(guest.id).first()).persona, '私人普通设定');
  assert.equal(expect(await new Client(f, contender === winner ? client.cookie : contender.cookie).request('/v1/session'), 200).user, null);
});

test('new OTP signup awards once; wrong codes, replay and repeated existing-account OTP do not add gifts', async () => {
  const f = fixture(), client = new Client(f), challenge = await requestCode(client);
  const wrong = challenge.code === '000000' ? '000001' : '000000';
  expect(await verify(client, challenge, undefined, { code: wrong }), 400);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 0);
  const results = await Promise.all(Array.from({ length: 5 }, () => verify(new Client(f), challenge)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.ok(results.every(result => [200, 400].includes(result.status)));
  const success = results.find(result => result.status === 200).data;
  assert.equal(success.registered, true);
  // Obtain the winning session independently with another valid email proof.
  await clearCooldown(client); const next = await requestCode(client);
  const login = expect(await verify(client, next), 200);
  assert.equal(login.registered, false); assert.equal(login.user.id, success.user.id);
  const original = await checkGift(client);
  expect(await verify(client, next), 400); assert.deepEqual(await grants(client.user.id), [original]);
});

test('OTP upgrades its own guest in place and preserves ordinary private data with one gift', async () => {
  const f = fixture(), client = new Client(f), guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  await DB.prepare("INSERT INTO favorites(user_id,character_id) VALUES(?,'my-original-lighthouse')").bind(guest.id).run();
  const challenge = await requestCode(client), signup = expect(await verify(client, challenge), 200);
  assert.equal(signup.registered, true); assert.equal(signup.user.id, guest.id); await checkGift(client);
  assert.equal((await DB.prepare('SELECT character_id FROM favorites WHERE user_id=?').bind(guest.id).first()).character_id, 'my-original-lighthouse');
});

test('password and OTP registrations competing for the same email produce one registered owner and one gift', async () => {
  const f = fixture(), passwordClient = new Client(f), emailClient = new Client(f), challenge = await requestCode(emailClient);
  const outcomes = await Promise.all([register(passwordClient), verify(emailClient, challenge)]);
  assert.ok([201, 409].includes(outcomes[0].status)); assert.equal(outcomes[1].status, 200);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 1);
  const ownerId = outcomes[1].data.user.id;
  if (outcomes[0].status === 201) { assert.equal(outcomes[0].data.user.id, ownerId); assert.equal(outcomes[1].data.registered, false); }
  else assert.equal(outcomes[1].data.registered, true);
  await checkGift(emailClient);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants WHERE user_id=?').bind(ownerId).first()).n, 1);
});

test('password signup batch failure leaves no user/session/gift, and retry receives only one gift', async () => {
  const f = fixture(), client = new Client(f);
  const before = (await DB.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants').first()).n;
  expect(await register(client, {}, { ...f.env, DB: brokenBatch() }), 500);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants').first()).n, before);
  assert.equal(client.cookie, ''); expect(await register(client), 201); await checkGift(client);
});

test('failed guest password upgrade atomically preserves guest session, preferences and zero gift until retry', async () => {
  const f = fixture(), client = new Client(f), guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user, oldCookie = client.cookie;
  await DB.prepare("INSERT INTO preferences(user_id,nickname,persona,preset,model,dark) VALUES(?,'原昵称','普通私人设定','默认','balanced',0)").bind(guest.id).run();
  expect(await register(client, {}, { ...f.env, DB: brokenBatch() }), 500);
  assert.equal(client.cookie, oldCookie); assert.equal(expect(await client.request('/v1/session'), 200).user.isGuest, true);
  assert.equal((await DB.prepare('SELECT nickname FROM preferences WHERE user_id=?').bind(guest.id).first()).nickname, '原昵称');
  await checkGift(client, 0); expect(await register(client), 201); assert.equal(client.user.id, guest.id); await checkGift(client);
});

test('OTP gift shares the claim transaction: failure rolls back claim/user/gift and allows one safe retry', async () => {
  for (const useGuest of [false, true]) {
    const f = fixture(), client = new Client(f);
    const guest = useGuest ? expect(await client.request('/v1/auth/guest', { body: {} }), 200).user : null;
    const challenge = await requestCode(client), before = (await DB.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants').first()).n;
    expect(await verify(client, challenge, { ...f.env, DB: brokenBatch() }), 500);
    assert.equal((await DB.prepare('SELECT consumed_at FROM email_auth_challenges WHERE id=?').bind(challenge.challengeId).first()).consumed_at, null);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trusted_credit_grants').first()).n, before);
    if (guest) assert.equal(expect(await client.request('/v1/session'), 200).user.isGuest, true);
    expect(await verify(client, challenge), 200); if (guest) assert.equal(client.user.id, guest.id); await checkGift(client);
  }
});

test('pre-existing accounts and guests receive no retroactive gift through password or OTP login', async () => {
  const f = fixture(), client = new Client(f), userId = randomUUID();
  await DB.prepare("INSERT INTO users(id,email,password_hash,nickname,is_guest,created_at,email_verified_at) VALUES(?,?,?,'已有普通账号',0,?,?)")
    .bind(userId, f.email, await hashPassword(PASSWORD), Date.now() - 100000, Date.now() - 100000).run();
  expect(await client.request('/v1/auth/login', { body: { email: f.email, password: PASSWORD } }), 200); await checkGift(client, 0);
  const guestClient = new Client(f), guest = expect(await guestClient.request('/v1/auth/guest', { body: {} }), 200).user;
  await checkGift(guestClient, 0);
  const challenge = await requestCode(guestClient), login = expect(await verify(guestClient, challenge), 200);
  assert.equal(login.registered, false); assert.equal(login.user.id, userId); await checkGift(guestClient, 0);
  assert.equal((await DB.prepare('SELECT is_guest FROM users WHERE id=?').bind(guest.id).first()).is_guest, 1);
  assert.deepEqual(await grants(guest.id), []);
});

test('1500 gift covers ten ordinary-turn cost projections including automatic suggestions and final preflight', () => {
  // Assumptions, not ten measured completions: the self-owned round16 sample
  // recorded 2247 native input, 964 completion and $0.010278 total provider cost.
  // The low-thinking 768-token allowance is already inside completion tokens.
  const policy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
  assert.equal(chargeDzmmProviderCostUsd(0.010278, policy), 21);
  for (const scenario of [{ visible: 512, growth: 600, upperGrowth: 3000 }, { visible: 1024, growth: 1100, upperGrowth: 5000 }]) {
    let spent = 0;
    for (let turn = 0; turn < 10; turn++) {
      const mainHold = reserveDzmmCreditCost(9901 + turn * scenario.upperGrowth, 2048, policy);
      assert.ok(NEW_SIGNUP_CREDITS - spent >= mainHold, `main turn ${turn + 1} can reserve its ordinary reply budget`);
      const mainCost = Number(((2247 + turn * scenario.growth) * 2 / 1e6 + (scenario.visible + 768) * 6 / 1e6).toFixed(12));
      spent += chargeDzmmProviderCostUsd(mainCost, policy);
      const suggestionsHold = reserveDzmmCreditCost(20000, 512, policy);
      assert.ok(NEW_SIGNUP_CREDITS - spent >= suggestionsHold, `turn ${turn + 1} can reserve its three suggestions`);
      spent += chargeDzmmProviderCostUsd(0.01268, policy); // 2500 input + 512 visible + 768 low reasoning.
    }
    assert.ok(spent < NEW_SIGNUP_CREDITS);
  }
  assert.ok(reserveDzmmCreditCost(500000, 2048, policy) > NEW_SIGNUP_CREDITS, 'very long contexts cannot be promised ten turns');
});
