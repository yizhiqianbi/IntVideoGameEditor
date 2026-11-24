import { ShelfCloudError, shelfCloudRequest } from "./shelf-cloud";
import { SHELF_FORUM_CATEGORIES, type ShelfForumListing, type ShelfForumDetail, type ShelfForumDraft, type ShelfForumPost, type ShelfForumReply, type ShelfForumReport } from "./shelf-forum-types";
export * from "./shelf-forum-types";

export class ShelfForumEditConflictError extends ShelfCloudError {
  constructor(status: number, message: string, public current?: ShelfForumPost) { super(status, message); this.name = "ShelfForumEditConflictError"; }
}

function currentPost(value: unknown, id: string): value is ShelfForumPost {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const post = value as Record<string, unknown>;
  const timestamp = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const content = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !v.includes("\0");
  const author = post.author as Record<string, unknown> | undefined;
  return post.id === id && content(post.title, 120) && content(post.body, 12_000)
    && SHELF_FORUM_CATEGORIES.some(item => item.id === post.category) && Array.isArray(post.tags) && post.tags.length <= 10
    && post.tags.every(tag => content(tag, 40)) && Boolean(author && typeof author === "object" && content(author.id, 120) && content(author.nickname, 120))
    && timestamp(post.createdAt) && timestamp(post.updatedAt) && timestamp(post.upvotes) && timestamp(post.downvotes) && timestamp(post.replyCount)
    && [-1, 0, 1].includes(post.myVote as number);
}
function sameContent(current: ShelfForumPost, draft: ShelfForumDraft) {
  const tags = (values: string[]) => JSON.stringify([...new Set(values.map(value => value.trim()))].sort());
  return current.title === draft.title.trim() && current.body === draft.body.trim() && current.category === draft.category && tags(current.tags) === tags(draft.tags);
}

export function fetchShelfForumPosts(filters: { category?: string; q?: string; tag?: string; offset?: number; cursor?: string } = {}) {
  const query = new URLSearchParams({ limit: "20" });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && (value !== "" || key === "cursor")) query.set(key, String(value));
  return shelfCloudRequest<ShelfForumListing>(`/forum/posts?${query}`);
}
export function fetchShelfForumPost(id: string, offset = 0, cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor !== undefined) query.set("cursor", cursor); else query.set("offset", String(offset));
  return shelfCloudRequest<ShelfForumDetail>(`/forum/posts/${encodeURIComponent(id)}?${query}`);
}
export async function saveShelfForumPost(draft: ShelfForumDraft, id?: string) {
  try {
    const result = await shelfCloudRequest<{ post: ShelfForumPost }>(`/forum/posts${id ? `/${encodeURIComponent(id)}` : ""}`, id ? "PATCH" : "POST", draft);
    return result.post;
  } catch (failure) {
    if (!id || !(failure instanceof ShelfCloudError) || ![409, 428].includes(failure.status)) throw failure;
    const data = failure.data as { current?: unknown } | null | undefined;
    const current = currentPost(data?.current, id) ? data!.current : undefined;
    // A lost PATCH response can be acknowledged only when this exact desired
    // revision is already present. Never retry a changed payload automatically.
    if (failure.status === 409 && current && Number.isSafeInteger(draft.baseUpdatedAt) && draft.baseUpdatedAt! >= 0
      && current.updatedAt > draft.baseUpdatedAt! && sameContent(current, draft)) return current;
    throw new ShelfForumEditConflictError(failure.status, failure.message, current);
  }
}
export function deleteShelfForumPost(id: string) {
  return shelfCloudRequest<{ deleted: true }>(`/forum/posts/${encodeURIComponent(id)}`, "DELETE");
}
export async function replyShelfForumPost(id: string, body: string) {
  return shelfCloudRequest<{ reply: ShelfForumReply }>(`/forum/posts/${encodeURIComponent(id)}/replies`, "POST", { body });
}
export function deleteShelfForumReply(id: string) {
  return shelfCloudRequest<{ deleted: true }>(`/forum/replies/${encodeURIComponent(id)}`, "DELETE");
}
export async function voteShelfForumPost(id: string, value: -1 | 0 | 1) {
  const result = await shelfCloudRequest<{ post: ShelfForumPost }>(`/forum/posts/${encodeURIComponent(id)}/vote`, "PUT", { value });
  return result.post;
}
export function reportShelfForumPost(id: string, reason: string) {
  return shelfCloudRequest<{ reported: true }>(`/forum/posts/${encodeURIComponent(id)}/report`, "POST", { reason });
}
export function fetchShelfForumReports(offset = 0, status = "pending") {
  return shelfCloudRequest<{ reports: ShelfForumReport[]; total: number; offset: number; limit: number; hasMore: boolean }>(`/forum/reports?offset=${offset}&limit=20&status=${encodeURIComponent(status)}`);
}
export function reviewShelfForumReport(id: string, status: "resolved" | "dismissed") {
  return shelfCloudRequest<{ reviewed: true }>(`/forum/reports/${encodeURIComponent(id)}/status`, "PATCH", { status });
}
