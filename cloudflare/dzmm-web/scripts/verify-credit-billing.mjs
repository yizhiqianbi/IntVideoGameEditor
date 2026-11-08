import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDzmmBillingConfig } from '../../../src/lib/dzmm-billing-client.ts';

// Public status and rejected unauthenticated operations only. No session,
// provider generation, order, payment or valid accounting mutation is created.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const origin = 'https://xumengchat.top';
const expectedBilling = process.env.EXPECTED_MODEL_BILLING;
assert.ok(expectedBilling === 'true' || expectedBilling === 'false', 'Specify EXPECTED_MODEL_BILLING=true or false.');
const checks = [];
let complete = false;
let configuration;
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options });
}
function pass(name, response, path) { checks.push({ name, status: response.status, passed: true, ...(path ? { path } : {}) }); }
try {
  const response = await request('/api/backend/v1/billing/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  configuration = parseDzmmBillingConfig(await response.json());
  assert.equal(configuration.enabled, expectedBilling === 'true');
  if (process.env.EXPECTED_PRODUCTION_PRICING === 'true') {
    const vars = JSON.parse(await readFile(resolve(root, 'cloudflare/dzmm/wrangler.production.jsonc'), 'utf8')).vars;
    const rates = JSON.parse(vars.CREDIT_BILLING_RATES_JSON);
    assert.equal(configuration.priceRevision, rates.revision);
    assert.equal(configuration.inputCreditsPer1000, rates.inputCreditsPer1000);
    assert.equal(configuration.outputCreditsPer1000, rates.outputCreditsPer1000);
    assert.deepEqual(configuration.costPolicy, JSON.parse(vars.CREDIT_BILLING_COST_POLICY_JSON));
  }
  pass('public-billing-status-and-rules', response);
  const payment = await request('/api/backend/v1/payments/config');
  assert.equal(payment.status, 200);
  assert.equal((await payment.json()).modelBillingLinked, configuration.enabled);
  pass('wallet-billing-status-is-consistent', payment);
  const usage = await request('/api/backend/v1/billing/usage');
  assert.equal(usage.status, 401);
  assert.equal(usage.headers.get('set-cookie'), null);
  pass('consumption-requires-own-session', usage);
  for (const method of ['quote', 'reserve', 'finalize', 'getpending', 'releaseexpired']) {
    const path = `/api/backend/v1/billing/${method}`;
    const response = await request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 404);
    pass('billing-mutations-are-not-public-http', response, path);
  }
  for (const path of ['/api/chat', '/api/dzmm/chat', '/api/memory', '/api/dzmm/memory', '/api/novel-generation']) {
    const response = await request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    pass('all-model-aliases-require-session', response, path);
  }
  complete = true;
} finally {
  const reportPath = resolve(root, `output/xumeng/credit-billing-read-only-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ verifiedAt: new Date().toISOString(), origin, complete,
    expectedBilling: expectedBilling === 'true', enabled: configuration?.enabled ?? null, configuration,
    stateMutations: 0, generationsCreated: 0, paymentsPerformed: 0, checks }, null, 2)}\n`);
  console.log(`${checks.length} production billing checks passed; complete=${complete}; report: ${reportPath}`);
}
