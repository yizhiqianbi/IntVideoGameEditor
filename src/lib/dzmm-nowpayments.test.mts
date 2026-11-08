import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import clientModule from "./dzmm-nowpayments";
import type { DzmmNowPaymentsPlan, DzmmNowPaymentsOrder, DzmmNowPaymentsStorage } from "./dzmm-nowpayments";
const client = clientModule as typeof import("./dzmm-nowpayments");
const { parseDzmmNowPaymentsConfig, parseDzmmNowPaymentsPlan, parseDzmmNowPaymentsOrder, formatDzmmNowPaymentsAmount,
  isDzmmNowPaymentsCheckoutUrl, createDzmmNowPaymentsIntent, parseDzmmNowPaymentsIntent, readDzmmNowPaymentsIntent,
  saveDzmmNowPaymentsIntent, clearDzmmNowPaymentsIntent, dzmmNowPaymentsStorageKey, isDzmmNowPaymentsFinal,
  preserveDzmmNowPaymentsOrder, dzmmNowPaymentsStatus, createDzmmNowPaymentsCheckout, fetchDzmmNowPaymentsRequest,
  fetchDzmmNowPaymentsOrder, fetchDzmmNowPaymentsConfig, recoverDzmmNowPaymentsOrder, matchesDzmmNowPaymentsClipboardTarget,
  canRetryDzmmNowPaymentsIntent, DzmmNowPaymentsError } = client;
const accountId = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333", orderId = "sp_44444444-4444-4444-8444-444444444444";
const plan: DzmmNowPaymentsPlan = { id: "vip_monthly", label: "叙梦 VIP", revision: 2, amountAtomic: 5_000_000,
  currency: "usdt", decimals: 6, durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: "Asia/Shanghai" };
const quarterly: DzmmNowPaymentsPlan = { id: "vip_quarterly", label: "叙梦 VIP 三个月", revision: 1, amountAtomic: 15_000_000,
  currency: "usdt", decimals: 6, durationDays: 90, dailyCredits: 500, maxClaims: 90, timezone: "Asia/Shanghai" };
const prepared = () => createDzmmNowPaymentsIntent(accountId, plan, "usdttrc20", requestId, 1000);
const config = () => ({ provider: "nowpayments", mode: "live", enabled: false, renewal: "manual", autoRenew: false,
  payCurrency: "usdttrc20", plans: [plan], note: "暂未开放" });
const order = (): DzmmNowPaymentsOrder => ({ id: orderId, accountId, requestId, planId: plan.id, planRevision: plan.revision,
  label: plan.label, amountAtomic: plan.amountAtomic, currency: "usdt", decimals: 6, payCurrency: "usdttrc20",
  durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: "Asia/Shanghai",
  invoiceId: null, paymentId: "123456789", payAmount: "5", payAddress: "T" + "a".repeat(33), quoteExpiresAt: null,
  status: "pending", providerStatus: "waiting", checkoutUrl: `https://xumengchat.top/?np_order=${orderId}#recharge`,
  createdAt: 1000, updatedAt: 1000, paidAt: null, subscriptionId: null, membershipActivated: false });
const paid = (): DzmmNowPaymentsOrder => ({ ...order(), status: "paid", providerStatus: "finished", paidAt: 2000,
  updatedAt: 2000, subscriptionId: "sub_fixture", membershipActivated: true });
function storage(): DzmmNowPaymentsStorage & { values: Map<string, string> } {
  const values = new Map<string, string>(); return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, raw) => { values.set(key, raw); }, removeItem: key => { values.delete(key); } };
}
const status = (code: number) => (error: unknown) => error instanceof DzmmNowPaymentsError && error.status === code;
const envelope = (value: unknown) => ({ accountId, provider: "nowpayments", mode: "live", requestId, order: value });
const respond = (t: TestContext, value: unknown) => t.mock.method(globalThis, "fetch", async () => Response.json(value));

