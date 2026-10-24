/** Private control and transport endpoints for one server-assigned account. */
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CompanionLifecycle, lifecycleError } from './lifecycle.mjs';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const SESSION = new RegExp(`^/api/sessions/${UUID}$`, 'i');
const MESSAGE = new RegExp(`^/api/sessions/${UUID}/(?:messages|proactive)$`, 'i');
const MAX_ARCHIVE = 1024 * 1024 * 1024;

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

export function createController({ token = process.env.COMPANION_CONTROL_TOKEN, lifecycle = new CompanionLifecycle({ packageDir: dirname(fileURLToPath(import.meta.url)) }) } = {}) {
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    let temporary;
    try {
      if (!authorized(request, token)) return send(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
      const path = new URL(request.url, 'http://container.invalid').pathname;
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
      if (response.headersSent) response.destroy();
      else send(error.status || 503, { error: 'Companion operation failed.', code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'COMPANION_OPERATION_FAILED', ...lifecycle.health() });
    } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  });
  server.requestTimeout = 180_000;
  server.companionLifecycle = lifecycle;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createController();
  server.listen(port, '0.0.0.0', () => console.log('Private companion controller listening; runtime is not started.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void server.companionLifecycle.stop().then(() => server.close(), () => { process.exitCode = 1; server.close(); });
  });
}
