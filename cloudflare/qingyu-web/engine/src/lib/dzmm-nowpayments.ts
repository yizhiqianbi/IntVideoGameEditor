export type DzmmNowPaymentsPlan = {
  id: string; label: string; revision: number; amountAtomic: number; currency: "usdt"; decimals: 6;
  durationDays: 30 | 90; dailyCredits: number;
  maxClaims: 30 | 90; timezone: "Asia/Shanghai";
};
export type DzmmNowPaymentsConfig = {
  provider: "nowpayments"; mode: "live"; enabled: boolean; renewal: "manual"; autoRenew: false;
  payCurrency: string | null; plans: DzmmNowPaymentsPlan[]; note: string;
};
export type DzmmNowPaymentsRequest = {
  accountId: string; planId: string; planRevision: number; requestId: string;
  provider: "nowpayments"; mode: "live"; payCurrency: string | null;
};
export type DzmmNowPaymentsOrder = {
  id: string; accountId: string; requestId: string; planId: string; planRevision: number; label: string;
  amountAtomic: number; currency: "usdt"; decimals: 6;
  durationDays: 30 | 90; dailyCredits: number; maxClaims: 30 | 90; timezone: "Asia/Shanghai";
  payCurrency: string | null; invoiceId: string | null; paymentId: string | null;
  payAmount: string | null; payAddress: string | null; quoteExpiresAt: number | null;
  status: "creating" | "unknown" | "pending" | "paid" | "failed" | "expired" | "refunded";
  providerStatus: string | null; checkoutUrl: string | null; createdAt: number; updatedAt: number;
  paidAt: number | null; subscriptionId: string | null; membershipActivated: boolean;
};
export type DzmmNowPaymentsIntent = { version: 1; request: DzmmNowPaymentsRequest; plan: DzmmNowPaymentsPlan; createdAt: number };
export type DzmmNowPaymentsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class DzmmNowPaymentsError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "DzmmNowPaymentsError"; }
}
const API = "/api/backend/v1/nowpayments";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const text = (value: unknown, max = 200): value is string => typeof value === "string" && !!value && value.length <= max && !/[\0\r\n]/.test(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const timestamp = (value: unknown): value is number => integer(value, 0, 8_640_000_000_000_000);
const coin = (value: unknown): value is string | null => value === null || value === "usdttrc20";
const malformed = () => new DzmmNowPaymentsError(502, "付款资料暂时无法核对，请刷新状态后重试。");
const environment = (value: Record<string, unknown>) => { if (value.provider !== "nowpayments" || value.mode !== "live") throw malformed(); };
function exact(value: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw malformed();
}
/** Atomic units are never displayed as fiat cents. 15,000,000 / 10^6 = 15 USDT. */
export function formatDzmmNowPaymentsAmount(amountAtomic: number, decimals: number): string {
  if (!integer(amountAtomic, 1, 1_000_000_000_000) || decimals !== 6) throw malformed();
  const raw = String(amountAtomic).padStart(decimals + 1, "0"), fraction = raw.slice(-decimals).replace(/0+$/, "");
  return `${raw.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
export function parseDzmmNowPaymentsPlan(value: unknown): DzmmNowPaymentsPlan {
  if (!object(value) || !text(value.id, 60) || !/^[a-z][a-z0-9_]{1,59}$/.test(value.id) || !text(value.label, 60)
    || value.label !== value.label.trim() || !integer(value.revision, 1, 1_000_000)
    || value.currency !== "usdt" || value.decimals !== 6 || !productTerms(value.id, value.revision, value.amountAtomic)
    || value.durationDays !== productTerms(value.id, value.revision, value.amountAtomic)!.durationDays
    || value.dailyCredits !== productTerms(value.id, value.revision, value.amountAtomic)!.dailyCredits || value.maxClaims !== value.durationDays || value.timezone !== "Asia/Shanghai") throw malformed();
  return { id: value.id, label: value.label, revision: value.revision, amountAtomic: value.amountAtomic as number, currency: "usdt", decimals: 6,
    durationDays: value.durationDays as 30 | 90, dailyCredits: value.dailyCredits as 100 | 500, maxClaims: value.maxClaims as 30 | 90, timezone: "Asia/Shanghai" };
}
/** Legacy orders keep their monthly terms; only the separately named quarterly product has 90 days. */
function productTerms(id: unknown, revision: unknown, amountAtomic: unknown): { durationDays: 30 | 90; dailyCredits: 100 | 500; maxClaims: 30 | 90 } | null {
  if (id === "vip_monthly" && integer(revision, 1, 1_000_000) && amountAtomic === 5_000_000) return { durationDays: 30, dailyCredits: 100, maxClaims: 30 };
  if (id === "vip_quarterly" && revision === 1 && amountAtomic === 15_000_000) return { durationDays: 90, dailyCredits: 500, maxClaims: 90 };
  return null;
}
export function parseDzmmNowPaymentsConfig(value: unknown): DzmmNowPaymentsConfig {
  if (!object(value)) throw malformed(); environment(value);
  if (typeof value.enabled !== "boolean" || value.renewal !== "manual" || value.autoRenew !== false || !coin(value.payCurrency)
    || !Array.isArray(value.plans) || value.plans.length > 10
    || typeof value.note !== "string" || value.note.length > 1000) throw malformed();
  const plans = value.plans.map(parseDzmmNowPaymentsPlan);
  if (new Set(plans.map(plan => plan.id)).size !== plans.length || (value.enabled && (!plans.length || !value.payCurrency))) throw malformed();
  return { provider: "nowpayments", mode: "live", enabled: value.enabled, renewal: "manual", autoRenew: false,
    payCurrency: value.payCurrency, plans, note: value.note };
}
/** The direct cashier stays on our own HTTPS site; URL returns are never payment evidence. */
export function isDzmmNowPaymentsCheckoutUrl(value: unknown, orderId: string): value is string {
  if (!text(value, 8192) || value !== value.trim() || !orderId.startsWith("sp_") || !uuid(orderId.slice(3))) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://qingyu.invalid" && !url.username && !url.password && !url.port
      && url.pathname === "/" && url.hash === "#recharge" && url.search === `?np_order=${orderId}` && value === url.href;
  } catch { return false; }
}
function parseRequest(value: unknown): DzmmNowPaymentsRequest {
  if (!object(value)) throw malformed();
  exact(value, ["accountId", "planId", "planRevision", "requestId", "provider", "mode", "payCurrency"]);
  environment(value);
  if (!uuid(value.accountId) || !uuid(value.requestId) || !text(value.planId, 60) || !/^[a-z][a-z0-9_]{1,59}$/.test(value.planId)
    || !integer(value.planRevision, 1, 1_000_000) || !coin(value.payCurrency)) throw malformed();
  return { accountId: value.accountId, planId: value.planId, planRevision: value.planRevision, requestId: value.requestId.toLowerCase(),
    provider: "nowpayments", mode: "live", payCurrency: value.payCurrency };
}
export function parseDzmmNowPaymentsOrder(value: unknown, accountId: string, intent?: DzmmNowPaymentsIntent): DzmmNowPaymentsOrder {
  if (!object(value) || !uuid(accountId) || value.accountId !== accountId || !text(value.id, 39) || !value.id.startsWith("sp_") || !uuid(value.id.slice(3))
    || !uuid(value.requestId) || !text(value.planId, 60) || !integer(value.planRevision, 1, 1_000_000) || !text(value.label, 60)
    || !productTerms(value.planId, value.planRevision, value.amountAtomic) || value.currency !== "usdt" || value.decimals !== 6 || !coin(value.payCurrency)
    || (value.invoiceId !== null && (typeof value.invoiceId !== "string" || !/^\d{1,40}$/.test(value.invoiceId)))
    || (value.paymentId !== null && (typeof value.paymentId !== "string" || !/^\d{1,40}$/.test(value.paymentId)))
    || !["creating", "unknown", "pending", "paid", "failed", "expired", "refunded"].includes(String(value.status))
    || (value.providerStatus !== null && !text(value.providerStatus, 60)) || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
    || value.updatedAt < value.createdAt || (value.paidAt !== null && (!timestamp(value.paidAt) || value.paidAt < value.createdAt))
    || (value.subscriptionId !== null && !text(value.subscriptionId, 200)) || typeof value.membershipActivated !== "boolean"
    || (value.quoteExpiresAt !== null && !timestamp(value.quoteExpiresAt))
    || (value.payAmount !== null && value.payAmount !== formatDzmmNowPaymentsAmount(value.amountAtomic as number, 6))
    || (value.payAddress !== null && (typeof value.payAddress !== "string" || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value.payAddress)))
    || ((value.payAddress !== null || value.payAmount !== null) && (!value.payAddress || !value.payAmount || value.payCurrency !== "usdttrc20" || !value.paymentId))
    || (value.checkoutUrl !== null && !isDzmmNowPaymentsCheckoutUrl(value.checkoutUrl, value.id))
    || (value.membershipActivated && ((!['paid', 'refunded'].includes(String(value.status))) || !value.paymentId || !value.subscriptionId || value.paidAt === null
      || (value.status === "paid" && value.providerStatus !== "finished")))) throw malformed();
  const terms = productTerms(value.planId, value.planRevision, value.amountAtomic)!;
  const fields = ["durationDays", "dailyCredits", "maxClaims", "timezone"] as const;
  const hasTerms = fields.some(field => Object.hasOwn(value, field));
  // Receipts issued before this upgrade omitted entitlement fields. Only their unchanged monthly tuple may be inferred.
  if ((!hasTerms && value.planId !== "vip_monthly") || (hasTerms && (value.durationDays !== terms.durationDays
    || value.dailyCredits !== terms.dailyCredits || value.maxClaims !== terms.maxClaims || value.timezone !== "Asia/Shanghai"))) throw malformed();
  const order = { ...value, durationDays: terms.durationDays, dailyCredits: terms.dailyCredits, maxClaims: terms.maxClaims, timezone: "Asia/Shanghai" } as unknown as DzmmNowPaymentsOrder;
  if (intent && (order.requestId.toLowerCase() !== intent.request.requestId || order.planId !== intent.plan.id || order.planRevision !== intent.plan.revision
    || order.amountAtomic !== intent.plan.amountAtomic || order.decimals !== intent.plan.decimals || order.currency !== intent.plan.currency
    || order.label !== intent.plan.label || order.durationDays !== intent.plan.durationDays || order.dailyCredits !== intent.plan.dailyCredits
    || order.maxClaims !== intent.plan.maxClaims || order.timezone !== intent.plan.timezone
    || order.payCurrency !== intent.request.payCurrency)) throw new DzmmNowPaymentsError(409, "订单与原购买方案不一致，已暂停付款。请重新核对原记录。");
  return { id: order.id, accountId: order.accountId, requestId: order.requestId.toLowerCase(), planId: order.planId,
    planRevision: order.planRevision, label: order.label, amountAtomic: order.amountAtomic, currency: "usdt", decimals: 6,
    durationDays: order.durationDays, dailyCredits: order.dailyCredits, maxClaims: order.maxClaims, timezone: "Asia/Shanghai",
    payCurrency: order.payCurrency, invoiceId: order.invoiceId, paymentId: order.paymentId, payAmount: order.payAmount,
    payAddress: order.payAddress, quoteExpiresAt: order.quoteExpiresAt, status: order.status, providerStatus: order.providerStatus,
    checkoutUrl: order.checkoutUrl, createdAt: order.createdAt, updatedAt: order.updatedAt, paidAt: order.paidAt,
    subscriptionId: order.subscriptionId, membershipActivated: order.membershipActivated };
}
export const isDzmmNowPaymentsFinal = (order: DzmmNowPaymentsOrder): boolean => order.status === "paid" && order.membershipActivated
  || ["failed", "expired", "refunded"].includes(order.status);
/** A delayed clipboard result belongs to one receipt, including while a new request is being prepared. */
export function matchesDzmmNowPaymentsClipboardTarget(current: DzmmNowPaymentsOrder | null, captured: DzmmNowPaymentsOrder,
  pendingRequestId: string | null): boolean {
  return !!current && !!captured.payAddress && current.accountId === captured.accountId && current.id === captured.id
    && current.requestId === captured.requestId && current.payAddress === captured.payAddress
    && (!pendingRequestId || pendingRequestId === captured.requestId);
}
export function dzmmNowPaymentsStatus(order: DzmmNowPaymentsOrder): { title: string; message: string } {
  if (order.status === "refunded") return { title: "订单已退款", message: "请以订单及会员状态为准；如需帮助，请联系管理员核对。" };
  if (order.status === "failed") return { title: "付款未完成", message: "这笔订单未开通会员。请核对钱包付款记录和原订单结果后再尝试。" };
  if (order.status === "expired") return { title: "订单已过期", message: "请勿继续向过期订单转账。已转账时请联系管理员核对原订单。" };
  if (order.status === "paid" && order.membershipActivated) return { title: "VIP 已开通", message: "服务器已确认付款并开通会员。已有会员续订会接续当前有效期；具体日期以会员状态为准。" };
  if (order.status === "paid" || order.providerStatus === "finished") return { title: "付款已确认 · 核对会员开通", message: "付款结果已收到，会员权益仍在核对中。请刷新订单和会员状态。" };
  if (order.providerStatus === "partially_paid") return { title: "已收到部分付款", message: "会员尚未开通，请按原收银台显示的金额、币种与网络核对付款，不要另建订单。" };
  if (["confirming", "confirmed", "sending"].includes(order.providerStatus ?? "")) return { title: "等待链上确认", message: "已收到付款进度，仍在等待链上确认和服务器核对。会员尚未开通，请勿重复付款。" };
  if (order.status === "unknown" || order.status === "creating") return { title: "原订单仍在核对", message: "购买请求结果尚未确定。原请求已保留，请恢复原记录，不会重复创建付款订单。" };
  return { title: "等待付款确认", message: "请按本订单的准确金额与 TRC20 网络向专属地址转账。会员仍需链上及服务器确认后开通。" };
}
const storageFailure = () => new DzmmNowPaymentsError(503, "原购买记录未能安全保存或读取，已暂停新购买。请恢复原记录后重试。");
export function dzmmNowPaymentsStorageKey(accountId: string): string { if (!uuid(accountId)) throw malformed(); return `qingyu:nowpayments-purchase:v1:${accountId}`; }
export function parseDzmmNowPaymentsIntent(raw: string, accountId: string): DzmmNowPaymentsIntent {
  if (!uuid(accountId) || raw.length > 8192) throw storageFailure();
  let value: unknown; try { value = JSON.parse(raw); } catch { throw storageFailure(); }
  if (!object(value)) throw storageFailure(); exact(value, ["version", "request", "plan", "createdAt"]);
  const request = parseRequest(value.request), plan = parseDzmmNowPaymentsPlan(value.plan);
  if (value.version !== 1 || request.accountId !== accountId || request.planId !== plan.id || request.planRevision !== plan.revision || !timestamp(value.createdAt)) throw storageFailure();
  return { version: 1, request, plan, createdAt: value.createdAt };
}
export function createDzmmNowPaymentsIntent(accountId: string, plan: DzmmNowPaymentsPlan, payCurrency: string | null,
  requestId = crypto.randomUUID(), createdAt = Date.now()): DzmmNowPaymentsIntent {
  return parseDzmmNowPaymentsIntent(JSON.stringify({ version: 1, request: { accountId, planId: plan.id, planRevision: plan.revision,
    requestId, provider: "nowpayments", mode: "live", payCurrency }, plan, createdAt }), accountId);
}
export function readDzmmNowPaymentsIntent(storage: DzmmNowPaymentsStorage, accountId: string): DzmmNowPaymentsIntent | null {
  try { const raw = storage.getItem(dzmmNowPaymentsStorageKey(accountId)); return raw === null ? null : parseDzmmNowPaymentsIntent(raw, accountId); }
  catch { throw storageFailure(); }
}
/** Preserve the first UUID and frozen quote; verified readback is required before POST. */
export function saveDzmmNowPaymentsIntent(storage: DzmmNowPaymentsStorage, intent: DzmmNowPaymentsIntent): void {
  try {
    const parsed = parseDzmmNowPaymentsIntent(JSON.stringify(intent), intent.request.accountId), raw = JSON.stringify(parsed);
    const prior = readDzmmNowPaymentsIntent(storage, parsed.request.accountId);
    if (prior && JSON.stringify(prior) !== raw) throw storageFailure();
    const key = dzmmNowPaymentsStorageKey(parsed.request.accountId); storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw storageFailure();
  } catch { throw storageFailure(); }
}
export function clearDzmmNowPaymentsIntent(storage: DzmmNowPaymentsStorage, intent: DzmmNowPaymentsIntent, order: DzmmNowPaymentsOrder): boolean {
  parseDzmmNowPaymentsOrder(order, intent.request.accountId, intent);
  if (!isDzmmNowPaymentsFinal(order)) return false;
  const key = dzmmNowPaymentsStorageKey(intent.request.accountId), current = readDzmmNowPaymentsIntent(storage, intent.request.accountId);
  if (!current || JSON.stringify(current) !== JSON.stringify(intent)) return false;
  storage.removeItem(key); if (storage.getItem(key) !== null) throw storageFailure(); return true;
}
export function sameDzmmNowPaymentsPlan(left: DzmmNowPaymentsPlan, right: DzmmNowPaymentsPlan): boolean {
  return (Object.keys(parseDzmmNowPaymentsPlan(left)) as (keyof DzmmNowPaymentsPlan)[]).every(key => left[key] === right[key]);
}
/** A confirmed empty lookup can retry the same saved request only under its unchanged current offer. */
export function canRetryDzmmNowPaymentsIntent(intent: DzmmNowPaymentsIntent | null, config: DzmmNowPaymentsConfig | null,
  order: DzmmNowPaymentsOrder | null, confirmedNotFound: boolean): boolean {
  return !!intent && !!config?.enabled && !!config.payCurrency && !order && confirmedNotFound
    && config.payCurrency === intent.request.payCurrency && config.plans.some(plan => sameDzmmNowPaymentsPlan(plan, intent.plan));
}
/** An older read may not undo a terminal receipt for the same immutable order. */
export function preserveDzmmNowPaymentsOrder(incoming: DzmmNowPaymentsOrder, observed: DzmmNowPaymentsOrder | null): DzmmNowPaymentsOrder {
  const fields = ["id", "accountId", "requestId", "planId", "planRevision", "label", "amountAtomic", "currency", "decimals", "durationDays", "dailyCredits", "maxClaims", "timezone", "payCurrency", "createdAt"] as const;
  return observed && isDzmmNowPaymentsFinal(observed) && !isDzmmNowPaymentsFinal(incoming) && fields.every(key => incoming[key] === observed[key]) ? observed : incoming;
}
async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 20_000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(API + path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      redirect: "error", signal: controller.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null); controller.signal.throwIfAborted();
    if (!response.ok) throw new DzmmNowPaymentsError(response.status, publicRestriction(value) ?? (response.status === 401 || response.status === 403 ? "请登录正式账号后查看购买记录。"
      : response.status === 409 ? "购买方案或原订单状态已变化，请先恢复原记录。" : "购买结果暂时无法核对，原请求会保留，请稍后恢复原记录。"));
    if (!object(value)) throw malformed(); return value;
  } catch (error) {
    if (signal?.aborted || error instanceof DzmmNowPaymentsError) throw error;
    throw new DzmmNowPaymentsError(503, "付款服务暂时无法连接，原购买请求会保留。请恢复原记录后重试。");
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
function publicRestriction(value: unknown): string | null {
  if (!object(value)) return null;
  if (value.code === "nowpayments_minimum_unavailable") return "暂时无法核对 TRC20 最低收款金额，购买请求已保留。请稍后核对原记录后重试。";
  if (value.code === "nowpayments_minimum_exceeds_plan" && value.payCurrency === "usdttrc20" && typeof value.minimumAmount === "string"
    && /^(?:0|[1-9]\d{0,7})(?:\.\d{1,12})?$/.test(value.minimumAmount) && Number(value.minimumAmount) > 0) {
    return `TRC20 当前最低收款金额为 ${value.minimumAmount} USDT，超过本方案金额，暂时无法购买。原购买请求已保留，请稍后核对原记录。`;
  }
  return null;
}
export async function fetchDzmmNowPaymentsConfig(signal?: AbortSignal): Promise<DzmmNowPaymentsConfig> {
  return parseDzmmNowPaymentsConfig(await request("/config", undefined, signal));
}
export async function fetchDzmmNowPaymentsRequest(intent: DzmmNowPaymentsIntent, signal?: AbortSignal): Promise<DzmmNowPaymentsOrder | null> {
  const value = await request(`/requests/${encodeURIComponent(intent.request.requestId)}`, undefined, signal); environment(value);
  if (value.accountId !== intent.request.accountId || value.requestId !== intent.request.requestId) throw malformed();
  return value.order === null ? null : parseDzmmNowPaymentsOrder(value.order, intent.request.accountId, intent);
}
export async function fetchDzmmNowPaymentsOrder(accountId: string, orderId: string, signal?: AbortSignal, intent?: DzmmNowPaymentsIntent): Promise<DzmmNowPaymentsOrder> {
  if (!uuid(accountId) || !orderId.startsWith("sp_") || !uuid(orderId.slice(3))) throw malformed();
  const value = await request(`/orders/${encodeURIComponent(orderId)}`, undefined, signal); environment(value);
  if (value.accountId !== accountId) throw malformed();
  const order = parseDzmmNowPaymentsOrder(value.order, accountId, intent); if (order.id !== orderId) throw malformed(); return order;
}
/** Request recovery finds the owned order; known payments use the order endpoint to reconcile missed notifications. */
export async function recoverDzmmNowPaymentsOrder(intent: DzmmNowPaymentsIntent, observed: DzmmNowPaymentsOrder | null,
  signal?: AbortSignal): Promise<DzmmNowPaymentsOrder | null> {
  const sameRequest = observed?.accountId === intent.request.accountId && observed.requestId === intent.request.requestId;
  if (sameRequest && observed.paymentId && !isDzmmNowPaymentsFinal(observed)) {
    parseDzmmNowPaymentsOrder(observed, intent.request.accountId, intent);
    return fetchDzmmNowPaymentsOrder(intent.request.accountId, observed.id, signal, intent);
  }
  const found = await fetchDzmmNowPaymentsRequest(intent, signal);
  return found?.paymentId && !isDzmmNowPaymentsFinal(found)
    ? fetchDzmmNowPaymentsOrder(intent.request.accountId, found.id, signal, intent) : found;
}
export async function createDzmmNowPaymentsCheckout(intent: DzmmNowPaymentsIntent, signal?: AbortSignal): Promise<DzmmNowPaymentsOrder> {
  const parsed = parseDzmmNowPaymentsIntent(JSON.stringify(intent), intent.request.accountId), value = await request("/checkout", parsed.request, signal); environment(value);
  if (value.accountId !== parsed.request.accountId || value.requestId !== parsed.request.requestId) throw malformed();
  const order = parseDzmmNowPaymentsOrder(value.order, parsed.request.accountId, parsed);
  if (value.checkoutUrl !== order.checkoutUrl) throw malformed(); return order;
}
