import { ApiError, json } from "./http";
import { rateLimit } from "./auth";
import type { Env, UserRecord } from "./types";
import {
  DZMM_COVER_IMAGE_MAX_BYTES,
  DZMM_COVER_VIDEO_MAX_BYTES,
  checkDzmmCoverHeader,
  dzmmCoverExtension,
  dzmmCoverVideoExtension,
  normalizeDzmmCoverType,
  sniffDzmmCoverMedia,
} from "../../../src/lib/dzmm-cover-media";

async function readBounded(request: Request, maximum: number, tooLarge: string, missing: string, empty: string): Promise<Uint8Array> {
  if (!request.body) throw new ApiError(400, missing);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > maximum) {
        await reader.cancel();
        throw new ApiError(413, tooLarge);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new ApiError(400, empty);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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
    const contentType = normalizeDzmmCoverType(request.headers.get("content-type"));
    const extension = dzmmCoverExtension(contentType);
    const album = request.headers.get("x-xumeng-media-purpose") === "album";
    const video = contentType === "video/mp4" || contentType === "video/webm";
    if (!extension || (album && video))
      throw new ApiError(400, album ? "相册只接受 PNG、JPEG、WebP 或 GIF 图片。" : "封面仅支持 PNG、JPEG、WebP、GIF 图片，或 MP4、WebM 视频。");
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
    const bytes = await readBounded(
      request,
      video ? DZMM_COVER_VIDEO_MAX_BYTES : DZMM_COVER_IMAGE_MAX_BYTES,
      album ? "相册图片不能超过 5 MB，这次没有扣 Credit。" : video ? "封面视频不能超过 16 MB。" : "图片不能超过 5 MB。",
      album ? "相册图片不能为空。" : video ? "请选择封面视频。" : "请选择封面图片。",
      album || !video ? "图片文件不能为空。" : "封面视频不能为空。",
    );
    if (album) {
      if (sniffDzmmCoverMedia(bytes) !== contentType) throw new ApiError(400, "相册图片内容与文件类型不匹配。");
    } else {
      const checked = checkDzmmCoverHeader({ bytes, byteLength: bytes.byteLength, declaredType: contentType });
      if (!checked.ok) throw new ApiError(checked.status, checked.message);
    }
    const key = `${user.id}/${crypto.randomUUID()}.${extension}`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { ownerId: user.id },
    });
    return json({ key, url: `/api/dzmm/backend/v1/media/${key}` }, 201);
  }
  const match =
    /^\/v1\/media\/([A-Za-z0-9-]+)\/([a-f0-9-]+\.(?:png|jpg|webp|gif|mp4|webm))$/.exec(path);
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
  if (dzmmCoverVideoExtension(key)) headers.set("Content-Length", String(object.size));
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, {
    headers,
  });
}
