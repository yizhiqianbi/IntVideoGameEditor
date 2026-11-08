/** Homepage cards use the same rendition DZMM requests: width 600, WebP, quality 75, no enlargement. */
export const XUMENG_CARD_COVER_WIDTH = 600;
export const XUMENG_CARD_COVER_QUALITY = 75;

const PUBLISHED_SLOT = /^(cover|gallery-\d+)(-card)?$/;
const PUBLISHED_CARD_PATH = /^(.*\/publishing\/media\/[^/]+\/\d+\/(?:cover|gallery-\d+))$/;

export function publishedMediaSlot(slot: string): { name: string; card: boolean } | null {
  const match = PUBLISHED_SLOT.exec(slot);
  if (!match) return null;
  return { name: match[1], card: match[2] === "-card" };
}

export function publishedCardObjectKey(originalKey: string): string {
  return `${originalKey}.card.webp`;
}

/** Shelf and hero URLs ask for the washed file. The stored original is unchanged. */
export function xumengPublishedCoverCardUrl(value: string): string {
  const hash = value.indexOf("#");
  const bare = hash >= 0 ? value.slice(0, hash) : value;
  const query = bare.indexOf("?");
  const path = query >= 0 ? bare.slice(0, query) : bare;
  const match = PUBLISHED_CARD_PATH.exec(path);
  if (!match) return value;
  return `${match[1]}-card${bare.slice(path.length)}${hash >= 0 ? value.slice(hash) : ""}`;
}
