import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { digest } = await tsImport('../src/auth.ts', import.meta.url);
const { NEW_SIGNUP_CREDITS } = await tsImport('../src/signup-credits.ts', import.meta.url);
const PASSWORD = 'Name-register-test-password-2026!';
let store, DB;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("name registration test")}}', d1Databases: { DB: 'name-registration-tests' } }));
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
  const env = { DB, APP_ORIGINS: 'https://xumengchat.top', STRIPE_PAYMENT_MODE: 'live', EMAIL_AUTH_ENABLED: 'true',
    EMAIL_FROM: 'login@xumengchat.top', EMAIL_OTP_SECRET: 'name-registration-test-email-secret-2026',
    EMAIL: { async send(message) { deliveries.push(message); return { messageId: randomUUID() }; } } };
  return { env, deliveries, ip: randomUUID(), email: `${randomUUID()}@name.example.test` };
}
class Client {
  constructor(f, cookie = '') { this.f = f; this.cookie = cookie; }
  async request(path, { body, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetchRequest(new Request(`https://xumengchat.top${path}`, { method,
      headers: { Origin: 'https://xumengchat.top', Cookie: this.cookie, 'CF-Connecting-IP': this.f.ip,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) }), this.f.env);
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (Object.hasOwn(data, 'user') && data.user) this.user = data.user;
    return { status: response.status, data };
  }
}
function expect(result, ...statuses) {
  assert.ok(statuses.includes(result.status), JSON.stringify(result));
  return result.data;
}
async function grants(userId) {
  return (await DB.prepare('SELECT grant_key,credits,reason FROM trusted_credit_grants WHERE user_id=?').bind(userId).all()).results;
}

async function seedLegacy(nickname) {
  const f = fixture();
  const userId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await DB.prepare('INSERT INTO users (id,email,password_hash,nickname,is_guest,version,created_at) VALUES (?,NULL,NULL,?,0,0,?)').bind(userId, nickname, now).run();
  await DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(digest(token), userId, now + 30 * 24 * 60 * 60 * 1000, now).run();
  const client = new Client(f, `dzmm_session=${token}`);
  client.user = { id: userId, email: null, nickname };
  return client;
}

test('email and password register the current guest, keep the id, and grant signup credit once', async () => {
  const client = new Client(fixture());
  const guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  assert.equal(guest.isGuest, true);
  await DB.prepare("INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,'kept-chat','private-original','保留的会话',?)").bind(guest.id, Date.now()).run();
  const nameOnly = await client.request('/v1/auth/register', { body: { nickname: '林沐沐' } });
  assert.equal(nameOnly.status, 400, JSON.stringify(nameOnly));
  assert.equal(nameOnly.data.error, '请输入有效的邮箱。');
  assert.equal(expect(await client.request('/v1/session'), 200).user.isGuest, true);
  const registered = expect(await client.request('/v1/auth/register', { body: { email: `  ${client.f.email.toUpperCase()}  `, password: PASSWORD, nickname: '  林　沐沐  ' } }), 201).user;
  assert.equal(registered.id, guest.id);
  assert.equal(registered.isGuest, false);
  assert.equal(registered.email, client.f.email);
  assert.equal(registered.nickname, '林 沐沐');
  assert.equal(registered.passwordSetupRequired, false);
  assert.equal(registered.hasPassword, true);
  assert.equal(registered.emailVerified, false);
  const session = expect(await client.request('/v1/session'), 200);
  assert.equal(session.authenticated, true);
  assert.equal(session.user.email, client.f.email);
  assert.equal((await DB.prepare('SELECT id FROM conversations WHERE user_id=? AND id=?').bind(guest.id, 'kept-chat').first()).id, 'kept-chat');
  const rows = await grants(guest.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].credits, NEW_SIGNUP_CREDITS);
  assert.equal(rows[0].reason, 'new_signup');
  const wallet = expect(await client.request('/v1/payments/wallet'), 200);
  assert.equal(wallet.balance, NEW_SIGNUP_CREDITS);
  expect(await client.request('/v1/auth/logout', { body: {} }), 200);
  const loggedIn = expect(await client.request('/v1/auth/login', { body: { email: client.f.email, password: PASSWORD } }), 200).user;
  assert.equal(loggedIn.id, guest.id);
});

