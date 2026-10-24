import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import subscriptionsModule from "./dzmm-subscriptions";
import paymentsModule from "./dzmm-payments";
import type { DzmmSubscriptionPlan, DzmmSubscriptionCheckoutRequest } from "./dzmm-subscriptions";
const { fetchDzmmSubscriptionConfig, fetchDzmmSubscriptions, fetchDzmmSubscriptionOrder,
  fetchDzmmSubscriptionRequest, createDzmmSubscriptionCheckout, claimDzmmSubscriptionCredit, isDzmmSubscriptionCheckoutUrl } = subscriptionsModule as typeof import("./dzmm-subscriptions");
const { DzmmPaymentError } = paymentsModule as typeof import("./dzmm-payments");

const accountId = "registered-account";
const requestId = "11111111-1111-4111-8111-111111111111";
const orderId = `sp_${requestId}`;
const checkoutUrl = `https://xumengchat.top/api/payments/zpay/subscription/checkout/${orderId}`;
const serverTime = Date.UTC(2026, 9, 5, 2);
const context = { accountId, provider: "zpay" as const, mode: "live" as const };
const environment = { provider: "zpay", mode: "live", testMode: false };
const plan: DzmmSubscriptionPlan = { id: "month_28", label: "月订阅", revision: 1, amountMinor: 2800, currency: "cny",
  durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: "Asia/Shanghai" };
const methods = [{ id: "alipay", label: "支付宝" }, { id: "wxpay", label: "微信支付" }];
const config = () => ({ ...environment, enabled: false, timezone: "Asia/Shanghai", renewal: "manual", autoRenew: false,
  modelBillingLinked: false, methods, plans: [plan], note: "即将开放" });
const subscription = () => ({ id: "subscription_fixture", orderId, planId: plan.id, label: plan.label, status: "active",
  startsAt: serverTime - 3_600_000, expiresAt: serverTime + 30 * 86_400_000, dailyCredits: 100, claimsCount: 0, maxClaims: 30 });
const checkin = () => ({ subscriptionId: "subscription_fixture", dayKey: "2026-10-05", timezone: "Asia/Shanghai",
  claimed: false, claimable: true, rewardCredits: 100, claimedAt: null, resetAt: Date.UTC(2026, 9, 5, 16) });
const overview = () => ({ ...environment, accountId, serverTime, balance: 2800, totalSubscriptionGranted: 0,
  subscriptions: [subscription()], checkin: checkin() });
const order = () => ({ ...environment, id: orderId, accountId, planId: plan.id, planRevision: 1, label: plan.label,
  amountMinor: 2800, currency: "cny", durationDays: 30, dailyCredits: 100, maxClaims: 30, method: "alipay", status: "pending",
  createdAt: serverTime, updatedAt: serverTime, paidAt: null, checkoutUrl, subscriptionId: null });
const checkout = (): DzmmSubscriptionCheckoutRequest => ({ ...context, planId: plan.id, planRevision: 1, requestId, method: "alipay" });
const claimBody = () => ({ ...context, subscriptionId: "subscription_fixture", requestId });
const claimed = () => ({ ...overview(), balance: 2900, totalSubscriptionGranted: 100,
  subscriptions: [{ ...subscription(), claimsCount: 1 }], checkin: { ...checkin(), claimed: true, claimable: false, claimedAt: serverTime },
  claim: { id: "claim_fixture", subscriptionId: "subscription_fixture", dayKey: "2026-10-05", credits: 100, claimedAt: serverTime } });
const status = (expected: number) => (error: unknown) => error instanceof DzmmPaymentError && error.status === expected;
function respond(t: TestContext, value: unknown, statusCode = 200) {
  return t.mock.method(globalThis, "fetch", async () => Response.json(value, { status: statusCode }));
}

test("subscription config can show disabled draft plans without claiming automatic renewal", async t => {
  respond(t, config());
  const result = await fetchDzmmSubscriptionConfig();
  assert.equal(result.enabled, false);
  assert.equal(result.autoRenew, false);
  assert.equal(result.renewal, "manual");
  assert.deepEqual(result.plans, [plan]);
  respond(t, { ...config(), plans: [], methods: [] });
  assert.deepEqual((await fetchDzmmSubscriptionConfig()).plans, []);
});

test("subscription config accepts server plan prices and daily credits rather than fixed UI tiers", async t => {
  const configuredPlan = { ...plan, id: "month_custom", revision: 2, amountMinor: 9900, dailyCredits: 250 };
  respond(t, { ...config(), enabled: true, plans: [configuredPlan], methods: [methods[0]] });
  assert.deepEqual((await fetchDzmmSubscriptionConfig()).plans, [configuredPlan]);
});

