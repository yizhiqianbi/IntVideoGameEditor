import { DzmmCloudError, dzmmCloudRequest } from "./dzmm-cloud";
import { DZMM_FORUM_CATEGORIES, type DzmmForumListing, type DzmmForumDetail, type DzmmForumDraft, type DzmmForumPost, type DzmmForumReply, type DzmmForumReport } from "./dzmm-forum-types";
export * from "./dzmm-forum-types";

export class DzmmForumEditConflictError extends DzmmCloudError {
  constructor(status: number, message: string, public current?: DzmmForumPost) { super(status, message); this.name = "DzmmForumEditConflictError"; }
}

function currentPost(value: unknown, id: string): value is DzmmForumPost {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const post = value as Record<string, unknown>;
  const timestamp = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const content = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !v.includes("\0");
  const author = post.author as Record<string, unknown> | undefined;
  return post.id === id && content(post.title, 120) && content(post.body, 12_000)
    && DZMM_FORUM_CATEGORIES.some(item => item.id === post.category) && Array.isArray(post.tags) && post.tags.length <= 10
    && post.tags.every(tag => content(tag, 40)) && Boolean(author && typeof author === "object" && content(author.id, 120) && content(author.nickname, 120))
    && timestamp(post.createdAt) && timestamp(post.updatedAt) && timestamp(post.upvotes) && timestamp(post.downvotes) && timestamp(post.replyCount)
    && [-1, 0, 1].includes(post.myVote as number);
}
function sameContent(current: DzmmForumPost, draft: DzmmForumDraft) {
  const tags = (values: string[]) => JSON.stringify([...new Set(values.map(value => value.trim()))].sort());
  return current.title === draft.title.trim() && current.body === draft.body.trim() && current.category === draft.category && tags(current.tags) === tags(draft.tags);
}

export function fetchDzmmForumPosts(filters: { category?: string; q?: string; tag?: string; offset?: number; cursor?: string } = {}) {
  const query = new URLSearchParams({ limit: "20" });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && (value !== "" || key === "cursor")) query.set(key, String(value));
  return dzmmCloudRequest<DzmmForumListing>(`/forum/posts?${query}`);
}
export function fetchDzmmForumPost(id: string, offset = 0, cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor !== undefined) query.set("cursor", cursor); else query.set("offset", String(offset));
  return dzmmCloudRequest<DzmmForumDetail>(`/forum/posts/${encodeURIComponent(id)}?${query}`);
}
export async function saveDzmmForumPost(draft: DzmmForumDraft, id?: string) {
  try {
    const result = await dzmmCloudRequest<{ post: DzmmForumPost }>(`/forum/posts${id ? `/${encodeURIComponent(id)}` : ""}`, id ? "PATCH" : "POST", draft);
    return result.post;
  } catch (failure) {
    if (!id || !(failure instanceof DzmmCloudError) || ![409, 428].includes(failure.status)) throw failure;
    const data = failure.data as { current?: unknown } | null | undefined;
    const current = currentPost(data?.current, id) ? data!.current : undefined;
    // A lost PATCH response can be acknowledged only when this exact desired
    // revision is already present. Never retry a changed payload automatically.
    if (failure.status === 409 && current && Number.isSafeInteger(draft.baseUpdatedAt) && draft.baseUpdatedAt! >= 0
      && current.updatedAt > draft.baseUpdatedAt! && sameContent(current, draft)) return current;
    throw new DzmmForumEditConflictError(failure.status, failure.message, current);
  }
}
export function deleteDzmmForumPost(id: string) {
  return dzmmCloudRequest<{ deleted: true }>(`/forum/posts/${encodeURIComponent(id)}`, "DELETE");
}
export async function replyDzmmForumPost(id: string, body: string) {
  return dzmmCloudRequest<{ reply: DzmmForumReply }>(`/forum/posts/${encodeURIComponent(id)}/replies`, "POST", { body });
}
export function deleteDzmmForumReply(id: string) {
  return dzmmCloudRequest<{ deleted: true }>(`/forum/replies/${encodeURIComponent(id)}`, "DELETE");
}
export async function voteDzmmForumPost(id: string, value: -1 | 0 | 1) {
  const result = await dzmmCloudRequest<{ post: DzmmForumPost }>(`/forum/posts/${encodeURIComponent(id)}/vote`, "PUT", { value });
  return result.post;
}
export function reportDzmmForumPost(id: string, reason: string) {
  return dzmmCloudRequest<{ reported: true }>(`/forum/posts/${encodeURIComponent(id)}/report`, "POST", { reason });
}
export function fetchDzmmForumReports(offset = 0, status = "pending") {
  return dzmmCloudRequest<{ reports: DzmmForumReport[]; total: number; offset: number; limit: number; hasMore: boolean }>(`/forum/reports?offset=${offset}&limit=20&status=${encodeURIComponent(status)}`);
}
export function reviewDzmmForumReport(id: string, status: "resolved" | "dismissed") {
  return dzmmCloudRequest<{ reviewed: true }>(`/forum/reports/${encodeURIComponent(id)}/status`, "PATCH", { status });
}
