import { XUMENG_SHARE_COVER_MAX_BYTES, xumengShareCoverImageType, xumengVideoCoverUpstream } from "../../../../src/lib/xumeng-share-poster";
import type { XumengLocale } from "../../../../src/lib/xumeng-i18n";
import { localizedLandingAlternates, localizedLandingJsonLd, localizedLandingPath, localizedLandingSeo, renderLocalizedLandingFallback } from "../geo-discovery";
import { XUMENG_USER_CARD_ASSET_PATHS } from "../user-card-assets";
import { BACKEND_ORIGIN, CANONICAL_ORIGIN, CREATE_MEDIA_ORIGIN, json, type Env } from "./shared";

const STUDIO_CANVAS_PATH = /^\/canvas(?:\/(?:share|chat-share|import\/blender))?$/;

export const ROOT_BRAND_FILES: Record<string, string> = {
  "/favicon.ico": "brand/xumeng-favicon.ico",
  "/icon.svg": "brand/xumeng-mark.svg",
  "/apple-touch-icon.png": "brand/xumeng-icon-192.png",
  "/apple-touch-icon-precomposed.png": "brand/xumeng-icon-192.png",
  "/manifest.webmanifest": "manifest.webmanifest",
  "/site.webmanifest": "manifest.webmanifest",
};

export const LEGACY_BRAND_FILES: Record<string, string> = {
  "brand/icon.svg": "brand/xumeng-mark.svg",
  "brand/icon-192.png": "brand/xumeng-icon-192.png",
  "brand/icon-512.png": "brand/xumeng-icon-512.png",
  "brand/favicon.ico": "brand/xumeng-favicon.ico",
};

