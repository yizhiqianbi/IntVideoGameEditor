// Local real gateway -> signed bridge -> original studio. Provider is mocked.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createStudio } from '../../../../vidu-live/server.mjs';
import { createXumengBridge } from '../../../../vidu-live/xumeng-bridge.mjs';
import { handleLiveGateway } from '../../src/live-gateway.ts';
const secret = 'only-local-live-flow-fixture-secret-20261008';
const counts = { status: 0, leases: 0, start: 0, execute: 0, task: 0, generate: 0, deletes: 0, mockProviderCalls: 0, externalModelCalls: 0 };
let failExecute = false;
const active = new Map();
let holdNextCreate = false, heldCreate = null;
counts.deleteSuccess = 0; counts.createSuccess = 0;
class Socket extends EventEmitter {
  readyState = 1;
  constructor() { super(); queueMicrotask(() => this.emit('open')); }
  send(raw) { const frame = JSON.parse(raw); if (frame.type === 1) queueMicrotask(() => this.emit('message', JSON.stringify({ type: 2, payload: { conn_init_ack: { success: true } } }))); }
  close() { this.readyState = 3; }
}
const studio = createStudio({ initialKey: 'mock-provider-credential-not-real', Socket, request: async (url, init) => {
  counts.mockProviderCalls++;
  if (url.includes('/live/s_avatar/realtime')) return Response.json({ live: { id: 'fixture-real-only' }, rtc: { token: 'mock-rtc', user_id: 'mock-viewer' } });
  if (url.includes('/reference2image') || url.includes('/reference2video') || url.includes('/text2video')) return Response.json({ task_id: 'fixture-task-' + counts.generate, state: 'created' });
  if (url.includes('/tasks/')) return Response.json({ state: 'success', creations: [{ url: 'https://fixture.invalid/generated.png' }] });
  if (url.includes('/recording')) return Response.json({ recording: { video_url: 'https://fixture.invalid/recording.mp4' } });
  throw new Error('Local fixture forbids unknown provider request');
} });
const bridge = createXumengBridge({ secret, fork: studio.fork, connectionStatus: studio.connectionStatus });
const internal = http.createServer((req, res) => void bridge.handle(req, res));
await new Promise(resolve => internal.listen(0, '127.0.0.1', resolve));
const bridgeOrigin = 'http://127.0.0.1:' + internal.address().port;
const front = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path === '/fixture/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...counts, failExecute, activeLeases: active.size, activeAccounts: [...active.values()], heldCreate: Boolean(heldCreate) })); return; }
  if (path === '/fixture/hold-create') { holdNextCreate = true; res.end('{}'); return; }
  if (path === '/fixture/release-create') { heldCreate?.(); heldCreate = null; res.end('{}'); return; }
  if (path === '/fixture/fail-execute') { failExecute = !failExecute; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ failExecute })); return; }
  if (path === '/assets/qingyu/live/rtc.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL('../../../../public/dzmm/live/rtc.js', import.meta.url))); return; }
  if (!path.startsWith('/api/live/')) { res.writeHead(404); res.end(); return; }
  const parts = []; for await (const part of req) parts.push(part); const body = Buffer.concat(parts);
  const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const request = new Request('http://127.0.0.1:5174' + req.url, { method: req.method, headers, ...(req.method !== 'GET' ? { body } : {}) });
  const cookie = req.headers.cookie || '';
  const id = cookie.includes('qa-live-b') ? 'qa-live-b' : cookie.includes('qa-live-super') ? 'qa-live-super' : 'qa-live-a';
  const role = id === 'qa-live-super' ? 'super' : 'user';
  const response = await handleLiveGateway(request, { BACKEND: { fetch: async () => Response.json({ user: { id, role, isGuest: false } }) }, LIVE_BRIDGE_URL: 'https://fixture.invalid/qingyu-api', XUMENG_LIVE_BRIDGE_SECRET: secret }, {
    fetch: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/qingyu-api/status' || pathname.endsWith('/status')) counts.status++;
      if (pathname === '/qingyu-api/leases') counts.leases++;
      if (pathname.endsWith('/start')) counts.start++;
      if (pathname.endsWith('/execute')) { counts.execute++; if (failExecute) return Response.json({ error: '本地故障：表演提交失败，指令保留。' }, { status: 503 }); }
      if (pathname.endsWith('/task')) counts.task++;
      if (pathname.endsWith('/generate')) counts.generate++;
      if (init.method === 'DELETE') counts.deletes++;
      return fetch(bridgeOrigin + pathname, init);
    },
  });
  const result = await response.clone().json();
  if (path === '/api/live/leases' && response.status === 201) { active.set(result.leaseId, id); counts.createSuccess++; }
  if (req.method === 'DELETE' && response.status === 200 && result.ended === true) { active.delete(path.split('/').at(-1)); counts.deleteSuccess++; }
  if (path === '/api/live/leases' && response.status === 201 && holdNextCreate) { holdNextCreate = false; await new Promise(resolve => { heldCreate = resolve; }); }
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
front.listen(8910, '127.0.0.1', () => console.log('Original local live flow fixture on8910; external models forbidden'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await bridge.close(); studio.server.emit('close'); front.closeAllConnections(); internal.closeAllConnections(); front.close(); internal.close(); process.exit(0); });
