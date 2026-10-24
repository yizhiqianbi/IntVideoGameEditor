import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Only the email provider is mocked. Challenges, claims, sessions and races use
// real transactional D1 in disposable workerd storage with no remote bindings.
const { handleAuth, hashPassword } = await tsImport('../src/auth.ts', import.meta.url);
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { readState } = await tsImport('../src/data.ts', import.meta.url);
const { NEW_SIGNUP_CREDITS } = await tsImport('../src/signup-credits.ts', import.meta.url);
const SECRET = 'isolated-email-auth-hmac-secret-2026-long';
const PASSWORD = 'Verified-password-for-tests-2026!';
let store, DB;
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
function memoryStore(name) {
  return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated email store")}}', d1Databases: { DB: name } }));
}
before(async () => { store = memoryStore('email-auth-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });

function fixture() {
  const deliveries = [];
  const env = { DB, APP_ORIGINS: 'https://qingyu.invalid', EMAIL_AUTH_ENABLED: 'true', EMAIL_FROM: 'login@qingyu.invalid',
    EMAIL_OTP_SECRET: SECRET, EMAIL: { async send(message) { deliveries.push(message); return { messageId: randomUUID() }; } } };
  return { env, deliveries, email: `${randomUUID()}@email.example.test`, ip: randomUUID() };
}
class Client {
  constructor(f, cookie = '') { this.f = f; this.cookie = cookie; }
  async request(path, { body, method = body === undefined ? 'GET' : 'POST', headers = {}, env = this.f.env, options } = {}) {
    const request = new Request(`https://qingyu.invalid${path}`, { method,
      headers: { 'CF-Connecting-IP': this.f.ip, Origin: 'https://qingyu.invalid', Cookie: this.cookie,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    let response;
    if (options) {
      try { response = await handleAuth(request, env, options); }
      catch (error) { if (!Number.isInteger(error.status)) throw error; response = Response.json({ error: error.message }, { status: error.status }); }
    } else response = await fetchRequest(request, env);
    assert.ok(response);
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (Object.hasOwn(data, 'user')) this.user = data.user;
    return { status: response.status, data, cookie };
  }
}
function expect(result, ...statuses) { assert.ok(statuses.includes(result.status), JSON.stringify(result)); return result.data; }
function mailCode(message) { return message.text.match(/验证码是 (\d{6})/)[1]; }
async function codeRequest(client, email = client.f.email, args = {}) {
  const data = expect(await client.request('/v1/auth/email/request', { body: { email }, ...args }), 200);
  return { ...data, email: email.trim().toLowerCase(), code: mailCode(client.f.deliveries.at(-1)) };
}
async function forgotCodeRequest(client, email = client.f.email, args = {}) {
  const before = client.f.deliveries.length;
  const data = expect(await client.request('/v1/auth/password/forgot/request', { body: { email }, ...args }), 200);
  // A reset request for a known mailbox sends one message; an unknown mailbox
  // deliberately has no delivery and uses the same public response shape.
  const delivery = client.f.deliveries.at(-1);
  const code = client.f.deliveries.length > before && delivery ? mailCode(delivery) : null;
  return { ...data, email: email.trim().toLowerCase(), code };
}
async function forgotReset(client, challenge, newPassword = PASSWORD, extra = {}, args = {}) {
  return client.request('/v1/auth/password/forgot/reset', { body: {
    email: challenge.email, challengeId: challenge.challengeId, code: challenge.code, newPassword, ...extra,
  }, ...args });
}
function verify(client, challenge, extra = {}, args = {}) {
  return client.request('/v1/auth/email/verify', { body: { email: challenge.email, challengeId: challenge.challengeId, code: challenge.code,
    ...(client.user ? { accountId: client.user.id } : {}), ...extra }, ...args });
}
async function clearCooldown(email) { await DB.prepare('UPDATE email_auth_cooldowns SET requested_at=? WHERE email=?').bind(Date.now() - 61000, email).run(); }
const sessionDigest = token => createHash('sha256').update(token).digest('hex');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('password login accepts an existing short numeric password', async () => {
  const f = fixture();
  const password = '123456';
  const client = new Client(f);
  const userId = randomUUID();
  await DB.prepare(
    'INSERT INTO users(id,email,password_hash,nickname,is_guest,version,created_at) VALUES(?,?,?,?,0,0,?)',
  ).bind(userId, f.email, await hashPassword(password), '短数字密码用户', Date.now()).run();
  expect(await new Client(f).request('/v1/auth/register', {
    body: { email: `new-${randomUUID()}@email.example.test`, password, nickname: '新账号' },
  }), 400);

  const loggedIn = expect(await client.request('/v1/auth/login', {
    body: { email: f.email, password },
  }), 200);
  assert.equal(loggedIn.authenticated, true);
  assert.equal(loggedIn.user.id, userId);
  assert.equal(loggedIn.user.hasPassword, true);

  const newPassword = 'Migrated-strong-password-2026!';
  const changed = expect(await client.request('/v1/auth/password', {
    body: { accountId: userId, currentPassword: password, newPassword },
  }), 200);
  assert.deepEqual(changed, { passwordChanged: true, accountId: userId });
  expect(await new Client(f).request('/v1/auth/login', {
    body: { email: f.email, password },
  }), 401);
  expect(await new Client(f).request('/v1/auth/login', {
    body: { email: f.email, password: newPassword },
  }), 200);
});

test('password reset does not reveal whether a mailbox exists', async () => {
  const f = fixture(), known = new Client(f);
  expect(await known.request('/v1/auth/register', {
    body: { email: f.email, password: PASSWORD, nickname: '可恢复账号' },
  }), 201);
  const sent = await forgotCodeRequest(new Client(f));
  assert.ok(sent.challengeId); assert.equal(sent.expiresIn, 600); assert.equal(sent.resendAfter, 60);
  assert.equal(f.deliveries.length, 1); assert.equal(sent.code?.length, 6);
  const row = await DB.prepare('SELECT purpose,send_status,code_hash FROM email_auth_challenges WHERE id=?').bind(sent.challengeId).first();
  assert.deepEqual(row, { purpose: 'password_reset', send_status: 'sent', code_hash: row.code_hash });
  assert.equal(row.code_hash.length, 64);
  await clearCooldown(f.email);
  const unknownEmail = `missing-${randomUUID()}@email.example.test`;
  const unknown = await forgotCodeRequest(new Client(f), unknownEmail);
  assert.deepEqual(Object.keys(unknown).sort(), Object.keys(sent).sort());
  assert.equal(f.deliveries.length, 1);
  assert.notEqual(unknown.challengeId, sent.challengeId);
  assert.equal(unknown.code, null);
  expect(await forgotReset(new Client(f), { ...unknown, code: '000000' }, 'Reset-password-for-tests-2026!'), 400);
  assert.equal(f.deliveries.length, 1);
});

test('password reset validates fields, rate limits requests, and preserves the challenge after weak passwords', async () => {
  const f = fixture(), owner = new Client(f);
  expect(await owner.request('/v1/auth/register', {
    body: { email: f.email, password: PASSWORD, nickname: '重置验证' },
  }), 201);
  expect(await owner.request('/v1/auth/password/forgot/request', { method: 'GET' }), 405);
  expect(await owner.request('/v1/auth/password/forgot/request', {
    body: { email: f.email }, headers: { Origin: 'https://foreign.example' },
  }), 403);
  for (const body of [{ email: f.email, challengeId: 'invalid', code: '000000', newPassword: PASSWORD },
    { email: f.email, challengeId: randomUUID(), code: 123456, newPassword: PASSWORD },
    { email: f.email, challengeId: randomUUID(), code: '12345', newPassword: PASSWORD },
    { email: f.email, challengeId: randomUUID(), code: '000000', newPassword: 'short' },
    { email: f.email, challengeId: randomUUID(), code: '000000', newPassword: PASSWORD, role: 'super' }]) {
    expect(await owner.request('/v1/auth/password/forgot/reset', { body }), 400);
  }
  const challenge = await forgotCodeRequest(new Client(f));
  expect(await forgotReset(new Client(f), challenge, 'short'), 400);
  expect(await forgotReset(new Client(f), challenge, 'x'.repeat(257)), 400);
  const wrong = challenge.code === '000000' ? '000001' : '000000';
  expect(await forgotReset(new Client(f), challenge, PASSWORD, { code: wrong }), 400);
  // Validation and a wrong code consume no more than the code-attempt budget;
  // the valid code remains usable before five incorrect attempts.
  const result = expect(await forgotReset(new Client(f), challenge, 'Reset-password-for-tests-2026!'), 200);
  assert.equal(result.passwordChanged, true); assert.equal(result.authenticated, true);
  assert.match((await new Client(f).request('/v1/auth/login', {
    body: { email: f.email, password: PASSWORD },
  })).data.error, /邮箱或密码不正确/);
});

test('password reset consumes a code once, rejects stale and expired codes, and revokes old sessions', async () => {
  const f = fixture(), owner = new Client(f), oldSession = new Client(f);
  const registered = expect(await owner.request('/v1/auth/register', {
    body: { email: f.email, password: PASSWORD, nickname: '安全重置账号' },
  }), 201).user;
  expect(await oldSession.request('/v1/auth/login', { body: { email: f.email, password: PASSWORD } }), 200);
  const resetClient = new Client(f), first = await forgotCodeRequest(resetClient);
  const staleCode = first.code;
  await clearCooldown(f.email);
  const latest = await forgotCodeRequest(resetClient);
  expect(await forgotReset(resetClient, { ...first, code: staleCode }), 400);
  const successResponse = await forgotReset(resetClient, latest, 'Reset-password-for-tests-2026!');
  const result = expect(successResponse, 200);
  assert.equal(result.passwordChanged, true); assert.equal(result.authenticated, true);
  assert.equal(result.user.id, registered.id); assert.equal(result.user.emailVerified, true);
  assert.match(successResponse.cookie, /HttpOnly/); assert.match(successResponse.cookie, /SameSite=Lax/); assert.match(successResponse.cookie, /Secure/);
  assert.equal(expect(await oldSession.request('/v1/session'), 200).user, null);
  assert.equal((await new Client(f).request('/v1/auth/login', { body: { email: f.email, password: PASSWORD } })).status, 401);
  assert.equal((await new Client(f).request('/v1/auth/login', { body: { email: f.email, password: 'Reset-password-for-tests-2026!' } })).status, 200);
  expect(await forgotReset(new Client(f), latest, 'Another-reset-password-2026!'), 400);

  await clearCooldown(f.email);
  const expired = await forgotCodeRequest(new Client(f));
  await DB.prepare('UPDATE email_auth_challenges SET created_at=?,expires_at=? WHERE id=?')
    .bind(Date.now() - 700000, Date.now() - 1, expired.challengeId).run();
  expect(await forgotReset(new Client(f), expired, 'Another-reset-password-2026!'), 400);
});

test('password reset request rate limits a single client IP across unknown mailboxes', async () => {
  const f = fixture(), results = [];
  for (let index = 0; index < 35; index++) results.push(await new Client(f).request('/v1/auth/password/forgot/request', {
    body: { email: `rate-${index}-${randomUUID()}@email.example.test` },
  }));
  assert.ok(results.some(result => result.status === 429), `expected a rate-limit response: ${results.map(result => result.status).join(',')}`);
  assert.ok(results.every(result => [200, 429].includes(result.status)));
});

test('concurrent correct password resets have one winner and one replacement session', async () => {
  const f = fixture(), owner = new Client(f);
  const registered = expect(await owner.request('/v1/auth/register', {
    body: { email: f.email, password: PASSWORD, nickname: '并发重置账号' },
  }), 201).user;
  const resetClient = new Client(f), challenge = await forgotCodeRequest(resetClient);
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    forgotReset(new Client(f), challenge, 'Concurrent-reset-password-2026!')));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.ok(results.every(result => [200, 400].includes(result.status)));
  const winner = results.find(result => result.status === 200);
  assert.equal(winner.data.passwordChanged, true); assert.equal(winner.data.user.id, registered.id);
  assert.match(winner.cookie, /HttpOnly/);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').bind(registered.id).first()).n, 1);
});

test('email config stays disabled honestly without enabled flag, sender, secret or a configured provider', async () => {
  const f = fixture(), client = new Client(f);
  const config = expect(await client.request('/v1/auth/email/config'), 200);
  assert.deepEqual(config, { enabled: true, expiresIn: 600, resendAfter: 60, note: '邮箱验证码 10 分钟内有效，60 秒后可重新获取。' });
  for (const env of [
    { ...f.env, EMAIL_AUTH_ENABLED: undefined }, { ...f.env, EMAIL_AUTH_ENABLED: 'TRUE' },
    { ...f.env, EMAIL: undefined }, { ...f.env, EMAIL: {} }, { ...f.env, EMAIL_FROM: undefined },
    { ...f.env, EMAIL_FROM: 'forged\r\n@example.test' }, { ...f.env, EMAIL_OTP_SECRET: 'short' },
    { ...f.env, EMAIL_PROVIDER: 'unknown' }, { ...f.env, EMAIL_PROVIDER: 'resend' },
  ]) {
    const disabled = expect(await client.request('/v1/auth/email/config', { env }), 200);
    assert.equal(disabled.enabled, false); assert.match(disabled.note, /尚未开通/);
    expect(await client.request('/v1/auth/email/request', { env, body: { email: f.email } }), 503);
    expect(await verify(client, { email: f.email, challengeId: randomUUID(), code: '000000' }, {}, { env }), 503);
  }
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM email_auth_challenges WHERE email=?').bind(f.email).first()).n, 0);
  assert.equal(f.deliveries.length, 0); assert.doesNotMatch(JSON.stringify(config), /secret|login@|messageId/);
});

test('email routes validate identity, fields, code and methods and retain browser-origin protection', async () => {
  const f = fixture(), client = new Client(f);
  for (const email of [null, '', 'not-an-email', 'x@localhost', 'x\0@y.test', 'x\n@y.test', `${'x'.repeat(255)}@y.test`])
    expect(await client.request('/v1/auth/email/request', { body: { email } }), 400);
  expect(await client.request('/v1/auth/email/request', { body: { email: f.email, role: 'super' } }), 400);
  expect(await client.request('/v1/auth/email/request'), 405);
  expect(await client.request('/v1/auth/email/config', { body: {} }), 405);
  expect(await client.request('/v1/auth/email/verify'), 405);
  expect(await client.request('/v1/auth/email/request', { body: { email: f.email }, headers: { Origin: 'https://foreign.example' } }), 403);
  const challenge = await codeRequest(client, `  ${f.email.toUpperCase()}  `);
  assert.equal(f.deliveries[0].to, f.email);
  for (const extra of [{ challengeId: 'invalid' }, { code: 123456 }, { code: '12345' }, { code: '1234567' }, { nickname: '' }, { nickname: 'x'.repeat(31) }, { role: 'super' }])
    expect(await verify(client, challenge, extra), 400);
  assert.equal((await DB.prepare('SELECT attempts FROM email_auth_challenges WHERE id=?').bind(challenge.challengeId).first()).attempts, 0);
});

test('concurrent requests reserve one cooldown and store only a challenge-bound HMAC with exact TTL', async () => {
  const f = fixture(), client = new Client(f);
  const results = await Promise.all(Array.from({ length: 20 }, () => client.request('/v1/auth/email/request', { body: { email: f.email } })));
  assert.equal(results.filter(result => result.status === 200).length, 1); assert.ok(results.every(result => [200, 429].includes(result.status)));
  assert.equal(f.deliveries.length, 1);
  const success = results.find(result => result.status === 200).data;
  assert.deepEqual(Object.keys(success).sort(), ['challengeId', 'expiresIn', 'resendAfter']);
  const row = await DB.prepare('SELECT * FROM email_auth_challenges WHERE id=?').bind(success.challengeId).first();
  const code = mailCode(f.deliveries[0]);
  assert.equal(row.expires_at - row.created_at, 600000); assert.equal(row.send_status, 'sent');
  assert.equal(row.code_hash, createHmac('sha256', SECRET).update(JSON.stringify([row.id, f.email, code])).digest('hex'));
  assert.ok(!Object.hasOwn(row, 'code')); assert.ok(!Object.values(row).includes(code));
  assert.match(f.deliveries[0].html, /strong/); assert.equal(f.deliveries[0].from, f.env.EMAIL_FROM);
});

test('wrong identity and five wrong attempts cannot log in; expiry and superseded codes remain unusable', async () => {
  const f = fixture(), client = new Client(f), first = await codeRequest(client);
  const wrong = first.code === '000000' ? '000001' : '000000';
  expect(await verify(client, first, { email: `other-${f.email}` }), 400);
  assert.equal((await DB.prepare('SELECT attempts FROM email_auth_challenges WHERE id=?').bind(first.challengeId).first()).attempts, 0);
  for (let i = 0; i < 5; i++) expect(await verify(client, first, { code: wrong }), 400);
  expect(await verify(client, first), 400);
  assert.equal((await DB.prepare('SELECT attempts FROM email_auth_challenges WHERE id=?').bind(first.challengeId).first()).attempts, 5);
  await clearCooldown(f.email);
  const expired = await codeRequest(client);
  await DB.prepare('UPDATE email_auth_challenges SET created_at=?,expires_at=? WHERE id=?').bind(Date.now() - 700000, Date.now() - 1, expired.challengeId).run();
  expect(await verify(client, expired), 400);
  await clearCooldown(f.email);
  const older = await codeRequest(client); await clearCooldown(f.email); const latest = await codeRequest(client);
  expect(await verify(client, older), 400);
  const result = expect(await verify(client, latest), 200);
  assert.equal(result.authenticated, true); assert.equal(result.registered, true); assert.equal(result.passwordSetupRequired, true);
  expect(await verify(client, latest), 400);
});

test('twenty simultaneous correct verifications create one user and one HttpOnly secure session', async () => {
  const f = fixture(), client = new Client(f), challenge = await codeRequest(client);
  const results = await Promise.all(Array.from({ length: 20 }, () => verify(new Client(f), challenge)));
  assert.equal(results.filter(result => result.status === 200).length, 1); assert.ok(results.every(result => [200, 400].includes(result.status)));
  const winner = results.find(result => result.status === 200);
  assert.match(winner.cookie, /HttpOnly/); assert.match(winner.cookie, /SameSite=Lax/); assert.match(winner.cookie, /Secure/);
  assert.equal(winner.data.user.emailVerified, true); assert.equal(winner.data.user.hasPassword, false); assert.equal(winner.data.user.role, 'user');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').bind(winner.data.user.id).first()).n, 1);
  assert.doesNotMatch(JSON.stringify(winner.data), /password_hash|code_hash|token_hash|claim_nonce/);
});

test('OTP upgrades the current guest in place and preserves private records, preferences, role and wallet', async () => {
  const f = fixture(), client = new Client(f), guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  const oldCookie = client.cookie, now = Date.now(), orderId = `pay_${randomUUID()}`, eventId = `evt_${randomUUID().replaceAll('-', '')}`;
  await DB.batch([
    DB.prepare("UPDATE users SET nickname='保留昵称',version=4 WHERE id=?").bind(guest.id),
    DB.prepare("INSERT INTO favorites(user_id,character_id) VALUES(?,'private-favorite')").bind(guest.id),
    DB.prepare("INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,'private-chat','private-character','游客会话',?)").bind(guest.id, now),
    DB.prepare("INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,'private-chat','m1','user','保留的游客消息',0)").bind(guest.id),
    DB.prepare("INSERT INTO preferences(user_id,nickname,persona,preset,model,dark,extra_json) VALUES(?,'保留昵称','persona','preset','balanced',1,'{\"bio\":\"保留简介\"}')").bind(guest.id),
    DB.prepare("INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at) VALUES(?,?,?,'usd_1',100,100,'live','paid',?,?,?)").bind(orderId, guest.id, randomUUID(), now, now, now),
    DB.prepare("INSERT INTO payment_events VALUES(?,'checkout.session.completed',?,'wallet-seed',?)").bind(eventId, orderId, now),
    DB.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',100,?)").bind(orderId, guest.id, eventId, now),
  ]);
  const challenge = await codeRequest(client);
  const upgraded = expect(await verify(client, challenge), 200);
  assert.equal(upgraded.user.id, guest.id); assert.equal(upgraded.user.nickname, '保留昵称'); assert.equal(upgraded.user.version, 5);
  assert.equal(upgraded.user.isGuest, false); assert.equal(upgraded.user.role, 'user');
  assert.equal((await DB.prepare('SELECT content FROM messages WHERE user_id=?').bind(guest.id).first()).content, '保留的游客消息');
  assert.equal((await DB.prepare('SELECT extra_json FROM preferences WHERE user_id=?').bind(guest.id).first()).extra_json, '{"bio":"保留简介"}');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=?').bind(guest.id).first()).n, 1);
  const wallet = expect(await client.request('/v1/payments/wallet', { env: { ...f.env, STRIPE_PAYMENT_MODE: 'live' } }), 200);
  assert.equal(wallet.balance, 100 + NEW_SIGNUP_CREDITS); assert.equal(wallet.totalPurchased, 100); assert.equal(wallet.orders[0].id, orderId);
  const state = await readState(DB, upgraded.user); assert.equal(state.user.emailVerified, true); assert.equal(state.user.passwordSetupRequired, true);
  assert.equal(expect(await new Client(f, oldCookie).request('/v1/session'), 200).user, null);
});

test('first legacy mailbox proof clears unverified password and every old session without merging another guest', async () => {
  const f = fixture(), attacker = new Client(f), owner = new Client(f);
  const legacy = expect(await attacker.request('/v1/auth/register', { body: { email: f.email, password: PASSWORD, nickname: '原身份' } }), 201).user;
  const another = new Client(f); expect(await another.request('/v1/auth/login', { body: { email: f.email, password: PASSWORD } }), 200);
  const visitor = expect(await owner.request('/v1/auth/guest', { body: {} }), 200).user;
  await DB.batch([DB.prepare("UPDATE users SET role='super' WHERE id=?").bind(legacy.id),
    DB.prepare("INSERT INTO favorites(user_id,character_id) VALUES(?,'guest-only')").bind(visitor.id)]);
  const challenge = await codeRequest(owner), result = expect(await verify(owner, challenge, { nickname: '不应覆盖' }), 200);
  assert.equal(result.user.id, legacy.id); assert.equal(result.registered, false); assert.equal(result.user.nickname, '原身份');
  assert.equal(result.user.role, 'super'); assert.equal(result.passwordSetupRequired, true);
  const row = await DB.prepare('SELECT password_hash,email_verified_at FROM users WHERE id=?').bind(legacy.id).first();
  assert.equal(row.password_hash, null); assert.ok(row.email_verified_at);
  for (const old of [attacker, another]) assert.equal(expect(await old.request('/v1/session'), 200).user, null);
  expect(await new Client(f).request('/v1/auth/login', { body: { email: f.email, password: PASSWORD } }), 401);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=?').bind(legacy.id).first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=?').bind(visitor.id).first()).n, 1);
  assert.equal((await DB.prepare('SELECT is_guest FROM users WHERE id=?').bind(visitor.id).first()).is_guest, 1);
});

test('passwordless setup requires verified current session, races safely and keeps password after subsequent OTP login', async () => {
  const f = fixture(), client = new Client(f), challenge = await codeRequest(client);
  const user = expect(await verify(client, challenge), 200).user, cookie = client.cookie;
  expect(await new Client(f).request('/v1/auth/password', { body: { accountId: user.id, currentPassword: '', newPassword: PASSWORD } }), 401);
  expect(await client.request('/v1/auth/password', { body: { accountId: user.id, currentPassword: '', newPassword: 'short' } }), 400);
  const alternatives = [PASSWORD, 'Another-verified-password-2026!'];
  const outcomes = await Promise.all(alternatives.map(newPassword => new Client(f, cookie).request('/v1/auth/password', { body: { accountId: user.id, currentPassword: '', newPassword } })));
  assert.equal(outcomes.filter(result => result.status === 200).length, 1); assert.ok(outcomes.every(result => [200, 401, 409].includes(result.status)));
  assert.equal(outcomes.find(result => result.status === 200).cookie, null);
  const password = alternatives[outcomes.findIndex(result => result.status === 200)];
  const session = expect(await client.request('/v1/session'), 200); assert.equal(session.user.hasPassword, true); assert.equal(session.user.passwordSetupRequired, false);
  const passwordClient = new Client(f); expect(await passwordClient.request('/v1/auth/login', { body: { email: f.email, password } }), 200);
  await clearCooldown(f.email); const newer = await codeRequest(client); const repeated = expect(await verify(client, newer), 200);
  assert.equal(repeated.registered, false); assert.equal(repeated.passwordSetupRequired, false);
  assert.equal(expect(await passwordClient.request('/v1/session'), 200).user.id, user.id);
  expect(await new Client(f).request('/v1/auth/login', { body: { email: f.email, password } }), 200);
  const unverifiedId = randomUUID(), unverifiedToken = randomBytes(32).toString('hex');
  await DB.batch([
    DB.prepare("INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,'未验证',0,?)").bind(unverifiedId, `${randomUUID()}@email.example.test`, Date.now()),
    DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(sessionDigest(unverifiedToken), unverifiedId, Date.now() + 600000, Date.now()),
  ]);
  expect(await new Client(f, `qingyu_session=${unverifiedToken}`).request('/v1/auth/password', { body: { accountId: unverifiedId, currentPassword: '', newPassword: PASSWORD } }), 401);
});

test('a stale guest snapshot cannot consume its proof or acquire the concurrently upgraded account', async () => {
  const f = fixture(), client = new Client(f), guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  const challenge = await codeRequest(client); let armed = false, changed = false;
  const racingDB = { prepare(sql) { if (sql.startsWith('UPDATE email_auth_challenges SET attempts')) armed = true; return DB.prepare(sql); },
    async batch(statements) { if (armed && !changed) { changed = true; await DB.batch([
      DB.prepare("UPDATE users SET email=?,is_guest=0,version=version+1 WHERE id=?").bind(`other-${f.email}`, guest.id),
      DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(guest.id),
    ]); } return DB.batch(statements); } };
  expect(await verify(client, challenge, {}, { env: { ...f.env, DB: racingDB } }), 409);
  assert.equal((await DB.prepare('SELECT consumed_at FROM email_auth_challenges WHERE id=?').bind(challenge.challengeId).first()).consumed_at, null);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').bind(guest.id).first()).n, 0);
  const recovered = expect(await verify(new Client(f), challenge), 200);
  assert.notEqual(recovered.user.id, guest.id); assert.equal(recovered.user.email, f.email);
});

test('a clean guest tab with a switched shared cookie cannot upgrade another guest or consume the email code', async () => {
  const f = fixture(), first = new Client(f), second = new Client(f);
  const guestA = expect(await first.request('/v1/auth/guest', { body: {} }), 200).user;
  const guestB = expect(await second.request('/v1/auth/guest', { body: {} }), 200).user;
  const firstCookie = first.cookie, challenge = await codeRequest(first);
  first.cookie = second.cookie;
  expect(await verify(first, challenge), 409);
  expect(await verify(first, challenge, { accountId: undefined }), 400);
  expect(await verify(first, challenge, { accountId: 'invalid-account' }), 400);
  const row = await DB.prepare('SELECT attempts,consumed_at FROM email_auth_challenges WHERE id=?').bind(challenge.challengeId).first();
  assert.equal(row.attempts, 0); assert.equal(row.consumed_at, null);
  for (const guest of [guestA, guestB]) assert.equal((await DB.prepare('SELECT is_guest FROM users WHERE id=?').bind(guest.id).first()).is_guest, 1);
  first.cookie = firstCookie;
  const accepted = expect(await verify(first, challenge), 200); assert.equal(accepted.user.id, guestA.id);
  assert.equal((await DB.prepare('SELECT is_guest FROM users WHERE id=?').bind(guestB.id).first()).is_guest, 1);
});

test('password setup pins the initiating account and rejects another account shared cookie before changing any password', async () => {
  const firstFixture = fixture(), secondFixture = fixture(), first = new Client(firstFixture), second = new Client(secondFixture);
  const userA = expect(await verify(first, await codeRequest(first)), 200).user;
  const userB = expect(await verify(second, await codeRequest(second)), 200).user;
  first.cookie = second.cookie;
  for (const accountId of [undefined, 'invalid-account'])
    expect(await first.request('/v1/auth/password', { body: { accountId, currentPassword: '', newPassword: PASSWORD } }), 400);
  expect(await first.request('/v1/auth/password', { body: { accountId: userA.id, currentPassword: '', newPassword: PASSWORD } }), 409);
  for (const user of [userA, userB]) assert.equal((await DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first()).password_hash, null);
  const changed = expect(await second.request('/v1/auth/password', { body: { accountId: userB.id, currentPassword: '', newPassword: PASSWORD } }), 200);
  assert.equal(changed.accountId, userB.id);
  assert.equal((await DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(userA.id).first()).password_hash, null);
});

test('registration between OTP snapshot and claim resolves to the actual email owner without identity conflict', async () => {
  const f = fixture(), client = new Client(f), challenge = await codeRequest(client), competingId = randomUUID();
  let armed = false, changed = false;
  const racingDB = { prepare(sql) { if (sql.startsWith('UPDATE email_auth_challenges SET attempts')) armed = true; return DB.prepare(sql); },
    async batch(statements) { if (armed && !changed) { changed = true;
      await DB.prepare("INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,'竞争注册',0,?)").bind(competingId, f.email, Date.now()).run();
    } return DB.batch(statements); } };
  const result = expect(await verify(client, challenge, {}, { env: { ...f.env, DB: racingDB } }), 200);
  assert.equal(result.user.id, competingId); assert.equal(result.registered, false); assert.equal(result.passwordSetupRequired, true);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 1);
});