const PUBLIC_ASSET_FILES = new Set([
  "exported-cards/manifest.json", "exported-cards/LICENSE-CONTENT.txt",
  ...["peiyu", "tangtuantuan", "wangushi", "shenyan", "huoyushen", "jiwenqing", "naifuer", "songzhixia", "jiangchiye", "sunianzhi", "xuanjing", "nie-xiaoqian", "caleb", "edmund-harrower", "frankie-doyle", "redline-salvage", "rosalind", "the-lighthouse"].flatMap(slug => [
    `exported-cards/foreverse-${slug}.v2.json`, `exported-cards/foreverse-${slug}-cover.png`,
  ]),
  "live/rtc.js", "live/minicpm-capture.js",
  "i18n/cards-en.json", "i18n/cards-zh-Hant.json", "i18n/cards-ja.json", "i18n/cards-ko.json",
  "brand/xumeng-mark.svg", "brand/xumeng-icon-192.png", "brand/xumeng-icon-512.png",
  "brand/xumeng-character-placeholder.svg",
  "brand/xumeng-favicon.ico", "brand/sources.json", "manifest.webmanifest",
  "content-covers/yume.jpg", "content-covers/wanning.jpg", "content-covers/sumai.jpg", "content-covers/tangtang.jpg",
  "content-covers/promo-member.webp", "content-covers/promo-recharge.webp", "content-covers/promo-invite.webp",
  "content-covers/create-hero.webp", "content-covers/create-role.webp", "content-covers/create-novel.webp", "content-covers/create-girlfriend.webp",
  "content-covers/create-game.webp", "content-covers/create-scenario.webp", "content-covers/create-generate.webp",
  "content-covers/motion/create-generate.mp4", "content-covers/motion/create-girlfriend.mp4",
  "content-covers/motion/create-role.mp4", "content-covers/motion/create-scenario.mp4",
  "content-covers/motion/create-novel.mp4",
  "home/shelf-hero.webp", "home/hero-1.webp", "home/hero-2.webp", "home/hero-3.webp",
  "home/cover-su-peizhen.webp", "home/cover-shanghai.webp", "home/cover-weakness.webp", "home/cover-tiangong.webp",
  "home/cover-linshuang.webp", "home/cover-miveth.webp", "home/cover-qin.webp",
  "home/motion/shelf-linshuang.mp4", "home/motion/shelf-miveth.mp4", "home/motion/shelf-qin.mp4",
  "home/motion/shelf-mom.mp4", "home/motion/shelf-nun.mp4", "home/motion/shelf-ballet.mp4",
  "home/motion/shelf-clerk.mp4", "home/motion/shelf-guan.mp4", "home/motion/shelf-you.mp4",
  "home/motion/shelf-mizuko.mp4", "home/motion/shelf-yu.mp4", "home/motion/shelf-su.mp4",
  "home/motion/shelf-limei.mp4", "home/motion/shelf-spring.mp4", "home/motion/shelf-baixue.mp4",
  "home/motion/shelf-sisters.mp4", "home/motion/shelf-megan.mp4",
  "home/motion/shelf-top003.mp4", "home/motion/shelf-top008.mp4", "home/motion/shelf-top009.mp4",
  "home/motion/shelf-top011.mp4", "home/motion/shelf-top013.mp4", "home/motion/shelf-top015.mp4",
  "home/motion/shelf-top016.mp4", "home/motion/shelf-top018.mp4", "home/motion/shelf-top019.mp4",
  "home/motion/shelf-top020.mp4", "home/motion/shelf-top021.mp4", "home/motion/shelf-top022.mp4",
  "home/motion/shelf-top024.mp4", "home/motion/shelf-top025.mp4", "home/motion/shelf-top026.mp4",
  "home/motion/shelf-top028.mp4", "home/motion/shelf-top029.mp4", "home/motion/shelf-top030.mp4",
  "home/great-vibes-latin.woff2", "home/great-vibes-OFL.txt",
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

export function isPublicAsset(relativePath: string, env: Env): boolean {
  if (env.GENERATION_ENABLED === "false" && /^(?:generation-templates|action-templates|h3-actions|krea2-actions)\//.test(relativePath)) return false;
  return PUBLIC_ASSET_FILES.has(relativePath) || XUMENG_USER_CARD_ASSET_PATHS.has(relativePath)
    || /^covers\/\d{1,120}\.(?:webp|png)$/.test(relativePath)
    || /^gallery\/\d{1,120}-[1-9]\d*\.webp$/.test(relativePath)
    || /^categories\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(relativePath)
    || relativePath === "h3-actions/manifest.json"
    || /^h3-actions\/h3(?:-[a-z0-9]+)+\.(?:mp4|webp)$/.test(relativePath)
    || relativePath === "krea2-actions/manifest.json"
    || /^krea2-actions\/krea2(?:-[a-z0-9]+)+\.webp$/.test(relativePath)
    || /^share\/[a-z0-9][a-z0-9-]{0,119}\.jpg$/.test(relativePath)
    || /^exported-cards\/foreverse-[a-z0-9-]+-cover-card\.jpg$/.test(relativePath)
    || /^user-cards\/20261024\/[a-z0-9][a-z0-9-]{0,79}-card\.jpg$/.test(relativePath);
}

/** The main site has no canvas app. These paths belong on the studio host. */
export function studioCanvasRedirect(request: Request, normalizedPath: string): Response | null {
  if (!STUDIO_CANVAS_PATH.test(normalizedPath)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  }
  const current = new URL(request.url);
  const target = new URL(normalizedPath, CREATE_MEDIA_ORIGIN);
  target.search = current.search;
  return new Response(null, {
    status: 302,
    headers: { Location: target.href, "Cache-Control": "no-store" },
  });
}

export function redirectPage(request: Request, pathname: string, status: 302 | 307 | 308 = 308): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  }
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Response(null, { status, headers: { Location: target.href } });
}

export async function localizedLandingResponse(request: Request, env: Env, locale: XumengLocale): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  const shellUrl = new URL(request.url);
  shellUrl.pathname = "/";
  shellUrl.search = "";
  const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
  if (!shell.ok || !shell.headers.get("Content-Type")?.includes("text/html")) return shell;
  const seo = localizedLandingSeo(locale);
  const canonical = `${CANONICAL_ORIGIN}${localizedLandingPath(locale)}`;
  const htmlLang = seo.ogLocale.replace("_", "-");
  const alternates = localizedLandingAlternates().map(item => `<link rel="alternate" hreflang="${item.hreflang}" href="${item.href}" />`).join("")
    + `<link rel="alternate" hreflang="x-default" href="${CANONICAL_ORIGIN}/" />`;
  const rewritten = new HTMLRewriter()
    .on("html", { element: element => { element.setAttribute("lang", htmlLang); } })
    .on("title", { element: element => { element.setInnerContent(seo.title); } })
    .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', { element: element => { element.setAttribute("content", seo.description); } })
    .on('meta[property="og:title"], meta[name="twitter:title"]', { element: element => { element.setAttribute("content", seo.title); } })
    .on('meta[property="og:locale"]', { element: element => { element.setAttribute("content", seo.ogLocale); } })
    .on('meta[property="og:url"]', { element: element => { element.setAttribute("content", canonical); } })
    .on('link[rel="canonical"]', { element: element => { element.setAttribute("href", canonical); } })
    .on('link[rel="alternate"][hreflang]', { element: element => { element.remove(); } })
    .on("head", { element: element => { element.append(alternates, { html: true }); } })
    .on('script[type="application/ld+json"]', { element: element => { element.setInnerContent(localizedLandingJsonLd(locale), { html: true }); } })
    .on("#xumeng-public-fallback", { element: element => { element.setInnerContent(renderLocalizedLandingFallback(locale), { html: true }); } })
    .transform(shell);
  const headers = new Headers(rewritten.headers);
  headers.delete("ETag"); headers.delete("Last-Modified"); headers.delete("Content-Length");
  headers.set("Content-Language", htmlLang);
  headers.set("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  if (request.method === "HEAD") await rewritten.body?.cancel();
  return new Response(request.method === "HEAD" ? null : rewritten.body, { status: rewritten.status, headers });
}

export async function publicAsset(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  }
  const response = await env.ASSETS.fetch(request);
  // A missing image or manifest must not become the SPA's HTML fallback.
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() === "text/html") {
    await response.body?.cancel();
    return json({ error: "资源不存在。" }, 404);
  }
  if (/\/(?:exported-cards\/foreverse-[a-z0-9-]+-cover-card|user-cards\/20261024\/[a-z0-9][a-z0-9-]*-card)\.jpg$/.test(new URL(request.url).pathname)) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  // Our own media (hero/creative covers/brand images) changes rarely; let
  // browsers keep it for a week instead of re-downloading on every visit.
  const assetPath = new URL(request.url).pathname;
  if (/^\/assets\/xumeng\/(?:home|content-covers|brand|categories|covers|gallery|generation-templates)\/(?:motion\/)?[^/]+\.(?:webp|jpg|jpeg|png|svg|ico|mp4)$/.test(assetPath)) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}

