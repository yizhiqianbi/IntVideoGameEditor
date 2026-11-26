export type DzmmAdminRole = "user" | "super";
type DzmmAdminPaymentProvider = "stripe" | "zpay" | "subscription" | "nowpayments" | "guagua" | "waffo";
export type DzmmAdminUser = {
  id: string; email: string | null; nickname: string; isGuest: boolean; role: DzmmAdminRole;
  createdAt: number; emailVerified: boolean; creditUnlimited: boolean;
  availableCredits: number; reservedCredits: number; totalSpentCredits: number; debtCredits: number; adminAdjustedCredits: number;
  subscription: { active: boolean; expiresAt: number | null };
  inviterId?: string | null; inviteCount?: number | null; rechargeAmountMinor?: number; rechargeCredits?: number;
  checkinDays?: number; taskCredits?: number | null; imageCount?: number; videoCount?: number; lastActiveAt?: number | null;
};
export type DzmmAdminTrafficDay = {
  day: string; visitors: number; guestVisitors: number; registeredVisitors: number; newGuests: number; newRegistered: number;
};
export type DzmmAdminTraffic = {
  timezone: "Asia/Shanghai"; day: string;
  visitors: number; guestVisitors: number; registeredVisitors: number;
  newGuests: number; newRegistered: number; returningVisitors: number;
  conversations: number; chatRequests: number; chargedCredits: number; paidOrders: number;
  forumPosts: number; forumReplies: number; likes: number; openReports: number; listedCharacters: number;
  days: DzmmAdminTrafficDay[];
};
export type DzmmAdminOverview = {
  accountId: string; serverTime: number;
  stats: { users: number; registeredUsers: number; guestUsers: number; superUsers: number;
    totalAvailableCredits: number; totalReservedCredits: number; totalSpentCredits: number;
    pendingUsage: number; activeSubscriptions: number; pendingSubmissions: number; forumPosts: number };
  traffic: DzmmAdminTraffic;
  revenue: { provider: DzmmAdminPaymentProvider; currency: string; amountMinor: number; amountScale?: 2 | 6; paidOrders: number; mode: "live" | "test" | "sandbox" }[];
  billing: { enabled: boolean; priceRevision: number | null };
  capabilities: { userRoles: boolean; creditAdjustments: boolean; paymentOrders: boolean; usageMetadata: boolean; privateConversations: false };
};
export type DzmmAdminOrder = {
  id: string; userId: string; nickname: string; provider: DzmmAdminPaymentProvider;
  mode: "live" | "test" | "sandbox"; kind: "recharge" | "subscription"; currency: string; amountMinor: number; amountScale?: 2 | 6;
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
export type DzmmAdminUserQuery = Omit<DzmmAdminPageQuery, "userId"> & {
  q?: string; role?: DzmmAdminRole; from?: number; to?: number; accountKind?: "guest" | "registered"; exactId?: string; inviterId?: string;
};
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
/** 后台账户除了 UUID 用户，还有目录/系统账户（如 aigf-catalog），ID 是普通字符串。 */
const accountId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const ADMIN_PROVIDERS = ["stripe", "zpay", "subscription", "nowpayments", "guagua", "waffo"] as const;
const ADMIN_MODES = ["live", "test", "sandbox"] as const;
const paymentUnit = (v: Record<string, unknown>) => {
  if (typeof v.currency !== "string" || !/^[a-z]{3}$/.test(v.currency)) return false;
  if (v.currency === "usdt") return v.provider === "nowpayments" && v.amountScale === 6;
  return v.provider !== "nowpayments" && (v.amountScale === undefined || v.amountScale === 2);
};

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
  if (!record(v) || !accountId(v.id) || (v.email !== null && !text(v.email, 254)) || !text(v.nickname, 100)
    || typeof v.isGuest !== "boolean" || !role(v.role) || !timestamp(v.createdAt) || typeof v.emailVerified !== "boolean"
    || typeof v.creditUnlimited !== "boolean" || (v.creditUnlimited && (v.isGuest || v.role !== "super"))
    || ![v.availableCredits, v.reservedCredits, v.totalSpentCredits, v.debtCredits].every(amount)
    || !integer(v.adminAdjustedCredits) || !record(v.subscription) || typeof v.subscription.active !== "boolean"
    || !nullableTimestamp(v.subscription.expiresAt)) throw malformed();
  const count = (value: unknown) => value === undefined || amount(value);
  const nullableCount = (value: unknown) => value === undefined || value === null || amount(value);
  if (!nullableCount(v.inviteCount) || !count(v.rechargeAmountMinor) || !count(v.rechargeCredits) || !count(v.checkinDays)
    || !nullableCount(v.taskCredits) || !count(v.imageCount) || !count(v.videoCount)
    || (v.inviterId !== undefined && v.inviterId !== null && !uuid(v.inviterId))
    || (v.lastActiveAt !== undefined && !nullableTimestamp(v.lastActiveAt))) throw malformed();
  return { id: v.id, email: v.email as string | null, nickname: v.nickname, isGuest: v.isGuest, role: v.role,
    createdAt: v.createdAt, emailVerified: v.emailVerified, creditUnlimited: v.creditUnlimited,
    availableCredits: v.availableCredits as number, reservedCredits: v.reservedCredits as number,
    totalSpentCredits: v.totalSpentCredits as number, debtCredits: v.debtCredits as number, adminAdjustedCredits: v.adminAdjustedCredits,
    subscription: { active: v.subscription.active, expiresAt: v.subscription.expiresAt },
    ...(v.inviterId !== undefined ? { inviterId: v.inviterId as string | null } : {}),
    ...(v.inviteCount !== undefined ? { inviteCount: v.inviteCount as number | null } : {}),
    ...(v.rechargeAmountMinor !== undefined ? { rechargeAmountMinor: v.rechargeAmountMinor as number } : {}),
    ...(v.rechargeCredits !== undefined ? { rechargeCredits: v.rechargeCredits as number } : {}),
    ...(v.checkinDays !== undefined ? { checkinDays: v.checkinDays as number } : {}),
    ...(v.taskCredits !== undefined ? { taskCredits: v.taskCredits as number | null } : {}),
    ...(v.imageCount !== undefined ? { imageCount: v.imageCount as number } : {}),
    ...(v.videoCount !== undefined ? { videoCount: v.videoCount as number } : {}),
    ...(v.lastActiveAt !== undefined ? { lastActiveAt: v.lastActiveAt as number | null } : {}),
  };
}

