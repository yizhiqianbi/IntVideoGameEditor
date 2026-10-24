import { DzmmPaymentError, type DzmmPaymentContext, type DzmmPaymentMethodOption, type DzmmPaymentMethod } from "./dzmm-payments";

export type DzmmSubscriptionPlan = {
  id: string; label: string; revision: number; amountMinor: number; currency: "cny";
  durationDays: 30; dailyCredits: number; maxClaims: 30; timezone: "Asia/Shanghai";
};
export type DzmmSubscriptionConfig = {
  provider: "zpay"; mode: "live"; testMode: false; enabled: boolean;
  timezone: "Asia/Shanghai"; renewal: "manual"; autoRenew: false; modelBillingLinked: boolean;
  methods: DzmmPaymentMethodOption[]; plans: DzmmSubscriptionPlan[]; note: string;
};
export type DzmmSubscription = {
  id: string; orderId: string; planId: string; label: string; status: "active" | "queued" | "expired" | "revoked";
  startsAt: number; expiresAt: number; dailyCredits: number; claimsCount: number; maxClaims: 30 | 90;
};
export type DzmmSubscriptionCheckin = {
  subscriptionId: string | null; dayKey: string; timezone: "Asia/Shanghai";
  claimed: boolean; claimable: boolean; rewardCredits: number; claimedAt: number | null; resetAt: number;
};
export type DzmmSubscriptionOverview = {
  accountId: string; provider: "zpay"; mode: "live"; testMode: false; serverTime: number;
  balance: number; totalSubscriptionGranted: number; subscriptions: DzmmSubscription[]; checkin: DzmmSubscriptionCheckin;
  superAccess?: boolean; creditUnlimited?: boolean;
};
export type DzmmSubscriptionOrder = {
  id: string; accountId: string; planId: string; planRevision: number; label: string;
  amountMinor: number; currency: "cny"; durationDays: 30; dailyCredits: number; maxClaims: 30;
  provider: "zpay"; mode: "live"; method: DzmmPaymentMethod;
  status: "pending" | "paid" | "expired" | "failed" | "refunded";
  createdAt: number; updatedAt: number; paidAt: number | null; checkoutUrl: string | null; subscriptionId: string | null;
};
export type DzmmSubscriptionOrderResult = DzmmSubscriptionOverview & { order: DzmmSubscriptionOrder };
export type DzmmSubscriptionCheckoutRequest = {
  accountId: string; planId: string; planRevision: number; requestId: string;
  provider: "zpay"; mode: "live"; method: DzmmPaymentMethod;
};
export type DzmmSubscriptionCheckoutResult = {
  accountId: string; provider: "zpay"; mode: "live"; testMode: false; order: DzmmSubscriptionOrder; checkoutUrl: string;
};
export type DzmmSubscriptionRequestResult = {
  accountId: string; provider: "zpay"; mode: "live"; testMode: false; requestId: string; order: DzmmSubscriptionOrder | null;
};
export type DzmmSubscriptionClaim = { id: string; subscriptionId: string; dayKey: string; credits: number; claimedAt: number };
export type DzmmSubscriptionClaimResult = DzmmSubscriptionOverview & { claim: DzmmSubscriptionClaim };

const API = "/api/backend/v1/subscriptions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const amount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is number => amount(value) && value <= 8_640_000_000_000_000;
const day = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const method = (value: unknown): value is DzmmPaymentMethod => value === "alipay" || value === "wxpay";
const malformed = () => new DzmmPaymentError(502, "订阅服务返回的数据无效，请刷新后重试。");

function environment(value: Record<string, unknown>, expected?: DzmmPaymentContext) {
  if (value.provider !== "zpay" || value.mode !== "live" || value.testMode !== false) throw malformed();
  if (expected && (expected.mode !== "live" || (expected.provider !== undefined && expected.provider !== "zpay"))) {
    throw new DzmmPaymentError(409, "支付渠道或模式已变更，请刷新后重试。");
  }
  if (expected && value.accountId !== expected.accountId) throw new DzmmPaymentError(409, "账户已切换，请刷新订阅状态后重试。");
}

