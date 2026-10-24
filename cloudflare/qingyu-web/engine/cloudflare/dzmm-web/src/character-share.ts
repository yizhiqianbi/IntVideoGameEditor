import { CHARACTER_SHARE_INDEX, type CharacterShareRecord } from "./character-share-index";

const SITE = "https://qingyu.invalid";
const BACKEND = "https://qingyu-backend.internal";
const SHARE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const PUBLICATION_ID = /^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PUBLISHED_COVER = /^\/api\/dzmm\/backend\/v1\/publishing\/media\/(published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([1-9]\d{0,8})\/cover$/;
const LOCAL_COVER = /^\/(?:assets\/xumeng\/|dzmm\/)((?:covers\/\d{1,120}|exported-cards\/foreverse-[a-z0-9-]+-cover)\.(?:png|jpe?g))$/i;
const SUFFIX = " - AI角色聊天";

type ShareFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type ShareImage = { url: string; type: "image/jpeg" | "image/png"; width: number; height: number };
type ShareCard = CharacterShareRecord & ShareImage;

const byId = new Map(CHARACTER_SHARE_INDEX.map(card => [card.id, card]));

export function characterShareLocations(): string[] {
  return CHARACTER_SHARE_INDEX.map(card => `${SITE}/c/${card.id}`);
}

export function shareTitle(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim() || "晴屿角色";
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
  if (!chosen) return "在晴屿里和这个角色聊天。";
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

export function renderCharacterSharePage(card: ShareCard): string {
  const page = `${SITE}/c/${card.id}`;
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const image = escapeHtml(card.url);
  const open = `/#character/${card.id}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${page}" />
    <meta property="og:type" content="website" />
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
  </head>
  <body>
    <a href="${open}"><img src="${image}" alt="${title}" width="${card.width}" height="${card.height}" /></a>
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
  let next = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  next = next.replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/i, `$1${page}$2`);
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
  ] as const) next = setMeta(next, attribute, key, content);
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
  return { ...card, url: `${SITE}/assets/qingyu/share/${id}.jpg`, type: "image/jpeg", width: 1200, height: 630 };
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
  | { kind: "backend"; path: string; absolute: string }
  | { kind: "asset"; path: string; absolute: string }
  | { kind: "remote"; absolute: string };

export function shareImagePlan(cover: string, publicationId: string): ImagePlan | null {
  const published = PUBLISHED_COVER.exec(cover);
  if (published && published[1] === publicationId) {
    const path = `/v1/publishing/media/${published[1]}/${published[2]}/cover`;
    return { kind: "backend", path, absolute: `${SITE}/api/backend${path}` };
  }
  const local = LOCAL_COVER.exec(cover);
  if (local) {
    const relative = local[1].toLowerCase();
    return { kind: "asset", path: `/assets/qingyu/${relative}`, absolute: `${SITE}/assets/qingyu/${relative}` };
  }
  let remote: URL;
  try { remote = new URL(cover); } catch { return null; }
  if (remote.protocol !== "https:" || remote.username || remote.password || remote.port) return null;
  if (remote.hostname !== "pxlorbit.com" && remote.hostname !== "qingyu.invalid") return null;
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
  return { url: plan.absolute, ...size };
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
  if (!character || typeof character.name !== "string" || typeof character.cover !== "string") return null;
  const description = typeof character.description === "string" ? character.description : "";
  const plan = shareImagePlan(character.cover, id);
  const image = plan ? await loadShareImage(env, plan) : null;
  if (!image) return null;
  return { id, title: shareTitle(character.name), description: shareDescription(description), ...image };
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
