import { NextRequest } from "next/server";
import { createDzmmLocalSuperBootstrap, dzmmLocalSuperLogoutCookie } from "@/lib/dzmm-local-super.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const localSuperBootstrap = createDzmmLocalSuperBootstrap();

function error(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function backendOrigin() {
  const configured = process.env.DZMM_BACKEND_URL?.trim();
  if (!configured && process.env.NODE_ENV === "production") return null;
  const url = new URL(configured || "http://127.0.0.1:8787");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid backend origin");
  }
  return url;
}

async function bodyBytes(request: Request) {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Request too large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
) {
  if (MUTATING.has(request.method)) {
    const origin = request.headers.get("origin");
    // Next's development server may normalize the internal URL to localhost
    // even when the browser opened 127.0.0.1. Compare with the HTTP authority
    // presented by the browser so the same-origin check follows the actual URL.
    const host = request.headers.get("host") ?? request.nextUrl.host;
    const expectedOrigin = `${request.nextUrl.protocol}//${host}`;
    if (
      (origin && origin !== expectedOrigin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return error("此请求来源不被允许。", 403);
    }
  }
  let origin: URL | null;
  try {
    origin = backendOrigin();
  } catch {
    return error("后端地址配置无效。", 503);
  }
  if (!origin) return error("尚未配置 Cloudflare 后端地址。", 503);
  const { path = [] } = await context.params;
  if (
    path.some(
      (segment) =>
        !/^[A-Za-z0-9_.-]+$/.test(segment) ||
        segment === "." ||
        segment === "..",
    )
  ) {
    return error("接口路径无效。", 400);
  }
  const target = new URL(`/${path.map(encodeURIComponent).join("/")}`, origin);
  target.search = request.nextUrl.search;
  const characterVoiceAsset = request.method === "GET" && /^\/v1\/character-voice\/assets\/[A-Za-z0-9_-]{1,128}$/.test(target.pathname);
  const headers = new Headers();
  for (const name of [
    "content-type",
    "origin",
    "sec-fetch-site",
    "if-match",
    "if-none-match",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const session = request.cookies.get("qingyu_session");
  if (session && /^[a-f0-9]{64}$/.test(session.value))
    headers.set("cookie", `qingyu_session=${session.value}`);
  if (characterVoiceAsset && request.headers.has("range")) headers.set("range", request.headers.get("range")!);
  try {
    const body = MUTATING.has(request.method)
      ? await bodyBytes(request)
      : undefined;
    let upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(request.method === "POST" && target.pathname === "/v1/character-voice/generate" ? 120_000 : 30_000)]),
    });
    if (request.method === "GET" && path.join("/") === "v1/session") {
      upstream = await localSuperBootstrap(request, origin, upstream) ?? upstream;
    }
    if (
      upstream.status >= 300 &&
      upstream.status < 400 &&
      upstream.status !== 304
    ) {
      await upstream.body?.cancel();
      return error("后端返回了意外跳转。", 502);
    }
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["content-type", "content-security-policy", "etag", "retry-after", "x-qingyu-local-auth"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (characterVoiceAsset) for (const name of ["content-range", "accept-ranges", "content-length", "content-disposition"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (let cookie of upstream.headers.getSetCookie()) {
      if (!cookie.startsWith("qingyu_session=")) continue;
      // A locally running Next preview receives a production HTTPS Worker cookie.
      // Only this development case relaxes Secure; deployed HTTPS preserves it.
      if (
        process.env.NODE_ENV !== "production" &&
        request.nextUrl.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(request.nextUrl.hostname)
      ) {
        cookie = cookie.replace(/;\s*Secure\b/gi, "");
      }
      responseHeaders.append("Set-Cookie", cookie);
    }
    if (upstream.ok && request.method === "POST" && path.join("/") === "v1/auth/logout") {
      const optOut = dzmmLocalSuperLogoutCookie(request);
      if (optOut) responseHeaders.append("Set-Cookie", optOut);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (cause) {
    if (cause instanceof RangeError) return error("请求不能超过 5 MB。", 413);
    return error("Cloudflare 后端暂时无法连接，数据仍保留在本地。", 503);
  }
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
};
