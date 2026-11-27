import { DZMM_COVER_VIDEO_MAX_BYTES } from "../../../../src/lib/dzmm-cover-media";
import { createRechargeLocation, createReturnClearCookie, hasCreateReturnCookie, mainSiteRechargeLanding } from "../../../../src/lib/xumeng-create-return";
import { publicOauthCookie, sharedSessionCookies } from "../../../../src/lib/xumeng-session-cookie";
import {
  BACKEND_ORIGIN,
  CANONICAL_ORIGIN,
  GatewayError,
  MAX_PROXY_BODY_BYTES,
  MAX_WEBHOOK_BODY_BYTES,
  PROXY_METHODS,
  backendHeaders,
  json,
  normalizedPagePath,
  proxyBody,
  type Env,
} from "./shared";

const MAX_ZPAY_QUERY_BYTES = 8192;
const GUAGUA_ORDER_ID = /^gg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const GUAGUA_CALLBACK_IP = "136.110.35.126";
/** 支付通道会更换收银台域名；这里只放行明确配置过的域名。 */
const GUAGUA_PAY_HOSTS = new Set(["alipay.dthzf001.cn", "wxpay.xqlwl2026.cn", "pay.y1yun.net", "y1yun.net", "pay.zhifuyu.com"]);

function guaguaPayLocation(value: string | null): URL | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || !GUAGUA_PAY_HOSTS.has(url.hostname.toLowerCase()) || url.port || url.username || url.password || url.hash
    || !/^\/(?:pay|cashier)\//.test(url.pathname)) return null;
  return url;
}

export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
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
export async function nowpaymentsWebhook(request: Request, env: Env): Promise<Response> {
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
export async function telegramFeedbackWebhook(request: Request, env: Env): Promise<Response> {
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

export async function guaguaPayment(request: Request, env: Env, path: string): Promise<Response> {
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
    if (upstream.status === 303 && returning && hasCreateReturnCookie(request.headers.get("Cookie"))) {
      const landing = mainSiteRechargeLanding(destination?.href ?? null);
      if (landing && landing.orderId === null && !landing.paid) {
        responseHeaders.set("Location", createRechargeLocation(landing));
        responseHeaders.append("Set-Cookie", createReturnClearCookie());
        return new Response(null, { status: 303, headers: responseHeaders });
      }
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

export async function zpayPayment(request: Request, env: Env, path: string): Promise<Response> {
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

export async function proxyBackend(request: Request, env: Env, prefix: string): Promise<Response> {
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
  const coverVideoUpload = request.method === "POST"
    && target.pathname === "/v1/media"
    && /^video\/(?:mp4|webm)\b/i.test(request.headers.get("content-type") || "");
  const upstream = await env.BACKEND.fetch(new Request(target, {
    method: request.method,
    headers: headersForBackend,
    body: await proxyBody(request, coverVideoUpload ? DZMM_COVER_VIDEO_MAX_BYTES : MAX_PROXY_BODY_BYTES, coverVideoUpload ? "封面视频不能超过 16 MB。" : undefined),
    signal: request.signal,
    redirect: "manual",
  }));
  if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
    await upstream.body?.cancel();
    throw new GatewayError(502, "账户服务返回了无效的跳转响应。");
  }
  const headers = new Headers(upstream.headers);
  // One parent-domain session is readable by xumengchat.top and create.xumengchat.top.
  // CORS headers for the internal backend origin are not useful to browsers.
  for (const name of ["Access-Control-Allow-Origin", "Access-Control-Allow-Credentials",
    "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"]) headers.delete(name);
  const sessionCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const shared = sharedSessionCookies(incoming.hostname, sessionCookies.map(cookie => publicOauthCookie(cookie, prefix)));
  if (shared !== sessionCookies) {
    headers.delete("Set-Cookie");
    for (const cookie of shared) headers.append("Set-Cookie", cookie);
  }
  const upstreamCache = upstream.headers.get("Cache-Control") ?? "";
  const publicCard = /^\/v1\/publishing\/media\/published-[a-f0-9-]+\/\d+\/(?:cover|gallery-\d+)-card$/.test(target.pathname)
    && /^public,\s*max-age=\d+/.test(upstreamCache);
  const reusableChatMedia = request.method === "GET"
    && /^\/v1\/chat-media\/assets\/[A-Za-z0-9_-]{1,128}$/.test(target.pathname)
    && /^private,\s*max-age=\d+/.test(upstreamCache);
  if (!publicCard && !reusableChatMedia) headers.set("Cache-Control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
