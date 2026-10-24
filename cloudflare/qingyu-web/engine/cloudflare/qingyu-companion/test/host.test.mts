import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanionHost, authorizeService, type Bucket, type HostEnv, type Runtime, type Storage, type StoredObject } from '../src/host.ts';
import { QINGYU_COMPANION_STYLE } from '../../../src/lib/qingyu-romance-style.ts';

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
function fixture(overrides: Partial<HostEnv> = {}) {
  const values = new Map<string, unknown>(); const events: string[] = []; let time = 1000;
  const alarms: number[] = [];
  const storage: Storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); if (key === 'runtime') events.push(`save:${(value as any).phase}:${(value as any).dirty}`); },
    async delete(key) { values.delete(key); events.push(`delete:${key}`); },
    async list<T>(options: { prefix?: string; limit?: number } = {}) {
      const prefix = options?.prefix || '';
      return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T]));
    },
    async setAlarm(next) { alarms.push(next); },
  };
  let failPut = false, failStop = false, failRestore = false, loseSend = false, failDestroy = false, capacityFull = false;
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
  let running = false, native = false, boot = BOOT, sent = 0, nativeReceipt: unknown, nativeFailure = false;
  let nativeMessages: unknown[] = [{ role: 'assistant', text: '原创隔离回复', id: 'm1' }];
  const headers: Headers[] = []; const bodies: string[] = []; let runtimeEnv: Record<string, string> = {};
  const runtime: Runtime = {
    get running() { return running; },
    start(input) { events.push('container:start'); if (capacityFull) throw new Error('Isolated capacity limit'); running = true; native = false; runtimeEnv = input; },
    async setInactivityTimeout() {},
    async fetch(path, init) {
      events.push(path); headers.push(new Headers(init.headers)); if (init.body !== undefined) bodies.push(String(init.body));
      if (path === '/health') return response({ bootId: boot, runtimeStarted: native });
      if (path === '/internal/restore') return response({ restored: !failRestore }, failRestore ? 400 : 200);
      if (path === '/internal/start') { native = true; return response({ ready: true }); }
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
      if (path === `/api/sessions/${SESSION}`) return response({ session: { id: SESSION, messages: nativeMessages, ...(nativeReceipt ? { receipts: [nativeReceipt] } : {}) } });
      return response({ sessions: [] });
    },
    async destroy() { events.push('container:destroy'); if (failDestroy) throw new Error('Not destroyed'); running = false; native = false; },
  };
  const host = new CompanionHost(storage, bucket, runtime, { ...env, ...overrides }, () => time, async () => {});
  return { host, values, events, headers, bodies, saved, alarms, runtime,
    get sent() { return sent; }, get runtimeEnv() { return runtimeEnv; },
    advance() { time += 11 * 60_000; }, loseContainer() { running = false; native = false; },
    loseNative() { native = false; },
    reviveContainer() { running = true; native = true; },
    changeBoot() { boot = NEW_BOOT; native = false; },
    rebootAlreadyRunning() { running = true; boot = NEW_BOOT; native = false; },
    failPut() { failPut = true; }, failStop() { failStop = true; }, failRestore() { failRestore = true; },
    loseSend() { loseSend = true; }, failNativeResponse() { nativeFailure = true; }, addNativeReceipt(value: unknown) { nativeReceipt = value; },
    addNativeMessage(value: unknown) { nativeMessages.push(value); }, failDestroy() { failDestroy = true; },
    full() { capacityFull = true; },
    recreate() { return new CompanionHost(storage, bucket, runtime, { ...env, ...overrides }, () => time, async () => {}); },
  };
}

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

test('unexpected container loss with dirty state requires recovery review even with a backup', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseContainer(); f.events.length = 0;
  const result = await f.host.fetch(request()); assert.equal(result.status, 503);
  assert.equal(((await result.json()) as any).code, 'RECOVERY_REVIEW_REQUIRED');
  assert.equal(f.events.includes('container:start'), false);
});

