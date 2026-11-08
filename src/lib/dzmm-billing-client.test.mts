import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import billingModule from "./dzmm-billing-client";
const { DzmmBillingError, parseDzmmBillingConfig, parseDzmmBillingUsage, fetchDzmmBillingConfig, fetchDzmmBillingUsage } = billingModule as typeof import("./dzmm-billing-client");

const accountId = "registered-account";
const uuid = "11111111-1111-4111-8111-111111111111";
const now = Date.UTC(2026, 9, 5, 2);
const config = () => ({ enabled: true, priceRevision: 2, inputCreditsPer1000: 7, outputCreditsPer1000: 19,
  memoryBilled: true, tokenUnit: 1000, rounding: "ceil_combined", outputIncludesReasoning: true,
  failureRule: "no_valid_output_refund", cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
const item = () => ({ id: `usage_${uuid}`, accountId, requestId: uuid, operation: "chat", model: "x-ai/grok-4.6",
  priceRevision: 2, inputCreditsPer1000: 7, outputCreditsPer1000: 19, status: "settled", reservedCredits: 30,
  chargedCredits: 20, returnedCredits: 10, hasValidOutput: true, promptTokens: 1000, completionTokens: 600,
  usageExceedsReservation: false, outcome: "completed", releaseReason: null, createdAt: now, expiresAt: now + 600000, finalizedAt: now + 10000 });
const overview = () => ({ accountId, availableBalance: 300, reservedCredits: 0, totalSpent: 20, debtCredits: 0,
  items: [item()], nextCursor: null });
const errorStatus = (expected: number) => (failure: unknown) => failure instanceof DzmmBillingError && failure.status === expected;
function respond(t: TestContext, value: unknown, status = 200) {
  return t.mock.method(globalThis, "fetch", async () => Response.json(value, { status }));
}

test("billing config uses supplied prices and preserves a disabled configuration with no business defaults", () => {
  const enabled = parseDzmmBillingConfig(config());
  assert.equal(enabled.inputCreditsPer1000, 7); assert.equal(enabled.outputCreditsPer1000, 19);
  const disabled = { ...config(), enabled: false, priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false };
  assert.deepEqual(parseDzmmBillingConfig(disabled), disabled);
});

test("billing config rejects unsupported accounting rules, incoherent disabled prices and excessive precision rates", () => {
  for (const fields of [{ enabled: "true" }, { priceRevision: 0 }, { priceRevision: 1_000_001 }, { priceRevision: null }, { inputCreditsPer1000: 0 },
    { inputCreditsPer1000: 1.1234567 }, { outputCreditsPer1000: 1_000_001 }, { outputCreditsPer1000: Number.NaN },
    { enabled: false }, { tokenUnit: 100 }, { rounding: "floor" }, { outputIncludesReasoning: false },
    { memoryBilled: 1 }, { failureRule: "always_bill" }, { cancellationRule: "always_refund" },
    { missingUsageRule: "estimate" }, { reservationTtlMs: 900000 }, { key: "must-not-enter-client-state" }]) {
    assert.throws(() => parseDzmmBillingConfig({ ...config(), ...fields }), errorStatus(502));
  }
});

test("billing usage validates the account and preserves its server balance without recalc or sorting", () => {
  const body = { ...overview(), availableBalance: 391, reservedCredits: 21, debtCredits: 9,
    items: [item(), { ...item(), id: "usage_22222222-2222-4222-8222-222222222222", requestId: "22222222-2222-4222-8222-222222222222", operation: "memory", createdAt: now - 1000 }] };
  const parsed = parseDzmmBillingUsage(body, accountId);
  assert.equal(parsed.availableBalance, 391); assert.equal(parsed.reservedCredits, 21); assert.equal(parsed.debtCredits, 9);
  assert.deepEqual(parsed.items.map(entry => entry.id), body.items.map(entry => entry.id));
  assert.throws(() => parseDzmmBillingUsage(body, "another-account"), errorStatus(409));
  assert.throws(() => parseDzmmBillingUsage({ ...body, items: [{ ...item(), accountId: "another-account" }] }, accountId), errorStatus(502));
});

test("billing usage never accepts provider credentials, source fingerprints or generation identifiers", () => {
  for (const field of ["claimToken", "fingerprint", "generationId", "apiKey", "prompt"]) {
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), [field]: "secret" }, accountId), errorStatus(502));
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [{ ...item(), [field]: "secret" }] }, accountId), errorStatus(502));
  }
});

