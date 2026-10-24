import type { DzmmSubscriptionCheckoutRequest, DzmmSubscriptionConfig, DzmmSubscriptionOrder, DzmmSubscriptionPlan } from "./dzmm-subscriptions";
import type { DzmmPaymentMethod } from "./dzmm-payments";

/** Same-tab refresh/navigation recovery. This is an intent, never proof of payment. */
export type DzmmSubscriptionPurchaseIntent = {
  version: 1; request: DzmmSubscriptionCheckoutRequest; plan: DzmmSubscriptionPlan; createdAt: number;
};
export type DzmmSubscriptionIntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DzmmSubscriptionIntentRead = { state: "empty" } | { state: "ready"; intent: DzmmSubscriptionPurchaseIntent }
  | { state: "blocked"; message: string; original?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const planFields = ["id", "label", "revision", "amountMinor", "currency", "durationDays", "dailyCredits", "maxClaims", "timezone"] as const;
const requestFields = ["accountId", "planId", "planRevision", "requestId", "provider", "mode", "method"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1_000_000;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const invalid = () => new Error("购买记录无法读取，已暂停新购买。请重试读取原记录。");
export class DzmmSubscriptionIntentStorageError extends Error {
  constructor() { super("购买记录未能安全保存，已暂停新购买。请重试保存或恢复原记录。"); this.name = "DzmmSubscriptionIntentStorageError"; }
}
export function dzmmSubscriptionIntentStorageKey(accountId: string): string {
  if (!uuid(accountId)) throw invalid();
  return `qingyu:subscription-purchase:v1:${accountId}`;
}
export function sameDzmmSubscriptionPlan(a: DzmmSubscriptionPlan, b: DzmmSubscriptionPlan): boolean {
  return planFields.every(field => a[field] === b[field]);
}
export function parseDzmmSubscriptionPurchaseIntent(raw: string, accountId: string): DzmmSubscriptionPurchaseIntent {
  if (!uuid(accountId) || raw.length > 8192) throw invalid();
  let value: unknown; try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!record(value) || !keys(value, ["version", "request", "plan", "createdAt"]) || value.version !== 1
    || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0 || Number(value.createdAt) > 8_640_000_000_000_000
    || !record(value.request) || !keys(value.request, requestFields) || !record(value.plan) || !keys(value.plan, planFields)) throw invalid();
  const request = value.request, plan = value.plan;
  if (request.accountId !== accountId || !uuid(request.requestId) || request.provider !== "zpay" || request.mode !== "live"
    || (request.method !== "alipay" && request.method !== "wxpay") || typeof plan.id !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(plan.id)
    || typeof plan.label !== "string" || !plan.label || plan.label.length > 60 || plan.label.trim() !== plan.label || /[\0\r\n]/.test(plan.label)
    || !positive(plan.revision) || !positive(plan.amountMinor) || !positive(plan.dailyCredits) || plan.currency !== "cny"
    || plan.durationDays !== 30 || plan.maxClaims !== 30 || plan.timezone !== "Asia/Shanghai"
    || request.planId !== plan.id || request.planRevision !== plan.revision) throw invalid();
  return { version: 1, request: { accountId, planId: plan.id, planRevision: plan.revision,
    requestId: request.requestId.toLowerCase(), provider: "zpay", mode: "live", method: request.method },
    plan: { id: plan.id, label: plan.label, revision: plan.revision, amountMinor: plan.amountMinor, currency: "cny",
      durationDays: 30, dailyCredits: plan.dailyCredits, maxClaims: 30, timezone: "Asia/Shanghai" }, createdAt: Number(value.createdAt) };
}
export function createDzmmSubscriptionPurchaseIntent(accountId: string, plan: DzmmSubscriptionPlan, method: DzmmPaymentMethod,
  createdAt = Date.now(), requestId = crypto.randomUUID()): DzmmSubscriptionPurchaseIntent {
  return parseDzmmSubscriptionPurchaseIntent(JSON.stringify({ version: 1, request: { accountId, planId: plan.id,
    planRevision: plan.revision, requestId, provider: "zpay", mode: "live", method }, plan, createdAt }), accountId);
}
export function readDzmmSubscriptionPurchaseIntent(storage: DzmmSubscriptionIntentStorage, accountId: string): DzmmSubscriptionIntentRead {
  let original: string | null = null;
  try {
    original = storage.getItem(dzmmSubscriptionIntentStorageKey(accountId));
    return original === null ? { state: "empty" } : { state: "ready", intent: parseDzmmSubscriptionPurchaseIntent(original, accountId) };
  } catch { return { state: "blocked", message: invalid().message, ...(original === null ? {} : { original }) }; }
}
/** Never replace another unresolved key. Readback is required before the caller sends POST. */
export function saveDzmmSubscriptionPurchaseIntent(storage: DzmmSubscriptionIntentStorage, intent: DzmmSubscriptionPurchaseIntent): void {
  const normalized = parseDzmmSubscriptionPurchaseIntent(JSON.stringify(intent), intent.request.accountId), raw = JSON.stringify(normalized);
  try {
    const previous = readDzmmSubscriptionPurchaseIntent(storage, normalized.request.accountId);
    if (previous.state === "blocked" || (previous.state === "ready" && JSON.stringify(previous.intent) !== raw)) throw new DzmmSubscriptionIntentStorageError();
    const key = dzmmSubscriptionIntentStorageKey(normalized.request.accountId);
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new DzmmSubscriptionIntentStorageError();
  } catch { throw new DzmmSubscriptionIntentStorageError(); }
}
export function canRetryDzmmSubscriptionPurchaseIntent(intent: DzmmSubscriptionPurchaseIntent, config: DzmmSubscriptionConfig | null,
  payment: { provider: string; mode: string } | null): boolean {
  const plan = config?.plans.find(entry => entry.id === intent.request.planId);
  return !!config?.enabled && config.provider === intent.request.provider && config.mode === intent.request.mode
    && payment?.provider === intent.request.provider && payment.mode === intent.request.mode && !!plan
    && sameDzmmSubscriptionPlan(plan, intent.plan) && config.methods.some(entry => entry.id === intent.request.method);
}
/** An earlier pending lookup must not downgrade an already observed final result for the same immutable order. */
export function preserveDzmmSubscriptionFinalOrder(incoming: DzmmSubscriptionOrder | null,
  observed?: DzmmSubscriptionOrder): DzmmSubscriptionOrder | null {
  if (!incoming || incoming.status !== "pending" || !observed || observed.status === "pending") return incoming;
  const immutable = ["id", "accountId", "planId", "planRevision", "label", "amountMinor", "currency", "durationDays",
    "dailyCredits", "maxClaims", "provider", "mode", "method", "createdAt"] as const;
  return immutable.every(field => incoming[field] === observed[field]) ? observed : incoming;
}
/** Only an owned, matching, known final result can remove this intent. */
export function clearDzmmSubscriptionPurchaseIntent(storage: DzmmSubscriptionIntentStorage, intent: DzmmSubscriptionPurchaseIntent,
  order: DzmmSubscriptionOrder): boolean {
  if (order.status === "pending" || order.accountId !== intent.request.accountId || order.planId !== intent.request.planId
    || order.planRevision !== intent.request.planRevision || order.method !== intent.request.method || order.provider !== intent.request.provider
    || order.mode !== intent.request.mode || order.amountMinor !== intent.plan.amountMinor || order.dailyCredits !== intent.plan.dailyCredits
    || order.durationDays !== intent.plan.durationDays || order.maxClaims !== intent.plan.maxClaims) return false;
  try {
    const current = readDzmmSubscriptionPurchaseIntent(storage, intent.request.accountId);
    if (current.state === "blocked") throw new DzmmSubscriptionIntentStorageError();
    if (current.state === "ready" && JSON.stringify(current.intent) !== JSON.stringify(intent)) return false;
    const key = dzmmSubscriptionIntentStorageKey(intent.request.accountId);
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new DzmmSubscriptionIntentStorageError();
    return true;
  } catch { throw new DzmmSubscriptionIntentStorageError(); }
}
