import { playDocument, playIdFromPath, publicEpisode, videoRobotsTxt, videoSitemapXml, type PublicEpisode } from "./discovery";
import { diversifyVideoItems, type VideoRecommendationItem } from "./recommendation";

export interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  IMPORT_TOKEN?: string;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

function mediaType(key: string) {
  const dot = key.lastIndexOf(".");
  return MIME[dot >= 0 ? key.slice(dot).toLowerCase() : ""] || "application/octet-stream";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

function parseRange(raw: string | null, size: number) {
  if (!raw || !raw.startsWith("bytes=") || raw.includes(",")) return null;
  const [startText, endText = ""] = raw.slice(6).split("-");
  if (!startText && !endText) return null;
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end, length: end - start + 1 };
}

const VIDEO_OBJECT = /^video\/huangguo\/([0-9]{4,8})\/ep-([0-9]{3})\.mp4$/;
const POSTER_OBJECT = /^posters\/huangguo\/([0-9]{4,8})\.(jpg|jpeg|png)$/;
const POSTER_RANK: Record<string, number> = { jpg: 0, jpeg: 1, png: 2 };

type DramaMeta = { id: string; title: string; category: string };

export function catalogFromMedia(meta: DramaMeta[], videoKeys: string[], posterKeys: string[], updatedAt: string) {
  const posters = new Map<string, string>();
  for (const key of posterKeys) {
    const match = POSTER_OBJECT.exec(key);
    if (!match) continue;
    const current = posters.get(match[1]);
    const currentRank = current ? POSTER_RANK[POSTER_OBJECT.exec(current)?.[2] || ""] ?? 9 : 9;
    if (!current || (POSTER_RANK[match[2]] ?? 9) < currentRank) posters.set(match[1], key);
  }
  const episodes = new Map<string, Set<number>>();
  for (const key of videoKeys) {
    const match = VIDEO_OBJECT.exec(key);
    if (!match) continue;
    const seriesId = match[1];
    if (!seriesId) continue;
    const episode = Number(match[2]);
    if (!Number.isInteger(episode) || episode < 1) continue;
    const owned = episodes.get(seriesId) ?? new Set<number>();
    owned.add(episode);
    episodes.set(seriesId, owned);
  }
  const items: VideoRecommendationItem[] = [];
  const dramas = meta.filter(drama => /^[0-9]{4,8}$/.test(drama.id) && drama.title).sort((a, b) => Number(b.id) - Number(a.id));
  for (const drama of dramas) {
    const posterKey = posters.get(drama.id);
    const owned = episodes.get(drama.id);
    if (!posterKey || !owned) continue;
    for (const episode of [...owned].sort((a, b) => b - a)) {
      const number = String(episode).padStart(2, "0");
      items.push({
        id: `hg-${drama.id}-${episode}`,
        dramaId: `hg-${drama.id}`,
        title: drama.title,
        episode: `第${number}集`,
        file: `hg-${drama.id}-${episode}.mp4`,
        mediaKey: `video/huangguo/${drama.id}/ep-${String(episode).padStart(3, "0")}.mp4`,
        posterKey,
        category: drama.category || "AI成人短剧",
        badge: "已导入",
        source: "黄果公开HLS授权导入",
      });
    }
  }
  return {
    brand: "叙梦短剧",
    updatedAt,
    categories: ["首页", "AI短剧", "漫剧", "专题", "排行榜", "最新"],
    items: diversifyVideoItems(items, updatedAt),
    importedCount: items.length,
    sourceDramaCount: new Set(items.map(item => item.dramaId)).size,
  };
}

async function listKeys(bucket: R2Bucket, prefix: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page += 1) {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of listed.objects) keys.push(object.key);
    if (!listed.truncated) return keys;
    cursor = listed.cursor;
  }
  return keys;
}

async function loadDramaMeta(request: Request, env: Env): Promise<DramaMeta[] | null> {
  const url = new URL(request.url);
  url.pathname = "/drama-meta.json";
  url.search = "";
  const response = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const body = await response.json() as { dramas?: unknown };
  if (!body || !Array.isArray(body.dramas)) return null;
  return body.dramas.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const category = typeof record.category === "string" ? record.category.trim() : "";
    return id && title ? [{ id, title: title.slice(0, 120), category: category.slice(0, 40) }] : [];
  });
}

