import { DzmmPaymentError } from "./dzmm-payments";

export type DzmmWaffoPlan = { id: "vip_monthly_cny"; revision: 1; label: string; amountMinor: number; currency: "cny"; durationDays: 30; dailyCredits: number; maxClaims: 30; timezone: "Asia/Shanghai" };
export type DzmmWaffoConfig = { provider: "waffo"; mode: "sandbox" | "live"; enabled: boolean; collectionEnabled: boolean; renewal: "manual"; autoRenew: false; plan: DzmmWaffoPlan; note: string };
export type DzmmWaffoOrder = Omit<DzmmWaffoPlan, "id" | "revision"> & { planId: "vip_monthly_cny"; planRevision: 1; id: string; accountId: string; provider: "waffo"; mode: "sandbox" | "live"; method: "wechat"; status: "pending" | "paid" | "failed" | "expired"; createdAt: number; updatedAt: number; paidAt: number | null; checkoutUrl: string };
export type DzmmWaffoCheckoutRequest = { accountId: string; requestId: string; provider: "waffo"; mode: "sandbox" | "live" };
export type DzmmWaffoCheckoutResult = { provider: "waffo"; mode: "sandbox" | "live"; renewal: "manual"; accountId: string; requestId: string; order: DzmmWaffoOrder; checkoutUrl: string; expiresAt: number | null };

const API = "/api/backend/v1/waffo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const amount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is number => amount(value) && value <= 8640000000000000;
const malformed = () => new DzmmPaymentError(502, "Waffo 会员服务返回的数据无效，请刷新后重试。");

/** Waffo cashiers are external; only documented HTTPS hosts and an exact token fragment are accepted. */
function isStoredWaffoCheckoutUrl(value: unknown): value is string {
  if (!text(value, 8192) || value !== value.trim()) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash && ["pancake.waffo.ai", "pancake-sandbox.waffo.ai", "cashier.waffo.com", "cashier-sandbox.waffo.com"].includes(url.hostname); } catch { return false; }
}

export function isDzmmWaffoCheckoutUrl(value: unknown): value is string {
  if (!text(value, 8192) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search) return false;
    if (!["pancake.waffo.ai", "pancake-sandbox.waffo.ai", "cashier.waffo.com", "cashier-sandbox.waffo.com"].includes(url.hostname)) return false;
    return /^#token=[A-Za-z0-9._~-]{16,4096}$/.test(url.hash);
  } catch { return false; }
}