test("subscription config accepts the server-controlled billing flag", async t => {
  for (const modelBillingLinked of [false, true]) {
    respond(t, { ...config(), modelBillingLinked });
    assert.equal((await fetchDzmmSubscriptionConfig()).modelBillingLinked, modelBillingLinked);
  }
});

test("subscription config rejects unsupported modes, malformed billing or renewal claims and malformed catalog", async t => {
  for (const fields of [{ mode: "test", testMode: true }, { provider: "stripe" }, { autoRenew: true }, { renewal: "automatic" },
    { modelBillingLinked: "true" }, { modelBillingLinked: null }, { timezone: "UTC" }, { plans: [{ ...plan, durationDays: 31 }] }, { plans: [{ ...plan, maxClaims: 31 }] },
    { plans: [{ ...plan, dailyCredits: -1 }] }, { plans: [{ ...plan, revision: 0 }] }, { plans: [plan, plan] },
    { methods: [methods[0], methods[0]] }, { methods: [{ id: "bank", label: "银行" }] }, { enabled: true, plans: [] }, { enabled: true, methods: [] }]) {
    respond(t, { ...config(), ...fields });
    await assert.rejects(fetchDzmmSubscriptionConfig(), status(502));
  }
});

test("subscription overview uses server day, eligibility and retained credit balance", async t => {
  respond(t, overview());
  const result = await fetchDzmmSubscriptions(context);
  assert.equal(result.checkin.dayKey, "2026-10-05");
  assert.equal(result.checkin.timezone, "Asia/Shanghai");
  assert.equal(result.checkin.resetAt, Date.UTC(2026, 9, 5, 16));
  assert.equal(result.balance, 2800);
  assert.equal(result.checkin.claimable, true);
  respond(t, { ...overview(), subscriptions: [{ ...subscription(), status: "expired", expiresAt: serverTime - 1 }],
    checkin: { ...checkin(), subscriptionId: null, claimable: false, rewardCredits: 0 } });
  const expired = await fetchDzmmSubscriptions(context);
  assert.equal(expired.balance, 2800);
  assert.equal(expired.checkin.claimable, false);
});

test("quarterly membership can retain 90 daily claims through the shared overview without changing historical monthly terms", async t => {
  const quarter = { ...subscription(), planId: "vip_quarterly", label: "叙梦 VIP 三个月", maxClaims: 90,
    expiresAt: serverTime + 90 * 86_400_000, claimsCount: 31, dailyCredits: 500 };
  const quarterOverview = () => ({ ...overview(), subscriptions: [quarter], checkin: { ...checkin(), rewardCredits: 500 } });
  respond(t, quarterOverview());
  const active = await fetchDzmmSubscriptions(context);
  assert.equal(active.subscriptions[0].maxClaims, 90); assert.equal(active.subscriptions[0].claimsCount, 31);
  assert.equal(active.checkin.claimable, true);
  respond(t, { ...overview(), subscriptions: [subscription()] });
  assert.equal((await fetchDzmmSubscriptions(context)).subscriptions[0].maxClaims, 30);
  for (const patch of [{ claimsCount: 91 }, { maxClaims: 89 }, { planId: "month_28" }, { dailyCredits: 250 }]) {
    respond(t, { ...quarterOverview(), subscriptions: [{ ...quarter, ...patch }] });
    await assert.rejects(fetchDzmmSubscriptions(context), status(502));
  }
  respond(t, { ...quarterOverview(), subscriptions: [{ ...quarter, claimsCount: 90 }] });
  await assert.rejects(fetchDzmmSubscriptions(context), status(502));
  respond(t, { ...quarterOverview(), subscriptions: [{ ...quarter, claimsCount: 90 }], checkin: { ...checkin(), rewardCredits: 500, claimable: false } });
  assert.equal((await fetchDzmmSubscriptions(context)).checkin.claimable, false);
});

test("subscription reads reject a different signed-in account or payment context", async t => {
  respond(t, overview());
  await assert.rejects(fetchDzmmSubscriptions({ ...context, accountId: "foreign-account" }), status(409));
  await assert.rejects(fetchDzmmSubscriptions({ ...context, provider: "stripe" }), status(409));
  await assert.rejects(fetchDzmmSubscriptions({ ...context, mode: "test" }), status(409));
});

