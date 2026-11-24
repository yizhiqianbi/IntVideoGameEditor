import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SQL_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const LIST_LIMIT = 200;
type MediaKind = "image" | "video" | "audio";

function mimeKind(value: string): MediaKind | null {
  if (value === "image/jpeg" || value === "image/png" || value === "image/webp") return "image";
  if (value === "video/mp4") return "video";
  if (value === "audio/mpeg" || value === "audio/wav" || value === "audio/mp4") return "audio";
  return null;
}
type MediaSource = "upload" | "generation" | "reference";
type MediaRow = {
  id: string;
  kind: MediaKind;
  source: MediaSource;
  name: string;
  mime_type: string;
  byte_length: number;
  created_at: number;
};

function present(row: MediaRow) {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    name: row.name,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    createdAt: row.created_at,
  };
}

function mediaName(value: unknown, kind: MediaKind, source: MediaSource): string {
  const noun = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
  const fallback = source === "reference"
    ? (kind === "image" ? "参考图" : kind === "video" ? "参考视频" : "参考音频")
    : `${source === "generation" ? "生成的" : "上传的"}${noun}`;
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || fallback;
}

function signedIn(user: UserRecord) {
  if (user.isGuest) throw new ApiError(401, "登录后才能保存素材。");
}

export async function handleCanvasUserMedia(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const item = /^\/v1\/canvas\/media\/([0-9a-f-]{36})$/i.exec(path);
  if (path !== "/v1/canvas/media" && !item) return null;
  signedIn(user);
  if (request.method === "GET" && !item) return listMedia(env, user);
  if (request.method === "POST" && !item) return registerMedia(request, env, user);
  if (request.method === "DELETE" && item) return deleteMedia(request, env, user, item[1].toLowerCase());
  throw new ApiError(405, "请求方法不支持。");
}

async function listMedia(env: Env, user: UserRecord): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id,kind,source,name,mime_type,byte_length,created_at
     FROM canvas_user_media WHERE user_id=?
     ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).bind(user.id, LIST_LIMIT).all<MediaRow>();
  return json({ items: (rows.results || []).map(present) });
}

async function registerMedia(request: Request, env: Env, user: UserRecord): Promise<Response> {
  await rateLimit(request, env, "canvas-media", 120, user.id);
  const body = await readJson(request);
  const id = typeof body.id === "string" ? body.id.toLowerCase() : "";
  if (!UUID.test(id)) throw new ApiError(400, "素材编号无效。");
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.toLowerCase().split(";")[0].trim() : "";
  const kind = mimeKind(mimeType);
  if (!kind || body.kind !== kind) throw new ApiError(400, "这种素材格式还不能保存。");
  const source = body.source === "upload" || body.source === "generation" || body.source === "reference" ? body.source : "";
  if (!source) throw new ApiError(400, "素材来源无效。");
  const byteLength = body.byteLength;
  if (!Number.isInteger(byteLength) || (byteLength as number) < 1 || (byteLength as number) > 80_000_000) {
    throw new ApiError(400, "素材大小无效。");
  }
  const contentHash = typeof body.contentHash === "string" ? body.contentHash.toLowerCase() : "";
  if (!HASH.test(contentHash)) throw new ApiError(400, "素材校验无效。");
  const name = mediaName(body.name, kind, source);
  try {
    await env.DB.prepare(
      `INSERT INTO canvas_user_media
        (id,user_id,kind,source,name,mime_type,byte_length,content_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,${SQL_NOW})
       ON CONFLICT(user_id, content_hash) DO NOTHING`,
    ).bind(id, user.id, kind, source, name, mimeType, byteLength, contentHash).run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "素材没有保存。");
  }
  const row = await env.DB.prepare(
    `SELECT id,kind,source,name,mime_type,byte_length,created_at
     FROM canvas_user_media WHERE user_id=? AND content_hash=?`,
  ).bind(user.id, contentHash).first<MediaRow>();
  if (!row) throw new ApiError(400, "素材没有保存。");
  const reused = row.id !== id;
  return json({ media: present(row), reused }, reused ? 200 : 201);
}

async function deleteMedia(request: Request, env: Env, user: UserRecord, id: string): Promise<Response> {
  if (!UUID.test(id)) throw new ApiError(400, "素材编号无效。");
  await rateLimit(request, env, "canvas-media", 120, user.id);
  const result = await env.DB.prepare(
    "DELETE FROM canvas_user_media WHERE user_id=? AND id=?",
  ).bind(user.id, id).run();
  if (!result.meta.changes) throw new ApiError(404, "素材不存在。");
  return json({ deleted: true, id });
}
