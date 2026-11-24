export const SHELF_FORUM_CATEGORIES = [
  { id: "characters", name: "角色与创作" },
  { id: "social", name: "互动交友" },
  { id: "life", name: "生活交流" },
  { id: "help", name: "站务与求助" },
  { id: "real", name: "真人专区" },
] as const;
export type ShelfForumCategory = typeof SHELF_FORUM_CATEGORIES[number]["id"];
export type ShelfForumProvenance = {
  kind: "fictional-demo"; source: "original"; label: "官方原创示例"; batchId: string;
};
export type ShelfForumAuthor = {
  id: string; nickname: string;
  isDemo?: true; provenance?: ShelfForumProvenance;
};
export function shelfForumDemoSourceLabel(author: ShelfForumAuthor): "官方原创示例" | null {
  const source = author.provenance;
  return author.isDemo === true && source?.kind === "fictional-demo" && source.source === "original"
    && source.label === "官方原创示例" && typeof source.batchId === "string" && source.batchId.trim().length > 0
    ? "官方原创示例" : null;
}
export type ShelfForumPost = {
  id: string; title: string; body: string; category: ShelfForumCategory; tags: string[];
  author: ShelfForumAuthor; createdAt: number; updatedAt: number;
  upvotes: number; downvotes: number; replyCount: number; myVote: -1 | 0 | 1;
};
export type ShelfForumReply = { id: string; postId: string; body: string; author: ShelfForumAuthor; createdAt: number };
export type ShelfForumListing = {
  posts: ShelfForumPost[]; total: number; offset: number; limit: number; hasMore: boolean;
  nextCursor?: string | null;
  popularTags: { tag: string; count: number }[];
};
export type ShelfForumDetail = {
  post: ShelfForumPost; replies: ShelfForumReply[]; total: number; offset: number; limit: number; hasMore: boolean;
  nextCursor?: string | null;
};
export type ShelfForumDraft = { title: string; body: string; category: ShelfForumCategory; tags: string[]; baseUpdatedAt?: number; requestId?: string; accountId?: string };
export type ShelfForumReport = {
  id: string; postId: string; title: string; reporter: ShelfForumAuthor; reason: string;
  status: "pending" | "resolved" | "dismissed"; createdAt: number; updatedAt: number;
};
