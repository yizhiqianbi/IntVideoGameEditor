export const VIDEO_SITE = "https://video.xumengchat.top";

const PLAY_ID = /^hg-([0-9]{4,8})-([1-9][0-9]{0,3})$/;
const POSTER_KEY = /^posters\/huangguo\/([0-9]{4,8})\.(?:jpg|jpeg|png)$/;
const MEDIA_KEY = /^video\/huangguo\/([0-9]{4,8})\/ep-([0-9]{3})\.mp4$/;

export type PublicEpisode = {
  id: string;
  title: string;
  episode: string;
  category: string;
  pageUrl: string;
  posterUrl: string;
  contentUrl: string;
  updatedAt?: string;
};

type CatalogItem = {
  id?: unknown;
  title?: unknown;
  episode?: unknown;
  category?: unknown;
  posterKey?: unknown;
  mediaKey?: unknown;
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function lastmod(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString().slice(0, 10);
}

export function playIdFromPath(pathname: string): string | null {
  const match = /^\/play\/(hg-[0-9]{4,8}-[1-9][0-9]{0,3})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

export function publicEpisode(item: CatalogItem, updatedAt?: unknown): PublicEpisode | null {
  const id = typeof item.id === "string" ? item.id : "";
  const play = PLAY_ID.exec(id);
  const poster = typeof item.posterKey === "string" ? POSTER_KEY.exec(item.posterKey) : null;
  const media = typeof item.mediaKey === "string" ? MEDIA_KEY.exec(item.mediaKey) : null;
  if (!play || !poster || !media) return null;
  if (play[1] !== poster[1] || play[1] !== media[1] || Number(play[2]) !== Number(media[2])) return null;
  const title = clean(item.title, 80);
  if (!title) return null;
  return {
    id,
    title,
    episode: clean(item.episode, 20) || `第${String(Number(play[2])).padStart(2, "0")}集`,
    category: clean(item.category, 40) || "短剧",
    pageUrl: `${VIDEO_SITE}/play/${id}`,
    posterUrl: `${VIDEO_SITE}/media/${item.posterKey}`,
    contentUrl: `${VIDEO_SITE}/media/${item.mediaKey}?v=3`,
    updatedAt: lastmod(updatedAt),
  };
}

export function publicEpisodes(catalog: unknown): PublicEpisode[] {
  if (!catalog || typeof catalog !== "object" || !Array.isArray((catalog as { items?: unknown }).items)) return [];
  const updatedAt = (catalog as { updatedAt?: unknown }).updatedAt;
  const episodes: PublicEpisode[] = [];
  const seen = new Set<string>();
  for (const item of (catalog as { items: unknown[] }).items) {
    if (!item || typeof item !== "object") continue;
    const episode = publicEpisode(item as CatalogItem, updatedAt);
    if (!episode || seen.has(episode.id)) continue;
    seen.add(episode.id);
    episodes.push(episode);
    if (episodes.length >= 50_000) break;
  }
  return episodes;
}

export function videoRobotsTxt(): string {
  return [
    "# 叙梦短剧公开播放。剧集页可以引用，导入接口不公开。",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${VIDEO_SITE}/sitemap.xml`,
    "",
  ].join("\n");
}

function videoDescription(episode: PublicEpisode): string {
  return `${episode.episode}，${episode.category}。在叙梦短剧连续播放。`;
}

export function videoSitemapXml(catalog: unknown): string {
  const urls = publicEpisodes(catalog).map(episode => {
    const modified = episode.updatedAt ? `<lastmod>${episode.updatedAt}</lastmod>` : "";
    return `<url><loc>${escapeXml(episode.pageUrl)}</loc>${modified}<video:video><video:thumbnail_loc>${escapeXml(episode.posterUrl)}</video:thumbnail_loc><video:title>${escapeXml(episode.title)}</video:title><video:description>${escapeXml(videoDescription(episode))}</video:description><video:content_loc>${escapeXml(episode.contentUrl)}</video:content_loc><video:family_friendly>no</video:family_friendly></video:video></url>`;
  }).join("");
  const home = `<url><loc>${VIDEO_SITE}/</loc></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${home}${urls}</urlset>\n`;
}

export function playDocument(shell: string, episode: PublicEpisode): string {
  const title = `${episode.title} ${episode.episode}｜叙梦短剧`;
  const description = videoDescription(episode);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: episode.title,
    description,
    thumbnailUrl: episode.posterUrl,
    contentUrl: episode.contentUrl,
    embedUrl: episode.pageUrl,
    url: episode.pageUrl,
    inLanguage: "zh-CN",
    isFamilyFriendly: false,
    publisher: { "@type": "Organization", name: "叙梦短剧", url: `${VIDEO_SITE}/` },
  }).replace(/</g, "\\u003c");
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1" />`,
    `<link rel="canonical" href="${escapeHtml(episode.pageUrl)}" />`,
    `<meta property="og:type" content="video.other" />`,
    `<meta property="og:site_name" content="叙梦短剧" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(episode.pageUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(episode.posterUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(episode.posterUrl)}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join("");
  const stripped = shell
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+name="(?:description|robots)"[^>]*>/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>/gi, "")
    .replace(/<meta\s+property="og:[^"]+"[^>]*>/gi, "")
    .replace(/<meta\s+name="twitter:[^"]+"[^>]*>/gi, "")
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, "");
  return stripped.replace("</head>", `${tags}</head>`);
}
