import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const ALBUM_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MEDIA_KEY = /^[A-Za-z0-9-]+\/[a-f0-9-]+\.(png|jpe?g|webp|gif)$/;
const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);
const ALBUM_LIMIT = 200;

type AlbumRow = { id: string; kind: "image" | "video"; mime_type: string; created_at: number; object_key: string };
const PUBLIC_ALBUM_JOIN = `JOIN character_publications p ON p.private_character_id=r.character_id
  JOIN character_submissions s ON s.publication_id=p.id AND s.revision=p.current_revision AND s.status='approved'`;

function characterId(value: string): string {
  const id = value.trim();
  if (id.length < 1 || id.length > 120 || /[\u0000-\u001f\u007f]/u.test(id)) throw new ApiError(400, "角色编号不正确。");
  return id;
}

function extensionMime(key: string): string | null {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_TYPES.get(extension) ?? null;
}

export async function rememberChatImage(env: Env, userId: string, assetId: string, createdAt: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO relationship_album (id, user_id, character_id, kind, object_key, mime_type, created_at, source_asset_id)
    SELECT ?, a.user_id, c.character_id, 'image', a.object_key, a.mime_type, ?, a.id
    FROM chat_media_assets a
    JOIN conversations c ON c.user_id = a.user_id AND c.id = a.conversation_id
    WHERE a.id = ? AND a.user_id = ? AND a.status = 'ready' AND a.kind = 'image'
      AND a.mime_type IN ('image/jpeg','image/png','image/webp')
      AND length(c.character_id) BETWEEN 1 AND 120
      AND instr(c.character_id, char(0)) = 0
      AND length(a.object_key) BETWEEN 1 AND 512
      AND (SELECT COUNT(*) FROM relationship_album r WHERE r.user_id = a.user_id AND r.character_id = c.character_id) < ?
    ON CONFLICT(user_id, source_asset_id) DO UPDATE SET object_key=excluded.object_key, mime_type=excluded.mime_type, created_at=excluded.created_at`).bind(crypto.randomUUID(), createdAt, assetId, userId, ALBUM_LIMIT).run();
}

export async function rememberChatVideo(env: Env, userId: string, assetId: string, createdAt: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO relationship_album (id, user_id, character_id, kind, object_key, mime_type, created_at, source_asset_id)
    SELECT ?, a.user_id, c.character_id, 'video', a.object_key, a.mime_type, ?, a.id
    FROM chat_media_assets a
    JOIN conversations c ON c.user_id = a.user_id AND c.id = a.conversation_id
    WHERE a.id = ? AND a.user_id = ? AND a.status = 'ready' AND a.kind = 'video'
      AND a.mime_type = 'video/mp4'
      AND length(c.character_id) BETWEEN 1 AND 120
      AND instr(c.character_id, char(0)) = 0
      AND length(a.object_key) BETWEEN 1 AND 512
      AND (SELECT COUNT(*) FROM relationship_album r WHERE r.user_id = a.user_id AND r.character_id = c.character_id) < ?
    ON CONFLICT(user_id, source_asset_id) DO UPDATE SET object_key=excluded.object_key, mime_type=excluded.mime_type, created_at=excluded.created_at`).bind(crypto.randomUUID(), createdAt, assetId, userId, ALBUM_LIMIT).run();
}

async function readAlbumAsset(env: Env, user: UserRecord, id: string): Promise<Response | null> {
  if (!env.MEDIA) throw new ApiError(503, "相册暂时无法打开。");
  const row = await env.DB.prepare("SELECT id, kind, mime_type, created_at, object_key FROM relationship_album WHERE id=? AND user_id=?")
    .bind(id, user.id).first<AlbumRow>();
  if (!row) return null;
  let object: R2ObjectBody | null;
  try { object = await env.MEDIA.get(row.object_key); }
  catch { throw new ApiError(503, "相册暂时无法打开。"); }
  if (!object || !("body" in object)) return null;
  if (object.customMetadata?.ownerId && object.customMetadata.ownerId !== user.id) return null;
  const headers = new Headers({
    "Content-Type": row.mime_type,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `inline; filename="${row.id}.${row.kind === "video" ? "mp4" : row.mime_type === "image/png" ? "png" : row.mime_type === "image/webp" ? "webp" : row.mime_type === "image/gif" ? "gif" : "jpg"}"`,
    "Content-Length": String(object.size),
  });
  if (row.kind === "video") headers.set("Accept-Ranges", "bytes");
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers });
}

