import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
import { createStudio } from '../server.mjs';
import { createXumengBridge, xumengBridgeCanonical } from '../xumeng-bridge.mjs';

const secret = 'test-only-xumeng-live-bridge-secret-32-characters';
const avatar = 'https://example.com/original-avatar.png';

async function harness(t, options = {}) {
  const parent = createStudio({ initialKey: 'mock-key-never-used-on-network', request: async () => { throw new Error('Unexpected upstream request'); }, ...options.studio });
  let forks = 0;
  const bridge = createXumengBridge({ secret, fork: () => { forks++; return parent.fork(); }, connectionStatus: parent.connectionStatus, ...options.bridge });
  const server = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/xumeng-api')) void bridge.handle(req, res);
    else parent.server.emit('request', req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await bridge.close();
    parent.server.emit('close');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  function signed(method, path, body, changes = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const userId = changes.userId || 'account-a', role = changes.role || 'super';
    const timestamp = String(changes.timestamp ?? Math.floor((options.bridge?.now?.() ?? Date.now()) / 1000));
    const nonce = changes.nonce || randomUUID();
    const signature = createHmac('sha256', secret).update(xumengBridgeCanonical(method, path, userId, role, timestamp, nonce, Buffer.from(raw))).digest('hex');
    return { method, headers: { 'Content-Type': 'application/json', 'X-Xumeng-Live-User': userId, 'X-Xumeng-Live-Role': role, 'X-Xumeng-Live-Timestamp': timestamp, 'X-Xumeng-Live-Nonce': nonce, 'X-Xumeng-Live-Signature': signature, ...changes.headers }, ...(raw ? { body: raw } : {}) };
  }
  async function call(method, path, body, changes) {
    const response = await fetch(origin + path, signed(method, path, body, changes));
    return { status: response.status, body: await response.json() };
  }
  async function lease(changes) {
    const response = await call('POST', '/xumeng-api/leases', {}, changes);
    assert.equal(response.status, 201);
    return response.body.leaseId;
  }
  return { origin, parent, bridge, call, signed, lease, forks: () => forks };
}

test('bridge denies missing, expired, replayed and body-tampered signatures before allocating a studio', async t => {
  const h = await harness(t);
  const unsigned = await fetch(h.origin + '/xumeng-api/leases', { method: 'POST', body: '{}' });
  assert.equal(unsigned.status, 401);
  assert.equal((await h.call('POST', '/xumeng-api/leases', {}, { timestamp: Math.floor(Date.now() / 1000) - 61 })).status, 401);
  const tampered = h.signed('POST', '/xumeng-api/leases', {});
  tampered.body = '{"changed":true}';
  assert.equal((await fetch(h.origin + '/xumeng-api/leases', tampered)).status, 401);
  assert.equal(h.forks(), 0);
  const nonce = randomUUID();
  assert.equal((await h.call('GET', '/xumeng-api/status', undefined, { nonce })).status, 200);
  assert.equal((await h.call('GET', '/xumeng-api/status', undefined, { nonce })).status, 401);
  assert.equal(h.forks(), 0);
});

test('unconfigured bridge is unavailable and signed public status has no shared session, csrf, events or tasks', async t => {
  const h = await harness(t, { bridge: { secret: '' } });
  assert.equal((await h.call('GET', '/xumeng-api/status')).status, 503);
  assert.equal(h.forks(), 0);
  const ready = await harness(t);
  const status = await ready.call('GET', '/xumeng-api/status', undefined, { role: 'user' });
  assert.deepEqual(status.body, { available: true, configured: true, realAllowed: false, region: 'cn' });
  for (const path of ['/xumeng-api/events', '/xumeng-api/config', '/xumeng-api/start']) assert.equal((await ready.call('POST', path, {})).status, 404);
  assert.equal(ready.forks(), 0);
});

test('fork uses the current configured key and region without sharing mutable sessions or exposing the key', async t => {
  const calls = [];
  class Socket extends EventEmitter {
    constructor() { super(); this.readyState = 1; queueMicrotask(() => this.emit('open')); }
    send() {}
    close() { this.readyState = 3; }
  }
  const h = await harness(t, { studio: { Socket, request: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ live: { id: randomUUID() }, rtc: { token: 'mock-rtc', user_id: 'viewer' } })); } } });
  const original = await (await fetch(h.origin + '/api/status')).json();
  const config = await fetch(h.origin + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': original.csrf }, body: JSON.stringify({ region: 'global', key: 'new-mock-key' }) });
  assert.equal(config.status, 200);
  const lease = await h.lease();
  const start = await h.call('POST', `/xumeng-api/leases/${lease}/start`, { mode: 'real', avatar, persona: '原创值班员', control: 'auto' });
  assert.equal(start.status, 200);
  assert.equal(start.body.session.control, 'performance');
  assert.match(calls[0].url, /^https:\/\/api\.vidu\.com\//);
  assert.equal(calls[0].init.headers.Authorization, 'Token new-mock-key');
  const leaseStatus = await h.call('GET', `/xumeng-api/leases/${lease}/status`);
  assert.equal(leaseStatus.body.csrf, undefined);
  assert.ok(!JSON.stringify(leaseStatus.body).includes('new-mock-key'));
  assert.equal((await (await fetch(h.origin + '/api/status')).json()).session, null);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/heartbeat`, { id: start.body.session.id }, { role: 'user' })).status, 403);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/stop`, { id: start.body.session.id }, { role: 'user' })).status, 200);
});

