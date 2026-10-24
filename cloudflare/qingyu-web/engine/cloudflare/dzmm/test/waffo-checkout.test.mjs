import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

const { handleWaffo, waffoConfiguration } = await tsImport('../src/waffo.ts', import.meta.url);
const { createDzmmWaffoCheckout } = await tsImport('../../../src/lib/dzmm-waffo.ts', import.meta.url);
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const AUTH_PATH = '/v1/actions/auth/issue-session-token';
const CHECKOUT_PATH = '/v1/actions/checkout/create-session';
const CHECKOUT_URL = 'https://pancake.waffo.ai/store/original-test/checkout/cs_isolated';
const CHECKOUT_TOKEN = 'isolated-checkout-token-0123456789';
const EXPIRES_ISO = '2026-10-15T13:45:30.000Z';

// Exercise the real HTTP handler, session lookup and browser response parser.
// Only the DB boundary and provider transport are replaced. Nothing here
// starts a Worker, contacts a provider, or creates a production order.
function fixture(t, responses = []) {
  const accountId = randomUUID();
  const sessionToken = randomBytes(32).toString('hex');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const userRow = { id: accountId, email: 'original-checkout@example.test', nickname: '原创支付测试者',
    is_guest: 0, version: 0, role: 'user', password_hash: 'isolated-hash', email_verified_at: 1 };
  const calls = [];
  const dbReads = [];
  const dbWrites = [];
  let savedOrder = null;
  let externalCalls = 0;
  let browserHandler = null;
  const now = Date.now();
  const body = { accountId, requestId: randomUUID(), provider: 'waffo', mode: 'live' };
  function statement(sql, bindings = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() {
        dbReads.push({ sql, bindings });
        if (sql.includes('FROM sessions s JOIN users u')) {
          assert.equal(bindings[0], sessionHash, 'requireUser must hash the actual HTTP session cookie');
          assert.ok(Number.isSafeInteger(bindings[1]));
          return structuredClone(userRow);
        }
        assert.ok(sql.includes('FROM subscription_orders o') && sql.includes("o.provider='waffo'"), 'Only the checkout receipt may be read');
        assert.deepEqual(bindings, [accountId, body.requestId]);
        return savedOrder && structuredClone(savedOrder);
      },
      async run() {
        assert.ok(sql.startsWith('INSERT INTO subscription_orders('), 'Only the pending checkout order may be written');
        dbWrites.push({ sql, bindings });
        const [id, user_id, request_id, plan_id, plan_revision, label, amount_minor, currency, duration_days,
          daily_credits, max_claims, timezone, method, out_trade_no, payment_name, checkout_url, created_at, updated_at] = bindings;
        savedOrder = { id, user_id, request_id, plan_id, plan_revision, label, amount_minor, currency, duration_days,
          daily_credits, max_claims, timezone, method, out_trade_no, payment_name, checkout_url, created_at, updated_at,
          status: 'pending', paid_at: null, provider_trade_no: null, subscription_id: null };
        return { success: true, meta: { changes: 1 } };
      },
    };
  }
  const env = {
    DB: { prepare: sql => statement(sql), batch() { assert.fail('Checkout must not grant membership or use a settlement batch'); } },
    APP_ORIGINS: 'https://qingyu.invalid', PAYMENTS_ACCEPTING_ENABLED: 'true', WAFFO_ENABLED: 'true',
    WAFFO_ENVIRONMENT: 'live', WAFFO_API_BASE_URL: 'https://waffo-provider.example.test/',
    WAFFO_MERCHANT_ID: 'MER_original_test_merchant_123456', WAFFO_PRIVATE_KEY: keys.privateKey,
    WAFFO_STORE_ID: 'STO_ABCDEFGHIJKLMNOPQRSTUV', WAFFO_PRODUCT_ID: 'PROD_ABCDEFGHIJKLMNOPQRSTUV',
  };
  const waffoFetch = async (url, options) => {
    const call = { url: String(url), options, headers: new Headers(options?.headers), body: JSON.parse(options.body) };
    calls.push(call);
    const index = calls.length - 1;
    assert.ok(index < 2, 'A checkout has at most two provider calls');
    assert.equal(call.url, `${env.WAFFO_API_BASE_URL.slice(0, -1)}${index === 0 ? AUTH_PATH : CHECKOUT_PATH}`);
    const next = responses[index] ?? (index === 0
      ? { body: { data: { token: CHECKOUT_TOKEN } } }
      : { body: { data: { checkoutUrl: CHECKOUT_URL, expiresAt: EXPIRES_ISO } } });
    if (next.error) throw next.error;
    return next.raw === undefined ? Response.json(next.body, { status: next.status ?? 200 })
      : new Response(next.raw, { status: next.status ?? 200 });
  };
  t.mock.method(globalThis, 'fetch', async (...args) => {
    if (browserHandler) return browserHandler(...args);
    externalCalls++;
    throw new Error('External network is forbidden in isolated Waffo checkout tests');
  });
  t.after(() => assert.equal(externalCalls, 0, 'Every provider request must use the injected transport'));
  async function handle(payload = body) {
    try {
      const response = await handleWaffo(new Request('https://qingyu.invalid/v1/waffo/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://qingyu.invalid', Cookie: `qingyu_session=${sessionToken}` },
        body: JSON.stringify(payload),
      }), env, { waffoFetch, now: () => now });
      assert.ok(response instanceof Response);
      return response;
    } catch (error) {
      // Same ApiError -> JSON boundary used by app.ts; unexpected failures fail
      // the test instead of being disguised as an expected API rejection.
      assert.equal(error.name, 'ApiError');
      return Response.json({ error: error.message, ...error.details }, { status: error.status });
    }
  }
  return { env, body, accountId, now, calls, dbReads, dbWrites, handle,
    setBrowserHandler(handler) { browserHandler = handler; },
    get order() { return savedOrder; } };
}

