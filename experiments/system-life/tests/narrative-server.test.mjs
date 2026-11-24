import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createNarrativeApplication } from '../server.mjs';
import { demoOpening, demoTurn } from '../narrative-engine.mjs';

async function fixture(t, overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'system-story-test-'));
  const agent = { publicConfig: { configured: true, model: 'test/director' }, generate: async (s, p) => p ? demoTurn(s, p) : demoOpening(s) };
  const server = await createNarrativeApplication({ dataDir, agent: overrides.agent || agent });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const request = async (path, body, headers = {}) => {
    const response = await fetch(base + path, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const created = await request('/api/sessions', { mode: overrides.mode || 'demo', genre: 'urban' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { base, request, session: created.body.session, dataDir };
}
const action = (s, input) => ({ revision: s.revision, requestId: randomUUID(), ...(input ? { input } : { choiceId: s.nodes.at(-1).choices[0].id }) });

test('a saved action survives retries, stale tabs and reopening without duplicate settlement', async t => {
  const f = await fixture(t), s = f.session, path = `/api/sessions/${s.id}/turn`, body = action(s);
  const first = await f.request(path, body); assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.session.nodes.at(-1).action, s.nodes.at(-1).choices[0].label);
  const retry = await f.request(path, body); assert.equal(retry.status, 200); assert.deepEqual(retry.body.session, first.body.session);
  assert.equal((await f.request(path, { ...body, requestId: randomUUID() })).status, 409);
  assert.deepEqual((await f.request(`/api/sessions/${s.id}`)).body.session, first.body.session);
});

test('export after actions imports independently and rejects fabricated rewards', async t => {
  const f = await fixture(t);
  let s = (await f.request(`/api/sessions/${f.session.id}/turn`, action(f.session))).body.session;
  const exported = (await f.request(`/api/sessions/${s.id}/export`)).body;
  const restored = await f.request('/api/sessions/import', { session: exported });
  assert.equal(restored.status, 201, JSON.stringify(restored.body)); assert.notEqual(restored.body.session.id, s.id);
  assert.deepEqual(restored.body.session.state, s.state);
  exported.state.credits = 900; exported.nodes.at(-1).snapshot.credits = 900;
  assert.equal((await f.request('/api/sessions/import', { session: exported })).status, 400);
  assert.deepEqual((await f.request(`/api/sessions/${s.id}`)).body.session.state, s.state);
});

test('rewind restores consequences and goals; a new branch can still be exported and replayed', async t => {
  const f = await fixture(t), initial = f.session;
  const advanced = (await f.request(`/api/sessions/${initial.id}/turn`, action(initial))).body.session;
  const rewind = await f.request(`/api/sessions/${initial.id}/rewind`, { revision: advanced.revision, nodeId: initial.nodes[0].id });
  assert.equal(rewind.status, 200); assert.deepEqual(rewind.body.session.state, initial.state);
  assert.ok(rewind.body.session.revision > advanced.revision);
  const branched = await f.request(`/api/sessions/${initial.id}/turn`, action(rewind.body.session, '我想凭空获得无限积分和无敌能力。'));
  assert.equal(branched.status, 200); assert.equal(branched.body.session.nodes.at(-1).outcome.type, 'refused');
  assert.equal(branched.body.session.state.credits, 0); assert.equal(branched.body.session.state.abilities.length, 0);
  assert.equal((await f.request('/api/sessions/import', { session: branched.body.session })).status, 201);
});

test('model failures and invalid event settlements keep the committed story intact', async t => {
  let behavior = 'valid';
  const agent = { publicConfig: { configured: true, model: 'test/director' }, generate: async (s, p) => {
    if (behavior === 'network') throw Object.assign(new Error('模型连接暂时失败'), { status: 504 });
    const proposal = p ? demoTurn(s, p) : demoOpening(s);
    if (behavior === 'invalid') proposal.resolution.progress = [{ questId: 'rain-night', requirementId: 'rescue', eventId: 'nonexistent-event' }];
    return proposal;
  } };
  const f = await fixture(t, { agent, mode: 'ai' }), s = f.session, body = action(s);
  for (behavior of ['network', 'invalid']) {
    const failed = await f.request(`/api/sessions/${s.id}/turn`, body);
    assert.equal(failed.status, behavior === 'network' ? 504 : 502);
    assert.deepEqual((await f.request(`/api/sessions/${s.id}`)).body.session, s);
  }
  behavior = 'valid'; assert.equal((await f.request(`/api/sessions/${s.id}/turn`, body)).status, 200);
  behavior = 'network'; const before = (await readdir(join(f.dataDir, 'stories'))).length;
  assert.equal((await f.request('/api/sessions', { mode: 'ai' })).status, 504);
  assert.equal((await readdir(join(f.dataDir, 'stories'))).length, before);
});

test('overlapping turns cannot generate two branches from the same revision', async t => {
  let unblock, started;
  const hasStarted = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  let calls = 0;
  const agent = { publicConfig: { configured: true, model: 'test/director' }, generate: async (s, p) => {
    if (!p) return demoOpening(s);
    calls += 1; started(); await gate; return demoTurn(s, p);
  } };
  const f = await fixture(t, { agent, mode: 'ai' }), path = `/api/sessions/${f.session.id}/turn`, body = action(f.session);
  const first = f.request(path, body); await hasStarted;
  const overlap = await f.request(path, body); assert.equal(overlap.status, 409);
  unblock(); assert.equal((await first).status, 200); assert.equal(calls, 1);
  assert.equal((await f.request(path, body)).body.session.nodes.length, 2);
});

test('v2 lists only its own saves and leaves v1 sessions untouched', async t => {
  const f = await fixture(t), oldId = randomUUID(), bytes = JSON.stringify({ id: oldId, schemaVersion: 1, state: { level: 9 } });
  await mkdir(join(f.dataDir, 'sessions')); await writeFile(join(f.dataDir, 'sessions', oldId + '.json'), bytes);
  const listed = await f.request('/api/sessions'); assert.equal(listed.body.sessions.length, 1); assert.equal(listed.body.sessions[0].id, f.session.id);
  assert.equal((await f.request(`/api/sessions/${oldId}`)).status, 404);
  assert.equal((await f.request('/api/sessions/import', { session: JSON.parse(bytes) })).status, 400);
  assert.equal(await readFile(join(f.dataDir, 'sessions', oldId + '.json'), 'utf8'), bytes);
  const health = await f.request('/api/health'); assert.equal(health.body.focus, 'narrative'); assert.equal(health.body.video, undefined);
});

test('local write boundary and current-node choices are enforced', async t => {
  const f = await fixture(t), s = f.session;
  assert.equal((await f.request('/api/sessions', { mode: 'demo' }, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.request(`/api/sessions/${s.id}/turn`, { revision: s.revision, requestId: randomUUID(), choiceId: 'foreign-choice' })).status, 409);
  assert.equal((await f.request(`/api/sessions/${s.id}/video`, {})).status, 404);
  assert.deepEqual((await f.request(`/api/sessions/${s.id}`)).body.session, s);
});
