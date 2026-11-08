export const DZMM_FORUM_CATEGORIES = [
  { id: "characters", name: "角色与创作" },
  { id: "social", name: "互动交友" },
  { id: "life", name: "生活交流" },
  { id: "help", name: "站务与求助" },
  { id: "real", name: "真人专区" },
] as const;
export type DzmmForumCategory = typeof DZMM_FORUM_CATEGORIES[number]["id"];
export type DzmmForumProvenance = {
  kind: "fictional-demo"; source: "original"; label: "官方原创示例"; batchId: string;
};
export type DzmmForumAuthor = {
  id: string; nickname: string;
  isDemo?: true; provenance?: DzmmForumProvenance;
};
export function dzmmForumDemoSourceLabel(author: DzmmForumAuthor): "官方原创示例" | null {
  const source = author.provenance;
  return author.isDemo === true && source?.kind === "fictional-demo" && source.source === "original"
    && source.label === "官方原创示例" && typeof source.batchId === "string" && source.batchId.trim().length > 0
    ? "官方原创示例" : null;
}
export type DzmmForumPost = {
  id: string; title: string; body: string; category: DzmmForumCategory; tags: string[];
  author: DzmmForumAuthor; createdAt: number; updatedAt: number;
  upvotes: number; downvotes: number; replyCount: number; myVote: -1 | 0 | 1;
};
export type DzmmForumReply = { id: string; postId: string; body: string; author: DzmmForumAuthor; createdAt: number };
export type DzmmForumListing = {
  posts: DzmmForumPost[]; total: number; offset: number; limit: number; hasMore: boolean;
  nextCursor?: string | null;
  popularTags: { tag: string; count: number }[];
};
export type DzmmForumDetail = {
  post: DzmmForumPost; replies: DzmmForumReply[]; total: number; offset: number; limit: number; hasMore: boolean;
  nextCursor?: string | null;
};
export type DzmmForumDraft = { title: string; body: string; category: DzmmForumCategory; tags: string[]; baseUpdatedAt?: number; requestId?: string; accountId?: string };
export type DzmmForumReport = {
  id: string; postId: string; title: string; reporter: DzmmForumAuthor; reason: string;
  status: "pending" | "resolved" | "dismissed"; createdAt: number; updatedAt: number;
};