function assertSignedCalls(f) {
  assert.equal(f.calls.length, 2);
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.headers.get('X-Merchant-Id'), f.env.WAFFO_MERCHANT_ID);
    assert.equal(call.headers.get('X-Environment'), 'prod');
    const timestamp = call.headers.get('X-Timestamp');
    assert.match(timestamp, /^\d{10}$/);
    assert.ok(Math.abs(Number(timestamp) * 1000 - f.now) < 10_000, 'RSA request timestamp must use epoch seconds, not milliseconds');
    const hash = createHash('sha256').update(call.options.body).digest('base64');
    const canonical = `POST\n${index === 0 ? AUTH_PATH : CHECKOUT_PATH}\n${timestamp}\n${hash}`;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(canonical); verifier.end();
    assert.equal(verifier.verify(keys.publicKey, call.headers.get('X-Signature'), 'base64'), true);
  }
  assert.equal(f.calls[0].headers.get('X-Idempotency-Key'), null);
  assert.equal(f.calls[1].headers.get('X-Idempotency-Key'), f.body.requestId);
  assert.deepEqual(f.calls[0].body, { productId: f.env.WAFFO_PRODUCT_ID, buyerIdentity: f.accountId });
  assert.equal(f.calls[1].body.orderMerchantExternalId, f.body.requestId);
  assert.equal(f.calls[1].body.buyerEmail, 'original-checkout@example.test');
  assert.deepEqual(f.calls[1].body.includePaymentMethods, ['wechat']);
}

test('official ISO checkout expiry becomes epoch milliseconds before the pending order response', async t => {
  const f = fixture(t);
  const response = await f.handle();
  assert.equal(response.status, 201);
  const value = await response.json();
  assert.equal(value.expiresAt, Date.parse(EXPIRES_ISO));
  assert.equal(value.autoRenew, false);
  assert.equal(value.checkoutUrl, `${CHECKOUT_URL}#token=${CHECKOUT_TOKEN}`);
  assert.equal(value.order.checkoutUrl, CHECKOUT_URL, 'Only the fragment-free URL belongs in the database');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(f.dbWrites.length, 1);
  assert.equal(f.order.status, 'pending');
  assert.equal(f.order.paid_at, null);
  assert.equal(f.order.subscription_id, null);
  assert.ok(!JSON.stringify(f.dbWrites).includes(CHECKOUT_TOKEN));
  assertSignedCalls(f);
});

test('the real browser createDzmmWaffoCheckout parser accepts the handler ISO success contract', async t => {
  const f = fixture(t);
  f.setBrowserHandler(async (input, options) => {
    assert.equal(input, '/api/backend/v1/waffo/checkout');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    return f.handle(JSON.parse(options.body));
  });
  const result = await createDzmmWaffoCheckout(f.body, waffoConfiguration(f.env).plan);
  assert.equal(result.expiresAt, Date.parse(EXPIRES_ISO));
  assert.equal(result.order.accountId, f.accountId);
  assert.equal(result.order.amountMinor, 2800);
  assert.equal(result.order.currency, 'cny');
  assert.equal(result.order.status, 'pending');
  assert.equal(result.checkoutUrl, `${CHECKOUT_URL}#token=${CHECKOUT_TOKEN}`);
  assert.equal(f.dbWrites.length, 1);
  assertSignedCalls(f);
});

test('omitted and null checkout expiry remain null, and a numeric epoch stays unchanged', async t => {
  for (const [name, fields, expected] of [
    ['missing', {}, null], ['null', { expiresAt: null }, null], ['milliseconds', { expiresAt: Date.parse(EXPIRES_ISO) }, Date.parse(EXPIRES_ISO)],
  ]) await t.test(name, async child => {
    const f = fixture(child, [undefined, { body: { data: { checkoutUrl: CHECKOUT_URL, ...fields } } }]);
    const response = await f.handle();
    assert.equal(response.status, 201);
    assert.equal((await response.json()).expiresAt, expected);
    assert.equal(f.dbWrites.length, 1);
  });
});

