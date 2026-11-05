import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CompanionLifecycle, defaultRuntime } from './lifecycle.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const account = '21bca2ed-2168-4c01-b153-735ad267a35d';
function fakeRuntime() {
  const calls = [];
  const child = name => {
    let finish;
    const result = { name, done: false, exited: new Promise(resolve => { finish = resolve; }) };
    result.finish = code => { result.done = true; result.result = { code }; finish(result.result); };
    return result;
  };
  const native = child('native'), gateway = child('gateway');
  return {
    calls, native, gateway,
    async prepare() { calls.push('prepare'); },
    async startNative() { calls.push('native:start'); return native; },
    async startGateway() { calls.push('gateway:start'); return gateway; },
    async nativeHealth() { return { runtime: 'maibot-native', ready: true }; },
    async stopProcess(process) { if (process) { calls.push(process.name + ':stop'); process.finish(0); } },
    async proxy(path) { calls.push('proxy:' + path); return Response.json({ accepted: true }); },
    async snapshot(path, accountId) { calls.push('snapshot:' + accountId); await writeFile(path, 'synthetic archive'); },
    async restore(path, accountId) { calls.push('restore:' + accountId); },
  };
}

test('only verified native readiness enables the proxy; stop orders native before gateway and permits snapshots', async () => {
  const runtime = fakeRuntime();
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime, pollMs: 1 });
  const temporary = await mkdtemp(join(tmpdir(), 'companion-lifecycle-test-'));
  try {
    assert.equal(service.health().runtimeStarted, false);
    assert.match(service.health().bootId, /^[0-9a-f-]{36}$/);
    await assert.rejects(service.proxy('/api/sessions', {}), { code: 'NATIVE_NOT_READY' });
    assert.equal((await service.start()).ready, true);
    assert.equal(service.health().durabilityReady, false);
    await assert.rejects(service.snapshot(join(temporary, 'running')), { code: 'SNAPSHOT_REQUIRES_CLEAN_STOP' });
    assert.equal((await service.proxy('/api/sessions', { method: 'GET' })).status, 200);
    assert.equal((await service.stop()).cleanStop, true);
    assert.deepEqual(runtime.calls.slice(-2), ['native:stop', 'gateway:stop']);
    const result = await service.snapshot(join(temporary, 'snapshot'));
    assert.equal(result.size, Buffer.byteLength('synthetic archive'));
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await service.restore(join(temporary, 'snapshot'))).state, 'stopped');
    assert.equal(runtime.calls.at(-1), 'restore:' + account);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('concurrent starts do not create two native instances', async () => {
  const runtime = fakeRuntime(); let release;
  runtime.prepare = () => new Promise(done => { release = done; });
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime });
  const first = service.start();
  await assert.rejects(service.start(), { code: 'LIFECYCLE_BUSY' });
  release(); await first; await service.stop();
  assert.equal(runtime.calls.filter(item => item === 'native:start').length, 1);
});

test('unplanned child death prevents a snapshot even after cleanup', async () => {
  const runtime = fakeRuntime();
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime });
  await service.start(); runtime.native.finish(1); await Promise.resolve();
  assert.equal(service.health().state, 'failed');
  await assert.rejects(service.stop(), { code: 'INSTANCE_STOPPED_AFTER_FAILURE' });
  await assert.rejects(service.snapshot('/unused'), { code: 'SNAPSHOT_REQUIRES_CLEAN_STOP' });
});

test('startup cannot claim success from another runtime, and a failed stop blocks backup', async () => {
  const runtime = fakeRuntime();
  runtime.nativeHealth = async () => ({ runtime: 'legacy', ready: true });
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime, startupTimeoutMs: 5, pollMs: 1 });
  await assert.rejects(service.start(), { code: 'NATIVE_START_TIMEOUT' });
  assert.equal(service.health().ready, false);
  await assert.rejects(service.snapshot('/unused'), { code: 'SNAPSHOT_REQUIRES_CLEAN_STOP' });
});