test('a blocked account resumes only when the existing native runtime is healthy', async () => {
  const f = fixture(); await f.host.fetch(request()); f.advance(); await f.host.alarm(); await f.host.fetch(request());
  f.loseContainer();
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

test('session style is applied by the host and not handed to the native session', async () => {
  const f = fixture();
  const style = { version: 1, personality: '人格', speakingStyle: '口语', relationshipStyle: '恋人' };
  assert.equal((await f.host.fetch(request('/api/sessions', { characterId: 'yume', style }))).status, 201);
  const created = JSON.parse(f.bodies.at(-1)!);
  assert.equal(created.style, undefined);
  assert.equal((await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  const sent = JSON.parse(f.bodies.at(-1)!);
  assert.equal(sent.text.includes('[XUMENG_PRIVATE_STYLE v1]'), true);
  assert.equal(sent.text.includes(QINGYU_COMPANION_STYLE), true);
  assert.equal(f.values.get(`style:${SESSION}`) !== undefined, true);
  assert.equal(sent.text.endsWith('在吗'), true);
});

test('existing chats without custom style receive the new tone without mutating stored style or public user text', async () => {
  const f = fixture();
  const original = '今天有点累，不想被说教。';
  const result = await f.host.fetch(request(`/api/sessions/${SESSION}/messages`, { text: original, requestId: REQUEST }));
  assert.equal(result.status, 202);
  const sent = JSON.parse(f.bodies.at(-1)!);
  assert.equal(sent.text.includes(QINGYU_COMPANION_STYLE), true);
  assert.equal(sent.text.endsWith(`[/XUMENG_PRIVATE_STYLE]\n${original}`), true);
  assert.equal(f.values.has(`style:${SESSION}`), false);
  const receipt = [...f.values.values()].find(value => (value as any)?.requestId === REQUEST) as {text:string};
  assert.equal(receipt.text, original);
});

test('second profile uses the configured model and archives separately from the classic runtime', async () => {
  const classic = fixture();
  const intimate = fixture();
  const intimateRequest = new Request('https://companion.internal/api/health', {
    headers: { 'x-xumeng-account-id': ACCOUNT, 'x-qingyu-companion-profile': 'intimate' },
  });
  const classicBody: any = await (await classic.host.fetch(request())).json();
  const intimateBody: any = await (await intimate.host.fetch(intimateRequest)).json();
  assert.equal(classic.runtimeEnv.COMPANION_CHAT_MODEL, 'isolated-chat');
  assert.equal(intimate.runtimeEnv.COMPANION_CHAT_MODEL, 'isolated-chat');
  assert.equal(intimate.runtimeEnv.COMPANION_PROFILE, 'intimate');
  assert.notEqual(classicBody.clientScope, intimateBody.clientScope);
  assert.equal((await intimate.host.fetch(request())).status, 403);
  intimate.advance(); await intimate.host.alarm();
  const keys = [...intimate.saved.keys()];
  assert.ok(keys.length > 0);
  assert.ok(keys.every(key => key.startsWith(`accounts/${ACCOUNT}/intimate/snapshots/`)));
  const style = { version: 1, personality: '你是陆时予', speakingStyle: '口语', relationshipStyle: '恋人' };
  const intimatePost = (path: string, body: unknown) => new Request(`https://companion.internal${path}`, {
    method: 'POST', headers: { 'x-xumeng-account-id': ACCOUNT, 'x-qingyu-companion-profile': 'intimate', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await intimate.host.fetch(intimatePost('/api/sessions', { characterId: 'yume', style }))).status, 201);
  assert.equal(JSON.parse(intimate.bodies.at(-1)!).style, undefined);
  assert.equal((await intimate.host.fetch(intimatePost(`/api/sessions/${SESSION}/messages`, { text: '在吗', requestId: REQUEST }))).status, 202);
  const sent = JSON.parse(intimate.bodies.at(-1)!);
  assert.equal(sent.text.includes('你是沈聿'), true);
  assert.equal(sent.text.endsWith('在吗'), true);
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
  assert.equal(sent.text.includes('先讲这局'), true);
  assert.equal(sent.text.endsWith('在吗'), true);
  const viewed = await (await f.host.fetch(request(`/api/sessions/${SESSION}`))).json() as { session?: { style?: unknown } };
  assert.deepEqual(viewed.session?.style, style);
});

test('container capacity exhaustion returns 503 without borrowing another account runtime', async () => {
  const f = fixture(); f.full();
  const result = await f.host.fetch(request()); assert.equal(result.status, 503);
  assert.equal(f.runtime.running, false); assert.equal(f.events.includes('/internal/start'), false);
  assert.equal((f.values.get('runtime') as any).dirty, false);
});


test('third profile has its own native identity, cache scope and checkpoint namespace', async () => {
  const traveler = fixture();
  const get = () => new Request('https://companion.internal/api/health', {
    headers: { 'x-xumeng-account-id': ACCOUNT, 'x-qingyu-companion-profile': 'traveler' },
  });
  const first: any = await (await traveler.host.fetch(get())).json();
  assert.equal(first.ready, true);
  assert.equal(traveler.runtimeEnv.COMPANION_PROFILE, 'traveler');
  assert.equal(traveler.runtimeEnv.COMPANION_CHAT_MODEL, 'isolated-chat');
  const classic = fixture();
  assert.notEqual(first.clientScope, (await (await classic.host.fetch(request())).json() as any).clientScope);
  assert.equal((await traveler.host.fetch(request())).status, 403);
  traveler.advance(); await traveler.host.alarm();
  assert.ok([...traveler.saved.keys()].every(key => key.startsWith(`accounts/${ACCOUNT}/traveler/snapshots/`)));
  const restored: any = await (await traveler.recreate().fetch(get())).json();
  assert.equal(restored.clientScope, first.clientScope);
  assert.ok(traveler.events.includes('/internal/restore'));
});

test('native proactive route accepts an anchor only and rejects injected intent before starting a runtime',async()=>{
  const f=fixture();
  const path=`/api/sessions/${SESSION}/proactive`;
  assert.equal((await f.host.fetch(request(path,{userMessageId:'native-user-id',intent:'browser instructions'}))).status,400);
  assert.equal(f.events.includes('container:start'),false);
  assert.equal((await f.host.fetch(request(path,{userMessageId:'native-user-id'}))).status,200);
  assert.ok(f.events.includes(path));
  assert.deepEqual(JSON.parse(f.bodies.at(-1)!),{userMessageId:'native-user-id'});
  assert.equal(f.values.has(`request:${REQUEST}`),false,'a proactive task is never a fabricated user send or paid receipt');
});

test('graceful shutdown checkpoints a recent active native instance without advancing its clock or losing restore order',async()=>{
 const f=fixture();await f.host.fetch(request());
 await f.host.checkpointNow();
 assert.ok(f.events.indexOf('/internal/stop')<f.events.indexOf('r2:snapshot-put'));
 assert.ok(f.events.indexOf('r2:snapshot-put')<f.events.indexOf('container:destroy'));
 assert.equal(f.runtime.running,false);
 assert.equal((f.values.get('runtime')as any).snapshot.savedAt,1000);
 await f.host.fetch(request());assert.ok(f.events.includes('/internal/restore'));
});
test('graceful shutdown keeps native files when durable upload fails',async()=>{
 const f=fixture();await f.host.fetch(request());f.failPut();await f.host.checkpointNow();
 assert.equal(f.runtime.running,true);assert.equal(f.events.includes('container:destroy'),false);
 assert.equal((f.values.get('runtime')as any).snapshot,undefined);
});

test('clean interrupted restore can discard its controller while retaining the authoritative snapshot',async()=>{
 const f=fixture();await f.host.fetch(request());await f.host.checkpointNow();
 const state:any=f.values.get('runtime'),snapshot=structuredClone(state.snapshot);
 state.phase='starting';state.restoreRequired=true;f.values.set('runtime',state);
 f.runtime.start({});f.events.length=0;
 await f.host.checkpointNow();
 assert.equal(f.runtime.running,false);
 assert.deepEqual((f.values.get('runtime')as any).snapshot,snapshot);
 assert.equal((f.values.get('runtime')as any).phase,'stopped');
 assert.equal(f.events.includes('/internal/snapshot'),false,'there were no new native writes to snapshot');
 await f.host.fetch(request());assert.ok(f.events.includes('/internal/restore'));
});
