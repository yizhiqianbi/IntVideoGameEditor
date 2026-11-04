import { xumengPublicTailHtml } from "../../../src/lib/xumeng-public-tail";
import { CHARACTER_SHARE_INDEX, type CharacterShareRecord } from "./character-share-index";

const SITE = "https://xumengchat.top";
const BACKEND = "https://dzmm-backend.850587960.workers.dev";
const SHARE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const PUBLICATION_ID = /^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PUBLISHED_COVER = /^\/api\/dzmm\/backend\/v1\/publishing\/media\/(published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([1-9]\d{0,8})\/cover$/;
const LOCAL_COVER = /^\/(?:assets\/xumeng\/|dzmm\/)((?:covers\/\d{1,120}|exported-cards\/foreverse-[a-z0-9-]+-cover)\.(?:png|jpe?g))$/i;
const SUFFIX = " - AI角色聊天";

type ShareFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type ShareImage = { url: string; type: "image/jpeg" | "image/png"; width: number; height: number };
type ShareCard = CharacterShareRecord & ShareImage;

const byId = new Map(CHARACTER_SHARE_INDEX.map(card => [card.id, card]));
const BRAND_SHARE_IMAGE: ShareImage = {
  url: `${SITE}/assets/xumeng/brand/xumeng-icon-512.png`,
  type: "image/png",
  width: 512,
  height: 512,
};

export function characterShareLocations(): string[] {
  return CHARACTER_SHARE_INDEX.map(card => `${SITE}/c/${card.id}`);
}

// Keep the answer-engine entrypoint intentionally small and human-curated. It
// describes only public, general-audience cards and never exposes private
// conversations, account data, or the full imported card payload.
const GEO_FEATURED_IDS = [
  "xumeng-foreverse-peiyu",
  "xumeng-foreverse-tangtuantuan",
  "xumeng-foreverse-wangushi",
  "xumeng-foreverse-shenyan",
  "xumeng-foreverse-huoyushen",
  "xumeng-foreverse-jiwenqing",
  "xumeng-foreverse-songzhixia",
  "xumeng-foreverse-jiangchiye",
] as const;

export function characterShareGEOEntries(): readonly CharacterShareRecord[] {
  return GEO_FEATURED_IDS
    .map(id => byId.get(id))
    .filter((card): card is CharacterShareRecord => Boolean(card));
}

export function shareTitle(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim() || "叙梦角色";
  const chars = [...clean];
  if (clean.endsWith(SUFFIX)) return chars.slice(0, 70).join("");
  const room = 70 - [...SUFFIX].length;
  const trimmed = chars.length > room ? `${chars.slice(0, room - 1).join("").trimEnd()}…` : clean;
  return trimmed + SUFFIX;
}

export function shareDescription(raw: string): string {
  const text = raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"");
  const labeled = text.match(/简介[:：]\s*([^\n]{8,220})/);
  const bracket = text.match(/【简介】\s*([\s\S]{8,500}?)(?=\n\s*\n|【|$)/);
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[。！？])\s*/).map(part => part.trim()).filter(part => part && !/^(?:第一次|v\d|\d+[、.．]|完成了|注意积分|修复了|修改了|顺带)/.test(part));
  const start = Math.max(0, sentences.findIndex(sentence => [...sentence].length >= 24));
  const story = sentences.slice(start).join("");
  let chosen = (labeled?.[1] ?? bracket?.[1] ?? story).replace(/\s+/g, " ").trim();
  chosen = chosen.replace(/^【[^】]{0,40}】\s*/, "");
  if (!chosen) return "在叙梦里和这个角色聊天。";
  const chars = [...chosen];
  if (chars.length <= 150) return chosen;
  const cut = chars.slice(0, 150).join("");
  for (const mark of ["。", "！", "？"]) {
    const index = cut.lastIndexOf(mark);
    if (index >= 40) return cut.slice(0, index + mark.length);
  }
  return `${chars.slice(0, 149).join("").replace(/[，、；：\s]+$/u, "")}…`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function structuredData(card: ShareCard): string {
  const page = `${SITE}/c/${card.id}`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${page}#webpage`,
    name: card.title,
    description: card.description,
    url: page,
    inLanguage: "zh-CN",
    isPartOf: { "@type": "WebSite", "@id": `${SITE}/#website`, name: "叙梦", url: `${SITE}/` },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "叙梦", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "公开角色", item: `${SITE}/characters` },
        { "@type": "ListItem", position: 3, name: card.title, item: page },
      ],
    },
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", "article p"] },
    mainEntity: {
      "@type": "CreativeWork",
      "@id": `${page}#character-card`,
      name: card.title,
      description: card.description,
      image: card.url,
      url: page,
      inLanguage: "zh-CN",
      genre: "互动角色卡",
      isAccessibleForFree: true,
      isPartOf: { "@id": `${SITE}/#website` },
      publisher: { "@type": "Organization", name: "叙梦", url: `${SITE}/` },
    },
  }).replace(/<\//g, "<\\/");
}

