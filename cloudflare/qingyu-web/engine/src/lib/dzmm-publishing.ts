import type { Character } from "./dzmm-characters";

export type DzmmSubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";
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
  previewCoverUrl: string; previewGalleryUrls?: string[];
};
export type DzmmPublication = {
  id: string; ownerId: string; privateCharacterId: string; version: number;
  currentRevision: number; approvedRevision: number | null; isListed: boolean;
  createdAt: number; updatedAt: number; latestSubmission: DzmmPublishingSubmission;
};
export type DzmmPublishingResult = { publication: DzmmPublication; submission: DzmmPublishingSubmission };
export type DzmmPublishingPage<T> = { total: number; offset: number; limit: number; hasMore: boolean } & T;

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
export function fetchDzmmPublicCharacters(offset = 0) {
  return request<DzmmPublishingPage<{ characters: DzmmPublishedCharacter[] }>>(`/catalog?limit=20&offset=${offset}`);
}
export function fetchDzmmLikeStats(ids: string[], signal?: AbortSignal) {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (!unique.length) return Promise.resolve<DzmmLikeStats>({});
  const query = new URLSearchParams({ ids: unique.join(",") });
  return request<{ likes: DzmmLikeStats }>(`/likes?${query}`, "GET", undefined, signal).then((result) => result.likes ?? {});
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
export function fetchDzmmSubmissions(filters: { status?: DzmmSubmissionStatus; offset?: number } = {}) {
  const query = new URLSearchParams({ limit: "20", offset: String(filters.offset ?? 0), status: filters.status ?? "pending" });
  return request<DzmmPublishingPage<{ submissions: DzmmPublishingSubmission[] }>>(`/submissions?${query}`);
}
export async function fetchDzmmSubmission(id: string) {
  return (await request<{ submission: DzmmPublishingSubmission }>(`/submissions/${encodeURIComponent(id)}`)).submission;
}
export function submitDzmmCharacter(character: Character, publicationId?: string, version?: number, accountId?: string) {
  if (character.authoringDraft) return Promise.reject(new DzmmPublishingError(400, "世界书还有未完成项，请先完善再提交审核。"));
  const { authoringDraft: privateDraft, ...playableCharacter } = character;
  void privateDraft;
  return request<DzmmPublishingResult>("/submissions", "POST", { character: playableCharacter, ...(publicationId ? { publicationId } : {}), ...(version === undefined ? {} : { version }), ...(accountId === undefined ? {} : { accountId }) });
}
export function withdrawDzmmSubmission(id: string, version: number, accountId?: string) {
  return request<DzmmPublishingResult>(`/submissions/${encodeURIComponent(id)}/withdraw`, "POST", { version, ...(accountId === undefined ? {} : { accountId }) });
}
export function reviewDzmmSubmission(id: string, version: number, decision: "approved" | "rejected", reason = "", accountId?: string) {
  return request<DzmmPublishingResult>(`/submissions/${encodeURIComponent(id)}/review`, "PATCH", { version, decision, reason, ...(accountId === undefined ? {} : { accountId }) });
}
export async function unpublishDzmmCharacter(publicationId: string, version: number, accountId?: string) {
  return (await request<{ publication: DzmmPublication }>(`/publications/${encodeURIComponent(publicationId)}/unpublish`, "POST", { version, ...(accountId === undefined ? {} : { accountId }) })).publication;
}
