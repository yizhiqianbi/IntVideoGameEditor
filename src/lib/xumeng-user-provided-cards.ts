import suppliedRecords from "./xumeng-user-provided-cards-metadata.json";

/** Shelf manifest only. The playable card body loads with the deferred catalog. */
export type XumengUserProvidedCardRecord = {
  id: string; slug: string; author: string; createdAt: string; version: string;
  changes: string; compatibilityNotes: string[];
  downloadUrl: string; pngDownloadUrl: string; coverUrl: string;
  sha256: string; pngSha256: string; jsonBytes: number; pngBytes: number;
  shelfName: string; shelfTags: string[]; shelfDescription: string;
};

export const XUMENG_USER_PROVIDED_CARD_RECORDS = suppliedRecords as unknown as readonly XumengUserProvidedCardRecord[];

const ids = new Set<string>();
const slugs = new Set<string>();
for (const record of XUMENG_USER_PROVIDED_CARD_RECORDS) {
  const base = `/assets/xumeng/user-cards/20261024/${record.slug}`;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.slug) || record.id !== `xumeng-user-${record.slug}`
    || ids.has(record.id) || slugs.has(record.slug)
    || record.downloadUrl !== `${base}.json` || record.pngDownloadUrl !== `${base}.png` || record.coverUrl !== `${base}.png`
    || !/^[a-f0-9]{64}$/.test(record.sha256) || !/^[a-f0-9]{64}$/.test(record.pngSha256)
    || !Number.isSafeInteger(record.jsonBytes) || record.jsonBytes <= 0
    || !Number.isSafeInteger(record.pngBytes) || record.pngBytes <= 0
    || typeof record.author !== "string" || record.author.length > 120 || record.author.includes("\0")
    || typeof record.version !== "string" || record.version.length > 120
    || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.changes !== "string" || !record.changes.trim()
    || !Array.isArray(record.compatibilityNotes) || record.compatibilityNotes.some(note => typeof note !== "string" || !note.trim())) {
    throw new Error("用户提供角色卡的发布清单无效。");
  }
  ids.add(record.id); slugs.add(record.slug);
}
