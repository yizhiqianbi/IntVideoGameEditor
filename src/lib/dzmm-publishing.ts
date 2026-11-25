import type { Character } from "./dzmm-characters";
import { DZMM_PUBLIC_SHELF_PAGE_SIZE, type DzmmCatalogApplied, type DzmmCatalogRequest } from "./dzmm-public-shelf";

export type DzmmSubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";
/** Publication ids are `published-` plus a UUID; private character ids can be 120 characters. */
export const DZMM_REVIEW_SEARCH_MAX = 120;

/** Trim a review-queue search. Blank means no extra filter. */
export function normalizeDzmmReviewSearch(raw: string): string {
  if (raw.length > DZMM_REVIEW_SEARCH_MAX || /[\0\r\n]/.test(raw)) throw new Error("搜索词无效。");
  return raw.trim();
}
export type DzmmPublishingFilter = "all" | "pending" | "published" | "rejected" | "archived";
export type DzmmPublishedCharacter = Character & {
  publication: { id: string; authorId: string; revision: number; publishedAt: number };
};
export type DzmmLikeStat = { count: number; liked: boolean };
export type DzmmLikeStats = Record<string, DzmmLikeStat>;
export type DzmmPublishingSubmission = {
  id: string; publicationId: string; revision: number; status: DzmmSubmissionStatus;
  character: Character; author: { id: string; nickname: string };
  reason: string; createdAt: number; reviewedAt: number | null; publicationVersion: number;
  isListed: boolean; approvedRevision: number | null;
  displayHeat?: number; displayLikes?: number;
  previewCoverUrl: string; previewGalleryUrls?: string[];
};
export type DzmmPublication = {
  id: string; ownerId: string; privateCharacterId: string; version: number;
  currentRevision: number; approvedRevision: number | null; isListed: boolean;
  createdAt: number; updatedAt: number; latestSubmission: DzmmPublishingSubmission;
};
export type DzmmPublishingResult = { publication: DzmmPublication; submission: DzmmPublishingSubmission };
export type DzmmPublishingPage<T> = { total: number; offset: number; limit: number; hasMore: boolean; q?: string; applied?: DzmmCatalogApplied } & T;

export class DzmmPublishingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmPublishingError"; }
}
const API = "/api/backend/v1/publishing";
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    const options = { method, credentials: "same-origin", cache: "no-store", signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) };
    response = await fetch(`${API}${path}`, options as Parameters<typeof fetch>[1]);
  } catch { throw new DzmmPublishingError(503, "发布服务暂时无法连接，请保留草稿后重试。"); }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new DzmmPublishingError(response.status, typeof result?.error === "string" ? result.error : "发布请求失败，请刷新状态后重试。");
  return result as T;
}
export function fetchDzmmPublicCharacters(query: number | DzmmCatalogRequest = 0) {
  const input: DzmmCatalogRequest = typeof query === "number" ? { offset: query, limit: DZMM_PUBLIC_SHELF_PAGE_SIZE, view: "card" } : query;
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? DZMM_PUBLIC_SHELF_PAGE_SIZE));
  params.set("offset", String(input.offset ?? 0));
  params.set("view", input.view ?? "card");
  if (input.sort) params.set("sort", input.sort);
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.tags?.length) params.set("tags", input.tags.join(","));
  if (input.authorIds?.length) params.set("authors", input.authorIds.join(","));
  if (input.ids?.length) params.set("ids", input.ids.join(","));
  if (input.since) params.set("since", String(input.since));
  if (input.look) params.set("look", input.look);
  return request<DzmmPublishingPage<{ characters: DzmmPublishedCharacter[] }>>(`/catalog?${params}`);
}
export type DzmmPlayMaterials = Pick<Character, "systemPrompt" | "postHistoryInstructions" | "messageExamples" | "characterBook" | "interactionTemplate" | "statusBar">;