function parseOrder(v: unknown): DzmmAdminOrder {
  if (!record(v) || !text(v.id) || !uuid(v.userId) || !text(v.nickname, 100) || !ADMIN_PROVIDERS.includes(v.provider as typeof ADMIN_PROVIDERS[number])
    || !ADMIN_MODES.includes(v.mode as typeof ADMIN_MODES[number]) || !["recharge", "subscription"].includes(v.kind as string) || typeof v.currency !== "string"
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
  if ("from" in query && query.from !== undefined) params.set("from", String(query.from));
  if ("to" in query && query.to !== undefined) params.set("to", String(query.to));
  if ("accountKind" in query && query.accountKind) params.set("accountKind", query.accountKind);
  if ("exactId" in query && query.exactId) {
    if (!uuid(query.exactId)) throw new DzmmAdminError(400, "请输入完整的账号 ID。");
    params.set("userId", query.exactId);
  }
  if ("inviterId" in query && query.inviterId) {
    if (!uuid(query.inviterId)) throw new DzmmAdminError(400, "请输入完整的上级账号 ID。");
    params.set("inviterId", query.inviterId);
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function parseTrafficDay(v: unknown): DzmmAdminTrafficDay {
  const names = ["visitors", "guestVisitors", "registeredVisitors", "newGuests", "newRegistered"] as const;
  if (!record(v) || !DAY.test(String(v.day)) || !names.every(name => amount(v[name]))
    || (v.guestVisitors as number) + (v.registeredVisitors as number) !== v.visitors
    || (v.newGuests as number) + (v.newRegistered as number) > (v.visitors as number)) throw malformed();
  return { day: v.day as string, visitors: v.visitors as number, guestVisitors: v.guestVisitors as number, registeredVisitors: v.registeredVisitors as number, newGuests: v.newGuests as number, newRegistered: v.newRegistered as number };
}
function parseTraffic(v: unknown): DzmmAdminTraffic {
  const names = ["visitors", "guestVisitors", "registeredVisitors", "newGuests", "newRegistered", "returningVisitors", "conversations", "chatRequests", "chargedCredits", "paidOrders", "forumPosts", "forumReplies", "likes", "openReports", "listedCharacters"] as const;
  if (!record(v) || v.timezone !== "Asia/Shanghai" || !DAY.test(String(v.day)) || !names.every(name => amount(v[name]))
    || !Array.isArray(v.days) || v.days.length !== 7) throw malformed();
  const days = v.days.map(parseTrafficDay);
  const last = days[6];
  if (days.some((day, index) => index > 0 && Date.parse(`${day.day}T00:00:00Z`) - Date.parse(`${days[index - 1].day}T00:00:00Z`) !== 86_400_000)
    || last.day !== v.day || last.visitors !== v.visitors || last.guestVisitors !== v.guestVisitors || last.registeredVisitors !== v.registeredVisitors
    || last.newGuests !== v.newGuests || last.newRegistered !== v.newRegistered
    || last.visitors - last.newGuests - last.newRegistered !== v.returningVisitors) throw malformed();
  return { timezone: "Asia/Shanghai", day: v.day as string, ...Object.fromEntries(names.map(name => [name, v[name]])) as Omit<DzmmAdminTraffic, "timezone" | "day" | "days">, days };
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
    if (!record(item) || !ADMIN_PROVIDERS.includes(item.provider as typeof ADMIN_PROVIDERS[number]) || typeof item.currency !== "string"
      || !paymentUnit(item) || !amount(item.amountMinor) || !amount(item.paidOrders) || !ADMIN_MODES.includes(item.mode as typeof ADMIN_MODES[number])) throw malformed();
    return { provider: item.provider as DzmmAdminOrder["provider"], currency: item.currency, amountMinor: item.amountMinor,
      ...(item.amountScale === undefined ? {} : { amountScale: item.amountScale as 2 | 6 }), paidOrders: item.paidOrders, mode: item.mode as DzmmAdminOrder["mode"] };
  });
  return { accountId, serverTime: v.serverTime, stats, traffic: parseTraffic(v.traffic), revenue, billing: { enabled: v.billing.enabled, priceRevision: v.billing.priceRevision },
    capabilities: { userRoles: v.capabilities.userRoles as boolean, creditAdjustments: v.capabilities.creditAdjustments as boolean,
      paymentOrders: v.capabilities.paymentOrders as boolean, usageMetadata: v.capabilities.usageMetadata as boolean, privateConversations: false } };
}
export const fetchDzmmAdminUsers = (id: string, q: DzmmAdminUserQuery = {}, signal?: AbortSignal) => page("/users", id, q, parseDzmmAdminUser, signal);
export const fetchDzmmAdminOrders = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/orders", id, q, parseOrder, signal);
export const fetchDzmmAdminSubscriptions = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/subscriptions", id, q, parseSubscription, signal);
export const fetchDzmmAdminUsage = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/usage", id, q, parseUsage, signal);
export const fetchDzmmAdminAudit = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/audit", id, q, parseAudit, signal);

export type DzmmAdminWatch = {
  id: string; userId: string; nickname: string; dramaId: string; episodeId: string; episodeNumber: number;
  kind: "unlock" | "free" | "vip" | "paid"; credits: number; createdAt: number;
};
export type DzmmAdminWatchHot = { userId: string; nickname: string; events: number; credits: number };
export type DzmmAdminWatches = DzmmAdminPage<DzmmAdminWatch> & { hot: DzmmAdminWatchHot[]; note: string };
export type DzmmAdminSpend = { id: string; userId: string; nickname: string; scene: string; detail: string; credits: number; createdAt: number };

const WATCH_KINDS = ["unlock", "free", "vip", "paid"] as const;
function parseWatch(v: unknown): DzmmAdminWatch {
  if (!record(v) || !text(v.id, 80) || !uuid(v.userId) || !text(v.nickname, 100) || !text(v.dramaId, 16) || !text(v.episodeId, 24)
    || !amount(v.episodeNumber) || v.episodeNumber < 1 || v.episodeNumber > 999 || !WATCH_KINDS.includes(v.kind as typeof WATCH_KINDS[number])
    || !amount(v.credits) || !timestamp(v.createdAt)) throw malformed();
  return { id: v.id, userId: v.userId, nickname: v.nickname, dramaId: v.dramaId, episodeId: v.episodeId, episodeNumber: v.episodeNumber,
    kind: v.kind as DzmmAdminWatch["kind"], credits: v.credits, createdAt: v.createdAt };
}
function parseSpend(v: unknown): DzmmAdminSpend {
  if (!record(v) || !text(v.id, 120) || !uuid(v.userId) || !text(v.nickname, 100) || !text(v.scene, 40) || !text(v.detail, 80)
    || !amount(v.credits) || v.credits < 1 || !timestamp(v.createdAt)) throw malformed();
  return { id: v.id, userId: v.userId, nickname: v.nickname, scene: v.scene, detail: v.detail, credits: v.credits, createdAt: v.createdAt };
}
export async function fetchDzmmAdminWatches(id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal): Promise<DzmmAdminWatches> {
  const raw = await request(`/watches${queryString(q)}`, id, undefined, signal);
  const limit = q.limit ?? 20;
  const offset = q.offset ?? 0;
  if (!Array.isArray(raw.items) || !amount(raw.total) || raw.limit !== limit || raw.offset !== offset || typeof raw.hasMore !== "boolean"
    || raw.items.length > limit || (raw.hasMore && !raw.items.length) || !Array.isArray(raw.hot) || raw.hot.length > 8 || !text(raw.note, 200)) throw malformed();
  return {
    accountId: id, items: raw.items.map(parseWatch), total: raw.total, limit, offset, hasMore: raw.hasMore, note: raw.note,
    hot: raw.hot.map(item => {
      if (!record(item) || !uuid(item.userId) || !text(item.nickname, 100) || !amount(item.events) || !amount(item.credits)) throw malformed();
      return { userId: item.userId, nickname: item.nickname, events: item.events, credits: item.credits };
    }),
  };
}
export const fetchDzmmAdminSpends = (id: string, q: DzmmAdminPageQuery = {}, signal?: AbortSignal) => page("/spends", id, q, parseSpend, signal);

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

function checkinCredits(value: unknown): number {
  if (!record(value) || !Number.isInteger(value.credits) || (value.credits as number) < 1 || (value.credits as number) > 100000) throw malformed();
  return value.credits as number;
}
export async function fetchDzmmAdminCheckin(accountId: string, signal?: AbortSignal): Promise<{ accountId: string; credits: number }> {
  const value = await request("/checkin", accountId, undefined, signal);
  return { accountId, credits: checkinCredits(value) };
}
export async function saveDzmmAdminCheckin(accountId: string, credits: number, signal?: AbortSignal): Promise<{ accountId: string; credits: number }> {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000) throw new DzmmAdminError(400, "签到积分必须是 1 到 100000 的整数。");
  const value = await request("/checkin", accountId, { accountId, credits }, signal);
  return { accountId, credits: checkinCredits(value) };
}

