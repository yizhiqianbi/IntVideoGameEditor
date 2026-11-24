import type { Character } from "./shelf-characters";
import { SHELF_PUBLIC_SHELF_PAGE_SIZE, type ShelfCatalogApplied, type ShelfCatalogRequest } from "./shelf-public-shelf";

export type ShelfSubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type ShelfPublishingFilter = "all" | "pending" | "published" | "rejected" | "archived";
export type ShelfPublishedCharacter = Character & {
  publication: { id: string; authorId: string; revision: number; publishedAt: number };
};
export type ShelfLikeStat = { count: number; liked: boolean };
export type ShelfLikeStats = Record<string, ShelfLikeStat>;
export type ShelfPublishingSubmission = {
  id: string; publicationId: string; revision: number; status: ShelfSubmissionStatus;
  character: Character; author: { id: string; nickname: string };
  reason: string; createdAt: number; reviewedAt: number | null; publicationVersion: number;
  isListed: boolean; approvedRevision: number | null;
  displayHeat?: number; displayLikes?: number;
  previewCoverUrl: string; previewGalleryUrls?: string[];
};
export type ShelfPublication = {
  id: string; ownerId: string; privateCharacterId: string; version: number;
  currentRevision: number; approvedRevision: number | null; isListed: boolean;
  createdAt: number; updatedAt: number; latestSubmission: ShelfPublishingSubmission;
};
export type ShelfPublishingResult = { publication: ShelfPublication; submission: ShelfPublishingSubmission };
export type ShelfPublishingPage<T> = { total: number; offset: number; limit: number; hasMore: boolean; applied?: ShelfCatalogApplied } & T;

