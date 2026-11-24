import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApplication } from '../server.mjs';
import { createSession, prepareTurn, parseResponse, commitTurn } from '../engine.mjs';

const response = (extra = {}) => ({ reply: '很高兴认识你，我们慢慢聊。', emotion: 'friendly', ...extra });
const fakeProvider = (generate = async () => response(), generateInitiative = async () => ({ messages: ['我刚想到一个小话题，有空再聊。'], emotion: 'friendly' })) => ({
  publicConfig: { configured: true, model: 'test/model', defaultMode: 'ai' }, generate, generateInitiative,
});

async function start(t, { provider = fakeProvider(), dataDir } = {}) {
  const ownsDirectory = !dataDir;
  dataDir ??= await mkdtemp(join(tmpdir(), 'character-chat-test-'));
  const { server } = await createApplication({ env: {}, dataDir, provider });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => server.close(resolve));
  };
  t.after(async () => { await close(); if (ownsDirectory) await rm(dataDir, { recursive: true, force: true }); });
  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const result = await fetch(baseUrl + path, {
      method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await result.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: result.status, data, headers: result.headers };
  };
  const create = async (characterId = 'yume') => {
    const result = await request('/api/sessions', { method: 'POST', body: { characterId } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.session;
  };
  return { request, create, baseUrl, close, dataDir };
}

async function seedEligible(app, text = '我们聊点轻松的。', ageMs = 20000) {
  const now = new Date(Date.now() - ageMs).toISOString();
  const current = createSession({ characterId: 'yume', mode: 'ai', now });
  const saved = commitTurn(prepareTurn(current, text, { now }), text,
    parseResponse({ messages: ['好，我陪你聊一会儿。'], emotion: 'friendly' }, { currentUserText: text }),
    { requestId: randomUUID(), now });
  await writeFile(join(app.dataDir, 'sessions', `${saved.id}.json`), JSON.stringify(saved), { mode: 0o600 });
  return saved;
}

test('health and public character metadata do not expose persona or provider credentials', async (t) => {
  const { request } = await start(t);
  const { status, data } = await request('/api/health');
  assert.equal(status, 200);
  assert.equal(data.provider.model, 'test/model');
  assert.ok(data.characters.length >= 2);
  assert.ok(data.characters.every((character) => !Object.hasOwn(character, 'persona')));
  assert.ok(data.characters.every((character) => !Object.hasOwn(character, 'card') && !Object.hasOwn(character, 'facets')));
  assert.equal(data.limits.messageChars, 4000);
  assert.equal(Object.hasOwn(data.provider, 'apiKey'), false);
});

test('sessions survive restarting the local application', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'character-chat-persistence-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const first = await start(t, { dataDir });
  const created = await first.create();
  const sent = await first.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '今天读了一本书。', revision: 0, requestId: randomUUID() } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  await first.close();
  const second = await start(t, { dataDir });
  const restored = await second.request(`/api/sessions/${created.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.session.revision, 1);
  assert.equal(restored.data.session.messages.at(-2).text, '今天读了一本书。');
  const listing = await second.request('/api/sessions');
  assert.ok(listing.data.sessions.some((entry) => entry.id === created.id));
});

test('provider failure rolls back language and pending user message', async (t) => {
  const failure = Object.assign(new Error('服务暂时不可用'), { status: 502 });
  const app = await start(t, { provider: fakeProvider(async () => { throw failure; }) });
  const created = await app.create();
  const failed = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: 'Speak English', revision: 0, requestId: randomUUID() } });
  assert.equal(failed.status, 502);
  const loaded = await app.request(`/api/sessions/${created.id}`);
  assert.deepEqual(loaded.data.session, created);
});

test('idempotent retry returns one committed turn before checking stale revision', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(async () => { calls += 1; return response(); }) });
  const created = await app.create();
  const body = { text: '你好，今天怎么样？', revision: 0, requestId: randomUUID() };
  const first = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body });
  const retry = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(retry.data.session, first.data.session);
});

test('stale revisions cannot append turns or overwrite settings', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(async () => { calls += 1; return response(); }) });
  const created = await app.create();
  await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '你好', revision: 0, requestId: randomUUID() } });
  const stale = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '再次问好', revision: 0, requestId: randomUUID() } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'STALE');
  assert.equal(calls, 1);
  const staleSettings = await app.request(`/api/sessions/${created.id}/settings`, { method: 'PATCH', body: { locale: 'en', revision: 0 } });
  assert.equal(staleSettings.status, 409);
});

test('an invalid request UUID is rejected before making a provider call', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(async () => { calls += 1; return response(); }) });
  const created = await app.create();
  const invalid = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: {
    text: '你好', revision: 0, requestId: '640c5cb9-8f5a-0edb-b98e-3a8c4bd579ca',
  } });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
  const loaded = await app.request(`/api/sessions/${created.id}`);
  assert.deepEqual(loaded.data.session, created);
});

test('a session serializes generation while other sessions remain usable', async (t) => {
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const hasEntered = new Promise((resolve) => { entered = resolve; });
  const app = await start(t, { provider: fakeProvider(async (_prepared, text) => {
    if (text === '第一条') { entered(); await gate; }
    return response();
  }) });
  const created = await app.create();
  const another = await app.create('nari');
  const pending = app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '第一条', revision: 0, requestId: randomUUID() } });
  await hasEntered;
  try {
    const blocked = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '第二条', revision: 0, requestId: randomUUID() } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'BUSY');
    const independent = await app.request(`/api/sessions/${another.id}/messages`, { method: 'POST', body: { text: '独立会话', revision: 0, requestId: randomUUID() } });
    assert.equal(independent.status, 200);
  } finally { release(); }
  assert.equal((await pending).status, 200);
});

test('extracted memory can be corrected and deleted through revision-protected APIs', async (t) => {
  const app = await start(t, { provider: fakeProvider(async () => response({ memories: [{ text: '用户住在上海', category: 'profile', quote: '我住在上海' }] })) });
  const created = await app.create();
  const sent = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '我住在上海。', revision: 0, requestId: randomUUID() } });
  assert.equal(sent.status, 200);
  const memory = sent.data.session.memories[0];
  assert.ok(memory);
  const edited = await app.request(`/api/sessions/${created.id}/memories/${memory.id}`, { method: 'PATCH', body: { text: '用户住在杭州', revision: 1 } });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.session.memories[0].source, 'manual');
  assert.equal(edited.data.session.memories[0].text, '用户住在杭州');
  const removed = await app.request(`/api/sessions/${created.id}/memories/${memory.id}`, { method: 'DELETE', body: { revision: 2 } });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.session.memories.length, 0);
});

test('host and cross-origin checks protect local mutation endpoints', async (t) => {
  const app = await start(t);
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(app.baseUrl + '/api/health', { headers: { host: 'attacker.example' } }, (result) => {
      result.resume();
      result.once('end', () => resolve(result.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
  assert.ok(badHostStatus >= 400 && badHostStatus < 500);
  const crossOrigin = await app.request('/api/sessions', { method: 'POST', body: { characterId: 'yume' }, headers: { origin: 'https://attacker.example' } });
  assert.ok(crossOrigin.status >= 400 && crossOrigin.status < 500);
  const listing = await app.request('/api/sessions');
  assert.equal(listing.data.sessions.length, 0);
});

test('bounded JSON input and static routing reject oversized bodies and file traversal', async (t) => {
  const app = await start(t);
  const oversized = await app.request('/api/sessions', { method: 'POST', body: { characterId: 'yume', padding: 'x'.repeat(200000) } });
  assert.ok(oversized.status >= 400 && oversized.status < 500);
  const traversal = await app.request('/%2e%2e/%2e%2e/.env.local');
  assert.ok(traversal.status >= 400 && traversal.status < 500);
  assert.equal(JSON.stringify(traversal.data).includes('OPENROUTER_API_KEY='), false);
});

test('malformed injected provider reply does not become a stored assistant message', async (t) => {
  const app = await start(t, { provider: fakeProvider(async () => ({ reply: '', emotion: 'calm' })) });
  const created = await app.create();
  const sent = await app.request(`/api/sessions/${created.id}/messages`, { method: 'POST', body: { text: '你好', revision: 0, requestId: randomUUID() } });
  assert.equal(sent.status, 502);
  const loaded = await app.request(`/api/sessions/${created.id}`);
  assert.equal(loaded.data.session.revision, 0);
  assert.equal(loaded.data.session.messages.length, created.messages.length);
});

test('HTTP message-array reply retains all parts and idempotency still commits one turn', async (t) => {
  let calls = 0;
  const parts = ['这句话我听到了。', '你可以慢慢说。', '我陪你把这个点子理清楚。'];
  const app = await start(t, { provider: fakeProvider(async () => { calls += 1; return { messages: parts, emotion: 'friendly' }; }) });
  const current = await app.create();
  const body = { text: '我理解你。', revision: 0, requestId: randomUUID() };
  const sent = await app.request(`/api/sessions/${current.id}/messages`, { method: 'POST', body });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const added = sent.data.session.messages.slice(current.messages.length);
  assert.equal(added.length, 4);
  assert.deepEqual(added.slice(1).map(message => message.text), parts);
  assert.equal(new Set(added.map(message => message.turnId)).size, 1);
  assert.equal(sent.data.session.revision, 1);
  const retry = await app.request(`/api/sessions/${current.id}/messages`, { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data.session, sent.data.session);
  assert.equal(calls, 1);
});

test('a repeated foreground reply is regenerated before it can be committed', async (t) => {
  let calls = 0;
  const repeated = '我不知道该怎么接了，我们聊点别的吧。';
  const app = await start(t, { provider: fakeProvider(async () => {
    calls += 1;
    if (calls === 1 || calls === 2) return { messages: [repeated], emotion: 'calm' };
    return { messages: ['我换个方式说：你刚才那句让我有点懵，但我还在认真听。'], emotion: 'friendly' };
  }) });
  const current = await app.create();
  const first = await app.request(`/api/sessions/${current.id}/messages`, { method: 'POST', body: { text: '我有点直接。', revision: 0, requestId: randomUUID() } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await app.request(`/api/sessions/${current.id}/messages`, { method: 'POST', body: { text: '我继续说。', revision: 1, requestId: randomUUID() } });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(calls, 3);
  assert.equal(second.data.session.messages.at(-1).text, '我换个方式说：你刚才那句让我有点懵，但我还在认真听。');
});

test('initiative commits assistant-only bubbles once per plan, schedules the next plan and supports retry', async (t) => {
  let calls = 0;
  const parts = ['我又想到一个小问题。', '你有空的时候再听就好。'];
  const app = await start(t, { provider: fakeProvider(undefined, async () => {
    calls += 1;
    return { messages: parts, emotion: 'playful', trustDelta: 1, closenessDelta: 1, memories: [{ text: '我住在上海', quote: '我住在上海', category: 'profile' }] };
  }) });
  const current = await seedEligible(app, '我理解你。');
  const body = { revision: current.revision, requestId: randomUUID() };
  const sent = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const saved = sent.data.session;
  const added = saved.messages.slice(current.messages.length);
  assert.deepEqual(added.map(message => message.text), parts);
  assert.ok(added.every(message => message.role === 'assistant' && message.kind === 'initiative'));
  assert.equal(saved.messages.filter(message => message.role === 'user').length, current.messages.filter(message => message.role === 'user').length);
  assert.deepEqual(saved.memories, current.memories);
  assert.equal(saved.state.trust, current.state.trust);
  assert.equal(saved.state.closeness, current.state.closeness);
  assert.equal(saved.revision, current.revision + 1);
  assert.equal(saved.initiative.budgetUsed, 1);
  assert.notEqual(saved.initiative.pending.id, current.initiative.pending.id);
  const retry = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.skipped, false);
  assert.deepEqual(retry.data.session, saved);
  assert.equal(calls, 1);
  const next = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: saved.revision, requestId: randomUUID() } });
  assert.equal(next.status, 200);
  assert.equal(next.data.skipped, true);
  assert.equal(calls, 1);
  assert.equal(next.data.session.messages.length, saved.messages.length);
  assert.equal(next.data.session.initiative.budgetUsed, 1, 'checking before the next plan is due must not spend another attempt');
});

test('initiative choosing silence persists a receipt and does not retry the model', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(undefined, async () => { calls += 1; return { messages: [], emotion: 'calm' }; }) });
  const current = await seedEligible(app);
  const body = { revision: current.revision, requestId: randomUUID() };
  const skipped = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.data));
  assert.equal(skipped.data.skipped, true);
  assert.deepEqual(skipped.data.session.messages, current.messages);
  assert.equal(skipped.data.session.revision, current.revision + 1);
  assert.ok(skipped.data.session.receipts.some(receipt => receipt.requestId === body.requestId));
  const retry = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.skipped, true);
  assert.deepEqual(retry.data.session, skipped.data.session);
  assert.equal(calls, 1);
});

test('filtered initiative pressure is reported as skipped silence and stays idempotent', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(undefined, async () => {
    calls += 1;
    return { messages: ['还在吗？'], emotion: 'concerned' };
  }) });
  const current = await seedEligible(app);
  const body = { revision: current.revision, requestId: randomUUID() };
  const skipped = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.data.skipped, true);
  assert.deepEqual(skipped.data.session.messages, current.messages);
  const retry = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.skipped, true);
  assert.deepEqual(retry.data.session, skipped.data.session);
  assert.equal(calls, 1);
});

test('overlapping initiative requests do not launch duplicate model work', { timeout: 5000 }, async (t) => {
  let calls = 0;
  let entered;
  let release;
  const hasEntered = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const app = await start(t, { provider: fakeProvider(undefined, async () => {
    calls += 1;
    entered();
    await gate;
    return { messages: ['刚想到一个小话题。'], emotion: 'friendly' };
  }) });
  const current = await seedEligible(app);
  const body = { revision: current.revision, requestId: randomUUID() };
  const pending = app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  try {
    await hasEntered;
    const overlap = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: current.revision, requestId: randomUUID() } });
    assert.equal(overlap.status, 409);
    assert.equal(overlap.data.code, 'BUSY');
    assert.equal(calls, 1);
  } finally { release(); }
  const saved = await pending;
  assert.equal(saved.status, 200);
  assert.equal(saved.data.session.revision, current.revision + 1);
});

test('initiative readiness and stale revision are checked before provider generation', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(undefined, async () => { calls += 1; return { messages: ['跟进一句。'], emotion: 'calm' }; }) });
  const opening = await app.create();
  const noUser = await app.request(`/api/sessions/${opening.id}/initiative`, { method: 'POST', body: { revision: 0, requestId: randomUUID() } });
  assert.equal(noUser.status, 200);
  assert.equal(noUser.data.skipped, true);
  const current = await seedEligible(app);
  const updated = await app.request(`/api/sessions/${current.id}/settings`, { method: 'PATCH', body: { revision: current.revision, initiative: false } });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  const stale = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: current.revision, requestId: randomUUID() } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'STALE');
  const disabled = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: updated.data.session.revision, requestId: randomUUID() } });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.skipped, true);
  assert.equal(calls, 0);
});

test('combined locale and initiative settings commit one atomic revision', async (t) => {
  const app = await start(t);
  const current = await app.create();
  const updated = await app.request(`/api/sessions/${current.id}/settings`, { method: 'PATCH', body: { revision: 0, locale: 'en', initiative: false } });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.session.revision, 1);
  assert.equal(updated.data.session.locale, 'en');
  assert.equal(updated.data.session.initiative.enabled, false);
  const invalid = await app.request(`/api/sessions/${current.id}/settings`, { method: 'PATCH', body: { revision: 1, locale: 'zh', initiative: 'false' } });
  assert.equal(invalid.status, 400);
  const loaded = await app.request(`/api/sessions/${current.id}`);
  assert.deepEqual(loaded.data.session, updated.data.session);
});

test('failed initiative generation leaves the committed session and anchor unchanged', async (t) => {
  const app = await start(t, { provider: fakeProvider(undefined, async () => { throw Object.assign(new Error('模型暂时不可用'), { status: 502 }); }) });
  const current = await seedEligible(app);
  const failed = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: current.revision, requestId: randomUUID() } });
  assert.equal(failed.status, 502);
  const loaded = await app.request(`/api/sessions/${current.id}`);
  assert.deepEqual(loaded.data.session, current);
});

test('foreground turn proceeds during initiative generation and obsolete initiative is discarded', { timeout: 5000 }, async (t) => {
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const hasEntered = new Promise(resolve => { entered = resolve; });
  let initiativeSignal;
  const app = await start(t, { provider: fakeProvider(undefined, async (_session, { signal } = {}) => {
    initiativeSignal = signal;
    entered();
    await gate; // Deliberately model a provider that ignores cancellation.
    return { messages: ['已经过期的主动消息。'], emotion: 'friendly' };
  }) });
  const current = await seedEligible(app);
  const pending = app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: current.revision, requestId: randomUUID() } });
  let foreground;
  try {
    await hasEntered;
    foreground = await app.request(`/api/sessions/${current.id}/messages`, { method: 'POST', body: { text: '我回来了，现在聊新的话题。', revision: current.revision, requestId: randomUUID() } });
    assert.equal(foreground.status, 200, JSON.stringify(foreground.data));
    assert.ok(initiativeSignal?.aborted, 'user input should cancel the background provider signal');
  } finally { release(); }
  const obsolete = await pending;
  assert.equal(obsolete.status, 409);
  assert.equal(obsolete.data.code, 'STALE');
  const loaded = await app.request(`/api/sessions/${current.id}`);
  assert.deepEqual(loaded.data.session, foreground.data.session);
  assert.equal(loaded.data.session.messages.some(message => message.text === '已经过期的主动消息。'), false);
});

test('disconnecting an initiative request cancels generation and preserves the stored session', { timeout: 5000 }, async (t) => {
  let entered;
  let observedAbort;
  let providerSignal;
  const hasEntered = new Promise(resolve => { entered = resolve; });
  const hasAborted = new Promise(resolve => { observedAbort = resolve; });
  const app = await start(t, { provider: fakeProvider(undefined, async (_session, { signal }) => {
    providerSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort();
        reject(Object.assign(new Error('请求已取消'), { status: 504 }));
      }, { once: true });
      entered();
    });
  }) });
  const current = await seedEligible(app);
  const controller = new AbortController();
  const pending = fetch(`${app.baseUrl}/api/sessions/${current.id}/initiative`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ revision: current.revision, requestId: randomUUID() }),
  }).then(result => result.json()).catch(error => error);
  await hasEntered;
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.name, 'AbortError');
  await hasAborted;
  assert.equal(providerSignal.aborted, true);
  const loaded = await app.request(`/api/sessions/${current.id}`);
  assert.deepEqual(loaded.data.session, current);
});

const parseLines = text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const streamingRequest = async (app, session, body) => {
  const result = await fetch(`${app.baseUrl}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '嘿嘿，我来了。', revision: session.revision, requestId: randomUUID(), stream: true, ...body }),
  });
  return { status: result.status, headers: result.headers, events: parseLines(await result.text()) };
};

