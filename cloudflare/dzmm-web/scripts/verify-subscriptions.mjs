import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Public reads and deliberately invalid requests only. No authentication,
// subscription orders, payment facts, email, or daily credit claims are created.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const origin = 'https://xumengchat.top';
const expected = process.env.EXPECTED_SUBSCRIPTION_ENABLED;
assert.ok(expected === undefined || expected === 'true' || expected === 'false');
const reportPath = resolve(root, `output/xumeng/subscription-read-only-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const checks = [];
let complete = false;
let configuration;
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options });
}
function pass(name, response, details = {}) { checks.push({ name, passed: true, status: response.status, ...details }); }
try {
  const config = await request('/api/backend/v1/subscriptions/config');
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal(config.headers.get('set-cookie'), null);
  configuration = await config.json();
  assert.equal(configuration.provider, 'zpay');
  assert.equal(configuration.mode, 'live');
  assert.equal(configuration.testMode, false);
  assert.equal(configuration.timezone, 'Asia/Shanghai');
  assert.equal(configuration.renewal, 'manual');
  assert.equal(configuration.autoRenew, false);
  assert.equal(configuration.modelBillingLinked, false);
  assert.equal(typeof configuration.enabled, 'boolean');
  if (expected !== undefined) assert.equal(configuration.enabled, expected === 'true');
  assert.ok(Array.isArray(configuration.plans));
  assert.ok(Array.isArray(configuration.methods));
  assert.ok(!configuration.enabled || (configuration.plans.length && configuration.methods.length));
  assert.equal(new Set(configuration.plans.map(plan => plan.id)).size, configuration.plans.length);
  for (const plan of configuration.plans) {
    assert.equal(plan.durationDays, 30);
    assert.equal(plan.maxClaims, 30);
    assert.equal(plan.timezone, 'Asia/Shanghai');
    assert.equal(plan.currency, 'cny');
    for (const name of ['amountMinor', 'dailyCredits', 'revision']) assert.ok(Number.isSafeInteger(plan[name]) && plan[name] > 0);
  }
  assert.doesNotMatch(JSON.stringify(configuration), /ZPAY_KEY|ZPAY_PID|sk_live_|sk_test_|whsec_/);
  pass('subscription-terms-and-readiness-without-secrets', config, { enabled: configuration.enabled, planCount: configuration.plans.length });
  const order = 'sp_11111111-1111-4111-8111-111111111111';
  for (const path of ['/api/backend/v1/subscriptions', `/api/backend/v1/subscriptions/orders/${order}`,
    `/api/payments/zpay/subscription/checkout/${order}`]) {
    const response = await request(path);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    pass('private-subscription-state-requires-account', response, { path });
  }
  for (const endpoint of ['checkout', 'checkin']) {
    const response = await request(`/api/backend/v1/subscriptions/${endpoint}`, { method: 'POST',
      headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    pass('subscription-mutation-rejects-foreign-origin', response, { endpoint });
  }
  const base = '/api/payments/zpay/subscription';
  const method = await request(`${base}/notify`, { method: 'POST', body: '{}' });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET');
  pass('subscription-notify-is-GET-only', method);
  for (const query of ['trade_status=TRADE_SUCCESS&money=28.00', new URLSearchParams({ pid: 'untrusted',
    out_trade_no: '1'.repeat(32), trade_no: 'untrusted', money: '28.00', param: order,
    name: 'untrusted', type: 'alipay', trade_status: 'TRADE_SUCCESS', sign_type: 'MD5', sign: '0'.repeat(32) }).toString()]) {
    const response = await request(`${base}/notify?${query}`);
    assert.ok(response.status === 400 || response.status === 503);
    assert.equal(response.headers.get('set-cookie'), null);
    pass('untrusted-notification-cannot-activate-subscription', response);
  }
  const returned = await request(`${base}/return?untrusted=value`);
  assert.equal(returned.status, 303);
  assert.equal(returned.headers.get('location'), `${origin}/#recharge`);
  assert.equal(returned.headers.get('referrer-policy'), 'no-referrer');
  pass('subscription-return-clears-provider-parameters', returned);
  complete = true;
} finally {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ verifiedAt: new Date().toISOString(), origin, complete,
    subscriptionPurchasesEnabled: configuration?.enabled ?? null, planCount: configuration?.plans?.length ?? null,
    stateMutations: 0, ordersCreated: 0, paymentsPerformed: 0, dailyClaimsCreated: 0, checks }, null, 2)}\n`);
  console.log(`${checks.length} production subscription checks passed; complete=${complete}; report: ${reportPath}`);
}
