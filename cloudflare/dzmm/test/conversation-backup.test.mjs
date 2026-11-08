import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use the isolated local Worker test runner.');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Backup tests must never use a remote Worker.');
const origin = 'http://127.0.0.1:3010';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const JSON_CHUNK_BYTES = 256 * 1024;
const { stateDelta } = await tsImport('../src/data.ts', import.meta.url);
const { captureDzmmConversationOpening } = await tsImport('../../../src/lib/dzmm-conversation-context.ts', import.meta.url);
const { createDzmmStoryMemory, matchesDzmmStoryMemory } = await tsImport('../../../src/lib/dzmm-story-memory.ts', import.meta.url);
const { appendDzmmWorldSnapshot, createDzmmWorldState, pruneDzmmWorldJournal } = await tsImport('../../../src/lib/dzmm-world-state.ts', import.meta.url);
const { rebindDzmmWorldJournal } = await tsImport('../../../src/lib/dzmm-world-client.ts', import.meta.url);

class Client {
  cookie = '';
  accountId;
  async request(path, { method = 'GET', body, raw } = {}) {
    const requestBody = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const streamed = requestBody instanceof ReadableStream;
    const response = await fetch(`${baseUrl}${path}`, { method,
      headers: { Origin: origin, ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: requestBody, ...(streamed ? { duplex: 'half' } : {}) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}

function expect(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
const snapshot = async client => expect(await client.request('/v1/state'));
const find = (envelope, id) => envelope.state.conversations.find(conversation => conversation.id === id);
const save = (client, state, version) => client.request('/v1/state', {
  method: 'PUT', body: { state, version, accountId: client.accountId },
});

async function fixture() {
  const client = new Client();
  expect(await client.request('/v1/auth/guest', { method: 'POST' }));
  const character = { id: `local-${randomUUID()}`, name: '成年书店档案员', author: '隔离测试作者',
    description: '整理图书和核对借阅记录。', firstMessage: '欢迎来到书店。', alternateGreetings: ['清晨在灯塔整理地图。'] };
  const created = expect(await client.request('/v1/characters', { method: 'POST', body: { character } }));
  return { client, character: created.state.custom[0] };
}

function history(count, text = index => `核对第 ${index} 本书的借阅记录。`) {
  return Array.from({ length: count }, (_, index) => ({ id: `turn-${index}`, role: index % 2 ? 'user' : 'assistant', content: text(index) }));
}
function conversation(character, count, { text, metadata = false } = {}) {
  const opening = captureDzmmConversationOpening(character, 1);
  const messages = history(count, text);
  messages[0].content = opening.messages[0].content;
  const saved = { id: `backup-${randomUUID()}`, characterId: character.id, title: '完整书店历史',
    updatedAt: 1234, messages, opening, worldClockMode: 'realtime' };
  if (metadata) {
    saved.storyMemory = createDzmmStoryMemory({ summary: '已整理书架。', scene: '灯塔', completed: ['整理书架'],
      pending: ['核对借阅'], relationships: [], items: ['目录'] }, messages.slice(0, 50));
    const state = createDzmmWorldState();
    state.location = '灯塔';
    state.clock.elapsedMinutes = 25;
    saved.worldState = appendDzmmWorldSnapshot(undefined, messages, state, 1700000000000, 'realtime');
  }
  return saved;
}
function assertHistory(actual, expected) {
  assert.deepEqual(actual.messages, expected.messages, 'Every original ID, role, position and content must survive.');
  assert.deepEqual(actual.opening, expected.opening);
  assert.equal(actual.worldClockMode, expected.worldClockMode);
  if (expected.storyMemory) {
    assert.deepEqual(actual.storyMemory, expected.storyMemory);
    assert.equal(matchesDzmmStoryMemory(actual.storyMemory, actual.messages), true);
  }
  if (expected.worldState) {
    assert.deepEqual(actual.worldState, expected.worldState);
    assert.deepEqual(pruneDzmmWorldJournal(actual.worldState, actual.messages), actual.worldState);
  }
}

test('501 short original messages POST atomically and reload with their complete opening, memory and world state', async () => {
  const { client, character } = await fixture();
  const original = conversation(character, 501, { metadata: true });
  const before = await snapshot(client);
  const created = expect(await client.request('/v1/conversations', { method: 'POST', body: { conversation: original, version: before.version } }));
  assert.equal(created.version, before.version + 1);
  assertHistory(find(created, original.id), original);
  assertHistory(find(await snapshot(client), original.id), original);
});

test('whole-state import and branch save more than 500 messages in one version each without changing the source', async () => {
  const { client, character } = await fixture();
  const original = conversation(character, 601, { metadata: true });
  const before = await snapshot(client);
  const imported = expect(await save(client, { ...before.state, conversations: [original] }, before.version));
  assert.equal(imported.version, before.version + 1);
  assertHistory(find(await snapshot(client), original.id), original);
  const messages = original.messages.map(message => ({ ...message, id: `branch-${message.id}` }));
  const branch = { ...original, id: `branch-${randomUUID()}`, title: '独立分支', messages,
    storyMemory: createDzmmStoryMemory(original.storyMemory.state, messages.slice(0, original.storyMemory.sourceCount)),
    worldState: rebindDzmmWorldJournal(original.worldState, original.messages, messages) };
  const next = expect(await save(client, { ...imported.state, conversations: [branch, ...imported.state.conversations] }, imported.version));
  assert.equal(next.version, imported.version + 1);
  const reloaded = await snapshot(client);
  assertHistory(find(reloaded, original.id), original);
  assertHistory(find(reloaded, branch.id), branch);
});

test('UTF-8 history spanning multiple 256 KiB JSON chunks roundtrips exact bytes and ordering', async () => {
  const { client, character } = await fixture();
  const original = conversation(character, 601, { text: index => `第${index}条：“地图\\书架”\n${'海港档案中文🙂'.repeat(40)}\t完毕。`, metadata: true });
  const before = await snapshot(client);
  const state = { ...before.state, conversations: [original] };
  const body = { state, version: before.version, accountId: client.accountId };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < MAX_BODY_BYTES);
  const messageRows = stateDelta(before.state, state).find(delta => delta.table === 'messages').upsert;
  assert.ok(Buffer.byteLength(JSON.stringify(messageRows)) > JSON_CHUNK_BYTES * 2, 'Actual writer message rows must require at least three chunks.');
  const saved = expect(await save(client, state, before.version));
  assert.equal(saved.version, before.version + 1);
  const reloaded = find(await snapshot(client), original.id);
  assertHistory(reloaded, original);
  assert.equal(Buffer.compare(Buffer.from(JSON.stringify(reloaded.messages)), Buffer.from(JSON.stringify(original.messages))), 0);
});

test('oversized UTF-8 bodies reject before any state changes with and without Content-Length', async () => {
  const { client, character } = await fixture();
  const baseline = conversation(character, 2, { metadata: false });
  expect(await client.request('/v1/conversations', { method: 'POST', body: { conversation: baseline } }));
  const before = await snapshot(client);
  const tooLarge = conversation(character, 501, { text: index => `${index}:${'中文🙂'.repeat(430)}` });
  const raw = Buffer.from(JSON.stringify({ state: { ...before.state, conversations: [tooLarge] }, version: before.version, accountId: client.accountId }));
  assert.ok(raw.byteLength > MAX_BODY_BYTES);
  for (const streamed of [false, true]) {
    let offset = 0;
    const body = streamed ? new ReadableStream({ pull(controller) {
      if (offset >= raw.byteLength) { controller.close(); return; }
      controller.enqueue(raw.subarray(offset, offset + 16_384));
      offset += 16_384;
    } }) : raw;
    const rejected = await client.request('/v1/state', { method: 'PUT', raw: body });
    expect(rejected, 413);
    assert.deepEqual(await snapshot(client), before, `Rejected ${streamed ? 'streamed' : 'declared-length'} body must not change even the version.`);
  }
});

test('competing complete backups share one transaction winner and never merge partial chunks', async () => {
  const { client, character } = await fixture();
  const before = await snapshot(client);
  const id = `race-${randomUUID()}`;
  const states = ['甲', '乙'].map(label => ({ ...structuredClone(before.state), conversations: [
    { ...conversation(character, 601, { text: index => `${label}第${index}条 ${'书店档案'.repeat(120)}` }), id, title: `完整分支${label}` },
  ] }));
  assert.ok(states.every(state => Buffer.byteLength(JSON.stringify({ state, version: before.version, accountId: client.accountId })) < MAX_BODY_BYTES));
  assert.ok(states.every(state => Buffer.byteLength(JSON.stringify(stateDelta(before.state, state).find(delta => delta.table === 'messages').upsert)) > JSON_CHUNK_BYTES));
  const results = await Promise.all(states.map(state => save(client, state, before.version)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200).data;
  const conflict = results.find(result => result.status === 409).data;
  assert.equal(winner.version, before.version + 1);
  assert.equal(conflict.version, winner.version);
  const reloaded = await snapshot(client);
  assert.deepEqual(reloaded.state, winner.state);
  assertHistory(find(reloaded, id), states[results.findIndex(result => result.status === 200)].conversations[0]);
});
