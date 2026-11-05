/** Private control and transport endpoints for one account, or a pool of isolated tenants. */
import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CompanionLifecycle, lifecycleError } from './lifecycle.mjs';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const ACCOUNT = new RegExp(`^${UUID}$`, 'i');
const SESSION = new RegExp(`^/api/sessions/${UUID}$`, 'i');
const MESSAGE = new RegExp(`^/api/sessions/${UUID}/messages$`, 'i');
const TENANT = /^\/tenants\/([a-f0-9]{64})(\/.*)$/;
const MODEL = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_ARCHIVE = 1024 * 1024 * 1024;
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const PERSONAS = new Set(Object.keys(JSON.parse(readFileSync(join(PACKAGE_DIR, 'personas.json'), 'utf8'))));

function authorized(request, token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(request.headers.authorization || '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function permitted(path, method) {
  return method === 'GET' && (path === '/api/health' || path === '/api/sessions' || SESSION.test(path))
    || method === 'POST' && (path === '/api/sessions' || MESSAGE.test(path));
}
async function body(request, limit = 24_000) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw lifecycleError('REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function archiveUpload(request, path) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_ARCHIVE)) throw lifecycleError('ARCHIVE_TOO_LARGE', 413);
  const expected = request.headers['x-snapshot-sha256'];
  if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected)) throw lifecycleError('INVALID_SNAPSHOT_HASH', 400);
  let count = 0; const hash = createHash('sha256');
  const output = await open(path, 'wx', 0o600);
  try {
    for await (const chunk of request) {
      count += chunk.length;
      if (count > MAX_ARCHIVE) throw lifecycleError('ARCHIVE_TOO_LARGE', 413);
      hash.update(chunk); await output.writeFile(chunk);
    }
  } finally { await output.close(); }
  if (!count || declared !== undefined && count !== Number(declared) || expected !== undefined && hash.digest('hex') !== expected) {
    throw lifecycleError('SNAPSHOT_TRANSFER_MISMATCH', 400);
  }
}
function sender(response) {
  return (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
  };
}
function failure(response, send, error, health) {
  if (response.headersSent) response.destroy();
  else send(error.status || 503, { error: 'Companion operation failed.', code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'COMPANION_OPERATION_FAILED', ...health });
}

