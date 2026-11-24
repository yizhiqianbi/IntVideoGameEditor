import http from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createSession, applyOpening, prepareAction, applyTurn, demoOpening, demoTurn, rewindSession, validateSession } from './narrative-engine.mjs';
import { createNarrativeAgent } from './narrative-agent.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ID = /^[a-f0-9-]{36}$/;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
export async function loadEnvironment() {
  let env = {};
  for (const path of [join(ROOT, '../../.env.local'), join(ROOT, '.env.local')]) {
    try { env = { ...env, ...parseEnv(await readFile(path, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { ...env, ...process.env };
}
async function readBody(req, max = 100000) {
  if (Number(req.headers['content-length']) > max) throw error('上传内容过大。', 413);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw error('上传内容过大。', 413); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw error('请求内容不是有效 JSON。'); }
}

export async function createNarrativeApplication({ env = {}, dataDir = join(ROOT, '.data'), agent = createNarrativeAgent(env) } = {}) {
  const storyDir = join(dataDir, 'stories');
  await mkdir(storyDir, { recursive: true, mode: 0o700 });
  const locks = new Set();
  const assertId = id => { if (!ID.test(id || '')) throw error('故事编号无效。', 404); };
  const readSession = async id => {
    assertId(id);
    try { const session = JSON.parse(await readFile(join(storyDir, `${id}.json`), 'utf8')); if (session.schemaVersion !== 2) throw new Error(); return session; }
    catch (e) { throw error(e.code === 'ENOENT' ? '找不到这个故事。可以从“我的故事”打开新版故事。' : '故事无法读取，请使用导出的备份恢复。', e.code === 'ENOENT' ? 404 : 500); }
  };
  const save = async session => {
    session = structuredClone(session);
    assertId(session.id); session.updatedAt = new Date().toISOString();
    const path = join(storyDir, `${session.id}.json`), tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(session), { mode: 0o600 }); await rename(tmp, path); return session;
  };
  const locked = async (id, fn) => {
    if (locks.has(id)) throw error('Agent 正在处理上一行动，请等这一幕完成。', 409);
    locks.add(id); try { return await fn(); } finally { locks.delete(id); }
  };
  const revisionCheck = (s, revision) => { if (revision !== s.revision) throw error('故事已更新，请刷新后再行动。', 409); };
  const json = (res, data, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); };
  const checkedProposal = (fn, s, prepared, proposal) => {
    try { return prepared ? fn(s, prepared, proposal) : fn(s, proposal); }
    catch (e) {
      if (e.status === 409) throw e;
      throw error(`Agent 的剧情结算未通过校验，本轮没有改变故事。${e.message || ''}`, 502);
    }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    try {
      const port = server.address()?.port, validHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      if (!validHosts.includes(req.headers.host)) throw error('只允许本机访问这个实验。', 403);
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw error('不支持该请求。', 405);
      if (req.method === 'POST' && req.headers.origin && !validHosts.map(h => `http://${h}`).includes(req.headers.origin)) throw error('请从本机实验页面执行操作。', 403);
      if (req.method === 'GET' && path === '/api/health') { json(res, { ok: true, story: agent.publicConfig, focus: 'narrative', schemaVersion: 2 }); return; }
      if (req.method === 'GET' && path === '/api/sessions') {
        const files = (await readdir(storyDir)).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)), sessions = [];
        for (const f of files) { try { const s = JSON.parse(await readFile(join(storyDir, f), 'utf8')); if (s.schemaVersion === 2) sessions.push({ id: s.id, name: s.preset.name, title: s.nodes.at(-1)?.title, updatedAt: s.updatedAt, revision: s.revision, mode: s.mode, schemaVersion: 2 }); } catch {} }
        sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); json(res, { sessions: sessions.slice(0, 100) }); return;
      }
      if (req.method === 'POST' && path === '/api/sessions') {
        const input = await readBody(req);
        let session = createSession({ ...input, mode: input.mode || 'ai' }, randomUUID());
        const proposal = session.mode === 'demo' ? demoOpening(session) : await agent.generate(session, null);
        session = checkedProposal(applyOpening, session, null, proposal);
        json(res, { session: await save(session) }, 201); return;
      }
      if (req.method === 'POST' && path === '/api/sessions/import') {
        const { session: input } = await readBody(req, 12 * 1024 * 1024);
        if (input?.schemaVersion !== 2) throw error('请选择新版剧情存档。第一版数值实验的存档仍保留在本机，没有被覆盖。');
        json(res, { session: await save(validateSession(input)), notice: '故事已恢复为独立副本，原存档保持不变。' }, 201); return;
      }
      const match = /^\/api\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
      if (match) {
        const [, id, suffix = ''] = match; assertId(id);
        if (req.method === 'GET' && !suffix) { json(res, { session: await readSession(id) }); return; }
        if (req.method === 'GET' && suffix === 'export') { json(res, await readSession(id), 200, { 'Content-Disposition': `attachment; filename="system-life-story-${id}.json"` }); return; }
        if (req.method === 'POST' && suffix === 'turn') {
          const body = await readBody(req);
          if (!ID.test(body.requestId || '')) throw error('请为本次行动生成唯一编号。');
          await locked(id, async () => {
            const session = await readSession(id);
            if (session.nodes.some(n => n.requestId === body.requestId)) { json(res, { session }); return; }
            revisionCheck(session, body.revision);
            const prepared = prepareAction(session, body);
            const proposal = session.mode === 'demo' ? demoTurn(session, prepared) : await agent.generate(session, prepared);
            const next = structuredClone(checkedProposal(applyTurn, session, prepared, proposal)); next.nodes.at(-1).requestId = body.requestId;
            json(res, { session: await save(next) });
          }); return;
        }
        if (req.method === 'POST' && suffix === 'rewind') {
          const body = await readBody(req);
          await locked(id, async () => { const s = await readSession(id); revisionCheck(s, body.revision); json(res, { session: await save(rewindSession(s, body.nodeId)) }); }); return;
        }
        throw error('找不到这个操作。当前实验先专注剧情，视频功能已暂时收起。', 404);
      }
      if (['GET', 'HEAD'].includes(req.method) && ['/', '/index.html', '/app.js', '/style.css'].includes(path)) {
        const filename = path === '/' ? 'index.html' : path.slice(1), content = await readFile(join(ROOT, 'public', filename));
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        res.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      throw error('页面不存在。', 404);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, { error: e.status ? e.message : '实验服务暂时无法完成操作，请重试。' }, e.status || 500);
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = await loadEnvironment(), port = Number(env.SYSTEM_LIFE_PORT || 3218);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SYSTEM_LIFE_PORT 无效');
  const server = await createNarrativeApplication({ env });
  server.listen(port, '127.0.0.1', () => console.log(`剧情优先的系统流实验已启动：http://127.0.0.1:${port}`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已占用。` : '实验服务启动失败。'); process.exitCode = 1; });
}