async function serveCatalog(request: Request, env: Env) {
  const cacheKey = new Request(new URL("/catalog.json", request.url), { method: "GET" });
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      if (request.method === "HEAD") {
        await cached.body?.cancel();
        return new Response(null, { status: 200, headers });
      }
      return new Response(cached.body, { status: 200, headers });
    }
  } catch {
    // The cache API is unavailable in local unit runs.
  }
  try {
    const [meta, videoKeys, posterKeys] = await Promise.all([
      loadDramaMeta(request, env),
      listKeys(env.MEDIA, "video/huangguo/"),
      listKeys(env.MEDIA, "posters/huangguo/"),
    ]);
    if (!meta) return null;
    const catalog = catalogFromMedia(meta, videoKeys, posterKeys, new Date().toISOString());
    if (catalog.importedCount === 0) return null;
    const body = JSON.stringify(catalog);
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, must-revalidate",
      "x-content-type-options": "nosniff",
    });
    const cached = new Response(body, { status: 200, headers });
    try { await caches.default.put(cacheKey, cached.clone()); } catch { /* local unit runs have no default cache */ }
    if (request.method === "HEAD") {
      await cached.body?.cancel();
      return new Response(null, { status: 200, headers });
    }
    return cached;
  } catch {
    return null;
  }
}

const COVER_KEY = /^posters\/huangguo\/[0-9]{4,8}\.(?:jpg|jpeg|png|webp)$/;
export const MEDIA_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export function mediaCacheRequest(resource: string, range: string | null): Request {
  const cacheUrl = new URL(resource);
  cacheUrl.search = "";
  cacheUrl.hash = "";
  const normalized = range?.trim();
  if (normalized) cacheUrl.searchParams.set("range", normalized);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

export function mediaResponseCacheable(bytes: number): boolean {
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MEDIA_CACHE_MAX_BYTES;
}

function cachedMedia(request: Request, cached: Response): Response {
  const headers = new Headers(cached.headers);
  headers.set("x-xumeng-cache", "HIT");
  const status = headers.has("content-range") ? 206 : 200;
  if (request.method === "HEAD") {
    void cached.body?.cancel();
    return new Response(null, { status, headers });
  }
  return new Response(cached.body, { status, headers });
}

async function serveMedia(request: Request, env: Env, ctx: ExecutionContext, key: string, cacheControl = "public, max-age=3600") {
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
  const cacheKey = mediaCacheRequest(request.url, request.headers.get("range"));
  if (request.method === "GET" || request.method === "HEAD") {
    try {
      const cached = await caches.default.match(cacheKey);
      if (cached) return cachedMedia(request, cached);
    } catch {
      // The cache API is unavailable in local unit runs.
    }
  }
  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const range = parseRange(request.headers.get("range"), head.size);
  const object = await env.MEDIA.get(key, range ? { range: { offset: range.start, length: range.length } } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "content-type": head.httpMetadata?.contentType || mediaType(key),
    "cache-control": cacheControl,
    "accept-ranges": "bytes",
    "etag": head.httpEtag,
    "content-disposition": "inline",
    "x-xumeng-cache": "MISS",
  });
  const bytes = range ? range.length : head.size;
  if (range) {
    headers.set("content-length", String(range.length));
    headers.set("content-range", `bytes ${range.start}-${range.end}/${head.size}`);
  } else {
    headers.set("content-length", String(head.size));
  }
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const client = new Response(object.body, { status, headers });
  if (mediaResponseCacheable(bytes)) {
    const branch = client.clone();
    ctx.waitUntil(caches.default.put(cacheKey, new Response(branch.body, { status: 200, headers: branch.headers })).catch(() => {}));
  }
  return client;
}

function authorizedImport(request: Request, env: Env) {
  return Boolean(env.IMPORT_TOKEN) && request.headers.get("x-import-token") === env.IMPORT_TOKEN;
}