test('foreground stream exposes an early complete bubble but stores only the final validated turn', { timeout: 5000 }, async (t) => {
  let entered;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const hasEntered = new Promise(resolve => { entered = resolve; });
  const parts = ['欸，你来了。', '让我先高兴一下。'];
  const app = await start(t, { provider: fakeProvider(async (_session, _text, { onMessage }) => {
    await onMessage({ index: 0, text: parts[0] });
    entered(); await gate;
    await onMessage({ index: 1, text: parts[1] });
    return { messages: parts, emotion: 'playful' };
  }) });
  const current = await app.create();
  const requestId = randomUUID();
  const pending = fetch(`${app.baseUrl}/api/sessions/${current.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '嘿嘿，我来了。', revision: current.revision, requestId, stream: true }),
  });
  try {
    await hasEntered;
    const streamed = await pending;
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get('content-type'), /application\/x-ndjson/);
    const reader = streamed.body.getReader();
    const early = new TextDecoder().decode((await reader.read()).value);
    assert.deepEqual(parseLines(early), [{ type: 'message', index: 0, text: parts[0] }]);
    const beforeCommit = await app.request(`/api/sessions/${current.id}`);
    assert.deepEqual(beforeCommit.data.session, current, 'preview must not persist user input, language or memory');
    release();
    let tail = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; tail += new TextDecoder().decode(chunk.value); }
    const events = parseLines(tail);
    assert.equal(events.at(-1).type, 'done');
    assert.deepEqual(events.at(-1).session.messages.slice(current.messages.length + 1).map(message => message.text), parts);
    const loaded = await app.request(`/api/sessions/${current.id}`);
    assert.deepEqual(loaded.data.session, events.at(-1).session);
    assert.equal(loaded.data.session.revision, current.revision + 1);
    assert.equal(loaded.data.session.receipts.length, 1);
    const retry = await streamingRequest(app, current, { requestId });
    assert.deepEqual(retry.events, [{ type: 'done', session: loaded.data.session }]);
  } finally { release(); }
});

test('invalid final content and provider failure retract streamed previews without a disk commit', async (t) => {
  for (const invalid of [false, true]) {
    const app = await start(t, { provider: fakeProvider(async (_session, _text, { onMessage }) => {
      await onMessage({ index: 0, text: '已经显示但未保存的预览。' });
      if (!invalid) throw Object.assign(new Error('模型暂时不可用。'), { status: 502 });
      return { messages: ['一', '二', '三', '四'], emotion: 'calm' };
    }) });
    const current = await app.create();
    const streamed = await streamingRequest(app, current, { text: 'Speak English. 我住在上海。' });
    assert.equal(streamed.status, 200);
    assert.equal(streamed.events[0].type, 'message');
    assert.equal(streamed.events.at(-1).type, 'error');
    assert.equal(streamed.events.some(event => event.type === 'done'), false);
    const loaded = await app.request(`/api/sessions/${current.id}`);
    assert.deepEqual(loaded.data.session, current);
  }
});

test('disconnecting a foreground stream cancels upstream and cannot commit a late ignored result', { timeout: 5000 }, async (t) => {
  let entered;
  let release;
  let signal;
  const gate = new Promise(resolve => { release = resolve; });
  const hasEntered = new Promise(resolve => { entered = resolve; });
  const app = await start(t, { provider: fakeProvider(async (_session, _text, options) => {
    signal = options.signal;
    await options.onMessage({ index: 0, text: '第一句预览。' });
    entered(); await gate;
    return { messages: ['第一句预览。'], emotion: 'friendly' };
  }) });
  const current = await app.create();
  const controller = new AbortController();
  const pending = fetch(`${app.baseUrl}/api/sessions/${current.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ text: '新消息', revision: 0, requestId: randomUUID(), stream: true }),
  }).then(response => response.text()).catch(error => error);
  try {
    await hasEntered;
    controller.abort();
    const result = await pending;
    assert.equal(result.name, 'AbortError');
    // A GET on this session is independent of the generation lock and observes only committed data.
    const loaded = await app.request(`/api/sessions/${current.id}`);
    assert.deepEqual(loaded.data.session, current);
    assert.equal(signal.aborted, true);
  } finally { release(); }
  const loaded = await app.request(`/api/sessions/${current.id}`);
  assert.deepEqual(loaded.data.session, current);
});