/** Only the server-owned, order-bound subscription checkout route may be visited. */
export function isDzmmSubscriptionCheckoutUrl(value: unknown, orderId?: string, currentOrigin?: string): value is string {
  if (!text(value, 8192) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const origin = new URL(currentOrigin ?? (typeof window === "undefined" ? "https://qingyu.invalid" : window.location.origin));
    const local = (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") && (origin.protocol === "http:" || origin.protocol === "https:");
    if ((!local && origin.origin !== "https://qingyu.invalid") || url.origin !== origin.origin || url.username || url.password
      || url.search || url.hash || (!local && url.port) || value !== `${url.origin}${url.pathname}`) return false;
    const match = /^\/api\/payments\/(?:zpay\/subscription|guagua\/vip)\/checkout\/(sp_[0-9a-f-]+)$/.exec(url.pathname);
    return !!match && UUID.test(match[1].slice(3)) && (orderId === undefined || match[1] === orderId);
  } catch { return false; }
}

function parsePlan(value: unknown): DzmmSubscriptionPlan {
  if (!record(value) || !text(value.id) || !text(value.label) || !amount(value.revision) || value.revision <= 0
    || !amount(value.amountMinor) || value.amountMinor <= 0 || value.currency !== "cny" || value.durationDays !== 30
    || !amount(value.dailyCredits) || value.dailyCredits <= 0 || value.maxClaims !== 30 || value.timezone !== "Asia/Shanghai") throw malformed();
  return { id: value.id, label: value.label, revision: value.revision, amountMinor: value.amountMinor,
    currency: "cny", durationDays: 30, dailyCredits: value.dailyCredits, maxClaims: 30, timezone: "Asia/Shanghai" };
}

function parseSubscription(value: unknown): DzmmSubscription {
  if (!record(value) || !text(value.id) || !text(value.orderId) || !value.orderId.startsWith("sp_") || !UUID.test(value.orderId.slice(3)) || !text(value.planId) || !text(value.label)
    || !["active", "queued", "expired", "revoked"].includes(value.status as string)
    || !timestamp(value.startsAt) || !timestamp(value.expiresAt) || value.expiresAt <= value.startsAt
    || !amount(value.dailyCredits) || value.dailyCredits <= 0 || !amount(value.claimsCount)
    || (value.maxClaims !== 30 && value.maxClaims !== 90) || value.claimsCount > value.maxClaims
    || (value.maxClaims === 90 && (value.planId !== "vip_quarterly" || value.dailyCredits !== 500))) throw malformed();
  return { id: value.id, orderId: value.orderId, planId: value.planId, label: value.label, status: value.status as DzmmSubscription["status"],
    startsAt: value.startsAt, expiresAt: value.expiresAt, dailyCredits: value.dailyCredits,
    claimsCount: value.claimsCount, maxClaims: value.maxClaims };
}

function parseOverview(value: unknown, expected: DzmmPaymentContext): DzmmSubscriptionOverview {
  if (!record(value)) throw malformed();
  environment(value, expected);
  if ((value.superAccess !== undefined && typeof value.superAccess !== "boolean")
    || (value.creditUnlimited !== undefined && typeof value.creditUnlimited !== "boolean")
    || (value.creditUnlimited === true && value.superAccess !== true)) throw malformed();
  if (!text(value.accountId) || !timestamp(value.serverTime) || !amount(value.balance) || !amount(value.totalSubscriptionGranted)
    || !Array.isArray(value.subscriptions) || value.subscriptions.length > 200 || !record(value.checkin)) throw malformed();
  const subscriptions = value.subscriptions.map(parseSubscription);
  const checkin = value.checkin;
  if ((checkin.subscriptionId !== null && !text(checkin.subscriptionId)) || !day(checkin.dayKey) || checkin.timezone !== "Asia/Shanghai"
    || typeof checkin.claimed !== "boolean" || typeof checkin.claimable !== "boolean" || !amount(checkin.rewardCredits)
    || (checkin.claimedAt !== null && !timestamp(checkin.claimedAt)) || !timestamp(checkin.resetAt)
    || new Set(subscriptions.map(entry => entry.id)).size !== subscriptions.length
    || (checkin.claimed && checkin.claimable)) throw malformed();
  const eligible = subscriptions.find(entry => entry.id === checkin.subscriptionId);
  if (checkin.claimable && (!eligible || eligible.status !== "active" || eligible.startsAt > value.serverTime
    || eligible.expiresAt <= value.serverTime || eligible.claimsCount >= eligible.maxClaims || checkin.rewardCredits !== eligible.dailyCredits)) throw malformed();
  if (checkin.claimed && (checkin.claimedAt === null || !checkin.subscriptionId || checkin.rewardCredits <= 0)) throw malformed();
  return { accountId: value.accountId, provider: "zpay", mode: "live", testMode: false, serverTime: value.serverTime,
    balance: value.balance, totalSubscriptionGranted: value.totalSubscriptionGranted, subscriptions,
    checkin: { subscriptionId: checkin.subscriptionId as string | null, dayKey: checkin.dayKey, timezone: "Asia/Shanghai",
      claimed: checkin.claimed, claimable: checkin.claimable, rewardCredits: checkin.rewardCredits,
      claimedAt: checkin.claimedAt as number | null, resetAt: checkin.resetAt },
    ...(value.superAccess !== undefined ? { superAccess: value.superAccess } : {}),
    ...(value.creditUnlimited !== undefined ? { creditUnlimited: value.creditUnlimited } : {}) };
}

function parseOrder(value: unknown, accountId: string): DzmmSubscriptionOrder {
  if (!record(value) || !text(value.id) || !value.id.startsWith("sp_") || !UUID.test(value.id.slice(3))
    || value.accountId !== accountId || !text(value.planId) || !amount(value.planRevision) || value.planRevision <= 0 || !text(value.label)
    || !amount(value.amountMinor) || value.amountMinor <= 0 || value.currency !== "cny" || value.durationDays !== 30
    || !amount(value.dailyCredits) || value.dailyCredits <= 0 || value.maxClaims !== 30 || value.provider !== "zpay" || value.mode !== "live"
    || !method(value.method) || !["pending", "paid", "expired", "failed", "refunded"].includes(value.status as string)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || (value.paidAt !== null && !timestamp(value.paidAt))
    || (value.subscriptionId !== null && !text(value.subscriptionId))
    || (value.checkoutUrl !== null && !isDzmmSubscriptionCheckoutUrl(value.checkoutUrl, value.id))) throw malformed();
  return { id: value.id, accountId, planId: value.planId, planRevision: value.planRevision, label: value.label,
    amountMinor: value.amountMinor, currency: "cny", durationDays: 30, dailyCredits: value.dailyCredits, maxClaims: 30,
    provider: "zpay", mode: "live", method: value.method, status: value.status as DzmmSubscriptionOrder["status"],
    createdAt: value.createdAt, updatedAt: value.updatedAt, paidAt: value.paidAt as number | null, checkoutUrl: value.checkoutUrl as string | null,
    subscriptionId: value.subscriptionId as string | null };
}

async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      redirect: "error", signal: controller.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) throw new DzmmPaymentError(response.status, record(value) && text(value.error, 500) ? value.error
      : response.status === 401 ? "请登录后查看订阅或领取 Credit。" : "订阅请求失败，请稍后重试。");
    return value;
  } catch (error) {
    if (signal?.aborted || error instanceof DzmmPaymentError) throw error;
    throw new DzmmPaymentError(503, "订阅服务暂时无法连接，请稍后重试。");
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export async function fetchDzmmSubscriptionConfig(signal?: AbortSignal): Promise<DzmmSubscriptionConfig> {
  const value = await request("/config", undefined, signal);
  if (!record(value)) throw malformed();
  environment(value);
  if (typeof value.enabled !== "boolean" || value.timezone !== "Asia/Shanghai" || value.renewal !== "manual" || value.autoRenew !== false
    || typeof value.modelBillingLinked !== "boolean" || typeof value.note !== "string" || value.note.length > 1000
    || !Array.isArray(value.plans) || value.plans.length > 30 || !Array.isArray(value.methods) || value.methods.length > 2) throw malformed();
  const plans = value.plans.map(parsePlan);
  const methods: DzmmPaymentMethodOption[] = value.methods.map(item => {
    if (!record(item) || !method(item.id) || item.label !== (item.id === "alipay" ? "支付宝" : "微信支付")) throw malformed();
    return { id: item.id, label: item.id === "alipay" ? "支付宝" : "微信支付" };
  });
  if (new Set(plans.map(plan => plan.id)).size !== plans.length || new Set(methods.map(item => item.id)).size !== methods.length
    || (value.enabled && (!plans.length || !methods.length))) throw malformed();
  return { provider: "zpay", mode: "live", testMode: false, enabled: value.enabled, timezone: "Asia/Shanghai", renewal: "manual",
    autoRenew: false, modelBillingLinked: value.modelBillingLinked, plans, methods, note: value.note };
}

export async function fetchDzmmSubscriptions(expected: DzmmPaymentContext, signal?: AbortSignal): Promise<DzmmSubscriptionOverview> {
  return parseOverview(await request("", undefined, signal), expected);
}

export async function fetchDzmmSubscriptionOrder(id: string, expected: DzmmPaymentContext, signal?: AbortSignal): Promise<DzmmSubscriptionOrderResult> {
  if (!text(id) || !id.startsWith("sp_") || !UUID.test(id.slice(3))) throw new DzmmPaymentError(400, "订阅订单编号无效。");
  const value = await request(`/orders/${encodeURIComponent(id)}`, undefined, signal);
  const overview = parseOverview(value, expected);
  if (!record(value)) throw malformed();
  const order = parseOrder(value.order, overview.accountId);
  if (order.id !== id) throw malformed();
  return { ...overview, order };
}

/** Resolve an original checkout without querying a payment provider or creating an order. */
export async function fetchDzmmSubscriptionRequest(body: DzmmSubscriptionCheckoutRequest, expectedPlan: DzmmSubscriptionPlan,
  signal?: AbortSignal): Promise<DzmmSubscriptionRequestResult> {
  validateCheckout(body, expectedPlan);
  const requestId = body.requestId.toLowerCase();
  const value = await request(`/requests/${encodeURIComponent(requestId)}`, undefined, signal);
  if (!record(value)) throw malformed();
  environment(value, { accountId: body.accountId, mode: "live", provider: "zpay" });
  if (value.requestId !== requestId || !Object.hasOwn(value, "order")) throw malformed();
  const order = value.order === null ? null : parseOrder(value.order, body.accountId);
  if (order) assertCheckoutOrder(order, body, expectedPlan);
  return { accountId: body.accountId, provider: "zpay", mode: "live", testMode: false, requestId, order };
}

function validateCheckout(body: DzmmSubscriptionCheckoutRequest, expectedPlan: DzmmSubscriptionPlan) {
  if (!text(body.accountId) || !text(body.planId) || !amount(body.planRevision) || body.planRevision <= 0 || !UUID.test(body.requestId)
    || body.mode !== "live" || body.provider !== "zpay" || !method(body.method) || body.planId !== expectedPlan.id || body.planRevision !== expectedPlan.revision) {
    throw new DzmmPaymentError(400, "订阅请求无效，请刷新套餐后重试。");
  }
}
function assertCheckoutOrder(order: DzmmSubscriptionOrder, body: DzmmSubscriptionCheckoutRequest, expectedPlan: DzmmSubscriptionPlan) {
  if (order.planId !== body.planId || order.method !== body.method) throw malformed();
  if (order.planRevision !== expectedPlan.revision || order.amountMinor !== expectedPlan.amountMinor || order.dailyCredits !== expectedPlan.dailyCredits
    || order.durationDays !== expectedPlan.durationDays || order.maxClaims !== expectedPlan.maxClaims) {
    throw new DzmmPaymentError(409, "订阅价格或权益已更新，请刷新并确认新套餐后再支付。");
  }
}

export async function createDzmmSubscriptionCheckout(body: DzmmSubscriptionCheckoutRequest, expectedPlan: DzmmSubscriptionPlan, signal?: AbortSignal): Promise<DzmmSubscriptionCheckoutResult> {
  validateCheckout(body, expectedPlan);
  const value = await request("/checkout", body, signal);
  if (!record(value)) throw malformed();
  environment(value, { accountId: body.accountId, mode: "live", provider: "zpay" });
  const order = parseOrder(value.order, body.accountId);
  if (!isDzmmSubscriptionCheckoutUrl(value.checkoutUrl, order.id)
    || (order.checkoutUrl !== null && order.checkoutUrl !== value.checkoutUrl)) throw malformed();
  assertCheckoutOrder(order, body, expectedPlan);
  return { accountId: body.accountId, provider: "zpay", mode: "live", testMode: false, order, checkoutUrl: value.checkoutUrl };
}

export async function claimDzmmSubscriptionCredit(body: { accountId: string; subscriptionId: string; requestId: string; provider: "zpay"; mode: "live" }, signal?: AbortSignal): Promise<DzmmSubscriptionClaimResult> {
  if (!text(body.accountId) || !text(body.subscriptionId) || !UUID.test(body.requestId) || body.provider !== "zpay" || body.mode !== "live") {
    throw new DzmmPaymentError(400, "签到请求无效，请刷新后重试。");
  }
  const value = await request("/checkin", body, signal);
  const overview = parseOverview(value, body);
  if (!record(value) || !record(value.claim)) throw malformed();
  const claim = value.claim;
  if (!text(claim.id) || claim.subscriptionId !== body.subscriptionId || !day(claim.dayKey) || !amount(claim.credits) || claim.credits <= 0
    || !timestamp(claim.claimedAt) || !overview.checkin.claimed || overview.checkin.subscriptionId !== body.subscriptionId
    || overview.checkin.dayKey !== claim.dayKey || overview.checkin.rewardCredits !== claim.credits || overview.checkin.claimedAt !== claim.claimedAt) throw malformed();
  return { ...overview, claim: { id: claim.id, subscriptionId: body.subscriptionId, dayKey: claim.dayKey, credits: claim.credits, claimedAt: claim.claimedAt } };
}