test("disabled independent USDT configuration preserves manual 30-day terms and formats atomic units as 5", () => {
  const parsed = parseDzmmNowPaymentsConfig(config());
  assert.equal(parsed.enabled, false); assert.equal(parsed.autoRenew, false); assert.equal(parsed.renewal, "manual");
  assert.equal(formatDzmmNowPaymentsAmount(parsed.plans[0].amountAtomic, parsed.plans[0].decimals), "5");
  assert.equal(formatDzmmNowPaymentsAmount(1, 6), "0.000001");
  assert.equal(formatDzmmNowPaymentsAmount(5_123_000, 6), "5.123");
  assert.deepEqual(parseDzmmNowPaymentsConfig({ ...config(), plans: [], payCurrency: null }).plans, []);
});

test("configuration cannot silently reinterpret fiat, cents, a new price, an unsupported network or automatic renewal", () => {
  for (const patch of [{ amountAtomic: 5 }, { amountAtomic: 5_000_001 }, { currency: "cny" }, { decimals: 2 },
    { dailyCredits: 101 }, { maxClaims: 31 }, { durationDays: 31 }, { revision: 0 }]) assert.throws(() => parseDzmmNowPaymentsPlan({ ...plan, ...patch }));
  for (const patch of [{ enabled: true, payCurrency: null }, { enabled: true, plans: [] }, { payCurrency: "usdtbsc" },
    { autoRenew: true }, { renewal: "automatic" }, { provider: "stripe" }, { mode: "test" }, { plans: [plan, plan] }]) assert.throws(() => parseDzmmNowPaymentsConfig({ ...config(), ...patch }));
});

test("quarterly offer is 15 USDT for 90 days and 90 manual claims, while legacy monthly intent remains frozen", () => {
  const current = parseDzmmNowPaymentsConfig({ ...config(), plans: [quarterly] });
  assert.equal(formatDzmmNowPaymentsAmount(current.plans[0].amountAtomic, 6), "15");
  assert.deepEqual(current.plans[0], quarterly);
  for (const patch of [{ amountAtomic: 5_000_000 }, { durationDays: 30 }, { maxClaims: 30 }, { revision: 2 },
    { id: "vip_monthly" }, { dailyCredits: 101 }]) assert.throws(() => parseDzmmNowPaymentsPlan({ ...quarterly, ...patch }));
  const store = storage(), prior = prepared(); saveDzmmNowPaymentsIntent(store, prior);
  assert.deepEqual(readDzmmNowPaymentsIntent(store, accountId), prior);
  assert.equal(prior.plan.durationDays, 30); assert.equal(prior.plan.amountAtomic, 5_000_000);
  assert.throws(() => saveDzmmNowPaymentsIntent(store, createDzmmNowPaymentsIntent(accountId, quarterly, "usdttrc20", requestId, 1000)));
  assert.deepEqual(readDzmmNowPaymentsIntent(store, accountId), prior);
});

test("receipts validate the whole quarterly snapshot and still recover old monthly wire records without repricing", () => {
  const intent = createDzmmNowPaymentsIntent(accountId, quarterly, "usdttrc20", requestId, 1000);
  const receipt = { ...order(), planId: quarterly.id, planRevision: quarterly.revision, label: quarterly.label,
    amountAtomic: quarterly.amountAtomic, payAmount: "15", durationDays: quarterly.durationDays, dailyCredits: quarterly.dailyCredits, maxClaims: quarterly.maxClaims };
  assert.deepEqual(parseDzmmNowPaymentsOrder(receipt, accountId, intent), receipt);
  for (const patch of [{ payAmount: "5" }, { durationDays: 30 }, { maxClaims: 30 }, { timezone: "UTC" }, { dailyCredits: 99 }]) {
    assert.throws(() => parseDzmmNowPaymentsOrder({ ...receipt, ...patch }, accountId, intent));
  }
  const { durationDays, dailyCredits, maxClaims, timezone, ...legacy } = order();
  assert.deepEqual(parseDzmmNowPaymentsOrder(legacy, accountId, prepared()), order());
  const { durationDays: ignoredDuration, dailyCredits: ignoredCredits, maxClaims: ignoredClaims, timezone: ignoredTimezone, ...incomplete } = receipt;
  assert.throws(() => parseDzmmNowPaymentsOrder(incomplete, accountId, intent));
  assert.throws(() => parseDzmmNowPaymentsOrder({ ...legacy, durationDays }, accountId, prepared()));
});