test('presence replaces an expired plan once and rejects its stale intent before generation', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(undefined, async () => { calls += 1; return { messages: ['一个新想法。'], emotion: 'friendly' }; }) });
  const expired = await seedEligible(app, '我们聊点轻松的。', 360000);
  const renewed = await app.request(`/api/sessions/${expired.id}/presence`, { method: 'POST', body: { revision: expired.revision } });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  const current = renewed.data.session;
  assert.equal(current.revision, expired.revision + 1);
  assert.notEqual(current.initiative.pending.id, expired.initiative.pending.id);
  assert.equal(current.initiative.budgetUsed, expired.initiative.budgetUsed);
  assert.deepEqual(current.messages, expired.messages);
  const fresh = await app.request(`/api/sessions/${current.id}/presence`, { method: 'POST', body: { revision: current.revision } });
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.data.session, current);
  const obsolete = await app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: { revision: current.revision, planId: expired.initiative.pending.id, requestId: randomUUID() } });
  assert.equal(obsolete.status, 409);
  assert.equal(obsolete.data.code, 'STALE');
  const stalePresence = await app.request(`/api/sessions/${current.id}/presence`, { method: 'POST', body: { revision: expired.revision } });
  assert.equal(stalePresence.status, 409);
  assert.equal(calls, 0);
});

