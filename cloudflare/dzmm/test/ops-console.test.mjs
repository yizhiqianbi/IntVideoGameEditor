import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { resolveGuaguaPackage } = await tsImport('../src/ops-console.ts', import.meta.url);
let store, DB, env;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated ops")}}', d1Databases: { DB: 'ops-console-tests' } }));
  DB = await store.getD1Database('DB');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => DB.prepare(sql)));
  }
  env = { DB, APP_ORIGINS: 'https://ops.example.test' };
});
after(async () => { await store?.dispose(); });

async function account(role = 'user', guest = false) {
  const user = { id: randomUUID(), email: `${randomUUID()}@ops.example.test`, nickname: '运营测试', role, isGuest: guest };
  const token = randomBytes(32).toString('hex'), now = Date.now();
  await DB.batch([
    DB.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,?,?,?)').bind(user.id, user.email, user.nickname, guest ? 1 : 0, role, now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'), user.id, now + 86400000, now),
  ]);
  return { user, token };
}
function request(actor, path, body) {
  return new Request(`https://ops.example.test${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: `dzmm_session=${actor.token}`, ...(body ? { 'Content-Type': 'application/json', Origin: 'https://ops.example.test' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function api(actor, path, body) {
  const response = await fetchRequest(request(actor, path, body), env);
  return { status: response.status, value: await response.json() };
}

test('ops routes stay super-only and the seeded catalogue stays purchasable', async () => {
  const user = await account();
  const admin = await account('super');
  assert.equal((await api(user, '/v1/admin/ops/packages')).status, 403);
  const packages = await api(admin, '/v1/admin/ops/packages');
  assert.equal(packages.status, 200);
  assert.deepEqual(packages.value.packages.map(item => [item.id, item.credits, item.checkoutReady]), [
    ['cny_188', 30000, true], ['cny_88', 10000, true], ['cny_28', 2800, true],
  ]);
  assert.equal((await api(admin, '/v1/admin/ops/packages', { accountId: admin.user.id, amountMinor: 1000, credits: 1000, weight: 9, enabled: true })).status, 400);
  const created = await api(admin, '/v1/admin/ops/packages', { accountId: admin.user.id, confirmed: true, amountMinor: 1200, credits: 2000, bonusCredits: 800, bonusRatio: '66.67', weight: 9, enabled: true });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  assert.equal(created.value.package.checkoutReady, false);
  await assert.rejects(() => resolveGuaguaPackage(env, created.value.package.id), error => error.status === 409);
  const custom = await resolveGuaguaPackage(env, 'cny_28');
  assert.equal(custom.credits, 2800);
  const prices = await fetchRequest(new Request('https://ops.example.test/v1/billing/scene-prices'), env);
  const scene = await prices.json();
  assert.equal(scene.prices.find(item => item.scene === 'image').amount, 10);
  const filters = await (await fetchRequest(new Request('https://ops.example.test/v1/catalog/filters'), env)).json();
  assert.ok(filters.orientations.some(item => item.name === '男性向'));
});

test('official cards start unlisted, users keep realtime stats, and the board renders empty days', async () => {
  const admin = await account('super');
  const guest = await account('user', true);
  const created = await api(admin, '/v1/admin/ops/characters', { accountId: admin.user.id, confirmed: true, name: '官方测试', cardType: 'companion', story: '一段短故事' });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  assert.equal(created.value.character.status, 'unlisted');
  const listed = await api(admin, `/v1/admin/ops/characters/${created.value.character.id}/list`, { accountId: admin.user.id, confirmed: true });
  assert.equal(listed.status, 200);
  const users = await api(admin, `/v1/admin/users?accountKind=guest&userId=${guest.user.id}`);
  assert.equal(users.status, 200, JSON.stringify(users.value));
  assert.equal(users.value.items.length, 1);
  assert.equal(users.value.items[0].inviteCount, null);
  assert.equal(typeof users.value.items[0].availableCredits, 'number');
  const board = await api(admin, '/v1/admin/ops/analytics');
  assert.equal(board.status, 200, JSON.stringify(board.value));
  assert.ok(board.value.days.length >= 1 && board.value.days.length <= 31);
  assert.equal(board.value.days.at(-1).suggestionUses, null);
  const event = await api(guest, '/v1/metrics/events', { accountId: guest.user.id, name: 'landing' });
  assert.equal(event.status, 200, JSON.stringify(event.value));
  const voices = await api(admin, '/v1/admin/ops/voices/sync', { accountId: admin.user.id });
  assert.equal(voices.status, 200, JSON.stringify(voices.value));
  assert.ok(voices.value.voices.some(item => item.id === 'melotts'));
});
