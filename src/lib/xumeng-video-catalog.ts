export const XUMENG_VIDEO_MEDIA_ORIGIN = "https://video.xumengchat.top";
export const XUMENG_VIDEO_CATALOG_URL = `${XUMENG_VIDEO_MEDIA_ORIGIN}/catalog.json`;

const DRAMA_ID = /^hg-([0-9]{4,8})$/;
const ITEM_ID = /^hg-([0-9]{4,8})-([0-9]{1,3})$/;
const MEDIA_KEY = /^video\/huangguo\/([0-9]{4,8})\/ep-([0-9]{3})\.mp4$/;
const POSTER_KEY = /^posters\/huangguo\/([0-9]{4,8})\.(?:jpg|jpeg|png)$/;

export type XumengVideoEpisode = {
  id: string;
  dramaId: string;
  title: string;
  episode: string;
  mediaKey: string;
  posterKey: string;
  episodeNumber: number;
};

export type XumengVideoDrama = {
  dramaId: string;
  title: string;
  category: string;
  episodes: XumengVideoEpisode[];
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0") ? value.trim() : "";

export function isXumengVideoDramaId(value: string) {
  return DRAMA_ID.test(value);
}

export function xumengVideoDramaIdFromRoute(route: string) {
  const path = route.startsWith("#") ? route.slice(1) : route;
  const dramaId = path.startsWith("videos/") ? path.slice("videos/".length) : "";
  return isXumengVideoDramaId(dramaId) ? dramaId : "";
}

/** Bumps the cached fragmented files to the faststart copies. */
export const XUMENG_VIDEO_MEDIA_REVISION = "3";

export function xumengVideoMediaUrl(key: string) {
  const url = `${XUMENG_VIDEO_MEDIA_ORIGIN}/media/${key}`;
  return key.startsWith("video/") ? `${url}?v=${XUMENG_VIDEO_MEDIA_REVISION}` : url;
}

/** Covers are served separately from the long-lived video files so a replaced picture can show up. */
export function xumengVideoPosterUrl(key: string) {
  return key.startsWith("posters/") ? `${XUMENG_VIDEO_MEDIA_ORIGIN}/covers/${key.slice("posters/".length)}?v=2` : xumengVideoMediaUrl(key);
}

export function parseXumengVideoCatalog(value: unknown): XumengVideoDrama[] {
  if (!record(value) || !Array.isArray(value.items)) throw new Error("视频目录格式无效。");
  const groups = new Map<string, XumengVideoDrama>();
  for (const item of value.items) {
    if (!record(item)) continue;
    const id = text(item.id, 24);
    const dramaId = text(item.dramaId, 16);
    const title = text(item.title, 120);
    const episode = text(item.episode, 40);
    const mediaKey = text(item.mediaKey, 80);
    const posterKey = text(item.posterKey, 80);
    const category = text(item.category, 40);
    const dramaMatch = DRAMA_ID.exec(dramaId);
    const itemMatch = ITEM_ID.exec(id);
    const mediaMatch = MEDIA_KEY.exec(mediaKey);
    const posterMatch = POSTER_KEY.exec(posterKey);
    if (!dramaMatch || !itemMatch || !mediaMatch || !posterMatch || !title || !episode) continue;
    const seriesId = dramaMatch[1];
    if (itemMatch[1] !== seriesId || mediaMatch[1] !== seriesId || posterMatch[1] !== seriesId) continue;
    const current = groups.get(dramaId) ?? { dramaId, title, category, episodes: [] };
    if (!current.category && category) current.category = category;
    if (!current.episodes.some(existing => existing.mediaKey === mediaKey)) {
      current.episodes.push({ id, dramaId, title, episode, mediaKey, posterKey, episodeNumber: Number(mediaMatch[2]) });
    }
    groups.set(dramaId, current);
  }
  return [...groups.values()].map(drama => ({
    ...drama,
    episodes: [...drama.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber || a.id.localeCompare(b.id)),
  }));
}
