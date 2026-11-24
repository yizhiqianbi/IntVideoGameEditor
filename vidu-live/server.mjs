import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { text, image, referencePayload, generationPayload, signal } from './protocol.mjs';
import { createXumengBridge } from './xumeng-bridge.mjs';

export function createStudio({ initialKey = process.env.VIDU_API_KEY || '', initialRegion = process.env.VIDU_REGION === 'global' ? 'global' : 'cn', request = fetch, Socket = WebSocket } = {}) {
  let key = initialKey, region = initialRegion === 'global' ? 'global' : 'cn';
  const csrf = randomUUID(), clients = new Set(), tasks = new Map();
  let session = null, starting = false, events = [], lastStartError = null;
  const base = () => region === 'cn' ? 'https://api.vidu.cn' : 'https://api.vidu.com';
  function emit(type, data) {
    const event = { id: randomUUID(), type, data, time: Date.now() };
    events.push(event); events = events.slice(-150);
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  function summary() { return session ? { id: session.id, mode: session.mode, control: session.control, status: session.status, startedAt: session.startedAt, reason: session.reason } : null; }
  function send(type, payload = {}) {
    if (!session || session.status === 'ended') throw new Error('请先开始直播或本地演练');
    if (type !== 1 && type !== 5 && session.status !== 'ready') throw new Error('控制通道尚未就绪');
    const frame = signal(session.id, session.connId, ++session.seq, type, payload);
    if (session.mode === 'real') {
      if (session.ws?.readyState !== WebSocket.OPEN) throw new Error('直播控制连接已断开');
      session.ws.send(JSON.stringify(frame));
    }
    return frame;
  }
  function end(reason) {
    if (!session || session.status === 'ended') return;
    try { send(5, { hangup: { hangup_reason: 'user_end' } }); } catch {}
    session.status = 'ended'; session.reason = reason;
    clearTimeout(session.initTimer); clearTimeout(session.readyTimeout);
    session.ws?.close(); emit('session', summary());
  }
  async function api(route, body, credentials = { key, base: base() }) {
    if (!credentials.key) throw new Error('尚未配置 Vidu API Key，请在连接设置中填写');
    const response = await request(credentials.base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Token ${credentials.key}`, 'Content-Type': 'application/json', 'X-Request-ID': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
    const raw = await response.text();
    const diagnostic = 'HTTP '+response.status+'，响应类型 '+(response.headers.get('content-type') || '未提供');
    let result;
    if (!raw.trim()) throw new Error('Vidu 返回空响应（'+diagnostic+'）。无法确认平台是否创建会话，请先查看 Vidu 后台记录，勿连续重试。');
    try { result=JSON.parse(raw); } catch { throw new Error('Vidu 返回非 JSON 内容（'+diagnostic+'）。请检查平台服务状态；本次请求未自动重试。'); }
    if (!result || typeof result!=='object' || Array.isArray(result)) throw new Error('Vidu 返回无效数据（'+diagnostic+'）');
    if (!response.ok) throw new Error(`Vidu ${response.status}: ${String(result.message || result.error?.message || result.reason || '请求失败').slice(0, 500)}`);
    return result;
  }
  async function start(body) {
    if (starting || (session && session.status !== 'ended')) throw new Error('已有会话，请先结束');
    if (!['real', 'rehearsal'].includes(body.mode)) throw new Error('请选择直播模式');
    const avatar = image(body.avatar);
    const control = body.control || 'performance';
    if (!['performance','auto'].includes(control)) throw new Error('请选择表演指令模式');
    const persona = text(body.persona || '你是一位自然、友善的中文主播。', '主播设定', 5000);
    const directedPersona = persona + (control === 'performance' ? '\n收到【表演指令】时，将其作为导演给出的回应方向、情绪和动作。按意图用自己的话自然回应，配合动作；不要朗读指令或解释执行过程。没有给出明确台词时，自行组织简短中文表达。' : '');
    starting = true; lastStartError = null;
    try {
      const credentials = { key, base: base() };
      const result = body.mode === 'real' ? await api('/live/s_avatar/realtime', { model: 'vidu-s2', call_mode: 'video', avatar: { image_uri: avatar, persona: directedPersona, voice: String(body.voice || 'Tina').slice(0, 100) }, action: { enabled: true }, audio: { enable_transcription: true }, enable_recording: true }, credentials) : { live: { id: `rehearsal-${randomUUID()}` } };
      if (!result.live?.id) throw new Error('Vidu 未返回会话 ID');
      const s = session = { id: result.live.id, connId: randomUUID(), seq: 0, mode: body.mode, control, status: 'connecting', startedAt: Date.now(), heartbeat: Date.now(), credentials };
      if (body.mode === 'rehearsal') { s.status = 'ready'; emit('session', summary()); return { session: summary() }; }
      const wsPath = `/live/ws/live/connect?live_id=${encodeURIComponent(s.id)}&conn_id=${s.connId}`;
      const ws = s.ws = new Socket(`${credentials.base.replace('https:', 'wss:')}${wsPath}`, { headers: { Authorization: `Token ${credentials.key}` }, handshakeTimeout: 20000 });
      s.readyTimeout = setTimeout(() => { if (session === s && s.status === 'connecting') end('S2 初始化超时'); }, 60000);
      let attempts = 0;
      const init = () => { if (session === s && s.status === 'connecting') { attempts++; send(1, { conn_init: { version: 1 } }); } };
      ws.on('open', init);
      ws.on('message', raw => {
        if (session !== s || s.status === 'ended') return;
        try {
          const msg = JSON.parse(raw.toString()); const p = msg.payload || {};
          if (msg.type === 2) {
            const ack = p.conn_init_ack;
            if (ack?.success) { clearTimeout(s.readyTimeout); s.status = 'ready'; emit('session', summary()); }
            else if (ack?.error_code === 'NOT_READY' && attempts < 25) { clearTimeout(s.initTimer); s.initTimer = setTimeout(init, 2000); }
            else { emit('error', ack?.error_msg || ack?.error_code || '初始化失败'); end('直播初始化失败'); }
          } else if (msg.type === 6) { end(p.hangup?.hangup_reason || '平台结束直播'); }
          else if (msg.type === 12) emit('reference', p.prompt_operation_ack);
          else if (msg.type === 9 || msg.type === 10) emit('transcript', { role: msg.type === 10 ? '主播' : '语音', text: p.text_msg?.content || '' });
        } catch { emit('error', '收到无法解析的直播消息'); }
      });
      ws.on('error', () => { emit('error', 'Vidu WebSocket 连接失败，请检查 Key、站点和 S2 权限'); if (session === s) end('控制通道错误'); });
      ws.on('close', () => { if (session === s) end('控制通道关闭'); });
      emit('session', summary());
      return { session: summary(), rtc: result.rtc };
    } catch(error) { lastStartError={message:error.message,time:Date.now()}; emit('start_error',lastStartError); throw error; } finally { starting = false; }
  }
  async function jsonBody(req) {
    let size = 0; const parts = [];
    for await (const chunk of req) { size += chunk.length; if (size > 20 * 1024 * 1024) throw new Error('请求体超过 20 MB'); parts.push(chunk); }
    try { return JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { throw new Error('无效 JSON'); }
  }
  const root = path.dirname(fileURLToPath(import.meta.url));
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return reply(403, { error: '仅允许本机访问' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return reply(403, { error: '不允许跨站请求' });
      const url = new URL(req.url, `http://${host}`), route = url.pathname;
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
      if (route === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (route === '/api/status' && req.method === 'GET') return reply(200, { configured: Boolean(key), region, csrf, lastStartError, session: summary(), events, tasks: [...tasks.values()].map(({credentials, ...task}) => task) });
      if (route.startsWith('/api/')) {
        if (req.method !== 'POST') return reply(405, { error: '需要 POST' });
        if (req.headers['x-studio-token'] !== csrf) return reply(403, { error: '本地操作令牌无效，请刷新页面' });
        const body = await jsonBody(req);
        if (route === '/api/config') {
          if (starting || session && session.status !== 'ended') throw new Error('请先结束直播再更改配置');
          if (!['cn','global'].includes(body.region)) throw new Error('站点无效');
          if (body.key) key = text(body.key, 'API Key', 500);
          region = body.region; return reply(200, { configured: Boolean(key), region });
        }
        if (route === '/api/start') return reply(200, await start(body));
        if (route === '/api/stop') { end('已手动结束'); return reply(200, {}); }
        if (route === '/api/heartbeat') { if (session?.id === body.id) session.heartbeat = Date.now(); return reply(200, {}); }
        if (route === '/api/execute') {
          if (!session || session.status !== 'ready' || session.control !== 'performance') throw new Error('请先开启表演指令模式');
          const intent = body.intent ? text(body.intent, '回应方向', 1000) : '';
          const emotion = body.emotion ? text(body.emotion, '情绪', 100) : '';
          const motion = body.motion ? text(body.motion, '动作', 500) : '';
          if (!intent && !emotion && !motion) throw new Error('至少填写回应方向、情绪或动作');
          const content = ['【表演指令】', intent && '回应方向：'+intent, emotion && '情绪：'+emotion, motion && '动作：'+motion, '请理解以上意图，自行组织简短自然的中文表达并表演。不要朗读这些指令。'].filter(Boolean).join('\n');
          send(99, {text_msg:{msg_id:randomUUID(),content,timestamp:Date.now()}});
          emit('direction', {intent,emotion,motion,rehearsal:session.mode==='rehearsal'});
          return reply(200,{sent:true});
        }
        if (route === '/api/danmaku') {
          const content = text(body.text, '弹幕', 500), name = String(body.name || '本地观众').slice(0, 40);
          if (!session || session.status !== 'ready') throw new Error('请先开播');
          send(99, { text_msg: { msg_id: randomUUID(), content: `${name}说：${content}`, timestamp: Date.now() } });
          emit('danmaku', { name, text: content, delivery: session.mode === 'real' ? '已发送至 S2' : '本地演练 · 未调用模型' }); return reply(200, { sent: true });
        }
        if (route === '/api/interrupt') { send(7); return reply(200, {}); }
        if (route === '/api/references') {
          const payload = body.remove ? { prompt_operation: { op_type: 'remove' } } : referencePayload(body.images);
          send(11, payload); emit('reference', { pending: true, message: session.mode === 'real' ? '参考图已提交，等待平台确认' : '本地参考图操作通过 · 未调用模型' }); return reply(200, {});
        }
        if (route === '/api/generate') {
          const spec = generationPayload(body.kind, body.prompt, body.images);
          const credentials = { key, base: base() };
          const result = await api(spec.path, spec.body, credentials);
          if (!result.task_id) throw new Error('平台未返回任务 ID，请在 Vidu 后台检查，不要立即重复提交');
          const task = { id: result.task_id, kind: body.kind, state: result.state || 'created', createdAt: Date.now(), prompt: body.prompt, credentials };
          tasks.set(task.id, task); if (tasks.size > 100) tasks.delete(tasks.keys().next().value);
          const { credentials: _, ...safe } = task; emit('task', safe); return reply(200, safe);
        }
        if (route === '/api/task') {
          const task = tasks.get(body.id); if (!task) throw new Error('任务不存在');
          const result = await api(`/ent/v2/tasks/${encodeURIComponent(task.id)}/creations`, undefined, task.credentials);
          task.state = result.state; task.creations = result.creations || []; task.error = result.err_code || result.error_message;
          const { credentials: _, ...safe } = task; emit('task', safe); return reply(200, safe);
        }
        if (route === '/api/recording') {
          if (!session || session.mode !== 'real') throw new Error('没有可查询的真实直播');
          return reply(200, await api(`/live/v1/lives/${encodeURIComponent(session.id)}/recording`, undefined, session.credentials));
        }
        return reply(404, { error: '接口不存在' });
      }
      const files = { '/': ['public/index.html','text/html'], '/app.js': ['public/app.js','text/javascript'], '/style.css': ['public/style.css','text/css'], '/rtc.js': ['.data/rtc.js','text/javascript'] };
      const file = files[route]; if (!file) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': file[1] }); res.end(await readFile(path.join(root, file[0])));
    } catch (error) { if (!res.headersSent) reply(400, { error: error.message }); else res.end(); }
  });
  const lease = setInterval(() => {
    if (session && session.status !== 'ended' && Date.now() - session.heartbeat > 35000) end('控制台心跳超时');
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 5000); lease.unref();
  server.on('close', () => { clearInterval(lease); end('本地服务已关闭'); });
  return {
    server, end,
    connectionStatus: () => ({ configured: Boolean(key), region }),
    // Each browser lease has isolated sessions, events and tasks. Credentials
    // remain inside this closure and are copied only into another server.
    fork: () => createStudio({ initialKey: key, initialRegion: region, request, Socket }),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const studio = createStudio();
  const bridge = createXumengBridge({
    fork: studio.fork,
    connectionStatus: studio.connectionStatus,
    secret: process.env.XUMENG_LIVE_BRIDGE_SECRET || '',
  });
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '请求地址无效' })); return; }
    if (pathname === '/xumeng-api' || pathname.startsWith('/xumeng-api/')) {
      void bridge.handle(req, res);
    } else studio.server.emit('request', req, res);
  });
  server.on('close', () => { void bridge.close(); studio.server.emit('close'); });
  server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log(`Vidu 本地直播台：http://127.0.0.1:${server.address().port}`));
  for (const event of ['SIGINT','SIGTERM']) process.on(event, () => { studio.end('本地服务退出'); void bridge.close(); server.close(); setTimeout(() => process.exit(0), 700).unref(); });
}