test('an in-flight legacy password login cannot mint a session after mailbox ownership revokes that password', async () => {
  const f = fixture(), legacy = new Client(f), owner = new Client(f);
  expect(await legacy.request('/v1/auth/register', { body: { email: f.email, password: PASSWORD, nickname: '旧密码身份' } }), 201);
  const challenge = await codeRequest(owner); let armed = false, reset = false;
  const racingDB = { prepare(sql) { if (sql.startsWith('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) SELECT')) armed = true; return DB.prepare(sql); },
    async batch(statements) { if (armed && !reset) { reset = true; expect(await verify(owner, challenge), 200); } return DB.batch(statements); } };
  expect(await new Client(f).request('/v1/auth/login', { body: { email: f.email, password: PASSWORD }, env: { ...f.env, DB: racingDB } }), 401);
  assert.equal(reset, true);
  const user = expect(await owner.request('/v1/session'), 200).user;
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').bind(user.id).first()).n, 1);
});

test('transaction failure rolls back OTP consumption, user creation and session and permits a safe retry', async () => {
  const f = fixture(), client = new Client(f), challenge = await codeRequest(client);
  const brokenDB = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare("INSERT INTO users(id,nickname,is_guest,created_at) VALUES('rollback-email-test','invalid',9,1)")]) };
  expect(await verify(client, challenge, {}, { env: { ...f.env, DB: brokenDB } }), 500);
  assert.equal((await DB.prepare('SELECT consumed_at FROM email_auth_challenges WHERE id=?').bind(challenge.challengeId).first()).consumed_at, null);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(f.email).first()).n, 0);
  expect(await verify(client, challenge), 200);
});

