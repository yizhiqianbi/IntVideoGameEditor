import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const PREFIX = '/xumeng-api';
const MAX_BODY = 20 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACTIONS = new Set(['start', 'stop', 'heartbeat', 'execute', 'danmaku', 'interrupt', 'references', 'generate', 'task', 'recording']);
const SESSION_ACTIONS = new Set(['stop', 'heartbeat', 'execute', 'danmaku', 'interrupt', 'references']);
const PAID_ACTIONS = new Set(['generate', 'task', 'recording']);

class BridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function xumengBridgeCanonical(method, pathname, userId, role, timestamp, nonce, rawBody = Buffer.alloc(0)) {
  return [method, pathname, userId, role, timestamp, nonce, createHash('sha256').update(rawBody).digest('hex')].join('\n');
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new BridgeError(413, '请求体超过 20 MB。');
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) throw new BridgeError(413, '请求体超过 20 MB。');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function jsonObject(raw) {
  let body;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new BridgeError(400, '无效 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BridgeError(400, '请求应为 JSON 对象。');
  return body;
}

function safeStatus(value) {
  return {
    configured: Boolean(value.configured),
    region: value.region === 'global' ? 'global' : 'cn',
    session: value.session || null,
    events: Array.isArray(value.events) ? value.events : [],
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    lastStartError: value.lastStartError || null,
  };
}

function hasCleanupCapability(lease, body) {
  if (typeof body.cleanupToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.cleanupToken)) return false;
  const presented = createHash('sha256').update(body.cleanupToken).digest();
  return timingSafeEqual(presented, lease.cleanupHash);
}

