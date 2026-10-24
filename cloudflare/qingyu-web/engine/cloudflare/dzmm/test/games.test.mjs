import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { XUMENG_GAME_INLINE_BYTES, XUMENG_GAME_MAX_BODY_BYTES, XUMENG_GAME_MAX_SOURCE_BYTES, createXumengGameDraft } = await tsImport('../../../src/lib/xumeng-games.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
const origin = 'https://creator-games.example.test';
let store, DB, MEDIA;
function memoryStore(name) { return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
  script: 'export default {fetch(){return new Response("isolated game store")}}', d1Databases: { DB: name }, r2Buckets: { MEDIA: name } })); }
async function migrate(db, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await db.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  }
}
before(async () => { store = memoryStore('creator-games-tests'); DB = await store.getD1Database('DB'); MEDIA = await store.getR2Bucket('MEDIA'); await migrate(DB); });
after(async () => { await store?.dispose(); });
class Client {
  cookie = ''; accountId; ip = randomUUID();
  async request(path, { method = 'GET', body, raw, headers = {}, database = DB } = {}) {
    const response = await fetchRequest(new Request(`${origin}${path}`, { method, headers: { Origin: origin,
      'CF-Connecting-IP': this.ip, Cookie: this.cookie, ...(body === undefined && raw === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), { DB: database, MEDIA, APP_ORIGINS: origin });
    const cookie = response.headers.get('Set-Cookie'); if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json(); if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}
function expect(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
async function member() {
  const client = new Client();
  expect(await client.request('/v1/auth/register', { method: 'POST', body: { email: `game-${randomUUID()}@example.test`, password: `Isolated-${randomUUID()}`, nickname: '原创游戏测试作者' } }), 201);
  return client;
}
const game = (id = randomUUID()) => ({ ...createXumengGameDraft('story', () => id), title: ' 原创 · 雾港地图 ', synopsis: '  寻找归航的路线。\n🌊 ', source: '<!doctype html><h1>雾港 🌊</h1>\n<script>document.body.dataset.started="yes"</script>\n' });
const body = (client, value, version) => ({ accountId: client.accountId, game: value, ...(version === undefined ? {} : { version }) });
const create = async (client, value = game()) => expect(await client.request('/v1/games', { method: 'POST', body: body(client, value) }), 201);
const get = async (client, id) => expect(await client.request(`/v1/games/${id}`));
const save = (client, value, version) => client.request(`/v1/games/${value.id}`, { method: 'PUT', body: body(client, value, version) });

test('additive game migration preserves old accounts, conversations and novels; cascade is scoped', async () => {
  const isolated = memoryStore('creator-game-migration');
  try {
    const database = await isolated.getD1Database('DB');
    await migrate(database, migrations.filter(file => file < '0034_creator_games.sql'));
    await database.batch([
      database.prepare("INSERT INTO users(id,nickname,is_guest,version,created_at) VALUES('existing-game-author','已有作者',0,7,123)"),
      database.prepare("INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES('existing-game-author','old-chat','qy-shiyu','已有会话',456)"),
      database.prepare("INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES('existing-game-author','old-chat','old-message','assistant','已有正文',0)"),
      database.prepare("INSERT INTO novels(user_id,id,title,synopsis,type,tags_json,notes,outline,characters_json,version,mutation_token,created_at,updated_at) VALUES('existing-game-author','old-work','已有小说','','novel','[]','','','[]',2,'old',123,456)"),
    ]);
    const statements = ['users', 'conversations', 'messages', 'novels'].map(table => database.prepare(`SELECT * FROM ${table}`));
    const before = await database.batch(statements);
    await migrate(database, ['0034_creator_games.sql']);
    const after = await database.batch(statements);
    assert.deepEqual(after.map(item => item.results), before.map(item => item.results));
    assert.deepEqual((await database.prepare('SELECT * FROM creator_games').all()).results, []);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await isolated.dispose(); }
});

test('router requires authenticated registered users and rejects cross-origin mutations', async () => {
  const anonymous = new Client();
  for (const [path, method] of [['/v1/games', 'GET'], ['/v1/games', 'POST'], ['/v1/games/missing', 'GET'], ['/v1/games/missing', 'PUT'], ['/v1/games/missing', 'DELETE']]) {
    expect(await anonymous.request(path, { method, ...(method === 'GET' ? {} : { body: {} }) }), 401);
  }
  const guest = new Client(); expect(await guest.request('/v1/auth/guest', { method: 'POST' }));
  expect(await guest.request('/v1/games'), 403);
  expect(await guest.request('/v1/games', { method: 'POST', body: body(guest, game()) }), 403);
  const client = await member();
  expect(await client.request('/v1/games', { method: 'POST', body: body(client, game()), headers: { Origin: 'https://hostile.example.test' } }), 403);
  assert.deepEqual(expect(await client.request('/v1/games')).games, []);
});

test('private game persists exact Unicode and whitespace, reopens and lists metadata without source', async () => {
  const client = await member(), value = game();
  const stateBefore = expect(await client.request('/v1/state'));
  const detail = await create(client, value);
  assert.deepEqual(Object.fromEntries(Object.keys(value).map(key => [key, detail.game[key]])), value);
  assert.equal(detail.game.version, 1); assert.ok(detail.game.createdAt > 0);
  const reopened = new Client(); reopened.cookie = client.cookie;
  assert.deepEqual(await get(reopened, value.id), detail);
  const list = expect(await client.request('/v1/games'));
  assert.equal(list.accountId, client.accountId); assert.equal(list.games.length, 1);
  assert.equal(Object.hasOwn(list.games[0], 'source'), false);
  assert.equal(list.games[0].sourceBytes, Buffer.byteLength(value.source));
  assert.deepEqual(expect(await client.request('/v1/state')), stateBefore);
});

test('account and ownership checks prevent reading, saving, conflict leakage and deleting another author', async () => {
  const owner = await member(), other = await member(), value = game();
  const original = await create(owner, value);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const result = await other.request(`/v1/games/${value.id}`, { method, ...(method === 'GET' ? {} : { body: method === 'PUT' ? body(other, value, 1) : { accountId: other.accountId, version: 1 } }) });
    expect(result, 404); assert.equal(result.data.accountId, other.accountId); assert.equal(Object.hasOwn(result.data, 'current'), false);
  }
  expect(await owner.request('/v1/games', { method: 'POST', body: { accountId: other.accountId, game: game() } }), 401);
  expect(await owner.request(`/v1/games/${value.id}`, { method: 'PUT', body: { accountId: other.accountId, game: value, version: 1 } }), 401);
  expect(await owner.request(`/v1/games/${value.id}`, { method: 'DELETE', body: { accountId: other.accountId, version: 1 } }), 401);
  await create(other, { ...value, source: '<h1>另一账号的私人作品</h1>' });
  assert.deepEqual(await get(owner, value.id), original);
  assert.equal((await get(other, value.id)).game.source, '<h1>另一账号的私人作品</h1>');
});

test('simultaneous versioned saves admit one winner and retain an authenticated conflict snapshot', async () => {
  const client = await member(), value = game(); await create(client, value);
  const results = await Promise.all([save(client, { ...value, source: '<h1>左侧修改</h1>' }, 1), save(client, { ...value, source: '<h1>右侧修改</h1>' }, 1)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const accepted = results.find(result => result.status === 200).data;
  const rejected = results.find(result => result.status === 409).data;
  assert.deepEqual(rejected.current, accepted); assert.equal(rejected.accountId, client.accountId);
  assert.equal(accepted.game.version, 2); assert.deepEqual(await get(client, value.id), accepted);
  expect(await client.request(`/v1/games/${value.id}`, { method: 'DELETE', body: { accountId: client.accountId, version: 1 } }), 409);
  expect(await client.request(`/v1/games/${value.id}`, { method: 'DELETE', body: { accountId: client.accountId, version: 2 } }));
  expect(await client.request(`/v1/games/${value.id}`), 404);
});

test('duplicate creates and lost acknowledgement retries do not overwrite or duplicate a saved game', async () => {
  const client = await member(), value = game(); const detail = await create(client, value);
  const retry = expect(await client.request('/v1/games', { method: 'POST', body: body(client, value) }), 409);
  assert.deepEqual(retry.current, detail);
  const changed = expect(await client.request('/v1/games', { method: 'POST', body: body(client, { ...value, source: '<h1>后续改稿</h1>' }) }), 409);
  assert.deepEqual(changed.current, detail); assert.equal(expect(await client.request('/v1/games')).games.length, 1);
});

test('strict source byte, transport, shape, identity and version validation leaves saved source intact', async () => {
  const client = await member(), value = game(); const original = await create(client, value);
  for (const invalid of [{ ...value, title: ' ' }, { ...value, source: '中'.repeat(Math.ceil(XUMENG_GAME_MAX_SOURCE_BYTES / 3)) },
    { ...value, source: 'hidden\0source' }, { ...value, id: 'invalid/id' }, { ...value, privateKey: 'unsupported' }]) {
    expect(await client.request(`/v1/games/${value.id}`, { method: 'PUT', body: body(client, invalid, 1) }), 400);
  }
  for (const version of [null, '1', 0, 1.5, Number.MAX_SAFE_INTEGER]) expect(await save(client, value, version), 400);
  expect(await client.request(`/v1/games/${value.id}`, { method: 'PUT', body: { ...body(client, value, 1), unsupported: true } }), 400);
  expect(await client.request('/v1/games', { method: 'POST', raw: JSON.stringify(body(client, { ...value, source: 'x'.repeat(XUMENG_GAME_MAX_BODY_BYTES + 1) })), headers: { 'Content-Length': '1' } }), 413);
  expect(await client.request('/v1/games/invalid%2Fid'), 400);
  assert.deepEqual(await get(client, value.id), original);
  const boundary = { ...game(), source: '\t'.repeat(XUMENG_GAME_INLINE_BYTES) };
  const valid = await create(client, boundary); assert.equal(valid.game.source.length, XUMENG_GAME_INLINE_BYTES);
  const inline = await DB.prepare('SELECT length(CAST(source AS BLOB)) AS bytes, media_bytes, media_key FROM creator_games WHERE user_id=? AND id=?').bind(client.accountId, valid.game.id).first();
  assert.equal(inline.bytes, XUMENG_GAME_INLINE_BYTES); assert.equal(inline.media_bytes, 0); assert.equal(inline.media_key, null);
  const externalSource = `${'港'.repeat(100_000)}<script>document.body.dataset.started="yes"</script>`;
  const external = { ...game(), source: externalSource };
  const saved = await create(client, external);
  assert.equal(saved.game.source, externalSource);
  const stored = await DB.prepare('SELECT source, media_bytes, media_key FROM creator_games WHERE user_id=? AND id=?').bind(client.accountId, saved.game.id).first();
  assert.equal(stored.source, ''); assert.equal(stored.media_bytes, new TextEncoder().encode(externalSource).byteLength); assert.ok(stored.media_key);
  assert.equal((await get(client, saved.game.id)).game.source, externalSource);
  assert.equal(expect(await client.request('/v1/games')).games.find(item => item.id === saved.game.id).sourceBytes, stored.media_bytes);
  const shrunk = { ...external, source: '<h1>缩小</h1>' };
  assert.equal(expect(await save(client, shrunk, 1)).game.source, shrunk.source);
  const after = await DB.prepare('SELECT source, media_bytes, media_key FROM creator_games WHERE user_id=? AND id=?').bind(client.accountId, saved.game.id).first();
  assert.equal(after.source, shrunk.source); assert.equal(after.media_bytes, 0); assert.equal(after.media_key, null);
  assert.equal(await MEDIA.get(stored.media_key), null);
  expect(await client.request(`/v1/games/${saved.game.id}`, { method: 'DELETE', body: { accountId: client.accountId, version: 2 } }));
});

test('deleting an author cascades only that author’s private game rows', async () => {
  const owner = await member(), other = await member(), shared = game();
  await create(owner, shared); await create(other, { ...shared, title: '另一作者' });
  await DB.prepare('DELETE FROM users WHERE id=?').bind(owner.accountId).run();
  assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM creator_games WHERE user_id=?').bind(owner.accountId).first()).count, 0);
  assert.equal((await get(other, shared.id)).game.title, '另一作者');
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});
