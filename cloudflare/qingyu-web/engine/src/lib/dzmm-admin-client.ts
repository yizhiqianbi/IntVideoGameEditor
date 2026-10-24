export type DzmmAdminRole = "user" | "super";
type DzmmAdminPaymentProvider = "stripe" | "zpay" | "subscription" | "nowpayments";
export type DzmmAdminUser = {
  id: string; email: string | null; nickname: string; isGuest: boolean; role: DzmmAdminRole;
  createdAt: number; emailVerified: boolean; creditUnlimited: boolean;
  availableCredits: number; reservedCredits: number; totalSpentCredits: number; debtCredits: number; adminAdjustedCredits: number;
  subscription: { active: boolean; expiresAt: number | null };
};
export type DzmmAdminOverview = {
  accountId: string; serverTime: number;
  stats: { users: number; registeredUsers: number; guestUsers: number; superUsers: number;
    totalAvailableCredits: number; totalReservedCredits: number; totalSpentCredits: number;
    pendingUsage: number; activeSubscriptions: number; pendingSubmissions: number; forumPosts: number };
  revenue: { provider: DzmmAdminPaymentProvider; currency: string; amountMinor: number; amountScale?: 2 | 6; paidOrders: number; mode: "live" | "test" }[];
  billing: { enabled: boolean; priceRevision: number | null };
  capabilities: { userRoles: boolean; creditAdjustments: boolean; paymentOrders: boolean; usageMetadata: boolean; privateConversations: false };
};
export type DzmmAdminOrder = {
  id: string; userId: string; nickname: string; provider: DzmmAdminPaymentProvider;
  mode: "live" | "test"; kind: "recharge" | "subscription"; currency: string; amountMinor: number; amountScale?: 2 | 6;
  credits: number | null; status: string; createdAt: number; paidAt: number | null;
};
export type DzmmAdminSubscription = {
  id: string; userId: string; nickname: string; planId: string; label: string;
  status: "active" | "scheduled" | "expired" | "revoked"; startsAt: number; expiresAt: number;
  dailyCredits: number; claimsCount: number; maxClaims: number;
};
export type DzmmAdminUsage = {
  id: string; userId: string; nickname: string; operation: string; model: string; status: string;
  chargedCredits: number; reservedCredits: number; providerCostUsd: number | null;
  promptTokens: number | null; completionTokens: number | null; billingExempt: boolean;
  createdAt: number; finalizedAt: number | null;
};
export type DzmmAdminAudit = {
  id: string; actorId: string; targetUserId: string; requestId: string; action: "credit_adjustment" | "role_change";
  delta?: number; previousRole?: DzmmAdminRole; role?: DzmmAdminRole; reason: string; createdAt: number;
};
export type DzmmAdminPage<T> = { accountId: string; items: T[]; total: number; limit: number; offset: number; hasMore: boolean };
export type DzmmAdminMutation = { accountId: string; user: DzmmAdminUser; audit: DzmmAdminAudit; replayed: boolean };
export type DzmmAdminPageQuery = { offset?: number; limit?: number; userId?: string };
export type DzmmAdminUserQuery = Omit<DzmmAdminPageQuery, "userId"> & { q?: string; role?: DzmmAdminRole };
export class DzmmAdminError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmAdminError"; }
}

const API = "/api/backend/v1/admin";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\0");
const amount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const integer = (v: unknown): v is number => Number.isSafeInteger(v);
const timestamp = (v: unknown): v is number => amount(v) && v <= 8_640_000_000_000_000;
const nullableTimestamp = (v: unknown): v is number | null => v === null || timestamp(v);
const nullableAmount = (v: unknown): v is number | null => v === null || amount(v);
const role = (v: unknown): v is DzmmAdminRole => v === "user" || v === "super";
const malformed = () => new DzmmAdminError(502, "管理服务返回的数据无效，请刷新后重试。");
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const paymentUnit = (v: Record<string, unknown>) => v.currency === "usdt"
  ? v.provider === "nowpayments" && v.amountScale === 6
  : typeof v.currency === "string" && /^[a-z]{3}$/.test(v.currency) && v.provider !== "nowpayments"
    && (v.amountScale === undefined || v.amountScale === 2);

