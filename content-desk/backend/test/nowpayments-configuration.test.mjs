import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configureNowpayments } from '../scripts/configure-nowpayments.mjs';

test('NOWPayments credential upload is private and never includes an activation flag, price or wallet', async () => {
  const input = { apiKey: 'isolated_nowpayments_api_key', ipnSecret: 'isolated_nowpayments_signing_secret' };
  let uploaded;
  const receipt = await configureNowpayments(input, async value => { uploaded = value; });
  assert.deepEqual(uploaded, { NOWPAYMENTS_API_KEY: input.apiKey, NOWPAYMENTS_IPN_SECRET: input.ipnSecret });
  assert.equal(receipt.paymentEnablementChanged, false); assert.equal(receipt.credentialValidityVerified, false);
  assert.ok(!JSON.stringify(receipt).includes(input.apiKey)); assert.ok(!JSON.stringify(receipt).includes(input.ipnSecret));
  let calls = 0;
  for (const bad of [null, [], {}, { ...input, enabled: true }, { ...input, apiKey: 'short' }, { ...input, ipnSecret: 'bad\nvalue' }]) {
    await assert.rejects(configureNowpayments(bad, async () => { calls++; }));
  }
  assert.equal(calls, 0);
});
test('credential CLI refuses command arguments and malformed stdin without network or secret output', () => {
  const script = fileURLToPath(new URL('../scripts/configure-nowpayments.mjs', import.meta.url));
  for (const [args, input] of [[['isolated_never_emit_secret'], '{}'], [[], 'no-json'], [[], JSON.stringify({ apiKey: 'isolated_never_emit_secret' })], [[], 'x'.repeat(4097)]]) {
    const result = spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.ok(!result.stderr.includes('isolated_never_emit_secret')); assert.equal(result.stdout, '');
  }
});
