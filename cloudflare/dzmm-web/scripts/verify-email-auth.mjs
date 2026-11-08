import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No emails, sessions, challenges, or account writes are created by this probe.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const origin = 'https://xumengchat.top';
const expectedEnabledValue = process.env.EXPECTED_EMAIL_AUTH_ENABLED;
assert.ok(expectedEnabledValue === undefined || expectedEnabledValue === 'true' || expectedEnabledValue === 'false',
  'EXPECTED_EMAIL_AUTH_ENABLED must be true or false when supplied');
const expectedEnabled = expectedEnabledValue === undefined ? undefined : expectedEnabledValue === 'true';
const reportPath = resolve(root, `output/xumeng/email-auth-read-only-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const checks = [];
let complete = false;
let configuration;
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options });
}
function pass(name, response, details = {}) {
  checks.push({ name, passed: true, status: response.status, ...details });
}
try {
  const home = await request('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<title>叙梦 · 角色与故事｜AI 角色卡与互动故事<\/title>/);
  pass('own-brand-homepage', home);
  for (const resource of [...html.matchAll(/(?:src|href)="(\/assets\/index-[^"]+\.(?:js|css))"/g)].map(match => match[1])) {
    const asset = await request(resource);
    assert.equal(asset.status, 200);
    const body = await asset.text();
    assert.ok(body.length > 100);
    if (resource.endsWith('.js')) {
      assert.ok(body.includes('/api/backend/v1/auth/email') && body.includes('邮箱验证码') && body.includes('密码登录'));
      assert.doesNotMatch(body, /re_[A-Za-z0-9]{30,}/);
    }
    pass('deployed-email-login-client', asset, { path: resource });
  }
  const config = await request('/api/backend/v1/auth/email/config');
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal(config.headers.get('set-cookie'), null);
  configuration = await config.json();
  assert.equal(typeof configuration.enabled, 'boolean');
  if (expectedEnabled !== undefined) assert.equal(configuration.enabled, expectedEnabled, 'Production email auth readiness differs from EXPECTED_EMAIL_AUTH_ENABLED');
  assert.equal(configuration.expiresIn, 600);
  assert.equal(configuration.resendAfter, 60);
  assert.equal(typeof configuration.note, 'string');
  assert.doesNotMatch(JSON.stringify(configuration), /EMAIL_OTP_SECRET|RESEND_API_KEY|re_[A-Za-z0-9]{30,}|codeHash|code_hash/);
  pass('public-readiness-without-secrets', config, { enabled: configuration.enabled });
  for (const path of ['/api/backend/v1/auth/email/request', '/api/backend/v1/auth/email/verify']) {
    const method = await request(path);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('set-cookie'), null);
    pass('code-endpoint-requires-post', method, { path });
    const foreign = await request(path, { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get('set-cookie'), null);
    pass('code-endpoint-rejects-foreign-origin', foreign, { path });
    if (!configuration.enabled) {
      const disabled = await request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(disabled.status, 503);
      assert.equal(disabled.headers.get('set-cookie'), null);
      const body = await disabled.json();
      assert.equal(typeof body.error, 'string');
      assert.equal(body.challengeId, undefined);
      pass('unconfigured-service-cannot-issue-code-or-session', disabled, { path });
    }
  }
  const session = await request('/api/backend/v1/session');
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { user: null, authenticated: false });
  pass('no-account-without-session', session);
  const state = await request('/api/backend/v1/state');
  assert.equal(state.status, 401);
  pass('private-state-requires-session', state);
  complete = true;
} finally {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ verifiedAt: new Date().toISOString(), origin, complete,
    expectedEmailAuthEnabled: expectedEnabled ?? null, emailLoginEnabled: configuration?.enabled ?? null, stateMutations: 0, emailsSent: 0,
    emailDeliveryVerified: false, emailLoginEndToEndVerified: false, checks }, null, 2)}\n`);
  console.log(`${checks.length} production email auth checks passed; complete=${complete}; expectedEmailAuthEnabled=${expectedEnabled ?? 'unspecified'}; report: ${reportPath}`);
}