test('a delayed email-provider failure invalidates only its old challenge and never leaks provider errors', async () => {
  const f = fixture(), client = new Client(f), sending = deferred(), started = deferred();
  f.env.EMAIL.send = async message => { f.deliveries.push(message); started.resolve(); return sending.promise; };
  const firstRequest = client.request('/v1/auth/email/request', { body: { email: f.email } });
  await started.promise;
  const older = await DB.prepare('SELECT id FROM email_auth_challenges WHERE email=?').bind(f.email).first();
  await clearCooldown(f.email);
  f.env.EMAIL.send = async message => { f.deliveries.push(message); return { messageId: randomUUID() }; };
  const newer = await codeRequest(client);
  sending.reject(new Error(`provider detail ${SECRET} ${mailCode(f.deliveries[0])}`));
  const failed = await firstRequest; expect(failed, 503); assert.equal(failed.data.error, '验证码邮件发送失败，请稍后重新获取。');
  assert.equal((await DB.prepare('SELECT send_status FROM email_auth_challenges WHERE id=?').bind(older.id).first()).send_status, 'failed');
  assert.equal((await DB.prepare('SELECT invalidated_at FROM email_auth_challenges WHERE id=?').bind(newer.challengeId).first()).invalidated_at, null);
  expect(await verify(client, newer), 200);
});

