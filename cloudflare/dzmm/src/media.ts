import { ApiError, json } from "./http";
import { rateLimit } from "./auth";
import type { Env, UserRecord } from "./types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

async function imageBytes(request: Request): Promise<Uint8Array> {
  const album = request.headers.get("x-xumeng-media-purpose") === "album";
  if (!request.body) throw new ApiError(400, album ? "相册图片不能为空。" : "请选择封面图片。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ApiError(413, album ? "相册图片不能超过 5 MB，这次没有扣 Credit。" : "图片不能超过 5 MB。");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new ApiError(400, "图片文件不能为空。");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function matchesType(bytes: Uint8Array, type: string) {
  if (type === "image/png")
    return (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
    );
  if (type === "image/jpeg")
    return (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (type === "image/webp") {
    return (
      bytes.length >= 20 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (type === "image/gif") {
    const header = bytes.length >= 6 ? new TextDecoder().decode(bytes.slice(0, 6)) : "";
    return header === "GIF87a" || header === "GIF89a";
  }
  return false;
}

export async function handleMedia(
  request: Request,
  env: Env,
  user: UserRecord,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/v1/media")) return null;
  if (!env.MEDIA)
    throw new ApiError(503, request.headers.get("x-xumeng-media-purpose") === "album" ? "相册存储尚未启用，这次没有扣 Credit。" : "封面存储尚未启用，请先配置 Cloudflare R2。");
  if (path === "/v1/media" && request.method === "POST") {
    const contentType =
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ||
      "";
    const extension = TYPES.get(contentType);
    const album = request.headers.get("x-xumeng-media-purpose") === "album";
    if (!extension)
      throw new ApiError(400, album ? "相册只接受 PNG、JPEG、WebP 或 GIF 图片。" : "封面仅支持 PNG、JPEG、WebP 或 GIF 图片。");
    try {
      await rateLimit(
        request,
        env,
        album ? "album-upload" : "media-upload",
        user.isGuest ? 3 : 20,
        user.id,
      );
    } catch (error) {
      if (album && error instanceof ApiError && error.status === 429) throw new ApiError(429, "相册保存过于频繁，请稍后再试。这次没有扣 Credit。");
      throw error;
    }
    const bytes = await imageBytes(request);
    if (!matchesType(bytes, contentType))
      throw new ApiError(400, album ? "相册图片内容与文件类型不匹配。" : "图片内容与文件类型不匹配。");
    const key = `${user.id}/${crypto.randomUUID()}.${extension}`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { ownerId: user.id },
    });
    return json({ key, url: `/api/dzmm/backend/v1/media/${key}` }, 201);
  }
  const match =
    /^\/v1\/media\/([A-Za-z0-9-]+)\/([a-f0-9-]+\.(?:png|jpg|webp|gif))$/.exec(path);
  if (!match) throw new ApiError(404, "封面不存在。");
  if (match[1] !== user.id) throw new ApiError(404, "封面不存在。");
  const key = `${match[1]}/${match[2]}`;
  if (request.method === "DELETE") {
    await env.MEDIA.delete(key);
    return json({ deleted: true });
  }
  if (request.method !== "GET")
    throw new ApiError(405, "此接口仅支持 GET 或 DELETE。");
  const object = await env.MEDIA.get(key);
  if (!object || object.customMetadata?.ownerId !== user.id)
    throw new ApiError(404, "封面不存在。");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, {
    headers,
  });
}