test("today's claimed credits remain valid after expiry or a same-day period change", async t => {
  const prior = { ...subscription(), status: "expired", expiresAt: serverTime - 1, claimsCount: 1 };
  respond(t, { ...claimed(), subscriptions: [prior] });
  const expired = await fetchDzmmSubscriptions(context);
  assert.equal(expired.subscriptions[0].status, "expired");
  assert.equal(expired.checkin.claimed, true);
  assert.equal(expired.checkin.claimable, false);
  assert.equal(expired.checkin.subscriptionId, prior.id);
  assert.equal(expired.balance, 2900);
  const next = { ...subscription(), id: "subscription_next", orderId: "sp_22222222-2222-4222-8222-222222222222",
    label: "下一期订阅", startsAt: serverTime, dailyCredits: 350 };
  respond(t, { ...claimed(), subscriptions: [next, prior] });
  const changed = await fetchDzmmSubscriptions(context);
  assert.equal(changed.subscriptions.find(entry => entry.status === "active")?.dailyCredits, 350);
  assert.equal(changed.checkin.subscriptionId, prior.id);
  assert.equal(changed.checkin.rewardCredits, 100);
  assert.equal(changed.checkin.claimable, false);
});

test("queued, expired, revoked or exhausted periods cannot be reported as claimable", async t => {
  for (const fields of [{ status: "queued" }, { status: "expired" }, { status: "revoked" }, { claimsCount: 30 },
    { startsAt: serverTime + 1 }, { expiresAt: serverTime }]) {
    respond(t, { ...overview(), subscriptions: [{ ...subscription(), ...fields }] });
    await assert.rejects(fetchDzmmSubscriptions(context), status(502));
  }
  for (const fields of [{ subscriptionId: "unknown" }, { claimed: true, claimedAt: serverTime }, { rewardCredits: 800 }]) {
    respond(t, { ...overview(), checkin: { ...checkin(), ...fields } });
    await assert.rejects(fetchDzmmSubscriptions(context), status(502));
  }
});

test("subscription receipt returns its own order and activation rather than top-up credits", async t => {
  respond(t, { ...overview(), order: { ...order(), status: "paid", paidAt: serverTime, subscriptionId: "subscription_fixture" } });
  const result = await fetchDzmmSubscriptionOrder(orderId, context);
  assert.equal(result.order.subscriptionId, result.subscriptions[0].id);
  assert.equal(result.order.dailyCredits, 100);
  assert.equal("credits" in result.order, false);
  respond(t, { ...overview(), order: { ...order(), accountId: "foreign-account" } });
  await assert.rejects(fetchDzmmSubscriptionOrder(orderId, context), status(502));
  respond(t, { ...overview(), order: { ...order(), id: "sp_22222222-2222-4222-8222-222222222222", checkoutUrl: null } });
  await assert.rejects(fetchDzmmSubscriptionOrder(orderId, context), status(502));
});

test("subscription checkout permits only canonical same-origin subscription order paths", () => {
  assert.equal(isDzmmSubscriptionCheckoutUrl(checkoutUrl, orderId), true);
  const path = `/api/payments/zpay/subscription/checkout/${orderId}`;
  for (const invalid of [`${checkoutUrl}?url=https://example.com`, `${checkoutUrl}#`, `${checkoutUrl}/`, ` ${checkoutUrl}`,
    `https://user@xumengchat.top${path}`, `https://xumengchat.top:443${path}`, `https://xumengchat.top:444${path}`,
    `https://example.com${path}`, `http://xumengchat.top${path}`, `https://xumengchat.top/api/payments/zpay/subscription/../subscription/checkout/${orderId}`,
    `https://xumengchat.top/api/payments/zpay/checkout/zp_${requestId}`, `https://zpayz.cn/submit.php`, path,
    `https://xumengchat.top${path.replace("sp_", "%73p_")}`]) assert.equal(isDzmmSubscriptionCheckoutUrl(invalid, orderId), false, invalid);
  assert.equal(isDzmmSubscriptionCheckoutUrl(checkoutUrl, "sp_22222222-2222-4222-8222-222222222222"), false);
  assert.equal(isDzmmSubscriptionCheckoutUrl(`http://127.0.0.1:3010${path}`, orderId, "http://127.0.0.1:3010"), true);
  assert.equal(isDzmmSubscriptionCheckoutUrl(`http://localhost:3010${path}`, orderId, "http://localhost:3010"), true);
  assert.equal(isDzmmSubscriptionCheckoutUrl(`http://localhost:3020${path}`, orderId, "http://localhost:3010"), false);
});

