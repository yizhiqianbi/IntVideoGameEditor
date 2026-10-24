import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPrivateJson, safeBindingFailure, sanitizeTelegramBindingResult, TelegramBindingError,
  TELEGRAM_INPUT_MAX_BYTES, validateTelegramConfiguration } from './configure-telegram.mjs';

const LIFETIME_MS = 15 * 60 * 1000;
const expired = () => ({ ...safeBindingFailure(new TelegramBindingError('LOCAL_FAILED', 'local')),
  error: '安全绑定页已过期，请重新打开。' });
function headerCount(request, name) {
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === name) count++;
  return count;
}

/** Spawned Token is private stdin only. Raw stdout/stderr never leaves this function. */
export function runPrivateTelegramConfiguration(credentials, { signal, spawnImpl = spawn, timeoutMs = 120_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    let child; let output = ''; let settled = false;
    const stop = () => {
      try { if (process.platform !== 'win32' && child?.pid) process.kill(-child.pid, 'SIGKILL'); else child?.kill('SIGKILL'); } catch {}
    };
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); output = '';
      if (error) { stop(); reject(new TelegramBindingError(signal?.aborted ? 'INTERRUPTED' : 'LOCAL_FAILED', 'local',
        { workerSecrets: 'unknown', webhook: 'unknown' })); } else resolveResult(result);
    };
    const abort = () => finish(new Error()); const timer = setTimeout(abort, timeoutMs);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      child = spawnImpl(process.execPath, [fileURLToPath(new URL('./configure-telegram.mjs', import.meta.url))], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr.resume(); child.stdout.on('data', chunk => {
        if (settled) return; output += chunk.toString(); if (Buffer.byteLength(output) > 8192) finish(new Error());
      });
      child.once('error', () => finish(new Error())); child.stdin.once('error', () => finish(new Error()));
      child.once('close', code => {
        if (settled) return;
        try { const result = sanitizeTelegramBindingResult(JSON.parse(output.trim()));
          if ((code === 0) !== result.configured) throw new Error(); finish(undefined, result); }
        catch { finish(new Error()); }
      });
      child.stdin.end(JSON.stringify(credentials));
    } catch { finish(new Error()); }
  });
}

function renderPage(path, nonce, scriptNonce, status) {
  const disabled = status.consumed || status.expired;
  // Only fixed local strings enter HTML. Bot metadata and provider content are never interpolated.
  const initial = status.expired ? '安全绑定页已过期，请重新打开。' : status.consumed ? '本页已提交，请查看状态或重新打开绑定页。' : '';
  return String.raw`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>晴屿 · Telegram 安全绑定</title><style nonce="${scriptNonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#100d18;color:#f7f2fc;font-family:system-ui,-apple-system,"PingFang SC",sans-serif}main{width:100%;max-width:470px;padding:32px;border:1px solid #302339;border-radius:24px;background:#1b1423}.brand{font-size:13px;color:#f394c0;letter-spacing:2px}h1{font-size:25px;margin:24px 0 12px}p{font-size:14px;line-height:1.8;color:#bfb0c9}label{display:block;margin:22px 0 9px}input{width:100%;padding:14px;border:1px solid #473249;border-radius:10px;background:#100d18;color:#fff;font-size:16px}input:focus{outline:2px solid #f478b6}button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:10px;background:#f478b6;color:#241020;font-size:15px;font-weight:650;cursor:pointer}button:disabled{opacity:.5;cursor:default}.note{font-size:12px;color:#a291ae}#status{white-space:pre-wrap;color:#f6acd0;min-height:24px}</style></head><body><main><div class="brand">晴屿 XUMENG</div><h1>绑定 Telegram 反馈群</h1><p>机器人会收集指定群中对它的 @ 反馈，供后台人工查看和分类。请先把专供晴屿的机器人加入群。</p><form autocomplete="off"><label for="token">Bot Token</label><input id="token" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" required maxlength="222" ${disabled ? 'disabled' : ''}><label for="chat">反馈群</label><input id="chat" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="512" placeholder="负数群 ID、@群名或 t.me 群消息链接" ${disabled ? 'disabled' : ''}><button ${disabled ? 'disabled' : ''}>验证并绑定</button></form><p id="status" role="status" aria-live="polite">${initial}</p><p class="note">Token 仅用于本次验证和设置 Webhook，不进入聊天、日志、本地文件或 Cloudflare。邀请链接不能解析群 ID。本页 15 分钟后过期，每页只可提交一次；现有其他项目的 Webhook 不会被覆盖。</p></main><script nonce="${scriptNonce}">const form=document.querySelector('form'),tokenInput=document.querySelector('#token'),chatInput=document.querySelector('#chat'),button=document.querySelector('button'),status=document.querySelector('#status');form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;let token=tokenInput.value;const chat=chatInput.value;tokenInput.value='';button.disabled=true;tokenInput.disabled=true;chatInput.disabled=true;button.textContent='正在验证并绑定…';try{const response=await fetch(${JSON.stringify(path)},{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,chat,nonce:${JSON.stringify(nonce)}})});const result=await response.json();status.textContent=result.configured?'已绑定 @'+result.botUsername+'，可关闭本页。尚未进行真实消息收集验收。':result.error||'绑定未完成，请重新打开安全绑定页。';if(result.stage&&result.effects)status.textContent+='\n阶段：'+result.stage+'；Worker：'+result.effects.workerSecrets+'；Webhook：'+result.effects.webhook;}catch{status.textContent='绑定状态未确认。请查看本机状态，再重新打开安全绑定页。';}finally{token='';tokenInput.value='';button.textContent='验证并绑定';}});</script></body></html>`;
}

