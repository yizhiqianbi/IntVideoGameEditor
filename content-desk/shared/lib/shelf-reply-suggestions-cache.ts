import { parseShelfReplySuggestions, type ShelfReplySuggestion } from "./shelf-reply-suggestions";

export type ShelfSuggestionCacheEntry = {
  key: string; updatedAt: number; status: "pending" | "ready" | "error";
  options?: ShelfReplySuggestion[]; error?: string; dismissed?: boolean;
};
type CacheStorage = Pick<Storage, "getItem" | "setItem">;
const PREFIX = "folio-reply-options-v2:";
const LIMIT = 80;
const memory = new Map<string, ShelfSuggestionCacheEntry[]>();

export function shelfSuggestionCacheStorageKey(owner: string) { return `${PREFIX}${owner}`; }
function store(): CacheStorage | undefined { try { return sessionStorage; } catch { return undefined; } }
function entries(owner: string, storage: CacheStorage | undefined): ShelfSuggestionCacheEntry[] {
  const name = shelfSuggestionCacheStorageKey(owner);
  if (memory.has(name)) return memory.get(name)!;
  try {
    const raw: unknown = JSON.parse(storage?.getItem(name) ?? "null");
    if (Array.isArray(raw)) return raw.slice(-LIMIT).flatMap<ShelfSuggestionCacheEntry>((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const value = item as ShelfSuggestionCacheEntry;
      if (typeof value.key !== "string" || value.key.length > 1000 || !Number.isFinite(value.updatedAt)) return [];
      if (value.status === "pending") return [{ key: value.key, updatedAt: value.updatedAt, status: "pending" as const }];
      if (value.status === "error" && typeof value.error === "string" && value.error.length <= 1000) return [{ key: value.key, updatedAt: value.updatedAt, status: "error" as const, error: value.error }];
      if (value.status !== "ready") return [];
      if (value.dismissed === true) return [{ key: value.key, updatedAt: value.updatedAt, status: "ready" as const, dismissed: true }];
      try { return [{ key: value.key, updatedAt: value.updatedAt, status: "ready" as const, options: parseShelfReplySuggestions({ options: value.options }) }]; } catch { return []; }
    });
  } catch { /* An in-memory fallback still prevents duplicate requests in this document. */ }
  return memory.get(name) ?? [];
}
/** Per-account/tab cache survives reload; it is never story history or a model prompt. */
export function readShelfSuggestionCache(owner: string, key: string, storage: CacheStorage | undefined = store()) {
  return entries(owner, storage).find(item => item.key === key) ?? null;
}
export function writeShelfSuggestionCache(owner: string, entry: ShelfSuggestionCacheEntry, storage: CacheStorage | undefined = store()) {
  const next = [...entries(owner, storage).filter(item => item.key !== entry.key), entry].slice(-LIMIT);
  memory.set(shelfSuggestionCacheStorageKey(owner), next);
  try { storage?.setItem(shelfSuggestionCacheStorageKey(owner), JSON.stringify(next)); } catch { /* Preserve current document cache. */ }
}