test("retry requires a confirmed empty request lookup and exact current plan, preserves the same request, and never retries uncertain orders", async t => {
  const intent = createDzmmNowPaymentsIntent(accountId, quarterly, "usdttrc20", requestId, 1000);
  const active = parseDzmmNowPaymentsConfig({ ...config(), enabled: true, plans: [quarterly] });
  assert.equal(canRetryDzmmNowPaymentsIntent(intent, active, null, true), true);
  for (const [candidate, found, confirmed] of [[{ ...active, enabled: false }, null, true], [active, null, false],
    [{ ...active, plans: [plan] }, null, true], [active, order(), true], [active, { ...order(), status: "unknown" }, true]] as const) {
    assert.equal(canRetryDzmmNowPaymentsIntent(intent, candidate, found, confirmed), false);
  }
  assert.equal(canRetryDzmmNowPaymentsIntent(prepared(), active, null, true), false);
  const store = storage(); saveDzmmNowPaymentsIntent(store, intent);
  const paths: string[] = [], bodies: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    paths.push(`${options?.method} ${url}`);
    if (options?.method === "POST") { bodies.push(JSON.parse(String(options.body))); return Response.json({ code: "nowpayments_minimum_unavailable" }, { status: 503 }); }
    return Response.json(envelope(null));
  });
  await assert.rejects(createDzmmNowPaymentsCheckout(intent), /最低收款金额/);
  assert.equal(await fetchDzmmNowPaymentsRequest(intent), null);
  const restored = readDzmmNowPaymentsIntent(store, accountId)!;
  await assert.rejects(createDzmmNowPaymentsCheckout(restored), /最低收款金额/);
  assert.deepEqual(bodies, [intent.request, intent.request]);
  assert.deepEqual(paths, [`POST /api/backend/v1/nowpayments/checkout`, `GET /api/backend/v1/nowpayments/requests/${requestId}`, `POST /api/backend/v1/nowpayments/checkout`]);
});

test("minimum restriction messages use only validated public business fields and retain the original amount", async t => {
  const intent = createDzmmNowPaymentsIntent(accountId, quarterly, "usdttrc20", requestId, 1000);
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "nowpayments_minimum_exceeds_plan", minimumAmount: "16.207792",
    payCurrency: "usdttrc20", error: "NOWPAYMENTS_API_KEY=secret-fixture-value" }, { status: 503 }));
  await assert.rejects(createDzmmNowPaymentsCheckout(intent), error => error instanceof DzmmNowPaymentsError && error.status === 503
    && error.message.includes("16.207792 USDT") && !error.message.includes("API_KEY") && !error.message.includes("secret-fixture-value"));
  assert.equal(intent.plan.amountAtomic, 15_000_000);
  for (const minimumAmount of ["16\nsecret", "0", "NaN", "1e5", " secret "]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ code: "nowpayments_minimum_exceeds_plan", minimumAmount, payCurrency: "usdttrc20" }, { status: 503 }));
    await assert.rejects(createDzmmNowPaymentsCheckout(intent), error => error instanceof DzmmNowPaymentsError && !error.message.includes(minimumAmount));
  }
});

test("direct cashier link allows only exact owned HTTPS return and never a hosted, lookalike or redirected URL", () => {
  const valid = order().checkoutUrl!;
  assert.equal(isDzmmNowPaymentsCheckoutUrl(valid, orderId), true);
  for (const url of [valid.replace("https:", "http:"), valid.replace("xumengchat.top", "xumengchat.top.evil.test"),
    valid.replace("xumengchat.top", "user@xumengchat.top"), valid.replace("xumengchat.top", "xumengchat.top:444"),
    valid + "?extra=1", valid.replace("#recharge", "#vip"), valid.replace(orderId, `sp_${other}`),
    `https://nowpayments.io/payment/?iid=123456789`, valid.replace("/?", "/checkout?"), " " + valid]) assert.equal(isDzmmNowPaymentsCheckoutUrl(url, orderId), false, url);
});

