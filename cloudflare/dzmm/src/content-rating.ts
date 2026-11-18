import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

/** One switch for the whole shelf: everyone sees the same rating. */
export type ContentRating = "nsfw" | "sfw";
const KEY = "content_rating";

export function parseContentRating(value: unknown): ContentRating | null {
  return value === "nsfw" || value === "sfw" ? value : null;
}

export async function readContentRating(env: Pick<Env, "DB">): Promise<ContentRating> {
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key=?").bind(KEY).first<{ value: string }>();
    return parseContentRating(row?.value) ?? "sfw";
  } catch {
    return "sfw";
  }
}

export function ratingPayload(rating: ContentRating) {
  return {
    rating,
    nsfw: rating === "nsfw",
    label: rating === "nsfw" ? "NSFW" : "SFW",
    note: rating === "nsfw" ? "书架展示成人向内容。" : "书架只展示非成人向内容，现有内容会暂时隐藏。",
  };
}

export async function publicContentRating(env: Pick<Env, "DB">): Promise<Response> {
  return json(ratingPayload(await readContentRating(env)));
}

export async function handleContentRating(request: Request, env: Env, user?: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === "/v1/site/rating") {
    if (request.method !== "GET") throw new ApiError(405, "内容分级只支持 GET。");
    return publicContentRating(env);
  }
  if (path !== "/v1/admin/rating") return null;
  if (!user || user.isGuest || user.role !== "super") throw new ApiError(403, "只有管理员可以切换内容分级。");
  if (request.method !== "POST") throw new ApiError(405, "内容分级设置只支持 POST。");
  const body = await readJson(request, 512);
  const rating = parseContentRating((body as { rating?: unknown }).rating);
  if (!rating) throw new ApiError(400, "内容分级只能是 nsfw 或 sfw。");
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO site_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(KEY, rating, now).run();
  return json(ratingPayload(rating));
}