test('stop waits for an accepted transport request to finish before native shutdown', async () => {
  const runtime = fakeRuntime(); let release;
  runtime.proxy = async () => new Promise(done => { release = () => done(Response.json({ accepted: true })); });
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime, pollMs: 1 });
  await service.start();
  const sending = service.proxy('/api/sessions', { method: 'POST' });
  const stopping = service.stop();
  await new Promise(done => setTimeout(done, 5));
  assert.equal(runtime.calls.includes('native:stop'), false);
  release(); await sending; await stopping;
  assert.equal(runtime.calls.includes('native:stop'), true);
});

test('a timed-out request still stops children and never permits a snapshot', async () => {
  const runtime = fakeRuntime(); let release;
  runtime.proxy = async () => new Promise(done => { release = () => done(Response.json({ accepted: true })); });
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime, pollMs: 1, stopTimeoutMs: 5 });
  await service.start();
  const pending = service.proxy('/api/sessions', { method: 'POST' });
  await assert.rejects(service.stop(), { code: 'REQUEST_DRAIN_TIMEOUT' });
  assert.deepEqual(runtime.calls.slice(-2), ['native:stop', 'gateway:stop']);
  await assert.rejects(service.snapshot('/unused'), { code: 'SNAPSHOT_REQUIRES_CLEAN_STOP' });
  release(); await pending;
});

test('the process stopper accepts graceful exit and force-stops an isolated unresponsive process group', async () => {
  const runtime = defaultRuntime({ env: {}, source: '/unused', instance: '/unused', packageDir: '/unused' });
  for (const graceful of [true, false]) {
    const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => ${graceful ? 'process.exit(0)' : '{}'}); console.log('ready'); setInterval(() => {}, 1000);`], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const handle = { child, done: false };
    handle.exited = once(child, 'exit').then(([code, signal]) => { handle.done = true; return handle.result = { code, signal }; });
    try {
      await once(child.stdout, 'data');
      if (graceful) assert.equal((await runtime.stopProcess(handle, Date.now() + 1000)).code, 0);
      else {
        await assert.rejects(runtime.stopProcess(handle, Date.now() + 10), { code: 'NATIVE_STOP_TIMEOUT' });
        assert.equal((await handle.exited).signal, 'SIGKILL');
      }
    } finally { if (!handle.done) child.kill('SIGKILL'); await handle.exited; }
  }
});

test('a missing native executable is handled before the log descriptor closes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'companion-missing-runtime-'));
  try {
    const runtime = defaultRuntime({ env: {}, source: join(temporary, 'absent'), instance: join(temporary, 'empty'), packageDir: '/unused' });
    const child = await runtime.startNative();
    assert.equal((await child.exited).code, 1);
    await assert.rejects(runtime.stopProcess(child, Date.now() + 100), { code: 'NATIVE_STOP_UNCLEAN' });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('start and restore report phase timings for the host boot metrics', async () => {
  const runtime = fakeRuntime(); let clock = 0;
  runtime.prepare = async () => { clock += 40; runtime.calls.push('prepare'); };
  runtime.nativeHealth = async () => { clock += 900; return { runtime: 'maibot-native', ready: true }; };
  runtime.restore = async () => { clock += 250; };
  const service = new CompanionLifecycle({ env: { COMPANION_ACCOUNT_ID: account }, runtime, pollMs: 1, now: () => clock });
  await service.restore('/unused');
  const health = await service.start();
  assert.deepEqual(health.timings, { restoreMs: 250, prepareMs: 40, nativeBootMs: 900, startMs: 940 });
});

test('a pool slot passes its own ports to preparation and the gateway', async () => {
  const calls = [];
  const runtime = defaultRuntime({ env: {}, source: '/unused', instance: '/unused/instance', packageDir: '/unused',
    ports: { webui: 20011, gateway: 20012, wsServer: 20013, apiServer: 20014 },
    fetcher: async url => { calls.push(String(url)); return Response.json({ runtime: 'maibot-native', ready: true }); } });
  await runtime.nativeHealth();
  assert.deepEqual(calls, ['http://127.0.0.1:20012/api/health']);
  await assert.rejects(runtime.prepare(), { code: 'INSTANCE_OPERATION_FAILED' });
});