/** 文件名带 8 位内容哈希的 js/css：换构建就是新 URL，可以放心让浏览器缓存一年。 */
const HASHED_BUNDLE_PATH = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

/**
 * Workers 静态资源默认返回 `public, max-age=0, must-revalidate`，回头客每次站内跳转
 * 都要多一轮协商。这里只给哈希命名的 js/css 覆盖成长缓存，其它资源保持原行为。
 */
export function withHashedBundleCache(response: Response, pathname: string): Response {
  if (!HASHED_BUNDLE_PATH.test(pathname)) return response;
  if (response.status !== 200 && response.status !== 304) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(response.body, { status: response.status, headers });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function sharedCardHtml(input: { title: string; heading: string; description: string; author: string; kindLabel: string; body: string; cover: string; slug: string }): string {
  const title = escapeHtml(input.title);
  const heading = escapeHtml(input.heading);
  const description = escapeHtml(input.description);
  const body = escapeHtml(input.body);
  const author = escapeHtml(input.author);
  const cover = input.cover ? `<img class="cover" src="${escapeHtml(input.cover)}" alt="" />` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title><meta name="description" content="${description}" />
<meta property="og:type" content="article" /><meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" /><meta property="og:url" content="https://xumengchat.top/s/${input.slug}" />
<meta name="twitter:card" content="summary_large_image" />
<style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(720px 420px at 85% -10%,rgba(217,76,119,.22),transparent 60%),#12080f;color:#f8e8eb;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:680px;margin:0 auto;padding:42px 22px 64px}.brand{display:flex;align-items:center;gap:9px;color:#c79aa9;font-size:13px;letter-spacing:.04em}
.brand i{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#ff7aa8,#b9365f);display:inline-block}
.kicker{margin-top:34px;color:#e8c8a0;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
h1{font-size:clamp(26px,5vw,38px);line-height:1.25;margin:10px 0 8px;letter-spacing:-.02em}
.meta{color:#c79aa9;font-size:13px}.cover{width:100%;margin-top:22px;border-radius:20px;border:1px solid rgba(255,255,255,.12);display:block}
.post{margin-top:22px;padding:22px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:rgba(35,19,32,.66);white-space:pre-wrap;word-break:break-word}
.cta{display:flex;gap:12px;align-items:center;margin-top:26px;flex-wrap:wrap}
a.primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 24px;border-radius:999px;background:linear-gradient(120deg,#e4557f,#b9365f);color:#fff;text-decoration:none;font-weight:650;box-shadow:0 14px 30px -16px rgba(217,76,119,.9)}
a.ghost{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:999px;border:1px solid rgba(255,255,255,.18);color:#f8e8eb;text-decoration:none;font-size:13px}
footer{margin-top:34px;color:#7d5a6a;font-size:12px}@media(max-width:480px){main{padding-top:26px}}
</style></head><body><main><div class="brand"><i></i>叙梦 XUMENG · 分享卡片</div>
<p class="kicker">${escapeHtml(input.kindLabel)} · SHARE</p><h1>${heading}</h1>
<p class="meta">${author} 分享于叙梦</p>${cover}<article class="post">${body || description}</article>
<div class="cta"><a class="primary" href="https://xumengchat.top/?from=share">打开叙梦 · 开始创作</a><a class="ghost" href="https://xumengchat.top/?from=share">扫码入口见分享海报</a></div>
<footer>在叙梦，把想象变成作品。本页面为公开分享卡片，内容由分享者提供。</footer></main></body></html>`;
}

function shareNotFoundHtml(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分享卡片不存在 · 叙梦</title><meta name="robots" content="noindex"></head><body style="margin:0;background:#12080f;color:#f8e8eb;font:16px/1.8 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"><main style="max-width:560px;margin:0 auto;padding:64px 24px"><h1>分享卡片不存在或已删除</h1><p style="color:#c79aa9">这张卡片可能已过期，或链接不完整。</p><a href="https://xumengchat.top/" style="display:inline-flex;margin-top:18px;padding:12px 22px;border-radius:999px;background:#d94c77;color:#fff;text-decoration:none">打开叙梦</a></main></body></html>`;
}

/** Public, JS-free readable share page; social previews get title/description. */
export async function sharedCardPage(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  const upstream = await env.BACKEND.fetch(new URL(`/v1/shares/${encodeURIComponent(slug)}`, BACKEND_ORIGIN), {
    method: "GET", headers: { Accept: "application/json" }, signal: request.signal,
  }).catch(() => null);
  const payload = upstream && upstream.ok ? await upstream.json().catch(() => null) as { share?: Record<string, unknown> } | null : null;
  const share = payload?.share;
  if (!share || typeof share.title !== "string") return new Response(shareNotFoundHtml(), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  const title = `${share.title} · 叙梦分享`;
  const description = (typeof share.body === "string" ? share.body.replace(/\s+/g, " ").slice(0, 120) : "在叙梦留下的分享卡片");
  const author = typeof share.author === "string" ? share.author : "叙梦玩家";
  const kind = typeof share.kind === "string" ? share.kind : "game";
  const kindLabel = ({ game: "游戏", character: "角色", story: "故事", drama: "短剧" } as Record<string, string>)[kind] ?? "作品";
  const body = typeof share.body === "string" ? share.body : "";
  const cover = typeof share.coverUrl === "string" && share.coverUrl ? share.coverUrl : "";
  const html = sharedCardHtml({ title, heading: share.title, description, author, kindLabel, body, cover, slug });
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120, must-revalidate", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
}

/** 站内分发的 Android 测试包，放在 R2 MEDIA 里，避免大文件进构建产物。 */
export async function androidApkResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  if (!env.MEDIA) return json({ error: "安装包暂未发布。" }, 503);
  const object = await env.MEDIA.get("downloads/xumeng-android.apk");
  if (!object) return json({ error: "安装包暂未发布。" }, 404);
  const headers = new Headers({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": 'attachment; filename="xumeng-android.apk"',
    "Cache-Control": "public, max-age=300, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });
  if (object.size) headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

export async function shareCover(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "请求方法不支持。" }, 405, { Allow: "GET, HEAD" });
  const incoming = new URL(request.url);
  const upstream = xumengVideoCoverUpstream(incoming.searchParams.get("src"), incoming.searchParams.get("v"));
  if (!upstream) return json({ error: "封面地址无效。" }, 400);
  try {
    const remote = await fetch(upstream, { redirect: "manual", headers: { accept: "image/avif,image/webp,image/png,image/jpeg" } });
    if (!remote.ok) { await remote.body?.cancel(); return json({ error: "封面暂时读不出来。" }, 502); }
    const bytes = new Uint8Array(await remote.arrayBuffer());
    const type = bytes.byteLength <= XUMENG_SHARE_COVER_MAX_BYTES ? xumengShareCoverImageType(bytes) : null;
    if (!type) return json({ error: "封面暂时读不出来。" }, 502);
    const headers = new Headers({
      "content-type": type,
      "cache-control": "public, max-age=300, must-revalidate",
      "x-content-type-options": "nosniff",
      "content-length": String(bytes.byteLength),
    });
    return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
  } catch {
    return json({ error: "封面暂时读不出来。" }, 502);
  }
}
