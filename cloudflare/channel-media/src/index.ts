import { sniffAiapiBytes } from "../../../src/lib/aiapi-channel";

const MEDIA = /^\/api\/studio\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// 浏览器直传的视频上限。Vercel 请求体只有 4.5MB，大视频走这里。
const DIRECT_MAX = 64 * 1024 * 1024;
const DIRECT_TTL = 600;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v"]);

// Workers 运行时自带；R2 put 需要长度已知的流。
declare const FixedLengthStream: new (expectedLength: number) => { readable: ReadableStream; writable: WritableStream };

interface Env {
  MEDIA: R2Bucket;
  AIAPI_SECRETKEY?: string;
  // 本地 wrangler dev 会带自定义域名，用这个把返回的地址改成本地 worker。
  PUBLIC_ORIGIN?: string;
}

function mediaUrl(request: Request, env: Env, id: string): string {
  const origin = (env.PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "") || new URL(request.url).origin;
  return `${origin}/api/studio/media/${id}`;
}

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers });
}

function cors(body: unknown, status = 200): Response {
  return json(body, status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });
}

function relayMatches(request: Request, env: Env): boolean {
  const secret = env.AIAPI_SECRETKEY ?? "";
  const given = request.headers.get("x-aiapi-relay") ?? "";
  if (secret.length < 16 || given.length !== secret.length) return false;
  let difference = 0;
  for (let index = 0; index < secret.length; index += 1) {
    difference |= secret.charCodeAt(index) ^ given.charCodeAt(index);
  }
  return difference === 0;
}

export function classifyUpload(contentType: string, bytes: Uint8Array): { ok: true; type: string } | { ok: false; error: string; status: number } {
  const declared = contentType.split(";")[0].trim().toLowerCase();
  if (declared === "text/plain") {
    if (bytes.byteLength > 1_000_000) return { ok: false, error: "正文太长。", status: 413 };
    if (bytes.byteLength < 1 || bytes.includes(0)) return { ok: false, error: "文本文件需要是 UTF-8。", status: 400 };
    return { ok: true, type: "text/plain; charset=utf-8" };
  }
  if (bytes.byteLength < 32 || bytes.byteLength > 4_500_000) return { ok: false, error: "参考图太大。", status: 413 };
  const type = sniffAiapiBytes(bytes, "image");
  if (!type) return { ok: false, error: "参考图需要是 PNG、JPG 或 WebP。", status: 400 };
  return { ok: true, type };
}

async function channelReference(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405);
  if (!env.AIAPI_SECRETKEY) return json({ error: "渠道密钥还没配上。" }, 503);
  if (!relayMatches(request, env)) return json({ error: "渠道中转没有通过。" }, 403);
  const headerType = request.headers.get("Content-Type") || "";
  const text = headerType.split(";")[0].trim().toLowerCase() === "text/plain";
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared > (text ? 1_000_000 : 4_500_000)) return json({ error: text ? "正文太长。" : "参考图太大。" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const classified = classifyUpload(headerType, bytes);
  if (!classified.ok) return json({ error: classified.error }, classified.status);
  const id = crypto.randomUUID();
  await env.MEDIA.put(id, bytes, { httpMetadata: { contentType: classified.type } });
  return json({ url: mediaUrl(request, env, id) });
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameHex(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function ticketSignature(secret: string, expires: number, bytes: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = new TextEncoder().encode(`studio-upload:${expires}:${bytes}`);
  return hex(await crypto.subtle.sign("HMAC", key, message));
}

// 浏览器拿到 Next 接口签发的票据后直接 PUT 视频到这里，避免 Vercel 的 4.5MB 请求体上限。
async function directUpload(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    },
  });
  if (request.method !== "PUT") return cors({ error: "请求方法不支持。" }, 405);
  if (!env.AIAPI_SECRETKEY) return cors({ error: "渠道密钥还没配上。" }, 503);
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("exp") || "");
  const bytes = Number(url.searchParams.get("bytes") || "");
  const signature = (url.searchParams.get("sig") || "").toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + DIRECT_TTL + 60) return cors({ error: "上传凭证已过期。" }, 403);
  if (!Number.isInteger(bytes) || bytes < 1024 || bytes > DIRECT_MAX) return cors({ error: "视频太大。" }, 413);
  if (!sameHex(await ticketSignature(env.AIAPI_SECRETKEY, expires, bytes), signature)) return cors({ error: "上传凭证无效。" }, 403);
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared && declared !== bytes) return cors({ error: "视频大小对不上。" }, 400);
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!VIDEO_TYPES.has(type)) return cors({ error: "视频需要是 MP4 或 MOV。" }, 415);
  if (!request.body) return cors({ error: "没有收到视频。" }, 400);

  let total = 0;
  let head = new Uint8Array(0);
  let problem = "";
  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (problem) return;
      total += chunk.byteLength;
      if (total > bytes) {
        problem = "视频大小对不上。";
        controller.error(new Error(problem));
        return;
      }
      if (head.byteLength < 12) {
        const need = Math.min(12 - head.byteLength, chunk.byteLength);
        const merged = new Uint8Array(head.byteLength + need);
        merged.set(head);
        merged.set(chunk.subarray(0, need), head.byteLength);
        head = merged;
      }
      if (head.byteLength >= 8 && !(head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70)) {
        problem = "这个文件不是视频。";
        controller.error(new Error(problem));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const id = crypto.randomUUID();
  // R2 只收长度已知的流：用已经校验过的字节数开一个 FixedLengthStream，边收边写，不把整段视频读进内存。
  const fixed = new FixedLengthStream(bytes);
  const pump = request.body.pipeThrough(guard).pipeTo(fixed.writable).catch(() => undefined);
  try {
    await env.MEDIA.put(id, fixed.readable, { httpMetadata: { contentType: "video/mp4" } });
  } catch (error) {
    console.error("[studio-upload]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    await env.MEDIA.delete(id).catch(() => undefined);
    return cors({ error: problem || "视频没有传完。" }, problem ? 400 : 502);
  }
  await pump;
  if (problem || total !== bytes) {
    await env.MEDIA.delete(id).catch(() => undefined);
    return cors({ error: problem || "视频没有传完。" }, 400);
  }
  return cors({ url: mediaUrl(request, env, id) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api/studio/upload") return directUpload(request, env);
    if (path === "/api/studio/channel-reference") return channelReference(request, env);
    const media = MEDIA.exec(path);
    if (media) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405);
      const object = await env.MEDIA.get(media[1]);
      if (!object) return json({ error: "结果不存在。" }, 404);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=86400");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Accept-Ranges", "bytes");
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }
    return json({ error: "接口不存在。" }, 404);
  },
};
