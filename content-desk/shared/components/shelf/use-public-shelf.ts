"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../../lib/shelf-characters";
import { fetchShelfPublicCharacters } from "../../lib/shelf-publishing";
import {
  SHELF_PUBLIC_SHELF_PAGE_SIZE, SHELF_SHELF_CACHE_PAGES, appendShelfCatalogPage, shelfCatalogRequestKey,
  readShelfShelfFeed, writeShelfShelfFeed,
  type ShelfCatalogRequest, type ShelfShelfFeed, type ShelfShelfPage,
} from "../../lib/shelf-public-shelf";
import { folioShelfStat } from "../../lib/folio-homepage-stats";

export type PublicCharacterShelf = {
  characters: Character[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
  /** The server applied search, tags, and sort. The page can be shown without filtering it again. */
  serverFiltered: boolean;
  loadMore: () => void;
};

const MAX_CACHED_CARDS = SHELF_PUBLIC_SHELF_PAGE_SIZE * SHELF_SHELF_CACHE_PAGES;
const SHELF_STORAGE_PREFIX = "folio-shelf-feed:";
const shelfMemory = new Map<string, ShelfShelfFeed<Character>>();
const shelfFlights = new Map<string, Promise<ShelfShelfPage<Character>>>();

function withShelfStats(character: Character): Character {
  const heat = folioShelfStat(character.id, "heat", character.heat, character.heat);
  const likes = folioShelfStat(character.id, "likes", character.likes, character.likes);
  return heat === character.heat && likes === character.likes ? character : { ...character, heat, likes };
}

function storageId(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${SHELF_STORAGE_PREFIX}${(hash >>> 0).toString(36)}`;
}

function isShelfCharacter(value: unknown): value is Character {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Character>;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 120
    && typeof item.name === "string"
    && typeof item.author === "string"
    && typeof item.createdAt === "string"
    && typeof item.cover === "string"
    && typeof item.description === "string"
    && typeof item.heat === "string"
    && typeof item.likes === "string"
    && Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string");
}

function isStoredPage(value: unknown): value is ShelfShelfPage<Character> & { storedAt: number } {
  if (!value || typeof value !== "object") return false;
  const page = value as ShelfShelfPage<Character> & { storedAt: number };
  return Array.isArray(page.characters)
    && page.characters.length <= MAX_CACHED_CARDS
    && page.characters.every(isShelfCharacter)
    && Number.isFinite(page.total) && page.total >= 0
    && Number.isFinite(page.nextOffset) && page.nextOffset >= 0
    && typeof page.hasMore === "boolean"
    && typeof page.serverFiltered === "boolean"
    && Number.isFinite(page.storedAt);
}

function remember(key: string, feed: ShelfShelfFeed<Character>, now: number): boolean {
  if (feed.shown.characters.length > MAX_CACHED_CARDS) return false;
  const evicted = writeShelfShelfFeed(shelfMemory, key, feed, now);
  if (typeof sessionStorage === "undefined") return true;
  try {
    for (const oldKey of evicted) sessionStorage.removeItem(storageId(oldKey));
    const stored = shelfMemory.get(key);
    if (stored) sessionStorage.setItem(storageId(key), JSON.stringify({ key, feed: stored }));
  } catch { /* The in-memory feed still covers this visit. */ }
  return true;
}

function readStoredAhead(value: unknown): ShelfShelfFeed<Character>["ahead"] {
  if (!value || typeof value !== "object") return null;
  const offset = (value as Record<string, unknown>).offset;
  if (!isStoredPage(value) || typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) return null;
  return { ...value, offset };
}

function recall(key: string, now: number): ShelfShelfFeed<Character> | null {
  const memory = readShelfShelfFeed(shelfMemory, key, now);
  if (memory) return memory;
  if (typeof sessionStorage === "undefined") return null;
  const id = storageId(key);
  try {
    const raw = sessionStorage.getItem(id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: unknown; feed?: { shown?: unknown; ahead?: unknown } };
    if (parsed.key !== key || !isStoredPage(parsed.feed?.shown)) return null;
    const ahead = readStoredAhead(parsed.feed?.ahead);
    const feed: ShelfShelfFeed<Character> = { shown: parsed.feed.shown, ahead };
    const checked = readShelfShelfFeed(new Map([[key, feed]]), key, now);
    if (!checked) {
      sessionStorage.removeItem(id);
      return null;
    }
    writeShelfShelfFeed(shelfMemory, key, checked, checked.shown.storedAt);
    return readShelfShelfFeed(shelfMemory, key, now);
  } catch {
    return null;
  }
}

function fetchShelfPage(current: ShelfCatalogRequest, offset: number, requestKey: string): Promise<ShelfShelfPage<Character>> {
  const flightKey = `${requestKey}:${offset}`;
  const existing = shelfFlights.get(flightKey);
  if (existing) return existing;
  const task = (async (): Promise<ShelfShelfPage<Character>> => {
    const rankedIds = current.ids ?? [];
    const pageIds = rankedIds.length ? rankedIds.slice(offset, offset + SHELF_PUBLIC_SHELF_PAGE_SIZE) : undefined;
    if (current.ids && current.ids.length === 0) return { characters: [], total: 0, nextOffset: 0, hasMore: false, serverFiltered: false };
    if (pageIds && pageIds.length === 0) return { characters: [], total: rankedIds.length, nextOffset: offset, hasMore: false, serverFiltered: true };
    const page = await fetchShelfPublicCharacters({
      ...current,
      ...(pageIds ? { ids: pageIds, offset: 0 } : { offset }),
      limit: SHELF_PUBLIC_SHELF_PAGE_SIZE,
      view: "card",
    });
    if (!page || !Array.isArray(page.characters)) throw new Error("公开目录响应无效。");
    const incoming = page.characters.map(withShelfStats);
    const advanced = rankedIds.length ? offset + (pageIds?.length ?? 0) : page.offset + page.characters.length;
    return {
      characters: incoming,
      total: rankedIds.length || (Number.isFinite(page.total) ? page.total : incoming.length),
      nextOffset: advanced,
      hasMore: rankedIds.length ? advanced < rankedIds.length : Boolean(page.hasMore) && page.characters.length > 0 && advanced > offset,
      serverFiltered: Boolean(page.applied),
    };
  })().finally(() => { shelfFlights.delete(flightKey); });
  shelfFlights.set(flightKey, task);
  return task;
}

export function usePublicCharacterShelf(request: ShelfCatalogRequest | null): PublicCharacterShelf {
  const requestRef = useRef(request);
  requestRef.current = request;
  const key = request ? shelfCatalogRequestKey(request) : "";
  const generation = useRef(0);
  const startup = useRef<ShelfShelfFeed<Character> | null | undefined>(undefined);
  if (startup.current === undefined) startup.current = key ? recall(key, Date.now()) : null;
  const restored = startup.current;
  const [feedKey, setFeedKey] = useState(key);
  const [characters, setCharacters] = useState<Character[]>(() => restored?.shown.characters ?? []);
  const [total, setTotal] = useState(() => restored?.shown.total ?? 0);
  const [nextOffset, setNextOffset] = useState(() => restored?.shown.nextOffset ?? 0);
  const [hasMore, setHasMore] = useState(() => restored?.shown.hasMore ?? false);
  const [loading, setLoading] = useState(() => Boolean(key) && !restored);
  const [error, setError] = useState("");
  const [serverFiltered, setServerFiltered] = useState(() => restored?.shown.serverFiltered ?? false);
  const loadingRef = useRef(loading);
  const busyRef = useRef(false);
  const charactersRef = useRef(characters);
  loadingRef.current = loading;
  charactersRef.current = characters;

  if (key !== feedKey) {
    generation.current += 1;
    setFeedKey(key);
    const cached = key ? recall(key, Date.now()) : null;
    if (cached) {
      setCharacters(cached.shown.characters);
      setTotal(cached.shown.total);
      setNextOffset(cached.shown.nextOffset);
      setHasMore(cached.shown.hasMore);
      setServerFiltered(cached.shown.serverFiltered);
    } else {
      setCharacters([]);
      setTotal(0);
      setNextOffset(0);
      setHasMore(false);
      setServerFiltered(false);
    }
    setError("");
    setLoading(Boolean(key) && !cached);
  }

  const prefetch = useCallback((requestKey: string, offset: number, allow: boolean) => {
    const current = requestRef.current;
    if (!allow || !current || shelfCatalogRequestKey(current) !== requestKey) return;
    const feed = readShelfShelfFeed(shelfMemory, requestKey, Date.now());
    if (!feed || !feed.shown.hasMore || feed.shown.nextOffset !== offset || feed.ahead) return;
    if (feed.shown.characters.length + SHELF_PUBLIC_SHELF_PAGE_SIZE > MAX_CACHED_CARDS) return;
    void fetchShelfPage(current, offset, requestKey).then((page) => {
      if (page.characters.length === 0) return;
      const latest = readShelfShelfFeed(shelfMemory, requestKey, Date.now());
      if (!latest || latest.shown.nextOffset !== offset || latest.ahead) return;
      remember(requestKey, { shown: latest.shown, ahead: { ...page, offset, storedAt: Date.now() } }, Date.now());
    }).catch(() => { /* The next scroll fetches this page again. */ });
  }, []);

  const load = useCallback(async (offset: number, append: boolean, requestKey: string) => {
    const current = requestRef.current;
    if (!current || shelfCatalogRequestKey(current) !== requestKey) return;
    const ticket = append ? generation.current : ++generation.current;
    const stillHere = () => ticket === generation.current && shelfCatalogRequestKey(requestRef.current ?? {}) === requestKey;

    if (append) {
      const cached = readShelfShelfFeed(shelfMemory, requestKey, Date.now());
      if (cached?.ahead && cached.ahead.offset === offset && stillHere()) {
        const now = Date.now();
        const characters = appendShelfCatalogPage(charactersRef.current, cached.ahead.characters);
        const cacheCharacters = appendShelfCatalogPage(cached.shown.characters, cached.ahead.characters);
        const shown = {
          characters: cacheCharacters,
          total: cached.ahead.total,
          nextOffset: cached.ahead.nextOffset,
          hasMore: cached.ahead.hasMore,
          serverFiltered: cached.ahead.serverFiltered,
          storedAt: now,
        };
        const stored = remember(requestKey, { shown, ahead: null }, now);
        setCharacters(characters);
        setTotal(shown.total);
        setNextOffset(shown.nextOffset);
        setHasMore(shown.hasMore);
        setServerFiltered(shown.serverFiltered);
        setError("");
        if (stored) prefetch(requestKey, shown.nextOffset, shown.hasMore);
        return;
      }
    }

    const alreadyFetching = append && shelfFlights.has(`${requestKey}:${offset}`);
    if (stillHere() && !alreadyFetching) {
      setLoading(true);
      setError("");
      if (!append && charactersRef.current.length === 0) {
        setCharacters([]);
        setTotal(0);
        setHasMore(false);
        setNextOffset(0);
        setServerFiltered(false);
      }
    }

    try {
      const page = await fetchShelfPage(current, offset, requestKey);
      const now = Date.now();
      const cached = append ? readShelfShelfFeed(shelfMemory, requestKey, now) : null;
      const cacheBase = append ? cached?.shown.characters : page.characters;
      if (cacheBase) {
        const cacheCharacters = append ? appendShelfCatalogPage(cacheBase, page.characters) : page.characters;
        remember(requestKey, {
          shown: { ...page, characters: cacheCharacters, storedAt: now },
          ahead: null,
        }, now);
      }
      if (!stillHere()) return;
      const visible = append ? appendShelfCatalogPage(charactersRef.current, page.characters) : page.characters;
      setCharacters(visible);
      setTotal(page.total);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
      setServerFiltered(page.serverFiltered);
      const storedShown = readShelfShelfFeed(shelfMemory, requestKey, Date.now())?.shown;
      if (storedShown && storedShown.nextOffset === page.nextOffset) prefetch(requestKey, page.nextOffset, page.hasMore);
    } catch (failure) {
      if (!stillHere()) return;
      setError(failure instanceof Error ? failure.message : "公开目录暂时无法加载。");
      setHasMore(false);
      if (!append) setServerFiltered(false);
    } finally {
      if (stillHere()) setLoading(false);
    }
  }, [prefetch]);

  useEffect(() => {
    if (!key || !requestRef.current) {
      generation.current += 1;
      return;
    }
    const cached = recall(key, Date.now());
    if (cached) {
      prefetch(key, cached.shown.nextOffset, cached.shown.hasMore);
      return;
    }
    void load(0, false, key);
  }, [key, load, prefetch]);

  const loadMore = useCallback(() => {
    if (!requestRef.current || !key || busyRef.current || loadingRef.current || !hasMore) return;
    busyRef.current = true;
    void load(nextOffset, true, key).finally(() => { busyRef.current = false; });
  }, [hasMore, key, load, nextOffset]);

  return { characters, total, hasMore, loading, error, serverFiltered, loadMore };
}
