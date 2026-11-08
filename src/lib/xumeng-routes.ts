import { xumengPublishedCoverCardUrl } from "./xumeng-cover-rendition";

/** Keep saved cards and source evidence intact while serving our public routes. */
const CARD_COVER = /^(.*\/(?:exported-cards\/foreverse-[a-z0-9-]+-cover|user-cards\/20261024\/[a-z0-9][a-z0-9-]{0,79}))\.png$/i;

export const XUMENG_FALLBACK_COVER = "/assets/xumeng/brand/xumeng-character-placeholder.svg";

export function xumengImageUrl(value: string): string {
  if (value.startsWith("/dzmm/")) return `/assets/xumeng/${value.slice("/dzmm/".length)}`;
  if (value.startsWith("/api/dzmm/backend/")) return `/api/backend/${value.slice("/api/dzmm/backend/".length)}`;
  return value;
}

/** Card and hero surfaces use the washed file. The original remains stored. */
export function xumengCardCoverUrl(value: string): string {
  const url = xumengImageUrl(value);
  const path = url.split(/[?#]/, 1)[0];
  const match = CARD_COVER.exec(path);
  if (match) return `${match[1]}-card.jpg${url.slice(path.length)}`;
  return xumengPublishedCoverCardUrl(url);
}

/** A missing washed file retries the original once. A second miss uses the placeholder. */
export function xumengCoverMissUrl(failed: string, original: string): string {
  let failedPath = failed.split(/[?#]/, 1)[0];
  try { failedPath = new URL(failed, "https://xumengchat.top").pathname; } catch { /* Already a path. */ }
  const source = xumengImageUrl(original).split(/[?#]/, 1)[0];
  if (source && source !== XUMENG_FALLBACK_COVER && failedPath !== source
    && (failedPath.endsWith("-card") || failedPath.endsWith("-card.jpg"))) return source;
  return XUMENG_FALLBACK_COVER;
}
