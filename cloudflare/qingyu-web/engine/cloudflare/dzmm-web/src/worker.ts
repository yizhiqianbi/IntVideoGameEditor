import {
  handleDzmmChatGet,
  readDzmmJsonBody,
  handleDzmmChatPost,
  type DzmmChatEnvironment,
  type DzmmChatHandlerOptions,
} from "../../../src/lib/dzmm-chat-handler";
import { handleDzmmMemoryPost } from "../../../src/lib/dzmm-memory-handler";
import { parseScenarioGenerationRequest, scenarioGenerationPreparation } from "../../../src/lib/xumeng-scenario-handler";
import type { XumengScenarioRoom } from "../../../src/lib/xumeng-scenarios";
import { DzmmValidationError } from "../../../src/lib/dzmm-chat";
import { handleDzmmNovelPost } from "../../../src/lib/dzmm-novel-handler";
import { handleDzmmReplySuggestionsPost } from "../../../src/lib/dzmm-reply-suggestions-handler";
import { dzmmModelCostPolicy, findDzmmProviderModel } from "../../../src/lib/dzmm-models";
import { DzmmBillingError, readDzmmProviderMaxPrice, type DzmmBillingLifecycle, type DzmmBillingRpcBinding } from "../../../src/lib/dzmm-generation-billing";
import { readDzmmProviderConfig } from "../../../src/lib/dzmm-chat";
import { recoverBillingGenerationSoon, runBillingMaintenance } from "./billing-maintenance";
import { parseDzmmCreditCostPolicy } from "../../../src/lib/dzmm-credit-pricing";
import { handleLiveGateway, type LiveGatewayEnvironment } from "./live-gateway";
import { handleMiniCpmPhone, type MiniCpmPhoneEnvironment } from "./minicpm-phone-gateway";
import { handleCompanionGateway, type CompanionGatewayEnvironment } from "./companion-gateway";
import { renderXumengCommunityGuidelines, XUMENG_COMMUNITY_GUIDELINES_PATH, XUMENG_COMMUNITY_GUIDELINES_TITLE, XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION } from "../../../src/lib/xumeng-community-guidelines";
import { getXumengPaymentInfoPage, renderXumengPaymentInfoPage, XUMENG_PAYMENT_INFO_DRAFT } from "../../../src/lib/xumeng-payment-info";
import { renderKrea2Still } from "../../../src/lib/xumeng-krea2-bridge";
import { STUDIO_STILL_CREDITS } from "../../../src/lib/xumeng-studio-still-billing";
import { characterShareLocations, characterShareResponse } from "./character-share";
import { h3Query, h3Upstream } from "./h3-channel";
import { runH3ReferenceVideo } from "./h3-r2v";
export { ViduLiveStudio } from "./vidu-live-studio";

type ServiceFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

export interface Env extends LiveGatewayEnvironment, MiniCpmPhoneEnvironment, CompanionGatewayEnvironment {
  ASSETS: ServiceFetcher;
  BACKEND: ServiceFetcher;
  BILLING?: DzmmBillingRpcBinding;
  CHAT_RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
  MEMORY_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  DZMM_API_KEY?: string;
  DZMM_BASE_URL?: string;
  DZMM_MODEL?: string;
  DZMM_FAST_MODEL?: string;
  DZMM_BALANCED_MODEL?: string;
  DZMM_STORY_MODEL?: string;
  DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION?: string;
  DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION?: string;
  KREA2_ACTIONS_URL?: string;
  H3_COMFY_URL?: string;
  H3_COMFY_TOKEN?: string;
}

const BACKEND_ORIGIN = "https://qingyu-backend.internal";
const CANONICAL_ORIGIN = "https://qingyu.invalid";
const PROXY_PREFIXES = ["/api/backend/", "/api/dzmm/backend/"];
const PUBLIC_ASSET_PREFIX = "/assets/qingyu/";
const LEGACY_ASSET_PREFIX = "/dzmm/";
const ROOT_BRAND_FILES: Record<string, string> = {
  "/favicon.ico": "brand/qingyu-favicon.ico",
  "/icon.svg": "brand/qingyu-mark.svg",
  "/apple-touch-icon.png": "brand/qingyu-icon-192.png",
  "/apple-touch-icon-precomposed.png": "brand/qingyu-icon-192.png",
  "/manifest.webmanifest": "manifest.webmanifest",
  "/site.webmanifest": "manifest.webmanifest",
};
const LEGACY_BRAND_FILES: Record<string, string> = {
  "brand/icon.svg": "brand/qingyu-mark.svg",
  "brand/icon-192.png": "brand/qingyu-icon-192.png",
  "brand/icon-512.png": "brand/qingyu-icon-512.png",
  "brand/favicon.ico": "brand/qingyu-favicon.ico",
};
const PUBLIC_ASSET_FILES = new Set([
  "exported-cards/manifest.json", "exported-cards/LICENSE-CONTENT.txt",
  ...["peiyu", "tangtuantuan", "wangushi", "shenyan", "huoyushen", "jiwenqing", "naifuer", "songzhixia", "jiangchiye", "sunianzhi", "xuanjing", "nie-xiaoqian", "caleb", "edmund-harrower", "frankie-doyle", "redline-salvage", "rosalind", "the-lighthouse"].flatMap(slug => [
    `exported-cards/foreverse-${slug}.v2.json`, `exported-cards/foreverse-${slug}-cover.png`,
  ]),
  "live/rtc.js", "live/minicpm-capture.js",
  "brand/qingyu-mark.svg", "brand/qingyu-icon-192.png", "brand/qingyu-icon-512.png",
  "brand/qingyu-character-placeholder.svg",
  "brand/qingyu-favicon.ico", "brand/sources.json", "manifest.webmanifest",
  "content-covers/yume.jpg", "content-covers/wanning.jpg", "content-covers/sumai.jpg",
  "content-covers/game-2048.jpg", "content-covers/game-shadow.jpg", "content-covers/game-stars.jpg", "content-covers/game-cat.jpg",
  "public-character-samples.json", "public-character-introductions.json",
  "public-character-media.json", "public-category-covers.json",
  "generation-templates/manifest.json", "generation-templates/character.svg",
  "generation-templates/scene.svg", "generation-templates/cover.svg",
  "generation-templates/product.svg", "generation-templates/short-film.svg",
  "action-templates/manifest.json",
  "action-templates/action-high-five.mp4", "action-templates/action-high-five.png",
  "action-templates/action-handshake.mp4", "action-templates/action-handshake.png",
  "action-templates/action-hug.mp4", "action-templates/action-hug.png",
  "action-templates/action-object-exchange.mp4", "action-templates/action-object-exchange.png",
  "action-templates/action-side-by-side-walk.mp4", "action-templates/action-side-by-side-walk.png",
  "action-templates/action-paired-dance.mp4", "action-templates/action-paired-dance.png",
]);
const MAX_PROXY_BODY_BYTES = 16 * 1024 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const TELEGRAM_FEEDBACK_WEBHOOK = "/api/backend/v1/telegram/feedback/webhook";
const MAX_ZPAY_QUERY_BYTES = 8192;
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PROXY_METHODS = new Set(["GET", "HEAD", ...MUTATIONS]);

class GatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers });
}

function isPublicAsset(relativePath: string, env: Env): boolean {
  if (env.GENERATION_ENABLED === "false" && /^(?:generation-templates|action-templates|h3-actions|krea2-actions)\//.test(relativePath)) return false;
  return PUBLIC_ASSET_FILES.has(relativePath)
    || /^covers\/\d{1,120}\.(?:webp|png)$/.test(relativePath)
    || /^gallery\/\d{1,120}-[1-9]\d*\.webp$/.test(relativePath)
    || /^categories\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(relativePath)
    || relativePath === "h3-actions/manifest.json"
    || /^h3-actions\/h3(?:-[a-z0-9]+)+\.(?:mp4|webp)$/.test(relativePath)
    || relativePath === "krea2-actions/manifest.json"
    || /^krea2-actions\/krea2(?:-[a-z0-9]+)+\.webp$/.test(relativePath)
    || /^share\/[a-z0-9][a-z0-9-]{0,119}\.jpg$/.test(relativePath);
}

function normalizedPagePath(path: string): string {
  try { path = decodeURIComponent(path); } catch { /* An invalid encoding is not an alias. */ }
  return path.replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}

function redirectPage(request: Request, pathname: string, status: 302 | 307 | 308 = 308): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  }
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Response(null, { status, headers: { Location: target.href } });
}

async function publicAsset(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  }
  const response = await env.ASSETS.fetch(request);
  // A missing image or manifest must not become the SPA's HTML fallback.
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() === "text/html") {
    await response.body?.cancel();
    return json({ error: "资源不存在。" }, 404);
  }
  return response;
}

async function loadKrea2Poster(request: Request, env: Env, templateId: string): Promise<string> {
  const assetUrl = new URL(`/assets/qingyu/krea2-actions/${templateId}.webp`, request.url);
  const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  const type = asset.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!asset.ok || type === "text/html") {
    await asset.body?.cancel();
    return "";
  }
  const bytes = new Uint8Array(await asset.arrayBuffer());
  const webp = bytes.byteLength >= 12 && bytes.byteLength <= 200_000
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!webp) return "";
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function checkMutationOrigin(request: Request): void {
  if (!MUTATIONS.has(request.method)) return;
  if (request.headers.get("Origin") !== new URL(request.url).origin
    || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new GatewayError(403, "当前来源不允许修改账户数据。");
  }
}

function sessionCookie(request: Request): string | undefined {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map(part => part.trim())
    .find(part => /^qingyu_session=[^;\s]+$/.test(part));
}

async function reserveStudioStill(request: Request, env: Env, templateId: string): Promise<{ id: string; claimToken: string } | Response> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/studio-stills`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ templateId, requestId: crypto.randomUUID() }),
    redirect: "manual",
  }));
  const payload = await upstream.json().catch(() => null) as { error?: unknown; reservationId?: unknown; claimToken?: unknown; credits?: unknown } | null;
  if (upstream.status === 401) return json({ error: "请先登录后再出图。" }, 401);
  if (upstream.status === 403) return json({ error: "请先登录正式账户后再出图。" }, 403);
  if (upstream.status === 402) return json({ error: `可用 Credit 不足，每次出图需要 ${STUDIO_STILL_CREDITS} Credit。`, code: "insufficient_credits" }, 402);
  if (upstream.status === 429) return json({ error: typeof payload?.error === "string" ? payload.error : "正在出图的任务过多，请先等待完成。" }, 429);
  if (!upstream.ok || payload?.credits !== STUDIO_STILL_CREDITS || typeof payload.reservationId !== "string" || typeof payload.claimToken !== "string") {
    return json({ error: "扣费没有完成，这次没有出图。" }, 502);
  }
  return { id: payload.reservationId, claimToken: payload.claimToken };
}

async function settleStudioStill(request: Request, env: Env, hold: { id: string; claimToken: string }, outcome: "charge" | "release"): Promise<boolean> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/studio-stills/${hold.id}/${outcome}`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ claimToken: hold.claimToken }),
    redirect: "manual",
  })).catch(() => null);
  if (!upstream?.ok) return false;
  if (outcome === "release") return true;
  const payload = await upstream.json().catch(() => null) as { status?: unknown; credits?: unknown } | null;
  return payload?.status === "charged" && payload.credits === STUDIO_STILL_CREDITS;
}

function backendHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of ["Content-Type", "Accept", "If-Match", "If-None-Match", "CF-Connecting-IP", "User-Agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const cookie = sessionCookie(request);
  if (cookie) headers.set("Cookie", cookie);
  // The browser origin was checked at this gateway. Backend mutation checks
  // accept their own request origin, so existing backend deployment is reused.
  headers.set("Origin", BACKEND_ORIGIN);
  return headers;
}