test('presence never clears explicit rest, disabled state or a spent budget', async (t) => {
  const app = await start(t);
  const quiet = await seedEligible(app, '晚安，我先睡了。', 360000);
  const stayedQuiet = await app.request(`/api/sessions/${quiet.id}/presence`, { method: 'POST', body: { revision: quiet.revision } });
  assert.equal(stayedQuiet.status, 200);
  assert.deepEqual(stayedQuiet.data.session, quiet);
  const off = await app.request(`/api/sessions/${quiet.id}/settings`, { method: 'PATCH', body: { revision: quiet.revision, initiative: false } });
  const stayedOff = await app.request(`/api/sessions/${quiet.id}/presence`, { method: 'POST', body: { revision: off.data.session.revision } });
  assert.deepEqual(stayedOff.data.session, off.data.session);
  const spent = await seedEligible(app);
  spent.initiative = { ...spent.initiative, budgetUsed: 3, pending: null };
  await writeFile(join(app.dataDir, 'sessions', `${spent.id}.json`), JSON.stringify(spent));
  const stayedSpent = await app.request(`/api/sessions/${spent.id}/presence`, { method: 'POST', body: { revision: spent.revision } });
  assert.deepEqual(stayedSpent.data.session, spent);
  const switchedOff = await app.request(`/api/sessions/${spent.id}/settings`, { method: 'PATCH', body: { revision: spent.revision, initiative: false } });
  const switchedOn = await app.request(`/api/sessions/${spent.id}/settings`, { method: 'PATCH', body: { revision: switchedOff.data.session.revision, initiative: true } });
  assert.equal(switchedOn.data.session.initiative.budgetUsed, 3);
  assert.equal(switchedOn.data.session.initiative.pending, null);
});

