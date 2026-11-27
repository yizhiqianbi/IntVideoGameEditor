import type { DzmmBillingRpcBinding } from "../../../../src/lib/dzmm-generation-billing";
import type { CompanionGatewayEnvironment } from "../companion-gateway";
import type { IndexNowEnv } from "../indexnow";
import type { LiveGatewayEnvironment } from "../live-gateway";
import type { MiniCpmPhoneEnvironment } from "../minicpm-phone-gateway";

export type ServiceFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

export interface Env extends LiveGatewayEnvironment, MiniCpmPhoneEnvironment, CompanionGatewayEnvironment, IndexNowEnv {
  ASSETS: ServiceFetcher;
  BACKEND: ServiceFetcher;
  BILLING?: DzmmBillingRpcBinding;
  CHAT_RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
  MEMORY_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  DZMM_API_KEY?: string;
  SEALION_API_KEY?: string;
  SEALION_BASE_URL?: string;
  DZMM_BASE_URL?: string;
  DZMM_MODEL?: string;
  DZMM_FAST_MODEL?: string;
  DZMM_BALANCED_MODEL?: string;
  DZMM_STORY_MODEL?: string;
  DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION?: string;
  DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION?: string;
  TAVERN_ENGINE?: string;
  TAVERN_GROUP?: string;
  TAVERN_SAMPLER?: string;
  TAVERN_IMAGE_PRESETS?: string;
  TAVERN_MEMORY?: string;
  KREA2_ACTIONS_URL?: string;
  WHATSTOKEN_API_KEY?: string;
  WHATSTOKEN_BASE_URL?: string;
  DZMM_WHATSTOKEN_CHAT_ENABLED?: string;
  H3_COMFY_URL?: string;
  H3_COMFY_TOKEN?: string;
  MEDIA?: R2Bucket;
  AIAPI_BASE_URL?: string;
  AIAPI_APIKEY?: string;
  AIAPI_SECRETKEY?: string;
}

export const BACKEND_ORIGIN = "https://dzmm-backend.850587960.workers.dev";
export const CREATE_MEDIA_ORIGIN = "https://create.xumengchat.top";
export const CANONICAL_ORIGIN = "https://xumengchat.top";
export const PROXY_PREFIXES = ["/api/backend/", "/api/dzmm/backend/"];
export const PUBLIC_ASSET_PREFIX = "/assets/xumeng/";
export const LEGACY_ASSET_PREFIX = "/dzmm/";
export const MAX_PROXY_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
export const TELEGRAM_FEEDBACK_WEBHOOK = "/api/backend/v1/telegram/feedback/webhook";
export const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const PROXY_METHODS = new Set(["GET", "HEAD", ...MUTATIONS]);

export class GatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers });
}

export function normalizedPagePath(path: string): string {
  try { path = decodeURIComponent(path); } catch { /* An invalid encoding is not an alias. */ }
  return path.replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function checkMutationOrigin(request: Request): void {
  if (!MUTATIONS.has(request.method)) return;
  if (request.headers.get("Origin") !== new URL(request.url).origin
    || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new GatewayError(403, "当前来源不允许修改账户数据。");
  }
}

export function sessionCookie(request: Request): string | undefined {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map(part => part.trim())
    .find(part => /^dzmm_session=[^;\s]+$/.test(part));
}

export function backendHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of ["Content-Type", "Accept", "If-Match", "If-None-Match", "CF-Connecting-IP", "User-Agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const parts = (request.headers.get("Cookie") || "").split(";").map(part => part.trim());
  const session = sessionCookie(request);
  const known = parts.find(part => part === "xumeng_known=1");
  const oauth = parts.find(part => /^xumeng_oauth=[A-Za-z0-9_-]{43,128}$/.test(part));
  const cookie = [session, known, oauth].filter(Boolean).join("; ");
  if (cookie) headers.set("Cookie", cookie);
  // The browser origin was checked at this gateway. Backend mutation checks
  // accept their own request origin, so existing backend deployment is reused.
  headers.set("Origin", BACKEND_ORIGIN);
  return headers;
}

export async function proxyBody(request: Request, limit = MAX_PROXY_BODY_BYTES, oversizedMessage?: string): Promise<ArrayBuffer | undefined> {
  if (!MUTATIONS.has(request.method)) return undefined;
  if (Number(request.headers.get("Content-Length")) > limit) {
    throw new GatewayError(413, oversizedMessage ?? (limit === MAX_PROXY_BODY_BYTES ? "请求过大。" : "支付回调请求过大。"));
  }
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new GatewayError(413, oversizedMessage ?? (limit === MAX_PROXY_BODY_BYTES ? "请求过大。" : "支付回调请求过大。"));
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function authenticatedUser(request: Request, env: Env): Promise<string> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request),
    signal: request.signal,
    redirect: "manual",
  }));
  if (upstream.status === 401) {
    await upstream.body?.cancel();
    throw new GatewayError(401, "会话已失效，请刷新页面后重试。");
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new GatewayError(503, "账户服务暂时不可用，请稍后重试。");
  }
  const value: unknown = await upstream.json();
  const user = value && typeof value === "object" && "user" in value ? value.user : undefined;
  if (!user || typeof user !== "object" || !("id" in user)
    || typeof user.id !== "string" || !user.id) {
    throw new GatewayError(401, "请先建立会话，再开始对话。");
  }
  return user.id;
}