function parsePlan(value: unknown): DzmmWaffoPlan {
  if (!record(value) || value.id !== "vip_monthly_cny" || value.revision !== 1 || !text(value.label)
    || !amount(value.amountMinor) || value.amountMinor <= 0 || value.currency !== "cny" || value.durationDays !== 30
    || !amount(value.dailyCredits) || value.dailyCredits <= 0 || value.maxClaims !== 30 || value.timezone !== "Asia/Shanghai") throw malformed();
  return { id: "vip_monthly_cny", revision: 1, label: value.label as string, amountMinor: value.amountMinor, currency: "cny", durationDays: 30,
    dailyCredits: value.dailyCredits, maxClaims: 30, timezone: "Asia/Shanghai" };
}
function environment(value: Record<string, unknown>): DzmmWaffoConfig["mode"] {
  if (value.provider !== "waffo" || (value.mode !== "sandbox" && value.mode !== "live") || value.renewal !== "manual" || value.autoRenew !== false) throw malformed();
  return value.mode;
}
function parseOrder(value: unknown, accountId: string, mode: DzmmWaffoConfig["mode"]): DzmmWaffoOrder {
  if (!record(value) || !text(value.id) || !value.id.startsWith("sp_") || !UUID.test(value.id.slice(3)) || value.accountId !== accountId
    || value.provider !== "waffo" || value.mode !== mode || value.method !== "wechat" || !text(value.status)
    || !["pending", "paid", "failed", "expired"].includes(value.status as string) || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
    || (value.paidAt !== null && !timestamp(value.paidAt)) || !isStoredWaffoCheckoutUrl(value.checkoutUrl)) throw malformed();
  const plan = parsePlan({ ...value, id: value.planId, revision: value.planRevision });
  return { ...plan, planId: plan.id, planRevision: plan.revision, id: value.id, accountId, provider: "waffo", mode, method: "wechat", status: value.status as DzmmWaffoOrder["status"],
    createdAt: value.createdAt, updatedAt: value.updatedAt, paidAt: value.paidAt as number | null, checkoutUrl: value.checkoutUrl };
}
async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController(); const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json().catch(() => null); controller.signal.throwIfAborted();
    if (!response.ok) throw new DzmmPaymentError(response.status, record(value) && text(value.error, 500) ? value.error : "Waffo 会员请求失败，请稍后重试。");
    return value;
  } catch (error) { if (signal?.aborted || error instanceof DzmmPaymentError) throw error; throw new DzmmPaymentError(503, "Waffo 会员服务暂时无法连接，请稍后重试。"); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export async function fetchDzmmWaffoConfig(signal?: AbortSignal): Promise<DzmmWaffoConfig> {
  const value = await request("/config", undefined, signal); if (!record(value)) throw malformed();
  const mode = environment(value);
  if (typeof value.enabled !== "boolean" || typeof value.collectionEnabled !== "boolean" || !text(value.note, 1000)) throw malformed();
  return { provider: "waffo", mode, enabled: value.enabled, collectionEnabled: value.collectionEnabled, renewal: "manual", autoRenew: false, plan: parsePlan(value.plan), note: value.note };
}

export async function fetchDzmmWaffoOrderByRequest(requestId: string, accountId: string, mode: DzmmWaffoConfig["mode"], signal?: AbortSignal): Promise<DzmmWaffoOrder | null> {
  if (!UUID.test(requestId) || !text(accountId)) throw new DzmmPaymentError(400, "Waffo 订单请求无效。");
  const value = await request(`/requests/${encodeURIComponent(requestId.toLowerCase())}`, undefined, signal);
  if (!record(value) || value.provider !== "waffo" || value.mode !== mode || value.accountId !== accountId || value.requestId !== requestId.toLowerCase() || !Object.hasOwn(value, "order")) throw malformed();
  return value.order === null ? null : parseOrder(value.order, accountId, mode);
}

export async function createDzmmWaffoCheckout(body: DzmmWaffoCheckoutRequest, plan: DzmmWaffoPlan, signal?: AbortSignal): Promise<DzmmWaffoCheckoutResult> {
  if (!text(body.accountId) || !UUID.test(body.requestId) || body.provider !== "waffo" || (body.mode !== "sandbox" && body.mode !== "live")) throw new DzmmPaymentError(400, "Waffo 会员请求无效，请刷新套餐后重试。");
  const value = await request("/checkout", body, signal); if (!record(value)) throw malformed();
  const mode = environment(value); if (value.accountId !== body.accountId || value.requestId !== body.requestId.toLowerCase() || value.renewal !== "manual") throw malformed();
  if (!record(value.order)) throw malformed();
  const order = parseOrder(value.order, body.accountId, mode);
  if (order.mode !== body.mode || order.id !== value.order.id || order.amountMinor !== plan.amountMinor || order.dailyCredits !== plan.dailyCredits || order.planId !== plan.id || order.planRevision !== plan.revision || !isDzmmWaffoCheckoutUrl(value.checkoutUrl) || value.checkoutUrl.replace(/#token=[^#]+$/, "") !== order.checkoutUrl) throw malformed();
  if (value.expiresAt !== null && !timestamp(value.expiresAt)) throw malformed();
  return { provider: "waffo", mode, renewal: "manual", accountId: body.accountId, requestId: body.requestId.toLowerCase(), order, checkoutUrl: value.checkoutUrl, expiresAt: value.expiresAt as number | null };
}