test("cashier receipt is owner, request, price, plan revision and network bound", () => {
  assert.deepEqual(parseDzmmNowPaymentsOrder(order(), accountId, prepared()), order());
  for (const patch of [{ accountId: other }, { requestId: other }, { planId: "other_plan" }, { planRevision: 3 },
    { amountAtomic: 5_000_001 }, { decimals: 2 }, { currency: "usd" }, { label: "Other" }, { payCurrency: "usdtbsc" },
    { checkoutUrl: order().checkoutUrl!.replace(orderId, `sp_${other}`) }]) assert.throws(() => parseDzmmNowPaymentsOrder({ ...order(), ...patch }, accountId, prepared()));
});

test("unverified amounts and malformed or wrong-chain addresses cannot become payable UI", () => {
  for (const patch of [{ payAmount: "5.01" }, { payAmount: 5 }, { payAmount: "5.0" }, { payAmount: null },
    { payAddress: "0x" + "a".repeat(40) }, { payAddress: "T" + "0".repeat(33) }, { payAddress: " T" + "a".repeat(33) },
    { payAddress: null }, { paymentId: null }, { paymentId: "javascript:1" }, { quoteExpiresAt: -1 }]) assert.throws(() => parseDzmmNowPaymentsOrder({ ...order(), ...patch }, accountId));
  const unknown = { ...order(), status: "unknown", providerStatus: null, payAddress: null, payAmount: null, paymentId: null, checkoutUrl: null };
  assert.equal(parseDzmmNowPaymentsOrder(unknown, accountId).status, "unknown");
});

test("provider finished, browser return and partial payment never claim membership activation", () => {
  for (const candidate of [{ ...order(), providerStatus: "finished" }, { ...order(), status: "paid", providerStatus: "finished", paidAt: 2000 },
    { ...order(), providerStatus: "partially_paid" }]) {
    const parsed = parseDzmmNowPaymentsOrder(candidate, accountId);
    assert.equal(isDzmmNowPaymentsFinal(parsed), false);
    assert.notEqual(dzmmNowPaymentsStatus(parsed).title, "VIP 已开通");
  }
  assert.equal(dzmmNowPaymentsStatus({ ...order(), providerStatus: "partially_paid" }).title, "已收到部分付款");
  assert.equal(dzmmNowPaymentsStatus({ ...order(), providerStatus: "confirming" }).title, "等待链上确认");
  assert.throws(() => parseDzmmNowPaymentsOrder({ ...order(), membershipActivated: true }, accountId));
  assert.throws(() => parseDzmmNowPaymentsOrder({ ...paid(), subscriptionId: null }, accountId));
  assert.throws(() => parseDzmmNowPaymentsOrder({ ...paid(), providerStatus: "waiting" }, accountId));
  assert.throws(() => parseDzmmNowPaymentsOrder({ ...paid(), paidAt: 999 }, accountId));
  assert.equal(dzmmNowPaymentsStatus(paid()).title, "VIP 已开通");
});

test("a refunded historical grant is accepted and rendered as refunded even if its earlier provider status was finished", () => {
  for (const providerStatus of ["refunded", "finished"]) {
    const refunded = parseDzmmNowPaymentsOrder({ ...paid(), status: "refunded", providerStatus }, accountId, prepared());
    assert.equal(isDzmmNowPaymentsFinal(refunded), true);
    assert.equal(dzmmNowPaymentsStatus(refunded).title, "订单已退款");
  }
});

test("an exact frozen intent survives reload without aliasing the configuration or crossing accounts", () => {
  const store = storage(), mutable = { ...plan }, intent = createDzmmNowPaymentsIntent(accountId, mutable, "usdttrc20", requestId.toUpperCase(), 1000);
  mutable.label = "Changed"; saveDzmmNowPaymentsIntent(store, intent);
  assert.equal(intent.plan.label, plan.label); assert.equal(intent.request.requestId, requestId);
  assert.deepEqual(readDzmmNowPaymentsIntent(store, accountId), intent);
  assert.equal(readDzmmNowPaymentsIntent(store, other), null);
  assert.throws(() => parseDzmmNowPaymentsIntent(JSON.stringify(intent), other));
});

