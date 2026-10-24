import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 4096;
const BIND_LIFETIME_MS = 15 * 60 * 1000;
const SAFE_ERROR = '绑定未完成，请重新打开安全绑定页后再试。';
const EXPIRED_ERROR = '安全绑定页已过期，请重新打开。';
const SUCCESS = Object.freeze({
  provider: 'zpay', configured: true, credentialsVerified: true,
  paymentEnablementChanged: false, ordersCreated: 0, paymentsPerformed: 0,
});

export function validateLocalConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'pid') || !Object.hasOwn(value, 'alipayChannelId')
    || typeof value.pid !== 'string' || !/^[A-Za-z0-9]{1,120}$/.test(value.pid)
    || typeof value.alipayChannelId !== 'string' || !/^[1-9]\d{0,29}$/.test(value.alipayChannelId)) {
    throw new Error('Local binding must be initialized with merchant and channel IDs through private stdin.');
  }
  return { pid: value.pid, alipayChannelId: value.alipayChannelId };
}

function readJson(stream, maxBytes, timeoutMs) {
  return new Promise((resolveJson, reject) => {
    let bytes = 0;
    let settled = false;
    const chunks = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', data);
      stream.removeListener('end', end);
      stream.removeListener('error', fail);
      let buffer;
      try {
        if (error) throw error;
        buffer = Buffer.concat(chunks);
        resolveJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
      } catch {
        // Drain an invalid HTTP body without resetting the JSON error response.
        stream.on('error', () => {});
        stream.resume();
        reject(new Error('Request rejected.'));
      } finally {
        buffer?.fill(0);
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
      }
    };
    const data = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) finish(new Error());
      else chunks.push(buffer);
    };
    const end = () => finish();
    const fail = () => finish(new Error());
    const timer = setTimeout(fail, timeoutMs);
    stream.on('data', data);
    stream.once('end', end);
    stream.once('error', fail);
  });
}

/** No shell, credential arguments, files, raw output, or payment enablement. */
export function runPrivateConfiguration(credentials, { signal } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./configure-zpay.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const stop = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* It may already have exited. */ }
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      output = '';
      if (error) { stop(); reject(new Error(SAFE_ERROR)); }
      else resolveResult(result);
    };
    const abort = () => finish(new Error());
    const timer = setTimeout(abort, 90_000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      if (settled) return;
      output += chunk.toString();
      if (Buffer.byteLength(output) > 8192) finish(new Error());
    });
    child.once('error', () => finish(new Error()));
    child.stdin.on('error', () => finish(new Error()));
    child.once('close', code => {
      if (settled) return;
      try {
        const result = JSON.parse(output.trim());
        if (code !== 0 || result?.configured !== true || result.credentialsVerified !== true
          || result.paymentEnablementChanged !== false || result.ordersCreated !== 0 || result.paymentsPerformed !== 0) throw new Error();
        finish(undefined, SUCCESS);
      } catch { finish(new Error()); }
    });
    if (signal?.aborted) abort();
    else child.stdin.end(JSON.stringify({ ...credentials, action: 'configure' }));
  });
}

