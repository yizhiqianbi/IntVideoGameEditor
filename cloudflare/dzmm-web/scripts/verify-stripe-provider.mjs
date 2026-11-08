import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// One-shot test fixture: credentials remain in private stdin/stdout memory,
// never in files or tool output. Capture stdout privately; it contains a session.
const origin = 'https://xumengchat.top';
let fixture;
let stage = 'configuration';
let lastStatus;
async function request(path, body, cookie) {
  stage = path;
  const response = await fetch(`${origin}/api/backend/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  lastStatus = response.status;
  if (!response.ok) throw new Error('Test fixture request failed.');
  return { response, data: await response.json() };
}
async function start() {
  assert.equal(fixture, undefined);
  const { data: config } = await request('payments/config');
  assert.equal(config.enabled, true);
  assert.equal(config.mode, 'test');
  assert.equal(config.testMode, true);
  assert.equal(config.modelBillingLinked, false);
  assert.deepEqual(config.packages.find(item => item.id === 'usd_1'), { id: 'usd_1', amountMinor: 100, currency: 'usd', credits: 100 });
  const { response, data } = await request('auth/register', {
    email: `payment-verify-${randomUUID()}@xumengchat.top`, password: randomBytes(32).toString('hex'), nickname: 'Stripe测试验证',
  });
  assert.equal(data.user.isGuest, false);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.match(cookie ?? '', /^dzmm_session=/);
  fixture = { cookie, accountId: data.user.id, requestId: randomUUID(), startedAt: new Date().toISOString() };
  const { data: wallet } = await request('payments/wallet', undefined, cookie);
  fixture.baseline = wallet.balance;
  assert.equal(wallet.accountId, fixture.accountId);
  const body = { packageId: 'usd_1', accountId: fixture.accountId, requestId: fixture.requestId, mode: 'test' };
  const { data: checkout } = await request('payments/checkout', body, cookie);
  const { data: retry } = await request('payments/checkout', body, cookie);
  assert.equal(checkout.accountId, fixture.accountId);
  assert.equal(checkout.mode, 'test');
  assert.equal(checkout.order.status, 'pending');
  assert.equal(checkout.order.amountMinor, 100);
  assert.equal(checkout.order.currency, 'usd');
  assert.equal(checkout.order.credits, 100);
  assert.equal(retry.order.id, checkout.order.id);
  assert.equal(retry.checkoutUrl, checkout.checkoutUrl);
  const url = new URL(checkout.checkoutUrl);
  assert.equal(url.origin, 'https://checkout.stripe.com');
  assert.equal(url.username + url.password, '');
  const sessionId = url.pathname.match(/cs_test_[A-Za-z0-9]+/)?.[0];
  assert.ok(sessionId);
  fixture.orderId = checkout.order.id;
  fixture.sessionId = sessionId;
  return { phase: 'checkoutReady', accountId: fixture.accountId, orderId: fixture.orderId, sessionId,
    amountMinor: 100, currency: 'usd', credits: 100, baseline: fixture.baseline, idempotentRetry: true, checkoutUrl: checkout.checkoutUrl };
}
async function verify(expectedStatus = 'paid') {
  assert.ok(fixture?.orderId);
  assert.ok(['paid', 'partially_refunded', 'refunded'].includes(expectedStatus));
  const deadline = Date.now() + 60000;
  let result;
  do {
    ({ data: result } = await request(`payments/orders/${fixture.orderId}`, undefined, fixture.cookie));
    if (result.order.status === expectedStatus) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  } while (Date.now() < deadline);
  assert.equal(result.accountId, fixture.accountId);
  assert.equal(result.order.status, expectedStatus);
  assert.ok(result.order.paidAt);
  assert.equal(result.balance, fixture.baseline + result.order.credits - result.order.refundedCredits);
  return { phase: 'verified', verifiedAt: new Date().toISOString(), accountId: fixture.accountId, orderId: fixture.orderId,
    sessionId: fixture.sessionId, status: result.order.status, balance: result.balance, baseline: fixture.baseline,
    credits: result.order.credits, refundedCredits: result.order.refundedCredits, refundedAmountMinor: result.order.refundedAmountMinor };
}
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 16384) throw new Error('Fixture input is too large.');
  }
  const command = JSON.parse(input);
  fixture = command.fixture;
  let output;
  if (command.action === 'start') output = { ...await start(), fixture };
  else if (command.action === 'verify') output = await verify(command.status);
  else if (command.action === 'close') {
    if (fixture) await request('auth/logout', {}, fixture.cookie);
    output = { phase: 'closed', sessionRevoked: Boolean(fixture), auditRecordsPreserved: true };
  } else throw new Error('Unknown fixture action.');
  console.log(JSON.stringify(output));
} catch (error) {
  console.error(JSON.stringify({ failed: true, stage, status: lastStatus, code: error?.code ?? null }));
  process.exitCode = 1;
}
