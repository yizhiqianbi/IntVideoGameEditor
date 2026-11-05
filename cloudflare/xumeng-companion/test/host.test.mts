import assert from 'node:assert/strict';
import { test } from 'node:test';
import personas from '../container/personas.json';
import { CompanionHost, PoolFullError, authorizeService, type Bucket, type HostEnv, type Runtime, type RuntimePool, type Storage, type StoredObject } from '../src/host.ts';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const SESSION = '00000000-0000-4000-8000-000000000003';
const REQUEST = '00000000-0000-4000-8000-000000000004';
const BOOT = '00000000-0000-4000-8000-000000000005';
const NEW_BOOT = '00000000-0000-4000-8000-000000000006';
const SHA = 'a'.repeat(64);
const env: HostEnv = { COMPANION_OPENROUTER_API_KEY: 'test-secret-never-return',
  COMPANION_CHAT_MODEL: 'isolated-chat', COMPANION_EMBEDDING_MODEL: 'isolated-embedding',
  COMPANION_EMBEDDING_DIMENSION: '8', COMPANION_AGREEMENTS_ACCEPTED: '1', COMPANION_EULA_MD5: 'test', COMPANION_PRIVACY_MD5: 'test' };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function request(path = '/api/health', body?: unknown, account = ACCOUNT) {
  return new Request(`https://companion.internal${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-xumeng-account-id': account, 'content-type': 'application/json', authorization: 'Bearer malicious', cookie: 'secret=browser' },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
function fixture(overrides: Partial<HostEnv> = {}, options: { poolShards?: number; fullShards?: number[] } = {}) {
  const values = new Map<string, unknown>(); const events: string[] = []; let time = 1000;
  const logs: string[] = []; let startGate: Promise<void> | null = null; let startFailure: Error | null = null;
  const alarms: number[] = [];
  let alarmAt: number | null = null;
  const storage: Storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); if (key === 'runtime') events.push(`save:${(value as any).phase}:${(value as any).dirty}`); },
    async delete(key) { values.delete(key); events.push(`delete:${key}`); },
    async list<T>(options: { prefix?: string; limit?: number } = {}) {
      const prefix = options?.prefix || '';
      return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T]));
    },
    async setAlarm(next) { alarmAt = next; alarms.push(next); },
    async getAlarm() { return alarmAt; },
  };
  let failPut = false, failStop = false, failRestore = false, loseSend = false, failDestroy = false, capacityFull = false, failSession = false;
  const saved = new Map<string, { bytes: Uint8Array; sha256?: string; metadata: Record<string, string>; etag: string }>();
  const bucket: Bucket = {
    async get(key) {
      events.push('r2:get'); const value = saved.get(key);
      return value ? { body: new Response(value.bytes).body!, size: value.bytes.length,
        metadata: value.metadata, etag: value.etag, sha256: value.sha256 } satisfies StoredObject : null;
    },
    async put(key, body, options) {
      events.push(key.includes('/snapshots/') ? 'r2:snapshot-put' : 'r2:audit-put');
      if (failPut) throw new Error('Isolated failure');
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      saved.set(key, { bytes, sha256: options.sha256, metadata: options.metadata, etag: 'fake-etag' });
      return { etag: 'fake-etag' };
    },
  };
  let running = false, native = false, boot = BOOT, sent = 0, nativeReceipt: unknown, nativeFailure = false, healthDelay = 0;
  let nativeMessages: unknown[] = [{ role: 'assistant', text: '原创隔离回复', id: 'm1' }];
  let listedSessions: unknown[] = [];
  const headers: Headers[] = []; const bodies: string[] = []; let runtimeEnv: Record<string, string> = {};
  const runtime = {
    get running() { return running; },
    async isRunning() { return running; },
    async start(input: Record<string, string>) { events.push('container:start'); if (capacityFull) throw new Error('Isolated capacity limit'); running = true; native = false; runtimeEnv = input; },
    async setInactivityTimeout() {},
    async fetch(path: string, init: RequestInit) {
      events.push(path); headers.push(new Headers(init.headers)); if (init.body !== undefined) bodies.push(String(init.body));
      if (path === '/health') { if (healthDelay) await new Promise(resolve => setTimeout(resolve, healthDelay)); return response({ bootId: boot, runtimeStarted: native }); }
      if (path === '/internal/restore') return response({ restored: !failRestore }, failRestore ? 400 : 200);
      if (path === '/internal/start') {
        if (startGate) await startGate;
        if (startFailure) return response({ code: 'NATIVE_START_TIMEOUT' }, 503);
        native = true; return response({ ready: true, timings: { prepareMs: 3, nativeBootMs: 7, startMs: 10 } });
      }
      if (path === '/internal/stop') { if (failStop) return response({}, 503); native = false; return response({ stopped: true }); }
      if (path === '/internal/snapshot') {
        assert.equal(native, false, 'snapshot is forbidden until native has stopped');
        return new Response('fake-gzip', { headers: { 'content-length': '9', 'x-snapshot-sha256': SHA } });
      }
      if (path === '/api/health') return response({ ready: native, runtime: 'maibot-native' });
      if (path.endsWith('/messages')) {
        const payload = JSON.parse(String(init.body)); const persisted: any = values.get(`request:${payload.requestId.toLowerCase()}`);
        assert.equal(persisted.status, 'pending'); assert.equal(payload.text.trim().endsWith(persisted.text), true);
        assert.equal(persisted.sessionId, SESSION); assert.equal(persisted.requestId, payload.requestId.toLowerCase());
        sent++; if (loseSend) throw new Error('Transport lost after possible delivery');
        if (nativeFailure) return response({ error: 'upstream refused' }, 502);
        return response({ accepted: true, requestId: payload.requestId }, 202);
      }
      if (path === '/api/sessions' && init.method === 'POST') return response({ session: { id: SESSION, messages: [] } }, 201);
      if (path === '/api/sessions') return response({ sessions: listedSessions });
      if (path === `/api/sessions/${SESSION}`) {
        if (failSession) return response({}, 503);
        return response({ session: { id: SESSION, messages: nativeMessages, ...(nativeReceipt ? { receipts: [nativeReceipt] } : {}) } });
      }
      return response({ sessions: [] });
    },
    async destroy() { events.push('container:destroy'); if (failDestroy) throw new Error('Not destroyed'); running = false; native = false; },
  } satisfies Runtime & { running: boolean };
  const full = new Set(options.fullShards ?? []);
  const tenants: string[] = [];
  const pool: RuntimePool | undefined = options.poolShards ? { shards: options.poolShards, runtime: (shard, tenant) => ({
    ...runtime,
    async start(input) {
      events.push(`pool:start:${shard}`);
      if (full.has(shard)) throw new PoolFullError();
      tenants.push(tenant);
      await runtime.start(input);
    },
    async destroy() { events.push(`pool:destroy:${shard}`); await runtime.destroy(); },
  }) } : undefined;
  const create = () => new CompanionHost(storage, bucket, runtime, { ...env, ...overrides }, () => time, async () => {}, pool, line => logs.push(line));
  const host = create();
  return { host, values, events, headers, bodies, saved, alarms, runtime, logs, tenants,
    get sent() { return sent; }, get runtimeEnv() { return runtimeEnv; },
    advance() { time += 11 * 60_000; }, nudge(ms: number) { time += ms; }, dropAlarm() { alarmAt = null; },
    loseContainer() { running = false; native = false; },
    loseNative() { native = false; },
    reviveContainer() { running = true; native = true; },
    changeBoot() { boot = NEW_BOOT; native = false; },
    rebootAlreadyRunning() { running = true; boot = NEW_BOOT; native = false; },
    failPut() { failPut = true; }, failStop() { failStop = true; }, failRestore() { failRestore = true; },
    failSession() { failSession = true; },
    loseSend() { loseSend = true; }, failNativeResponse() { nativeFailure = true; }, addNativeReceipt(value: unknown) { nativeReceipt = value; },
    addNativeMessage(value: unknown) { nativeMessages.push(value); }, failDestroy() { failDestroy = true; },
    setListed(sessions: unknown[]) { listedSessions = sessions; },
    full() { capacityFull = true; },
    holdStart() { let release!: () => void; startGate = new Promise(resolve => { release = resolve; }); return () => { startGate = null; release(); }; },
    failStart() { startFailure = new Error('Isolated native start failure'); },
    slowHealth(ms: number) { healthDelay = ms; },
    recreate: create,
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('trusted UUID identity is mandatory before creating any runtime', async () => {
  const missing = fixture();
  assert.equal((await missing.host.fetch(request('/api/health', undefined, 'guest'))).status, 403);
  assert.equal(missing.events.length, 0);
  assert.equal(authorizeService(request('/api/health', undefined, OTHER), env), OTHER);
  const actual = fixture();
  const noIdentity = new Request('https://companion.internal/api/health');
  assert.equal((await actual.host.fetch(noIdentity)).status, 403);
  assert.equal(actual.events.length, 0);
});

test('native readiness and opaque stable client scope; strips all caller secrets', async () => {
  const f = fixture(); const result = await f.host.fetch(request()); const body: any = await result.json();
  assert.equal(body.ready, true); assert.equal(body.clientScope.length, 64); assert.notEqual(body.clientScope, ACCOUNT);
  assert.equal(((await (await f.host.fetch(request())).json()) as any).clientScope, body.clientScope);
  assert.equal(JSON.stringify(body).includes('test-secret'), false);
  assert.equal(f.runtimeEnv.COMPANION_ACCOUNT_ID, ACCOUNT);
  assert.equal(f.runtimeEnv.COMPANION_OPENROUTER_API_KEY, env.COMPANION_OPENROUTER_API_KEY);
  for (const h of f.headers) {
    assert.equal(h.has('cookie'), false); assert.notEqual(h.get('authorization'), 'Bearer malicious');
    assert.equal(h.get('authorization'), `Bearer ${f.runtimeEnv.COMPANION_CONTROL_TOKEN}`);
  }
  assert.ok(f.events.indexOf('save:starting:true') < f.events.indexOf('/internal/start'));
});

test('session reads do not postpone the idle checkpoint', async () => {
  const f = fixture(); await f.host.fetch(request());
  const started = (f.values.get('runtime') as any).lastActivity;
  const alarms = f.alarms.length;
  f.nudge(9 * 60_000);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}`))).status, 200);
  assert.equal((f.values.get('runtime') as any).lastActivity, started);
  assert.equal(f.alarms.length, alarms);
  f.nudge(60_000);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { requestId: REQUEST, text: '还在吗' }))).status, 202);
  const sentAt = (f.values.get('runtime') as any).lastActivity;
  assert.ok(sentAt > started);
  await f.host.alarm();
  assert.equal((f.values.get('runtime') as any).dirty, true);
  f.nudge(10 * 60_000); await f.host.alarm();
  assert.equal((f.values.get('runtime') as any).dirty, false);
  assert.ok(f.events.includes('r2:snapshot-put'));
});

