import assert from "node:assert/strict";
import test from "node:test";
import intentModule from "./dzmm-subscription-intent";
import type { DzmmSubscriptionIntentStorage } from "./dzmm-subscription-intent";
import type { DzmmSubscriptionConfig, DzmmSubscriptionOrder, DzmmSubscriptionPlan } from "./dzmm-subscriptions";
const { createDzmmSubscriptionPurchaseIntent, readDzmmSubscriptionPurchaseIntent, saveDzmmSubscriptionPurchaseIntent,
  clearDzmmSubscriptionPurchaseIntent, canRetryDzmmSubscriptionPurchaseIntent, dzmmSubscriptionIntentStorageKey,
  parseDzmmSubscriptionPurchaseIntent, preserveDzmmSubscriptionFinalOrder } = intentModule as typeof import("./dzmm-subscription-intent");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333", otherRequestId = "44444444-4444-4444-8444-444444444444";
const plan: DzmmSubscriptionPlan = { id: "vip_monthly", label: "原创会员测试", revision: 1, amountMinor: 2800, currency: "cny",
  durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: "Asia/Shanghai" };
const prepared = () => createDzmmSubscriptionPurchaseIntent(owner, plan, "alipay", 1000, requestId);
function storage(): DzmmSubscriptionIntentStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, raw) => { entries.set(key, raw); }, removeItem: key => { entries.delete(key); } };
}
const config = (): DzmmSubscriptionConfig => ({ provider: "zpay", mode: "live", testMode: false, enabled: true,
  modelBillingLinked: false, timezone: "Asia/Shanghai", renewal: "manual", autoRenew: false, plans: [plan], methods: [{ id: "alipay", label: "支付宝" }], note: "" });
const order = (status: DzmmSubscriptionOrder["status"] = "pending"): DzmmSubscriptionOrder => ({ id: `sp_${requestId}`, accountId: owner,
  planId: plan.id, planRevision: plan.revision, label: plan.label, amountMinor: plan.amountMinor, currency: "cny", durationDays: 30,
  dailyCredits: 100, maxClaims: 30, provider: "zpay", mode: "live", method: "alipay", status,
  createdAt: 1000, updatedAt: 1000, paidAt: status === "paid" ? 1000 : null,
  checkoutUrl: `https://xumengchat.top/api/payments/zpay/subscription/checkout/sp_${requestId}`, subscriptionId: null });