test('registration rejects a missing password, a short password, and a reserved or blank name', async () => {
  const client = new Client(fixture());
  const missingPassword = await client.request('/v1/auth/register', { body: { email: client.f.email, nickname: '林沐沐' } });
  assert.equal(missingPassword.status, 400, JSON.stringify(missingPassword));
  assert.equal(missingPassword.data.error, '密码需要 12 至 256 个字符。');
  const shortPassword = await client.request('/v1/auth/register', { body: { email: client.f.email, password: 'short', nickname: '林沐沐' } });
  assert.equal(shortPassword.status, 400, JSON.stringify(shortPassword));
  assert.equal(shortPassword.data.error, '密码需要 12 至 256 个字符。');
  const reserved = await client.request('/v1/auth/register', { body: { email: client.f.email, password: PASSWORD, nickname: '游客' } });
  assert.equal(reserved.status, 400, JSON.stringify(reserved));
  assert.equal(reserved.data.error, '这个名字不能使用。');
  const blank = await client.request('/v1/auth/register', { body: { email: client.f.email, password: PASSWORD, nickname: '   ' } });
  assert.equal(blank.status, 400, JSON.stringify(blank));
  const longName = await client.request('/v1/auth/register', { body: { email: client.f.email, password: PASSWORD, nickname: '名'.repeat(31) } });
  assert.equal(longName.status, 400, JSON.stringify(longName));
  assert.equal(expect(await client.request('/v1/session'), 200).user, null);
  const first = new Client(fixture());
  const second = new Client(fixture());
  expect(await first.request('/v1/auth/register', { body: { email: first.f.email, password: PASSWORD, nickname: 'Ada Lovelace' } }), 201);
  expect(await second.request('/v1/auth/register', { body: { email: second.f.email, password: PASSWORD, nickname: 'Ada Lovelace' } }), 201);
});

test('requests without email and password do not create an account', async () => {
  const name = `同时${randomUUID().slice(0, 8)}`;
  const clients = [new Client(fixture()), new Client(fixture())];
  const results = await Promise.all(clients.map(client => client.request('/v1/auth/register', { body: { nickname: name } })));
  assert.ok(results.every(result => result.status === 400), JSON.stringify(results));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_guest=0 AND nickname=?').bind(name).first()).n, 0);
});

test('a legacy account without an email can still bind one and then set a password', async () => {
  const guestClient = new Client(fixture());
  const guest = expect(await guestClient.request('/v1/auth/guest', { body: {} }), 200).user;
  const guestBind = await guestClient.request('/v1/auth/email/bind/request', { body: { accountId: guest.id, email: guestClient.f.email } });
  assert.equal(guestBind.status, 400, JSON.stringify(guestBind));
  assert.equal(guestBind.data.error, '请先注册账号，再绑定邮箱。');
  const client = await seedLegacy(`绑定${randomUUID().slice(0, 8)}`);
  const cookie = client.cookie;
  const requested = expect(await client.request('/v1/auth/email/bind/request', { body: { accountId: client.user.id, email: `  ${client.f.email.toUpperCase()}  ` } }), 200);
  assert.match(client.f.deliveries.at(-1).subject, /绑定邮箱/);
  const code = client.f.deliveries.at(-1).text.match(/验证码是 (\d{6})/)[1];
  const wrong = await client.request('/v1/auth/email/bind', { body: { accountId: client.user.id, email: client.f.email, challengeId: requested.challengeId, code: code === '000000' ? '000001' : '000000' } });
  assert.equal(wrong.status, 400, JSON.stringify(wrong));
  const bound = expect(await client.request('/v1/auth/email/bind', { body: { accountId: client.user.id, email: client.f.email, challengeId: requested.challengeId, code } }), 200).user;
  assert.equal(bound.email, client.f.email);
  assert.equal(bound.passwordSetupRequired, true);
  assert.equal(bound.hasPassword, false);
  assert.equal(bound.id, client.user.id);
  assert.equal(client.cookie, cookie);
  const session = expect(await client.request('/v1/session'), 200);
  assert.equal(session.user.email, client.f.email);
  assert.equal((await grants(client.user.id)).length, 0);
  const again = await client.request('/v1/auth/email/bind/request', { body: { accountId: client.user.id, email: `${randomUUID()}@name.example.test` } });
  assert.equal(again.status, 409, JSON.stringify(again));
  assert.equal(again.data.error, '这个账号已经绑定邮箱。');
  const taken = await seedLegacy(`另名${randomUUID().slice(0, 8)}`);
  const occupied = await taken.request('/v1/auth/email/bind/request', { body: { accountId: taken.user.id, email: client.f.email } });
  assert.equal(occupied.status, 409, JSON.stringify(occupied));
  assert.equal(occupied.data.error, '这个邮箱已绑定其他账号。');
  expect(await client.request('/v1/auth/password', { body: { accountId: client.user.id, currentPassword: '', newPassword: PASSWORD } }), 200);
  expect(await client.request('/v1/auth/logout', { body: {} }), 200);
  const loggedIn = expect(await client.request('/v1/auth/login', { body: { email: client.f.email, password: PASSWORD } }), 200).user;
  assert.equal(loggedIn.id, bound.id);
  assert.equal(loggedIn.email, client.f.email);
  assert.equal(loggedIn.passwordSetupRequired, false);
});