test('a proactive nudge does not postpone the idle checkpoint', async () => {
  const f = fixture();
  await f.host.fetch(request());
  const started = (f.values.get('runtime') as { lastActivity: number }).lastActivity;
  const alarms = f.alarms.length;
  f.nudge(3 * 60_000);
  const nudged = await f.host.fetch(request(`/api/sessions/${SESSION}/proactive`, {
    intent: '用户停住了', reason: 'offline_session_revive', userMessageId: `desk:${started}`,
  }));
  assert.equal(nudged.status, 200);
  assert.equal((f.values.get('runtime') as { lastActivity: number }).lastActivity, started);
  assert.equal(f.alarms.length, alarms);
  f.nudge(10 * 60_000);
  await f.host.alarm();
  assert.equal((f.values.get('runtime') as { dirty: boolean }).dirty, false);
  assert.ok(f.events.includes('r2:snapshot-put'));
});

test('a live read puts back an idle alarm that was dropped', async () => {
  const f = fixture();
  await f.host.fetch(request());
  const started = (f.values.get('runtime') as { lastActivity: number }).lastActivity;
  f.dropAlarm();
  const before = f.alarms.length;
  f.nudge(60_000);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}`))).status, 200);
  assert.equal((f.values.get('runtime') as { lastActivity: number }).lastActivity, started);
  assert.equal(f.alarms.at(-1), started + 10 * 60_000);
  assert.equal(f.alarms.length, before + 1);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}`))).status, 200);
  assert.equal(f.alarms.length, before + 1);
});