test('independent leases do not share transcript, live session, tasks or teardown across accounts', async t => {
  const h = await harness(t);
  const a = await h.lease(), b = await h.lease({ userId: 'account-b' });
  const startedA = await h.call('POST', `/xumeng-api/leases/${a}/start`, { mode: 'rehearsal', avatar });
  const startedB = await h.call('POST', `/xumeng-api/leases/${b}/start`, { mode: 'rehearsal', avatar }, { userId: 'account-b' });
  assert.notEqual(startedA.body.session.id, startedB.body.session.id);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${a}/danmaku`, { id: startedA.body.session.id, text: '原创港口故事 A' })).status, 200);
  const bStatus = await h.call('GET', `/xumeng-api/leases/${b}/status`, undefined, { userId: 'account-b' });
  assert.ok(!JSON.stringify(bStatus.body).includes('原创港口故事 A'));
  assert.deepEqual(bStatus.body.tasks, []);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${a}/status`, undefined, { userId: 'account-b' })).status, 404);
  assert.equal((await h.call('DELETE', `/xumeng-api/leases/${a}`, {}, { userId: 'account-b' })).status, 404);
  assert.equal((await h.call('DELETE', `/xumeng-api/leases/${a}`)).status, 200);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${a}/status`)).status, 404);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${b}/status`, undefined, { userId: 'account-b' })).body.session.status, 'ready');
});

test('two browser leases for the same account can rehearse and stop independently', async t => {
  const h = await harness(t), a = await h.lease(), b = await h.lease();
  const first = await h.call('POST', `/xumeng-api/leases/${a}/start`, { mode: 'rehearsal', avatar });
  const second = await h.call('POST', `/xumeng-api/leases/${b}/start`, { mode: 'rehearsal', avatar });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.body.session.id, second.body.session.id);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${a}/stop`, { id: first.body.session.id })).status, 200);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${b}/status`)).body.session.status, 'ready');
  assert.equal((await h.call('GET', `/xumeng-api/leases/${a}/status`)).body.session.status, 'ended');
});

