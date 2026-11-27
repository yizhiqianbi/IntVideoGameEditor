import type { DzmmChatHandlerOptions } from "../../../src/lib/dzmm-chat-handler";
import { renderXumengCommunityGuidelines, XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION, XUMENG_COMMUNITY_GUIDELINES_PATH, XUMENG_COMMUNITY_GUIDELINES_TITLE } from "../../../src/lib/xumeng-community-guidelines";
import { XUMENG_CALLS_ENABLED } from "../../../src/lib/xumeng-feature-availability";
import type { XumengLocale } from "../../../src/lib/xumeng-i18n";
import { getXumengPaymentInfoPage, renderXumengPaymentInfoPage, XUMENG_PAYMENT_INFO_DRAFT } from "../../../src/lib/xumeng-payment-info";
import { xumengLocaleFromCountry } from "../../../src/lib/xumeng-region";
import { runBillingMaintenance } from "./billing-maintenance";
import { characterShareCoverResponse, characterShareResponse } from "./character-share";
import { handleCompanionGateway } from "./companion-gateway";
import { communityGuidelinesJsonLd, geoCanonicalPath, geoDiscoveryResponse, localizedLandingLocale, publicSitemapLocations, publicSitemapResponse } from "./geo-discovery";
import { indexNowKeyResponse, submitIndexNowUrls, validIndexNowKey } from "./indexnow";
import { handleLiveGateway } from "./live-gateway";
import { handleMiniCpmPhone } from "./minicpm-phone-gateway";
import { chat, scenarioNarration } from "./routes/chat";
import { aiapiStill, aiapiVideo, aigenOptimizePrompt, h3CanvasVideo, h3Channel, h3ReferenceVideo, krea2Generate, videoCharacterApi } from "./routes/media-gen";
import {
  LEGACY_BRAND_FILES,
  ROOT_BRAND_FILES,
  androidApkResponse,
  isPublicAsset,
  localizedLandingResponse,
  publicAsset,
  redirectPage,
  shareCover,
  sharedCardPage,
  studioCanvasRedirect,
  withHashedBundleCache,
} from "./routes/pages";
import { guaguaPayment, nowpaymentsWebhook, proxyBackend, stripeWebhook, telegramFeedbackWebhook, zpayPayment } from "./routes/payments";
import {
  CANONICAL_ORIGIN,
  GatewayError,
  LEGACY_ASSET_PREFIX,
  PROXY_PREFIXES,
  PUBLIC_ASSET_PREFIX,
  TELEGRAM_FEEDBACK_WEBHOOK,
  checkMutationOrigin,
  json,
  normalizedPagePath,
  type Env,
} from "./routes/shared";
import { TAVERN_ENGINE_SOURCE_TEXT } from "./tavern-notice";

export { ViduLiveStudio } from "./vidu-live-studio";
export type { Env } from "./routes/shared";