test('new user plan supersedes an old plan ID even when the caller supplies the latest revision', async (t) => {
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(undefined, async () => { calls += 1; return { messages: ['不应该执行的旧计划。'], emotion: 'friendly' }; }) });
  const old = await seedEligible(app);
  const foreground = await app.request(`/api/sessions/${old.id}/messages`, { method: 'POST', body: { text: '我们现在聊新的话题。', revision: old.revision, requestId: randomUUID() } });
  assert.equal(foreground.status, 200);
  const current = foreground.data.session;
  assert.notEqual(current.initiative.pending.id, old.initiative.pending.id);
  const stale = await app.request(`/api/sessions/${old.id}/initiative`, { method: 'POST', body: { revision: current.revision, planId: old.initiative.pending.id, requestId: randomUUID() } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'STALE');
  assert.equal(calls, 0);
  assert.equal(current.initiative.budgetUsed, 0);
});

test('presence exposes a stable compatible plan for a fresh legacy session without changing revision', async (t) => {
  const app = await start(t);
  const legacy = await seedEligible(app);
  delete legacy.initiative;
  await writeFile(join(app.dataDir, 'sessions', `${legacy.id}.json`), JSON.stringify(legacy));
  const first = await app.request(`/api/sessions/${legacy.id}/presence`, { method: 'POST', body: { revision: legacy.revision } });
  assert.equal(first.status, 200);
  assert.equal(first.data.session.revision, legacy.revision);
  assert.ok(first.data.session.initiative?.pending, 'the browser needs the compatible pending plan to schedule an attempt');
  assert.equal(first.data.session.initiative.budgetUsed, 0);
  const second = await app.request(`/api/sessions/${legacy.id}/presence`, { method: 'POST', body: { revision: legacy.revision } });
  assert.equal(second.data.session.initiative.pending.id, first.data.session.initiative.pending.id);
  assert.equal(second.data.session.revision, legacy.revision);
  assert.deepEqual(first.data.session.messages, legacy.messages);
});