/** Native localhost boundary tests may inject a runner; the CLI always uses private child stdin. */
export async function createTelegramLocalServer({ runner = runPrivateTelegramConfiguration, lifetimeMs = LIFETIME_MS, onResult } = {}) {
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > LIFETIME_MS) throw new Error('Invalid binding lifetime.');
  const path = `/bind/${randomBytes(32).toString('hex')}`, nonce = randomBytes(32).toString('hex'), scriptNonce = randomBytes(24).toString('base64');
  const expiresAt = Date.now() + lifetimeMs, controller = new AbortController();
  let consumed = false; let origin = ''; let result = null;
  const status = () => ({ consumed, expired: Date.now() >= expiresAt, expiresAt, ...(result || {}) });
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${scriptNonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` };
  const server = createServer({ maxHeaderSize: 4096 }, async (request, response) => {
    const send = (code, payload) => { response.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(payload)); };
    const reject = (code = 400) => send(code, { configured: false, error: '请求未通过安全验证。' });
    if (request.socket.remoteAddress !== '127.0.0.1' || headerCount(request, 'host') !== 1 || request.headers.host !== new URL(origin).host
      || headerCount(request, 'origin') > 1 || (request.headers.origin !== undefined && request.headers.origin !== origin)) return reject(403);
    if (request.url === `${path}/status` && request.method === 'GET') return send(200, status());
    if (request.url !== path) return reject(404);
    if (request.method === 'GET') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }); response.end(renderPage(path, nonce, scriptNonce, status())); return; }
    if (request.method !== 'POST') return reject(405);
    if (request.headers.origin !== origin || headerCount(request, 'origin') !== 1) return reject(403);
    if (consumed) return send(409, { configured: result?.configured === true, error: '本页已提交，请查看绑定状态；重新操作请打开新页。' });
    if (Date.now() >= expiresAt) return send(410, expired());
    if (headerCount(request, 'content-type') !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')
      || request.headers['content-encoding'] !== undefined || (request.headers['content-length'] !== undefined
        && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > TELEGRAM_INPUT_MAX_BYTES))) return reject(413);
    let payload, credentials;
    try {
      payload = await readPrivateJson(request, TELEGRAM_INPUT_MAX_BYTES, 5000);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 3
        || typeof payload.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(payload.nonce)
        || !timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(nonce))) return reject(403);
      credentials = validateTelegramConfiguration({ token: payload.token, chat: payload.chat });
    } catch (error) { return send(400, safeBindingFailure(error)); }
    finally { if (payload && typeof payload === 'object') payload.token = ''; }
    // Recheck after body parsing, before consuming the one allowed submission.
    if (consumed) { credentials.token = ''; return send(409, { configured: false, error: '本页已提交。' }); }
    if (Date.now() >= expiresAt) { credentials.token = ''; return send(410, expired()); }
    consumed = true;
    try {
      result = sanitizeTelegramBindingResult(await runner(credentials, { signal: controller.signal }));
      send(result.configured ? 200 : 502, result);
    } catch (error) {
      result = safeBindingFailure(error instanceof TelegramBindingError ? error
        : new TelegramBindingError('LOCAL_FAILED', 'local', { workerSecrets: 'unknown', webhook: 'unknown' }));
      send(502, result);
    } finally {
      credentials.token = '';
      try { onResult?.(result); } catch { /* Never print callback errors. */ }
    }
  });
  server.headersTimeout = 5000; server.requestTimeout = 10_000; server.keepAliveTimeout = 1000; server.maxHeadersCount = 32;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', () => { server.removeListener('error', rejectListen); resolveListen(); }); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const expiryTimer = setTimeout(() => controller.abort(), lifetimeMs); expiryTimer.unref();
  return { readyUrl: `${origin}${path}`, statusUrl: `${origin}${path}/status`, expiresAt,
    async close() { clearTimeout(expiryTimer); controller.abort(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); } };
}

async function main() {
  if (process.argv.length !== 2) throw new Error('No arguments accepted.');
  const local = await createTelegramLocalServer({ onResult: value => console.log(JSON.stringify(value)) });
  console.log(JSON.stringify({ provider: 'telegram', readyUrl: local.readyUrl, statusUrl: local.statusUrl, expiresAt: local.expiresAt }));
  const timer = setTimeout(() => { void local.close(); }, LIFETIME_MS);
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { clearTimeout(timer); void local.close(); });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Could not start the private Telegram binding page.'); process.exitCode = 1; });