function characterSummary(card: ShareCard): string {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const open = `/#character/${card.id}`;
  return `<article><nav aria-label="面包屑"><a href="/">叙梦</a> · <a href="/characters">公开角色</a></nav><h1>${title}</h1><p>${description}</p><p>这是叙梦（XUMENG）的公开角色卡摘要。私人会话、账号信息、余额与未公开内容不会出现在本页。</p><p><a id="xumeng-share-open" href="${open}">在叙梦开始角色互动</a> · <a href="/characters">更多公开角色</a></p></article>`;
}

export function renderCharacterSharePage(card: ShareCard): string {
  const page = `${SITE}/c/${card.id}`;
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const image = escapeHtml(card.url);
  const open = `/#character/${card.id}`;
  const jsonLd = structuredData(card);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <link rel="canonical" href="${page}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="叙梦" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:url" content="${page}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:type" content="${card.type}" />
    <meta property="og:image:width" content="${card.width}" />
    <meta property="og:image:height" content="${card.height}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />
    <style>
      html, body { margin: 0; min-height: 100%; background: #07070b; color: #f4efe8; font: 16px/1.5 system-ui, sans-serif; }
      a { color: inherit; }
      img { display: block; width: 100%; height: auto; }
    </style>
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body>
    <main>
      <a href="${open}"><img src="${image}" alt="${title}" width="${card.width}" height="${card.height}" /></a>
      <div style="padding:24px 20px;max-width:760px;margin:0 auto">${characterSummary(card)}</div>
    </main>
    <footer style="max-width:760px;margin:0 auto;padding:0 20px 32px;font:14px/1.7 system-ui,sans-serif">${xumengPublicTailHtml()}</footer>
    <script>
      (function () {
        var params = new URLSearchParams(location.search);
        var invite = (params.get("invite") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
        if (invite.length < 6) return;
        var next = new URLSearchParams();
        next.set("invite", invite);
        next.set("from", "character");
        var links = document.querySelectorAll("a[href*='#character/']");
        for (var index = 0; index < links.length; index += 1) {
          var href = links[index].getAttribute("href") || "";
          var id = href.split("/").pop() || "";
          links[index].setAttribute("href", "/?" + next.toString() + "#character/" + id);
        }
      })();
    </script>
  </body>
</html>
`;
}

function setMeta(html: string, attribute: "property" | "name", key: string, content: string): string {
  const pattern = new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*("\\s*/?>)`, "i");
  if (pattern.test(html)) return html.replace(pattern, (_match, start: string, end: string) => `${start}${content}${end}`);
  return html.replace("</head>", `    <meta ${attribute}="${key}" content="${content}" />\n  </head>`);
}

/** Put the character card on the real app shell so the address bar can stay /c/id. */
export function applyCharacterShareTags(html: string, card: ShareCard): string {
  const page = `${SITE}/c/${card.id}`;
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const image = escapeHtml(card.url);
  const jsonLd = structuredData(card);
  let next = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  next = next.replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/i, `$1${page}$2`);
  next = next.replace(/(<link\s+rel="alternate"\s+hreflang="(?:zh-CN|x-default)"\s+href=")[^"]*("\s*\/?>)/gi, `$1${page}$2`);
  next = next.replace(/(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/?>)/i, `$1${page}$2`);
  for (const [attribute, key, content] of [
    ["name", "description", description],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:image", image],
    ["property", "og:image:type", card.type],
    ["property", "og:image:width", String(card.width)],
    ["property", "og:image:height", String(card.height)],
    ["property", "og:image:alt", title],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
    ["name", "twitter:image:alt", title],
    ["name", "robots", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"],
  ] as const) next = setMeta(next, attribute, key, content);
  next = next.replace(/\s*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/gi, "");
  next = next.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  next = next.replace("</head>", `    <script type="application/ld+json">${jsonLd}</script>\n  </head>`);
  const fallback = `<noscript><main style="max-width:760px;margin:0 auto;padding:32px 20px;font:16px/1.7 system-ui,sans-serif">${characterSummary(card)}</main></noscript>`;
  next = next.replace("</body>", `${fallback}\n  </body>`);
  return next;
}

export function readImageSize(bytes: Uint8Array): { type: "image/jpeg" | "image/png"; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = readUint32(bytes, 16);
    const height = readUint32(bytes, 20);
    return width > 0 && height > 0 ? { type: "image/png", width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { type: "image/jpeg", width, height } : null;
    }
    offset += length;
  }
  return null;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function catalogCard(id: string): ShareCard | null {
  const card = byId.get(id);
  if (!card) return null;
  return { ...card, url: `${SITE}/assets/xumeng/share/${id}.jpg`, type: "image/jpeg", width: 1200, height: 630 };
}

function htmlResponse(request: Request, html: string, cacheSeconds: number): Response {
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function textResponse(request: Request, status: number, message: string): Response {
  return new Response(request.method === "HEAD" ? null : message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type ImagePlan =
  | { kind: "backend"; path: string; publicationId: string; revision: string }
  | { kind: "asset"; path: string; absolute: string }
  | { kind: "remote"; absolute: string };

// Twitterbot will not fetch /api/ (robots.txt disallows it), rejects image URLs
// with no file extension, and gives up when HEAD is not 200. Catalog cards already
// live at /assets/xumeng/share/*.jpg. Published covers use that same directory.
function crawlableCoverUrl(plan: Extract<ImagePlan, { kind: "backend" }>, type: ShareImage["type"]): string {
  const extension = type === "image/png" ? "png" : "jpg";
  return `${SITE}/assets/xumeng/share/${plan.publicationId}-${plan.revision}.${extension}`;
}

export function shareImagePlan(cover: string, publicationId: string): ImagePlan | null {
  const published = PUBLISHED_COVER.exec(cover);
  if (published && published[1] === publicationId) {
    return {
      kind: "backend",
      path: `/v1/publishing/media/${published[1]}/${published[2]}/cover`,
      publicationId: published[1],
      revision: published[2],
    };
  }
  const local = LOCAL_COVER.exec(cover);
  if (local) {
    const relative = local[1].toLowerCase();
    return { kind: "asset", path: `/assets/xumeng/${relative}`, absolute: `${SITE}/assets/xumeng/${relative}` };
  }
  let remote: URL;
  try { remote = new URL(cover); } catch { return null; }
  if (remote.protocol !== "https:" || remote.username || remote.password || remote.port) return null;
  if (remote.hostname !== "pxlorbit.com" && remote.hostname !== "xumengchat.top") return null;
  if (!/\.(?:png|jpe?g)$/i.test(remote.pathname)) return null;
  return { kind: "remote", absolute: remote.href };
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    total += step.value.byteLength;
  }
  await reader.cancel();
  const bytes = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, bytes.byteLength - offset);
    bytes.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= bytes.byteLength) break;
  }
  return bytes;
}

async function loadShareImage(env: { ASSETS: ShareFetcher; BACKEND: ShareFetcher }, plan: ImagePlan): Promise<ShareImage | null> {
  const response = plan.kind === "backend"
    ? await env.BACKEND.fetch(new Request(`${BACKEND}${plan.path}`, { method: "GET", redirect: "manual" }))
    : plan.kind === "asset"
      ? await env.ASSETS.fetch(new Request(`${SITE}${plan.path}`, { method: "GET", redirect: "manual" }))
      : await fetch(plan.absolute, { method: "GET", redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await readLimited(response, 512 * 1024);
  const size = bytes ? readImageSize(bytes) : null;
  if (!size || size.width > 8000 || size.height > 8000) return null;
  return { url: plan.kind === "backend" ? crawlableCoverUrl(plan, size.type) : plan.absolute, ...size };
}

function imageMediaType(header: string | null): ShareImage["type"] | null {
  const value = header?.split(";", 1)[0].trim().toLowerCase();
  if (value === "image/png") return "image/png";
  if (value === "image/jpeg" || value === "image/jpg") return "image/jpeg";
  return null;
}

export async function characterShareCoverResponse(request: Request, env: { BACKEND: ShareFetcher }, id: string, revision: string, extension: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "请求方法不支持。" }), {
      status: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (!PUBLICATION_ID.test(id) || !/^[1-9]\d{0,8}$/.test(revision)) return textResponse(request, 404, "图片不存在。");
  const expected = extension.toLowerCase() === "png" ? "image/png" : extension.toLowerCase() === "jpg" || extension.toLowerCase() === "jpeg" ? "image/jpeg" : null;
  if (!expected) return textResponse(request, 404, "图片不存在。");
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND}/v1/publishing/media/${id}/${revision}/cover`, {
    method: "GET", redirect: "manual",
  }));
  const type = imageMediaType(upstream.headers.get("Content-Type"));
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    const missing = upstream.status === 404;
    return textResponse(request, missing ? 404 : 502, missing ? "图片不存在。" : "图片暂时不可用。");
  }
  if (type !== expected) {
    await upstream.body.cancel();
    return textResponse(request, 404, "图片不存在。");
  }
  const headers = new Headers({
    "Content-Type": expected,
    "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("Content-Length");
  if (length && /^\d{1,10}$/.test(length)) headers.set("Content-Length", length);
  const etag = upstream.headers.get("etag");
  if (etag && /^(?:W\/)?"[!#-~]{1,128}"$/.test(etag)) headers.set("ETag", etag);
  if (request.method === "HEAD") {
    await upstream.body.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(upstream.body, { status: 200, headers });
}

async function publishedCard(env: { ASSETS: ShareFetcher; BACKEND: ShareFetcher }, id: string): Promise<ShareCard | null> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND}/v1/publishing/catalog/${id}`, {
    method: "GET", headers: { Accept: "application/json" }, redirect: "manual",
  }));
  if (upstream.status === 404) {
    await upstream.body?.cancel();
    return null;
  }
  if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
    await upstream.body?.cancel();
    throw new Error("catalog unavailable");
  }
  const payload = await upstream.json() as { character?: { name?: unknown; description?: unknown; cover?: unknown } };
  const character = payload.character;
  if (!character || typeof character.name !== "string" || !character.name.trim()) return null;
  const description = typeof character.description === "string" ? character.description : "";
  const cover = typeof character.cover === "string" ? character.cover : "";
  const plan = cover ? shareImagePlan(cover, id) : null;
  const image = plan ? await loadShareImage(env, plan) : null;
  // The card is public even when its cover is on a host this page will not fetch.
  // The app shell loads that cover itself; the preview falls back to the brand mark.
  return { id, title: shareTitle(character.name), description: shareDescription(description), ...(image ?? BRAND_SHARE_IMAGE) };
}

