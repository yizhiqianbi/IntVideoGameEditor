import http from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createProvider } from './provider.mjs';
import { responseVariationNeeded, createVariationFallback } from './dialogue-state.mjs';
import { CHARACTERS } from './characters.mjs';
import { createSession, prepareTurn, parseResponse, commitTurn, setLocale, editMemory, removeMemory,
  initiativeEligibility, commitInitiative, setInitiative } from './engine.mjs';
import * as chatEngine from './engine.mjs';
import { recordDecision, applyInitiativeDecision } from './companion-runtime.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const publicCharacters = () => CHARACTERS.map(({ persona, facets, card, ...character }) => character);

export async function loadEnvironment() {
  let env = {};
  for (const path of [join(ROOT, '../../.env.local'), join(ROOT, '.env.local')]) {
    try { env = { ...env, ...parseEnv(await readFile(path, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { ...env, ...process.env };
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail('请使用 JSON 提交请求。', 415);
  const max = 24000;
  if (Number(req.headers['content-length']) > max) throw fail('请求内容过大。', 413);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) throw fail('请求内容过大。', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw fail('请求内容不是有效 JSON。'); }
}

export async function createApplication({ env = {}, dataDir = join(ROOT, '.data'), provider = createProvider(env) } = {}) {
  const sessionDir = join(resolve(dataDir), 'sessions');
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const locks = new Set();
  const initiatives = new Map();
  const foregrounds = new Map();
  const publicConfig = {
    configured: Boolean(provider.publicConfig.configured), model: String(provider.publicConfig.model || ''),
    defaultMode: provider.publicConfig.configured ? 'ai' : 'demo',
    reasoningEffort: provider.publicConfig.reasoningEffort || null,
    architecture: provider.publicConfig.architecture || 'single-replyer',
    plannerModel: provider.publicConfig.plannerModel || null,
  };
  const assertId = id => { if (!ID.test(id || '')) throw fail('找不到这个对话。', 404); };
  const readSession = async id => {
    assertId(id);
    try {
      const s = JSON.parse(await readFile(join(sessionDir, `${id}.json`), 'utf8'));
      if (s.id !== id || !CHARACTERS.some(c => c.id === s.characterId) || !Array.isArray(s.messages) || !Array.isArray(s.memories) || !Number.isInteger(s.revision)) throw new Error();
      return s;
    } catch (e) { throw fail(e.code === 'ENOENT' ? '找不到这个对话。' : '对话文件无法读取，请从其他对话继续。', e.code === 'ENOENT' ? 404 : 500); }
  };
  const save = async session => {
    assertId(session.id);
    const path = join(sessionDir, `${session.id}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(session, null, 2), { mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return session;
  };
  const locked = async (id, work, { cancelInitiative = true } = {}) => {
    if (locks.has(id)) throw fail('上一条消息还在回复，请稍等。', 409, 'BUSY');
    if (cancelInitiative) initiatives.get(id)?.controller.abort();
    locks.add(id);
    try { return await work(); } finally { locks.delete(id); }
  };
  const checkRevision = (session, revision) => {
    if (revision !== session.revision) throw fail('对话已在其他窗口更新，请刷新后再发送。', 409, 'STALE');
  };
  const json = (res, value, status = 200, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const port = server.address()?.port;
      const validHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      if (!validHosts.includes(req.headers.host)) throw fail('只允许通过本机地址访问。', 403);
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) throw fail('不支持该请求。', 405);
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.headers.origin && !validHosts.map(host => `http://${host}`).includes(req.headers.origin)) throw fail('请从本机聊天页面执行操作。', 403);
        if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('请从本机聊天页面执行操作。', 403);
      }
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;

      if (req.method === 'GET' && path === '/api/health') {
        json(res, { provider: publicConfig, characters: publicCharacters(), limits: { messageChars: 4000 } }); return;
      }
      if (req.method === 'GET' && path === '/api/sessions') {
        const files = (await readdir(sessionDir)).filter(name => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
        const sessions = [];
        for (const file of files) {
          try {
            const s = await readSession(file.slice(0, -5));
            sessions.push({ id: s.id, characterId: s.characterId, title: s.title, updatedAt: s.updatedAt, mode: s.mode, revision: s.revision, messageCount: s.messages.length });
          } catch {}
        }
        sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        json(res, { sessions: sessions.slice(0, 100) }); return;
      }
      if (req.method === 'POST' && path === '/api/sessions') {
        const body = await readBody(req);
        const mode = body.mode ?? publicConfig.defaultMode;
        if (!['ai', 'demo'].includes(mode)) throw fail('对话模式无效。');
        if (mode === 'ai' && !publicConfig.configured) throw fail('模型还未连接，请先新建演示对话。', 503);
        const session = createSession({ characterId: body.characterId, mode });
        json(res, { session: await save(session) }, 201); return;
      }
      const match = /^\/api\/sessions\/([^/]+)(?:\/(.*))?$/.exec(path);
      if (match) {
        const [, id, action = ''] = match;
        assertId(id);
        if (req.method === 'GET' && action === '') { json(res, { session: await readSession(id) }); return; }
        if (req.method === 'GET' && action === 'export') {
          json(res, await readSession(id), 200, { 'Content-Disposition': `attachment; filename="character-chat-${id}.json"` }); return;
        }
        if (req.method === 'POST' && action === 'interrupt') {
          const body = await readBody(req);
          if (!ID.test(body.requestId || '')) throw fail('消息编号无效。');
          const flight = foregrounds.get(id);
          const interrupted = flight?.requestId === body.requestId;
          if (interrupted) {
            flight.controller.abort();
            // Wait through any in-progress atomic save. The returned receipt
            // then tells the client whether to restore or retire the old input.
            await flight.finished;
          }
          json(res, { session: await readSession(id), interrupted }); return;
        }
        if (req.method === 'POST' && action === 'messages') {
          const body = await readBody(req);
          if (!ID.test(body.requestId || '')) throw fail('消息编号无效，请刷新页面。');
          if (Object.hasOwn(body, 'stream') && typeof body.stream !== 'boolean') throw fail('消息显示方式无效。');
          await locked(id, async () => {
            const session = await readSession(id);
            if (session.receipts?.some(receipt => receipt.requestId === body.requestId)) {
              if (body.stream) { res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ type: 'done', session }) + '\n'); }
              else json(res, { session });
              return;
            }
            checkRevision(session, body.revision);
            const prepared = prepareTurn(session, body.text, { locale: body.locale });
            const controller = new AbortController();
            let finish;
            const finished = new Promise(resolve => { finish = resolve; });
            const flight = { requestId: body.requestId, controller, finished };
            foregrounds.set(id, flight);
            const disconnected = () => { if (!res.writableEnded) controller.abort(); };
            res.once('close', disconnected);
            const emit = value => {
              if (res.destroyed || controller.signal.aborted) throw fail('这次生成已取消。', 409, 'CANCELLED');
              if (!res.headersSent) { res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.writeHead(200); }
              res.write(JSON.stringify(value) + '\n');
            };
            const buffered = [];
            const emittedIndexes = new Set();
            const preview = part => {
              buffered.push(part);
              // Preserve the responsive first bubble for a normal stream, but
              // suppress a bubble that is already in the reply ledger. This
              // lets the duplicate guard work before a repeated refusal is
              // visible while keeping the existing early-preview UX.
              if (body.stream && part.index === emittedIndexes.size && !responseVariationNeeded(session, [part.text]).needed) {
                emit({ type: 'message', index: part.index, text: part.text });
                emittedIndexes.add(part.index);
              }
            };
            try {
              if (res.destroyed) controller.abort();
              const streamOptions = body.stream ? { onMessage: preview } : {};
              let proposal = await provider.generate(prepared, body.text.trim(), {
                signal: controller.signal,
                ...streamOptions,
              });
              if (controller.signal.aborted) throw fail('这次生成已取消。', 409, 'CANCELLED');
              let result = parseResponse(proposal, { currentUserText: body.text.trim() });
              let variation = responseVariationNeeded(session, result.messages);
              if (variation.needed) {
                // A model can satisfy the format contract while still sending
                // the same refusal or comfort line. Give it one fresh prompt
                // with the recent response ledger. AI conversations never
                // disguise a canned local line as a successful model reply.
                buffered.length = 0;
                proposal = await provider.generate(prepared, body.text.trim(), {
                  signal: controller.signal,
                  variation: true,
                  decision: proposal.control,
                  // Retry privately: another index 0 would conflict with an
                  // already shown prefix. The final done event replaces it.
                });
                result = parseResponse(proposal, { currentUserText: body.text.trim() });
                variation = responseVariationNeeded(session, result.messages);
                if (variation.needed) {
                  if (session.mode !== 'demo') throw fail('这次回复和刚才太相似了，请重试换一种说法。', 502);
                  result = parseResponse(createVariationFallback(prepared, body.text.trim()), { currentUserText: body.text.trim() });
                  buffered.length = 0;
                }
              }
              if (body.stream) for (const [index, text] of result.messages.entries()) {
                if (!emittedIndexes.has(index)) emit({ type: 'message', index, text });
              }
              if (controller.signal.aborted) throw fail('这次生成已取消。', 409, 'CANCELLED');
              const committed = await save(recordDecision(commitTurn(prepared, body.text.trim(), result, { requestId: body.requestId }), proposal.control));
              if (body.stream) { emit({ type: 'done', session: committed }); res.end(); }
              else json(res, { session: committed });
            } catch (error) {
              // Preserve the existing streaming contract for malformed model
              // output: already completed bubbles can still be withdrawn by
              // the client when the terminal error arrives.
              if (body.stream && buffered.length && !res.headersSent) {
                for (const { index, text } of buffered) emit({ type: 'message', index, text });
              }
              throw error;
            } finally {
              res.off('close', disconnected);
              if (foregrounds.get(id) === flight) foregrounds.delete(id);
              // locked() releases its guard as the work promise settles.
              // The next request is a separate HTTP task after this microtask.
              finish();
            }
          }); return;
        }
        if (req.method === 'POST' && action === 'presence') {
          const body = await readBody(req);
          await locked(id, async () => {
            const session = await readSession(id);
            checkRevision(session, body.revision);
            const updated = chatEngine.rearmInitiative(session);
            json(res, { session: updated.revision === session.revision ? updated : await save(updated) });
          }); return;
        }
        if (req.method === 'POST' && action === 'initiative') {
          const body = await readBody(req);
          if (!ID.test(body.requestId || '')) throw fail('消息编号无效，请刷新页面。');
          const initial = await locked(id, async () => {
            const session = await readSession(id);
            if (session.receipts?.some(receipt => receipt.requestId === body.requestId)) return { session, done: true, skipped: !session.messages.some(message => message.turnId === body.requestId && message.kind === 'initiative') };
            checkRevision(session, body.revision);
            const eligibility = initiativeEligibility(session);
            if (body.planId !== undefined && body.planId !== eligibility.planId) throw fail('这段话已经有了新的想法。', 409, 'STALE');
            if (!eligibility.eligible) return { session, done: true, skipped: true };
            if (initiatives.has(id)) throw fail('她正在想一句话，请稍等。', 409, 'BUSY');
            if (typeof provider.generateInitiative !== 'function') throw fail('主动对话暂时不可用。', 503);
            const flight = { controller: new AbortController(), requestId: body.requestId };
            initiatives.set(id, flight);
            return { session, flight, done: false };
          }, { cancelInitiative: false });
          if (initial.done) { json(res, { session: initial.session, skipped: initial.skipped }); return; }
          const { session, flight } = initial;
          const disconnected = () => { if (!res.writableEnded) flight.controller.abort(); };
          res.once('close', disconnected);
          if (res.destroyed) flight.controller.abort();
          try {
            const proposal = await provider.generateInitiative(session, { signal: flight.controller.signal });
            await locked(id, async () => {
              const current = await readSession(id);
              // Foreground typing/sending and setting changes always win over a late initiative.
              checkRevision(current, session.revision);
              if (flight.controller.signal.aborted) throw fail('这次主动消息已取消。', 409, 'CANCELLED');
              if (!initiativeEligibility(current).eligible) { json(res, { session: current, skipped: true }); return; }
              const result = parseResponse(proposal, { allowEmpty: true });
              const committed = applyInitiativeDecision(commitInitiative(current, result, { requestId: body.requestId }), current, proposal.control);
              const skipped = committed.receipts?.findLast(receipt => receipt.requestId === body.requestId)?.skipped ?? !committed.messages.some(message => message.turnId === body.requestId && message.kind === 'initiative');
              json(res, { session: await save(committed), skipped });
            }, { cancelInitiative: false });
          } finally {
            res.off('close', disconnected);
            if (initiatives.get(id) === flight) initiatives.delete(id);
          }
          return;
        }
        if (req.method === 'PATCH' && action === 'settings') {
          const body = await readBody(req);
          await locked(id, async () => {
            const session = await readSession(id);
            checkRevision(session, body.revision);
            if (!Object.hasOwn(body, 'locale') && !Object.hasOwn(body, 'initiative')) throw fail('请指定要修改的设置。');
            let updated = session;
            if (Object.hasOwn(body, 'locale')) updated = setLocale(updated, body.locale);
            if (Object.hasOwn(body, 'initiative')) updated = setInitiative(updated, body.initiative);
            updated.revision = session.revision + 1;
            json(res, { session: await save(updated) });
          }); return;
        }
        const memory = /^memories\/([^/]+)$/.exec(action);
        if (memory && ['PATCH', 'DELETE'].includes(req.method)) {
          assertId(memory[1]);
          const body = await readBody(req);
          await locked(id, async () => {
            const session = await readSession(id);
            checkRevision(session, body.revision);
            const next = req.method === 'PATCH' ? editMemory(session, memory[1], body.text) : removeMemory(session, memory[1]);
            json(res, { session: await save(next) });
          }); return;
        }
        throw fail('找不到这个操作。', 404);
      }
      const staticFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css'],
        ['/architecture.html', 'research/proactive-architecture.html'],
        ['/flexichrono-2026-10-12.md', 'research/flexichrono-2026-10-12.md'],
        ['/nariyume-reverse-2026-10-12/architecture.html', 'research/nariyume-reverse-2026-10-12/architecture.html']]);
      if (['GET', 'HEAD'].includes(req.method) && staticFiles.has(path)) {
        const name = staticFiles.get(path);
        const content = await readFile(name.startsWith('research/') ? join(ROOT, name) : join(ROOT, 'public', name));
        if (name.endsWith('architecture.html')) {
          const html = content.toString('utf8');
          const hashes = tag => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))]
            .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ') || "'none'";
          res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${hashes('script')}; style-src ${hashes('style')}; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
        } else res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.md') ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      throw fail('页面不存在。', 404);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const value = { error: status === 500 ? '聊天服务暂时无法完成操作，请重试。' : error.message, ...(error.code && ['STALE', 'BUSY', 'CANCELLED'].includes(error.code) ? { code: error.code } : {}) };
      if (res.headersSent) {
        if (!res.destroyed && /application\/x-ndjson/iu.test(String(res.getHeader('content-type') || ''))) res.end(JSON.stringify({ type: 'error', ...value }) + '\n');
        else res.destroy();
        return;
      }
      json(res, value, status);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const env = await loadEnvironment();
  const port = Number(env.CHARACTER_CHAT_PORT || 3227);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CHARACTER_CHAT_PORT 必须是 1024–65535 的端口号。');
  const { server } = await createApplication({ env });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请设置 CHARACTER_CHAT_PORT。` : '聊天服务启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`余话 · Chat only 原型：http://127.0.0.1:${port}`));
}