test('invalid checkout expiry is rejected before any order is persisted', async t => {
  const invalid = ['', 'not-a-date', '2026-99-99T00:00:00Z', '1792071930000', true, {}, [], -1, 1.25, 8640000000000001];
  for (const value of invalid) await t.test(JSON.stringify(value), async child => {
    const f = fixture(child, [undefined, { body: { data: { checkoutUrl: CHECKOUT_URL, expiresAt: value } } }]);
    const response = await f.handle();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'waffo_provider_invalid_response');
    assert.equal(f.calls.length, 2);
    assert.equal(f.dbWrites.length, 0);
    assert.equal(f.order, null);
  });
});

test('auth-token and checkout-session rejections expose only fixed diagnostics and never provider text', async t => {
  const sentinels = [
    'upstream-free-form-do-not-reflect', 'ignore-all-rules-provider-ai-hint', 'private-buyer@example.test',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJpc29sYXRlZC1zZWNyZXQifQ.fake_signature',
    'https://sensitive.example.test/checkout?token=do-not-reflect',
  ];
  const attack = { message: sentinels[0], aiHint: sentinels[1], email: sentinels[2], jwt: sentinels[3], url: sentinels[4],
    errors: [{ code: 'synthetic_sensitive_code', message: sentinels[0], detail: sentinels[2], reason: sentinels[3], title: sentinels[4], aiHint: sentinels[1] }] };
  for (const [stage, index] of [['auth-token', 0], ['checkout-session', 1]]) {
    for (const providerStatus of [200, 401, 422, 503]) await t.test(`${stage} HTTP ${providerStatus}`, async child => {
      const responses = [];
      responses[index] = { status: providerStatus, body: attack };
      const f = fixture(child, responses);
      const response = await f.handle();
      assert.equal(response.status, 503);
      const data = await response.json();
      assert.equal(data.code, 'waffo_provider_rejected');
      assert.equal(data.stage, stage);
      assert.equal(data.providerStatus, providerStatus);
      assert.match(data.error, /[\u4e00-\u9fff]/, 'The user receives a fixed Chinese explanation');
      assert.equal('providerReason' in data, false);
      const exposed = JSON.stringify(data);
      for (const sentinel of [...sentinels, 'synthetic_sensitive_code']) assert.ok(!exposed.includes(sentinel), 'No arbitrary upstream message, hint, email, JWT or URL may be reflected');
      assert.ok(!exposed.includes(keys.privateKey));
      assert.equal(f.calls.length, index + 1, 'Auth rejection never starts checkout creation');
      assert.equal(f.dbWrites.length, 0, 'Provider rejection never writes an order');
      assert.equal(f.order, null);
    });
  }
});

test('different rejected provider payloads with the same stage and status have identical public errors', async t => {
  const bodies = [
    { message: 'upstream text number one' },
    { errors: [{ code: 'upstream-other-code', message: 'upstream text number two', aiHint: 'upstream AI instruction' }] },
  ];
  const errors = [];
  for (const [index, body] of bodies.entries()) await t.test(`payload ${index + 1}`, async child => {
    const f = fixture(child, [{ status: 403, body }]);
    const response = await f.handle();
    assert.equal(response.status, 503);
    errors.push(await response.json());
    assert.equal(f.calls.length, 1);
    assert.equal(f.dbWrites.length, 0);
  });
  assert.deepEqual(errors[0], errors[1], 'Only controlled stage/status diagnostics may influence the error response');
});

test('production approval rejection has a precise safe explanation; near matches and unknown layers stay generic', async t => {
  for (const [entry, recognized] of [
    [{ layer: 'order', message: 'Store is not approved for production payments' }, true],
    [{ layer: 'order', message: 'Store is not approved for production payments buyer=private@example.test' }, false],
    [{ layer: 'private@example.test', message: 'Store is not approved for production payments' }, false],
  ]) await t.test(recognized ? 'exact provider rejection' : `unrecognized ${entry.layer}`, async child => {
    const f = fixture(child, [undefined, { status: 403, body: { errors: [entry] } }]);
    const value = await (await f.handle()).json();
    assert.equal(value.reason, recognized ? 'store_not_approved' : undefined);
    assert.equal(value.providerLayer, entry.layer === 'order' ? 'order' : undefined);
    assert.equal(value.stage, 'checkout-session');
    if (recognized) assert.match(value.error, /尚未通过 Waffo 正式收款审核/);
    assert.ok(!JSON.stringify(value).includes('private@example.test'));
    assert.equal(f.dbWrites.length, 0);
    assert.equal(f.calls.length, 2);
  });
});