test("subscription checkout pins plan revision, method and signed-in account in the submitted request", async t => {
  const mock = respond(t, { ...environment, accountId, order: order(), checkoutUrl });
  const result = await createDzmmSubscriptionCheckout(checkout(), plan);
  assert.equal(result.order.planRevision, 1);
  const init = mock.mock.calls[0].arguments[1] as RequestInit;
  assert.deepEqual(JSON.parse(init.body as string), checkout());
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.redirect, "error");
});

test("request recovery uses only its canonical GET and distinguishes a confirmed missing order", async t => {
  const mock = respond(t, { ...environment, accountId, requestId, order: null });
  assert.equal((await fetchDzmmSubscriptionRequest(checkout(), plan)).order, null);
  const [path, init] = mock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(path, `/api/backend/v1/subscriptions/requests/${requestId}`);
  assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error");
});
test("request recovery accepts the original frozen order even without today's catalogue or wallet", async t => {
  for (const state of ["pending", "paid", "expired", "failed", "refunded"]) {
    respond(t, { ...environment, accountId, requestId, order: { ...order(), status: state, paidAt: state === "paid" ? serverTime : null } });
    const result = await fetchDzmmSubscriptionRequest(checkout(), plan);
    assert.equal(result.order?.id, orderId); assert.equal(result.order?.status, state);
  }
});
test("request recovery rejects another key/account, absent order, changed snapshot and unsafe checkout route", async t => {
  const base = { ...environment, accountId, requestId, order: order() };
  for (const value of [{ ...base, requestId: "22222222-2222-4222-8222-222222222222" }, { ...base, accountId: "other" },
    { ...base, order: undefined }, { ...base, order: { ...order(), method: "wxpay" } },
    { ...base, order: { ...order(), amountMinor: 8800 } }, { ...base, order: { ...order(), planRevision: 2 } },
    { ...base, order: { ...order(), checkoutUrl: "https://zpayz.cn/submit.php" } }, { ...base, provider: "stripe" }]) {
    respond(t, value);
    await assert.rejects(fetchDzmmSubscriptionRequest(checkout(), plan), error => status(409)(error) || status(502)(error));
  }
});
test("request recovery errors and account-aborted bodies never become a confirmed missing result", async t => {
  respond(t, { error: "temporary failure" }, 503);
  await assert.rejects(fetchDzmmSubscriptionRequest(checkout(), plan), status(503));
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => { controller.abort(); return Response.json({ ...environment, accountId, requestId, order: null }); });
  await assert.rejects(fetchDzmmSubscriptionRequest(checkout(), plan, controller.signal), { name: "AbortError" });
});
test("invalid saved requests cannot reach the request lookup endpoint", async t => {
  const mock = respond(t, {});
  for (const fields of [{ requestId: "invalid" }, { planRevision: 2 }, { provider: "stripe" }, { mode: "test" }, { method: "bank" }]) {
    await assert.rejects(fetchDzmmSubscriptionRequest({ ...checkout(), ...fields } as DzmmSubscriptionCheckoutRequest, plan), status(400));
  }
  assert.equal(mock.mock.calls.length, 0);
});

test("checkout rejects a price, daily reward, duration, limit or revision drift before redirecting", async t => {
  for (const fields of [{ amountMinor: 8800 }, { dailyCredits: 350 }, { planRevision: 2 }]) {
    respond(t, { ...environment, accountId, order: { ...order(), ...fields }, checkoutUrl });
    await assert.rejects(createDzmmSubscriptionCheckout(checkout(), plan), status(409));
  }
  for (const fields of [{ durationDays: 31 }, { maxClaims: 31 }, { method: "wxpay" }, { currency: "usd" }, { accountId: "foreign-account" }]) {
    respond(t, { ...environment, accountId, order: { ...order(), ...fields }, checkoutUrl });
    await assert.rejects(createDzmmSubscriptionCheckout(checkout(), plan), status(502));
  }
  respond(t, { ...environment, accountId, order: order(), checkoutUrl: "https://zpayz.cn/submit.php" });
  await assert.rejects(createDzmmSubscriptionCheckout(checkout(), plan), status(502));
});

test("subscription gate errors are preserved and do not produce a checkout receipt", async t => {
  respond(t, { error: "订阅购买暂未开放" }, 503);
  await assert.rejects(createDzmmSubscriptionCheckout(checkout(), plan), error => status(503)(error) && (error as Error).message === "订阅购买暂未开放");
});