const PLAY_MATERIALS_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAY_MATERIALS_CACHE_MAX = 64;
const playMaterialsCache = new Map<string, { value: DzmmPlayMaterials; expiresAt: number }>();
const playMaterialsInflight = new Map<string, Promise<DzmmPlayMaterials>>();

export function clearDzmmPlayMaterialsCache(id?: string): void {
  if (id === undefined) {
    playMaterialsCache.clear();
    playMaterialsInflight.clear();
  } else {
    playMaterialsCache.delete(id);
    playMaterialsInflight.delete(id);
  }
}

function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

export async function fetchDzmmPlayMaterials(id: string, signal?: AbortSignal): Promise<DzmmPlayMaterials> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const now = Date.now();
  const cached = playMaterialsCache.get(id);
  if (cached && cached.expiresAt > now) {
    // Refresh LRU order
    playMaterialsCache.delete(id);
    playMaterialsCache.set(id, cached);
    return cached.value;
  }
  if (cached) playMaterialsCache.delete(id);

  let inflight = playMaterialsInflight.get(id);
  if (!inflight) {
    inflight = (async () => {
      const result = await request<Record<string, unknown>>(`/catalog/${encodeURIComponent(id)}/prompt`, "GET");
      if (!result || typeof result.systemPrompt !== "string") throw new DzmmPublishingError(502, "角色扮演指令无效，请稍后重试。");
      const play: DzmmPlayMaterials = {
        systemPrompt: result.systemPrompt,
      };
      if (typeof result.postHistoryInstructions === "string") play.postHistoryInstructions = result.postHistoryInstructions;
      if (typeof result.messageExamples === "string") play.messageExamples = result.messageExamples;
      if (result.characterBook && typeof result.characterBook === "object") play.characterBook = result.characterBook as Character["characterBook"];
      if (result.interactionTemplate && typeof result.interactionTemplate === "object") play.interactionTemplate = result.interactionTemplate as Character["interactionTemplate"];
      if (result.statusBar && typeof result.statusBar === "object") play.statusBar = result.statusBar as Character["statusBar"];
      playMaterialsCache.set(id, { value: play, expiresAt: Date.now() + PLAY_MATERIALS_CACHE_TTL_MS });
      while (playMaterialsCache.size > PLAY_MATERIALS_CACHE_MAX) {
        const oldestKey = playMaterialsCache.keys().next().value;
        if (oldestKey === undefined) break;
        playMaterialsCache.delete(oldestKey);
      }
      return play;
    })().finally(() => {
      if (playMaterialsInflight.get(id) === inflight) playMaterialsInflight.delete(id);
    });
    playMaterialsInflight.set(id, inflight);
  }
  return awaitWithSignal(inflight, signal);
}
export async function fetchDzmmPlayPrompt(id: string, signal?: AbortSignal): Promise<string> {
  return (await fetchDzmmPlayMaterials(id, signal)).systemPrompt ?? "";
}
export async function fetchDzmmPublicCharacter(id: string, signal?: AbortSignal) {
  const result = await request<{ character: DzmmPublishedCharacter }>(`/catalog/${encodeURIComponent(id)}`, "GET", undefined, signal);
  if (!result?.character?.id) throw new DzmmPublishingError(502, "角色详情无效，请稍后重试。");
  return result.character;
}
export function fetchDzmmLikeStats(ids: string[], signal?: AbortSignal) {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (!unique.length) return Promise.resolve<DzmmLikeStats>({});
  const query = new URLSearchParams({ ids: unique.join(",") });
  return request<{ likes: DzmmLikeStats }>(`/likes?${query}`, "GET", undefined, signal).then((result) => result?.likes ?? {});
}
export function setDzmmCharacterLike(id: string, liked: boolean, signal?: AbortSignal) {
  return request<DzmmLikeStat>(`/likes/${encodeURIComponent(id)}`, liked ? "PUT" : "DELETE", undefined, signal);
}
export async function fetchDzmmPublishingMine(offset = 0, filter?: DzmmPublishingFilter) {
  const query = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (filter !== undefined) query.set("status", filter);
  const page = await request<DzmmPublishingPage<{ publications: DzmmPublication[]; status?: DzmmPublishingFilter }>>(`/mine?${query}`);
  if (!page || !Array.isArray(page.publications) || !Number.isSafeInteger(page.total) || page.total < 0
    || !Number.isSafeInteger(page.offset) || page.offset < 0 || !Number.isSafeInteger(page.limit) || page.limit < 1 || typeof page.hasMore !== "boolean") {
    throw new DzmmPublishingError(502, "发布记录响应无效，请保留草稿并刷新后重试。");
  }
  // A cached/older backend must not present an unfiltered page as a status page.
  if (filter !== undefined && page.status !== filter) throw new DzmmPublishingError(502, "发布服务未确认当前筛选，请刷新记录后重试。");
  return page;
}
export async function fetchDzmmSubmissions(filters: { status?: DzmmSubmissionStatus; offset?: number; q?: string } = {}) {
  const q = normalizeDzmmReviewSearch(filters.q ?? "");
  const query = new URLSearchParams({ limit: "20", offset: String(filters.offset ?? 0), status: filters.status ?? "pending" });
  if (q) query.set("q", q);
  const page = await request<DzmmPublishingPage<{ submissions: DzmmPublishingSubmission[] }>>(`/submissions?${query}`);
  // An older worker that ignores q would otherwise return the whole status page.
  if (q && page?.q !== q) throw new DzmmPublishingError(502, "审核服务未确认当前搜索，请刷新后重试。");
  return page;
}
export async function fetchDzmmSubmission(id: string) {
  return (await request<{ submission: DzmmPublishingSubmission }>(`/submissions/${encodeURIComponent(id)}`)).submission;
}
export function submitDzmmCharacter(character: Character, publicationId?: string, version?: number, accountId?: string) {
  if (character.authoringDraft) return Promise.reject(new DzmmPublishingError(400, "世界书还有未完成项，请先完善再提交审核。"));
  const { authoringDraft: privateDraft, ...playableCharacter } = character;
  void privateDraft;
  clearDzmmPlayMaterialsCache(character.id);
  return request<DzmmPublishingResult>("/submissions", "POST", { character: playableCharacter, ...(publicationId ? { publicationId } : {}), ...(version === undefined ? {} : { version }), ...(accountId === undefined ? {} : { accountId }) });
}
export function withdrawDzmmSubmission(id: string, version: number, accountId?: string) {
  return request<DzmmPublishingResult>(`/submissions/${encodeURIComponent(id)}/withdraw`, "POST", { version, ...(accountId === undefined ? {} : { accountId }) });
}
export type DzmmDisplayStats = { displayHeat: number; displayLikes: number };
export function reviewDzmmSubmission(id: string, version: number, decision: "approved" | "rejected", reason = "", accountId?: string, stats?: DzmmDisplayStats) {
  clearDzmmPlayMaterialsCache();
  return request<DzmmPublishingResult>(`/submissions/${encodeURIComponent(id)}/review`, "PATCH", { version, decision, reason, ...(decision === "approved" && stats ? stats : {}), ...(accountId === undefined ? {} : { accountId }) });
}
export async function setDzmmDisplayStats(publicationId: string, stats: DzmmDisplayStats, accountId?: string) {
  return (await request<{ publication: DzmmPublication }>(`/publications/${encodeURIComponent(publicationId)}/display-stats`, "PATCH", { ...stats, ...(accountId === undefined ? {} : { accountId }) })).publication;
}
export async function unpublishDzmmCharacter(publicationId: string, version: number, accountId?: string) {
  clearDzmmPlayMaterialsCache();
  return (await request<{ publication: DzmmPublication }>(`/publications/${encodeURIComponent(publicationId)}/unpublish`, "POST", { version, ...(accountId === undefined ? {} : { accountId }) })).publication;
}
