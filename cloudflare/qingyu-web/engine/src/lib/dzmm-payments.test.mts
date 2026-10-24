import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import paymentsModule from "./dzmm-payments";
import type { DzmmCheckoutRequest, DzmmPaymentMode } from "./dzmm-payments";
const {
  createDzmmCheckout, DzmmPaymentError, fetchDzmmPaymentConfig, fetchDzmmPaymentOrder,
  fetchDzmmPaymentWallet, isDzmmZpayCheckoutUrl,
} = paymentsModule as typeof import("./dzmm-payments");

const accountId = "registered-account";
const requestId = "11111111-1111-4111-8111-111111111111";
const pack = { id: "usd_1", amountMinor: 100, currency: "usd", credits: 100 };
const checkoutUrl = "https://checkout.stripe.com/c/pay_fixture";
const environment = (mode: DzmmPaymentMode) => ({ mode, testMode: mode === "test" });
const configuration = (mode: DzmmPaymentMode) => ({ enabled: true, ...environment(mode), currency: "usd", packages: [pack], note: "", modelBillingLinked: false });
const order = (mode: DzmmPaymentMode) => ({ ...pack, id: "pay_fixture", packageId: pack.id, accountId, mode, refundedCredits: 0,
  refundedAmountMinor: 0, status: "pending", createdAt: 1000, updatedAt: 1000, paidAt: null, checkoutUrl });
const wallet = (mode: DzmmPaymentMode) => ({ ...environment(mode), accountId, balance: 100, totalPurchased: 100,
  totalRefunded: 0, orders: [order(mode)] });
function respond(t: TestContext, body: unknown) {
  return t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
}
const errorStatus = (status: number) => (failure: unknown) => failure instanceof DzmmPaymentError && failure.status === status;

test("payment config accepts coherent test and live environments", async t => {
  for (const mode of ["test", "live"] as const) {
    respond(t, { ...configuration(mode), enabled: false });
    const result = await fetchDzmmPaymentConfig();
    assert.equal(result.mode, mode);
    assert.equal(result.testMode, mode === "test");
    assert.equal(result.enabled, false);
    assert.equal(result.modelBillingLinked, false);
    assert.deepEqual(result.packages, [pack]);
  }
});

test("payment config accepts the server-controlled billing flag while keeping disabled legacy data", async t => {
  for (const modelBillingLinked of [false, true]) {
    respond(t, { ...configuration("live"), modelBillingLinked });
    assert.equal((await fetchDzmmPaymentConfig()).modelBillingLinked, modelBillingLinked);
  }
});

test("payment config rejects inconsistent mode flags and malformed billing flags", async t => {
  for (const fields of [{ mode: "live", testMode: true }, { mode: "test", testMode: false }, { mode: "live", testMode: 0 },
    { mode: "staging", testMode: true }, { modelBillingLinked: "true" }, { modelBillingLinked: 1 }, { modelBillingLinked: null }]) {
    respond(t, { ...configuration("live"), ...fields });
    await assert.rejects(fetchDzmmPaymentConfig(), errorStatus(502));
  }
});

test("wallets accept each mode only with matching account and order modes", async t => {
  for (const mode of ["test", "live"] as const) {
    respond(t, wallet(mode));
    const result = await fetchDzmmPaymentWallet(undefined, { accountId, mode });
    assert.equal(result.mode, mode);
    assert.equal(result.orders[0].mode, mode);
    assert.equal(result.accountId, accountId);
  }
  for (const entry of [{ ...order("test") }, { ...order("live"), accountId: "other-account" }]) {
    respond(t, { ...wallet("live"), orders: [entry] });
    await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "live" }), errorStatus(502));
  }
});

test("wallet reads reject a changed mode and a different signed-in account", async t => {
  respond(t, wallet("live"));
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "test" }), errorStatus(409));
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId: "other-account", mode: "live" }), errorStatus(502));
  respond(t, { ...wallet("live"), testMode: true });
  await assert.rejects(fetchDzmmPaymentWallet(), errorStatus(502));
});

