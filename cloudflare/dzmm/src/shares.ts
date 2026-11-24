import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const SLUG = /^[a-z0-9]{8,16}$/;
const KINDS = ["game", "character", "story", "drama"] as const;
type Kind = (typeof KINDS)[number];
const SHARE_ORIGIN = "https://xumengchat.top";

export type ShareRow = {
  slug: string; kind: Kind; title: string; body: string; author: string;
  cover_url: string | null; source_id: string | null; created_at: number; views: number;
};

function text(value: unknown, max: number, name: string, required = false): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > max || (required && !value.trim())) {
    throw new ApiError(400, `${name}格式无效。`);
  }
  return value.trim();
}

function cleanCover(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512) throw new ApiError(400, "封面地址无效。");
  if (value.startsWith("/api/") || value.startsWith("/assets/")) return value;
  throw new ApiError(400, "封面必须来自本站。");
}

function slug(length = 10): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
}

function shareView(row: ShareRow) {
  return { slug: row.slug, kind: row.kind, title: row.title, body: row.body, author: row.author,
    coverUrl: row.cover_url, sourceId: row.source_id, createdAt: row.created_at, views: row.views,
    url: `${SHARE_ORIGIN}/s/${row.slug}` };
}

/** Public share page read path. Never returns owner ids or private payloads. */
export async function publicShare(request: Request, env: Env, requestedSlug: string): Promise<Response> {
  if (!SLUG.test(requestedSlug)) return json({ error: "分享卡片不存在。" }, 404);
  const row = await env.DB.prepare("SELECT slug,kind,title,body,author,cover_url,source_id,created_at,views FROM share_cards WHERE slug=?")
    .bind(requestedSlug).first<ShareRow>();
  if (!row) return json({ error: "分享卡片不存在。" }, 404);
  await env.DB.prepare("UPDATE share_cards SET views=views+1 WHERE slug=?").bind(requestedSlug).run().catch(() => null);
  return json({ share: shareView(row) });
}

/** Create a card snapshot; only public-safe fields are stored. */
export async function handleShares(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path !== "/v1/shares") return null;
  if (request.method !== "POST") throw new ApiError(405, "仅支持 POST。");
  if (user.isGuest) throw new ApiError(403, "登录后再生成分享卡片。");
  await rateLimit(request, env, "share-create", 12, user.id);
  const body = await readJson(request, 16 * 1024);
  const kind = typeof body.kind === "string" && KINDS.includes(body.kind as Kind) ? body.kind as Kind : "game";
  const title = text(body.title, 120, "标题", true);
  const excerpt = text(body.body ?? "", 1200, "分享文字");
  const sourceId = body.sourceId === undefined || body.sourceId === null ? null : text(body.sourceId, 120, "来源编号");
  const coverUrl = cleanCover(body.coverUrl);
  const created = Date.now();
  let createdSlug = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    createdSlug = slug();
    try {
      await env.DB.prepare(`INSERT INTO share_cards(slug,kind,title,body,author,cover_url,source_id,created_at,views)
        VALUES(?,?,?,?,?,?,?,?,0)`).bind(createdSlug, kind, title, excerpt, user.nickname || "叙梦玩家", coverUrl, sourceId, created).run();
      break;
    } catch { if (attempt === 3) throw new ApiError(503, "分享卡片生成失败，请重试。"); }
  }
  const row = await env.DB.prepare("SELECT slug,kind,title,body,author,cover_url,source_id,created_at,views FROM share_cards WHERE slug=?")
    .bind(createdSlug).first<ShareRow>();
  if (!row) throw new ApiError(503, "分享卡片生成失败，请重试。");
  return json({ share: shareView(row) }, 201);
}