async function request(path: string, accountId: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!uuid(accountId)) throw new DzmmAdminError(401, "管理账号无效，请重新登录。");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      redirect: "error", signal: controller.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) throw new DzmmAdminError(response.status, record(value) && text(value.error, 500) ? value.error
      : response.status === 401 ? "账号会话已失效，请重新登录。" : response.status === 403 ? "需要 Super 管理员权限。" : "管理请求失败，请稍后重试。");
    if (!record(value)) throw malformed();
    if (value.accountId !== accountId) throw new DzmmAdminError(409, "账号已切换，请重新加载管理页面。");
    return value;
  } catch (error) {
    if (signal?.aborted || error instanceof DzmmAdminError) throw error;
    throw new DzmmAdminError(503, "管理服务暂时无法连接，请重试。若正在调整账户，请重试同一操作以核对结果。");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export function parseDzmmAdminUser(v: unknown): DzmmAdminUser {
  if (!record(v) || !uuid(v.id) || (v.email !== null && !text(v.email, 254)) || !text(v.nickname, 100)
    || typeof v.isGuest !== "boolean" || !role(v.role) || !timestamp(v.createdAt) || typeof v.emailVerified !== "boolean"
    || typeof v.creditUnlimited !== "boolean" || (v.creditUnlimited && (v.isGuest || v.role !== "super"))
    || ![v.availableCredits, v.reservedCredits, v.totalSpentCredits, v.debtCredits].every(amount)
    || !integer(v.adminAdjustedCredits) || !record(v.subscription) || typeof v.subscription.active !== "boolean"
    || !nullableTimestamp(v.subscription.expiresAt)) throw malformed();
  return { id: v.id, email: v.email as string | null, nickname: v.nickname, isGuest: v.isGuest, role: v.role,
    createdAt: v.createdAt, emailVerified: v.emailVerified, creditUnlimited: v.creditUnlimited,
    availableCredits: v.availableCredits as number, reservedCredits: v.reservedCredits as number,
    totalSpentCredits: v.totalSpentCredits as number, debtCredits: v.debtCredits as number, adminAdjustedCredits: v.adminAdjustedCredits,
    subscription: { active: v.subscription.active, expiresAt: v.subscription.expiresAt } };
}

function parseOrder(v: unknown): DzmmAdminOrder {
  if (!record(v) || !text(v.id) || !uuid(v.userId) || !text(v.nickname, 100) || !["stripe", "zpay", "subscription", "nowpayments"].includes(v.provider as string)
    || !["live", "test"].includes(v.mode as string) || !["recharge", "subscription"].includes(v.kind as string) || typeof v.currency !== "string"
    || !paymentUnit(v) || !amount(v.amountMinor) || !nullableAmount(v.credits) || !text(v.status, 50)
    || !timestamp(v.createdAt) || !nullableTimestamp(v.paidAt)) throw malformed();
  return { id: v.id, userId: v.userId, nickname: v.nickname, provider: v.provider as DzmmAdminOrder["provider"], mode: v.mode as DzmmAdminOrder["mode"],
    kind: v.kind as DzmmAdminOrder["kind"], currency: v.currency, amountMinor: v.amountMinor,
    ...(v.amountScale === undefined ? {} : { amountScale: v.amountScale as 2 | 6 }), credits: v.credits,
    status: v.status, createdAt: v.createdAt, paidAt: v.paidAt };
}
function parseSubscription(v: unknown): DzmmAdminSubscription {
  if (!record(v) || !text(v.id) || !uuid(v.userId) || !text(v.nickname, 100) || !text(v.planId) || !text(v.label)
    || !["active", "scheduled", "expired", "revoked"].includes(v.status as string) || !timestamp(v.startsAt) || !timestamp(v.expiresAt)
    || v.expiresAt <= v.startsAt || !amount(v.dailyCredits) || !amount(v.claimsCount) || !amount(v.maxClaims)
    || v.claimsCount > v.maxClaims) throw malformed();
  return { id: v.id, userId: v.userId, nickname: v.nickname, planId: v.planId, label: v.label, status: v.status as DzmmAdminSubscription["status"],
    startsAt: v.startsAt, expiresAt: v.expiresAt, dailyCredits: v.dailyCredits, claimsCount: v.claimsCount, maxClaims: v.maxClaims };
}
function parseUsage(v: unknown): DzmmAdminUsage {
  if (!record(v) || !text(v.id) || !uuid(v.userId) || !text(v.nickname, 100) || !text(v.operation, 30) || !text(v.model, 100) || !text(v.status, 30)
    || !amount(v.chargedCredits) || !amount(v.reservedCredits) || !nullableAmount(v.promptTokens) || !nullableAmount(v.completionTokens)
    || (v.providerCostUsd !== null && (typeof v.providerCostUsd !== "number" || !Number.isFinite(v.providerCostUsd) || v.providerCostUsd < 0))
    || typeof v.billingExempt !== "boolean" || !timestamp(v.createdAt) || !nullableTimestamp(v.finalizedAt)) throw malformed();
  return { id: v.id, userId: v.userId, nickname: v.nickname, operation: v.operation, model: v.model, status: v.status,
    chargedCredits: v.chargedCredits, reservedCredits: v.reservedCredits, providerCostUsd: v.providerCostUsd as number | null,
    promptTokens: v.promptTokens, completionTokens: v.completionTokens, billingExempt: v.billingExempt, createdAt: v.createdAt, finalizedAt: v.finalizedAt };
}
function parseAudit(v: unknown): DzmmAdminAudit {
  if (!record(v) || !text(v.id) || !uuid(v.actorId) || !uuid(v.targetUserId) || !uuid(v.requestId)
    || !["credit_adjustment", "role_change"].includes(v.action as string) || !text(v.reason, 200) || !timestamp(v.createdAt)
    || (v.action === "credit_adjustment" ? !integer(v.delta) || v.delta === 0 : !role(v.previousRole) || !role(v.role))) throw malformed();
  return { id: v.id, actorId: v.actorId, targetUserId: v.targetUserId, requestId: v.requestId, action: v.action as DzmmAdminAudit["action"],
    ...(v.action === "credit_adjustment" ? { delta: v.delta as number } : { previousRole: v.previousRole as DzmmAdminRole, role: v.role as DzmmAdminRole }),
    reason: v.reason, createdAt: v.createdAt };
}
function queryString(query: DzmmAdminPageQuery | DzmmAdminUserQuery): string {
  const limit = query.limit ?? 20, offset = query.offset ?? 0;
  if (!amount(limit) || limit < 1 || limit > 50 || !amount(offset) || offset > 100_000) throw new DzmmAdminError(400, "分页参数无效。");
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if ("userId" in query && query.userId) {
    if (!uuid(query.userId)) throw new DzmmAdminError(400, "请输入完整的账号 ID。");
    params.set("userId", query.userId);
  }
  if ("q" in query && query.q?.trim()) {
    if (query.q.length > 100 || query.q.includes("\0")) throw new DzmmAdminError(400, "搜索词不能超过 100 字。");
    params.set("q", query.q.trim());
  }
  if ("role" in query && query.role) {
    if (!role(query.role)) throw new DzmmAdminError(400, "角色筛选无效。");
    params.set("role", query.role);
  }
  return `?${params}`;
}
async function page<T>(path: string, accountId: string, query: DzmmAdminPageQuery | DzmmAdminUserQuery, parse: (v: unknown) => T, signal?: AbortSignal): Promise<DzmmAdminPage<T>> {
  const v = await request(`${path}${queryString(query)}`, accountId, undefined, signal);
  if (!Array.isArray(v.items) || !amount(v.total) || !amount(v.limit) || v.limit < 1 || v.limit > 50 || !amount(v.offset)
    || v.offset !== (query.offset ?? 0) || v.limit !== (query.limit ?? 20) || typeof v.hasMore !== "boolean"
    || v.items.length > v.limit || (v.hasMore && !v.items.length)) throw malformed();
  return { accountId, items: v.items.map(parse), total: v.total, limit: v.limit, offset: v.offset, hasMore: v.hasMore };
}

export async function fetchDzmmAdminOverview(accountId: string, signal?: AbortSignal): Promise<DzmmAdminOverview> {
  const v = await request("/overview", accountId, undefined, signal);
  const names = ["users", "registeredUsers", "guestUsers", "superUsers", "totalAvailableCredits", "totalReservedCredits", "totalSpentCredits", "pendingUsage", "activeSubscriptions", "pendingSubmissions", "forumPosts"] as const;
  if (!timestamp(v.serverTime) || !record(v.stats) || !names.every(name => amount((v.stats as Record<string, unknown>)[name]))
    || !Array.isArray(v.revenue) || v.revenue.length > 50 || !record(v.billing) || typeof v.billing.enabled !== "boolean" || !nullableAmount(v.billing.priceRevision)
    || !record(v.capabilities) || !["userRoles", "creditAdjustments", "paymentOrders", "usageMetadata"].every(key => typeof (v.capabilities as Record<string, unknown>)[key] === "boolean")
    || v.capabilities.privateConversations !== false) throw malformed();
  const stats = Object.fromEntries(names.map(name => [name, (v.stats as Record<string, unknown>)[name]])) as DzmmAdminOverview["stats"];
  const revenue = v.revenue.map(item => {
    if (!record(item) || !["stripe", "zpay", "subscription", "nowpayments"].includes(item.provider as string) || typeof item.currency !== "string"
      || !paymentUnit(item) || !amount(item.amountMinor) || !amount(item.paidOrders) || !["live", "test"].includes(item.mode as string)) throw malformed();
    return { provider: item.provider as DzmmAdminOrder["provider"], currency: item.currency, amountMinor: item.amountMinor,
      ...(item.amountScale === undefined ? {} : { amountScale: item.amountScale as 2 | 6 }), paidOrders: item.paidOrders, mode: item.mode as DzmmAdminOrder["mode"] };
  });
  return { accountId, serverTime: v.serverTime, stats, revenue, billing: { enabled: v.billing.enabled, priceRevision: v.billing.priceRevision },
    capabilities: { userRoles: v.capabilities.userRoles as boolean, creditAdjustments: v.capabilities.creditAdjustments as boolean,
      paymentOrders: v.capabilities.paymentOrders as boolean, usageMetadata: v.capabilities.usageMetadata as boolean, privateConversations: false } };
}
export const fetchDzmmAdminUsers = (id: string, q: DzmmAdminUserQuery = {}, signal?: AbortSignal) => page("/users", id, q, parseDzmmAdminUser, signal);
export const fetchDzmmAdminOrders = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/orders", id, q, parseOrder, signal);
export const fetchDzmmAdminSubscriptions = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/subscriptions", id, q, parseSubscription, signal);
export const fetchDzmmAdminUsage = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/usage", id, q, parseUsage, signal);
export const fetchDzmmAdminAudit = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/audit", id, q, parseAudit, signal);

type Action = { accountId: string; requestId: string; reason: string };
async function mutate(userId: string, action: Action & ({ delta: number } | { role: DzmmAdminRole }), kind: "credits" | "role", signal?: AbortSignal): Promise<DzmmAdminMutation> {
  if (!uuid(userId) || !uuid(action.requestId) || typeof action.reason !== "string" || !text(action.reason.trim(), 200) || /[\r\n]/.test(action.reason)
    || ("delta" in action ? !integer(action.delta) || action.delta === 0 || Math.abs(action.delta) > 1_000_000 : !role(action.role))) throw new DzmmAdminError(400, "请填写有效的调整数量、权限和操作原因。");
  const normalized = { ...action, reason: action.reason.trim() };
  const v = await request(`/users/${encodeURIComponent(userId)}/${kind}`, normalized.accountId, normalized, signal);
  const user = parseDzmmAdminUser(v.user), audit = parseAudit(v.audit);
  if (typeof v.replayed !== "boolean" || user.id !== userId || audit.actorId !== action.accountId || audit.targetUserId !== userId
    || audit.requestId !== action.requestId || audit.reason !== normalized.reason
    || ("delta" in action ? audit.action !== "credit_adjustment" || audit.delta !== action.delta : audit.action !== "role_change" || audit.role !== action.role)) throw malformed();
  return { accountId: action.accountId, user, audit, replayed: v.replayed };
}
export const adjustDzmmAdminCredits = (userId: string, action: Action & { delta: number }, signal?: AbortSignal) => mutate(userId, action, "credits", signal);
export const changeDzmmAdminRole = (userId: string, action: Action & { role: DzmmAdminRole }, signal?: AbortSignal) => mutate(userId, action, "role", signal);