test('a checkpointed chat is read from the journal without starting the container', async () => {
  const f = fixture();
  await f.host.fetch(request());
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}`))).status, 200);
  f.addNativeMessage({ role: 'user', text: '停机前的最后一句', id: 'm2' });
  f.advance();
  await f.host.alarm();
  const parkedState = f.values.get('runtime') as { transcriptParked?: boolean; lastActivity: number };
  assert.equal(parkedState.transcriptParked, true);
  assert.equal(f.runtime.running, false);
  f.addNativeMessage({ role: 'assistant', text: '容器已停，不该读到这句', id: 'm3' });
  f.events.length = 0;
  const health = await (await f.host.fetch(request())).json() as { ready?: boolean; parked?: boolean; runtime?: string };
  assert.equal(health.ready, true);
  assert.equal(health.parked, true);
  assert.equal(health.runtime, 'maibot-native');
  const session = await (await f.host.fetch(request(`/api/sessions/${SESSION}`))).json() as { session: { messages: { text: string }[] } };
  const texts = session.session.messages.map(item => item.text);
  assert.equal(texts.includes('停机前的最后一句'), true);
  assert.equal(texts.includes('容器已停，不该读到这句'), false);
  const listed = await (await f.host.fetch(request('/api/sessions'))).json() as { sessions: { id: string }[] };
  assert.equal(listed.sessions[0].id, SESSION);
  assert.equal(f.events.includes('container:start'), false);
  assert.equal(f.events.includes('/internal/restore'), false);
  assert.equal((f.values.get('runtime') as { lastActivity: number }).lastActivity, parkedState.lastActivity);
  const sent = await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { requestId: REQUEST, text: '再发一句' }));
  assert.equal(sent.status, 202);
  assert.equal(f.events.includes('container:start'), true);
  assert.ok(f.events.indexOf('/internal/restore') < f.events.indexOf('/internal/start'));
});

test('a transcript read failure during checkpoint keeps the container', async () => {
  const f = fixture();
  await f.host.fetch(request());
  await f.host.fetch(request(`/api/sessions/${SESSION}`));
  f.failSession();
  f.advance();
  await f.host.alarm();
  assert.equal(f.runtime.running, true);
  assert.equal((f.values.get('runtime') as { dirty: boolean }).dirty, true);
  assert.equal((f.values.get('runtime') as { checkpointError?: boolean }).checkpointError, true);
  assert.equal(f.events.includes('container:destroy'), false);
});

test('a tampered journal is not served in place of the checkpoint', async () => {
  const f = fixture();
  await f.host.fetch(request());
  await f.host.fetch(request(`/api/sessions/${SESSION}`));
  f.advance();
  await f.host.alarm();
  const observation = f.values.get(`session:${SESSION}`) as { key: string };
  const raw = f.saved.get(observation.key)!;
  raw.bytes = new TextEncoder().encode(JSON.stringify({ accountId: ACCOUNT, session: { id: SESSION, messages: [{ text: '被改过' }] } }));
  f.events.length = 0;
  const health = await (await f.host.fetch(request())).json() as { parked?: boolean };
  assert.equal(health.parked, undefined);
  assert.equal(f.events.includes('container:start'), true);
  assert.equal(f.events.includes('/internal/restore'), true);
});

test('a dead container resumes a verified snapshot after a native stop', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseNative();
  assert.equal((await f.host.fetch(request())).status, 503);
  assert.equal((f.values.get('runtime') as any).blocked, 'unexpected-native-stop');
  f.loseContainer(); f.events.length = 0;
  const result = await f.host.fetch(request());
  assert.equal(result.status, 200);
  assert.ok(f.events.includes('/internal/restore'));
  assert.equal((f.values.get('runtime') as any).blocked, undefined);
});

test('a dead container stays in review after a native stop when a receipt is ambiguous', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseNative();
  assert.equal((await f.host.fetch(request())).status, 503);
  f.loseContainer();
  f.values.set(`request:${REQUEST}`, { fingerprint: 'x', status: 'uncertain', requestId: REQUEST, sessionId: SESSION, text: 'x', receivedAt: 1000 });
  f.events.length = 0;
  const result = await f.host.fetch(request());
  assert.equal(result.status, 503);
  const body = await result.json() as any;
  assert.equal(body.code, 'RECOVERY_REVIEW_REQUIRED');
  assert.equal(body.recovery, 'unexpected-native-stop');
  assert.equal(body.containerRunning, false);
  assert.equal(body.deliveryAmbiguous, true);
  assert.equal(body.snapshotVerified, true);
  assert.equal(f.events.includes('container:start'), false);
  assert.equal((f.values.get('runtime') as any).blocked, 'unexpected-native-stop');
});

test('idled runtime stops then exports/uploads/commits before destroy, and restores before next start', async () => {
  const f = fixture(); await f.host.fetch(request()); f.events.length = 0; f.advance(); await f.host.alarm();
  assert.deepEqual(f.events.filter(e => !e.startsWith('save:')), ['/health', '/internal/stop', '/internal/snapshot', 'r2:snapshot-put', 'container:destroy']);
  const state: any = f.values.get('runtime'); assert.equal(state.dirty, false); assert.ok(state.snapshot.key.includes(ACCOUNT));
  assert.ok(f.events.indexOf('r2:snapshot-put') < f.events.indexOf('save:stopped:false'));
  f.events.length = 0;
  assert.equal((await f.host.fetch(request())).status, 200);
  assert.ok(f.events.indexOf('/internal/restore') < f.events.indexOf('/internal/start'));
  assert.ok(f.events.includes('r2:get'));
});

test('backup upload failure never advances pointer or destroys original runtime', async () => {
  const f = fixture(); await f.host.fetch(request()); f.failPut(); f.advance(); await f.host.alarm();
  const state: any = f.values.get('runtime'); assert.equal(state.snapshot, undefined); assert.equal(state.dirty, true);
  assert.equal(state.checkpointError, true); assert.equal(f.runtime.running, true);
  assert.equal(f.events.includes('container:destroy'), false); assert.ok(f.alarms.length > 1);
});

test('native stop failure never exports potentially inconsistent files', async () => {
  const f = fixture(); await f.host.fetch(request()); f.failStop(); f.advance(); await f.host.alarm();
  assert.equal(f.events.includes('/internal/snapshot'), false); assert.equal(f.events.includes('container:destroy'), false);
  assert.equal((f.values.get('runtime') as any).dirty, true);
});

test('failed restore blocks instead of initializing a blank instance', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); f.failRestore(); f.events.length = 0;
  const result = await f.host.fetch(request()); assert.equal(result.status, 503);
  assert.equal(((await result.json()) as any).code, 'RECOVERY_REVIEW_REQUIRED');
  assert.equal(f.events.includes('/internal/start'), false);
  const starts = f.events.filter(e => e === 'container:start').length;
  await f.host.fetch(request()); assert.equal(f.events.filter(e => e === 'container:start').length, starts);
});

test('missing or cross-account snapshot cannot become a new empty instance', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm();
  const state: any = f.values.get('runtime'); f.saved.get(state.snapshot.key)!.metadata.accountId = OTHER;
  f.events.length = 0; assert.equal((await f.host.fetch(request())).status, 503);
  assert.equal(f.events.includes('/internal/start'), false); assert.equal(f.events.includes('/internal/restore'), false);
});

test('container loss restores a verified snapshot when no receipt is ambiguous', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseContainer(); f.events.length = 0;
  const result = await f.host.fetch(request());
  assert.equal(result.status, 200);
  assert.ok(f.events.includes('/internal/restore'));
  assert.ok(f.events.includes('container:start'));
  assert.equal((f.values.get('runtime') as any).blocked, undefined);
});

test('container loss with a verified snapshot stays in review when a receipt is ambiguous', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseContainer();
  f.values.set(`request:${REQUEST}`, { fingerprint: 'x', status: 'uncertain', requestId: REQUEST, sessionId: SESSION, text: 'x', receivedAt: 1000 });
  f.events.length = 0;
  const result = await f.host.fetch(request());
  assert.equal(result.status, 503);
  assert.equal(((await result.json()) as any).code, 'RECOVERY_REVIEW_REQUIRED');
  assert.equal(f.events.includes('container:start'), false);
  assert.equal((f.values.get('runtime') as any).blocked, 'unexpected-container-loss');
});

test('a blocked account resumes only when the existing native runtime is healthy', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseContainer();
  f.values.set(`request:${REQUEST}`, { fingerprint: 'x', status: 'pending', requestId: REQUEST, sessionId: SESSION, text: 'x', receivedAt: 1000 });
  assert.equal((await f.host.fetch(request())).status, 503);
  f.reviveContainer(); f.events.length = 0;
  const result = await f.host.fetch(request());
  assert.equal(result.status, 200);
  assert.deepEqual(f.events.filter(path => path === '/health'), ['/health']);
  assert.equal((f.values.get('runtime') as any).blocked, undefined);
});

test('an empty lost instance resets without touching any conversation state', async () => {
  const f = fixture(); await f.host.fetch(request()); f.loseContainer();
  assert.equal((await f.host.fetch(request())).status, 503);
  f.events.length = 0; const result = await f.host.fetch(request());
  assert.equal(result.status, 200);
  assert.ok(f.events.includes('container:start'));
  assert.equal((f.values.get('runtime') as any).blocked, undefined);
  assert.equal((f.values.get('runtime') as any).dirty, true);
});

test('an empty lost instance with a receipt remains blocked', async () => {
  const f = fixture(); await f.host.fetch(request()); f.loseContainer();
  assert.equal((await f.host.fetch(request())).status, 503);
  await f.values.set(`request:${REQUEST}`, { fingerprint: 'x', status: 'uncertain' });
  assert.equal((await f.host.fetch(request())).status, 503);
  assert.equal((f.values.get('runtime') as any).blocked, 'unexpected-container-loss');
});

test('an empty instance with a stopped native process is recreated safely', async () => {
  const f = fixture(); await f.host.fetch(request()); f.loseNative();
  assert.equal((await f.host.fetch(request())).status, 503);
  f.events.length = 0; const result = await f.host.fetch(request());
  assert.equal(result.status, 200);
  assert.ok(f.events.includes('container:destroy'));
  assert.ok(f.events.includes('container:start'));
  assert.equal((f.values.get('runtime') as any).blocked, undefined);
});

test('the explicitly confirmed reset abandons the blocked native instance but keeps audit receipts', async () => {
  const f = fixture(); await f.host.fetch(request()); f.loseContainer();
  assert.equal((await f.host.fetch(request())).status, 503);
  f.values.set('session:old', { key: 'old-observation', sha256: 'old', observedAt: 1000 });
  f.values.set('style:old', { version: 1, personality: 'p', speakingStyle: 's', relationshipStyle: 'r' });
  f.values.set('send-window', [1000]);
  f.values.set(`request:${REQUEST}`, { fingerprint: 'x', status: 'uncertain' });
  f.reviveContainer();
  f.events.length = 0;
  const result = await f.host.fetch(request('/api/reset', { confirmation: 'discard-current-instance' }));
  assert.equal(result.status, 200);
  const resetBody: any = await result.json();
  assert.equal(resetBody.reset, true);
  assert.ok(f.events.includes('container:destroy'));
  assert.ok(f.events.includes('delete:session:old'));
  assert.ok(f.events.includes('delete:style:old'));
  assert.ok(f.events.includes('delete:send-window'));
  assert.equal(f.values.has(`request:${REQUEST}`), true);
  assert.equal((f.values.get('runtime') as any).blocked, undefined);
  assert.equal((f.values.get('runtime') as any).dirty, false);
  assert.equal((await f.host.fetch(request('/api/health'))).status, 200);
});

test('reset requires an explicit confirmation and cannot clear a healthy instance', async () => {
  const f = fixture();
  assert.equal((await f.host.fetch(request('/api/reset', { confirmation: 'no' }))).status, 400);
  await f.host.fetch(request());
  assert.equal((await f.host.fetch(request('/api/reset', { confirmation: 'discard-current-instance' }))).status, 409);
});

test('control process restart is detected while container.running remains true', async () => {
  const f = fixture(); await f.host.fetch(request()); f.changeBoot(); f.events.length = 0;
  assert.equal((await f.host.fetch(request())).status, 503);
  assert.equal(f.events.includes('/internal/start'), false);
});

test('clean snapshot is restored even if platform has already started a fresh controller', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm();
  f.rebootAlreadyRunning(); f.events.length = 0;
  assert.equal((await f.host.fetch(request())).status, 200);
  assert.ok(f.events.indexOf('/internal/restore') >= 0);
  assert.ok(f.events.indexOf('/internal/restore') < f.events.indexOf('/internal/start'));
});

test('duplicate send replays exact durable response without a second upstream call', async () => {
  const f = fixture(); const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '原创测试消息', requestId: REQUEST }));
  const first = await send(); const firstBody = await first.text();
  assert.equal(first.status, 202); assert.equal(f.sent, 1);
  const observed = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  const observedBody = await observed.json() as { session?: { receipts?: unknown } };
  assert.deepEqual(observedBody.session?.receipts, [{ requestId: REQUEST, status: 'complete', receivedAt: 1000, confirmed: true }]);
  f.loseContainer();
  const second = await send(); assert.equal(second.status, 202); assert.equal(await second.text(), firstBody);
  assert.equal(second.headers.get('x-companion-replayed'), 'true'); assert.equal(f.sent, 1);
  const changed = await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '不一样的内容', requestId: REQUEST }));
  assert.equal(changed.status, 409); assert.equal(f.sent, 1);
});

test('session receipts are rebuilt from a safe allowlist', async () => {
  const f = fixture();
  f.addNativeReceipt({ requestId: REQUEST, status: 'uncertain', receivedAt: 1000,
    text: 'secret message', fingerprint: 'secret fingerprint', billing: { claimToken: 'secret claim' } });
  const observed = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.deepEqual((await observed.json() as any).session.receipts, [{
    requestId: REQUEST, status: 'uncertain', receivedAt: 1000, confirmed: false,
  }]);
  assert.equal(JSON.stringify(await (await f.host.fetch(request(`/api/sessions/${SESSION}`))).json()).includes('secret'), false);
});

test('legacy native accepted receipt is normalized as confirmed delivery', async () => {
  const f = fixture();
  f.addNativeReceipt({ requestId: REQUEST, status: 'accepted', receivedAt: 1000, text: 'must not leak' });
  const observed = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.deepEqual((await observed.json() as any).session.receipts, [{
    requestId: REQUEST, status: 'complete', receivedAt: 1000, confirmed: true,
  }]);
});

test('non-2xx native response never becomes a completed receipt', async () => {
  const f = fixture(); f.failNativeResponse();
  const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '上游拒绝测试', requestId: REQUEST }));
  assert.equal((await send()).status, 503);
  assert.equal((f.values.get(`request:${REQUEST}`) as any).status, 'uncertain');
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/receipts/${REQUEST}`))).status, 200);
  assert.equal((await (await f.host.fetch(request(`/api/sessions/${SESSION}/receipts/${REQUEST}`))).json() as any).receipt.confirmed, false);
  assert.equal((await send()).status, 409);
  assert.equal(f.sent, 1);
});