async function readPublicAlbumAsset(env: Env, id: string): Promise<Response> {
  if (!env.MEDIA) throw new ApiError(503, "相册暂时无法打开。");
  const row = await env.DB.prepare(`SELECT r.id, r.kind, r.mime_type, r.created_at, r.object_key FROM relationship_album r
    ${PUBLIC_ALBUM_JOIN} WHERE r.id=?`).bind(id).first<AlbumRow>();
  if (!row) throw new ApiError(404, "画面不存在。");
  const object = await env.MEDIA.get(row.object_key);
  if (!object || !("body" in object)) throw new ApiError(404, "画面不存在。");
  const headers = new Headers({ "Content-Type": row.mime_type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Length": String(object.size) });
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers });
}

export async function handlePublicRelationshipAlbum(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const asset = /^\/v1\/relationship-album\/assets\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (asset) return readPublicAlbumAsset(env, asset[1]);
  if (url.pathname !== "/v1/relationship-album" || url.searchParams.getAll("characterId").length !== 1) return null;
  const characterId = url.searchParams.get("characterId")?.trim() ?? "";
  if (!characterId || characterId.length > 120 || /[\u0000-\u001f\u007f]/u.test(characterId)) throw new ApiError(400, "角色编号不正确。");
  const rows = await env.DB.prepare(`SELECT r.id, r.kind, r.mime_type, r.created_at FROM relationship_album r
    ${PUBLIC_ALBUM_JOIN} WHERE p.id=? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).bind(characterId, ALBUM_LIMIT).all<AlbumRow>();
  return json({ items: (rows.results ?? []).map(row => ({ id: row.id, kind: row.kind, mimeType: row.mime_type, createdAt: row.created_at })) });
}

async function rememberOwnedImage(request: Request, env: Env, user: UserRecord): Promise<Response> {
  if (!env.MEDIA) throw new ApiError(503, "相册暂时无法保存。");
  const body = await readJson(request);
  const roleId = characterId(typeof body.characterId === "string" ? body.characterId : "");
  const objectKey = typeof body.objectKey === "string" ? body.objectKey : "";
  const mimeType = extensionMime(objectKey);
  if (!mimeType || !MEDIA_KEY.test(objectKey) || !objectKey.startsWith(`${user.id}/`)) throw new ApiError(400, "只能收录你自己保存的画面。");
  let object: R2ObjectBody | null;
  try { object = await env.MEDIA.get(objectKey); }
  catch { throw new ApiError(503, "相册暂时无法保存。"); }
  if (!object || object.customMetadata?.ownerId !== user.id) throw new ApiError(404, "画面不存在。");
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const saved = await env.DB.prepare(`INSERT INTO relationship_album (id, user_id, character_id, kind, object_key, mime_type, created_at)
    SELECT ?, ?, ?, 'image', ?, ?, ?
    WHERE (SELECT COUNT(*) FROM relationship_album WHERE user_id=? AND character_id=?) < ?
    ON CONFLICT(user_id, object_key) DO NOTHING`).bind(id, user.id, roleId, objectKey, mimeType, createdAt, user.id, roleId, ALBUM_LIMIT).run();
  if (saved.meta.changes !== 1) {
    const existing = await env.DB.prepare("SELECT id, kind, mime_type, created_at FROM relationship_album WHERE user_id=? AND object_key=?")
      .bind(user.id, objectKey).first<AlbumRow>();
    if (!existing) throw new ApiError(409, "这段关系的相册已经满了。");
    return json({ item: { id: existing.id, kind: existing.kind, mimeType: existing.mime_type, createdAt: existing.created_at } });
  }
  return json({ item: { id, kind: "image", mimeType, createdAt } }, 201);
}

export async function handleRelationshipAlbum(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  const asset = /^\/v1\/relationship-album\/assets\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (asset) {
    if (!ALBUM_ID.test(asset[1])) throw new ApiError(404, "画面不存在。");
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    return readAlbumAsset(env, user, asset[1]);
  }
  if (url.pathname !== "/v1/relationship-album") return null;
  if (request.method === "POST") return rememberOwnedImage(request, env, user);
  if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
  if (url.searchParams.getAll("characterId").length !== 1) throw new ApiError(400, "角色编号不正确。");
  const roleId = characterId(url.searchParams.get("characterId") ?? "");
  const rows = await env.DB.prepare(`SELECT id, kind, mime_type, created_at FROM relationship_album
    WHERE user_id=? AND character_id=? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(user.id, roleId, ALBUM_LIMIT).all<AlbumRow>();
  // No personal images for this character: let the public album fallback run.
  if (!rows.results?.length) return null;
  return json({
    items: (rows.results ?? []).map(row => ({ id: row.id, kind: row.kind, mimeType: row.mime_type, createdAt: row.created_at })),
  });
}