export class ShelfPublishingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "ShelfPublishingError"; }
}
const API = "/api/backend/v1/publishing";
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    const options = { method, credentials: "same-origin", cache: "no-store", signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) };
    response = await fetch(`${API}${path}`, options as Parameters<typeof fetch>[1]);
  } catch { throw new ShelfPublishingError(503, "发布服务暂时无法连接，请保留草稿后重试。"); }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new ShelfPublishingError(response.status, typeof result?.error === "string" ? result.error : "发布请求失败，请刷新状态后重试。");
  return result as T;
}
export function fetchShelfPublicCharacters(query: number | ShelfCatalogRequest = 0) {
  const input: ShelfCatalogRequest = typeof query === "number" ? { offset: query, limit: SHELF_PUBLIC_SHELF_PAGE_SIZE, view: "card" } : query;
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? SHELF_PUBLIC_SHELF_PAGE_SIZE));
  params.set("offset", String(input.offset ?? 0));
  params.set("view", input.view ?? "card");
  if (input.sort) params.set("sort", input.sort);
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.tags?.length) params.set("tags", input.tags.join(","));
  if (input.authorIds?.length) params.set("authors", input.authorIds.join(","));
  if (input.ids?.length) params.set("ids", input.ids.join(","));
  if (input.since) params.set("since", String(input.since));
  if (input.look) params.set("look", input.look);
  return request<ShelfPublishingPage<{ characters: ShelfPublishedCharacter[] }>>(`/catalog?${params}`);
}
export async function fetchShelfPlayMaterials(id: string, signal?: AbortSignal): Promise<Pick<Character, "systemPrompt" | "postHistoryInstructions" | "messageExamples" | "characterBook" | "interactionTemplate" | "statusBar">> {
  const result = await request<Record<string, unknown>>(`/catalog/${encodeURIComponent(id)}/prompt`, "GET", undefined, signal);
  if (!result || typeof result.systemPrompt !== "string") throw new ShelfPublishingError(502, "角色扮演指令无效，请稍后重试。");
  const play: Pick<Character, "systemPrompt" | "postHistoryInstructions" | "messageExamples" | "characterBook" | "interactionTemplate" | "statusBar"> = {
    systemPrompt: result.systemPrompt,
  };
  if (typeof result.postHistoryInstructions === "string") play.postHistoryInstructions = result.postHistoryInstructions;
  if (typeof result.messageExamples === "string") play.messageExamples = result.messageExamples;
  if (result.characterBook && typeof result.characterBook === "object") play.characterBook = result.characterBook as Character["characterBook"];
  if (result.interactionTemplate && typeof result.interactionTemplate === "object") play.interactionTemplate = result.interactionTemplate as Character["interactionTemplate"];
  if (result.statusBar && typeof result.statusBar === "object") play.statusBar = result.statusBar as Character["statusBar"];
  return play;
}
export async function fetchShelfPlayPrompt(id: string, signal?: AbortSignal): Promise<string> {
  return (await fetchShelfPlayMaterials(id, signal)).systemPrompt ?? "";
}
export async function fetchShelfPublicCharacter(id: string, signal?: AbortSignal) {
  const result = await request<{ character: ShelfPublishedCharacter }>(`/catalog/${encodeURIComponent(id)}`, "GET", undefined, signal);
  if (!result?.character?.id) throw new ShelfPublishingError(502, "角色详情无效，请稍后重试。");
  return result.character;
}
export function fetchShelfLikeStats(ids: string[], signal?: AbortSignal) {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (!unique.length) return Promise.resolve<ShelfLikeStats>({});
  const query = new URLSearchParams({ ids: unique.join(",") });
  return request<{ likes: ShelfLikeStats }>(`/likes?${query}`, "GET", undefined, signal).then((result) => result?.likes ?? {});
}
export function setShelfCharacterLike(id: string, liked: boolean, signal?: AbortSignal) {
  return request<ShelfLikeStat>(`/likes/${encodeURIComponent(id)}`, liked ? "PUT" : "DELETE", undefined, signal);
}
export async function fetchShelfPublishingMine(offset = 0, filter?: ShelfPublishingFilter) {
  const query = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (filter !== undefined) query.set("status", filter);
  const page = await request<ShelfPublishingPage<{ publications: ShelfPublication[]; status?: ShelfPublishingFilter }>>(`/mine?${query}`);
  if (!page || !Array.isArray(page.publications) || !Number.isSafeInteger(page.total) || page.total < 0
    || !Number.isSafeInteger(page.offset) || page.offset < 0 || !Number.isSafeInteger(page.limit) || page.limit < 1 || typeof page.hasMore !== "boolean") {
    throw new ShelfPublishingError(502, "发布记录响应无效，请保留草稿并刷新后重试。");
  }
  // A cached/older backend must not present an unfiltered page as a status page.
  if (filter !== undefined && page.status !== filter) throw new ShelfPublishingError(502, "发布服务未确认当前筛选，请刷新记录后重试。");
  return page;
}
export function fetchShelfSubmissions(filters: { status?: ShelfSubmissionStatus; offset?: number } = {}) {
  const query = new URLSearchParams({ limit: "20", offset: String(filters.offset ?? 0), status: filters.status ?? "pending" });
  return request<ShelfPublishingPage<{ submissions: ShelfPublishingSubmission[] }>>(`/submissions?${query}`);
}
export async function fetchShelfSubmission(id: string) {
  return (await request<{ submission: ShelfPublishingSubmission }>(`/submissions/${encodeURIComponent(id)}`)).submission;
}
export function submitShelfCharacter(character: Character, publicationId?: string, version?: number, accountId?: string) {
  if (character.authoringDraft) return Promise.reject(new ShelfPublishingError(400, "世界书还有未完成项，请先完善再提交审核。"));
  const { authoringDraft: privateDraft, ...playableCharacter } = character;
  void privateDraft;
  return request<ShelfPublishingResult>("/submissions", "POST", { character: playableCharacter, ...(publicationId ? { publicationId } : {}), ...(version === undefined ? {} : { version }), ...(accountId === undefined ? {} : { accountId }) });
}
export function withdrawShelfSubmission(id: string, version: number, accountId?: string) {
  return request<ShelfPublishingResult>(`/submissions/${encodeURIComponent(id)}/withdraw`, "POST", { version, ...(accountId === undefined ? {} : { accountId }) });
}
export type ShelfDisplayStats = { displayHeat: number; displayLikes: number };
export function reviewShelfSubmission(id: string, version: number, decision: "approved" | "rejected", reason = "", accountId?: string, stats?: ShelfDisplayStats) {
  return request<ShelfPublishingResult>(`/submissions/${encodeURIComponent(id)}/review`, "PATCH", { version, decision, reason, ...(decision === "approved" && stats ? stats : {}), ...(accountId === undefined ? {} : { accountId }) });
}
export async function setShelfDisplayStats(publicationId: string, stats: ShelfDisplayStats, accountId?: string) {
  return (await request<{ publication: ShelfPublication }>(`/publications/${encodeURIComponent(publicationId)}/display-stats`, "PATCH", { ...stats, ...(accountId === undefined ? {} : { accountId }) })).publication;
}
export async function unpublishShelfCharacter(publicationId: string, version: number, accountId?: string) {
  return (await request<{ publication: ShelfPublication }>(`/publications/${encodeURIComponent(publicationId)}/unpublish`, "POST", { version, ...(accountId === undefined ? {} : { accountId }) })).publication;
}
