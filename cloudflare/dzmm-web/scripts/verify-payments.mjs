import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No sessions, orders, payments or valid Stripe events are created by this probe.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const origin = 'https://xumengchat.top';
const expectedMode = process.env.EXPECTED_PAYMENT_MODE;
const expectedProvider = process.env.EXPECTED_PAYMENT_PROVIDER;
const expectedBilling = process.env.EXPECTED_MODEL_BILLING;
const expectedEnabled = process.env.EXPECTED_PAYMENT_ENABLED;
assert.ok(expectedMode === undefined || expectedMode === 'test' || expectedMode === 'live', 'EXPECTED_PAYMENT_MODE must be test or live');
assert.ok(expectedProvider === undefined || expectedProvider === 'stripe' || expectedProvider === 'zpay', 'EXPECTED_PAYMENT_PROVIDER must be stripe or zpay');
assert.ok(expectedBilling === undefined || expectedBilling === 'true' || expectedBilling === 'false', 'EXPECTED_MODEL_BILLING must be true or false');
assert.ok(expectedEnabled === undefined || expectedEnabled === 'true' || expectedEnabled === 'false', 'EXPECTED_PAYMENT_ENABLED must be true or false');
const reportPath = resolve(root, `output/xumeng/payment-read-only-verification-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
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
    if (resource.endsWith('.js')) assert.ok(body.includes('Stripe 测试模式') && body.includes('实际扣款') && body.includes('/api/backend/v1/payments'));
    pass('deployed-recharge-client-asset', asset, { path: resource });
  }
  const config = await request('/api/backend/v1/payments/config');
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  configuration = await config.json();
  assert.equal(typeof configuration.enabled, 'boolean');
  if (expectedEnabled !== undefined) assert.equal(configuration.enabled, expectedEnabled === 'true', 'Payment activation must match the expected state');
  assert.ok(configuration.mode === 'test' || configuration.mode === 'live');
  assert.equal(configuration.testMode, configuration.mode === 'test');
  if (expectedMode) assert.equal(configuration.mode, expectedMode);
  const provider = configuration.provider ?? 'stripe';
  assert.ok(provider === 'stripe' || provider === 'zpay');
  if (expectedProvider) assert.equal(provider, expectedProvider);
  assert.equal(typeof configuration.modelBillingLinked, 'boolean');
  if (expectedBilling !== undefined) assert.equal(configuration.modelBillingLinked, expectedBilling === 'true');
  const currency = provider === 'zpay' ? 'cny' : 'usd';
  assert.equal(configuration.currency, currency);
  const packageAmounts = provider === 'zpay' ? [2800, 8800, 18800] : [100, 500, 1000];
  assert.deepEqual(configuration.packages.map(({ amountMinor, credits, currency }) => [amountMinor, credits, currency]), packageAmounts.map(amount => [amount, amount, currency]));
  if (provider === 'zpay') {
    assert.equal(configuration.mode, 'live');
    assert.ok(Array.isArray(configuration.methods));
    assert.equal(new Set(configuration.methods.map(item => item.id)).size, configuration.methods.length);
    assert.ok(configuration.methods.every(item => (item.id === 'alipay' && item.label === '支付宝') || (item.id === 'wxpay' && item.label === '微信支付')));
    if (configuration.enabled) assert.ok(configuration.methods.length > 0);
  }
  assert.doesNotMatch(JSON.stringify(configuration), /sk_test_|sk_live_|whsec_/);
  pass('server-fixed-packages-without-secrets', config, { enabled: configuration.enabled, mode: configuration.mode, testMode: configuration.testMode });
  for (const path of ['/api/backend/v1/payments/wallet', '/api/backend/v1/payments/orders/pay_11111111-1111-4111-8111-111111111111',
    ...(provider === 'zpay' ? ['/api/backend/v1/payments/orders/zp_11111111-1111-4111-8111-111111111111',
      '/api/payments/zpay/checkout/zp_11111111-1111-4111-8111-111111111111'] : [])]) {
    const response = await request(path);
    assert.equal(response.status, 401);
    pass('private-payment-data-requires-session', response, { path });
  }
  const checkout = await request('/api/backend/v1/payments/checkout', { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(checkout.status, 403);
  pass('checkout-rejects-foreign-origin-before-order-creation', checkout);
  const method = await request('/api/payments/stripe/webhook');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  pass('webhook-method-is-constrained', method);
  const unsigned = await request('/api/payments/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unsigned.status, 400);
  pass('unsigned-webhook-is-rejected', unsigned);
  const timestamp = Math.floor(Date.now() / 1000);
  const forged = await request('/api/payments/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${'0'.repeat(64)}` }, body: '{}' });
  if (provider === 'stripe' && configuration.enabled) assert.equal(forged.status, 400);
  else assert.ok(forged.status === 400 || forged.status === 503);
  assert.equal(forged.headers.get('set-cookie'), null);
  pass('forged-webhook-cannot-credit-an-account', forged);
  const csrf = await request('/api/backend/v1/payments/webhook', { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(csrf.status, 403);
  pass('generic-proxy-keeps-origin-protection', csrf);
  if (provider === 'zpay') {
    const wrongMethod = await request('/api/payments/zpay/notify', { method: 'POST', body: '' });
    assert.equal(wrongMethod.status, 405);
    pass('zpay-notify-is-GET-only', wrongMethod);
    const unsignedNotify = await request('/api/payments/zpay/notify?trade_status=TRADE_SUCCESS&money=1.00');
    assert.ok(unsignedNotify.status === 400 || (!configuration.enabled && unsignedNotify.status === 503));
    assert.equal(unsignedNotify.headers.get('set-cookie'), null);
    pass('zpay-unsigned-notification-cannot-credit', unsignedNotify);
    const callbackQuery = new URLSearchParams({ pid: 'untrusted', out_trade_no: '1'.repeat(32), money: '1.00',
      trade_no: 'untrusted', trade_status: 'TRADE_SUCCESS', type: 'alipay', sign_type: 'MD5', sign: '0'.repeat(32) });
    const forgedNotify = await request(`/api/payments/zpay/notify?${callbackQuery}`);
    assert.ok(forgedNotify.status === 400 || (!configuration.enabled && forgedNotify.status === 503));
    pass('zpay-forged-notification-cannot-credit', forgedNotify);
    const cleanReturn = await request('/api/payments/zpay/return?untrusted=value');
    assert.equal(cleanReturn.status, 303);
    const destination = new URL(cleanReturn.headers.get('location'));
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname, '/');
    assert.equal(destination.hash, '#recharge');
    assert.equal(destination.search, '');
    assert.equal(cleanReturn.headers.get('referrer-policy'), 'no-referrer');
    pass('zpay-return-cleans-provider-parameters-without-crediting', cleanReturn);
  }
  complete = true;
} finally {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ verifiedAt: new Date().toISOString(), origin, complete, paymentsEnabled: configuration?.enabled ?? null,
    mode: configuration?.mode ?? null, expectedMode: expectedMode ?? null, expectedEnabled: expectedEnabled ?? null,
    provider: configuration?.provider ?? 'stripe', expectedProvider: expectedProvider ?? null,
    stateMutations: 0, checkoutSessionsCreated: 0, stripePaymentsPerformed: 0, checks }, null, 2)}\n`);
  console.log(`${checks.length} production payment checks passed; complete=${complete}; report: ${reportPath}`);
}
