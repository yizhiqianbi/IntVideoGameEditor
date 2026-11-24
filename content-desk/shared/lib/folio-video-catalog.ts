export const FOLIO_VIDEO_MEDIA_ORIGIN = "http://127.0.0.1:5174";
export const FOLIO_VIDEO_CATALOG_URL = `${FOLIO_VIDEO_MEDIA_ORIGIN}/catalog.json`;

const DRAMA_ID = /^hg-([0-9]{4,8})$/;
const ITEM_ID = /^hg-([0-9]{4,8})-([0-9]{1,3})$/;
const MEDIA_KEY = /^video\/stories\/([0-9]{4,8})\/ep-([0-9]{3})\.mp4$/;
const POSTER_KEY = /^posters\/stories\/([0-9]{4,8})\.(?:jpg|jpeg|png)$/;

export type FolioVideoEpisode = {
  id: string;
  dramaId: string;
  title: string;
  episode: string;
  mediaKey: string;
  posterKey: string;
  episodeNumber: number;
};

export type FolioVideoDrama = {
  dramaId: string;
  title: string;
  category: string;
  episodes: FolioVideoEpisode[];
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0") ? value.trim() : "";

export function isFolioVideoDramaId(value: string) {
  return DRAMA_ID.test(value);
}

export function folioVideoDramaIdFromRoute(route: string) {
  const path = route.startsWith("#") ? route.slice(1) : route;
  const dramaId = path.startsWith("videos/") ? path.slice("videos/".length) : "";
  return isFolioVideoDramaId(dramaId) ? dramaId : "";
}

/** Bumps the cached fragmented files to the faststart copies. */
export const FOLIO_VIDEO_MEDIA_REVISION = "3";

export function folioVideoMediaUrl(key: string) {
  const url = `${FOLIO_VIDEO_MEDIA_ORIGIN}/media/${key}`;
  return key.startsWith("video/") ? `${url}?v=${FOLIO_VIDEO_MEDIA_REVISION}` : url;
}

/** Covers are served separately from the long-lived video files so a replaced picture can show up. */
export function folioVideoPosterUrl(key: string) {
  return key.startsWith("posters/") ? `${FOLIO_VIDEO_MEDIA_ORIGIN}/covers/${key.slice("posters/".length)}?v=2` : folioVideoMediaUrl(key);
}

export function parseFolioVideoCatalog(value: unknown): FolioVideoDrama[] {
  if (!record(value) || !Array.isArray(value.items)) throw new Error("视频目录格式无效。");
  const groups = new Map<string, FolioVideoDrama>();
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

function videoHash32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Keep the reels feed fresh while making the same day's order stable for sharing and return visits. */
export function rankFolioVideoDramas(dramas: FolioVideoDrama[], day = new Date().toISOString().slice(0, 10)) {
  if (dramas.length < 2) return dramas.slice();
  const ids = dramas.map(item => Number(item.dramaId.replace(/^hg-/, ""))).filter(Number.isFinite);
  const minId = ids.length ? Math.min(...ids) : 0;
  const span = Math.max(1, (ids.length ? Math.max(...ids) : 0) - minId);
  return dramas.map((drama, index) => {
    const numericId = Number(drama.dramaId.replace(/^hg-/, ""));
    const recency = Number.isFinite(numericId) ? (numericId - minId) / span : 0.5;
    const exploration = videoHash32(`${day}:${drama.dramaId}:${drama.category}`) / 0xffffffff;
    const depth = Math.min(drama.episodes.length, 8) / 8;
    return { drama, index, score: recency * 0.28 + exploration * 0.57 + depth * 0.15 };
  }).sort((left, right) => right.score - left.score || left.index - right.index).map(item => item.drama);
}
