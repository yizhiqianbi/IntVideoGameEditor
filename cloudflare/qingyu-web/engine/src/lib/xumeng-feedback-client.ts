export const FEEDBACK_STATUSES = ["pending", "fix", "improve", "later", "done"] as const;
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];
export const FEEDBACK_LABELS: Record<FeedbackStatus, string> = { pending: "待判断", fix: "要修复", improve: "要改进", later: "暂不处理", done: "已完成" };
export type FeedbackMedia = { kind: "photo" | "video" | "animation" | "audio" | "voice" | "document" | "sticker"; fileId: string | null; fileUniqueId: string | null; mimeType: string | null; fileName: string | null; size: number | null; width: number | null; height: number | null; duration: number | null };
export type FeedbackItem = { id: string; revision: number; status: FeedbackStatus; note: string; text: string;
  chatId: string; chatTitle: string; chatUsername: string | null; senderId: string; senderName: string; senderUsername: string | null;
  messageId: number; threadId: number | null; messageUrl: string | null; messageAt: number; editedAt: number | null; createdAt: number; updatedAt: number;
  replyText: string | null; replySenderName: string | null; media: FeedbackMedia | null; decidedBy: string | null; decidedAt: number | null };
export type FeedbackPage = { accountId: string; items: FeedbackItem[]; total: number; limit: number; offset: number; hasMore: boolean;
  counts: Record<FeedbackStatus, number>; integrationConfigured: boolean };
