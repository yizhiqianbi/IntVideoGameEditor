import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const suppliedUrl = process.argv[2];
assert.ok(suppliedUrl, 'Usage: node scripts/verify-production.mjs https://your-worker.workers.dev');
const base = new URL(suppliedUrl).origin;
assert.equal(new URL(base).protocol, 'https:');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const reportPath = join(root, 'output/dzmm/frontend-cloudflare-verification.json');
const credentialsPath = join(tmpdir(), 'dzmm-cloudflare-deployment-ui.json');
const checks = [];
const accounts = [];
function pass(name, evidence = {}) { checks.push({ name, passed: true, ...evidence }); }
async function report() {
  await mkdir(join(root, 'output/dzmm'), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ verifiedAt: new Date().toISOString(), baseUrl: base, checks, syntheticAccountIds: accounts, cleanupCompleted: false }, null, 2) + '\n');
}
class Client {
  cookie = '';
  async request(path, { method = 'GET', body, raw, headers = {} } = {}) {
    const h = new Headers({ Origin: base, ...headers });
    if (this.cookie) h.set('Cookie', this.cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const response = await fetch(new URL(path, base), {
      method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect: 'manual', signal: AbortSignal.timeout(45_000),
    });
    const cookies = response.headers.getSetCookie();
    const session = cookies.find(value => value.startsWith('dzmm_session='));
    if (session) this.cookie = session.split(';')[0];
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, text, headers: response.headers, session };
  }
}
const expect = (result, status) => { assert.equal(result.status, status); return result.data; };
const chatPayload = { character: { name: '连接测试员', description: '帮助验证服务连接。' }, messages: [{ role: 'user', content: '请只回复：已连接。' }], model: 'fast', maxTokens: 128 };
let uploadedPath;
let uploadedRequestPath;
const owner = new Client();
try {
  const page = await fetch(new URL('/', base));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /叙梦/);
  assert.match(html, /\/assets\//);
  pass('frontend-html', { status: page.status });
  const logo = await fetch(new URL('/assets/xumeng/brand/xumeng-mark.svg', base));
  assert.equal(logo.status, 200);
  assert.match(await logo.text(), /<svg/);
  pass('original-xumeng-logo', { status: logo.status });

  const anonymous = new Client();
  const model = expect(await anonymous.request('/api/chat'), 200);
  assert.equal(model.configured, true);
  assert.equal(model.models.balanced, 'qwen/qwen3-30b-a3b-instruct-2507');
  pass('model-config', { models: model.models });
  expect(await anonymous.request('/api/chat', { method: 'POST', body: chatPayload }), 401);
  pass('anonymous-model-blocked');
  expect(await anonymous.request('/api/backend/v1/auth/guest', { method: 'POST', headers: { Origin: 'https://example.invalid' } }), 403);
  expect(await anonymous.request('/api/chat', { method: 'POST', body: chatPayload, headers: { Origin: 'https://example.invalid' } }), 403);
  pass('cross-origin-mutations-blocked');
  const unknown = await anonymous.request('/api/unknown');
  expect(unknown, 404);
  assert.match(unknown.headers.get('content-type'), /application\/json/);
  pass('unknown-api-json-404');

  const guest = await owner.request('/api/backend/v1/auth/guest', { method: 'POST' });
  assert.ok([200, 201].includes(guest.status));
  assert.match(guest.session, /HttpOnly/);
  assert.match(guest.session, /Secure/);
  assert.match(guest.session, /SameSite=Lax/);
  accounts.push(guest.data.user.id);
  await report();
  pass('guest-secure-cookie');
  const before = expect(await owner.request('/api/backend/v1/state'), 200);
  const bytes = await readFile(join(root, 'public/dzmm/covers/2999180.webp'));
  const upload = expect(await owner.request('/api/backend/v1/media', { method: 'POST', raw: bytes, headers: { 'Content-Type': 'image/webp' } }), 201);
  assert.ok(upload.url.startsWith('/api/dzmm/backend/v1/media/'));
  uploadedPath = upload.url;
  // Persist the returned legacy URL unchanged; exercise the new gateway alias only for requests.
  uploadedRequestPath = uploadedPath.replace(/^\/api\/dzmm\/backend(?=\/)/, "/api/backend");
  const image = await fetch(new URL(uploadedRequestPath, base), { headers: { Cookie: owner.cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(image.headers.get('content-security-policy'));
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  pass('r2-upload-download-exact', { bytes: bytes.length });

  const other = new Client();
  const second = await other.request('/api/backend/v1/auth/guest', { method: 'POST' });
  assert.ok([200, 201].includes(second.status));
  accounts.push(second.data.user.id);
  await report();
  expect(await other.request(uploadedRequestPath), 404);
  expect(await other.request(uploadedRequestPath, { method: 'DELETE' }), 404);
  pass('r2-other-account-isolation');

  const character = { id: `deployment-${randomUUID()}`, name: '云端连接测试员', author: '部署验证', cover: uploadedPath, tags: ['一般向'], description: '成年书店店员，帮助验证云端保存。', personality: '简洁、友善。', scenario: '一家安静的书店。', firstMessage: '云端已经准备好了。' };
  const state = structuredClone(before.state);
  state.custom.push(character);
  state.favorites.push('2999180');
  state.preferences.nickname = '部署验证';
  const saved = expect(await owner.request('/api/backend/v1/state', { method: 'PUT', body: { state, version: before.version, accountId: before.user.id } }), 200);
  expect(await owner.request('/api/backend/v1/state', { method: 'PUT', body: { state, version: before.version, accountId: before.user.id } }), 409);
  const reloaded = expect(await owner.request('/api/backend/v1/state'), 200);
  assert.ok(reloaded.state.custom.some(card => card.id === character.id && card.cover === uploadedPath));
  assert.ok(reloaded.state.favorites.includes('2999180'));
  assert.ok(reloaded.version >= saved.version);
  pass('d1-save-reload-and-version-conflict');

  const email = `dzmm-deploy-${randomUUID()}@example.invalid`;
  const password = `Dzmm-${randomBytes(18).toString('base64url')}-2026!`;
  const registered = await owner.request('/api/backend/v1/auth/register', { method: 'POST', body: { email, password, nickname: '部署验证' } });
  assert.ok([200, 201].includes(registered.status));
  assert.equal(registered.data.user.id, before.user.id);
  const login = new Client();
  const loggedIn = expect(await login.request('/api/backend/v1/auth/login', { method: 'POST', body: { email, password } }), 200);
  assert.equal(loggedIn.user.id, before.user.id);
  const restored = expect(await login.request('/api/backend/v1/state'), 200);
  assert.ok(restored.state.custom.some(card => card.id === character.id));
  assert.ok(restored.state.favorites.includes('2999180'));
  pass('registration-login-restores-account-records');
  expect(await login.request('/api/chat', { method: 'POST', body: { ...chatPayload, maxTokens: 1 } }), 400);
  pass('authenticated-chat-input-validation');
  await writeFile(credentialsPath, JSON.stringify({ baseUrl: base, email, password, userId: before.user.id, characterId: character.id, mediaPath: uploadedPath }), { mode: 0o600 });
  expect(await other.request('/api/backend/v1/auth/logout', { method: 'POST' }), 200);
  expect(await login.request('/api/backend/v1/auth/logout', { method: 'POST' }), 200);
  pass('logout');
  await report();
  console.log(JSON.stringify({ success: true, checks: checks.length, reportPath, uiCredentialsPrepared: true, syntheticAccounts: accounts.length }));
} catch (error) {
  await report();
  if (uploadedPath) {
    try { await owner.request(uploadedRequestPath, { method: 'DELETE' }); } catch { /* Cleanup may need another attempt. */ }
  }
  throw error;
}
