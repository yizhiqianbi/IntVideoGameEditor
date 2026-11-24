export type ShelfPaymentMode = "test" | "live";
export type ShelfPaymentProvider = "stripe" | "zpay" | "guagua";
export type ShelfPaymentMethod = "alipay" | "wxpay";
export type ShelfPaymentMethodOption = { id: ShelfPaymentMethod; label: string };
export type ShelfPaymentEnvironment = { mode: "test"; testMode: true } | { mode: "live"; testMode: false };
export type ShelfPaymentContext = { accountId: string; mode: ShelfPaymentMode; provider?: ShelfPaymentProvider };
export type ShelfPaymentStatus = "pending" | "paid" | "partially_refunded" | "refunded" | "expired" | "failed";
export type ShelfPaymentPackage = { id: string; amountMinor: number; currency: string; credits: number; bonusCredits?: number; bonusRatio?: string };
export type ShelfCustomAmount = { id: string; minMinor: number; maxMinor: number; stepMinor: number };
export type ShelfPaymentConfig = ShelfPaymentEnvironment & {
  enabled: boolean; currency: string; provider: ShelfPaymentProvider; methods: ShelfPaymentMethodOption[];
  packages: ShelfPaymentPackage[]; customAmount?: ShelfCustomAmount; note: string; modelBillingLinked: boolean;
};
export type ShelfPaymentOrder = ShelfPaymentPackage & {
  accountId: string; packageId: string; refundedCredits: number; refundedAmountMinor: number;
  status: ShelfPaymentStatus; mode: ShelfPaymentMode; provider: ShelfPaymentProvider; method: ShelfPaymentMethod | null;
  createdAt: number; updatedAt: number;
  paidAt: number | null; checkoutUrl: string | null;
};
export type ShelfPaymentWallet = ShelfPaymentEnvironment & {
  accountId: string; provider: ShelfPaymentProvider; balance: number;
  totalPurchased: number; totalRefunded: number; orders: ShelfPaymentOrder[];
  creditUnlimited?: boolean; billingExempt?: boolean;
};
export type ShelfPaymentOrderResult = ShelfPaymentWallet & { order: ShelfPaymentOrder };
export type ShelfCheckoutResult = ShelfPaymentEnvironment & {
  accountId: string; provider: ShelfPaymentProvider; order: ShelfPaymentOrder; checkoutUrl: string;
};
export type ShelfCheckoutRequest = { packageId: string; amountMinor?: number; accountId: string; requestId: string; mode: ShelfPaymentMode }
  & ({ provider?: "stripe"; method?: never } | { provider: "zpay" | "guagua"; method: ShelfPaymentMethod });
export class ShelfPaymentError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "ShelfPaymentError"; }
}

const API = "/api/backend/v1/payments";
const STATUSES: ShelfPaymentStatus[] = ["pending", "paid", "partially_refunded", "refunded", "expired", "failed"];
const malformed = () => new ShelfPaymentError(502, "充值服务返回的数据无效，请刷新后重试。");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= limit;
const amount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is number => amount(value) && value <= 8_640_000_000_000_000;
const currency = (value: unknown): value is string => typeof value === "string" && /^[a-z]{3}$/.test(value);
const paymentMode = (value: unknown): value is ShelfPaymentMode => value === "test" || value === "live";
const paymentMethod = (value: unknown): value is ShelfPaymentMethod => value === "alipay" || value === "wxpay";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methodLabels: Record<ShelfPaymentMethod, string> = { alipay: "支付宝", wxpay: "微信支付" };
function parseProvider(value: unknown, expected?: ShelfPaymentProvider): ShelfPaymentProvider {
  const provider = value === undefined ? "stripe" : value;
  if (provider !== "stripe" && provider !== "zpay" && provider !== "guagua") throw malformed();
  if (expected !== undefined && provider !== expected) throw new ShelfPaymentError(409, "支付渠道已变更，请刷新余额与套餐后重试。");
  return provider;
}
function parseEnvironment(value: Record<string, unknown>, expectedMode?: ShelfPaymentMode): ShelfPaymentEnvironment {
  if (!paymentMode(value.mode) || value.testMode !== (value.mode === "test")) throw malformed();
  if (expectedMode !== undefined && value.mode !== expectedMode) {
    throw new ShelfPaymentError(409, "支付模式已变更，请刷新余额与套餐后重试。");
  }
  return value.mode === "test" ? { mode: "test", testMode: true } : { mode: "live", testMode: false };
}

