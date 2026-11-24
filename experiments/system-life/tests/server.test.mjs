import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApplication } from '../server-v1.mjs';

async function fixture(t, overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'system-life-test-'));
  const story = { publicConfig: { configured: true, model: 'test/story' }, generate: async () => { throw Object.assign(new Error('模型测试故障'), { status: 502 }); } };
  const video = { health: async () => ({ connected: false, model: 'H3', error: '404' }), submit: async () => ({ status: 'queued', taskId: 'test-task', model: 'H3' }), status: async () => ({ status: 'completed', taskId: 'test-task', file: { filename: 'clip.mp4', subfolder: 'system-life', type: 'output' } }), media: async () => new Response('video', { headers: { 'content-type': 'video/mp4' } }) };
  const server = await createApplication({ dataDir, story, video, ...overrides });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const request = async (path, body, headers = {}) => {
    const response = await fetch(base + path, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const created = await request('/api/sessions', { mode: 'demo' });
  assert.equal(created.status, 201);
  return { base, request, session: created.body.session, dataDir };
}

test('an action is persisted once; stale or repeat requests cannot grant extra rewards', async t => {
  const f = await fixture(t), s = f.session, path = `/api/sessions/${s.id}/turn`;
  const body = { revision: s.revision, requestId: randomUUID(), choiceId: s.nodes.at(-1).choices[0].id };
  const first = await f.request(path, body); assert.equal(first.status, 200);
  const second = await f.request(path, body); assert.equal(second.status, 200); assert.deepEqual(first.body.session.state, second.body.session.state); assert.equal(first.body.session.nodes.length, second.body.session.nodes.length);
  const stale = await f.request(path, { ...body, requestId: randomUUID() }); assert.equal(stale.status, 409);
  const restored = await f.request(`/api/sessions/${s.id}/rewind`, { revision: first.body.session.revision, nodeId: s.nodes[0].id });
  assert.equal(restored.status, 200); assert.deepEqual(restored.body.session.state, s.state); assert.equal(restored.body.session.nodes.length, 1); assert.ok(restored.body.session.revision > first.body.session.revision);
});

test('model errors roll back a turn and a failed opening leaves no save', async t => {
  let shouldFail = false;
  const goodStory = { title: '晨雾', narrative: '你出生就绑定系统。十八年后，系统终于亮起。你站在旧城区的门口，准备接受第一次试炼。', systemMessage: '试炼开启。', shot: 'Morning fog at a city gate.', choices: [{ id: 'c1', label: '观察', detail: '寻找线索。', kind: 'observe' }, { id: 'c2', label: '休息', detail: '整理思绪。', kind: 'rest' }] };
  const f = await fixture(t, { story: { publicConfig: { configured: true, model: 'test' }, generate: async () => { if (shouldFail) throw Object.assign(new Error('模型暂不可用'), { status: 502 }); return goodStory; } } });
  const opening = await f.request('/api/sessions', { mode: 'ai' }); assert.equal(opening.status, 201); shouldFail = true;
  const s = opening.body.session;
  const turn = await f.request(`/api/sessions/${s.id}/turn`, { revision: s.revision, requestId: randomUUID(), input: '仔细观察四周' }); assert.equal(turn.status, 502);
  const saved = await f.request(`/api/sessions/${s.id}`); assert.deepEqual(saved.body.session, s);
  const count = (await readdir(join(f.dataDir, 'sessions'))).length;
  assert.equal((await f.request('/api/sessions', { mode: 'ai' })).status, 502);
  assert.equal((await readdir(join(f.dataDir, 'sessions'))).length, count);
});

test('video completion stays on the originating scene after story advances', async t => {
  const f = await fixture(t), s = f.session, original = s.nodes[0].id;
  const submitted = await f.request(`/api/sessions/${s.id}/video`, { nodeId: original }); assert.equal(submitted.status, 202);
  const next = await f.request(`/api/sessions/${s.id}/turn`, { revision: s.revision, requestId: randomUUID(), input: '观察石碑' }); assert.equal(next.status, 200);
  const polled = await f.request(`/api/sessions/${s.id}/video/${original}`); assert.equal(polled.status, 200);
  assert.equal(polled.body.session.nodes[0].video.status, 'completed'); assert.equal(polled.body.session.nodes.at(-1).video.status, 'none'); assert.equal(polled.body.session.revision, next.body.session.revision);
});

test('local video import supports byte ranges and persists without browser storage', async t => {
  const f = await fixture(t), s = f.session;
  const bytes = Buffer.alloc(64); bytes.writeUInt32BE(64, 0); bytes.write('ftyp', 4);
  const upload = await f.request(`/api/sessions/${s.id}/video/import`, { nodeId: s.nodes[0].id, data: `data:video/mp4;base64,${bytes.toString('base64')}` }); assert.equal(upload.status, 200);
  const media = await fetch(f.base + upload.body.session.nodes[0].video.url, { headers: { Range: 'bytes=4-7' } }); assert.equal(media.status, 206); assert.equal(await media.text(), 'ftyp');
  const bad = await f.request(`/api/sessions/${s.id}/video/import`, { nodeId: s.nodes[0].id, url: 'javascript:alert(1)' }); assert.equal(bad.status, 400);
  const remote = await f.request(`/api/sessions/${s.id}/video/import`, { nodeId: s.nodes[0].id, url: 'https://example.test/my-video.mp4' }); assert.equal(remote.status, 200);
});

test('cross-site writes are rejected and import creates a separate normalized save', async t => {
  const f = await fixture(t), s = f.session;
  const foreign = await f.request('/api/sessions', { mode: 'demo' }, { Origin: 'https://unrelated.test' }); assert.equal(foreign.status, 403);
  const exported = (await f.request(`/api/sessions/${s.id}/export`)).body;
  exported.state.level = 99999; exported.nodes[0].snapshot.level = 99999;
  const imported = await f.request('/api/sessions/import', { session: exported }); assert.equal(imported.status, 201);
  assert.notEqual(imported.body.session.id, s.id); assert.equal(imported.body.session.state.level, s.state.level);
  const original = (await f.request(`/api/sessions/${s.id}`)).body.session; assert.deepEqual(original.state, s.state);
});

test('uncertain GPU submissions are persisted and cannot be blindly submitted again', async t => {
  let attempts = 0;
  const f = await fixture(t, { video: { health: async () => ({ connected: true }), submit: async () => { attempts++; throw Object.assign(new Error('提交结果尚未确认'), { status: 504, submissionUnknown: true }); } } });
  const path = `/api/sessions/${f.session.id}/video`, payload = { nodeId: f.session.nodes[0].id };
  assert.equal((await f.request(path, payload)).status, 504);
  assert.equal((await f.request(path, payload)).status, 409);
  assert.equal(attempts, 1);
  const saved = (await f.request(`/api/sessions/${f.session.id}`)).body.session;
  assert.equal(saved.nodes[0].video.submissionUnknown, true);
});

test('GPU submission intent is durable before the adapter receives a request', async t => {
  let f;
  f = await fixture(t, { video: { health: async () => ({ connected: true }), submit: async () => {
    const { readFile } = await import('node:fs/promises');
    const durable = JSON.parse(await readFile(join(f.dataDir, 'sessions', f.session.id + '.json'), 'utf8'));
    assert.equal(durable.nodes[0].video.submissionUnknown, true);
    return { status: 'queued', taskId: 'durable-test', model: 'H3' };
  } } });
  const result = await f.request(`/api/sessions/${f.session.id}/video`, { nodeId: f.session.nodes[0].id });
  assert.equal(result.status, 202); assert.equal(result.body.session.nodes[0].video.taskId, 'durable-test'); assert.equal(result.body.session.nodes[0].video.submissionUnknown, undefined);
});