test("order verification cannot put a test or foreign-account order in a live wallet", async t => {
  respond(t, { ...wallet("live"), order: order("live") });
  assert.equal((await fetchDzmmPaymentOrder("pay_fixture", undefined, { accountId, mode: "live" })).order.mode, "live");
  for (const entry of [{ ...order("test") }, { ...order("live"), accountId: "other-account" }, { ...order("live"), id: "wrong-order" }]) {
    respond(t, { ...wallet("live"), order: entry });
    await assert.rejects(fetchDzmmPaymentOrder("pay_fixture", undefined, { accountId, mode: "live" }), errorStatus(502));
  }
  respond(t, { ...wallet("test"), order: order("test") });
  await assert.rejects(fetchDzmmPaymentOrder("pay_fixture", undefined, { accountId, mode: "live" }), errorStatus(409));
});

test("checkout sends the reviewed mode and accepts only that environment", async t => {
  for (const mode of ["test", "live"] as const) {
    const mock = respond(t, { ...environment(mode), accountId, order: order(mode), checkoutUrl });
    const body = { packageId: pack.id, accountId, requestId, mode };
    const result = await createDzmmCheckout(body, undefined, pack);
    assert.equal(result.mode, mode);
    assert.equal(result.order.mode, mode);
    const init = mock.mock.calls[0].arguments[1] as RequestInit;
    assert.deepEqual(JSON.parse(init.body as string), body);
  }
});

test("checkout rejects response mode drift, mixed orders, account changes and untrusted redirects", async t => {
  const body = { packageId: pack.id, accountId, requestId, mode: "live" as const };
  respond(t, { ...environment("test"), accountId, order: order("test"), checkoutUrl });
  await assert.rejects(createDzmmCheckout(body, undefined, pack), errorStatus(409));
  for (const fields of [{ testMode: true }, { order: order("test") }, { accountId: "other-account" },
    { order: { ...order("live"), accountId: "other-account" } }, { checkoutUrl: "https://example.com/pay" }]) {
    respond(t, { ...environment("live"), accountId, order: order("live"), checkoutUrl, ...fields });
    await assert.rejects(createDzmmCheckout(body, undefined, pack), errorStatus(502));
  }
});

test("a changed live price requires reviewing a fresh package before payment", async t => {
  respond(t, { ...environment("live"), accountId, order: { ...order("live"), amountMinor: 500 }, checkoutUrl });
  await assert.rejects(createDzmmCheckout({ packageId: pack.id, accountId, requestId, mode: "live" }, undefined, pack), errorStatus(409));
});

test("abort signals prevent using checkout data even if transport finishes afterward", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    assert.equal((init?.signal as AbortSignal).aborted, false);
    controller.abort();
    return Response.json({ ...environment("live"), accountId, order: order("live"), checkoutUrl });
  });
  await assert.rejects(createDzmmCheckout({ packageId: pack.id, accountId, requestId, mode: "live" }, controller.signal, pack), { name: "AbortError" });
});

const zpayId = `zp_${requestId}`;
const zpayUrl = `https://xumengchat.top/api/payments/zpay/checkout/${zpayId}`;
const cnyPack = { id: "cny_28", amountMinor: 2800, currency: "cny", credits: 2800 };
const cnyPackages = [cnyPack,
  { id: "cny_88", amountMinor: 8800, currency: "cny", credits: 8800 },
  { id: "cny_188", amountMinor: 18800, currency: "cny", credits: 18800 }];
const methods = [{ id: "alipay", label: "支付宝" }, { id: "wxpay", label: "微信支付" }];
const zpayConfig = () => ({ ...configuration("live"), provider: "zpay", currency: "cny", packages: cnyPackages, methods });
const zpayOrder = (method = "alipay") => ({ ...order("live"), ...cnyPack, id: zpayId, packageId: cnyPack.id,
  provider: "zpay", method, checkoutUrl: zpayUrl });
const zpayWallet = () => ({ ...wallet("live"), provider: "zpay", orders: [zpayOrder(), order("live")] });
const zpayCheckout = (method: "alipay" | "wxpay" = "alipay"): DzmmCheckoutRequest => ({
  packageId: cnyPack.id, accountId, requestId, mode: "live", provider: "zpay", method,
});

