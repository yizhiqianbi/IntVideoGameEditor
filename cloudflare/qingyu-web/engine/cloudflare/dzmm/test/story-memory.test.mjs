import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// The API runs against transactional D1 in disposable workerd storage. No provider
// request, remote binding, or normal development database is involved.
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { readState } = await tsImport('../src/data.ts', import.meta.url);
const { createDzmmStoryMemory } = await tsImport('../../../src/lib/dzmm-story-memory.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
const origin = 'https://story-memory.example.test';
let store, DB;

function memoryStore(name) {
  return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated story store")}}', d1Databases: { DB: name } }));
}
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => { store = memoryStore('story-memory-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });

class Client {
  cookie = '';
  accountId;
  ip = randomUUID();
  async request(path, { method = 'GET', body } = {}) {
    const request = new Request(`${origin}${path}`, { method, headers: {
      Origin: origin, 'CF-Connecting-IP': this.ip, Cookie: this.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = await fetchRequest(request, { DB, APP_ORIGINS: origin });
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}
function expect(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const messages = () => [
  { id: 'opening', role: 'assistant', content: '你抵达雾港档案室，档案员递来一张地图。' },
  { id: 'question', role: 'user', content: '我收下地图，先查看港口。' },
  { id: 'answer', role: 'assistant', content: '地图标出了旧码头，档案员请你稍后回报。' },
];
const storyState = (summary = '旅人已经收下地图，准备查看旧码头。') => ({ summary, scene: '雾港档案室',
  completed: ['已收下地图'], pending: ['查看旧码头后向档案员回报'], relationships: ['档案员委托旅人查看旧码头'], items: ['旅人持有地图'] });
async function fixture() {
  const client = new Client();
  expect(await client.request('/v1/auth/guest', { method: 'POST' }));
  const conversation = { id: `story-${randomUUID()}`, characterId: 'qy-shiyu', title: '雾港地图', updatedAt: 1000,
    messages: messages() };
  conversation.storyMemory = createDzmmStoryMemory(storyState(), conversation.messages);
  const saved = expect(await client.request('/v1/conversations', { method: 'POST', body: { conversation } }));
  return { client, conversation, saved };
}
async function snapshot(client) { return expect(await client.request('/v1/state')); }
async function save(client, state, version) {
  return client.request('/v1/state', { method: 'PUT', body: { state, version, accountId: client.accountId } });
}
const find = (envelope, id) => envelope.state.conversations.find(conversation => conversation.id === id);
const patch = (client, id, conversation) => client.request(`/v1/conversations/${id}`, { method: 'PATCH', body: { conversation } });
const replaceMessages = (client, id, nextMessages) => client.request(`/v1/conversations/${id}/messages`, { method: 'PUT', body: { messages: nextMessages } });

test('additive memory migration preserves existing conversations and original messages', async () => {
  const migrationStore = memoryStore('story-memory-migration');
  try {
    const database = await migrationStore.getD1Database('DB');
    await migrate(database, migrations.filter(file => file < '0014_conversation_story_memory.sql'));
    const userId = randomUUID();
    await database.batch([
      database.prepare('INSERT INTO users(id,nickname,is_guest,created_at) VALUES (?, ?, 1, 0)').bind(userId, '旧会话用户'),
      database.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES (?, ?, ?, ?, 0)')
        .bind(userId, 'old-story', 'qy-shiyu', '原始会话'),
      database.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES (?, ?, ?, ?, ?, 0)')
        .bind(userId, 'old-story', 'original', 'assistant', '原始消息需要完整保留。'),
    ]);
    await migrate(database, ['0014_conversation_story_memory.sql']);
    const row = await database.prepare('SELECT story_memory_json FROM conversations WHERE user_id=?').bind(userId).first();
    assert.equal(row.story_memory_json, null);
    const restored = await readState(database, { id: userId });
    assert.deepEqual(restored.state.conversations[0].messages, [{ id: 'original', role: 'assistant', content: '原始消息需要完整保留。' }]);
    assert.equal(Object.hasOwn(restored.state.conversations[0], 'storyMemory'), false);
  } finally { await migrationStore.dispose(); }
});

test('story memory round-trips through D1 and memory-only state changes persist without rewriting history', async () => {
  const { client, conversation, saved } = await fixture();
  assert.deepEqual(find(saved, conversation.id).storyMemory, conversation.storyMemory);
  const reloaded = await snapshot(client);
  assert.deepEqual(find(reloaded, conversation.id), conversation);
  const state = structuredClone(reloaded.state);
  const changed = createDzmmStoryMemory(storyState('地图已收下；下一步去旧码头。'), conversation.messages);
  state.conversations[0].storyMemory = changed;
  const updated = expect(await save(client, state, reloaded.version));
  assert.equal(updated.version, reloaded.version + 1);
  assert.deepEqual(find(await snapshot(client), conversation.id).storyMemory, changed);
  assert.deepEqual(find(updated, conversation.id).messages, conversation.messages);
  const row = await DB.prepare('SELECT story_memory_json FROM conversations WHERE user_id=? AND id=?')
    .bind(client.accountId, conversation.id).first();
  assert.deepEqual(JSON.parse(row.story_memory_json), changed);
});

test('message replacement retains matching memory for appended turns and removes it for edits, ID changes, or truncation', async () => {
  const { client, conversation } = await fixture();
  const appended = [...conversation.messages, { id: 'new-question', role: 'user', content: '现在去旧码头。' }];
  const extended = expect(await replaceMessages(client, conversation.id, appended));
  assert.deepEqual(find(extended, conversation.id).storyMemory, conversation.storyMemory);
  const changedPrefixes = [
    conversation.messages.map((message, index) => index === 1 ? { ...message, content: '我拒绝收下地图。' } : message),
    conversation.messages.map((message, index) => index === 2 ? { ...message, id: 'regenerated-answer' } : message),
    conversation.messages.slice(0, 2),
  ];
  for (const changed of changedPrefixes) {
    expect(await replaceMessages(client, conversation.id, conversation.messages));
    expect(await patch(client, conversation.id, { storyMemory: conversation.storyMemory }));
    const updated = expect(await replaceMessages(client, conversation.id, changed));
    assert.deepEqual(find(updated, conversation.id).messages, changed);
    assert.equal(Object.hasOwn(find(updated, conversation.id), 'storyMemory'), false);
    const row = await DB.prepare('SELECT story_memory_json FROM conversations WHERE user_id=? AND id=?')
      .bind(client.accountId, conversation.id).first();
    assert.equal(row.story_memory_json, null);
  }
});

test('memory patches validate provenance, reject unsupported writes atomically, and accept explicit clearing', async () => {
  const { client, conversation } = await fixture();
  const before = await snapshot(client);
  const wrongSource = createDzmmStoryMemory(storyState(), [{ ...conversation.messages[0], content: '另一段故事。' }]);
  for (const supplied of [{ storyMemory: { ...conversation.storyMemory, version: 2 } }, { storyMemory: wrongSource },
    { messages: [] }, { storyMemory: conversation.storyMemory, unrelated: true }]) {
    expect(await patch(client, conversation.id, supplied), 400);
    assert.deepEqual(await snapshot(client), before);
  }
  const malformedState = structuredClone(before.state);
  malformedState.conversations[0].storyMemory.state.pending = '无效列表';
  expect(await save(client, malformedState, before.version), 400);
  assert.deepEqual(await snapshot(client), before);
  const cleared = expect(await patch(client, conversation.id, { storyMemory: null }));
  assert.equal(Object.hasOwn(find(cleared, conversation.id), 'storyMemory'), false);
  assert.deepEqual(find(cleared, conversation.id).messages, conversation.messages);
  expect(await patch(client, conversation.id, { storyMemory: conversation.storyMemory }));
  assert.deepEqual(find(await snapshot(client), conversation.id).storyMemory, conversation.storyMemory);
});

test('character reassignment clears remembered story facts in conversation PATCH and whole-state PUT', async () => {
  const { client, conversation } = await fixture();
  const changed = expect(await patch(client, conversation.id, { characterId: 'qy-shen', storyMemory: conversation.storyMemory }));
  assert.equal(find(changed, conversation.id).characterId, 'qy-shen');
  assert.equal(Object.hasOwn(find(changed, conversation.id), 'storyMemory'), false);
  assert.deepEqual(find(changed, conversation.id).messages, conversation.messages);
  expect(await patch(client, conversation.id, { storyMemory: conversation.storyMemory }));
  const before = await snapshot(client);
  const state = structuredClone(before.state);
  state.conversations[0].characterId = 'qy-shiyu';
  const replaced = expect(await save(client, state, before.version));
  assert.equal(Object.hasOwn(find(replaced, conversation.id), 'storyMemory'), false);
  assert.deepEqual(find(replaced, conversation.id).messages, conversation.messages);
});

test('malformed or stale stored memory never prevents original messages from loading', async () => {
  const { client, conversation } = await fixture();
  const wrongSource = createDzmmStoryMemory(storyState(), [{ ...conversation.messages[0], id: 'different-story' }]);
  for (const invalid of [{ version: 99 }, wrongSource]) {
    await DB.prepare('UPDATE conversations SET story_memory_json=? WHERE user_id=? AND id=?')
      .bind(JSON.stringify(invalid), client.accountId, conversation.id).run();
    const restored = find(await snapshot(client), conversation.id);
    assert.deepEqual(restored.messages, conversation.messages);
    assert.equal(Object.hasOwn(restored, 'storyMemory'), false);
  }
});