test("reserved and pending records keep unknown tokens and zero final charges", () => {
  for (const status of ["reserved", "pending"]) {
    const entry = { ...item(), status, promptTokens: null, completionTokens: null, chargedCredits: 0,
      returnedCredits: 0, finalizedAt: null, outcome: null, hasValidOutput: status === "pending" };
    assert.equal(parseDzmmBillingUsage({ ...overview(), items: [entry] }, accountId).items[0].status, status);
    for (const fields of [{ chargedCredits: 1 }, { returnedCredits: 1 }, { finalizedAt: now + 1000 }]) {
      assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [{ ...entry, ...fields }] }, accountId), errorStatus(502));
    }
  }
});

test("final records must account for the complete reservation, and released records never charge", () => {
  const released = { ...item(), status: "released", chargedCredits: 0, returnedCredits: 30,
    promptTokens: null, completionTokens: null, outcome: "expired", releaseReason: "usage_timeout" };
  assert.equal(parseDzmmBillingUsage({ ...overview(), items: [released] }, accountId).items[0].chargedCredits, 0);
  for (const fields of [{ chargedCredits: 31, returnedCredits: 0 }, { chargedCredits: 20, returnedCredits: 9 },
    { finalizedAt: null }, { status: "released", chargedCredits: 20, returnedCredits: 10 }]) {
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [{ ...item(), ...fields }] }, accountId), errorStatus(502));
  }
});

test("cancelled valid output and usage above the reserve remain bounded at the reserved credit", () => {
  const entry = { ...item(), outcome: "cancelled", chargedCredits: 30, returnedCredits: 0, usageExceedsReservation: true };
  const parsed = parseDzmmBillingUsage({ ...overview(), items: [entry] }, accountId).items[0];
  assert.equal(parsed.outcome, "cancelled"); assert.equal(parsed.chargedCredits, parsed.reservedCredits);
});

test("billing records reject partial token data, unsafe numbers, bad IDs and inconsistent timestamps", () => {
  for (const fields of [{ promptTokens: null }, { completionTokens: null }, { promptTokens: -1 }, { completionTokens: 1_000_000_001 },
    { priceRevision: 0 }, { inputCreditsPer1000: 1.1234567 }, { outputCreditsPer1000: 0 }, { id: "usage_wrong" },
    { requestId: "wrong" }, { operation: "refund" }, { model: "bad model" }, { status: "unknown" },
    { outcome: "lost" }, { releaseReason: "user_closed" }, { hasValidOutput: 1 }, { usageExceedsReservation: null },
    { createdAt: now + 20000 }, { expiresAt: now }, { finalizedAt: now - 1 }, { reservedCredits: 1_000_000_001 }]) {
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [{ ...item(), ...fields }] }, accountId), errorStatus(502));
  }
  for (const fields of [{ availableBalance: -1 }, { reservedCredits: Number.MAX_SAFE_INTEGER + 1 }, { totalSpent: 0.1 },
    { debtCredits: -1 }, { nextCursor: "" }, { nextCursor: "a".repeat(1001) }, { items: [item(), item()] }]) {
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), ...fields }, accountId), errorStatus(502));
  }
});

const costPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
test("actual-cost configuration and receipts preserve frozen pricing and six-decimal reference rates", () => {
  const body = { ...config(), inputCreditsPer1000: 4.022753, outputCreditsPer1000: 12.068258, costPolicy };
  assert.deepEqual(parseDzmmBillingConfig(body), body);
  const entry = { ...item(), inputCreditsPer1000: 4.022753, outputCreditsPer1000: 12.068258, costPolicy, providerCostUsd: 0.0096 };
  assert.deepEqual(parseDzmmBillingUsage({ ...overview(), items: [entry] }, accountId).items[0], entry);
  assert.equal(parseDzmmBillingUsage({ ...overview(), items: [{ ...entry, providerCostUsd: 0 }] }, accountId).items[0].providerCostUsd, 0);
});

test("client rejects malformed cost rules and costs without substituting default prices", () => {
  for (const value of [null, { ...costPolicy, multiplier: 2 }, { ...costPolicy, usdToCny: -1 }, { ...costPolicy, unknown: "secret" }]) {
    assert.throws(() => parseDzmmBillingConfig({ ...config(), costPolicy: value }), errorStatus(502));
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [{ ...item(), costPolicy: value }] }, accountId), errorStatus(502));
  }
  for (const value of [null, "0.0096", -1, Number.NaN, Number.POSITIVE_INFINITY, 0.0000000000001]) {
    assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [{ ...item(), costPolicy, providerCostUsd: value }] }, accountId), errorStatus(502));
  }
  const disabled = { ...config(), enabled: false, priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, costPolicy };
  assert.throws(() => parseDzmmBillingConfig(disabled), errorStatus(502));
});

