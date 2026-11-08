import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import { normalizeShelfTag, shelfTagError } from "../../../src/lib/xumeng-shelf-tags";
import type { Env, UserRecord } from "./types";

const USER_CAP = 40;
const GLOBAL_CAP = 500;

export async function listShelfTags(env: Env): Promise<Response> {
  const rows = await env.DB.prepare("SELECT tag FROM shelf_tags ORDER BY created_at DESC, tag ASC LIMIT 200").all<{ tag: string }>();
  return json({ tags: rows.results.map((row) => row.tag) });
}

export async function handleShelfTagWrite(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/shelf-tags" || request.method !== "POST") return null;
  if (user.isGuest) throw new ApiError(403, "请先注册或登录，再上传标签。");
  await rateLimit(request, env, "shelf-tag-account", 12, user.id);
  await rateLimit(request, env, "shelf-tag-ip", 30);
  const body = await readJson(request, 4096);
  if (typeof body.tag !== "string") throw new ApiError(400, "请输入标签。");
  const error = shelfTagError(body.tag);
  if (error) throw new ApiError(400, error);
  const tag = normalizeShelfTag(body.tag);
  const normalized = tag.toLowerCase();
  const existing = await env.DB.prepare("SELECT tag FROM shelf_tags WHERE normalized=?").bind(normalized).first<{ tag: string }>();
  if (existing) return json({ tag: existing.tag, created: false });
  const counts = await env.DB.batch<{ count: number }>([
    env.DB.prepare("SELECT COUNT(*) AS count FROM shelf_tags WHERE user_id=?").bind(user.id),
    env.DB.prepare("SELECT COUNT(*) AS count FROM shelf_tags"),
  ]);
  const mine = Number(counts[0].results[0]?.count ?? 0);
  const total = Number(counts[1].results[0]?.count ?? 0);
  if (mine >= USER_CAP) throw new ApiError(400, "你上传的标签已经达到 40 个。");
  if (total >= GLOBAL_CAP) throw new ApiError(400, "首页标签已满，请先使用已有标签。");
  await env.DB.prepare(`INSERT INTO shelf_tags (tag, normalized, user_id, created_at)
    SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM shelf_tags WHERE normalized=?)`).bind(tag, normalized, user.id, Date.now(), normalized).run();
  const saved = await env.DB.prepare("SELECT tag FROM shelf_tags WHERE normalized=?").bind(normalized).first<{ tag: string }>();
  if (!saved) throw new ApiError(500, "标签没有保存，请再试一次。");
  return json({ tag: saved.tag, created: saved.tag === tag }, saved.tag === tag ? 201 : 200);
}