test('Resend adapter uses one fixed URL, server sender, challenge idempotency and only accepts a valid acknowledgement', async () => {
  const f = fixture(), client = new Client(f), messages = [], env = { ...f.env, EMAIL: undefined, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_isolated_email_fixture' };
  const config = expect(await client.request('/v1/auth/email/config', { env }), 200); assert.equal(config.enabled, true);
  const options = { async emailFetch(url, init) {
    assert.equal(url, 'https://api.resend.com/emails'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer re_isolated_email_fixture'); assert.ok(init.signal instanceof AbortSignal);
    const message = JSON.parse(init.body); messages.push(message); assert.equal(message.from, f.env.EMAIL_FROM); assert.equal(message.to, f.email);
    assert.ok(/^[a-f0-9-]{36}$/.test(new Headers(init.headers).get('Idempotency-Key')));
    return Response.json({ id: randomUUID() });
  } };
  const response = expect(await client.request('/v1/auth/email/request', { body: { email: f.email }, env, options }), 200);
  expect(await verify(client, { ...response, email: f.email, code: mailCode(messages[0]) }, {}, { env }), 200);
  assert.equal(f.deliveries.length, 0);
  for (const provider of [
    async () => { throw new DOMException('simulated timeout', 'TimeoutError'); },
    async () => Response.json({ error: `private provider error ${SECRET}` }, { status: 401 }),
    async () => new Response('not json'), async () => Response.json({}), async () => Response.json({ id: '' }),
    async () => new Response('x'.repeat(65537)),
  ]) {
    const email = `${randomUUID()}@email.example.test`;
    const result = await client.request('/v1/auth/email/request', { body: { email }, env, options: { emailFetch: provider } });
    expect(result, 503); assert.equal(result.data.error, '验证码邮件发送失败，请稍后重新获取。');
    const row = await DB.prepare('SELECT send_status,invalidated_at FROM email_auth_challenges WHERE email=?').bind(email).first();
    assert.equal(row.send_status, 'failed'); assert.ok(row.invalidated_at);
  }
});

test('email migration preserves legacy accounts and sessions and adds an unverified mailbox state', async () => {
  const migrationStore = memoryStore('email-migration-test');
  try {
    const database = await migrationStore.getD1Database('DB'); await migrate(database, migrations.filter(file => file < '0010_email_auth.sql'));
    const userId = randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,password_hash,nickname,is_guest,version,mutation_token,created_at,role) VALUES(?,?,'legacy-hash','原用户',0,7,'original-token',1,'super')").bind(userId, 'legacy-migration@example.test'),
      database.prepare("INSERT INTO sessions VALUES('old-session',?,9999999999999,1)").bind(userId),
      database.prepare("INSERT INTO favorites VALUES(?,'original-favorite',3)").bind(userId),
    ]);
    const before = await database.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    const sessions = (await database.prepare('SELECT * FROM sessions').all()).results;
    await migrate(database, ['0010_email_auth.sql']);
    assert.deepEqual(await database.prepare('SELECT * FROM users WHERE id=?').bind(userId).first(), { ...before, email_verified_at: null });
    assert.deepEqual((await database.prepare('SELECT * FROM sessions').all()).results, sessions);
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM favorites').first()).n, 1);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await migrationStore.dispose(); }
});