/** Routes for exactly one account lifecycle; `path` is already tenant-relative. */
async function handleInstance(request, response, lifecycle, path) {
  const send = sender(response);
  let temporary;
  try {
    if (request.method === 'GET' && path === '/health') return send(200, lifecycle.health());
    if (request.method === 'GET' && path === '/ready') { const result = lifecycle.health(); return send(result.ready ? 200 : 503, result); }
    if (request.method === 'POST' && ['/internal/start', '/internal/stop'].includes(path)) {
      const input = await body(request);
      if (input.length && input.toString().trim() !== '{}') throw lifecycleError('CONTROL_BODY_NOT_ALLOWED', 400);
      return send(200, await (path.endsWith('/start') ? lifecycle.start() : lifecycle.stop()));
    }
    if (request.method === 'GET' && path === '/internal/snapshot') {
      temporary = await mkdtemp(join(tmpdir(), 'companion-snapshot-'));
      const archive = join(temporary, 'instance.tar.gz');
      const result = await lifecycle.snapshot(archive);
      response.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': String(result.size),
        'X-Snapshot-Sha256': result.sha256, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      await pipeline(createReadStream(archive), response);
      return;
    }
    if (request.method === 'POST' && path === '/internal/restore') {
      temporary = await mkdtemp(join(tmpdir(), 'companion-restore-'));
      const archive = join(temporary, 'instance.tar.gz');
      await archiveUpload(request, archive);
      return send(200, await lifecycle.restore(archive));
    }
    if (permitted(path, request.method)) {
      if (request.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw lifecycleError('JSON_REQUIRED', 415);
      const bytes = request.method === 'POST' ? await body(request) : undefined;
      const result = await lifecycle.proxy(path, { method: request.method, body: bytes });
      response.writeHead(result.status, { 'Content-Type': result.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(result.body); return;
    }
    return send(404, { error: 'Not found' });
  } catch (error) {
    failure(response, send, error, lifecycle.health());
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}

export function createController({ token = process.env.COMPANION_CONTROL_TOKEN, lifecycle = new CompanionLifecycle({ packageDir: PACKAGE_DIR }) } = {}) {
  const server = createServer(async (request, response) => {
    if (!authorized(request, token)) return sender(response)(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return handleInstance(request, response, lifecycle, new URL(request.url, 'http://container.invalid').pathname);
  });
  server.requestTimeout = 180_000;
  server.companionLifecycle = lifecycle;
  return server;
}

/** Ports are per slot so several native runtimes can share one loopback. */
export function slotPorts(slot) {
  const base = 20_000 + slot * 10;
  return { webui: base + 1, gateway: base + 2, wsServer: base + 3, apiServer: base + 4 };
}

/**
 * Shared container: every account still gets its own MaiBot process, instance
 * directory, SQLite files, memory index and WebUI credentials. Only the warm
 * container, interpreter page cache and controller are shared. Tenant keys are
 * chosen by the Durable Object host, never by a browser.
 */
export function createPoolController({
  token = process.env.COMPANION_CONTROL_TOKEN,
  capacity = Number(process.env.COMPANION_POOL_CAPACITY || 8),
  root = resolve(process.env.COMPANION_TENANTS_DIR || '/var/lib/xumeng-companion/tenants'),
  createLifecycle = ({ env, ports }) => new CompanionLifecycle({ env, ports, packageDir: PACKAGE_DIR }),
  baseEnv = process.env,
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) throw new Error('Invalid pool capacity');
  const bootId = randomUUID();
  const tenants = new Map();
  const freeSlot = () => {
    const used = new Set([...tenants.values()].map(item => item.slot));
    for (let slot = 0; slot < capacity; slot++) if (!used.has(slot)) return slot;
    return -1;
  };
  const create = async (key, request, send) => {
    let input;
    try { input = JSON.parse((await body(request, 4_000)).toString() || '{}'); } catch { throw lifecycleError('INVALID_JSON', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => !['accountId', 'chatModel', 'persona'].includes(name))
      || typeof input.accountId !== 'string' || !ACCOUNT.test(input.accountId)
      || input.chatModel !== undefined && (typeof input.chatModel !== 'string' || !MODEL.test(input.chatModel))
      || input.persona !== undefined && (typeof input.persona !== 'string' || !PERSONAS.has(input.persona))) throw lifecycleError('INVALID_TENANT', 400);
    const existing = tenants.get(key);
    if (existing) {
      if (existing.accountId !== input.accountId.toLowerCase()) throw lifecycleError('TENANT_ACCOUNT_MISMATCH', 409);
      return send(200, { created: false, ...existing.lifecycle.health() });
    }
    const slot = freeSlot();
    if (slot < 0) throw lifecycleError('POOL_FULL', 503);
    const env = { ...baseEnv, COMPANION_ACCOUNT_ID: input.accountId.toLowerCase(), COMPANION_INSTANCE_DIR: join(root, key, 'instance') };
    delete env.COMPANION_CONTROL_TOKEN; delete env.COMPANION_POOL_MODE;
    if (input.chatModel) env.COMPANION_CHAT_MODEL = input.chatModel;
    if (input.persona) env.COMPANION_PERSONA = input.persona;
    const lifecycle = createLifecycle({ env, ports: slotPorts(slot) });
    tenants.set(key, { slot, accountId: env.COMPANION_ACCOUNT_ID, lifecycle });
    return send(201, { created: true, ...lifecycle.health() });
  };
  const destroy = async (key, send) => {
    const tenant = tenants.get(key);
    if (!tenant) return send(404, { exists: false, code: 'TENANT_NOT_FOUND' });
    await tenant.lifecycle.discard();
    await rm(join(root, key), { recursive: true, force: true });
    tenants.delete(key);
    return send(200, { destroyed: true });
  };
  const server = createServer(async (request, response) => {
    const send = sender(response);
    try {
      if (!authorized(request, token)) return send(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
      const path = new URL(request.url, 'http://container.invalid').pathname;
      if (request.method === 'GET' && path === '/health') return send(200, { pool: true, bootId, tenants: tenants.size, capacity });
      const match = TENANT.exec(path);
      if (!match) return send(404, { error: 'Not found' });
      const [, key, rest] = match;
      if (request.method === 'POST' && rest === '/create') return await create(key, request, send);
      if (request.method === 'POST' && rest === '/destroy') return await destroy(key, send);
      const tenant = tenants.get(key);
      if (!tenant) return send(404, { exists: false, code: 'TENANT_NOT_FOUND' });
      if (request.method === 'GET' && rest === '/exists') return send(200, { exists: true, ...tenant.lifecycle.health() });
      return await handleInstance(request, response, tenant.lifecycle, rest);
    } catch (error) {
      failure(response, send, error, {});
    }
  });
  server.requestTimeout = 180_000;
  server.companionTenants = tenants;
  server.stopAll = () => Promise.allSettled([...tenants.values()].map(item => item.lifecycle.stop()));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const pooled = process.env.COMPANION_POOL_MODE === '1';
  const server = pooled ? createPoolController() : createController();
  server.listen(port, '0.0.0.0', () => console.log(pooled ? 'Private companion pool controller listening; no tenant is started.' : 'Private companion controller listening; runtime is not started.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    const stopping = pooled ? server.stopAll() : server.companionLifecycle.stop();
    void stopping.then(() => server.close(), () => { process.exitCode = 1; server.close(); });
  });
}
