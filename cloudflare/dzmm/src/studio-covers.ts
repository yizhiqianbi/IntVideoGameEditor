import { sniffStoredImage } from "./cover-mirror";
import { ApiError, json } from "./http";
import type { Env, UserRecord } from "./types";
import { isStudioCoverSlot, type StudioCoverSlot } from "../../../src/lib/xumeng-studio-covers";

const MAX_BYTES = 5_000_000;

type CoverRow = { slot: StudioCoverSlot; image_key: string; content_type: string; updated_at: number };

function coverUrl(slot: string, updatedAt: number) {
  return `/api/backend/v1/studio/covers/${slot}?v=${updatedAt}`;
}

async function rows(env: Env): Promise<CoverRow[]> {
  const listed = await env.DB.prepare("SELECT slot, image_key, content_type, updated_at FROM studio_covers").all<CoverRow>();
  return listed.results.filter((row) => isStudioCoverSlot(row.slot));
}

export async function listPublicStudioCovers(env: Env): Promise<Response> {
  try {
    const covers: Record<string, string> = {};
    for (const row of await rows(env)) covers[row.slot] = coverUrl(row.slot, row.updated_at);
    return json({ covers });
  } catch {
    return json({ covers: {} });
  }
}

export async function publicStudioCover(env: Env, slot: string): Promise<Response | null> {
  if (!isStudioCoverSlot(slot) || !env.MEDIA) return null;
  let row: CoverRow | null = null;
  try {
    row = await env.DB.prepare("SELECT slot, image_key, content_type, updated_at FROM studio_covers WHERE slot=?").bind(slot).first<CoverRow>();
  } catch {
    return null;
  }
  if (!row) return null;
  const object = await env.MEDIA.get(row.image_key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readImage(request: Request): Promise<{ bytes: Uint8Array; type: "image/jpeg" | "image/png" | "image/webp"; extension: ".jpg" | ".png" | ".webp" }> {
  if (!request.body) throw new ApiError(400, "请选择封面图片。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "封面图片不能超过 5 MB。");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new ApiError(400, "封面图片不能为空。");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const sniffed = sniffStoredImage(bytes);
  if (!sniffed || (sniffed.type !== "image/jpeg" && sniffed.type !== "image/png" && sniffed.type !== "image/webp")) {
    throw new ApiError(400, "封面只接受 JPG、PNG 或 WebP。");
  }
  return { bytes, type: sniffed.type, extension: sniffed.extension };
}

export async function handleAdminStudioCovers(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/admin/studio-covers" && request.method === "GET") {
    let listed: CoverRow[] = [];
    try { listed = await rows(env); } catch { throw new ApiError(503, "创作封面还没建表。"); }
    return json({
      accountId: user.id,
      covers: listed.map((row) => ({ slot: row.slot, url: coverUrl(row.slot, row.updated_at), updatedAt: row.updated_at })),
    });
  }
  const upload = /^\/v1\/admin\/studio-covers\/([a-z]+)$/.exec(path);
  if (upload && request.method === "POST") {
    const slot = upload[1];
    if (!isStudioCoverSlot(slot)) throw new ApiError(404, "这个封面位置不存在。");
    if (!env.MEDIA) throw new ApiError(503, "封面存储还没接上。");
    const image = await readImage(request);
    const key = `studio-covers/${slot}${image.extension}`;
    const now = Date.now();
    await env.MEDIA.put(key, image.bytes, { httpMetadata: { contentType: image.type }, customMetadata: { slot, ownerId: user.id } });
    try {
      await env.DB.prepare(`INSERT INTO studio_covers(slot, image_key, content_type, updated_at, updated_by) VALUES(?,?,?,?,?)
        ON CONFLICT(slot) DO UPDATE SET image_key=excluded.image_key, content_type=excluded.content_type, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
        .bind(slot, key, image.type, now, user.id).run();
    } catch {
      throw new ApiError(503, "创作封面还没建表。");
    }
    return json({ accountId: user.id, slot, url: coverUrl(slot, now), updatedAt: now });
  }
  const removal = /^\/v1\/admin\/studio-covers\/([a-z]+)\/delete$/.exec(path);
  if (removal && request.method === "POST") {
    const slot = removal[1];
    if (!isStudioCoverSlot(slot)) throw new ApiError(404, "这个封面位置不存在。");
    let row: CoverRow | null = null;
    try {
      row = await env.DB.prepare("SELECT slot, image_key, content_type, updated_at FROM studio_covers WHERE slot=?").bind(slot).first<CoverRow>();
      await env.DB.prepare("DELETE FROM studio_covers WHERE slot=?").bind(slot).run();
    } catch {
      throw new ApiError(503, "创作封面还没建表。");
    }
    if (row && env.MEDIA) await env.MEDIA.delete(row.image_key);
    return json({ accountId: user.id, slot, removed: Boolean(row) });
  }
  if (path === "/v1/admin/studio-covers" || path.startsWith("/v1/admin/studio-covers/")) throw new ApiError(405, "创作封面不支持这个操作。");
  return null;
}