export type DzmmAdminBanner = {
  id: string;
  audience: "male" | "female" | "general";
  position: number;
  title: string;
  body: string;
  href: string | null;
  deletedAt: number | null;
  enabled?: boolean;
  desktopImage?: string | null;
  mobileImage?: string | null;
  orientationId?: string | null;
};
export type DzmmAdminBannerInput = {
  audience: DzmmAdminBanner["audience"]; position: number; title: string; body: string; href: string;
  desktopImage?: string; mobileImage?: string; enabled?: boolean; orientationId?: string;
};

function parseBanner(value: unknown): DzmmAdminBanner {
  if (!record(value) || !uuid(value.id) || !["male", "female", "general"].includes(value.audience as string)
    || !Number.isInteger(value.position) || (value.position as number) < 1 || (value.position as number) > 99
    || !text(value.title, 40) || !text(value.body, 120)
    || (value.href !== null && !text(value.href, 200))
    || (value.deletedAt !== null && !timestamp(value.deletedAt))
    || (value.enabled !== undefined && typeof value.enabled !== "boolean")
    || (value.desktopImage !== undefined && value.desktopImage !== null && !text(value.desktopImage, 500))
    || (value.mobileImage !== undefined && value.mobileImage !== null && !text(value.mobileImage, 500))
    || (value.orientationId !== undefined && value.orientationId !== null && !text(value.orientationId, 40))) throw malformed();
  return {
    id: value.id, audience: value.audience as DzmmAdminBanner["audience"], position: value.position as number,
    title: value.title, body: value.body, href: value.href, deletedAt: value.deletedAt,
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    ...(value.desktopImage === undefined ? {} : { desktopImage: value.desktopImage as string | null }),
    ...(value.mobileImage === undefined ? {} : { mobileImage: value.mobileImage as string | null }),
    ...(value.orientationId === undefined ? {} : { orientationId: value.orientationId as string | null }),
  };
}