export type FeedbackQuery = { q?: string; status?: FeedbackStatus | ""; limit?: number; offset?: number };
export type FeedbackDecision = { revision: number; status: FeedbackStatus; note: string };
export type FeedbackDrafts = Record<string, FeedbackDecision>;
export type FeedbackHandoff = { accountId: string; feedbackId: string; revision: number; status: "fix" | "improve"; note: string; markdown: string; fileName: string };
export class FeedbackError extends Error {
  constructor(public readonly status: number, message: string, public readonly latest: FeedbackItem | null = null) { super(message); this.name = "FeedbackError"; }
}
const API = "/api/backend/v1/admin/feedback";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !v.includes("\0");
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const nullableNumber = (v: unknown): v is number | null => v === null || integer(v);
const nullableMetric = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const nullableText = (v: unknown, max: number): v is string | null => v === null || text(v, max);
const isStatus = (v: unknown): v is FeedbackStatus => FEEDBACK_STATUSES.includes(v as FeedbackStatus);
const malformed = () => new FeedbackError(502, "反馈服务返回的数据无效，请重试。");
const timestamp = (v: unknown): v is number => integer(v) && v <= 8_640_000_000_000_000;
const nullableTime = (v: unknown): v is number | null => v === null || timestamp(v);
function safeMessageUrl(v: unknown): v is string | null {
  if (v === null) return true;
  if (!text(v, 500)) return false;
  try { const url = new URL(v); return url.protocol === "https:" && url.hostname === "t.me" && !url.username && !url.password && !url.port && /^\/(?:c\/\d+|[A-Za-z0-9_]{3,32})\/\d+(?:\/\d+)?$/.test(url.pathname) && !url.hash && [...url.searchParams.keys()].every(key => key === "thread"); }
  catch { return false; }
}
export function parseFeedbackItem(v: unknown): FeedbackItem {
  if (!record(v) || !uuid(v.id) || !integer(v.revision) || v.revision < 1 || !isStatus(v.status) || !text(v.note, 2000) || !text(v.text, 8192)
    || !text(v.chatId, 64) || !text(v.chatTitle, 256) || !nullableText(v.chatUsername, 32) || !text(v.senderId, 64) || !text(v.senderName, 256) || !nullableText(v.senderUsername, 32)
    || !integer(v.messageId) || v.messageId < 1 || !nullableNumber(v.threadId) || !safeMessageUrl(v.messageUrl) || !timestamp(v.messageAt) || !nullableTime(v.editedAt)
    || !timestamp(v.createdAt) || !timestamp(v.updatedAt) || !nullableText(v.replyText, 2000) || !nullableText(v.replySenderName, 256)
    || (v.decidedBy !== null && !uuid(v.decidedBy)) || !nullableTime(v.decidedAt)) throw malformed();
  let media: FeedbackMedia | null = null;
  if (v.media !== null) {
    const m = v.media;
    if (!record(m) || !["photo", "video", "animation", "audio", "voice", "document", "sticker"].includes(m.kind as string)
      || !nullableText(m.fileId, 512) || !nullableText(m.fileUniqueId, 512) || !nullableText(m.mimeType, 128) || !nullableText(m.fileName, 256)
      || ![m.size, m.width, m.height, m.duration].every(nullableMetric)) throw malformed();
    media = { kind: m.kind as FeedbackMedia["kind"], fileId: m.fileId, fileUniqueId: m.fileUniqueId, mimeType: m.mimeType, fileName: m.fileName, size: m.size as number | null, width: m.width as number | null, height: m.height as number | null, duration: m.duration as number | null };
  }
  return { id: v.id, revision: v.revision, status: v.status, note: v.note, text: v.text, chatId: v.chatId, chatTitle: v.chatTitle, chatUsername: v.chatUsername,
    senderId: v.senderId, senderName: v.senderName, senderUsername: v.senderUsername, messageId: v.messageId, threadId: v.threadId,
    messageUrl: v.messageUrl, messageAt: v.messageAt, editedAt: v.editedAt, createdAt: v.createdAt, updatedAt: v.updatedAt,
    replyText: v.replyText, replySenderName: v.replySenderName, media, decidedBy: v.decidedBy as string | null, decidedAt: v.decidedAt };
}
async function request(path: string, accountId: string, body?: FeedbackDecision & { accountId: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!uuid(accountId)) throw new FeedbackError(401, "管理账号无效，请重新登录。");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${API}${path}`, { method: body ? "PATCH" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      let latest: FeedbackItem | null = null;
      if (response.status === 409 && record(value) && value.item) {
        latest = parseFeedbackItem(value.item);
        if (body && latest.id !== path.slice(1)) throw malformed();
      }
      throw new FeedbackError(response.status, record(value) && text(value.error, 500) && value.error ? value.error : response.status === 401 ? "账号会话已失效，请重新登录。" : response.status === 403 ? "需要 Super 管理员权限。" : "反馈请求失败，请重试。", latest);
    }
    if (!record(value)) throw malformed();
    if (value.accountId !== accountId) throw new FeedbackError(409, "账号已切换，请重新加载反馈页面。");
    return value;
  } catch (error) {
    if (signal?.aborted || error instanceof FeedbackError) throw error;
    throw new FeedbackError(503, "反馈服务暂时无法连接。决策草稿已保留，请重试并核对结果。");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
export async function fetchFeedback(accountId: string, query: FeedbackQuery = {}, signal?: AbortSignal): Promise<FeedbackPage> {
  const limit = query.limit ?? 20, offset = query.offset ?? 0;
  if (!integer(limit) || limit < 1 || limit > 50 || !integer(offset) || offset > 100_000 || (query.status && !isStatus(query.status)) || (query.q !== undefined && !text(query.q, 100))) throw new FeedbackError(400, "反馈筛选参数无效。");
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.status) params.set("status", query.status);
  const v = await request(`?${params}`, accountId, undefined, signal);
  if (!Array.isArray(v.items) || !integer(v.total) || v.limit !== limit || v.offset !== offset || typeof v.hasMore !== "boolean" || v.items.length > limit
    || (v.hasMore && !v.items.length) || !record(v.counts) || !FEEDBACK_STATUSES.every(status => integer((v.counts as Record<string, unknown>)[status])) || typeof v.integrationConfigured !== "boolean") throw malformed();
  return { accountId, items: v.items.map(parseFeedbackItem), total: v.total, limit, offset, hasMore: v.hasMore,
    counts: Object.fromEntries(FEEDBACK_STATUSES.map(status => [status, (v.counts as Record<string, unknown>)[status]])) as Record<FeedbackStatus, number>, integrationConfigured: v.integrationConfigured };
}
export async function updateFeedback(id: string, action: FeedbackDecision & { accountId: string }, signal?: AbortSignal): Promise<FeedbackItem> {
  if (!uuid(id) || !integer(action.revision) || action.revision < 1 || !isStatus(action.status) || !text(action.note, 2000)) throw new FeedbackError(400, "请填写有效的反馈状态和不超过 2,000 字的备注。");
  const normalized = { ...action, note: action.note.trim() };
  const v = await request(`/${encodeURIComponent(id)}`, action.accountId, normalized, signal);
  const item = parseFeedbackItem(v.item);
  if (item.id !== id || item.status !== action.status || item.note !== normalized.note || item.revision <= action.revision) throw malformed();
  return item;
}
export async function fetchFeedbackHandoff(accountId: string, id: string, revision: number, signal?: AbortSignal): Promise<FeedbackHandoff> {
  if (!uuid(id) || !integer(revision) || revision < 1) throw new FeedbackError(400, "请先保存当前反馈判断，再生成 Codex 任务。");
  let v: Record<string, unknown>;
  try { v = await request(`/${id}/handoff?revision=${revision}`, accountId, undefined, signal); }
  catch (error) {
    if (error instanceof FeedbackError && error.latest && error.latest.id !== id) throw malformed();
    throw error;
  }
  if (v.feedbackId !== id || v.revision !== revision || (v.status !== "fix" && v.status !== "improve") || !text(v.note, 2000) || !text(v.markdown, 50_000) || !v.markdown
    || v.fileName !== `qingyu-feedback-${id}-r${revision}.md`) throw malformed();
  return { accountId, feedbackId: id, revision, status: v.status, note: v.note, markdown: v.markdown, fileName: v.fileName as string };
}
export const feedbackDraftKey = (accountId: string) => `qingyu-feedback-decisions-v1:${accountId}`;
export function parseFeedbackDrafts(raw: string | null, accountId: string): FeedbackDrafts {
  if (raw === null) return {};
  const v: unknown = JSON.parse(raw);
  if (!record(v) || v.schemaVersion !== 1 || v.accountId !== accountId || !record(v.drafts) || Object.keys(v.drafts).length > 500) throw new Error("反馈草稿格式无效");
  const drafts: FeedbackDrafts = {};
  for (const [id, d] of Object.entries(v.drafts)) {
    if (!uuid(id) || !record(d) || !integer(d.revision) || d.revision < 1 || !isStatus(d.status) || !text(d.note, 2000)) throw new Error("反馈草稿格式无效");
    drafts[id] = { revision: d.revision, status: d.status, note: d.note };
  }
  return drafts;
}
export function serializeFeedbackDrafts(accountId: string, drafts: FeedbackDrafts): string {
  if (!uuid(accountId)) throw new Error("反馈草稿账号无效");
  const raw = JSON.stringify({ schemaVersion: 1, accountId, drafts });
  parseFeedbackDrafts(raw, accountId);
  return raw;
}
