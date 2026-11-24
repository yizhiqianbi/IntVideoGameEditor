import { folioPublishedCoverCardUrl } from "./folio-cover-rendition";

/** Keep saved cards and source evidence intact while serving our public routes. */
const CARD_COVER = /^(.*\/(?:exported-cards\/[a-z0-9-]+-cover|user-cards\/[0-9]{8}\/[a-z0-9][a-z0-9-]{0,79}))\.png$/i;

export const FOLIO_FALLBACK_COVER = "/assets/desk/brand/placeholder.svg";

export function folioImageUrl(value: string): string {
  if (value.startsWith("/shelf/")) return `/assets/desk/${value.slice("/shelf/".length)}`;
  if (value.startsWith("/api/shelf/backend/")) return `/api/backend/${value.slice("/api/shelf/backend/".length)}`;
  return value;
}

/** Card and hero surfaces use the washed file. The original remains stored. */
export function folioCardCoverUrl(value: string): string {
  const url = folioImageUrl(value);
  const path = url.split(/[?#]/, 1)[0];
  const match = CARD_COVER.exec(path);
  if (match) return `${match[1]}-card.jpg${url.slice(path.length)}`;
  return folioPublishedCoverCardUrl(url);
}

/** A missing washed file retries the original once. A second miss uses the placeholder. */
export function folioCoverMissUrl(failed: string, original: string): string {
  let failedPath = failed.split(/[?#]/, 1)[0];
  try { failedPath = new URL(failed, "https://contentdesk.local").pathname; } catch { /* Already a path. */ }
  const source = folioImageUrl(original).split(/[?#]/, 1)[0];
  if (source && source !== FOLIO_FALLBACK_COVER && failedPath !== source
    && (failedPath.endsWith("-card") || failedPath.endsWith("-card.jpg"))) return source;
  return FOLIO_FALLBACK_COVER;
}