test('cleanup capability closes an old-account lease after switching accounts without authorizing data or controls', async t => {
  const h = await harness(t);
  const created = await h.call('POST', '/xumeng-api/leases', {});
  assert.equal(created.status, 201);
  const { leaseId, cleanupToken } = created.body;
  assert.match(cleanupToken, /^[a-f0-9]{64}$/);
  const siblingId = await h.lease();
  assert.equal((await h.call('POST', '/xumeng-api/leases', {})).status, 429);
  const other = { userId: 'account-b', role: 'user' };
  const second = await h.call('POST', '/xumeng-api/leases', {}, other);
  assert.notEqual(second.body.cleanupToken, cleanupToken);
  const cleanupIdentity = { userId: 'lease_cleanup', role: 'user' };
  for (const newerId of [siblingId, second.body.leaseId]) {
    assert.equal((await h.call('DELETE', `/xumeng-api/leases/${newerId}`, { cleanupToken }, cleanupIdentity)).status, 404);
    assert.equal((await h.call('POST', `/xumeng-api/leases/${newerId}/start`, { cleanupToken, mode: 'rehearsal', avatar }, cleanupIdentity)).status, 404);
  }
  assert.equal((await h.call('GET', `/xumeng-api/leases/${siblingId}/status`)).status, 200);
  const newerStatus = await h.call('GET', `/xumeng-api/leases/${second.body.leaseId}/status`, undefined, other);
  assert.equal(newerStatus.status, 200);
  assert.ok(!JSON.stringify(newerStatus.body).includes(cleanupToken));
  const path = `/xumeng-api/leases/${leaseId}`;
  const started = await h.call('POST', path + '/start', { mode: 'rehearsal', avatar });
  assert.equal(started.status, 200);
  const ownerStatus = await h.call('GET', path + '/status');
  assert.ok(!JSON.stringify(ownerStatus.body).includes(cleanupToken));
  assert.equal((await h.call('DELETE', path, {}, other)).status, 404);
  assert.equal((await h.call('DELETE', path, { cleanupToken: '0'.repeat(64) }, other)).status, 404);
  assert.equal((await h.call('GET', path + '/status', undefined, { ...other, headers: { 'X-Cleanup-Token': cleanupToken } })).status, 404);
  assert.equal((await h.call('POST', path + '/start', { cleanupToken, mode: 'rehearsal', avatar }, other)).status, 404);
  assert.equal((await h.call('POST', path + '/stop', { cleanupToken, id: started.body.session.id }, other)).status, 404);
  assert.equal((await fetch(h.origin + path, { method: 'DELETE', body: JSON.stringify({ cleanupToken }) })).status, 401);
  assert.equal((await h.call('DELETE', path, { cleanupToken }, other)).status, 200);
  assert.equal((await h.call('GET', path + '/status')).status, 404);
  assert.equal((await h.call('POST', '/xumeng-api/leases', {})).status, 201);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${second.body.leaseId}/status`, undefined, other)).status, 200);
});

test('signed logout cleanup identity can only delete a lease with the exact cleanup token', async t => {
  const h = await harness(t);
  const created = await h.call('POST', '/xumeng-api/leases', {});
  const { leaseId, cleanupToken } = created.body;
  const cleanup = { userId: 'lease_cleanup', role: 'user' }, path = `/xumeng-api/leases/${leaseId}`;
  assert.equal((await h.call('GET', '/xumeng-api/status', undefined, cleanup)).status, 404);
  assert.equal((await h.call('POST', '/xumeng-api/leases', {}, cleanup)).status, 404);
  assert.equal((await h.call('GET', path + '/status', undefined, cleanup)).status, 404);
  assert.equal((await h.call('POST', path + '/start', { cleanupToken, mode: 'rehearsal', avatar }, cleanup)).status, 404);
  assert.equal((await h.call('DELETE', path, { cleanupToken: 'wrong' }, cleanup)).status, 404);
  assert.equal((await h.call('DELETE', path, { cleanupToken }, cleanup)).status, 200);
  assert.equal((await h.call('DELETE', path, { cleanupToken }, cleanup)).status, 404);
  assert.equal(h.forks(), 1);
});

test('per-account and global lease capacity includes concurrent initialization', async t => {
  const h = await harness(t, { bridge: { maxLeases: 3 } });
  const results = await Promise.all(Array.from({ length: 4 }, () => h.call('POST', '/xumeng-api/leases', {})));
  assert.equal(results.filter(result => result.status === 201).length, 2);
  assert.equal(results.filter(result => result.status === 429).length, 2);
  await h.lease({ userId: 'account-b' });
  assert.equal((await h.call('POST', '/xumeng-api/leases', {}, { userId: 'account-c' })).status, 429);
  assert.equal(h.forks(), 3);
});

test('ordinary user can rehearse, but cannot start real media or invoke billable material/recording APIs', async t => {
  let upstream = 0;
  const h = await harness(t, { studio: { request: async () => { upstream++; throw new Error('must remain mocked'); } } });
  const role = { role: 'user' }, lease = await h.lease(role);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/start`, { mode: 'real', avatar }, role)).status, 403);
  for (const action of ['generate', 'task', 'recording']) assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/${action}`, { kind: 'image', prompt: '原创灯塔', id: 'task-id' }, role)).status, 403);
  const start = await h.call('POST', `/xumeng-api/leases/${lease}/start`, { mode: 'rehearsal', avatar, control: 'auto' }, role);
  assert.equal(start.status, 200);
  assert.equal(start.body.session.control, 'performance');
  assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/execute`, { id: start.body.session.id, intent: '介绍灯塔', motion: '挥手' }, role)).status, 200);
  assert.equal(upstream, 0);
});