test('interrupt acknowledges cancellation before merged input is accepted', { timeout: 5000 }, async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const app = await start(t, { provider: fakeProvider(async (_session, _text, { signal }) => {
    if (++calls === 1) {
      entered();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      // A supplier ignoring abort is still rejected before commit.
      return response({ messages: ['不应出现的旧回复'] });
    }
    return response({ messages: ['现在明白你整句话的意思啦。'] });
  }) });
  const session = await app.create();
  const requestId = randomUUID();
  const pending = app.request(`/api/sessions/${session.id}/messages`, { method: 'POST',
    body: { text: '我想', revision: 0, requestId } });
  await started;
  const interruption = await app.request(`/api/sessions/${session.id}/interrupt`, { method: 'POST', body: { requestId } });
  assert.equal(interruption.status, 200);
  assert.equal(interruption.data.interrupted, true);
  assert.equal(interruption.data.session.revision, 0);
  assert.equal(interruption.data.session.messages.length, 1);
  assert.equal((await pending).data.code, 'CANCELLED');
  const merged = await app.request(`/api/sessions/${session.id}/messages`, { method: 'POST',
    body: { text: '我想\n听你讲今天的事', revision: interruption.data.session.revision, requestId: randomUUID() } });
  assert.equal(merged.status, 200);
  assert.equal(merged.data.session.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(merged.data.session.messages.at(-1).text, '现在明白你整句话的意思啦。');
});