export async function characterShareResponse(request: Request, env: { ASSETS: ShareFetcher; BACKEND: ShareFetcher }, id: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "请求方法不支持。" }), {
      status: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (!SHARE_ID.test(id)) return textResponse(request, 404, "角色不存在。");
  const listed = catalogCard(id);
  if (listed) return shareDocument(request, env, listed);
  if (!PUBLICATION_ID.test(id)) return textResponse(request, 404, "角色不存在。");
  try {
    const published = await publishedCard(env, id);
    if (!published) return textResponse(request, 404, "角色不存在。");
    return shareDocument(request, env, published);
  } catch {
    return textResponse(request, 503, "角色页面暂时不可用。");
  }
}

async function shareDocument(request: Request, env: { ASSETS: ShareFetcher }, card: ShareCard): Promise<Response> {
  const shellUrl = new URL(request.url);
  shellUrl.pathname = "/";
  shellUrl.search = "";
  shellUrl.hash = "";
  const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
  const type = shell.headers.get("Content-Type") ?? "";
  if (!shell.ok || !type.includes("text/html")) {
    await shell.body?.cancel();
    return htmlResponse(request, renderCharacterSharePage(card), 60);
  }
  const html = applyCharacterShareTags(await shell.text(), card);
  return htmlResponse(request, html, 300);
}