export async function fetchDzmmAdminBanners(accountId: string, signal?: AbortSignal): Promise<DzmmAdminBanner[]> {
  const value = await request("/banners", accountId, undefined, signal);
  if (!Array.isArray(value.banners)) throw malformed();
  return value.banners.map(parseBanner);
}

function bannerBody(accountId: string, banner: DzmmAdminBannerInput) {
  return {
    accountId, audience: banner.audience, position: banner.position, title: banner.title, body: banner.body, href: banner.href.trim() || null,
    ...(banner.desktopImage === undefined ? {} : { desktopImage: banner.desktopImage.trim() || null }),
    ...(banner.mobileImage === undefined ? {} : { mobileImage: banner.mobileImage.trim() || null }),
    ...(banner.enabled === undefined ? {} : { enabled: banner.enabled }),
    ...(banner.orientationId === undefined ? {} : { orientationId: banner.orientationId.trim() || null }),
  };
}
export async function saveDzmmAdminBanner(accountId: string, banner: DzmmAdminBannerInput, signal?: AbortSignal): Promise<DzmmAdminBanner> {
  const value = await request("/banners", accountId, bannerBody(accountId, banner), signal);
  return parseBanner(value.banner);
}
export async function updateDzmmAdminBanner(accountId: string, id: string, banner: DzmmAdminBannerInput, signal?: AbortSignal): Promise<DzmmAdminBanner> {
  const value = await request(`/banners/${encodeURIComponent(id)}`, accountId, bannerBody(accountId, banner), signal);
  return parseBanner(value.banner);
}