test('late interrupt returns committed receipt so client cannot duplicate the old input', async t => {
  const app = await start(t);
  const session = await app.create();
  const requestId = randomUUID();
  await app.request(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text: '你好', revision: 0, requestId } });
  const result = await app.request(`/api/sessions/${session.id}/interrupt`, { method: 'POST', body: { requestId } });
  assert.equal(result.status, 200);
  assert.equal(result.data.interrupted, false);
  assert.ok(result.data.session.receipts.some(receipt => receipt.requestId === requestId));
});

test('duplicate stream repair cannot skip or repeat a visible bubble index', async t => {
  let calls = 0;
  const repeated = '我不知道该怎么接了，我们聊点别的吧。';
  const app = await start(t, { provider: fakeProvider(async (_s, _text, options) => {
    calls++;
    const messages = calls === 1 ? [repeated] : calls === 2
      ? [repeated, '这一句虽然新但不能越过前面那句。'] : ['那我们说说今天最有趣的一件事。'];
    for (const [index, text] of messages.entries()) await options.onMessage?.({ index, text });
    return { messages, emotion: 'friendly' };
  }) });
  const session = await app.create();
  await app.request(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text: '你好', revision: 0, requestId: randomUUID() } });
  const result = await app.request(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text: '继续讲', revision: 1, requestId: randomUUID(), stream: true } });
  const events = result.data.raw.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.filter(event => event.type === 'message').map(event => event.index), [0]);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).session.messages.at(-1).text, '那我们说说今天最有趣的一件事。');
});

test('twice-repeated AI output is rejected instead of storing a canned local line', async t => {
  const app = await start(t, { provider: fakeProvider(async () => ({ messages: ['我在这里陪着你。'], emotion: 'calm' })) });
  const session = await app.create();
  await app.request(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text: '你好', revision: 0, requestId: randomUUID() } });
  const second = await app.request(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text: '说点新的', revision: 1, requestId: randomUUID() } });
  assert.equal(second.status, 502);
  const stored = await app.request(`/api/sessions/${session.id}`);
  assert.equal(stored.data.session.revision, 1);
});