test("signup and check-in input validation prevents invalid revisions or methods from reaching the server", async t => {
  const mock = respond(t, {});
  for (const fields of [{ planRevision: 0 }, { planRevision: 2 }, { requestId: "invalid" }, { method: "bank" }, { provider: "stripe" }, { mode: "test" }]) {
    await assert.rejects(createDzmmSubscriptionCheckout({ ...checkout(), ...fields } as DzmmSubscriptionCheckoutRequest, plan), status(400));
  }
  await assert.rejects(claimDzmmSubscriptionCredit({ ...claimBody(), requestId: "invalid" }), status(400));
  assert.equal(mock.mock.calls.length, 0);
});

test("daily check-in submits no client date or credit amount and adopts only the server receipt", async t => {
  const mock = respond(t, claimed(), 201);
  const result = await claimDzmmSubscriptionCredit(claimBody());
  assert.equal(result.balance, 2900);
  assert.equal(result.claim.credits, 100);
  assert.equal(result.checkin.claimed, true);
  const init = mock.mock.calls[0].arguments[1] as RequestInit;
  assert.deepEqual(JSON.parse(init.body as string), claimBody());
  assert.equal("dayKey" in JSON.parse(init.body as string), false);
  assert.equal("credits" in JSON.parse(init.body as string), false);
});

test("duplicate-day receipts retain the same balance without optimistic credit additions", async t => {
  respond(t, claimed());
  const first = await claimDzmmSubscriptionCredit(claimBody());
  const again = await claimDzmmSubscriptionCredit(claimBody());
  assert.equal(again.claim.id, first.claim.id);
  assert.equal(again.balance, first.balance);
  assert.equal(again.totalSubscriptionGranted, 100);
});

test("check-in rejects account drift, mismatched days, subscriptions or credited amounts", async t => {
  for (const value of [{ ...claimed(), accountId: "foreign-account" }, { ...claimed(), claim: { ...claimed().claim, subscriptionId: "other" } },
    { ...claimed(), claim: { ...claimed().claim, dayKey: "2026-10-04" } }, { ...claimed(), claim: { ...claimed().claim, credits: 800 } },
    { ...claimed(), checkin: { ...claimed().checkin, claimed: false } }]) {
    respond(t, value);
    await assert.rejects(claimDzmmSubscriptionCredit(claimBody()), error => status(409)(error) || status(502)(error));
  }
});

test("abort signals reject delayed checkout and check-in receipts after the account changes", async t => {
  for (const operation of ["checkout", "claim"] as const) {
    const controller = new AbortController();
    t.mock.method(globalThis, "fetch", async () => {
      controller.abort();
      return Response.json(operation === "checkout" ? { ...environment, accountId, order: order(), checkoutUrl } : claimed());
    });
    await assert.rejects(operation === "checkout" ? createDzmmSubscriptionCheckout(checkout(), plan, controller.signal)
      : claimDzmmSubscriptionCredit(claimBody(), controller.signal), { name: "AbortError" });
  }
});


test("Super access has no fabricated paid period or check-in and remains account bound", async t => {
  const body = { ...overview(), balance: 0, subscriptions: [], superAccess: true, creditUnlimited: true,
    checkin: { ...checkin(), subscriptionId: null, claimable: false, rewardCredits: 0 } };
  respond(t, body); const result = await fetchDzmmSubscriptions(context);
  assert.equal(result.superAccess, true); assert.equal(result.subscriptions.length, 0);
  assert.equal(result.checkin.claimable, false); assert.equal(result.balance, 0);
  for (const flags of [{ superAccess: "true" }, { creditUnlimited: 1 }, { superAccess: false }]) {
    respond(t, { ...body, ...flags }); await assert.rejects(fetchDzmmSubscriptions(context), status(502));
  }
  respond(t, body); await assert.rejects(fetchDzmmSubscriptions({ ...context, accountId: "other" }), status(409));
});

test("Super feature access is independent from its numeric Credit balance and billing", async t => {
  respond(t, { ...overview(), balance: 1_000_000_000, subscriptions: [], superAccess: true, creditUnlimited: false,
    checkin: { ...checkin(), subscriptionId: null, claimable: false, rewardCredits: 0 } });
  const result = await fetchDzmmSubscriptions(context);
  assert.equal(result.superAccess, true);
  assert.equal(result.creditUnlimited, false);
  assert.equal(result.balance, 1_000_000_000);
  assert.equal(result.subscriptions.length, 0);
});