test("Z-Pay config exposes only coherent, enabled payment methods with RMB pricing", async t => {
  for (const available of [methods, [methods[0]], [methods[1]]]) {
    respond(t, { ...zpayConfig(), methods: available });
    const result = await fetchDzmmPaymentConfig();
    assert.equal(result.provider, "zpay");
    assert.equal(result.currency, "cny");
    assert.deepEqual(result.methods, available);
    assert.deepEqual(result.packages, cnyPackages);
  }
  respond(t, { ...zpayConfig(), enabled: false, methods: [] });
  assert.equal((await fetchDzmmPaymentConfig()).enabled, false);
  for (const fields of [{ methods: [] }, { methods: undefined }, { methods: [methods[0], methods[0]] },
    { methods: [{ id: "bank", label: "银行" }] }, { methods: [{ id: "alipay", label: "支付宝（免审核）" }] },
    { ...environment("test") }, { currency: "usd" }, { packages: [pack] }, { provider: "unknown" }]) {
    respond(t, { ...zpayConfig(), ...fields });
    await assert.rejects(fetchDzmmPaymentConfig(), errorStatus(502));
  }
});

test("Z-Pay checkout URLs allow only canonical, order-bound routes on our own origin", () => {
  assert.equal(isDzmmZpayCheckoutUrl(zpayUrl, zpayId), true);
  const path = `/api/payments/zpay/checkout/${zpayId}`;
  for (const invalid of [`${zpayUrl}?url=https://example.com`, `${zpayUrl}#`, `${zpayUrl}#pay`,
    `${zpayUrl}/`, `http://xumengchat.top${path}`, `https://example.com${path}`,
    `https://xumengchat.top:8443${path}`, `https://xumengchat.top:443${path}`, `https://a@xumengchat.top${path}`,
    `https://xumengchat.top/api/payments/zpay/../zpay/checkout/${zpayId}`, `https://xumengchat.top${path.replace("zp_", "%7Ap_")}`,
    `//xumengchat.top${path}`, path, ` ${zpayUrl}`, `${zpayUrl}\n`, `${zpayUrl}/../${zpayId}`,
    `https://checkout.stripe.com${path}`, "https://xumengchat.top/api/payments/zpay/checkout/zp_invalid"]) {
    assert.equal(isDzmmZpayCheckoutUrl(invalid, zpayId), false, invalid);
  }
  assert.equal(isDzmmZpayCheckoutUrl(zpayUrl, "zp_22222222-2222-4222-8222-222222222222"), false);
  assert.equal(isDzmmZpayCheckoutUrl(`http://localhost:3010${path}`, zpayId, "http://localhost:3010"), true);
  assert.equal(isDzmmZpayCheckoutUrl(`http://127.0.0.1:3010${path}`, zpayId, "http://127.0.0.1:3010"), true);
  assert.equal(isDzmmZpayCheckoutUrl(`http://localhost:3020${path}`, zpayId, "http://localhost:3010"), false);
  assert.equal(isDzmmZpayCheckoutUrl(zpayUrl, zpayId, "http://localhost:3010"), false);
  assert.equal(isDzmmZpayCheckoutUrl(`https://example.com${path}`, zpayId, "https://example.com"), false);
});

test("live wallet preserves historical Stripe orders without mixing test or foreign-account entries", async t => {
  respond(t, zpayWallet());
  const result = await fetchDzmmPaymentWallet(undefined, { accountId, mode: "live", provider: "zpay" });
  assert.deepEqual(result.orders.map(entry => entry.provider), ["zpay", "stripe"]);
  assert.equal(result.orders[0].method, "alipay");
  assert.equal(result.orders[1].method, null);
  respond(t, { ...zpayWallet(), orders: [order("test")] });
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "live", provider: "zpay" }), errorStatus(502));
  respond(t, { ...zpayWallet(), orders: [{ ...zpayOrder(), accountId: "foreign-account" }] });
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "live", provider: "zpay" }), errorStatus(502));
});

test("wallet and order reads reject provider drift while retaining historical Stripe order lookup", async t => {
  respond(t, wallet("live"));
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "live", provider: "zpay" }), errorStatus(409));
  respond(t, zpayWallet());
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "live", provider: "stripe" }), errorStatus(409));
  respond(t, { ...zpayWallet(), order: order("live") });
  assert.equal((await fetchDzmmPaymentOrder("pay_fixture", undefined, { accountId, mode: "live", provider: "zpay" })).order.provider, "stripe");
  respond(t, { ...wallet("live"), order: order("live") });
  await assert.rejects(fetchDzmmPaymentOrder("pay_fixture", undefined, { accountId, mode: "live", provider: "zpay" }), errorStatus(409));
});