test("same-tab storage restores the exact original key, method and frozen plan after a new reader", () => {
  const store = storage(), intent = prepared(); saveDzmmSubscriptionPurchaseIntent(store, intent);
  const loaded = readDzmmSubscriptionPurchaseIntent(store, owner);
  assert.deepEqual(loaded, { state: "ready", intent });
  assert.equal(loaded.state === "ready" && loaded.intent.request.requestId, requestId);
  assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, other), { state: "empty" });
});
test("prepared snapshots do not alias mutable catalogues and tolerate canonical UUID casing", () => {
  const mutable = { ...plan }, intent = createDzmmSubscriptionPurchaseIntent(owner, mutable, "wxpay", 1000, requestId.toUpperCase());
  mutable.amountMinor = 8800; mutable.dailyCredits = 350;
  assert.equal(intent.plan.amountMinor, 2800); assert.equal(intent.plan.dailyCredits, 100); assert.equal(intent.request.method, "wxpay");
  assert.equal(intent.request.requestId, requestId.toLowerCase());
});
test("another unresolved UUID or changed payload cannot replace an original intent", () => {
  const store = storage(), original = prepared(); saveDzmmSubscriptionPurchaseIntent(store, original);
  for (const next of [createDzmmSubscriptionPurchaseIntent(owner, plan, "alipay", 1000, otherRequestId),
    createDzmmSubscriptionPurchaseIntent(owner, { ...plan, revision: 2, amountMinor: 8800 }, "alipay", 1000, requestId)]) {
    assert.throws(() => saveDzmmSubscriptionPurchaseIntent(store, next));
    assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, owner), { state: "ready", intent: original });
  }
  saveDzmmSubscriptionPurchaseIntent(store, original);
});
test("quota/readback errors throw and retain the same prepared UUID for a retry", () => {
  const intent = prepared(), good = storage();
  assert.throws(() => saveDzmmSubscriptionPurchaseIntent({ ...good, setItem: () => { throw new Error("quota"); } }, intent));
  assert.equal(good.entries.size, 0);
  assert.throws(() => saveDzmmSubscriptionPurchaseIntent({ ...good, setItem: () => {} }, intent));
  assert.equal(good.entries.size, 0);
  saveDzmmSubscriptionPurchaseIntent(good, intent);
  assert.deepEqual(readDzmmSubscriptionPurchaseIntent(good, owner), { state: "ready", intent });
});
test("a successful write with a failed readback is recoverable under the original key", () => {
  const intent = prepared(), good = storage(); let written = false;
  assert.throws(() => saveDzmmSubscriptionPurchaseIntent({ ...good,
    setItem: (key, raw) => { good.setItem(key, raw); written = true; },
    getItem: key => { if (written) throw new Error("blocked"); return good.getItem(key); } }, intent));
  assert.deepEqual(readDzmmSubscriptionPurchaseIntent(good, owner), { state: "ready", intent });
  saveDzmmSubscriptionPurchaseIntent(good, intent);
});
test("unreadable/corrupt cache fails closed without deleting or overwriting original bytes", () => {
  const good = storage(), key = dzmmSubscriptionIntentStorageKey(owner); good.entries.set(key, "{not-json");
  const blocked = readDzmmSubscriptionPurchaseIntent(good, owner);
  assert.equal(blocked.state, "blocked"); assert.equal(blocked.state === "blocked" && blocked.original, "{not-json");
  assert.throws(() => saveDzmmSubscriptionPurchaseIntent(good, prepared())); assert.equal(good.entries.get(key), "{not-json");
  assert.equal(readDzmmSubscriptionPurchaseIntent({ ...good, getItem: () => { throw new Error("blocked"); } }, owner).state, "blocked");
});
test("owner, context, incomplete or extra payload and frozen revision mismatches are rejected", () => {
  const intent = prepared();
  for (const change of [
    { request: { ...intent.request, accountId: other } }, { request: { ...intent.request, provider: "stripe" } },
    { request: { ...intent.request, mode: "test" } }, { request: { ...intent.request, method: "bank" } },
    { request: { ...intent.request, requestId: "bad" } }, { request: { ...intent.request, planRevision: 2 } },
    { plan: { ...intent.plan, dailyCredits: -1 } }, { plan: { ...intent.plan, extra: true } }, { createdAt: -1 }, { extra: true },
  ]) assert.throws(() => parseDzmmSubscriptionPurchaseIntent(JSON.stringify({ ...intent, ...change }), owner));
});
test("original replay is permitted only when the immutable offer and payment context still match", () => {
  const intent = prepared(), payment = { provider: "zpay", mode: "live" };
  assert.equal(canRetryDzmmSubscriptionPurchaseIntent(intent, config(), payment), true);
  for (const settings of [null, { ...config(), enabled: false }, { ...config(), plans: [] }, { ...config(), methods: [] },
    ...[{ revision: 2 }, { amountMinor: 8800 }, { dailyCredits: 350 }, { label: "调整会员" }].map(change => ({ ...config(), plans: [{ ...plan, ...change }] }))]) {
    assert.equal(canRetryDzmmSubscriptionPurchaseIntent(intent, settings, payment), false);
  }
  for (const context of [null, { provider: "stripe", mode: "live" }, { provider: "zpay", mode: "test" }]) {
    assert.equal(canRetryDzmmSubscriptionPurchaseIntent(intent, config(), context), false);
  }
});
test("pending, foreign or mismatched final orders cannot clear the durable intent", () => {
  const store = storage(), intent = prepared(); saveDzmmSubscriptionPurchaseIntent(store, intent);
  for (const result of [order(), { ...order("paid"), accountId: other }, { ...order("paid"), method: "wxpay" as const },
    { ...order("paid"), planRevision: 2 }, { ...order("paid"), amountMinor: 8800 }]) {
    assert.equal(clearDzmmSubscriptionPurchaseIntent(store, intent, result), false);
    assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, owner), { state: "ready", intent });
  }
});
test("each known final result clears only its owned request while another account is preserved", () => {
  for (const status of ["paid", "expired", "failed", "refunded"] as const) {
    const store = storage(), intent = prepared(), foreign = createDzmmSubscriptionPurchaseIntent(other, plan, "wxpay", 1000, otherRequestId);
    saveDzmmSubscriptionPurchaseIntent(store, intent); saveDzmmSubscriptionPurchaseIntent(store, foreign);
    assert.equal(clearDzmmSubscriptionPurchaseIntent(store, intent, order(status)), true);
    assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, owner), { state: "empty" });
    assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, other), { state: "ready", intent: foreign });
  }
});
test("late completion cannot clear a replacement request or a corrupt cache", () => {
  const store = storage(), original = prepared(), replacement = createDzmmSubscriptionPurchaseIntent(owner, plan, "alipay", 1000, otherRequestId);
  saveDzmmSubscriptionPurchaseIntent(store, replacement);
  assert.equal(clearDzmmSubscriptionPurchaseIntent(store, original, order("paid")), false);
  assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, owner), { state: "ready", intent: replacement });
  store.entries.set(dzmmSubscriptionIntentStorageKey(owner), "{corrupt");
  assert.throws(() => clearDzmmSubscriptionPurchaseIntent(store, original, order("paid")));
  assert.equal(store.entries.get(dzmmSubscriptionIntentStorageKey(owner)), "{corrupt");
});
test("remove failures and failed delete readback retain a recoverable receipt for explicit cleanup retry", () => {
  const store = storage(), intent = prepared(); saveDzmmSubscriptionPurchaseIntent(store, intent);
  assert.throws(() => clearDzmmSubscriptionPurchaseIntent({ ...store, removeItem: () => { throw new Error("blocked"); } }, intent, order("paid")));
  assert.throws(() => clearDzmmSubscriptionPurchaseIntent({ ...store, removeItem: () => {} }, intent, order("paid")));
  assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, owner), { state: "ready", intent });
  assert.equal(clearDzmmSubscriptionPurchaseIntent(store, intent, order("paid")), true);
});
test("a pending lookup arriving after an owned payment return keeps the known final result and can settle its original intent", () => {
  const store = storage(), intent = prepared(); saveDzmmSubscriptionPurchaseIntent(store, intent);
  for (const status of ["paid", "expired", "failed", "refunded"] as const) {
    const known = { ...order(status), updatedAt: 2000 };
    const adopted = preserveDzmmSubscriptionFinalOrder(order(), known);
    assert.equal(adopted, known); assert.equal(adopted!.status, status);
  }
  const adopted = preserveDzmmSubscriptionFinalOrder(order(), order("paid"))!;
  assert.equal(clearDzmmSubscriptionPurchaseIntent(store, intent, adopted), true);
  assert.deepEqual(readDzmmSubscriptionPurchaseIntent(store, owner), { state: "empty" });
});
test("final observations from another return order or changed immutable offer cannot settle an unknown request", () => {
  const pending = order();
  for (const foreign of [{ ...order("paid"), id: `sp_${otherRequestId}` }, { ...order("paid"), accountId: other },
    { ...order("paid"), planRevision: 2 }, { ...order("paid"), amountMinor: 8800 }, { ...order("paid"), method: "wxpay" as const }]) {
    assert.equal(preserveDzmmSubscriptionFinalOrder(pending, foreign), pending);
  }
  assert.equal(preserveDzmmSubscriptionFinalOrder(null, order("paid")), null);
  assert.equal(preserveDzmmSubscriptionFinalOrder(pending, order()), pending);
});
