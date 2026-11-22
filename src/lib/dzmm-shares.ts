export type DzmmShareKind = "game" | "character" | "story" | "drama";

export type DzmmShare = {
  slug: string;
  kind: DzmmShareKind;
  title: string;
  body: string;
  author: string;
  coverUrl: string | null;
  sourceId: string | null;
  createdAt: number;
  views: number;
  url: string;
};

export type DzmmShareInput = {
  kind: DzmmShareKind;
  title: string;
  body?: string;
  coverUrl?: string;
  sourceId?: string;
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function parseShare(value: unknown): DzmmShare {
  if (!record(value) || typeof value.slug !== "string" || typeof value.title !== "string" || typeof value.url !== "string"
    || !["game", "character", "story", "drama"].includes(String(value.kind))) throw new Error("分享卡片数据无效，请重试。");
  return {
    slug: value.slug, kind: value.kind as DzmmShareKind, title: value.title,
    body: typeof value.body === "string" ? value.body : "",
    author: typeof value.author === "string" ? value.author : "叙梦玩家",
    coverUrl: typeof value.coverUrl === "string" ? value.coverUrl : null,
    sourceId: typeof value.sourceId === "string" ? value.sourceId : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    views: typeof value.views === "number" ? value.views : 0,
    url: value.url,
  };
}

export async function createDzmmShare(input: DzmmShareInput, signal?: AbortSignal): Promise<DzmmShare> {
  const response = await fetch("/api/backend/v1/shares", {
    method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as { share?: unknown; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || (response.status === 403 ? "请先登录后再生成分享卡片。" : "分享卡片生成失败，请重试。"));
  return parseShare(payload?.share);
}
