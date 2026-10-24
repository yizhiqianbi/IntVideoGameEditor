import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

const { handleWaffo, verifyWaffoWebhook, waffoConfiguration } = await tsImport('../src/waffo.ts', import.meta.url);
const NOW = Date.parse('2026-10-14T00:00:00Z');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  APP_ORIGINS: 'https://qingyu.invalid', PAYMENT_PROVIDER: 'waffo', PAYMENTS_ACCEPTING_ENABLED: 'false', WAFFO_ENABLED: 'true',
  WAFFO_ENVIRONMENT: 'sandbox', WAFFO_SANDBOX_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111', WAFFO_API_BASE_URL: 'https://api.waffo.ai/', WAFFO_MERCHANT_ID: 'MER_isolated_merchant_123456',
  WAFFO_PRIVATE_KEY: privateKey, WAFFO_STORE_ID: 'STO_5jP1wkwwsG1S2uDGTEaoG8', WAFFO_PRODUCT_ID: 'PROD_6qtAqxNAbrc7CjIHyy74wP', WAFFO_WEBHOOK_TEST_PUBLIC_KEY: publicKey,
};

function signed(raw, at = NOW) {
  const timestamp = Math.floor(at / 1000);
  const signer = createSign('RSA-SHA256'); signer.update(`${timestamp}.${raw}`); signer.end();
  return `t=${timestamp},v1=${signer.sign(privateKey, 'base64')}`;
}

test('Waffo config remains closed and does not expose credentials or checkout secrets', () => {
  const value = waffoConfiguration(env);
  assert.equal(value.enabled, false); assert.equal(value.collectionEnabled, false); assert.equal(value.mode, 'sandbox');
  assert.equal(value.sandboxAcceptanceEnabled, false);
  assert.equal(value.plan.amountMinor, 2800); assert.equal('privateKey' in value, false); assert.equal(JSON.stringify(value).includes(privateKey), false);
});

test('sandbox acceptance can open only the test mode without opening global collection', () => {
  const value = waffoConfiguration({ ...env, WAFFO_SANDBOX_ACCEPTANCE_ENABLED: 'true' });
  assert.equal(value.enabled, true); assert.equal(value.collectionEnabled, false); assert.equal(value.sandboxAcceptanceEnabled, true); assert.equal(value.mode, 'sandbox');
  assert.equal(waffoConfiguration({ ...env, WAFFO_SANDBOX_ACCEPTANCE_ENABLED: 'true', WAFFO_ENVIRONMENT: 'live' }).enabled, false);
});

test('Waffo webhook verifies raw RSA signature and parses event without granting rights', async () => {
  const raw = JSON.stringify({ id: 'evt_isolated_1', eventType: 'order.completed', data: { orderMerchantExternalId: 'request-1' } });
  const value = await verifyWaffoWebhook(raw, signed(raw), env, NOW);
  assert.equal(value.id, 'evt_isolated_1');
  await assert.rejects(verifyWaffoWebhook(raw, signed(raw, NOW - 46 * 60 * 1000), env, NOW), /过期/);
  await assert.rejects(verifyWaffoWebhook(raw, signed(raw).replace(/v1=.*/, 'v1=bad'), env, NOW), /签名无效/);
});

test('closed Waffo callback bypasses browser Origin checks but remains signature protected', async () => {
  const raw = JSON.stringify({ id: 'evt_isolated_2', eventType: 'order.completed' });
  const response = await handleWaffo(new Request('https://qingyu.invalid/v1/payments/waffo/webhook', {
    method: 'POST', headers: { Origin: 'https://foreign.example', 'x-waffo-signature': signed(raw) }, body: raw,
  }), env, { now: () => NOW });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, processed: false, eventId: 'evt_isolated_2', reason: 'waffo_adapter_not_ready' });
});

test('checkout cannot open while the global collection gate is paused', async () => {
  await assert.rejects(handleWaffo(new Request('https://qingyu.invalid/v1/waffo/checkout', { method: 'POST', body: '{}' }), { ...env, DB: {} }, { now: () => NOW }), /登录状态已失效/);
});
