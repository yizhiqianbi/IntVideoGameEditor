/**
 * Session cache for the home recommendation page.
 *
 * The first paint of the play home used to show the generic hot shelf until the
 * personalized ids arrived, then swap cards — a visible auto-refresh on every
 * entry. Caching the ids per account and query key for a short TTL lets the
 * shelf request start from the same personalized list on re-entry.
 */
import type { XumengRecommendationPage } from "./xumeng-recommendations-client";

const PREFIX = "xumeng-recommendation-cache-v1:";
export const RECOMMENDATION_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_IDS = 200;

export type CachedRecommendation = { key: string; page: XumengRecommendationPage; storedAt: number };

const memory = new Map<string, CachedRecommendation>();

function cacheId(accountId: string, key: string): string {
  let hash = 2166136261;
  const source = `${accountId}\u0000${key}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${PREFIX}${(hash >>> 0).toString(36)}`;
}

function validPage(value: unknown): XumengRecommendationPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<XumengRecommendationPage>;
  if (!Array.isArray(page.ids) || page.ids.length > MAX_IDS || !page.ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 120)) return null;
  if (!Array.isArray(page.hiddenIds) || !page.hiddenIds.every(id => typeof id === "string")) return null;
  if (!page.reasons || typeof page.reasons !== "object" || Array.isArray(page.reasons)) return null;
  if (typeof page.personalized !== "boolean") return null;
  return { ids: [...page.ids], hiddenIds: [...page.hiddenIds], reasons: { ...page.reasons }, personalized: page.personalized };
}

export function readCachedRecommendation(accountId: string | undefined, key: string, now = Date.now()): CachedRecommendation | null {
  if (!accountId || !key) return null;
  const id = cacheId(accountId, key);
  const hit = memory.get(id);
  if (hit) {
    if (hit.key === key && now - hit.storedAt <= RECOMMENDATION_CACHE_TTL_MS) return hit;
    memory.delete(id);
  }
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: unknown; page?: unknown; storedAt?: unknown };
    if (parsed.key !== key || typeof parsed.storedAt !== "number" || now - parsed.storedAt > RECOMMENDATION_CACHE_TTL_MS) {
      sessionStorage.removeItem(id);
      return null;
    }
    const page = validPage(parsed.page);
    if (!page) { sessionStorage.removeItem(id); return null; }
    const stored: CachedRecommendation = { key, page, storedAt: parsed.storedAt };
    memory.set(id, stored);
    return stored;
  } catch { return null; }
}

export function writeCachedRecommendation(accountId: string | undefined, key: string, page: XumengRecommendationPage, now = Date.now()): void {
  if (!accountId || !key) return;
  const clean = validPage(page);
  if (!clean) return;
  const id = cacheId(accountId, key);
  const stored: CachedRecommendation = { key, page: clean, storedAt: now };
  memory.set(id, stored);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(id, JSON.stringify({ key, page: clean, storedAt: now }));
  } catch { /* Memory cache still covers this tab. */ }
}

export function clearCachedRecommendation(accountId: string | undefined): void {
  if (!accountId || typeof sessionStorage === "undefined") return;
  try {
    const keep: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const name = sessionStorage.key(index);
      if (name?.startsWith(PREFIX)) keep.push(name);
    }
    for (const name of keep) sessionStorage.removeItem(name);
  } catch { /* Nothing else to clear. */ }
  memory.clear();
}