test('an accepted message returns before the reply and settles credit when the reply appears', async () => {
  const finalized: string[] = [];
  const f = fixture({ COMPANION_BILLING_ENABLED: 'true', BILLING: {
    companionReserve: async () => ({ created: true, receipt: { id: 'reservation-1' }, claimToken: 'claim-1' }),
    companionFinalize: async (input: { outcome: string }) => { finalized.push(input.outcome); return { ok: true }; },
    companionGet: async () => ({ error: { status: 404 } }),
  } });
  const original = request(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST });
  const headers = new Headers(original.headers); headers.set('x-xumeng-session-token', 'b'.repeat(64));
  const sent = await f.host.fetch(new Request(original, { headers }));
  assert.equal(sent.status, 202);
  assert.equal(finalized.length, 0);
  assert.equal((f.values.get(`request:${REQUEST}`) as any).status, 'complete');
  assert.equal((f.values.get(`request:${REQUEST}`) as any).billing.status, 'reserved');
  const early = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.equal(early.status, 200);
  assert.equal(finalized.length, 0);
  f.addNativeMessage({ role: 'assistant', text: '在呀', id: 'm2' });
  const later = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.equal(later.status, 200);
  assert.deepEqual(finalized, ['completed']);
  assert.equal((f.values.get(`request:${REQUEST}`) as any).billing.status, 'settled');
});

