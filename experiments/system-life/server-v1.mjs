import http from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createSession, resolveTurn, commitTurn, demoStory, rewindSession, validateSession, applyInitialStory, ACTION_RULES } from './engine.mjs';
import { createStoryAdapter } from './story.mjs';
import { createVideoAdapter } from './video.mjs';

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

export async function createApplication({ env = {}, dataDir = join(ROOT, '.data'), story = createStoryAdapter(env), video = createVideoAdapter(env) } = {}) {
  const sessionDir = join(dataDir, 'sessions'), mediaDir = join(dataDir, 'media');
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await mkdir(mediaDir, { recursive: true, mode: 0o700 });
  const locks = new Set();
  let healthCache = null, healthTime = 0;
  const assertId = id => { if (!ID.test(id || '')) throw error('存档编号无效。', 404); };
  const readSession = async id => {
    assertId(id);
    try {
      const session = JSON.parse(await readFile(join(sessionDir, `${id}.json`), 'utf8'));
      for (const node of session.nodes) for (const choice of node.choices) { const rule = ACTION_RULES[choice.kind]; if (rule) { choice.cost = rule.cost; choice.xp = rule.xp; } }
      return session;
    }
    catch (e) { throw error(e.code === 'ENOENT' ? '找不到这个存档。' : '存档无法读取，请使用导出的备份恢复。', e.code === 'ENOENT' ? 404 : 500); }
  };
  const save = async session => {
    assertId(session.id); session.updatedAt = new Date().toISOString();
    const path = join(sessionDir, `${session.id}.json`), tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(session), { mode: 0o600 }); await rename(tmp, path); return session;
  };
  const locked = async (id, fn) => {
    if (locks.has(id)) throw error('这一局正在处理上一个操作，请稍候。', 409);
    locks.add(id); try { return await fn(); } finally { locks.delete(id); }
  };
  const revisionCheck = (session, revision) => { if (revision !== session.revision) throw error('存档已更新，请刷新后再行动。', 409); };
  const findNode = (session, id) => { const node = session.nodes.find(n => n.id === id); if (!node) throw error('这幕已经回溯或不存在。', 404); return node; };
  const json = (res, data, status = 200, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data));
  };
  async function localMedia(req, res, filename) {
    if (!/^[a-f0-9-]{36}\.(mp4|webm)$/.test(filename)) throw error('视频文件名无效。', 404);
    const path = join(mediaDir, filename); let info;
    try { info = await stat(path); } catch { throw error('视频文件不存在。', 404); }
    const headers = { 'Content-Type': filename.endsWith('.webm') ? 'video/webm' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!m || (!m[1] && !m[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
      start = m[1] ? Number(m[1]) : Math.max(0, info.size - Number(m[2]));
      end = m[1] && m[2] ? Math.min(Number(m[2]), end) : end;
      if (start >= info.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers); if (req.method === 'HEAD') res.end(); else createReadStream(path, { start, end }).pipe(res);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const address = server.address(), port = address?.port;
      const validHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      if (!validHosts.includes(req.headers.host)) throw error('只允许本机访问这个实验。', 403);
      const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw error('不支持该请求。', 405);
      if (req.method === 'POST' && req.headers.origin && !validHosts.map(h => `http://${h}`).includes(req.headers.origin)) throw error('请从本机实验页面执行操作。', 403);
      if (req.method === 'GET' && path === '/api/health') {
        if (!healthCache || Date.now() - healthTime > 15000) {
          const videoHealth = await video.health(); healthTime = Date.now();
          healthCache = { ok: true, story: story.publicConfig, video: videoHealth };
        }
        json(res, healthCache); return;
      }
      if (req.method === 'GET' && path === '/api/sessions') {
        const files = (await readdir(sessionDir)).filter(f => /^[a-f0-9-]{36}\.json$/.test(f));
        const sessions = [];
        for (const f of files) { try { const s = JSON.parse(await readFile(join(sessionDir, f), 'utf8')); sessions.push({ id: s.id, name: s.preset.name, title: s.nodes.at(-1)?.title, updatedAt: s.updatedAt, revision: s.revision, mode: s.mode }); } catch {} }
        sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); json(res, { sessions: sessions.slice(0, 100) }); return;
      }
      if (req.method === 'POST' && path === '/api/sessions') {
        const input = await readBody(req);
        if (input.mode && !['ai', 'demo'].includes(input.mode)) throw error('请选择 AI 或演示模式。');
        let session = createSession({ ...input, mode: input.mode || 'ai' }, randomUUID());
        if (session.mode === 'ai') {
          const generated = await story.generate(session, null);
          session = applyInitialStory(session, { ...generated, source: 'ai' });
        }
        json(res, { session: await save(session) }, 201); return;
      }
      if (req.method === 'POST' && path === '/api/sessions/import') {
        const input = await readBody(req, 10 * 1024 * 1024);
        const session = validateSession(input.session);
        json(res, { session: await save(session), notice: '剧情和状态已恢复。视频请重新接入，导入内容不会覆盖原存档。' }, 201); return;
      }
      if (['GET', 'HEAD'].includes(req.method) && path === '/api/media') {
        const local = url.searchParams.get('local');
        if (local) { await localMedia(req, res, local); return; }
        const upstream = await video.media({ filename: url.searchParams.get('filename'), subfolder: url.searchParams.get('subfolder') || '', type: 'output' }, { range: req.headers.range });
        if (!upstream.ok && upstream.status !== 416) throw error('视频读取失败，请重新检查 H3 连接。', 502);
        const headers = {}; for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = upstream.headers.get(key); if (value) headers[key] = value; }
        res.writeHead(upstream.status, headers); if (req.method === 'HEAD') { await upstream.body?.cancel(); res.end(); } else if (upstream.body) Readable.fromWeb(upstream.body).pipe(res); else res.end(); return;
      }
      const match = /^\/api\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
      if (match) {
        const [, id, suffix = ''] = match; assertId(id);
        if (req.method === 'GET' && !suffix) { json(res, { session: await readSession(id) }); return; }
        if (req.method === 'GET' && suffix === 'export') {
          json(res, await readSession(id), 200, { 'Content-Disposition': `attachment; filename="system-life-${id}.json"` }); return;
        }
        if (req.method === 'POST' && suffix === 'turn') {
          const body = await readBody(req);
          if (!ID.test(body.requestId || '')) throw error('请为本次行动生成唯一编号。');
          await locked(id, async () => {
            const session = await readSession(id);
            if (session.nodes.some(n => n.requestId === body.requestId)) { json(res, { session }); return; }
            revisionCheck(session, body.revision);
            const resolved = resolveTurn(session, body);
            const generated = session.mode === 'demo' ? demoStory(session, resolved) : await story.generate(session, resolved);
            const next = commitTurn(session, resolved, generated); next.nodes.at(-1).requestId = body.requestId;
            json(res, { session: await save(next) });
          }); return;
        }
        if (req.method === 'POST' && suffix === 'rewind') {
          const body = await readBody(req);
          await locked(id, async () => { const s = await readSession(id); revisionCheck(s, body.revision); json(res, { session: await save(rewindSession(s, body.nodeId)) }); }); return;
        }
        if (req.method === 'POST' && suffix === 'video') {
          const body = await readBody(req, 15 * 1024 * 1024);
          await locked(id, async () => {
            const s = await readSession(id), n = findNode(s, body.nodeId);
            if (['queued', 'running'].includes(n.video.status)) { json(res, { session: s }); return; }
            if (n.video.submissionUnknown) throw error('此镜头的提交结果尚未确认，请先检查 GPU 历史；可以导入已生成的视频。', 409);
            const previousVideo = structuredClone(n.video);
            n.video = { status: 'failed', submissionUnknown: true, error: '已开始提交，结果尚未确认；请检查 GPU 历史或导入视频。' };
            await save(s);
            let job;
            try { job = await video.submit(n.scene, body.referenceImage); }
            catch (e) {
              if (e.submissionUnknown) n.video = { status: 'failed', submissionUnknown: true, error: e.message };
              else n.video = previousVideo;
              await save(s);
              throw e;
            }
            n.video = { status: job.status, taskId: job.taskId, model: job.model }; json(res, { session: await save(s) }, 202);
          }); return;
        }
        if (req.method === 'POST' && suffix === 'video/import') {
          const body = await readBody(req, 30 * 1024 * 1024);
          await locked(id, async () => {
            const s = await readSession(id), n = findNode(s, body.nodeId);
            if (['queued', 'running'].includes(n.video.status)) throw error('这幕的视频仍在生成，完成后再替换。', 409);
            let videoUrl;
            if (typeof body.url === 'string') {
              let u; try { u = new URL(body.url); } catch { throw error('请输入有效的视频地址。'); }
              if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || body.url.length > 4096) throw error('视频地址需要为 http 或 https。');
              videoUrl = u.href;
            } else if (typeof body.data === 'string') {
              const m = /^data:(video\/(?:mp4|webm));base64,([A-Za-z0-9+/=]+)$/.exec(body.data);
              if (!m) throw error('支持 MP4 或 WebM 视频。');
              const bytes = Buffer.from(m[2], 'base64');
              if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw error('视频需在 20 MB 以内。', 413);
              const mp4 = bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp';
              const webm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
              if (!(m[1] === 'video/mp4' ? mp4 : webm)) throw error('视频内容和文件类型不一致。');
              const filename = `${randomUUID()}.${mp4 ? 'mp4' : 'webm'}`;
              await writeFile(join(mediaDir, filename), bytes, { mode: 0o600 }); videoUrl = `/api/media?local=${filename}`;
            } else throw error('请选择视频文件或填写视频地址。');
            n.video = { status: 'completed', url: videoUrl, imported: true }; json(res, { session: await save(s) });
          }); return;
        }
        if (req.method === 'GET' && /^video\/[^/]+$/.test(suffix)) {
          await locked(id, async () => {
            const s = await readSession(id), n = findNode(s, suffix.slice(6));
            if (n.video.taskId && ['queued', 'running'].includes(n.video.status)) {
              const status = await video.status(n.video.taskId);
              n.video = { ...n.video, ...status };
              if (status.file) { n.video.url = `/api/media?${new URLSearchParams(status.file)}`; delete n.video.file; }
              await save(s);
            }
            json(res, { session: s });
          }); return;
        }
        throw error('找不到这个操作。', 404);
      }
      if (['GET', 'HEAD'].includes(req.method) && ['/', '/index.html', '/app.js', '/style.css'].includes(path)) {
        const filename = path === '/' ? 'index.html' : path.slice(1);
        const content = await readFile(join(ROOT, 'public', filename));
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' https: http: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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
  const server = await createApplication({ env });
  server.listen(port, '127.0.0.1', () => console.log(`系统流独立实验已启动：http://127.0.0.1:${port}`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请在实验 .env.local 里修改 SYSTEM_LIFE_PORT。` : '实验服务启动失败。'); process.exitCode = 1; });
}