test("another unresolved request or changed quote cannot overwrite the UUID persisted before checkout", () => {
  const store = storage(), intent = prepared(); saveDzmmNowPaymentsIntent(store, intent);
  for (const next of [createDzmmNowPaymentsIntent(accountId, plan, "usdttrc20", other, 1000),
    createDzmmNowPaymentsIntent(accountId, { ...plan, revision: 3 }, "usdttrc20", requestId, 1000)]) {
    assert.throws(() => saveDzmmNowPaymentsIntent(store, next)); assert.deepEqual(readDzmmNowPaymentsIntent(store, accountId), intent);
  }
});

test("storage quota, corrupt reads and unsuccessful readback block new checkout while retaining recoverable raw records", () => {
  const store = storage(), intent = prepared();
  assert.throws(() => saveDzmmNowPaymentsIntent({ ...store, setItem: () => { throw new Error("quota"); } }, intent));
  assert.throws(() => saveDzmmNowPaymentsIntent({ ...store, setItem: () => {} }, intent));
  store.values.set(dzmmNowPaymentsStorageKey(accountId), "{broken");
  assert.throws(() => readDzmmNowPaymentsIntent(store, accountId));
  assert.throws(() => saveDzmmNowPaymentsIntent(store, intent));
  assert.equal(store.values.get(dzmmNowPaymentsStorageKey(accountId)), "{broken");
});

test("pending or unknown payment cannot clear intent; only matching final receipt can, without deleting a newer request", () => {
  const store = storage(), intent = prepared(); saveDzmmNowPaymentsIntent(store, intent);
  assert.equal(clearDzmmNowPaymentsIntent(store, intent, order()), false);
  assert.equal(clearDzmmNowPaymentsIntent(store, intent, { ...order(), status: "unknown" }), false);
  assert.throws(() => clearDzmmNowPaymentsIntent(store, intent, { ...paid(), accountId: other }));
  const next = createDzmmNowPaymentsIntent(accountId, plan, "usdttrc20", other, 2000);
  store.values.set(dzmmNowPaymentsStorageKey(accountId), JSON.stringify(next));
  assert.equal(clearDzmmNowPaymentsIntent(store, intent, paid()), false);
  assert.deepEqual(readDzmmNowPaymentsIntent(store, accountId), next);
  store.values.set(dzmmNowPaymentsStorageKey(accountId), JSON.stringify(intent));
  assert.equal(clearDzmmNowPaymentsIntent(store, intent, paid()), true);
  assert.equal(readDzmmNowPaymentsIntent(store, accountId), null);
});

test("stale pending reads cannot downgrade an observed terminal receipt but another order remains distinct", () => {
  assert.equal(preserveDzmmNowPaymentsOrder(order(), paid()).status, "paid");
  assert.equal(preserveDzmmNowPaymentsOrder({ ...order(), id: `sp_${other}` }, paid()).status, "pending");
  assert.equal(preserveDzmmNowPaymentsOrder({ ...order(), planRevision: 3 }, paid()).status, "pending");
});

test("clipboard feedback remains attached to one order/address even during the next request's pending POST", () => {
  const captured = order();
  assert.equal(matchesDzmmNowPaymentsClipboardTarget(captured, captured, requestId), true);
  assert.equal(matchesDzmmNowPaymentsClipboardTarget(paid(), captured, null), true);
  assert.equal(matchesDzmmNowPaymentsClipboardTarget(paid(), captured, other), false);
  assert.equal(matchesDzmmNowPaymentsClipboardTarget({ ...captured, id: `sp_${other}`, requestId: other }, captured, other), false);
  assert.equal(matchesDzmmNowPaymentsClipboardTarget({ ...captured, payAddress: "T" + "b".repeat(33) }, captured, requestId), false);
  assert.equal(matchesDzmmNowPaymentsClipboardTarget({ ...captured, accountId: other }, captured, requestId), false);
});

test("checkout carries exact persisted request and owner-bound API response without a redirect", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(url, "/api/backend/v1/nowpayments/checkout"); assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(options?.body)), prepared().request);
    return Response.json({ ...envelope(order()), checkoutUrl: order().checkoutUrl });
  });
  assert.equal((await createDzmmNowPaymentsCheckout(prepared())).payAmount, "5"); assert.equal(calls, 1);
});

