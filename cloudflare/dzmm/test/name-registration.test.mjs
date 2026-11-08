import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
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

test('a unique name registers the current guest, keeps the id, and grants signup credit once', async () => {
  const client = new Client(fixture());
  const guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  assert.equal(guest.isGuest, true);
  await DB.prepare("INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,'kept-chat','private-original','保留的会话',?)").bind(guest.id, Date.now()).run();
  const registered = expect(await client.request('/v1/auth/register', { body: { nickname: '  林　沐沐  ' } }), 201).user;
  assert.equal(registered.id, guest.id);
  assert.equal(registered.isGuest, false);
  assert.equal(registered.email, null);
  assert.equal(registered.nickname, '林 沐沐');
  assert.equal(registered.passwordSetupRequired, false);
  assert.equal(registered.hasPassword, false);
  assert.equal(registered.emailVerified, false);
  const session = expect(await client.request('/v1/session'), 200);
  assert.equal(session.authenticated, true);
  assert.equal(session.user.email, null);
  assert.equal((await DB.prepare('SELECT id FROM conversations WHERE user_id=? AND id=?').bind(guest.id, 'kept-chat').first()).id, 'kept-chat');
  assert.equal((await DB.prepare('SELECT name_key FROM account_names WHERE user_id=?').bind(guest.id).first()).name_key, '林 沐沐');
  const rows = await grants(guest.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].credits, NEW_SIGNUP_CREDITS);
  assert.equal(rows[0].reason, 'new_signup');
  const wallet = expect(await client.request('/v1/payments/wallet'), 200);
  assert.equal(wallet.balance, NEW_SIGNUP_CREDITS);
});

test('taken, case-variant, spaced, reserved, and legacy display names cannot be registered again', async () => {
  const owner = new Client(fixture());
  expect(await owner.request('/v1/auth/register', { body: { nickname: 'Ada Lovelace' } }), 201);
  const variants = ['Ada Lovelace', 'ada lovelace', '  ADA   lovelace  ', 'Ａda Lovelace'];
  for (const nickname of variants) {
    const other = new Client(fixture());
    const denied = await other.request('/v1/auth/register', { body: { nickname } });
    assert.equal(denied.status, 409, JSON.stringify(denied));
    assert.equal(denied.data.error, '这个名字已被使用，请换一个。');
    const session = expect(await other.request('/v1/session'), 200);
    assert.equal(session.user, null);
  }
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM account_names WHERE name_key='ada lovelace'").first()).n, 1);
  assert.equal((await DB.prepare("SELECT user_id FROM account_names WHERE name_key='ada lovelace'").first()).user_id, owner.user.id);
  const reserved = await new Client(fixture()).request('/v1/auth/register', { body: { nickname: '游客' } });
  assert.equal(reserved.status, 400, JSON.stringify(reserved));
  assert.equal(reserved.data.error, '这个名字不能使用。');
  const blank = await new Client(fixture()).request('/v1/auth/register', { body: { nickname: '   ' } });
  assert.equal(blank.status, 400);
  const longName = await new Client(fixture()).request('/v1/auth/register', { body: { nickname: '名'.repeat(31) } });
  assert.equal(longName.status, 400);
  const legacy = new Client(fixture());
  expect(await legacy.request('/v1/auth/register', { body: { email: legacy.f.email, password: PASSWORD, nickname: 'Legacy Shared' } }), 201);
  const blockedByLegacy = await new Client(fixture()).request('/v1/auth/register', { body: { nickname: 'legacy shared' } });
  assert.equal(blockedByLegacy.status, 409, JSON.stringify(blockedByLegacy));
  const sameDisplay = new Client(fixture());
  expect(await sameDisplay.request('/v1/auth/register', { body: { email: sameDisplay.f.email, password: PASSWORD, nickname: 'Ada Lovelace' } }), 201);
});

test('simultaneous claims of one name leave a single account', async () => {
  const name = `同时${randomUUID().slice(0, 8)}`;
  const clients = [new Client(fixture()), new Client(fixture())];
  const results = await Promise.all(clients.map(client => client.request('/v1/auth/register', { body: { nickname: name } })));
  const statuses = results.map(result => result.status).sort();
  assert.deepEqual(statuses, [201, 409], JSON.stringify(results));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_guest=0 AND lower(trim(nickname))=lower(?)').bind(name).first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM account_names WHERE name_key=?').bind(name).first()).n, 1);
});

test('a registered name can later bind an unused email and then set a password', async () => {
  const client = new Client(fixture());
  const guest = expect(await client.request('/v1/auth/guest', { body: {} }), 200).user;
  const guestBind = await client.request('/v1/auth/email/bind/request', { body: { accountId: guest.id, email: client.f.email } });
  assert.equal(guestBind.status, 400, JSON.stringify(guestBind));
  assert.equal(guestBind.data.error, '请先用名字注册，再绑定邮箱。');
  expect(await client.request('/v1/auth/register', { body: { nickname: `绑定${randomUUID().slice(0, 8)}` } }), 201);
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
  assert.equal(bound.id, guest.id);
  assert.equal(client.cookie, cookie);
  const session = expect(await client.request('/v1/session'), 200);
  assert.equal(session.user.email, client.f.email);
  assert.equal((await grants(client.user.id)).length, 1);
  const again = await client.request('/v1/auth/email/bind/request', { body: { accountId: client.user.id, email: `${randomUUID()}@name.example.test` } });
  assert.equal(again.status, 409, JSON.stringify(again));
  assert.equal(again.data.error, '这个账号已经绑定邮箱。');
  const taken = new Client(fixture());
  expect(await taken.request('/v1/auth/register', { body: { nickname: `另名${randomUUID().slice(0, 8)}` } }), 201);
  const occupied = await taken.request('/v1/auth/email/bind/request', { body: { accountId: taken.user.id, email: client.f.email } });
  assert.equal(occupied.status, 409, JSON.stringify(occupied));
  assert.equal(occupied.data.error, '这个邮箱已绑定其他账号。');
  expect(await client.request('/v1/auth/password', { body: { accountId: client.user.id, currentPassword: '', newPassword: PASSWORD } }), 200);
  expect(await client.request('/v1/auth/logout', { body: {} }), 200);
  const loggedIn = expect(await client.request('/v1/auth/login', { body: { email: client.f.email, password: PASSWORD } }), 200).user;
  assert.equal(loggedIn.id, guest.id);
  assert.equal(loggedIn.email, client.f.email);
  assert.equal(loggedIn.passwordSetupRequired, false);
});
