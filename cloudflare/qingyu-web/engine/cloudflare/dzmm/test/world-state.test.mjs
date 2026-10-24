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
const { createDzmmWorldState } = await tsImport('../../../src/lib/dzmm-world-state.ts', import.meta.url);
const { fingerprintDzmmStoryMessages } = await tsImport('../../../src/lib/dzmm-story-memory.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
const origin = 'https://world-state.example.test';
let store, DB;

function memoryStore(name) {
  return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated world store")}}', d1Databases: { DB: name } }));
}
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => { store = memoryStore('world-state-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
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
const messages = () => [
  { id: 'opening', role: 'assistant', content: '你来到港口，档案员等在码头。' },
  { id: 'question', role: 'user', content: '我们在这里等半小时，再去灯塔。' },
  { id: 'answer', role: 'assistant', content: '半小时后，你们抵达灯塔门口。' },
];
function journal(history) {
  return { version: 1, snapshots: [1, 3].map(sourceCount => ({
    sourceCount, sourceFingerprint: fingerprintDzmmStoryMessages(history.slice(0, sourceCount)), recordedAt: 1_000 * sourceCount, clockMode: 'story',
    state: { ...createDzmmWorldState(), location: sourceCount === 1 ? '港口码头' : '灯塔门口',
      clock: { elapsedMinutes: sourceCount === 1 ? 0 : 30, day: 1, minuteOfDay: sourceCount === 1 ? 540 : 570, calendarLabel: '故事第一天', remainderMs: 0 },
      relationships: [{ name: '档案员', affinity: 1, trust: 3, tension: 0, note: '刚刚一同来到码头。' }],
      threads: [{ id: 'visit-lighthouse', kind: 'goal', text: '一起去灯塔。', status: sourceCount === 1 ? 'open' : 'done', dueAtMinute: 30 }],
      facts: ['档案员与旅人同行。'],
    },
  })) };
}
const modeChanges = () => [
  { recordedAt: 1_000, clockMode: 'story' },
  { recordedAt: 4_000, clockMode: 'realtime' },
  { recordedAt: 5_000, clockMode: 'story' },
  { recordedAt: 86_405_000, clockMode: 'realtime' },
];
async function fixture({ timeline = false } = {}) {
  const client = new Client();
  expect(await client.request('/v1/auth/guest', { method: 'POST' }));
  const conversation = { id: `world-${randomUUID()}`, characterId: 'qy-shiyu', title: '港口与灯塔', updatedAt: 1000,
    messages: messages(), worldClockMode: 'story' };
  conversation.worldState = journal(conversation.messages);
  if (timeline) {
    conversation.worldState.modeChanges = modeChanges();
    conversation.worldClockMode = 'realtime';
  }
  const saved = expect(await client.request('/v1/conversations', { method: 'POST', body: { conversation } }));
  return { client, conversation, saved };
}
async function snapshot(client) { return expect(await client.request('/v1/state')); }
const save = (client, state, version, accountId = client.accountId) =>
  client.request('/v1/state', { method: 'PUT', body: { state, version, accountId } });
const find = (envelope, id) => envelope.state.conversations.find(conversation => conversation.id === id);
const patch = (client, id, conversation) => client.request(`/v1/conversations/${id}`, { method: 'PATCH', body: { conversation } });
const replaceMessages = (client, id, history) => client.request(`/v1/conversations/${id}/messages`, { method: 'PUT', body: { messages: history } });

test('world-state migration preserves existing conversations and original messages', async () => {
  const migrationStore = memoryStore('world-state-migration');
  try {
    const database = await migrationStore.getD1Database('DB');
    await migrate(database, migrations.filter(file => file < '0016_conversation_world_state.sql'));
    const userId = randomUUID();
    await database.batch([
      database.prepare('INSERT INTO users(id,nickname,is_guest,created_at) VALUES (?, ?, 1, 0)').bind(userId, '旧用户'),
      database.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES (?, ?, ?, ?, 0)')
        .bind(userId, 'old-world', 'qy-shiyu', '原始会话'),
      database.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES (?, ?, ?, ?, ?, 0)')
        .bind(userId, 'old-world', 'original', 'assistant', '原始消息完整保留。'),
    ]);
    await migrate(database, ['0016_conversation_world_state.sql']);
    const row = await database.prepare('SELECT world_state_json,world_clock_mode FROM conversations WHERE user_id=?').bind(userId).first();
    assert.deepEqual(row, { world_state_json: null, world_clock_mode: null });
    const restored = await readState(database, { id: userId });
    assert.deepEqual(restored.state.conversations[0].messages, [{ id: 'original', role: 'assistant', content: '原始消息完整保留。' }]);
    assert.equal(Object.hasOwn(restored.state.conversations[0], 'worldState'), false);
    assert.equal(Object.hasOwn(restored.state.conversations[0], 'worldClockMode'), false);
  } finally { await migrationStore.dispose(); }
});

test('world journals round-trip through D1, batch sync, PATCH, and both clock modes', async () => {
  const { client, conversation, saved } = await fixture();
  assert.deepEqual(find(saved, conversation.id), conversation);
  const before = await snapshot(client);
  const state = structuredClone(before.state);
  state.conversations[0].worldState.snapshots[1].state.location = '灯塔一层';
  state.conversations[0].worldClockMode = 'realtime';
  state.preferences.worldClockMode = 'realtime';
  const changed = expect(await save(client, state, before.version));
  assert.equal(changed.version, before.version + 1);
  assert.deepEqual(find(await snapshot(client), conversation.id), state.conversations[0]);
  assert.equal(changed.state.preferences.worldClockMode, 'realtime');
  assert.deepEqual(find(changed, conversation.id).messages, conversation.messages);
  const row = await DB.prepare('SELECT world_state_json,world_clock_mode FROM conversations WHERE user_id=? AND id=?')
    .bind(client.accountId, conversation.id).first();
  assert.deepEqual(JSON.parse(row.world_state_json), state.conversations[0].worldState);
  assert.equal(row.world_clock_mode, 'realtime');
  const patched = expect(await patch(client, conversation.id, { worldClockMode: 'story', worldState: conversation.worldState }));
  assert.deepEqual(find(patched, conversation.id).worldState, conversation.worldState);
  assert.equal(find(patched, conversation.id).worldClockMode, 'story');
  expect(await client.request('/v1/preferences', { method: 'PATCH', body: { preferences: { worldClockMode: 'story' } } }));
  assert.equal((await snapshot(client)).state.preferences.worldClockMode, 'story');
});

test('message edits, deletions, and regeneration prune only checkpoints whose source changed', async () => {
  const { client, conversation } = await fixture();
  const appended = [...conversation.messages, { id: 'new-question', role: 'user', content: '推开灯塔的门。' }];
  assert.deepEqual(find(expect(await replaceMessages(client, conversation.id, appended)), conversation.id).worldState, conversation.worldState);
  for (const changed of [
    conversation.messages.slice(0, 2),
    conversation.messages.map((message, index) => index === 1 ? { ...message, content: '只等五分钟。' } : message),
    conversation.messages.map((message, index) => index === 2 ? { ...message, id: 'regenerated-answer' } : message),
  ]) {
    expect(await replaceMessages(client, conversation.id, conversation.messages));
    expect(await patch(client, conversation.id, { worldState: conversation.worldState }));
    const updated = find(expect(await replaceMessages(client, conversation.id, changed)), conversation.id);
    assert.deepEqual(updated.messages, changed);
    assert.deepEqual(updated.worldState, { version: 1, snapshots: conversation.worldState.snapshots.slice(0, 1) });
    const row = await DB.prepare('SELECT world_state_json FROM conversations WHERE user_id=? AND id=?').bind(client.accountId, conversation.id).first();
    assert.deepEqual(JSON.parse(row.world_state_json), updated.worldState);
  }
  const branch = conversation.messages.map(message => ({ ...message, id: `branch-${message.id}` }));
  const branched = find(expect(await replaceMessages(client, conversation.id, branch)), conversation.id);
  assert.deepEqual(branched.messages, branch);
  assert.equal(Object.hasOwn(branched, 'worldState'), false);
});

test('whole-state sync prunes stale supplied checkpoints and preserves omitted fields from older clients', async () => {
  const { client, conversation } = await fixture();
  let before = await snapshot(client);
  let state = structuredClone(before.state);
  state.preferences.worldClockMode = 'realtime';
  expect(await save(client, state, before.version));
  before = await snapshot(client);
  state = structuredClone(before.state);
  delete state.conversations[0].worldState;
  delete state.conversations[0].worldClockMode;
  delete state.preferences.worldClockMode;
  state.conversations[0].title = '旧客户端修改的标题';
  const legacy = find(expect(await save(client, state, before.version)), conversation.id);
  assert.deepEqual(legacy.worldState, conversation.worldState);
  assert.equal(legacy.worldClockMode, 'story');
  assert.equal((await snapshot(client)).state.preferences.worldClockMode, 'realtime');
  before = await snapshot(client);
  state = structuredClone(before.state);
  state.conversations[0].messages[1].content = '修改原始决定。';
  const edited = find(expect(await save(client, state, before.version)), conversation.id);
  assert.deepEqual(edited.worldState, { version: 1, snapshots: conversation.worldState.snapshots.slice(0, 1) });
  before = await snapshot(client);
  state = structuredClone(before.state);
  delete state.conversations[0].worldState;
  state.conversations[0].messages[0].content = '另一段开场。';
  const replaced = find(expect(await save(client, state, before.version)), conversation.id);
  assert.equal(Object.hasOwn(replaced, 'worldState'), false);
  assert.deepEqual(replaced.messages, state.conversations[0].messages);
  // An empty supplied journal is explicit during whole-state replacement.
  expect(await replaceMessages(client, conversation.id, conversation.messages));
  expect(await patch(client, conversation.id, { worldState: conversation.worldState }));
  before = await snapshot(client);
  state = structuredClone(before.state);
  state.conversations[0].worldState = { version: 1, snapshots: [] };
  const cleared = find(expect(await save(client, state, before.version)), conversation.id);
  assert.equal(Object.hasOwn(cleared, 'worldState'), false);
});

test('malformed, oversized, mismatched, or invalid-date journal writes reject atomically and null clears explicitly', async () => {
  const { client, conversation } = await fixture();
  const before = await snapshot(client);
  const first = conversation.worldState.snapshots[0];
  const invalidJournals = [
    { version: 2, snapshots: [] },
    { version: 1, snapshots: [{ ...first, sourceFingerprint: fingerprintDzmmStoryMessages([{ ...conversation.messages[0], content: '其他故事。' }]) }] },
    { version: 1, snapshots: [{ ...first, recordedAt: -1 }] },
    { version: 1, snapshots: [{ ...first, recordedAt: 8_640_000_000_000_001 }] },
    { version: 1, snapshots: [{ ...first, state: { ...first.state, location: '长'.repeat(40_001) } }] },
    { version: 1, snapshots: Array.from({ length: 9 }, (_, index) => ({ ...first, sourceCount: index + 1 })) },
  ];
  for (const worldState of invalidJournals) {
    expect(await patch(client, conversation.id, { worldState }), 400);
    assert.deepEqual(await snapshot(client), before);
  }
  const invalidState = structuredClone(before.state);
  invalidState.conversations[0].worldState = invalidJournals[0];
  expect(await save(client, invalidState, before.version), 400);
  for (const worldClockMode of ['hybrid', null, 42]) {
    expect(await patch(client, conversation.id, { worldClockMode }), 400);
    expect(await client.request('/v1/preferences', { method: 'PATCH', body: { preferences: { worldClockMode } } }), 400);
  }
  assert.deepEqual(await snapshot(client), before);
  const cleared = find(expect(await patch(client, conversation.id, { worldState: null })), conversation.id);
  assert.equal(Object.hasOwn(cleared, 'worldState'), false);
  assert.deepEqual(cleared.messages, conversation.messages);
  const row = await DB.prepare('SELECT world_state_json FROM conversations WHERE user_id=? AND id=?').bind(client.accountId, conversation.id).first();
  assert.equal(row.world_state_json, null);
});

test('changing the character clears world journals in both PATCH and batch sync', async () => {
  const { client, conversation } = await fixture();
  const unchanged = find(expect(await patch(client, conversation.id, { characterId: conversation.characterId })), conversation.id);
  assert.deepEqual(unchanged.worldState, conversation.worldState);
  const changed = find(expect(await patch(client, conversation.id, { characterId: 'qy-shen', worldState: conversation.worldState })), conversation.id);
  assert.equal(Object.hasOwn(changed, 'worldState'), false);
  assert.deepEqual(changed.messages, conversation.messages);
  expect(await patch(client, conversation.id, { worldState: conversation.worldState }));
  const before = await snapshot(client);
  const state = structuredClone(before.state);
  state.conversations[0].characterId = conversation.characterId;
  const replaced = find(expect(await save(client, state, before.version)), conversation.id);
  assert.equal(Object.hasOwn(replaced, 'worldState'), false);
  assert.deepEqual(replaced.messages, conversation.messages);
});

test('malformed or stale persisted journals never prevent original messages from loading', async () => {
  const { client, conversation } = await fixture();
  for (const invalid of ['{broken JSON', JSON.stringify({ version: 99 }), ' '.repeat(40_001),
    JSON.stringify(journal(conversation.messages.map(message => ({ ...message, id: `wrong-${message.id}` }))))]) {
    await DB.prepare('UPDATE conversations SET world_state_json=? WHERE user_id=? AND id=?').bind(invalid, client.accountId, conversation.id).run();
    const restored = find(await snapshot(client), conversation.id);
    assert.deepEqual(restored.messages, conversation.messages);
    assert.equal(Object.hasOwn(restored, 'worldState'), false);
  }
});

test('world-state endpoints retain account ownership and revision protections', async () => {
  const { client, conversation } = await fixture();
  const other = new Client();
  expect(await other.request('/v1/auth/guest', { method: 'POST' }));
  expect(await other.request(`/v1/conversations/${conversation.id}`), 404);
  expect(await patch(other, conversation.id, { worldState: conversation.worldState }), 404);
  const before = await snapshot(client);
  const otherBefore = await snapshot(other);
  expect(await save(other, before.state, otherBefore.version, client.accountId), 401);
  expect(await patch(client, conversation.id, { title: '已经更新的标题' }));
  expect(await save(client, before.state, before.version), 409);
  const after = await snapshot(client);
  assert.equal(find(after, conversation.id).title, '已经更新的标题');
  assert.deepEqual(find(after, conversation.id).worldState, conversation.worldState);
  assert.deepEqual(await snapshot(other), otherBefore);
});

test('mode-change timelines round-trip through authenticated POST, GET, whole-state PUT, PATCH and message replacement', async () => {
  const { client, conversation, saved } = await fixture({ timeline: true });
  assert.deepEqual(find(saved, conversation.id), conversation);
  assert.deepEqual(expect(await client.request(`/v1/conversations/${conversation.id}`)).conversation, conversation);
  let before = await snapshot(client);
  const state = structuredClone(before.state);
  state.conversations[0].title = '保留暂停记录的标题';
  expect(await save(client, state, before.version));
  before = await snapshot(client);
  assert.deepEqual(find(before, conversation.id).worldState.modeChanges, modeChanges());
  const changedJournal = structuredClone(conversation.worldState);
  changedJournal.snapshots[1].state.location = '灯塔楼梯旁';
  const changed = find(expect(await patch(client, conversation.id, { worldState: changedJournal })), conversation.id);
  assert.deepEqual(changed.worldState, changedJournal);
  assert.deepEqual(find(expect(await patch(client, conversation.id, { title: '仅更新标题' })), conversation.id).worldState, changedJournal);
  const appended = [...conversation.messages, { id: 'fourth', role: 'user', content: '看一看楼梯上的地图。' }];
  const replaced = find(expect(await replaceMessages(client, conversation.id, appended)), conversation.id);
  assert.deepEqual(replaced.worldState, changedJournal);
  assert.deepEqual(find(await snapshot(client), conversation.id).worldState, changedJournal);
  const row = await DB.prepare('SELECT world_state_json,world_clock_mode FROM conversations WHERE user_id=? AND id=?')
    .bind(client.accountId, conversation.id).first();
  assert.deepEqual(JSON.parse(row.world_state_json), changedJournal);
  assert.equal(row.world_clock_mode, 'realtime');
});

test('nested timeline omission preserves existing pauses for unchanged snapshots and safe older-client rewinds', async () => {
  const { client, conversation } = await fixture({ timeline: true });
  let before = await snapshot(client);
  let state = structuredClone(before.state);
  delete state.conversations[0].worldState.modeChanges;
  delete state.conversations[0].worldClockMode;
  state.conversations[0].title = '旧页面修改标题';
  const saved = find(expect(await save(client, state, before.version)), conversation.id);
  assert.deepEqual(saved.worldState, conversation.worldState);
  assert.equal(saved.worldClockMode, 'realtime');
  const nestedLegacy = structuredClone(conversation.worldState);
  delete nestedLegacy.modeChanges;
  assert.deepEqual(find(expect(await patch(client, conversation.id, { worldState: nestedLegacy })), conversation.id).worldState, conversation.worldState);
  before = await snapshot(client);
  state = structuredClone(before.state);
  state.conversations[0].messages = conversation.messages.slice(0, 2);
  state.conversations[0].worldState = { version: 1, snapshots: nestedLegacy.snapshots.slice(0, 1) };
  const rewound = find(expect(await save(client, state, before.version)), conversation.id);
  assert.deepEqual(rewound.worldState, { version: 1, snapshots: nestedLegacy.snapshots.slice(0, 1), modeChanges: modeChanges() });
  before = await snapshot(client);
  state = structuredClone(before.state);
  delete state.conversations[0].worldState;
  state.conversations[0].title = '完全不认识世界字段的旧页面';
  assert.deepEqual(find(expect(await save(client, state, before.version)), conversation.id).worldState, rewound.worldState);
});

test('nested timeline omission rejects mode changes and modified or new narrative snapshots without changing D1 or revision', async () => {
  const { client, conversation } = await fixture({ timeline: true });
  const before = await snapshot(client);
  const legacy = structuredClone(conversation.worldState);
  delete legacy.modeChanges;
  const changedClock = structuredClone(legacy);
  changedClock.snapshots[1].state.clock.elapsedMinutes += 5;
  const changedLocation = structuredClone(legacy);
  changedLocation.snapshots[1].state.location = '另一座灯塔';
  const newSnapshot = structuredClone(legacy);
  newSnapshot.snapshots.splice(1, 0, { ...structuredClone(legacy.snapshots[0]), sourceCount: 2,
    sourceFingerprint: fingerprintDzmmStoryMessages(conversation.messages.slice(0, 2)), recordedAt: 2_000 });
  for (const worldState of [changedClock, changedLocation, newSnapshot]) {
    const denied = await patch(client, conversation.id, { worldState });
    expect(denied, 400);
    assert.match(denied.data.error, /刷新/);
    const state = structuredClone(before.state);
    state.conversations[0].worldState = worldState;
    expect(await save(client, state, before.version), 400);
    assert.deepEqual(await snapshot(client), before);
  }
  for (const worldState of [legacy, undefined]) {
    expect(await patch(client, conversation.id, { worldClockMode: 'story', ...(worldState ? { worldState } : {}) }), 400);
    const state = structuredClone(before.state);
    state.conversations[0].worldClockMode = 'story';
    if (worldState) state.conversations[0].worldState = worldState;
    else delete state.conversations[0].worldState;
    expect(await save(client, state, before.version), 400);
    assert.deepEqual(await snapshot(client), before);
  }
});

test('timeline-only journals survive message invalidation and legacy reload without reviving discarded narrative facts; null clears', async () => {
  const { client, conversation } = await fixture({ timeline: true });
  const changedMessages = conversation.messages.map((message, index) => index === 0
    ? { ...message, content: '你先去了另一个港口。' } : message);
  const timelineOnly = { version: 1, snapshots: [], modeChanges: modeChanges() };
  const changed = find(expect(await replaceMessages(client, conversation.id, changedMessages)), conversation.id);
  assert.deepEqual(changed.worldState, timelineOnly);
  assert.deepEqual(find(await snapshot(client), conversation.id).worldState, timelineOnly);
  let before = await snapshot(client);
  const state = structuredClone(before.state);
  state.conversations[0].worldState = { version: 1, snapshots: [] };
  assert.deepEqual(find(expect(await save(client, state, before.version)), conversation.id).worldState, timelineOnly);
  assert.deepEqual(find(expect(await patch(client, conversation.id, { worldState: { version: 1, snapshots: [] } })), conversation.id).worldState, timelineOnly);
  const row = await DB.prepare('SELECT world_state_json FROM conversations WHERE user_id=? AND id=?').bind(client.accountId, conversation.id).first();
  assert.deepEqual(JSON.parse(row.world_state_json), timelineOnly);
  const cleared = find(expect(await patch(client, conversation.id, { worldState: null, worldClockMode: 'story' })), conversation.id);
  assert.equal(Object.hasOwn(cleared, 'worldState'), false);
  assert.deepEqual(cleared.messages, changedMessages);
  before = await snapshot(client);
  assert.equal(Object.hasOwn(find(before, conversation.id), 'worldState'), false);
});

test('malformed mode-change timelines reject atomically on PATCH, whole-state PUT and new conversation POST', async () => {
  const { client, conversation } = await fixture({ timeline: true });
  const before = await snapshot(client);
  const badTimelines = [null, {}, [{ recordedAt: 0, clockMode: 'hybrid' }],
    [{ recordedAt: -1, clockMode: 'story' }], [{ recordedAt: 0.5, clockMode: 'story' }],
    [{ recordedAt: 8_640_000_000_000_001, clockMode: 'story' }],
    [{ recordedAt: 0, clockMode: 'story', elapsedMinutes: 1 }],
    [{ recordedAt: 2_000, clockMode: 'story' }, { recordedAt: 2_000, clockMode: 'realtime' }],
    [{ recordedAt: 2_000, clockMode: 'story' }, { recordedAt: 1_000, clockMode: 'realtime' }],
    Array.from({ length: 129 }, (_, index) => ({ recordedAt: index, clockMode: index % 2 ? 'story' : 'realtime' })),
  ];
  for (const invalid of badTimelines) {
    const worldState = { ...structuredClone(conversation.worldState), modeChanges: invalid };
    expect(await patch(client, conversation.id, { worldState }), 400);
    const state = structuredClone(before.state);
    state.conversations[0].worldState = worldState;
    expect(await save(client, state, before.version), 400);
    expect(await client.request('/v1/conversations', { method: 'POST', body: {
      conversation: { ...conversation, id: `invalid-${randomUUID()}`, worldState },
    } }), 400);
    assert.deepEqual(await snapshot(client), before);
  }
});

test('mode-change timelines retain account isolation and concurrent state revision protection', async () => {
  const { client, conversation } = await fixture({ timeline: true });
  const other = new Client();
  expect(await other.request('/v1/auth/guest', { method: 'POST' }));
  const otherBefore = await snapshot(other);
  expect(await other.request(`/v1/conversations/${conversation.id}`), 404);
  expect(await patch(other, conversation.id, { worldState: conversation.worldState }), 404);
  const before = await snapshot(client);
  expect(await save(other, before.state, otherBefore.version, client.accountId), 401);
  const candidates = ['第一份标题', '第二份标题'].map(title => {
    const state = structuredClone(before.state);
    state.conversations[0].title = title;
    return state;
  });
  const results = await Promise.all(candidates.map(state => save(client, state, before.version)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.findIndex(result => result.status === 200);
  const after = await snapshot(client);
  assert.equal(after.version, before.version + 1);
  assert.deepEqual(after.state, candidates[winner]);
  assert.deepEqual(find(after, conversation.id).worldState.modeChanges, modeChanges());
  assert.deepEqual(await snapshot(other), otherBefore);
});