/** Only Stripe-hosted HTTPS Checkout URLs may leave the application. */
export function isShelfStripeCheckoutUrl(value: unknown): value is string {
  if (!text(value, 8192) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password && !url.port;
  } catch { return false; }
}

/** Z-Pay signs and submits from our server; the client can only visit a bound, same-origin order route. */
export function isShelfZpayCheckoutUrl(value: unknown, orderId?: string, currentOrigin?: string): value is string {
  if (!text(value, 8192) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const origin = new URL(currentOrigin ?? (typeof window === "undefined" ? "https://contentdesk.local" : window.location.origin));
    const local = (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") && (origin.protocol === "http:" || origin.protocol === "https:");
    if ((!local && origin.origin !== "https://contentdesk.local") || url.origin !== origin.origin
      || url.username || url.password || url.search || url.hash || (!local && url.port)
      || value !== `${url.origin}${url.pathname}`) return false;
    const match = /^\/api\/payments\/zpay\/checkout\/(zp_[0-9a-f-]+)$/.exec(url.pathname);
    return !!match && uuid.test(match[1].slice(3)) && (orderId === undefined || match[1] === orderId);
  } catch { return false; }
}

/** Guagua signs on the server and only exposes a same-origin order route. */
export function isShelfGuaguaCheckoutUrl(value: unknown, orderId?: string, currentOrigin?: string): value is string {
  if (!text(value, 8192) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const origin = new URL(currentOrigin ?? (typeof window === "undefined" ? "https://contentdesk.local" : window.location.origin));
    const local = (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") && (origin.protocol === "http:" || origin.protocol === "https:");
    if ((!local && origin.origin !== "https://contentdesk.local") || url.origin !== origin.origin
      || url.username || url.password || url.search || url.hash || (!local && url.port)
      || value !== `${url.origin}${url.pathname}`) return false;
    const match = /^\/api\/payments\/guagua\/checkout\/(gg_[0-9a-f-]+)$/.exec(url.pathname);
    return !!match && uuid.test(match[1].slice(3)) && (orderId === undefined || match[1] === orderId);
  } catch { return false; }
}

export function isShelfCheckoutUrl(value: unknown, provider: ShelfPaymentProvider, orderId?: string): value is string {
  if (provider === "zpay") return isShelfZpayCheckoutUrl(value, orderId);
  if (provider === "guagua") return isShelfGuaguaCheckoutUrl(value, orderId);
  return isShelfStripeCheckoutUrl(value);
}

function parsePackage(value: unknown): ShelfPaymentPackage {
  if (!record(value) || !text(value.id) || !amount(value.amountMinor) || value.amountMinor <= 0
    || !currency(value.currency) || !amount(value.credits) || value.credits <= 0) throw malformed();
  if (value.bonusCredits !== undefined && !amount(value.bonusCredits)) throw malformed();
  if (value.bonusRatio !== undefined && value.bonusRatio !== "" && !text(value.bonusRatio, 16)) throw malformed();
  return { id: value.id, amountMinor: value.amountMinor, currency: value.currency, credits: value.credits,
    ...(value.bonusCredits === undefined ? {} : { bonusCredits: value.bonusCredits }),
    ...(typeof value.bonusRatio === "string" && value.bonusRatio ? { bonusRatio: value.bonusRatio } : {}) };
}
function parseOrder(value: unknown, accountId: string, mode: ShelfPaymentMode): ShelfPaymentOrder {
  if (!record(value)) throw malformed();
  const fields = parsePackage(value);
  const provider = parseProvider(value.provider);
  const method = value.method === undefined || value.method === null ? null : value.method;
  const cny = provider === "zpay" || provider === "guagua";
  const prefix = provider === "guagua" ? "gg_" : "zp_";
  if (cny ? mode !== "live" || fields.currency !== "cny" || !paymentMethod(method)
    || (provider === "guagua" && method !== "wxpay")
    || !fields.id.startsWith(prefix) || !uuid.test(fields.id.slice(3)) : method !== null) throw malformed();
  if (!text(value.accountId) || value.accountId !== accountId
    || !text(value.packageId) || !amount(value.refundedCredits) || value.refundedCredits > fields.credits
    || !amount(value.refundedAmountMinor) || value.refundedAmountMinor > fields.amountMinor
    || !STATUSES.includes(value.status as ShelfPaymentStatus) || value.mode !== mode
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || (value.paidAt !== null && !timestamp(value.paidAt))
    || (value.checkoutUrl !== null && !isShelfCheckoutUrl(value.checkoutUrl, provider, fields.id))) throw malformed();
  return { ...fields, accountId: value.accountId, packageId: value.packageId, refundedCredits: value.refundedCredits,
    refundedAmountMinor: value.refundedAmountMinor, status: value.status as ShelfPaymentStatus, mode, provider,
    method: method as ShelfPaymentMethod | null,
    createdAt: value.createdAt, updatedAt: value.updatedAt, paidAt: value.paidAt as number | null,
    checkoutUrl: value.checkoutUrl as string | null };
}
function parseWallet(value: unknown, expected?: ShelfPaymentContext): ShelfPaymentWallet {
  if (!record(value) || !text(value.accountId) || !amount(value.balance)
    || !amount(value.totalPurchased) || !amount(value.totalRefunded) || !Array.isArray(value.orders)
    || value.orders.length > 200) throw malformed();
  if ((value.creditUnlimited !== undefined && typeof value.creditUnlimited !== "boolean")
    || (value.billingExempt !== undefined && typeof value.billingExempt !== "boolean")
    || (value.creditUnlimited === true && value.billingExempt !== true)) throw malformed();
  const environment = parseEnvironment(value, expected?.mode);
  const provider = parseProvider(value.provider, expected?.provider);
  if ((provider === "zpay" || provider === "guagua") && environment.mode !== "live") throw malformed();
  if (expected !== undefined && value.accountId !== expected.accountId) throw malformed();
  return { accountId: value.accountId, ...environment, provider, balance: value.balance,
    totalPurchased: value.totalPurchased, totalRefunded: value.totalRefunded,
    orders: value.orders.map(order => parseOrder(order, value.accountId as string, environment.mode)),
    ...(value.creditUnlimited !== undefined ? { creditUnlimited: value.creditUnlimited } : {}),
    ...(value.billingExempt !== undefined ? { billingExempt: value.billingExempt } : {}) };
}
async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const fallback = response.status === 401 ? "请注册或登录后使用充值功能。" : "充值请求失败，请稍后重试。";
      throw new ShelfPaymentError(response.status, record(data) && text(data.error, 500) ? data.error : fallback);
    }
    if (!record(data)) throw malformed();
    return data;
  } catch (failure) {
    if (signal?.aborted || failure instanceof ShelfPaymentError) throw failure;
    throw new ShelfPaymentError(503, "充值服务暂时无法连接，请稍后重试。");
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", abort);
  }
}

