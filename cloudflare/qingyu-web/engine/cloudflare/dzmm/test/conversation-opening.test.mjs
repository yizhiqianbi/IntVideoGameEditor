import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Exercise the real authenticated API and transactional D1 using disposable local storage.
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { readState } = await tsImport('../src/data.ts', import.meta.url);
const { captureDzmmConversationOpening } = await tsImport('../../../src/lib/dzmm-conversation-context.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
const origin = 'https://opening.example.test';
let store, DB;

function memoryStore(name) {
  return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated opening store")}}', d1Databases: { DB: name } }));
}
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => { store = memoryStore('opening-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });

class Client {
  cookie = '';
  accountId;
  ip = randomUUID();
  async request(path, { method = 'GET', body } = {}) {
    const response = await fetchRequest(new Request(`${origin}${path}`, { method, headers: {
      Origin: origin, 'CF-Connecting-IP': this.ip, Cookie: this.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === undefined ? undefined : JSON.stringify(body) }), { DB, APP_ORIGINS: origin });
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}
function expect(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const find = (envelope, id) => envelope.state.conversations.find(conversation => conversation.id === id);
const snapshot = async client => expect(await client.request('/v1/state'));
const save = (client, state, version) => client.request('/v1/state', { method: 'PUT', body: { state, version, accountId: client.accountId } });
const replace = (client, id, messages) => client.request(`/v1/conversations/${id}/messages`, { method: 'PUT', body: { messages } });

async function fixture({ empty = false } = {}) {
  const client = new Client();
  expect(await client.request('/v1/auth/guest', { method: 'POST' }));
  const character = { id: `local-${randomUUID()}`, name: '成年书店店员', description: '整理图书的成年店员',
    firstMessage: '我们身处雨巷书店。', alternateGreetings: ['次日清晨，我们在车站告别。'] };
  expect(await client.request('/v1/characters', { method: 'POST', body: { character } }));
  const opening = captureDzmmConversationOpening(character, 1);
  const conversation = { id: `opening-${randomUUID()}`, characterId: character.id, title: character.name, updatedAt: 1000,
    opening, messages: empty ? [] : opening.messages.map((message, index) => ({ ...message, id: `opening-${index}` })) };
  const saved = expect(await client.request('/v1/conversations', { method: 'POST', body: { conversation } }));
  return { client, character, conversation: find(saved, conversation.id), saved };
}

test('opening migration preserves existing messages and nullable metadata', async () => {
  const migrationStore = memoryStore('opening-migration');
  try {
    const database = await migrationStore.getD1Database('DB');
    await migrate(database, migrations.filter(file => file < '0019_conversation_opening.sql'));
    const userId = randomUUID();
    await database.batch([
      database.prepare('INSERT INTO users(id,nickname,is_guest,created_at) VALUES (?, ?, 1, 0)').bind(userId, '旧用户'),
      database.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES (?, ?, ?, ?, 0)').bind(userId, 'old-opening', 'qy-shiyu', '原始会话'),
      database.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES (?, ?, ?, ?, ?, 0)').bind(userId, 'old-opening', 'original', 'assistant', '最初的书店开场。'),
    ]);
    await migrate(database, ['0019_conversation_opening.sql']);
    assert.deepEqual(await database.prepare('SELECT opening_json FROM conversations WHERE user_id=?').bind(userId).first(), { opening_json: null });
    const restored = await readState(database, { id: userId });
    assert.deepEqual(restored.state.conversations[0].messages, [{ id: 'original', role: 'assistant', content: '最初的书店开场。' }]);
    assert.equal(Object.hasOwn(restored.state.conversations[0], 'opening'), false);
  } finally { await migrationStore.dispose(); }
});

test('selected opening survives D1 reload, character revision and older-client sync', async () => {
  const { client, character, conversation } = await fixture();
  assert.deepEqual(find(await snapshot(client), conversation.id), conversation);
  expect(await client.request(`/v1/characters/${character.id}`, { method: 'PATCH', body: { character: { firstMessage: '我们身处医院。', alternateGreetings: ['夜晚的码头。'] } } }));
  const before = await snapshot(client);
  const state = structuredClone(before.state);
  delete state.conversations[0].opening;
  state.conversations[0].title = '旧客户端只改标题';
  const changed = find(expect(await save(client, state, before.version)), conversation.id);
  assert.deepEqual(changed.opening, conversation.opening);
  assert.deepEqual(changed.messages, conversation.messages);
  const row = await DB.prepare('SELECT opening_json FROM conversations WHERE user_id=? AND id=?').bind(client.accountId, conversation.id).first();
  assert.deepEqual(JSON.parse(row.opening_json), conversation.opening);
});

test('an empty new conversation restores its selected alternate rather than the current main opening', async () => {
  const { client, conversation } = await fixture({ empty: true });
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].content, '次日清晨，我们在车站告别。');
  assert.deepEqual(find(await snapshot(client), conversation.id).opening, conversation.opening);
});

test('editing or deleting the actual opening clears its template classification', async () => {
  const { client, conversation } = await fixture();
  const appended = [...conversation.messages, { id: 'question', role: 'user', content: '道别后去买早餐。' }];
  assert.deepEqual(find(expect(await replace(client, conversation.id, appended)), conversation.id).opening, conversation.opening);
  const edited = appended.map((message, index) => index ? message : { ...message, content: '今早我们在书店碰面。' });
  const changed = find(expect(await replace(client, conversation.id, edited)), conversation.id);
  assert.deepEqual(changed.messages, edited);
  assert.deepEqual(changed.opening, { version: 1, source: 'history', kind: 'opening', messages: [] });
  const empty = find(expect(await replace(client, conversation.id, [])), conversation.id);
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.opening.source, 'history');
});

test('damaged optional metadata never hides real messages and malformed writes reject atomically', async () => {
  const { client, conversation } = await fixture();
  for (const value of ['{broken', JSON.stringify({ ...conversation.opening, source: 'history' })]) {
    await DB.prepare('UPDATE conversations SET opening_json=? WHERE user_id=? AND id=?').bind(value, client.accountId, conversation.id).run();
    const restored = find(await snapshot(client), conversation.id);
    assert.deepEqual(restored.messages, conversation.messages);
    assert.equal(Object.hasOwn(restored, 'opening'), false);
  }
  const before = await snapshot(client);
  for (const opening of [{ version: 2 }, { ...conversation.opening, messages: [{ role: 'assistant', content: 'a'.repeat(12001) }] }]) {
    const state = structuredClone(before.state);
    state.conversations[0].opening = opening;
    expect(await save(client, state, before.version), 400);
    assert.equal((await snapshot(client)).version, before.version);
  }
});