export async function fetchRequest(
  request: Request,
  env: Env,
  options: DzmmChatHandlerOptions = {},
): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (path === "/api/xumeng-share/cover") return await shareCover(request);
    if (path === "/assets/xumeng/video-catalog.json") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      const upstream = await fetch("https://video.xumengchat.top/catalog.json", { headers: { accept: "application/json" } });
      if (!upstream.ok) { await upstream.body?.cancel(); return json({ error: "视频目录暂时读不出来。" }, 502); }
      const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60, must-revalidate", "x-content-type-options": "nosniff" });
      if (request.method === "HEAD") { await upstream.body?.cancel(); return new Response(null, { status: 200, headers }); }
      return new Response(upstream.body, { status: 200, headers });
    }
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
    const localizedLanding = localizedLandingLocale(normalizedPath);
    if (localizedLanding) return await localizedLandingResponse(request, env, localizedLanding);
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
        .on('link[hreflang]', { element: element => { const lang = element.getAttribute("hreflang"); if (lang === "zh-CN" || lang === "x-default") element.setAttribute("href", canonical); else element.remove(); } })
        .on('meta[property="og:url"]', { element: element => { element.setAttribute("content", canonical); } })
        .on('meta[name="robots"], meta[name="googlebot"], meta[name="bingbot"]', { element: element => { if (XUMENG_PAYMENT_INFO_DRAFT) element.setAttribute("content", "noindex, nofollow"); } })
        .on('script[type="application/ld+json"]', { element: element => { element.remove(); } })
        .on("#xumeng-public-fallback", { element: element => { element.remove(); } })
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
      const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
      if (!shell.ok || !shell.headers.get("Content-Type")?.includes("text/html")) {
        await shell.body?.cancel();
        return json({ error: "公约页面暂时不可用。" }, 503);
      }
      const canonical = `${CANONICAL_ORIGIN}${XUMENG_COMMUNITY_GUIDELINES_PATH}`;
      const rewritten = new HTMLRewriter()
        .on("title", { element: element => { element.setInnerContent(XUMENG_COMMUNITY_GUIDELINES_TITLE); } })
        .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', { element: element => { element.setAttribute("content", XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION); } })
        .on('meta[property="og:title"], meta[name="twitter:title"]', { element: element => { element.setAttribute("content", XUMENG_COMMUNITY_GUIDELINES_TITLE); } })
        .on('link[rel="canonical"]', { element: element => { element.setAttribute("href", canonical); } })
        .on('link[hreflang]', { element: element => { const lang = element.getAttribute("hreflang"); if (lang === "zh-CN" || lang === "x-default") element.setAttribute("href", canonical); else element.remove(); } })
        .on('meta[property="og:url"]', { element: element => { element.setAttribute("content", canonical); } })
        .on('script[type="application/ld+json"]', { element: element => { element.setInnerContent(communityGuidelinesJsonLd()); } })
        .on("#xumeng-public-fallback", { element: element => { element.remove(); } })
        .on('script[type="module"]', { element: element => { element.remove(); } })
        .on("#root", { element: element => { element.setInnerContent(renderXumengCommunityGuidelines(), { html: true }); } })
        .transform(shell);
      const headers = new Headers(rewritten.headers);
      headers.delete("ETag"); headers.delete("Last-Modified"); headers.delete("Content-Length");
      headers.set("Cache-Control", "public, max-age=300, must-revalidate");
      headers.set("X-Content-Type-Options", "nosniff");
      if (request.method === "HEAD") await rewritten.body?.cancel();
      return new Response(request.method === "HEAD" ? null : rewritten.body, { status: rewritten.status, headers });
    }
    const indexNowKey = indexNowKeyResponse(request, path, env);
    if (indexNowKey) return indexNowKey;
    if (normalizedPath === "/nsfw" || normalizedPath === "/porn") return redirectPage(request, "/", 302);
    const geoPath = geoCanonicalPath(normalizedPath);
    if (geoPath) {
      if (request.method !== "GET" && request.method !== "HEAD") return geoDiscoveryResponse(request, geoPath) ?? json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      if (path !== geoPath) return redirectPage(request, geoPath);
      if (geoPath === "/sitemap.xml") return await publicSitemapResponse(request, env.BACKEND);
      return geoDiscoveryResponse(request, geoPath) ?? json({ error: "页面不存在。" }, 404);
    }
    if (normalizedPath.startsWith("/tags/")) {
      return new Response(request.method === "HEAD" ? null : "标签页面不存在。", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
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
    if (path === "/download/xumeng-android.apk") return await androidApkResponse(request, env);
    const shareMatch = /^\/s\/([a-z0-9]{8,16})$/.exec(path);
    if (shareMatch) return await sharedCardPage(request, env, shareMatch[1]);
    if (path === "/health") {
      return request.method === "GET"
        ? json({ ok: true, service: "dzmm-web" })
        : json({ error: "请求方法不支持。" }, 405, { Allow: "GET" });
    }
    if (path === "/legal/tavern-engine" || path === "/legal/tavern-engine.txt") {
      return new Response(TAVERN_ENGINE_SOURCE_TEXT, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }
    if (path.startsWith("/api/")) {
      if (path === "/api/ops/indexnow") {
        if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
        const configuredKey = validIndexNowKey(env.INDEXNOW_KEY);
        if (!configuredKey) return json({ error: "IndexNow 尚未配置。" }, 503);
        const auth = request.headers.get("Authorization")?.trim() ?? "";
        if (auth !== `Bearer ${configuredKey}`) return json({ error: "未授权。" }, 401);
        let urls: string[] = publicSitemapLocations();
        try {
          const parsed = await request.json() as { urls?: unknown };
          if (Array.isArray(parsed?.urls) && parsed.urls.length > 0) {
            urls = parsed.urls.filter((item): item is string => typeof item === "string");
          }
        } catch { /* Default to canonical sitemap locations when body is empty. */ }
        const result = await submitIndexNowUrls(urls, env);
        return json(result, result.ok ? 200 : 502);
      }
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
      if (path === "/api/dzmm/region") {
        if (request.method !== "GET") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET" });
        const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? request.headers.get("CF-IPCountry");
        return json({ country: country?.toUpperCase() ?? null, locale: xumengLocaleFromCountry(country) ?? "zh-Hans" });
      }
      const translationLocale = /^\/api\/dzmm\/translations\/(en|zh-Hant|ja|ko)$/.exec(path)?.[1];
      if (translationLocale) {
        if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
        const assetUrl = new URL(request.url);
        assetUrl.pathname = `${PUBLIC_ASSET_PREFIX}i18n/cards-${translationLocale}.json`;
        const response = await publicAsset(new Request(assetUrl, request), env);
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
      }
      checkMutationOrigin(request);
      if (path === "/api/aigen/optimize-prompt") return await aigenOptimizePrompt(request, env);
      if (path === "/api/xumeng/video-character") return await videoCharacterApi(request, env);
      if (path === "/api/aiapi/still") return await aiapiStill(request, env);
      if (path === "/api/aiapi/video") return await aiapiVideo(request, env);
      if (path === "/api/h3/r2v") return await h3ReferenceVideo(request, env);
      if (path === "/api/h3/canvas") return await h3CanvasVideo(request, env);
      if (path === "/api/h3/health" || path === "/api/h3/prompt" || path === "/api/h3/cancel" || path === "/api/h3/image" || path === "/api/h3/references" || path.startsWith("/api/h3/references/")) {
        return await h3Channel(request, env, path);
      }
      if (path === "/api/xumeng/companion-intimate/api" || path.startsWith("/api/xumeng/companion-intimate/api/")
        || path === "/api/xumeng/companion-sales/api" || path.startsWith("/api/xumeng/companion-sales/api/")
        || path.startsWith("/api/xumeng/companion-cast/")
        || path === "/api/xumeng/companion/api" || path.startsWith("/api/xumeng/companion/api/")) return await handleCompanionGateway(request, env);
      if (path === "/api/krea2/generate") return await krea2Generate(request, env);
      const proxyPrefix = PROXY_PREFIXES.find(prefix => path.startsWith(prefix));
      if (proxyPrefix) return await proxyBackend(request, env, proxyPrefix);
      if (path === "/api/chat" || path === "/api/dzmm/chat") return await chat(request, env, options);
      if (path === "/api/memory" || path === "/api/dzmm/memory") return await chat(request, env, options, true);
      if (path === "/api/dzmm/scenario") return await scenarioNarration(request, env, options);
      if (!XUMENG_CALLS_ENABLED) {
        const live = path === "/api/live" || path.startsWith("/api/live/");
        const phone = path === "/api/phone/status" || path === "/api/phone/ws";
        if (phone || (live && request.method !== "DELETE")) return json({ error: "语音通话和视频通话暂时关闭。", code: "calls_paused" }, 503);
      }
      if (path === "/api/phone/status" || path === "/api/phone/ws") return await handleMiniCpmPhone(request, env);
      if (path === "/api/novel-generation") return await chat(request, env, options, false, true);
      if (path === "/api/reply-suggestions" || path === "/api/dzmm/reply-suggestions") return await chat(request, env, options, false, false, true);
      if (path === "/api/illustrations" || path === "/api/dzmm/illustrations") return await chat(request, env, options, false, false, false, true);
      if (path === "/api/cover-caption") return await chat(request, env, options, false, false, false, false, true);
      if (path === "/api/live" || path.startsWith("/api/live/")) return await handleLiveGateway(request, env);
      return json({ error: "接口不存在。" }, 404);
    }
    const publishedShareCover = /^\/assets\/xumeng\/share\/(published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([1-9]\d{0,8})\.(png|jpe?g)$/.exec(normalizedPath);
    if (publishedShareCover) return await characterShareCoverResponse(request, env, publishedShareCover[1], publishedShareCover[2], publishedShareCover[3]);
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
    const characterCover = /^\/c\/(published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([1-9]\d{0,8})\/cover\.(png|jpe?g)$/.exec(normalizedPath);
    if (characterCover) return await characterShareCoverResponse(request, env, characterCover[1], characterCover[2], characterCover[3]);
    const characterShare = /^\/(?:(en|zh-cn|zh-tw|jp|ko)\/)?c\/([a-z0-9][a-z0-9-]{0,119})$/.exec(normalizedPath);
    if (characterShare) {
      const prefix = characterShare[1];
      const id = characterShare[2];
      if (prefix === "zh-cn") return redirectPage(request, `/c/${id}`);
      const canonicalCharPath = prefix ? `/${prefix}/c/${id}` : `/c/${id}`;
      if (path !== canonicalCharPath && (request.method === "GET" || request.method === "HEAD")) {
        return redirectPage(request, canonicalCharPath);
      }
      const locale: XumengLocale = prefix === "en"
        ? "en"
        : prefix === "zh-tw"
          ? "zh-Hant"
          : prefix === "jp"
            ? "ja"
            : prefix === "ko"
              ? "ko"
              : "zh-Hans";
      return await characterShareResponse(request, env, id, locale);
    }
    const studioCanvas = studioCanvasRedirect(request, normalizedPath);
    if (studioCanvas) return studioCanvas;
    if (normalizedPath === "/ops") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/ops.html";
      assetUrl.search = "";
      const page = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
      if (!page.ok || !page.headers.get("Content-Type")?.includes("text/html")) {
        await page.body?.cancel();
        return json({ error: "运营页暂时不可用。" }, 503);
      }
      const headers = new Headers(page.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      headers.set("X-Robots-Tag", "noindex");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(page.body, { status: page.status, headers });
    }
    return withHashedBundleCache(await env.ASSETS.fetch(request), new URL(request.url).pathname);
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