export async function fetchShelfPaymentConfig(signal?: AbortSignal): Promise<ShelfPaymentConfig> {
  const value = await request("/config", undefined, signal);
  if (!record(value) || typeof value.enabled !== "boolean" || !currency(value.currency)
    || !Array.isArray(value.packages) || value.packages.length > 30 || typeof value.note !== "string" || value.note.length > 1000
    || typeof value.modelBillingLinked !== "boolean") throw malformed();
  const environment = parseEnvironment(value);
  const provider = parseProvider(value.provider);
  const rawMethods = value.methods === undefined && provider === "stripe" ? [] : value.methods;
  if (!Array.isArray(rawMethods) || rawMethods.length > 2 || (provider === "stripe" && rawMethods.length)) throw malformed();
  const methods: ShelfPaymentMethodOption[] = rawMethods.map(item => {
    if (!record(item) || !paymentMethod(item.id) || item.label !== methodLabels[item.id]) throw malformed();
    return { id: item.id, label: item.label };
  });
  if (new Set(methods.map(item => item.id)).size !== methods.length
    || ((provider === "zpay" || provider === "guagua") && (environment.mode !== "live" || value.currency !== "cny" || (value.enabled && !methods.length)))) throw malformed();
  const packages = value.packages.map(parsePackage);
  if (new Set(packages.map(item => item.id)).size !== packages.length || packages.some(item => item.currency !== value.currency)) throw malformed();
  const custom = value.customAmount;
  if (custom !== undefined && (!record(custom) || !text(custom.id) || packages.some(item => item.id === custom.id)
    || !amount(custom.stepMinor) || custom.stepMinor <= 0 || !amount(custom.minMinor) || custom.minMinor <= 0
    || !amount(custom.maxMinor) || custom.maxMinor < custom.minMinor)) throw malformed();
  const customAmount = custom === undefined ? {} : { customAmount: { id: custom.id as string, minMinor: custom.minMinor as number, maxMinor: custom.maxMinor as number, stepMinor: custom.stepMinor as number } };
  return { enabled: value.enabled, ...environment, provider, methods, currency: value.currency, packages, ...customAmount, note: value.note, modelBillingLinked: value.modelBillingLinked };
}
export async function fetchShelfPaymentWallet(signal?: AbortSignal, expected?: ShelfPaymentContext): Promise<ShelfPaymentWallet> {
  return parseWallet(await request("/wallet", undefined, signal), expected);
}
export async function fetchShelfPaymentOrder(id: string, signal?: AbortSignal, expected?: ShelfPaymentContext): Promise<ShelfPaymentOrderResult> {
  if (!text(id)) throw new ShelfPaymentError(400, "订单编号无效。");
  const value = await request(`/orders/${encodeURIComponent(id)}`, undefined, signal);
  const wallet = parseWallet(value, expected);
  if (!record(value)) throw malformed();
  const order = parseOrder(value.order, wallet.accountId, wallet.mode);
  if (order.id !== id) throw malformed();
  return { ...wallet, order };
}
export async function createShelfCheckout(body: ShelfCheckoutRequest, signal?: AbortSignal, expectedPackage?: ShelfPaymentPackage): Promise<ShelfCheckoutResult> {
  const provider = parseProvider(body.provider);
  if (!text(body.packageId) || !text(body.accountId) || !paymentMode(body.mode) || !uuid.test(body.requestId)
    || (body.amountMinor !== undefined && (provider !== "guagua" || !amount(body.amountMinor) || body.amountMinor <= 0))
    || (provider === "zpay" || provider === "guagua" ? body.mode !== "live" || !paymentMethod(body.method) || (provider === "guagua" && body.method !== "wxpay") : body.method !== undefined)) {
    throw new ShelfPaymentError(400, "充值请求无效，请刷新页面后重试。");
  }
  const value = await request("/checkout", body, signal);
  if (!record(value) || value.accountId !== body.accountId) throw malformed();
  const environment = parseEnvironment(value, body.mode);
  parseProvider(value.provider, provider);
  const order = parseOrder(value.order, body.accountId, environment.mode);
  if (order.provider !== provider || ((provider === "zpay" || provider === "guagua") && order.method !== body.method)
    || !isShelfCheckoutUrl(value.checkoutUrl, provider, order.id) || order.packageId !== body.packageId
    || (order.checkoutUrl !== null && order.checkoutUrl !== value.checkoutUrl)) throw malformed();
  if (order.status === "pending" && expectedPackage && (order.packageId !== expectedPackage.id || order.amountMinor !== expectedPackage.amountMinor
    || order.currency !== expectedPackage.currency || order.credits !== expectedPackage.credits)) {
    throw new ShelfPaymentError(409, "套餐金额或点数已更新，请刷新套餐并确认后再支付。");
  }
  return { accountId: body.accountId, ...environment, provider, order, checkoutUrl: value.checkoutUrl };
}