async function proxyBody(request: Request, limit = MAX_PROXY_BODY_BYTES, oversizedMessage?: string): Promise<ArrayBuffer | undefined> {
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

async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const signature = request.headers.get("Stripe-Signature");
  if (!signature || signature.length > 4096) return json({ error: "支付回调签名无效。" }, 400);
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "支付回调应为 JSON。" }, 415);
  }
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: await proxyBody(request, MAX_WEBHOOK_BODY_BYTES),
    signal: request.signal,
    redirect: "manual",
  }));
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    throw new GatewayError(502, "支付服务返回了无效响应。");
  }
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json; charset=utf-8");
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Only this exact provider callback bypasses browser-origin checks. The
// backend verifies the IPN HMAC; this gateway never holds merchant secrets.
async function nowpaymentsWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const signature = request.headers.get("X-Nowpayments-Sig");
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return json({ error: "支付回调签名无效。" }, 400);
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "支付回调应为 JSON。" }, 415);
  }
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/payments/nowpayments/ipn`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Nowpayments-Sig": signature },
    body: await proxyBody(request, MAX_WEBHOOK_BODY_BYTES), signal: request.signal, redirect: "manual",
  }));
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    throw new GatewayError(502, "支付服务返回了无效响应。");
  }
  return new Response(upstream.body, { status: upstream.status, headers: {
    "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}

// Telegram cannot supply a browser Origin or session. Only this exact public
// callback uses its independent webhook secret; account mutations stay guarded.
async function telegramFeedbackWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) return json({ error: "反馈回调认证无效。" }, 401);
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "反馈回调应为 JSON。" }, 415);
  }
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/telegram/feedback/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: await proxyBody(request, MAX_WEBHOOK_BODY_BYTES, "反馈回调请求过大。"),
    signal: request.signal, redirect: "manual",
  }));
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    throw new GatewayError(502, "反馈服务返回了无效响应。");
  }
  // Never forward session cookies or CORS data across the callback boundary.
  return new Response(upstream.body, { status: upstream.status, headers: {
    "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}

const GUAGUA_ORDER_ID = /^gg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const GUAGUA_CALLBACK_IP = "136.110.35.126";

function guaguaPayLocation(value: string | null): URL | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "alipay.dthzf001.cn" || url.port || url.username || url.password || url.hash
    || !url.pathname.startsWith("/pay/")) return null;
  return url;
}

async function guaguaPayment(request: Request, env: Env, path: string): Promise<Response> {
  const notify = path === "/api/payments/guagua/notify";
  const returning = path === "/api/payments/guagua/return";
  const checkoutId = /^\/api\/payments\/guagua\/checkout\/([^/]+)$/.exec(path)?.[1]
    ?? /^\/api\/payments\/guagua\/vip\/checkout\/([^/]+)$/.exec(path)?.[1];
  const vipReturn = /^\/api\/payments\/guagua\/vip\/return\/([^/]+)$/.exec(path)?.[1];
  if (!notify && !returning && !checkoutId && !vipReturn) return json({ error: "页面不存在。" }, 404);
  if (notify) {
    if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
    if (request.headers.get("CF-Connecting-IP") !== GUAGUA_CALLBACK_IP) return json({ error: "支付回调来源无效。" }, 403);
    if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "支付回调应为 JSON。" }, 415);
    }
    const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/payments/guagua/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": GUAGUA_CALLBACK_IP },
      body: await proxyBody(request, 8192, "支付回调请求过大。"),
      signal: request.signal,
      redirect: "manual",
    }));
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      throw new GatewayError(502, "支付服务返回了无效响应。");
    }
    return new Response(upstream.body, { status: upstream.status, headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "text/plain; charset=utf-8",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    } });
  }
  if (request.method !== "GET") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET" });
  if (checkoutId && !GUAGUA_ORDER_ID.test(checkoutId) && !/^sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(checkoutId)) return json({ error: "充值订单不存在。" }, 404);
  if (vipReturn && !/^sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(vipReturn)) return json({ error: "订阅订单不存在。" }, 404);
  const target = new URL(BACKEND_ORIGIN);
  target.pathname = path.replace(/^\/api\/payments\/guagua/, "/v1/payments/guagua");
  const upstream = await env.BACKEND.fetch(new Request(target, {
    method: "GET", headers: backendHeaders(request), signal: request.signal, redirect: "manual",
  }));
  const responseHeaders = new Headers({
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
  });
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    let destination: URL | undefined;
    try { destination = new URL(upstream.headers.get("Location") || ""); } catch { /* Invalid redirect. */ }
    const payDestination = checkoutId ? guaguaPayLocation(destination?.href ?? null) : null;
    const siteReturn = destination?.origin === CANONICAL_ORIGIN && !destination.username && !destination.password
      && destination.pathname === "/" && destination.hash === "#recharge"
      && (returning || ((vipReturn !== undefined || checkoutId !== undefined) && destination.searchParams.get("payment_order") === (vipReturn ?? checkoutId)
        && destination.searchParams.get("payment") === "success"
        && [...destination.searchParams.keys()].every(key => key === "payment_order" || key === "payment")));
    if (upstream.status === 302 && payDestination) {
      responseHeaders.set("Location", payDestination.href);
      return new Response(null, { status: 302, headers: responseHeaders });
    }
    if (upstream.status === 303 && siteReturn && destination) {
      responseHeaders.set("Location", destination.href);
      return new Response(null, { status: 303, headers: responseHeaders });
    }
    throw new GatewayError(502, "支付服务返回了无效跳转。");
  }
  responseHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain; charset=utf-8");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function zpayPayment(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET" });
  const incoming = new URL(request.url);
  const subscription = path.startsWith("/api/payments/zpay/subscription/");
  const paymentPrefix = subscription ? "/api/payments/zpay/subscription" : "/api/payments/zpay";
  const orderIdPattern = subscription
    ? /^sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
    : /^zp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const callback = path === `${paymentPrefix}/notify` || path === `${paymentPrefix}/return`;
  if (new TextEncoder().encode(incoming.search).length > MAX_ZPAY_QUERY_BYTES) {
    return json({ error: "支付参数过大。" }, 413);
  }
  // Callback requests authenticate through their provider signature. Browser
  // cookies and authorization must never become part of that trust boundary.
  const headers = callback ? new Headers({ Accept: "text/plain" }) : backendHeaders(request);
  const target = new URL(BACKEND_ORIGIN);
  target.pathname = path.replace(/^\/api\/payments\/zpay/, "/v1/payments/zpay");
  target.search = incoming.search;
  const upstream = await env.BACKEND.fetch(new Request(target, {
    method: "GET", headers, signal: request.signal, redirect: "manual",
  }));
  const responseHeaders = new Headers({
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
  });
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    let destination: URL | undefined;
    try { destination = new URL(upstream.headers.get("Location") || ""); } catch { /* Invalid redirect. */ }
    const checkoutPrefix = `${paymentPrefix}/checkout/`;
    const boundCheckoutId = path.startsWith(checkoutPrefix) ? path.slice(checkoutPrefix.length) : undefined;
    const safeRoute = path === `${paymentPrefix}/return`
      || (boundCheckoutId !== undefined && destination?.searchParams.get("payment_order") === boundCheckoutId
        && destination.searchParams.get("payment") === "success");
    const safeReturn = safeRoute && upstream.status === 303
      && destination?.origin === CANONICAL_ORIGIN && !destination.username && !destination.password
      && destination.pathname === "/" && destination.hash === "#recharge"
      && [...destination.searchParams.keys()].every(key => key === "payment_order" || key === "payment")
      && destination.searchParams.getAll("payment_order").length <= 1
      && destination.searchParams.getAll("payment").length <= 1
      && (!destination.searchParams.has("payment_order") || orderIdPattern.test(destination.searchParams.get("payment_order") || ""))
      && (!destination.searchParams.has("payment") || destination.searchParams.get("payment") === "success");
    if (!safeReturn || !destination) throw new GatewayError(502, "支付服务返回了无效跳转。");
    responseHeaders.set("Location", destination.href);
    return new Response(null, { status: 303, headers: responseHeaders });
  }
  responseHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain; charset=utf-8");
  if (!callback) {
    const csp = upstream.headers.get("Content-Security-Policy");
    if (csp) responseHeaders.set("Content-Security-Policy", csp);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function proxyBackend(request: Request, env: Env, prefix: string): Promise<Response> {
  if (!PROXY_METHODS.has(request.method)) {
    return json({ error: "请求方法不支持。" }, 405, { Allow: [...PROXY_METHODS].join(", ") });
  }
  const incoming = new URL(request.url);
  const target = new URL(BACKEND_ORIGIN);
  target.pathname = incoming.pathname.slice(prefix.length - 1);
  target.search = incoming.search;
  const backendPath = normalizedPagePath(target.pathname);
  if (/^\/(?:v1\/)?(?:internal(?:\/|$)|billing\/(?:quote|reserve|finalize|getpending|releaseexpired)(?:\/|$))/.test(backendPath)) {
    return json({ error: "接口不存在。" }, 404);
  }
  const headersForBackend = backendHeaders(request);
  if (request.method === "GET" && (/^\/v1\/chat-media\/assets\/[A-Za-z0-9_-]{1,128}$/.test(target.pathname)
    || /^\/v1\/character-voice\/assets\/[A-Za-z0-9_-]{1,128}$/.test(target.pathname)
    || /^\/v1\/generation\/assets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target.pathname))) {
    const range = request.headers.get("Range");
    if (range) headersForBackend.set("Range", range);
  }
  const upstream = await env.BACKEND.fetch(new Request(target, {
    method: request.method,
    headers: headersForBackend,
    body: await proxyBody(request),
    signal: request.signal,
    redirect: "manual",
  }));
  if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
    await upstream.body?.cancel();
    throw new GatewayError(502, "账户服务返回了无效的跳转响应。");
  }
  const headers = new Headers(upstream.headers);
  // Cookie is host-only; preserving it attaches the session to this web origin.
  // CORS headers for the internal backend origin are not useful to browsers.
  for (const name of ["Access-Control-Allow-Origin", "Access-Control-Allow-Credentials",
    "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"]) headers.delete(name);
  headers.set("Cache-Control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function h3ReferenceVideo(request: Request, env: Env): Promise<Response> {
  if (env.GENERATION_ENABLED === "false") return json({ error: "图片与视频生成已暂停开放。", code: "generation_paused" }, 503);
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    return json({ error: "当前来源不能使用这条视频通道。" }, 403);
  }
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request), redirect: "manual",
  }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再使用视频通道。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录正式账户后再使用视频通道。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `h3:${account.user.id}` });
  if (!limit.success) return json({ error: "视频请求太频繁，请稍后再试。" }, 429);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const record = body && typeof body === "object" ? body as { templateId?: unknown; prompt?: unknown; image?: unknown } : {};
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  if (!/^h3-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)) return json({ error: "没有这个动作模板。" }, 400);
  const asset = await env.ASSETS.fetch(new Request(new URL(`/assets/qingyu/h3-actions/${templateId}.mp4`, request.url), { method: "GET" }));
  if (!asset.ok) { await asset.body?.cancel(); return json({ error: "这个动作模板没有参考视频。" }, 502); }
  const templateVideo = new Uint8Array(await asset.arrayBuffer());
  return runH3ReferenceVideo({
    base: env.H3_COMFY_URL ?? "",
    token: env.H3_COMFY_TOKEN ?? "",
    templateId,
    extra: typeof record.prompt === "string" ? record.prompt : "",
    image: typeof record.image === "string" ? record.image : "",
    templateVideo,
  });
}

async function h3Channel(request: Request, env: Env, path: string): Promise<Response> {
  const upstreamPath = h3Upstream(request.method, path);
  const query = h3Query(path, new URL(request.url).search);
  if (!upstreamPath || query === null) return json({ error: "接口不存在。" }, 404);
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    return json({ error: "当前来源不能使用这条视频通道。" }, 403);
  }
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request), redirect: "manual",
  }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再使用视频通道。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录正式账户后再使用视频通道。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `h3:${account.user.id}` });
  if (!limit.success) return json({ error: "视频请求太频繁，请稍后再试。" }, 429);
  const base = env.H3_COMFY_URL?.replace(/\/$/, "") ?? "";
  const token = env.H3_COMFY_TOKEN ?? "";
  if (!base.startsWith("https://") || token.length < 32) return json({ error: "视频通道还没有接上。" }, 503);
  const length = Number(request.headers.get("Content-Length") || "0");
  if (length > 52_000_000) return json({ error: "上传内容过大。" }, 413);
  const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: "application/json" });
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  let upstream: Response;
  try {
    upstream = await fetch(`${base}${upstreamPath}${query}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(request.method === "GET" ? 20_000 : 300_000),
      ...(request.method === "POST" ? { duplex: "half" as const } : {}),
    });
  } catch {
    return json({ error: "视频通道暂时连不上。" }, 502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    return json({ error: "视频通道返回了无效响应。" }, 502);
  }
  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function authenticatedUser(request: Request, env: Env): Promise<string> {
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

function chatEnvironment(env: Env): DzmmChatEnvironment {
  // Only the explicitly bound Worker values are passed; local process.env is
  // not consulted and provider secrets are never exposed by the status route.
  return {
    DZMM_API_KEY: env.DZMM_API_KEY,
    DZMM_BASE_URL: env.DZMM_BASE_URL,
    DZMM_MODEL: env.DZMM_MODEL,
    DZMM_FAST_MODEL: env.DZMM_FAST_MODEL,
    DZMM_BALANCED_MODEL: env.DZMM_BALANCED_MODEL,
    DZMM_STORY_MODEL: env.DZMM_STORY_MODEL,
    DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: env.DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION,
    DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: env.DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function billingRpcError(value: unknown): void {
  if (!object(value) || !object(value.error)) return;
  const status = value.error.status;
  const message = value.error.message;
  const code = value.error.code;
  if (typeof status === "number" && [400, 401, 402, 403, 409, 503].includes(status)
    && typeof message === "string" && message.length <= 300 && !message.includes("\0")) {
    throw new DzmmBillingError(status, message,
      typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code
        : ({ 400: "INVALID_BILLING_REQUEST", 401: "AUTH_REQUIRED", 402: "CREDIT_INSUFFICIENT", 403: "BILLING_ACCOUNT_REQUIRED",
          409: "BILLING_REQUEST_USED", 503: "BILLING_UNAVAILABLE" } as Record<number, string>)[status]);
  }
  throw new DzmmBillingError(503, "账户计费服务暂时不可用，请稍后重试。");
}

function billingLifecycle(request: Request, env: Env, accountId: string, requestId: string, options: DzmmChatHandlerOptions): DzmmBillingLifecycle {
  if (!env.BILLING) return { async reserve() {
    throw new DzmmBillingError(503, "账户计费服务未连接，请稍后重试。");
  } };
  const binding = env.BILLING;
  const sessionToken = sessionCookie(request)?.slice("qingyu_session=".length) ?? "";
  return { async limitOutputTokens(preflight) {
    // Legacy bindings still reserve the full requested ceiling; they cannot
    // grant an underfunded generation. Current production exposes quote.
    if (!binding.quote) return preflight.maxOutputTokens;
    let value: unknown;
    try { value = await binding.quote({ ...preflight, sessionToken, accountId, requestId }); }
    catch { throw new DzmmBillingError(503, "账户回复预算暂时不可用，请稍后重试。"); }
    billingRpcError(value);
    if (object(value) && value.enabled === false) return preflight.maxOutputTokens;
    const minimum = Math.min(preflight.maxOutputTokens, preflight.operation === "memory" ? 512 : 128);
    if (!object(value) || value.enabled !== true || !Number.isSafeInteger(value.maxOutputTokens)
      || (value.maxOutputTokens as number) < minimum || (value.maxOutputTokens as number) > preflight.maxOutputTokens) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效的回复预算，请稍后重试。");
    }
    return value.maxOutputTokens as number;
  }, async reserve(preflight) {
    let value: unknown;
    try { value = await binding.reserve({ ...preflight, sessionToken, accountId, requestId }); }
    catch { throw new DzmmBillingError(503, "账户计费服务暂时不可用，请稍后重试。"); }
    billingRpcError(value);
    if (object(value) && value.enabled === false) return undefined;
    if (!object(value) || value.enabled !== true || !object(value.receipt)) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效记录，请稍后重试。");
    }
    if (value.created !== true) throw new DzmmBillingError(409, "该生成请求已经处理，请刷新后重新发送。", "BILLING_REQUEST_USED");
    const reservationId = value.receipt.id;
    const claimToken = value.claimToken;
    const costPolicy = Object.hasOwn(value.receipt, "costPolicy") ? parseDzmmCreditCostPolicy(value.receipt.costPolicy) : undefined;
    if (Object.hasOwn(value.receipt, "costPolicy") && !costPolicy) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效费率，请稍后重试。");
    }
    if (typeof reservationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(reservationId)
      || typeof claimToken !== "string" || !/^[A-Za-z0-9_-]{16,200}$/.test(claimToken)) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效记录，请稍后重试。");
    }
    const registeredModel = findDzmmProviderModel(preflight.model);
    if (costPolicy || (registeredModel && registeredModel.id !== "grok")) {
      try {
        if (registeredModel) {
          const expectedPolicy = costPolicy ? dzmmModelCostPolicy(costPolicy, preflight.model) : undefined;
          if (!costPolicy || value.receipt.model !== preflight.model || !expectedPolicy
            || ["inputUsdPerMillion", "outputUsdPerMillion", "maxInputUsdPerMillion", "maxOutputUsdPerMillion"]
              .some(field => costPolicy[field as keyof typeof costPolicy] !== expectedPolicy[field as keyof typeof expectedPolicy])) {
            throw new DzmmBillingError(503, "当前模型与冻结计费记录不一致，请联系站主检查服务配置。");
          }
        }
        const caps = readDzmmProviderMaxPrice(chatEnvironment(env), readDzmmProviderConfig(chatEnvironment(env)).baseUrl, preflight.model);
        if (!costPolicy || !caps || caps.prompt > costPolicy.maxInputUsdPerMillion || caps.completion > costPolicy.maxOutputUsdPerMillion) {
          throw new DzmmBillingError(503, "模型成本上限与计费配置不一致，请联系站主检查服务配置。");
        }
      } catch (failure) {
        // A grant already holds funds. Configuration rejection must release it
        // before returning, without starting a provider generation.
        try { billingRpcError(await binding.finalize({ reservationId, accountId, claimToken, outcome: "failed", hasValidOutput: false })); }
        catch { throw new DzmmBillingError(503, "配置核对失败，余额预留待恢复，请稍后刷新查看。"); }
        throw failure;
      }
    }
    return { async finalize(completion) {
      let result: unknown;
      try { result = await binding.finalize({ ...completion, reservationId, accountId, claimToken }); }
      catch { throw new DzmmBillingError(503, "余额结算暂未完成，请稍后刷新查看。"); }
      billingRpcError(result);
      if (completion.hasValidOutput && (!completion.usage || (costPolicy && completion.usage.providerCostUsd === undefined))
        && completion.generationId && options.waitUntil && object(result) && object(result.receipt) && result.receipt.status === "pending") {
        const recovery = recoverBillingGenerationSoon(env, { reservationId, accountId, claimToken,
          generationId: completion.generationId, model: preflight.model, outcome: completion.outcome, ...(costPolicy ? { costPolicy } : {}) },
        { metadataFetch: options.billingMetadataFetch });
        options.waitUntil(recovery);
      }
    } };
  } };
}