test('insufficient companion balance returns the billing error without a durable delivery receipt', async () => {
  const f = fixture({ COMPANION_BILLING_ENABLED: 'true', BILLING: {
    companionReserve: async () => ({ error: { status: 402, code: 'insufficient_credits', message: '余额不足。' } }),
    companionFinalize: async () => { throw new Error('must not finalize an unreserved turn'); },
    companionGet: async () => ({ error: { status: 404 } }),
  } });
  const original = request(`/api/sessions/${SESSION}/messages`, { text: '余额不足时不应送达', requestId: REQUEST });
  const headers = new Headers(original.headers); headers.set('x-xumeng-session-token', 'a'.repeat(64));
  const result = await f.host.fetch(new Request(original, { headers }));
  assert.equal(result.status, 402);
  assert.deepEqual(await result.json(), { error: '余额不足。', code: 'insufficient_credits', ready: false });
  assert.equal(f.values.has(`request:${REQUEST}`), false);
  assert.equal(f.sent, 0);
});

test('ambiguous delivery is durably blocked and never retried upstream', async () => {
  const f = fixture(); f.loseSend();
  const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '原创测试消息', requestId: REQUEST }));
  assert.equal((await send()).status, 503); assert.equal((f.values.get(`request:${REQUEST}`) as any).status, 'uncertain');
  assert.equal((f.values.get(`request:${REQUEST}`) as any).text, '原创测试消息');
  assert.equal((f.values.get(`request:${REQUEST}`) as any).sessionId, SESSION);
  const observed = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  const observedBody = await observed.json() as { session?: { receipts?: unknown } };
  assert.deepEqual(observedBody.session?.receipts, [{ requestId: REQUEST, status: 'uncertain', receivedAt: 1000, confirmed: false }]);
  assert.equal((await send()).status, 409); assert.equal(f.sent, 1);
  const recreated = f.recreate();
  assert.equal((await recreated.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '原创测试消息', requestId: REQUEST }))).status, 409);
  assert.equal(f.sent, 1);
});

test('session polling automatically confirms an uncertain receipt from native request metadata', async () => {
  const f = fixture(); f.loseSend();
  const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '自动恢复测试', requestId: REQUEST }));
  assert.equal((await send()).status, 503);
  f.addNativeMessage({ role: 'user', id: 'native-user-1', requestId: REQUEST, text: '自动恢复测试', createdAt: new Date(1000).toISOString() });
  const observed = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.equal(observed.status, 200);
  assert.deepEqual((await observed.json() as any).session.receipts, [{ requestId: REQUEST, status: 'complete', receivedAt: 1000, confirmed: true }]);
  assert.equal((f.values.get(`request:${REQUEST}`) as any).status, 'complete');
  const lookup = await f.host.fetch(request(`/api/sessions/${SESSION}/receipts/${REQUEST}`));
  assert.deepEqual((await lookup.json() as any).receipt, { requestId: REQUEST, sessionId: SESSION, status: 'complete', confirmed: true });
  // There is still no saved HTTP response, so a duplicate never re-enters
  // the native bridge even after the read-only reconciliation.
  assert.equal((await send()).status, 409);
  assert.equal(f.sent, 1);
});