test("lost checkout response and a restored reader only query original UUID, never issue another POST", async t => {
  const store = storage(), intent = prepared(), methods: string[] = []; saveDzmmNowPaymentsIntent(store, intent);
  t.mock.method(globalThis, "fetch", async (_url, options) => { methods.push(String(options?.method)); if (options?.method === "POST") throw new Error("lost response"); return Response.json(envelope(order())); });
  await assert.rejects(createDzmmNowPaymentsCheckout(intent), status(503));
  assert.equal((await fetchDzmmNowPaymentsRequest(intent))?.id, orderId);
  const restored = readDzmmNowPaymentsIntent(store, accountId)!;
  assert.equal((await fetchDzmmNowPaymentsRequest(restored))?.id, orderId);
  assert.deepEqual(methods, ["POST", "GET", "GET"]);
});

test("request/order lookups reject foreign receipts, mismatched IDs and forged activation", async t => {
  for (const value of [{ ...envelope(order()), accountId: other }, { ...envelope(order()), requestId: other },
    envelope({ ...order(), requestId: other }), envelope({ ...order(), membershipActivated: true })]) {
    respond(t, value); await assert.rejects(fetchDzmmNowPaymentsRequest(prepared()));
  }
  respond(t, { ...envelope(order()), order: { ...order(), id: `sp_${other}` } });
  await assert.rejects(fetchDzmmNowPaymentsOrder(accountId, orderId));
  respond(t, envelope(null)); assert.equal(await fetchDzmmNowPaymentsRequest(prepared()), null);
});

test("a recovered pending payment queries the order endpoint, then later polling uses that endpoint directly without POST", async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options?.method, "GET"); paths.push(String(url));
    return Response.json(envelope(String(url).includes("/orders/") ? paid() : order()));
  });
  assert.equal((await recoverDzmmNowPaymentsOrder(prepared(), null))?.membershipActivated, true);
  assert.deepEqual(paths, [`/api/backend/v1/nowpayments/requests/${requestId}`, `/api/backend/v1/nowpayments/orders/${orderId}`]);
  paths.length = 0;
  assert.equal((await recoverDzmmNowPaymentsOrder(prepared(), order()))?.membershipActivated, true);
  assert.deepEqual(paths, [`/api/backend/v1/nowpayments/orders/${orderId}`]);
});

test("creating/unknown requests without payment ID remain read-only lookup; unrelated browser order cannot replace the saved request", async t => {
  const paths: string[] = [], unresolved = { ...order(), status: "unknown", paymentId: null, payAddress: null, payAmount: null, checkoutUrl: null };
  t.mock.method(globalThis, "fetch", async (url, options) => { assert.equal(options?.method, "GET"); paths.push(String(url)); return Response.json(envelope(unresolved)); });
  const foreignCached = { ...order(), accountId: other, id: `sp_${other}`, requestId: other };
  assert.equal((await recoverDzmmNowPaymentsOrder(prepared(), foreignCached))?.status, "unknown");
  assert.deepEqual(paths, [`/api/backend/v1/nowpayments/requests/${requestId}`]);
  paths.length = 0;
  assert.equal((await recoverDzmmNowPaymentsOrder(prepared(), unresolved as DzmmNowPaymentsOrder))?.status, "unknown");
  assert.deepEqual(paths, [`/api/backend/v1/nowpayments/requests/${requestId}`]);
});

test("independent config loads when legacy payments pause and abort prevents even a GET", async t => {
  respond(t, config()); assert.equal((await fetchDzmmNowPaymentsConfig()).plans[0].currency, "usdt");
  const controller = new AbortController(); controller.abort(); let called = false;
  t.mock.method(globalThis, "fetch", async () => { called = true; return Response.json(config()); });
  await assert.rejects(fetchDzmmNowPaymentsConfig(controller.signal)); assert.equal(called, false);
});

test("public errors do not echo server key names, tokens or supplier payloads", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "NOWPAYMENTS_API_KEY=secret-fixture-value" }, { status: 503 }));
  await assert.rejects(fetchDzmmNowPaymentsConfig(), error => error instanceof DzmmNowPaymentsError && error.status === 503 && !error.message.includes("API_KEY") && !error.message.includes("secret-fixture-value"));
});