export async function deleteDzmmAdminBanner(accountId: string, id: string, signal?: AbortSignal): Promise<DzmmAdminBanner> {
  const value = await request(`/banners/${encodeURIComponent(id)}/delete`, accountId, { accountId }, signal);
  return parseBanner(value.banner);
}

export type StudioCoverRow = { slot: string; url: string; updatedAt: number };

export async function fetchStudioCovers(accountId: string, signal?: AbortSignal): Promise<StudioCoverRow[]> {
  const value = await request("/studio-covers", accountId, undefined, signal);
  if (!Array.isArray(value.covers)) throw malformed();
  return value.covers.map((item) => {
    if (!record(item) || typeof item.slot !== "string" || typeof item.url !== "string" || !timestamp(item.updatedAt)) throw malformed();
    return { slot: item.slot, url: item.url, updatedAt: item.updatedAt };
  });
}

export async function uploadStudioCover(accountId: string, slot: string, file: Blob, signal?: AbortSignal): Promise<StudioCoverRow> {
  if (!uuid(accountId)) throw new DzmmAdminError(401, "管理账号无效，请重新登录。");
  const response = await fetch(`${API}/studio-covers/${encodeURIComponent(slot)}`, {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !record(value)) throw new DzmmAdminError(response.status, record(value) && text(value.error, 500) ? value.error : "封面没有传上去。");
  if (value.accountId !== accountId || typeof value.slot !== "string" || typeof value.url !== "string" || !timestamp(value.updatedAt)) throw malformed();
  return { slot: value.slot, url: value.url, updatedAt: value.updatedAt };
}

export async function resetStudioCover(accountId: string, slot: string, signal?: AbortSignal): Promise<void> {
  await request(`/studio-covers/${encodeURIComponent(slot)}/delete`, accountId, { accountId }, signal);
}