function renderPage(path, nonce, scriptNonce, state) {
  const initial = state.configured ? '已绑定，可关闭本页' : state.error || '';
  const disabled = state.configured || state.error;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>晴屿 · 安全绑定</title>
<style nonce="${scriptNonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#100d18;color:#f7f2fc;font-family:system-ui,-apple-system,"PingFang SC",sans-serif}main{width:100%;max-width:430px;padding:36px;border:1px solid #302339;border-radius:24px;background:linear-gradient(155deg,#24162b,#17131f);box-shadow:0 24px 90px #0006}.brand{font-size:13px;letter-spacing:3px;color:#f394c0}.mark{display:inline-block;width:11px;height:11px;margin-right:9px;border-radius:4px;background:#f478b6;transform:rotate(45deg)}h1{margin:24px 0 12px;font-size:26px;font-weight:650}p{font-size:14px;line-height:1.8;color:#bfb0c9}label{display:block;margin:28px 0 10px;font-size:14px}input{width:100%;padding:15px 14px;border:1px solid #473249;border-radius:12px;background:#100d18;color:#fff;font-size:16px;outline:none}input:focus{border-color:#f478b6;box-shadow:0 0 0 3px #f478b619}button{width:100%;margin-top:18px;padding:15px;border:0;border-radius:12px;background:#f478b6;color:#241020;font-size:15px;font-weight:650;cursor:pointer}button:disabled{opacity:.5;cursor:default}#status{margin-bottom:0;min-height:24px;color:#f6acd0}.note{font-size:12px;margin-top:22px;color:#9885a4}</style></head><body><main><div class="brand"><span class="mark"></span>晴屿 XUMENG</div><h1>安全绑定收款服务</h1><p>粘贴收到的商户密钥，完成晴屿收款服务的绑定。</p><form autocomplete="off"><label for="key">商户 API 密钥</label><input id="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="256" ${disabled ? 'disabled' : ''}><button ${disabled ? 'disabled' : ''}>安全绑定</button></form><p id="status" role="status" aria-live="polite">${initial}</p><p class="note">密钥不会进入聊天记录或本地文件。确认后，由本机程序验证并保存到晴屿的安全密钥库。此页面仅供本次绑定使用。</p></main>
<script nonce="${scriptNonce}">const form=document.querySelector('form'),input=document.querySelector('#key'),button=document.querySelector('button'),status=document.querySelector('#status');form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;let key=input.value;input.value='';button.disabled=true;input.disabled=true;button.textContent='正在安全绑定…';status.textContent='请稍候';try{const response=await fetch(${JSON.stringify(path)},{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,nonce:${JSON.stringify(nonce)}})});const result=await response.json();status.textContent=response.ok&&result.configured?'已绑定，可关闭本页':result.error||${JSON.stringify(SAFE_ERROR)};}catch{status.textContent=${JSON.stringify(SAFE_ERROR)};}finally{key='';input.value='';button.textContent='安全绑定';}});</script></body></html>`;
}

function headerCount(request, name) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index].toLowerCase() === name) count++;
  return count;
}

/** Importable only for localhost boundary tests; the CLI always uses the private child runner. */
export async function createZpayLocalServer(configuration, { runner = runPrivateConfiguration, lifetimeMs = BIND_LIFETIME_MS, onConfigured } = {}) {
  const values = validateLocalConfiguration(configuration);
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > BIND_LIFETIME_MS) throw new Error('Invalid local binding lifetime.');
  const path = `/bind/${randomBytes(32).toString('hex')}`;
  const nonce = randomBytes(32).toString('hex');
  const scriptNonce = randomBytes(24).toString('base64');
  const expiresAt = Date.now() + lifetimeMs;
  const abortController = new AbortController();
  const state = { configured: false, error: null };
  let consumed = false;
  let origin = '';
  const status = () => ({ configured: state.configured,
    error: state.error || (!consumed && Date.now() >= expiresAt ? EXPIRED_ERROR : null) });
  const headers = {
    'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${scriptNonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  };
  const server = createServer({ maxHeaderSize: 4096 }, async (request, response) => {
    const send = (code, data) => {
      response.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    const reject = (code = 400) => send(code, { configured: false, error: '请求未通过安全验证。' });
    if (request.socket.remoteAddress !== '127.0.0.1' || headerCount(request, 'host') !== 1
      || request.headers.host !== new URL(origin).host || headerCount(request, 'origin') > 1
      || (request.headers.origin !== undefined && request.headers.origin !== origin)) return reject(403);
    if (request.url === `${path}/status` && request.method === 'GET') return send(200, status());
    if (request.url !== path) return reject(404);
    if (request.method === 'GET') {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderPage(path, nonce, scriptNonce, status()));
      return;
    }
    if (request.method !== 'POST') return reject(405);
    if (request.headers.origin !== origin || headerCount(request, 'origin') !== 1) return reject(403);
    if (consumed) return send(409, { configured: state.configured, error: state.configured ? '已绑定，可关闭本页' : SAFE_ERROR });
    if (Date.now() >= expiresAt) return send(410, { configured: false, error: EXPIRED_ERROR });
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')
      || request.headers['content-encoding'] !== undefined
      || (request.headers['content-length'] !== undefined && (!/^\d+$/.test(request.headers['content-length'])
        || Number(request.headers['content-length']) > MAX_BYTES))) return reject(413);
    let payload;
    try { payload = await readJson(request, MAX_BYTES, 5000); }
    catch { return reject(); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 2
      || !Object.hasOwn(payload, 'key') || !Object.hasOwn(payload, 'nonce')
      || typeof payload.key !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(payload.key)
      || typeof payload.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(payload.nonce)
      || !timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(nonce))) return reject(403);
    // Recheck after reading the body: simultaneous valid POSTs may arrive together.
    if (consumed) return send(409, { configured: state.configured, error: SAFE_ERROR });
    if (Date.now() >= expiresAt) return send(410, { configured: false, error: EXPIRED_ERROR });
    consumed = true;
    let key = payload.key;
    payload.key = '';
    try {
      const result = await runner({ ...values, key }, { signal: abortController.signal });
      if (result?.configured !== true || result.credentialsVerified !== true || result.paymentEnablementChanged !== false
        || result.ordersCreated !== 0 || result.paymentsPerformed !== 0) throw new Error();
      state.configured = true;
      try { onConfigured?.(SUCCESS); } catch { /* Never expose callback details. */ }
      send(200, SUCCESS);
    } catch {
      state.error = SAFE_ERROR;
      send(502, status());
    } finally { key = ''; }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', rejectListen); resolveListen(); });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    readyUrl: `${origin}${path}`, statusUrl: `${origin}${path}/status`,
    async close() {
      abortController.abort();
      server.closeAllConnections();
      await new Promise(resolveClose => server.close(resolveClose));
    },
  };
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Initialize this helper through private stdin only.');
  const configuration = validateLocalConfiguration(await readJson(process.stdin, MAX_BYTES, 10_000));
  const local = await createZpayLocalServer(configuration, { onConfigured: result => console.log(JSON.stringify(result)) });
  console.log(JSON.stringify({ readyUrl: local.readyUrl }));
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { void local.close(); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Could not start the private local binding page.'); process.exitCode = 1; process.stdin.destroy(); });
}