test("billing pagination request is same-origin authenticated, bounded, encoded and read only", async t => {
  const mock = respond(t, { ...overview(), nextCursor: "opaque-next" });
  assert.equal((await fetchDzmmBillingUsage(accountId, { limit: 10, cursor: "opaque/+?=" })).nextCursor, "opaque-next");
  const [url, init] = mock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, "/api/backend/v1/billing/usage?limit=10&cursor=opaque%2F%2B%3F%3D");
  assert.equal(init.method, "GET"); assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error"); assert.equal(init.body, undefined);
  assert.throws(() => parseDzmmBillingUsage({ ...overview(), items: [item(), { ...item(), id: "usage_22222222-2222-4222-8222-222222222222" }] }, accountId, 1), errorStatus(502));
});

test("invalid billing pagination and absent account never issue a request", async t => {
  const mock = respond(t, overview());
  for (const [account, options] of [["", {}], [accountId, { limit: 0 }], [accountId, { limit: 51 }], [accountId, { limit: 1.5 }],
    [accountId, { cursor: "" }]] as const) {
    await assert.rejects(fetchDzmmBillingUsage(account, options), errorStatus(400));
  }
  assert.equal(mock.mock.callCount(), 0);
});

test("public config fetch and own-account usage fetch use strict independent responses", async t => {
  respond(t, config());
  assert.equal((await fetchDzmmBillingConfig()).priceRevision, 2);
  respond(t, { ...overview(), accountId: "other-account" });
  await assert.rejects(fetchDzmmBillingUsage(accountId), errorStatus(409));
});

test("billing unavailable and guest responses remain safe without echoing unknown upstream errors", async t => {
  for (const status of [401, 403, 404, 503]) {
    respond(t, { error: "secret-provider-key-must-not-appear" }, status);
    await assert.rejects(fetchDzmmBillingUsage(accountId), error => errorStatus(status)(error)
      && error instanceof Error && !error.message.includes("secret-provider"));
  }
});

test("transport failures use a safe independent accounting error", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("secret-request-header"); });
  await assert.rejects(fetchDzmmBillingConfig(), failure => errorStatus(503)(failure)
    && failure instanceof Error && !failure.message.includes("secret-request"));
});

test("abort prevents applying a completed billing response and an already aborted signal makes no request", async t => {
  const controller = new AbortController();
  const mock = t.mock.method(globalThis, "fetch", async () => { controller.abort(); return Response.json(overview()); });
  await assert.rejects(fetchDzmmBillingUsage(accountId, { signal: controller.signal }), { name: "AbortError" });
  const count = mock.mock.callCount();
  await assert.rejects(fetchDzmmBillingUsage(accountId, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(mock.mock.callCount(), count);
});


test("Super entitlement keeps real balance, binds to account and never accepts a charged exemption", () => {
  const body = { ...overview(), creditUnlimited: true, billingExempt: true, availableBalance: 0,
    items: [{ ...item(), billingExempt: true, reservedCredits: 0, chargedCredits: 0, returnedCredits: 0 }] };
  const parsed = parseDzmmBillingUsage(body, accountId);
  assert.equal(parsed.creditUnlimited, true); assert.equal(parsed.availableBalance, 0);
  assert.equal(parsed.items[0].billingExempt, true);
  assert.throws(() => parseDzmmBillingUsage(body, "another-account"), errorStatus(409));
  for (const fields of [{ creditUnlimited: "true" }, { billingExempt: 1 }, { billingExempt: false }])
    assert.throws(() => parseDzmmBillingUsage({ ...body, ...fields }, accountId), errorStatus(502));
  assert.throws(() => parseDzmmBillingUsage({ ...body, items: [{ ...item(), billingExempt: true }] }, accountId), errorStatus(502));
});

test("current numeric Credit balance accepts normal charges without exemption flags", () => {
  const parsed = parseDzmmBillingUsage({ ...overview(), availableBalance: 999_999_980, creditUnlimited: false, billingExempt: false,
    items: [{ ...item(), billingExempt: false }] }, accountId);
  assert.equal(parsed.availableBalance, 999_999_980);
  assert.equal(parsed.items[0].chargedCredits, 20);
  assert.equal(parsed.items[0].billingExempt, false);
  assert.equal(parsed.creditUnlimited, false);
});