test("each Z-Pay checkout transmits the chosen method and accepts only its own bound receipt", async t => {
  for (const method of ["alipay", "wxpay"] as const) {
    const mock = respond(t, { ...environment("live"), accountId, provider: "zpay", order: zpayOrder(method), checkoutUrl: zpayUrl });
    const result = await createDzmmCheckout(zpayCheckout(method), undefined, cnyPack);
    assert.equal(result.provider, "zpay");
    assert.equal(result.order.method, method);
    const init = mock.mock.calls[0].arguments[1] as RequestInit;
    assert.deepEqual(JSON.parse(init.body as string), zpayCheckout(method));
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
  }
});

test("Z-Pay checkout rejects wrong account, method, currency, mode, price and arbitrary redirects", async t => {
  const valid = { ...environment("live"), accountId, provider: "zpay", order: zpayOrder(), checkoutUrl: zpayUrl };
  for (const fields of [{ provider: "stripe" }, { provider: undefined }]) {
    respond(t, { ...valid, ...fields });
    await assert.rejects(createDzmmCheckout(zpayCheckout(), undefined, cnyPack), errorStatus(409));
  }
  for (const fields of [{ accountId: "foreign-account" }, { order: { ...zpayOrder(), method: "wxpay" } },
    { order: { ...zpayOrder(), currency: "usd" } }, { order: { ...zpayOrder(), provider: "stripe" } },
    { order: { ...zpayOrder(), checkoutUrl: `${zpayUrl}?pay=1` } }, { checkoutUrl: "https://zpayz.cn/submit.php" },
    { checkoutUrl }, { order: { ...zpayOrder(), id: "zp_22222222-2222-4222-8222-222222222222" } },
    { ...environment("live"), order: { ...zpayOrder(), mode: "test" } }]) {
    respond(t, { ...valid, ...fields });
    await assert.rejects(createDzmmCheckout(zpayCheckout(), undefined, cnyPack), errorStatus(502));
  }
  respond(t, { ...valid, order: { ...zpayOrder(), amountMinor: 8800 } });
  await assert.rejects(createDzmmCheckout(zpayCheckout(), undefined, cnyPack), errorStatus(409));
  respond(t, { ...valid, order: { ...zpayOrder(), credits: 8800 } });
  await assert.rejects(createDzmmCheckout(zpayCheckout(), undefined, cnyPack), errorStatus(409));
});

test("invalid Z-Pay method or test-mode requests never reach the server", async t => {
  const mock = respond(t, {});
  for (const fields of [{ method: "bank" }, { method: undefined }, { mode: "test" }, { requestId: "invalid" }]) {
    await assert.rejects(createDzmmCheckout({ ...zpayCheckout(), ...fields } as DzmmCheckoutRequest), errorStatus(400));
  }
  assert.equal(mock.mock.calls.length, 0);
});

test("Z-Pay aborts do not adopt delayed checkout receipts", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return Response.json({ ...environment("live"), accountId, provider: "zpay", order: zpayOrder(), checkoutUrl: zpayUrl });
  });
  await assert.rejects(createDzmmCheckout(zpayCheckout(), controller.signal, cnyPack), { name: "AbortError" });
});


test("unlimited wallet markers preserve factual credits and reject wrong account or malformed flags", async t => {
  const body = { ...wallet("live"), balance: 0, creditUnlimited: true, billingExempt: true };
  respond(t, body);
  const result = await fetchDzmmPaymentWallet(undefined, { accountId, mode: "live" });
  assert.equal(result.balance, 0); assert.equal(result.creditUnlimited, true);
  await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId: "other", mode: "live" }), errorStatus(502));
  for (const flags of [{ creditUnlimited: "true" }, { billingExempt: 1 }, { billingExempt: false }]) {
    respond(t, { ...body, ...flags });
    await assert.rejects(fetchDzmmPaymentWallet(undefined, { accountId, mode: "live" }), errorStatus(502));
  }
});

test("large numeric wallet preserves administrative credits with current flags false", async t => {
  respond(t, { ...wallet("live"), balance: 1_000_000_000, creditUnlimited: false, billingExempt: false });
  const result = await fetchDzmmPaymentWallet(undefined, { accountId, mode: "live" });
  assert.equal(result.balance, 1_000_000_000);
  assert.equal(result.totalPurchased, 100);
  assert.equal(result.creditUnlimited, false);
  assert.equal(result.billingExempt, false);
});