async function chat(request: Request, env: Env, options: DzmmChatHandlerOptions, memory = false, novel = false, suggestions = false): Promise<Response> {
  if (request.method === "GET" && !memory && !novel && !suggestions) return handleDzmmChatGet(chatEnvironment(env));
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: memory || novel || suggestions ? "POST" : "GET, POST" });
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "聊天请求应为 JSON。" }, 415);
  }
  const suppliedId = request.headers.get("X-Xumeng-Request-Id");
  if (suppliedId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(suppliedId)) {
    return json({ error: "生成请求编号无效，请刷新后重试。", code: "INVALID_REQUEST_ID" }, 400);
  }
  const requestId = suppliedId?.toLowerCase() ?? crypto.randomUUID();
  const userId = await authenticatedUser(request, env);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // IP limits survive guest-cookie rotation; user limits follow an account
  // across IPs. Cloudflare counters are per location and eventually consistent.
  const limiter = memory ? env.MEMORY_RATE_LIMITER ?? env.CHAT_RATE_LIMITER : env.CHAT_RATE_LIMITER;
  const kind = memory ? "memory" : suggestions ? "reply-suggestions" : "chat";
  const ipLimit = await limiter.limit({ key: `${kind}:ip:${ip}` });
  const userLimit = ipLimit.success && await limiter.limit({ key: `${kind}:user:${userId}` });
  if (!ipLimit.success || !userLimit || !userLimit.success) {
    return json({ error: "对话请求过于频繁，请稍后重试。" }, 429, { "Retry-After": "60" });
  }
  const billing = billingLifecycle(request, env, userId, requestId, options);
  const handlerOptions = { ...options, billing };
  const response = await (memory ? handleDzmmMemoryPost(request, chatEnvironment(env), handlerOptions)
    : novel ? handleDzmmNovelPost(request, chatEnvironment(env), handlerOptions)
      : suggestions ? handleDzmmReplySuggestionsPost(request, chatEnvironment(env), handlerOptions) : handleDzmmChatPost(request, chatEnvironment(env), handlerOptions));
  const headers = new Headers(response.headers);
  headers.set("X-Xumeng-Request-Id", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function scenarioNarration(request: Request, env: Env, options: DzmmChatHandlerOptions): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ error: "团本生成请求应为 JSON。" }, 415);
  try {
    const input = parseScenarioGenerationRequest(await readDzmmJsonBody(request));
    const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/scenarios/rooms/${encodeURIComponent(input.scenarioRoomId)}`, { headers: backendHeaders(request), signal: request.signal, redirect: "manual" }));
    if (!upstream.ok) { await upstream.body?.cancel(); throw new GatewayError(upstream.status === 401 || upstream.status === 404 ? upstream.status : 503, "无法读取当前团本，请重新打开房间。"); }
    const value = await upstream.json() as { accountId?: string; room?: XumengScenarioRoom };
    if (!value.accountId || !value.room || value.room.id !== input.scenarioRoomId || !value.room.isHost || value.room.hostId !== value.accountId) throw new GatewayError(403, "只有当前房间主持人可以生成叙事。");
    if (value.room.status === "ended") throw new GatewayError(409, "房间已结束，不能继续生成叙事。");
    const prepareInput = scenarioGenerationPreparation(value.room);
    const headers = new Headers(request.headers); headers.set("X-Xumeng-Request-Id", input.requestId);
    const forwarded = new Request(request.url, { method: "POST", headers, body: JSON.stringify(input), signal: request.signal });
    return chat(forwarded, env, { ...options, prepareInput });
  } catch (error) { if (error instanceof DzmmValidationError) return json({ error: error.message }, 400); throw error; }
}

export async function fetchRequest(
  request: Request,
  env: Env,
  options: DzmmChatHandlerOptions = {},
): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    const brandFile = ROOT_BRAND_FILES[path];
    if (brandFile) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = `${PUBLIC_ASSET_PREFIX}${brandFile}`;
      const response = await publicAsset(new Request(assetUrl, request), env);
      if (!response.ok && response.status !== 304) return response;
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=300, must-revalidate");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    }
    const normalizedPath = normalizedPagePath(path);
    if (normalizedPath === "/xumeng/girlfriend") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      const destination = new URL(request.url);
      destination.pathname = "/"; destination.search = ""; destination.hash = "chat/girlfriend";
      return new Response(null, { status: 302, headers: { Location: destination.toString(), "Cache-Control": "no-store" } });
    }
    if (env.GENERATION_ENABLED === "false" && /^\/(?:assets\/xumeng|dzmm)\/(?:generation-templates|action-templates|h3-actions|krea2-actions)(?:\/|$)/.test(normalizedPath))
      return json({ error: "资源不存在。" }, 404);
    const paymentInfoPage = getXumengPaymentInfoPage(path);
    if (paymentInfoPage) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      if (path !== paymentInfoPage.path) return redirectPage(request, paymentInfoPage.path);
      const shellUrl = new URL(request.url); shellUrl.pathname = "/"; shellUrl.search = "";
      // Do not forward cookies, conditional validators or ranges from this
      // document to the unrelated homepage representation used as its shell.
      const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
      if (!shell.ok || !shell.headers.get("Content-Type")?.includes("text/html")) {
        await shell.body?.cancel();
        return json({ error: "服务说明页面暂时不可用。" }, 503);
      }
      const canonical = `${CANONICAL_ORIGIN}${paymentInfoPage.path}`;
      const rewritten = new HTMLRewriter()
        .on("title", { element: element => { element.setInnerContent(paymentInfoPage.title); } })
        .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', { element: element => { element.setAttribute("content", paymentInfoPage.description); } })
        .on('meta[property="og:title"], meta[name="twitter:title"]', { element: element => { element.setAttribute("content", paymentInfoPage.title); } })
        .on('link[rel="canonical"]', { element: element => { element.setAttribute("href", canonical); } })
        .on('meta[property="og:url"]', { element: element => { element.setAttribute("content", canonical); } })
        .on('meta[name="robots"]', { element: element => { if (XUMENG_PAYMENT_INFO_DRAFT) element.setAttribute("content", "noindex, nofollow"); } })
        .on('script[type="application/ld+json"]', { element: element => { element.remove(); } })
        .on("#root", { element: element => { element.setInnerContent(renderXumengPaymentInfoPage(paymentInfoPage), { html: true }); } })
        .transform(shell);
      const headers = new Headers(rewritten.headers);
      headers.delete("ETag"); headers.delete("Last-Modified"); headers.delete("Content-Length");
      headers.set("Cache-Control", "public, max-age=300, must-revalidate");
      headers.set("X-Content-Type-Options", "nosniff");
      if (XUMENG_PAYMENT_INFO_DRAFT) headers.set("X-Robots-Tag", "noindex, nofollow");
      if (request.method === "HEAD") await rewritten.body?.cancel();
      return new Response(request.method === "HEAD" ? null : rewritten.body, { status: rewritten.status, headers });
    }
    if (normalizedPath === XUMENG_COMMUNITY_GUIDELINES_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      if (path !== XUMENG_COMMUNITY_GUIDELINES_PATH) return redirectPage(request, XUMENG_COMMUNITY_GUIDELINES_PATH);
      const shellUrl = new URL(request.url); shellUrl.pathname = "/"; shellUrl.search = "";
      // This is a different representation from the homepage: its validators
      // and range headers cannot be applied to the shared shell before rewriting.
      const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
      if (!shell.ok || !shell.headers.get("Content-Type")?.includes("text/html")) return json({ error: "公约页面暂时不可用。" }, 503);
      const canonical = `${CANONICAL_ORIGIN}${XUMENG_COMMUNITY_GUIDELINES_PATH}`;
      const rewritten = new HTMLRewriter()
        .on("title", { element: element => { element.setInnerContent(XUMENG_COMMUNITY_GUIDELINES_TITLE); } })
        .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', { element: element => { element.setAttribute("content", XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION); } })
        .on('meta[property="og:title"], meta[name="twitter:title"]', { element: element => { element.setAttribute("content", XUMENG_COMMUNITY_GUIDELINES_TITLE); } })
        .on('link[rel="canonical"]', { element: element => { element.setAttribute("href", canonical); } })
        .on('meta[property="og:url"]', { element: element => { element.setAttribute("content", canonical); } })
        .on('script[type="application/ld+json"]', { element: element => { element.remove(); } })
        .on("#root", { element: element => { element.setInnerContent(renderXumengCommunityGuidelines(), { html: true }); } })
        .transform(shell);
      const headers = new Headers(rewritten.headers);
      headers.delete("ETag"); headers.delete("Last-Modified"); headers.delete("Content-Length");
      headers.set("Cache-Control", "public, max-age=300, must-revalidate"); headers.set("X-Content-Type-Options", "nosniff");
      return new Response(request.method === "HEAD" ? null : rewritten.body, { status: rewritten.status, headers });
    }
    if (normalizedPath === "/nsfw" || normalizedPath === "/porn") return redirectPage(request, "/", 302);
    if (normalizedPath === "/robots.txt" || normalizedPath === "/sitemap.xml") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      }
      const sitemap = normalizedPath === "/sitemap.xml";
      const body = sitemap
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${CANONICAL_ORIGIN}/</loc></url><url><loc>${CANONICAL_ORIGIN}${XUMENG_COMMUNITY_GUIDELINES_PATH}</loc></url>${characterShareLocations().map(location => `<url><loc>${location}</loc></url>`).join("")}</urlset>\n`
        : `User-agent: *\nAllow: /\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`;
      return new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "Content-Type": sitemap ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path === "/dzmm" || path === LEGACY_ASSET_PREFIX) return redirectPage(request, "/");
    if (path.startsWith(LEGACY_ASSET_PREFIX)) {
      const relativePath = path.slice(LEGACY_ASSET_PREFIX.length);
      const mappedPath = LEGACY_BRAND_FILES[relativePath] ?? relativePath;
      return isPublicAsset(mappedPath, env)
        ? redirectPage(request, `${PUBLIC_ASSET_PREFIX}${mappedPath}`)
        : json({ error: "页面不存在。" }, 404);
    }
    if (path === "/health") {
      return request.method === "GET"
        ? json({ ok: true, service: "dzmm-web" })
        : json({ error: "请求方法不支持。" }, 405, { Allow: "GET" });
    }
    if (path.startsWith("/api/")) {
      if (path === TELEGRAM_FEEDBACK_WEBHOOK) return await telegramFeedbackWebhook(request, env);
      if (path === "/api/payments/stripe/webhook") return await stripeWebhook(request, env);
      if (path === "/api/payments/nowpayments/ipn") return await nowpaymentsWebhook(request, env);
      if (path === "/api/payments/guagua/notify" || path === "/api/payments/guagua/return"
        || /^\/api\/payments\/guagua\/checkout\/gg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path)
        || /^\/api\/payments\/guagua\/vip\/(?:checkout|return)\/sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path)) {
        return await guaguaPayment(request, env, path);
      }
      if (path === "/api/payments/zpay/notify" || path === "/api/payments/zpay/return"
        || /^\/api\/payments\/zpay\/checkout\/zp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path)
        || path === "/api/payments/zpay/subscription/notify" || path === "/api/payments/zpay/subscription/return"
        || /^\/api\/payments\/zpay\/subscription\/checkout\/sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path)) {
        return await zpayPayment(request, env, path);
      }
      checkMutationOrigin(request);
      if (path === "/api/h3/r2v") return await h3ReferenceVideo(request, env);
      if (path === "/api/h3/health" || path === "/api/h3/prompt" || path === "/api/h3/cancel" || path === "/api/h3/image" || path === "/api/h3/references" || path.startsWith("/api/h3/references/")) {
        return await h3Channel(request, env, path);
      }
      if (path === "/api/qingyu/companion-traveler/api" || path.startsWith("/api/qingyu/companion-traveler/api/")
        || path === "/api/qingyu/companion-intimate/api" || path.startsWith("/api/qingyu/companion-intimate/api/")
        || path === "/api/qingyu/companion/api" || path.startsWith("/api/qingyu/companion/api/")) return await handleCompanionGateway(request, env);
      if (path === "/api/krea2/generate") {
        if (env.GENERATION_ENABLED === "false") return json({ error: "图片与视频生成已暂停开放。", code: "generation_paused" }, 503);
        if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
        const templateId = body && typeof body === "object" && typeof (body as { templateId?: unknown }).templateId === "string"
          ? (body as { templateId: string }).templateId : "";
        const templateImage = /^krea2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)
          ? await loadKrea2Poster(request, env, templateId) : "";
        if (/^krea2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId) && !templateImage) return json({ error: "这个画面模板没有参考图。" }, 502);
        const hold = await reserveStudioStill(request, env, templateId);
        if (hold instanceof Response) return hold;
        let image: Response;
        try {
          image = await renderKrea2Still(env.KREA2_ACTIONS_URL ?? "", body, fetch, templateImage);
        } catch {
          await settleStudioStill(request, env, hold, "release");
          return json({ error: "出图没有完成，这次没有扣 Credit。" }, 502);
        }
        if (!image.ok || !image.headers.get("Content-Type")?.includes("image/png")) {
          await settleStudioStill(request, env, hold, "release");
          return image;
        }
        const charged = await settleStudioStill(request, env, hold, "charge");
        if (!charged) {
          await image.body?.cancel();
          await settleStudioStill(request, env, hold, "release");
          return json({ error: "扣费没有完成，这次没有出图。" }, 502);
        }
        const headers = new Headers(image.headers);
        headers.set("X-Charged-Credits", String(STUDIO_STILL_CREDITS));
        return new Response(image.body, { status: 200, headers });
      }
      const proxyPrefix = PROXY_PREFIXES.find(prefix => path.startsWith(prefix));
      if (proxyPrefix) return await proxyBackend(request, env, proxyPrefix);
      if (path === "/api/chat" || path === "/api/dzmm/chat") return await chat(request, env, options);
      if (path === "/api/memory" || path === "/api/dzmm/memory") return await chat(request, env, options, true);
      if (path === "/api/dzmm/scenario") return await scenarioNarration(request, env, options);
      if (path === "/api/phone/status" || path === "/api/phone/ws") return await handleMiniCpmPhone(request, env);
      if (path === "/api/novel-generation") return await chat(request, env, options, false, true);
      if (path === "/api/reply-suggestions" || path === "/api/dzmm/reply-suggestions") return await chat(request, env, options, false, false, true);
      if (path === "/api/live" || path.startsWith("/api/live/")) return await handleLiveGateway(request, env);
      return json({ error: "接口不存在。" }, 404);
    }
    if (path.startsWith(PUBLIC_ASSET_PREFIX)) {
      if (!isPublicAsset(path.slice(PUBLIC_ASSET_PREFIX.length), env)) return json({ error: "资源不存在。" }, 404);
      return await publicAsset(request, env);
    }
    const jumpImage = /^\/jump\/(?:catch|waiting|gaze)(?:-share)?\.jpg$/.test(normalizedPath) ? normalizedPath : "";
    if (jumpImage) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      const imageUrl = new URL(request.url);
      imageUrl.pathname = jumpImage;
      imageUrl.search = "";
      const image = await env.ASSETS.fetch(new Request(imageUrl, { method: request.method }));
      if (image.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "image/jpeg") {
        await image.body?.cancel();
        return json({ error: "资源不存在。" }, 404);
      }
      const headers = new Headers(image.headers);
      headers.set("Content-Type", "image/jpeg");
      headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(image.body, { status: image.status, headers });
    }
    if (normalizedPath === "/jump/index.html") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      return redirectPage(request, "/jump/", 307);
    }
    const posterName = normalizedPath === "/jump" ? "catch" : normalizedPath.match(/^\/(?:jump|go)\/(catch|waiting|gaze)$/)?.[1] ?? "";
    if (posterName) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      if (!normalizedPath.startsWith("/go/")) return redirectPage(request, `/go/${posterName}`, 302);
      const assetUrl = new URL(request.url);
      assetUrl.pathname = `/jump/${posterName}.html`;
      assetUrl.search = "";
      const page = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
      const headers = new Headers(page.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      headers.set("X-Robots-Tag", "noindex");
      return new Response(page.body, { status: page.status, headers });
    }
    const characterShare = /^\/c\/([a-z0-9][a-z0-9-]{0,119})$/.exec(normalizedPath);
    if (characterShare) return await characterShareResponse(request, env, characterShare[1]);
    return await env.ASSETS.fetch(request);
  } catch (error) {
    return error instanceof GatewayError
      ? json({ error: error.message }, error.status)
      : json({ error: "服务暂时不可用，请稍后重试。" }, 503);
  }
}

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return fetchRequest(request, env, { waitUntil: promise => ctx.waitUntil(promise) });
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runBillingMaintenance(env));
  },
};

export default worker;