export function createXumengBridge({ fork, connectionStatus = () => ({ configured: false, region: 'cn' }), secret = '', request = fetch, now = Date.now, idleMs = 10 * 60 * 1000, maxPerUser = 2, maxLeases = 50 } = {}) {
  if (typeof fork !== 'function') throw new TypeError('A studio fork factory is required');
  const configured = typeof secret === 'string' && secret.length >= 32;
  const leases = new Map(), nonces = new Map();
  let closed = false;

  function authenticate(req, pathname, raw) {
    if (!configured || closed) throw new BridgeError(503, '数字人连接尚未配置。');
    const userId = req.headers['x-xumeng-live-user'];
    const role = req.headers['x-xumeng-live-role'];
    const timestamp = req.headers['x-xumeng-live-timestamp'];
    const nonce = req.headers['x-xumeng-live-nonce'];
    const signature = req.headers['x-xumeng-live-signature'];
    if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userId)
      || !['user', 'super'].includes(role)
      || typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp)
      || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
      || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new BridgeError(401, '数字人连接签名无效。');
    }
    // Signed timestamps use Unix seconds. Millisecond timestamps are not accepted.
    const issued = Number(timestamp) * 1000, current = now();
    if (!Number.isSafeInteger(issued) || Math.abs(current - issued) > 60_000) throw new BridgeError(401, '数字人连接签名已过期。');
    const expected = createHmac('sha256', secret).update(xumengBridgeCanonical(req.method, pathname, userId, role, timestamp, nonce, raw)).digest();
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) throw new BridgeError(401, '数字人连接签名无效。');
    for (const [used, expires] of nonces) if (expires < current) nonces.delete(used);
    if (nonces.has(nonce)) throw new BridgeError(401, '数字人连接签名已使用。');
    if (nonces.size >= 10_000) throw new BridgeError(429, '数字人连接请求过多，请稍后再试。');
    // A future-dated ticket remains replay-protected until its whole validity window ends.
    nonces.set(nonce, issued + 60_000);
    return { userId, role };
  }

  async function studioRequest(lease, route, body) {
    const response = await request(lease.origin + '/api/' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Studio-Token': lease.csrf, Origin: lease.origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(65_000),
    });
    let value;
    try { value = await response.json(); } catch { throw new BridgeError(502, '数字人服务返回无效内容，请刷新状态后重试。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError(502, '数字人服务返回无效内容，请刷新状态后重试。');
    return { status: response.status, value };
  }

  async function locked(lease, fn) {
    const previous = lease.tail;
    let release;
    lease.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (lease.closed) throw new BridgeError(404, '数字人会话入口不存在或已结束。');
      return await tracked(lease, fn);
    } finally { release(); }
  }

  async function tracked(lease, fn) {
    if (lease.closed) throw new BridgeError(404, '数字人会话入口不存在或已结束。');
    const pending = Promise.resolve().then(fn);
    lease.inflight.add(pending);
    try { return await pending; } finally { lease.inflight.delete(pending); }
  }

  async function dispose(lease) {
    if (lease.closed) return lease.disposal;
    lease.closed = true;
    leases.delete(lease.id);
    lease.disposal = (async () => {
      // Allow an in-flight start to finish before ending its resulting session.
      await lease.tail;
      await Promise.allSettled([...lease.inflight]);
      if (!lease.child) return;
      lease.child.end('叙梦会话入口已结束');
      lease.child.server.closeAllConnections();
      await new Promise(resolve => lease.child.server.close(resolve));
    })();
    return lease.disposal;
  }

  async function expire() {
    const cutoff = now() - idleMs;
    await Promise.all([...leases.values()].filter(lease => lease.lastAccess <= cutoff).map(dispose));
  }

  async function createLease(identity) {
    await expire();
    if (closed) throw new BridgeError(503, '数字人服务正在关闭。');
    if ([...leases.values()].filter(lease => lease.userId === identity.userId).length >= maxPerUser) throw new BridgeError(429, '最多同时打开两个数字人工作台，请先结束另一个。');
    if (leases.size >= maxLeases) throw new BridgeError(429, '数字人工作台已满，请稍后再试。');
    const cleanupToken = randomBytes(32).toString('hex');
    const lease = { id: randomUUID(), userId: identity.userId, cleanupHash: createHash('sha256').update(cleanupToken).digest(), lastAccess: now(), tail: Promise.resolve(), inflight: new Set(), closed: false, child: null };
    // Reserve the slot before awaiting listen(), including concurrent requests.
    leases.set(lease.id, lease);
    try {
      lease.child = fork();
      await new Promise((resolve, reject) => {
        const onError = error => reject(error);
        lease.child.server.once('error', onError);
        lease.child.server.listen(0, '127.0.0.1', () => { lease.child.server.off('error', onError); resolve(); });
      });
      lease.origin = 'http://127.0.0.1:' + lease.child.server.address().port;
      const status = await studioRequest(lease, 'status');
      if (status.status !== 200 || typeof status.value.csrf !== 'string') throw new BridgeError(502, '数字人工作台初始化失败。');
      lease.csrf = status.value.csrf;
      if (closed || lease.closed) throw new BridgeError(503, '数字人服务正在关闭。');
      // This capability only permits closing this lease after its account cookie
      // changes. It never authorizes reading data or operating a live session.
      return { leaseId: lease.id, accountId: identity.userId, cleanupToken };
    } catch (error) { await dispose(lease); throw error; }
  }

  async function handle(req, res) {
    const reply = (status, value) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) throw new BridgeError(403, '仅允许受信服务连接。');
      const url = new URL(req.url || '/', 'http://localhost'), pathname = url.pathname;
      if (url.search) throw new BridgeError(400, '数字人接口不支持查询参数。');
      const raw = await readBody(req), identity = authenticate(req, pathname, raw);
      if (identity.userId === 'lease_cleanup' && !(req.method === 'DELETE' && /^\/xumeng-api\/leases\/[a-f0-9-]{36}$/i.test(pathname))) throw new BridgeError(404, '数字人接口不存在。');
      if (req.method === 'GET' && pathname === PREFIX + '/status') {
        const connection = connectionStatus();
        return reply(200, { available: true, configured: Boolean(connection.configured), realAllowed: identity.role === 'super', region: connection.region === 'global' ? 'global' : 'cn' });
      }
      if (req.method === 'POST' && pathname === PREFIX + '/leases') {
        jsonObject(raw);
        return reply(201, await createLease(identity));
      }
      const match = pathname.match(/^\/xumeng-api\/leases\/([^/]+)(?:\/([^/]+))?$/);
      if (!match || !UUID.test(match[1])) throw new BridgeError(404, '数字人接口不存在。');
      const lease = leases.get(match[1]);
      if (!lease || lease.closed) throw new BridgeError(404, '数字人会话入口不存在或已结束。');
      const action = match[2];
      if (req.method === 'DELETE' && !action) {
        const body = jsonObject(raw);
        if (lease.userId !== identity.userId && !hasCleanupCapability(lease, body)) throw new BridgeError(404, '数字人会话入口不存在或已结束。');
        await dispose(lease);
        return reply(200, { ended: true });
      }
      if (lease.userId !== identity.userId) throw new BridgeError(404, '数字人会话入口不存在或已结束。');
      if (now() - lease.lastAccess >= idleMs) { await dispose(lease); throw new BridgeError(404, '数字人会话入口已过期，请重新打开。'); }
      if (req.method === 'GET' && action === 'status') {
        lease.lastAccess = now();
        const result = await tracked(lease, () => studioRequest(lease, 'status'));
        return reply(result.status, safeStatus(result.value));
      }
      if (req.method !== 'POST' || !ACTIONS.has(action)) throw new BridgeError(404, '数字人接口不存在。');
      const body = jsonObject(raw);
      if (identity.role !== 'super' && (PAID_ACTIONS.has(action) || action === 'start' && body.mode !== 'rehearsal')) throw new BridgeError(403, '真实直播和素材生成目前仅管理员可用；可以先体验演练。');
      lease.lastAccess = now();
      const apply = async () => {
        if (SESSION_ACTIONS.has(action)) {
          const status = await studioRequest(lease, 'status');
          if (status.status !== 200) throw new BridgeError(502, '暂时无法核对直播状态。');
          if (typeof body.id !== 'string' || body.id !== status.value.session?.id) throw new BridgeError(409, '直播场次已变化，请刷新状态后重试。');
          if (identity.role !== 'super' && status.value.session.mode === 'real' && action !== 'stop') throw new BridgeError(403, '真实直播目前仅管理员可用；请结束直播后使用演练。');
        }
        return studioRequest(lease, action, action === 'start' ? { ...body, control: 'performance' } : body);
      };
      // Independent material requests must not delay the live heartbeat while
      // the provider takes time to acknowledge a generation or recording.
      const result = await (action === 'start' || SESSION_ACTIONS.has(action) ? locked(lease, apply) : tracked(lease, apply));
      return reply(result.status, result.value);
    } catch (error) {
      reply(error instanceof BridgeError ? error.status : 502, { error: error instanceof BridgeError ? error.message : '数字人服务暂不可用，请刷新状态后重试。' });
    }
  }

  const cleanup = setInterval(() => { void expire(); }, Math.min(30_000, idleMs));
  cleanup.unref();
  return {
    handle,
    expire,
    close: async () => { closed = true; clearInterval(cleanup); await Promise.all([...leases.values()].map(dispose)); },
  };
}