async function multipartImport(request: Request, env: Env, url: URL) {
  if (!authorizedImport(request, env)) return new Response("Unauthorized", { status: 401 });
  if (url.pathname === "/api/import/multipart/start" && request.method === "POST") {
    const body = await request.json<{ key?: string; contentType?: string }>();
    const key = body.key || "";
    if (!key || key.includes("..")) return json({ error: "invalid key" }, 400);
    const upload = await env.MEDIA.createMultipartUpload(key, {
      httpMetadata: { contentType: body.contentType || mediaType(key) },
      customMetadata: { importedBy: "authorized-import" },
    });
    return json({ key, uploadId: upload.uploadId });
  }
  if (url.pathname === "/api/import/multipart/part" && request.method === "PUT") {
    const key = request.headers.get("x-key") || "";
    const uploadId = request.headers.get("x-upload-id") || "";
    const partNumber = Number(request.headers.get("x-part-number"));
    if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || !request.body) return json({ error: "invalid part" }, 400);
    const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber, etag: part.etag });
  }
  if (url.pathname === "/api/import/multipart/complete" && request.method === "POST") {
    const body = await request.json<{ key?: string; uploadId?: string; parts?: Array<{ partNumber: number; etag: string }> }>();
    if (!body.key || !body.uploadId || !body.parts?.length) return json({ error: "invalid completion" }, 400);
    const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
    await upload.complete(body.parts);
    return json({ ok: true, key: body.key });
  }
  if (url.pathname === "/api/import/multipart/abort" && request.method === "POST") {
    const body = await request.json<{ key?: string; uploadId?: string }>();
    if (!body.key || !body.uploadId) return json({ error: "invalid abort" }, 400);
    const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
    await upload.abort();
    return json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

function textDocument(request: Request, body: string, contentType: string): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function loadCatalog(request: Request, env: Env): Promise<{ updatedAt?: unknown; items?: unknown[] } | null> {
  const catalogUrl = new URL(request.url);
  catalogUrl.pathname = "/catalog.json";
  catalogUrl.search = "";
  const response = await serveCatalog(new Request(catalogUrl, { method: "GET" }), env);
  if (!response) return null;
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  return response.json() as Promise<{ updatedAt?: unknown; items?: unknown[] }>;
}

async function servePlay(request: Request, env: Env, id: string): Promise<Response> {
  const catalog = await loadCatalog(request, env);
  const items = catalog?.items ?? [];
  let episode: PublicEpisode | null = null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const candidate = publicEpisode(item as { id?: unknown; title?: unknown; episode?: unknown; category?: unknown; posterKey?: unknown; mediaKey?: unknown }, catalog?.updatedAt);
    if (candidate?.id === id) {
      episode = candidate;
      break;
    }
  }
  if (!episode) return new Response("这一集不存在。", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  const shellUrl = new URL(request.url);
  shellUrl.pathname = "/index.html";
  shellUrl.search = "";
  const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
  if (!shell.ok || !shell.headers.get("content-type")?.includes("text/html")) {
    await shell.body?.cancel();
    return new Response("播放页暂时不可用。", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const html = playDocument(await shell.text(), episode);
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true, service: "xumeng-video", media: "r2", host: url.host });
    if (url.pathname.startsWith("/api/import/multipart/")) return multipartImport(request, env, url);
    if (url.pathname.startsWith("/covers/")) {
      const key = `posters/${decodeURIComponent(url.pathname.slice("/covers/".length))}`;
      if (!COVER_KEY.test(key)) return new Response("Not found", { status: 404 });
      return serveMedia(request, env, ctx, key, "public, max-age=60, must-revalidate");
    }
    if (url.pathname.startsWith("/media/")) return serveMedia(request, env, ctx, decodeURIComponent(url.pathname.slice("/media/".length)));
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/catalog.json") {
      const catalog = await serveCatalog(request, env);
      if (catalog) return catalog;
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/robots.txt") return textDocument(request, videoRobotsTxt(), "text/plain; charset=utf-8");
    if (url.pathname === "/sitemap.xml") {
      const catalog = await loadCatalog(request, env);
      if (!catalog) return new Response("站点地图暂时不可用。", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      return textDocument(request, videoSitemapXml(catalog), "application/xml; charset=utf-8");
    }
    const playId = playIdFromPath(url.pathname);
    if (playId) return servePlay(request, env, playId);
    return env.ASSETS.fetch(request);
  },
};
