import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController, createPoolController } from './control.mjs';

test('every route is private, account overrides are rejected, and native routes are allowlisted', async () => {
  const token = 'isolated-test-control-token-0000000000';
  const calls = [];
  const lifecycle = {
    health: () => ({ ready: false, runtimeStarted: false, bootId: 'synthetic' }),
    start: async () => { calls.push('start'); return { ready: true }; },
    stop: async () => { calls.push('stop'); return { cleanStop: true }; },
    proxy: async path => { calls.push(path); return { status: 200, body: Buffer.from('{}'), contentType: 'application/json' }; },
  };
  const server = createController({ token, lifecycle });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/health`)).status, 401);
    const headers = { Authorization: `Bearer ${token}` };
    const health = await fetch(`${origin}/health`, { headers });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ready, false);
    assert.equal((await fetch(`${origin}/ready`, { headers })).status, 503);
    for (const path of ['/internal/start', '/internal/stop', '/internal/restore']) {
      assert.equal((await fetch(`${origin}${path}`, { method: 'POST' })).status, 401);
    }
    assert.equal((await fetch(`${origin}/internal/start`, { method: 'POST', headers, body: '{"accountId":"someone-else"}' })).status, 400);
    assert.equal((await fetch(`${origin}/internal/start`, { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal((await fetch(`${origin}/api/sessions`, { headers })).status, 200);
    assert.equal((await fetch(`${origin}/api/admin`, { headers })).status, 404);
    assert.equal((await fetch(`${origin}/api/sessions`, { method: 'POST', headers, body: '{}' })).status, 415);
    assert.deepEqual(calls, ['start', '/api/sessions']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('snapshots stream fixed size and checksum; bad restore transfers never reach the runtime', async () => {
  const token = 'isolated-test-control-token-0000000000';
  const bytes = Buffer.from('synthetic archive only');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const restored = [];
  const lifecycle = {
    health: () => ({ ready: false, runtimeStarted: false, bootId: 'synthetic' }),
    snapshot: async path => { await writeFile(path, bytes); return { size: bytes.length, sha256 }; },
    restore: async path => { restored.push(await readFile(path)); return { restored: true }; },
  };
  const server = createController({ token, lifecycle });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const snapshot = await fetch(`${origin}/internal/snapshot`, { headers });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.headers.get('Content-Length'), String(bytes.length));
    assert.equal(snapshot.headers.get('X-Snapshot-Sha256'), sha256);
    assert.deepEqual(Buffer.from(await snapshot.arrayBuffer()), bytes);
    const bad = await fetch(`${origin}/internal/restore`, { method: 'POST', headers: { ...headers, 'X-Snapshot-Sha256': '0'.repeat(64) }, body: bytes });
    assert.equal(bad.status, 400); assert.equal(restored.length, 0);
    const good = await fetch(`${origin}/internal/restore`, { method: 'POST', headers: { ...headers, 'X-Snapshot-Sha256': sha256 }, body: bytes });
    assert.equal(good.status, 200); assert.deepEqual(restored, [bytes]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('pool tenants are isolated by host-chosen keys, capacity and account binding', async () => {
  const token = 'isolated-test-control-token-0000000000';
  const created = [];
  const createLifecycle = ({ env, ports }) => {
    created.push({ env, ports });
    let state = 'stopped';
    return {
      health: () => ({ ready: state === 'running', runtimeStarted: state === 'running', bootId: `boot-${created.length}`, account: env.COMPANION_ACCOUNT_ID }),
      start: async () => { state = 'running'; return { ready: true }; },
      stop: async () => { state = 'stopped'; return { cleanStop: true }; },
      discard: async () => { state = 'discarded'; },
      proxy: async path => ({ status: 200, body: Buffer.from(JSON.stringify({ path, account: env.COMPANION_ACCOUNT_ID })), contentType: 'application/json' }),
    };
  };
  const root = await mkdtemp(join(tmpdir(), 'companion-pool-test-'));
  const server = createPoolController({ token, capacity: 2, root, createLifecycle, baseEnv: { COMPANION_CONTROL_TOKEN: token, COMPANION_POOL_MODE: '1', COMPANION_CHAT_MODEL: 'shared' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const [a, b, c] = ['a', 'b', 'c'].map(letter => letter.repeat(64));
  const accountA = '21bca2ed-2168-4c01-b153-735ad267a35d', accountB = '31bca2ed-2168-4c01-b153-735ad267a35d';
  const post = (path, value) => fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    assert.equal((await fetch(`${origin}/tenants/${a}/exists`)).status, 401);
    assert.equal((await fetch(`${origin}/tenants/${a}/exists`, { headers })).status, 404);
    assert.equal((await post(`/tenants/${a}/create`, { accountId: 'not-a-uuid' })).status, 400);
    assert.equal((await post(`/tenants/${a}/create`, { accountId: accountA, extra: true })).status, 400);
    assert.equal((await post(`/tenants/${a}/create`, { accountId: accountA, persona: 'cast-nope' })).status, 400);
    assert.equal((await post(`/tenants/${a}/create`, { accountId: accountA })).status, 201);
    assert.equal((await post(`/tenants/${a}/create`, { accountId: accountA })).status, 200);
    assert.equal((await post(`/tenants/${a}/create`, { accountId: accountB })).status, 409);
    assert.equal((await post(`/tenants/${b}/create`, { accountId: accountB, chatModel: 'x-ai/grok-4.7', persona: 'intimate' })).status, 201);
    const fullPool = await post(`/tenants/${c}/create`, { accountId: accountB });
    assert.equal(fullPool.status, 503); assert.equal((await fullPool.json()).code, 'POOL_FULL');
    assert.notDeepEqual(created[0].ports, created[1].ports);
    assert.notEqual(created[0].env.COMPANION_INSTANCE_DIR, created[1].env.COMPANION_INSTANCE_DIR);
    assert.equal(created[0].env.COMPANION_CONTROL_TOKEN, undefined);
    assert.equal(created[0].env.COMPANION_CHAT_MODEL, 'shared');
    assert.equal(created[0].env.COMPANION_PERSONA, undefined);
    assert.equal(created[1].env.COMPANION_CHAT_MODEL, 'x-ai/grok-4.7');
    assert.equal(created[1].env.COMPANION_PERSONA, 'intimate');
    assert.equal((await post(`/tenants/${a}/internal/start`, {})).status, 200);
    const proxied = await (await fetch(`${origin}/tenants/${a}/api/sessions`, { headers })).json();
    assert.deepEqual(proxied, { path: '/api/sessions', account: accountA });
    assert.equal((await fetch(`${origin}/tenants/${a}/api/admin`, { headers })).status, 404);
    assert.equal((await fetch(`${origin}/tenants/${c}/api/sessions`, { headers })).status, 404);
    assert.equal((await post(`/tenants/${a}/destroy`, {})).status, 200);
    assert.equal((await fetch(`${origin}/tenants/${a}/exists`, { headers })).status, 404);
    assert.equal((await post(`/tenants/${c}/create`, { accountId: accountA })).status, 201, 'a destroyed tenant frees its slot');
    assert.deepEqual(created[2].ports, created[0].ports);
    assert.equal((await (await fetch(`${origin}/health`, { headers })).json()).tenants, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