test('late stop, heartbeat and other control cannot affect a later session of the same lease', async t => {
  const h = await harness(t), lease = await h.lease();
  const first = await h.call('POST', `/xumeng-api/leases/${lease}/start`, { mode: 'rehearsal', avatar });
  const oldId = first.body.session.id;
  assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/stop`, { id: oldId })).status, 200);
  const second = await h.call('POST', `/xumeng-api/leases/${lease}/start`, { mode: 'rehearsal', avatar });
  for (const action of ['stop', 'heartbeat', 'execute', 'danmaku', 'interrupt', 'references']) {
    const stale = await h.call('POST', `/xumeng-api/leases/${lease}/${action}`, { id: oldId, intent: '旧指令', text: '旧消息' });
    assert.equal(stale.status, 409);
  }
  const status = await h.call('GET', `/xumeng-api/leases/${lease}/status`);
  assert.equal(status.body.session.id, second.body.session.id);
  assert.equal(status.body.session.status, 'ready');
  assert.equal(status.body.events.filter(event => event.type === 'direction' || event.type === 'danmaku').length, 0);
});

test('super material tasks stay scoped to their lease and upstream errors remain explicit without retry', async t => {
  const calls = [];
  const h = await harness(t, { studio: { request: async (url, init) => {
    calls.push(url);
    if (url.includes('/s_avatar/')) return new Response('<html>bad gateway</html>', { status: 503 });
    return new Response(JSON.stringify(init.method === 'POST' ? { task_id: 'mock-private-task', state: 'created' } : { state: 'success', creations: [{ url: 'https://example.com/original.png' }] }));
  } } });
  const a = await h.lease(), b = await h.lease();
  assert.equal((await h.call('POST', `/xumeng-api/leases/${a}/generate`, { kind: 'image', prompt: '原创灯塔' })).status, 200);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${b}/task`, { id: 'mock-private-task' })).status, 400);
  assert.equal(calls.length, 1);
  assert.equal((await h.call('POST', `/xumeng-api/leases/${a}/task`, { id: 'mock-private-task' })).body.state, 'success');
  assert.equal((await h.call('GET', `/xumeng-api/leases/${b}/status`)).body.tasks.length, 0);
  const failed = await h.call('POST', `/xumeng-api/leases/${b}/start`, { mode: 'real', avatar });
  assert.equal(failed.status, 400);
  assert.match(failed.body.error, /非 JSON.*HTTP 503/);
  assert.equal(calls.length, 3);
  assert.match((await h.call('GET', `/xumeng-api/leases/${b}/status`)).body.lastStartError.message, /HTTP 503/);
});

test('slow material submission does not block live heartbeat or status polling, and deletion waits for its cleanup', async t => {
  let acknowledge, submitted;
  const pending = new Promise(resolve => { submitted = resolve; });
  const h = await harness(t, { studio: { request: async () => {
    submitted();
    return new Promise(resolve => { acknowledge = () => resolve(new Response(JSON.stringify({ task_id: 'slow-mock-task', state: 'created' }))); });
  } } });
  const lease = await h.lease();
  const start = await h.call('POST', `/xumeng-api/leases/${lease}/start`, { mode: 'rehearsal', avatar });
  const generation = h.call('POST', `/xumeng-api/leases/${lease}/generate`, { kind: 'image', prompt: '原创灯塔' });
  await pending;
  assert.equal((await h.call('POST', `/xumeng-api/leases/${lease}/heartbeat`, { id: start.body.session.id })).status, 200);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${lease}/status`)).body.session.status, 'ready');
  const deletion = h.call('DELETE', `/xumeng-api/leases/${lease}`);
  acknowledge();
  assert.equal((await generation).status, 200);
  assert.equal((await deletion).status, 200);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${lease}/status`)).status, 404);
});

test('idle leases expire and release capacity without ending an active separate lease', async t => {
  let current = Date.now();
  const h = await harness(t, { bridge: { now: () => current, idleMs: 60_000 } });
  const a = await h.lease(), b = await h.lease({ userId: 'account-b' });
  const startB = await h.call('POST', `/xumeng-api/leases/${b}/start`, { mode: 'rehearsal', avatar }, { userId: 'account-b' });
  current += 40_000;
  await h.call('POST', `/xumeng-api/leases/${b}/heartbeat`, { id: startB.body.session.id }, { userId: 'account-b' });
  current += 21_000;
  await h.bridge.expire();
  assert.equal((await h.call('GET', `/xumeng-api/leases/${a}/status`)).status, 404);
  assert.equal((await h.call('GET', `/xumeng-api/leases/${b}/status`, undefined, { userId: 'account-b' })).body.session.status, 'ready');
  await h.lease();
});

test('original local API still enforces csrf and origin separately from signed bridge', async t => {
  const h = await harness(t);
  const status = await (await fetch(h.origin + '/api/status')).json();
  assert.equal(typeof status.csrf, 'string');
  assert.equal((await fetch(h.origin + '/api/config', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(h.origin + '/api/config', { method: 'POST', headers: { 'X-Studio-Token': status.csrf, Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
  assert.equal(h.forks(), 0);
});