test('text-only native history confirms only a recent matching user message', async () => {
  const f = fixture(); f.loseSend();
  const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '严格时间窗', requestId: REQUEST }));
  assert.equal((await send()).status, 503);
  f.addNativeMessage({ role: 'user', id: 'native-old', text: '严格时间窗', createdAt: new Date(-10_000).toISOString() });
  const stale = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.deepEqual((await stale.json() as any).session.receipts, [{ requestId: REQUEST, status: 'uncertain', receivedAt: 1000, confirmed: false }]);
  f.addNativeMessage({ role: 'user', id: 'native-recent', text: '严格时间窗', createdAt: new Date(1000).toISOString() });
  const recent = await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.deepEqual((await recent.json() as any).session.receipts, [{ requestId: REQUEST, status: 'complete', receivedAt: 1000, confirmed: true }]);
});

test('receipt lookup returns only the safe durable delivery state without starting native', async () => {
  const f = fixture(); f.loseSend();
  const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '原创送达查询', requestId: REQUEST }));
  assert.equal((await send()).status, 503);
  f.events.length = 0;
  const result = await f.host.fetch(request(`/api/sessions/${SESSION}/receipts/${REQUEST}`));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { receipt: {
    requestId: REQUEST, sessionId: SESSION, status: 'uncertain', confirmed: false,
  } });
  assert.deepEqual(f.events, []);
  assert.equal((await f.host.fetch(request(`/api/sessions/${OTHER}/receipts/${REQUEST}`))).status, 404);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/receipts/${OTHER}`))).status, 404);
});

test('session observation journal saves original evidence once, without rewriting native state', async () => {
  const f = fixture();
  await f.host.fetch(request(`/api/sessions/${SESSION}`)); await f.host.fetch(request(`/api/sessions/${SESSION}`));
  assert.equal(f.events.filter(e => e === 'r2:audit-put').length, 1);
  const observation: any = f.values.get(`session:${SESSION}`); const raw = f.saved.get(observation.key)!;
  const saved = JSON.parse(new TextDecoder().decode(raw.bytes));
  assert.equal(saved.accountId, ACCOUNT); assert.equal(saved.session.messages[0].text, '原创隔离回复');
  assert.equal(f.events.includes('/internal/restore'), false);
});

test('disallowed route and malformed message do not start the runtime', async () => {
  const f = fixture();
  assert.equal((await f.host.fetch(request('/internal/snapshot'))).status, 404);
  assert.equal((await f.host.fetch(request('/api/sessions?all=true'))).status, 404);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: 'hello', requestId: 'bad' }))).status, 400);
  assert.equal(f.events.includes('container:start'), false);
});

test('durable account binding cannot be overwritten by a later account configuration', async () => {
  const f = fixture();
  f.values.set('runtime', { accountId: OTHER, token: 'x'.repeat(40), phase: 'new', dirty: false, lastActivity: 0 });
  assert.equal((await f.host.fetch(request())).status, 403); assert.equal(f.events.length, 0);
});

test('two account hosts have separate tokens, instance identities, scopes and backup prefixes', async () => {
  const first = fixture(), second = fixture();
  const a: any = await (await first.host.fetch(request())).json();
  const b: any = await (await second.host.fetch(request('/api/health', undefined, OTHER))).json();
  assert.notEqual(a.clientScope, b.clientScope);
  assert.notEqual(first.runtimeEnv.COMPANION_CONTROL_TOKEN, second.runtimeEnv.COMPANION_CONTROL_TOKEN);
  assert.equal(first.runtimeEnv.COMPANION_ACCOUNT_ID, ACCOUNT); assert.equal(second.runtimeEnv.COMPANION_ACCOUNT_ID, OTHER);
  first.advance(); second.advance(); await first.host.alarm(); await second.host.alarm();
  assert.ok([...first.saved.keys()].every(key => key.startsWith(`accounts/${ACCOUNT}/`)));
  assert.ok([...second.saved.keys()].every(key => key.startsWith(`accounts/${OTHER}/`)));
  assert.equal((await first.host.fetch(request('/api/health', undefined, OTHER))).status, 403);
});

test('new sends are limited to six per minute per account, durable duplicates do not consume slots', async () => {
  const f = fixture();
  for (let index = 0; index < 6; index++) {
    const id = `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`;
    const req = () => request(`/api/sessions/${SESSION}/messages`, { text: `原创消息${index}`, requestId: id });
    assert.equal((await f.host.fetch(req())).status, 202);
    assert.equal((await f.host.fetch(req())).status, 202);
  }
  assert.equal(f.sent, 6);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '第七条', requestId: REQUEST }))).status, 429);
  assert.equal(f.sent, 6); assert.equal(f.values.has(`request:${REQUEST}`), false);
  f.advance();
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '第七条', requestId: REQUEST }))).status, 202);
  assert.equal(f.sent, 7);
});

test('concurrent identical sends are serialized into one native delivery', async () => {
  const f = fixture();
  const send = () => f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '同一原创消息', requestId: REQUEST }));
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map(result => result.status), [202, 202]); assert.equal(f.sent, 1);
});

test('a character reopens its one memory instead of starting another session', async () => {
  const f = fixture();
  const stray = '00000000-0000-4000-8000-0000000000aa';
  f.setListed([
    { id: stray, createdAt: '2026-11-04T13:24:00.000Z', messages: [{ id: 'new' }] },
    { id: SESSION, createdAt: '2026-11-04T10:16:00.000Z', messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  ]);
  const opened = await f.host.fetch(request('/api/sessions', { characterId: 'yume' }));
  assert.equal(opened.status, 200);
  assert.equal((await opened.json() as { session: { id: string } }).session.id, SESSION);
  assert.equal(f.bodies.filter(body => body.includes('characterId')).length, 0);
  const listed = await f.host.fetch(request('/api/sessions'));
  const sessions = (await listed.json() as { sessions: { id: string }[] }).sessions;
  assert.deepEqual(sessions.map(item => item.id), [SESSION]);
  f.setListed([]);
  const again = await f.host.fetch(request('/api/sessions', { characterId: 'yume' }));
  assert.equal(again.status, 200);
  assert.equal((await again.json() as { session: { id: string } }).session.id, SESSION);
});

test('stored style stays off the native message so delivery text matches the transcript', async () => {
  const f = fixture();
  const style = { version: 1, personality: '人格', speakingStyle: '口语', relationshipStyle: '恋人' };
  assert.equal((await f.host.fetch(request('/api/sessions', { characterId: 'yume', style }))).status, 201);
  const created = JSON.parse(f.bodies.at(-1)!);
  assert.equal(created.style, undefined);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  const sent = JSON.parse(f.bodies.at(-1)!);
  assert.equal(sent.text, '在吗');
});

test('opening lines are sent once with the first message and stripped from the next', async () => {
  const f = fixture();
  const opening = ['灯还亮着，刚忙完。今天想你了。', '过来点，我在这边等你。'];
  const first = '00000000-0000-4000-8000-0000000000a1';
  const second = '00000000-0000-4000-8000-0000000000a2';
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: first, opening }))).status, 202);
  const sent = JSON.parse(f.bodies.at(-1)!);
  assert.equal(sent.opening, undefined);
  assert.equal(sent.text.includes('[XUMENG_OPENING v1]'), true);
  assert.equal(sent.text.includes('灯还亮着，刚忙完。今天想你了。'), true);
  assert.equal(sent.text.endsWith('在吗'), true);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '第二句', requestId: second, opening }))).status, 202);
  assert.equal(JSON.parse(f.bodies.at(-1)!).text, '第二句');
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '坏开场', requestId: '00000000-0000-4000-8000-0000000000a3', opening: [''] }))).status, 400);
});

test('intimate profile archives separately and uses the same configured chat model', async () => {
  const classic = fixture();
  const intimate = fixture();
  const intimateRequest = new Request('https://companion.internal/api/health', {
    headers: { 'x-xumeng-account-id': ACCOUNT, 'x-xumeng-companion-profile': 'intimate' },
  });
  const classicBody: any = await (await classic.host.fetch(request())).json();
  const intimateBody: any = await (await intimate.host.fetch(intimateRequest)).json();
  assert.equal(classic.runtimeEnv.COMPANION_CHAT_MODEL, 'isolated-chat');
  assert.equal(intimate.runtimeEnv.COMPANION_CHAT_MODEL, 'isolated-chat');
  assert.notEqual(classicBody.clientScope, intimateBody.clientScope);
  assert.equal((await intimate.host.fetch(request())).status, 403);
  intimate.advance(); await intimate.host.alarm();
  const keys = [...intimate.saved.keys()];
  assert.ok(keys.length > 0);
  assert.ok(keys.every(key => key.startsWith(`accounts/${ACCOUNT}/intimate/snapshots/`)));
  const style = { version: 1, personality: '你是Yume', speakingStyle: '口语', relationshipStyle: '恋人' };
  const intimatePost = (path: string, body: unknown) => new Request(`https://companion.internal${path}`, {
    method: 'POST', headers: { 'x-xumeng-account-id': ACCOUNT, 'x-xumeng-companion-profile': 'intimate', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await intimate.host.fetch(intimatePost('/api/sessions', { characterId: 'yume', style }))).status, 201);
  assert.equal(JSON.parse(intimate.bodies.at(-1)!).style, undefined);
  assert.equal((await intimate.host.fetch(intimatePost(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  const sent = JSON.parse(intimate.bodies.at(-1)!);
  assert.equal(sent.text, '在吗');
  assert.equal(intimate.runtimeEnv.COMPANION_PERSONA, 'intimate');
});

test('cast profile keeps its own archive and does not switch to the intimate model', async () => {
  const cast = fixture();
  const castRequest = new Request('https://companion.internal/api/health', {
    headers: { 'x-xumeng-account-id': ACCOUNT, 'x-xumeng-companion-profile': 'cast-qiaowan' },
  });
  const body: any = await (await cast.host.fetch(castRequest)).json();
  assert.equal(cast.runtimeEnv.COMPANION_CHAT_MODEL, 'isolated-chat');
  assert.equal((await cast.host.fetch(request())).status, 403);
  assert.equal((await cast.host.fetch(new Request('https://companion.internal/api/health', {
    headers: { 'x-xumeng-account-id': ACCOUNT, 'x-xumeng-companion-profile': 'cast-nope' },
  }))).status, 403);
  cast.advance(); await cast.host.alarm();
  const keys = [...cast.saved.keys()];
  assert.ok(keys.length > 0);
  assert.ok(keys.every(key => key.startsWith(`accounts/${ACCOUNT}/cast-qiaowan/snapshots/`)));
  const style = { version: 1, personality: '你是乔晚', speakingStyle: '口语', relationshipStyle: '暧昧' };
  const post = (path: string, payload: unknown) => new Request(`https://companion.internal${path}`, {
    method: 'POST', headers: { 'x-xumeng-account-id': ACCOUNT, 'x-xumeng-companion-profile': 'cast-qiaowan', 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal((await cast.host.fetch(post('/api/sessions', { characterId: 'yume', style }))).status, 201);
  assert.equal((await cast.host.fetch(post(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  const sent = JSON.parse(cast.bodies.at(-1)!);
  assert.equal(sent.text, '在吗');
  assert.equal(cast.runtimeEnv.COMPANION_PERSONA, 'cast-qiaowan');
  assert.equal(body.clientScope.length, 64);
});

test('classmate messages stay plain because her persona is the instance config', async () => {
  const f = fixture();
  const style = { version: 1, personality: personas.classic.personality, speakingStyle: '短句', relationshipStyle: '你说停就停' };
  assert.equal((await f.host.fetch(request('/api/sessions', { characterId: 'yume', style }))).status, 201);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  assert.equal(JSON.parse(f.bodies.at(-1)!).text, '在吗');
  assert.equal(f.runtimeEnv.COMPANION_PERSONA, 'classic');
});

test('updating the current chat style stays in storage and does not start the container', async () => {
  const f = fixture();
  const style = { version: 1, personality: '先讲这局', speakingStyle: '短句', relationshipStyle: '你说停就停' };
  const put = (body: unknown) => f.host.fetch(new Request(`https://companion.internal/api/sessions/${SESSION}/style`, {
    method: 'PUT', headers: { 'x-xumeng-account-id': ACCOUNT, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const saved = await put({ style });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { style });
  assert.equal(f.events.includes('container:start'), false);
  assert.equal((await put({ style: { ...style, personality: '' } })).status, 400);
  assert.deepEqual(f.values.get(`style:${SESSION}`), style);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  const sent = JSON.parse(f.bodies.at(-1)!);
  assert.equal(sent.text, '在吗');
  const viewed = await (await f.host.fetch(request(`/api/sessions/${SESSION}`))).json() as { session?: { style?: unknown } };
  assert.deepEqual(viewed.session?.style, style);
});

test('container capacity exhaustion returns 503 without borrowing another account runtime', async () => {
  const f = fixture(); f.full();
  const result = await f.host.fetch(request()); assert.equal(result.status, 503);
  assert.equal(f.runtime.running, false); assert.equal(f.events.includes('/internal/start'), false);
  assert.equal((f.values.get('runtime') as any).dirty, false);
});

test('a slow cold start answers with its phase instead of holding the request queue', async () => {
  const f = fixture(); const release = f.holdStart();
  const first = await f.host.fetch(request());
  assert.equal(first.status, 503);
  assert.equal(first.headers.get('retry-after'), '5');
  const body: any = await first.json();
  assert.equal(body.code, 'CONTAINER_STARTING'); assert.equal(body.phase, 'native');
  // Receipt reads and repeated polls are answered while native boot continues.
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/receipts/${REQUEST}`))).status, 404);
  assert.equal(((await (await f.host.fetch(request())).json()) as any).code, 'CONTAINER_STARTING');
  assert.equal(f.events.filter(event => event === '/internal/start').length, 1);
  release(); await settle();
  const ready: any = await (await f.host.fetch(request())).json();
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.lastBoot.phases.native >= 0, true);
  assert.equal(ready.lastBoot.outcome, 'ready');
});

test('a background start failure is reported once, then the next poll retries', async () => {
  const f = fixture(); const release = f.holdStart(); f.failStart();
  assert.equal((await f.host.fetch(request())).status, 503);
  release(); await settle();
  const failed: any = await (await f.host.fetch(request())).json();
  assert.equal(failed.code, 'NATIVE_START_FAILED');
  assert.equal(JSON.parse(f.logs.at(-1)!).outcome, 'NATIVE_START_FAILED');
});

test('cold boots are measured per phase without message content', async () => {
  const f = fixture(); await f.host.fetch(request());
  const metrics = f.values.get('boot-metrics') as any[];
  assert.equal(metrics.length, 1);
  assert.deepEqual(Object.keys(metrics[0].phases).sort(), ['container', 'controller', 'native']);
  assert.deepEqual(metrics[0].native, { prepareMs: 3, nativeBootMs: 7, startMs: 10 });
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0].includes(ACCOUNT), false);
  await f.host.fetch(request());
  assert.equal((f.values.get('boot-metrics') as any[]).length, 1, 'a warm request is not a boot');
});

test('a running chat whose liveness check is slower than the boot wait still answers ready', async () => {
  const f = fixture({ COMPANION_POOL_ENABLED: 'true' }, { poolShards: 1 });
  assert.equal((await f.host.fetch(request())).status, 200);
  f.slowHealth(1_700);
  const probes = f.events.filter(event => event === '/health').length;
  const warm = await f.host.fetch(request());
  assert.equal(warm.status, 200);
  assert.equal(f.events.filter(event => event === '/health').length, probes + 1);
});

test('pool mode places a clean account in a shared shard and skips full shards', async () => {
  const f = fixture({ COMPANION_POOL_ENABLED: 'true' }, { poolShards: 2, fullShards: [0] });
  const result = await f.host.fetch(request());
  assert.equal(result.status, 200);
  const state: any = f.values.get('runtime');
  assert.equal(state.runtime, 'pool'); assert.match(state.tenant, /^[a-f0-9]{64}$/); assert.equal(state.poolShard, 1);
  assert.equal(f.events.includes('container:start'), true);
  assert.equal(f.tenants.length, 1); assert.equal(f.tenants[0], state.tenant);
  assert.equal(f.runtimeEnv.COMPANION_ACCOUNT_ID, ACCOUNT);
});

test('pool mode reports POOL_FULL when every shard is occupied', async () => {
  const f = fixture({ COMPANION_POOL_ENABLED: 'true' }, { poolShards: 2, fullShards: [0, 1] });
  const result = await f.host.fetch(request());
  const body: any = await result.json();
  assert.equal(body.code, 'POOL_FULL');
  assert.equal(result.headers.get('retry-after'), '30');
  assert.equal((f.values.get('runtime') as any).dirty, false);
});

test('pool tenants checkpoint and restore exactly like a dedicated container', async () => {
  const f = fixture({ COMPANION_POOL_ENABLED: 'true' }, { poolShards: 4 });
  await f.host.fetch(request()); f.advance(); await f.host.alarm();
  const state: any = f.values.get('runtime');
  assert.equal(state.dirty, false); assert.ok(state.snapshot.key.startsWith(`accounts/${ACCOUNT}/snapshots/`));
  assert.ok(f.events.some(event => event.startsWith('pool:destroy:')));
  f.events.length = 0;
  assert.equal((await f.host.fetch(request())).status, 200);
  assert.ok(f.events.indexOf('/internal/restore') < f.events.indexOf('/internal/start'));
  assert.equal((f.values.get('runtime') as any).poolShard, state.poolShard, 'an account stays on its shard');
});

test('a dirty dedicated runtime is never moved into the pool until it is checkpointed', async () => {
  const f = fixture();
  await f.host.fetch(request());
  assert.equal((f.values.get('runtime') as any).runtime, undefined);
  const pooled = fixture({ COMPANION_POOL_ENABLED: 'true' }, { poolShards: 2 });
  pooled.values.set('runtime', { ...(f.values.get('runtime') as object) });
  pooled.reviveContainer();
  await pooled.host.fetch(request());
  assert.equal((pooled.values.get('runtime') as any).runtime, undefined, 'live dirty runtime stays dedicated');
  pooled.advance(); await pooled.host.alarm();
  assert.equal((pooled.values.get('runtime') as any).dirty, false);
  await pooled.host.fetch(request());
  assert.equal((pooled.values.get('runtime') as any).runtime, 'pool');
});
