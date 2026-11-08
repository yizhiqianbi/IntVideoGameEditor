import type { Character } from "./dzmm-characters";

export const DZMM_PUBLIC_SHELF_PAGE_SIZE = 24;
export const DZMM_SHELF_CACHE_TTL_MS = 5 * 60 * 1000;
export const DZMM_SHELF_CACHE_PAGES = 6;
export const DZMM_SHELF_CACHE_FEEDS = 8;
export const DZMM_CATALOG_SORTS = ["hot", "new", "likes", "name"] as const;
export type DzmmCatalogSort = (typeof DZMM_CATALOG_SORTS)[number];
export const DZMM_CATALOG_LOOKS = ["photo", "anime"] as const;
export type DzmmCatalogLook = (typeof DZMM_CATALOG_LOOKS)[number];

export type DzmmCatalogRequest = {
  offset?: number;
  limit?: number;
  q?: string;
  tags?: readonly string[];
  sort?: DzmmCatalogSort;
  view?: "card" | "full";
  authorIds?: readonly string[];
  ids?: readonly string[];
  since?: number;
  look?: DzmmCatalogLook;
};

export type DzmmCatalogApplied = {
  q: string;
  tags: string[];
  sort: DzmmCatalogSort;
  view: "card" | "full";
  authorIds: string[];
  ids: string[];
  since: number | null;
  look: DzmmCatalogLook | null;
};

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

function readBoundedInteger(raw: string | null, fallback: number, min: number, max: number, label: string): number {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${label}无效。`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${label}无效。`);
  return value;
}

function readList(raw: string | null, maxItems: number, label: string): string[] {
  if (raw === null || !raw.trim()) return [];
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length > maxItems || items.some((item) => !IDENTIFIER.test(item))) throw new Error(`${label}无效。`);
  return [...new Set(items)];
}

function readTags(raw: string | null, maxItems: number): string[] {
  if (raw === null || !raw.trim()) return [];
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length > maxItems || items.some((item) => item.length > 40 || /[\0,%]/.test(item))) throw new Error("标签无效。");
  return [...new Set(items)];
}

/** Parse the public catalog query. Unknown keys are ignored so older clients keep working. */
export function parseDzmmCatalogQuery(params: { get(name: string): string | null }): DzmmCatalogApplied & { offset: number; limit: number } {
  const offset = readBoundedInteger(params.get("offset"), 0, 0, 100_000, "分页参数");
  const limit = readBoundedInteger(params.get("limit"), 20, 1, 50, "分页参数");
  const rawQuery = params.get("q") ?? "";
  if (rawQuery.length > 40 || rawQuery.includes("\0")) throw new Error("搜索词无效。");
  const q = rawQuery.trim().toLocaleLowerCase().replace(/[%_]/g, "");
  const tags = [...new Set([...readTags(params.get("tag"), 1), ...readTags(params.get("tags"), 8)])];
  const sortRaw = params.get("sort");
  const sort = sortRaw === null || sortRaw === "" ? "new" : sortRaw;
  if (!DZMM_CATALOG_SORTS.includes(sort as DzmmCatalogSort)) throw new Error("排序方式无效。");
  const viewRaw = params.get("view");
  const view = viewRaw === null || viewRaw === "" ? "full" : viewRaw;
  if (view !== "card" && view !== "full") throw new Error("目录视图无效。");
  const authorIds = [...new Set([...readList(params.get("author"), 1, "作者"), ...readList(params.get("authors"), 20, "作者")])];
  const ids = readList(params.get("ids"), DZMM_PUBLIC_SHELF_PAGE_SIZE, "角色编号");
  const sinceRaw = params.get("since");
  const since = sinceRaw === null || sinceRaw === "" ? null : readBoundedInteger(sinceRaw, 0, 0, 10_000_000_000_000, "时间范围");
  const lookRaw = params.get("look");
  const look = lookRaw === null || lookRaw === "" ? null : lookRaw;
  if (look !== null && !DZMM_CATALOG_LOOKS.includes(look as DzmmCatalogLook)) throw new Error("画面类型无效。");
  return { offset, limit, q, tags, sort: sort as DzmmCatalogSort, view, authorIds, ids, since, look: look as DzmmCatalogLook | null };
}

export function dzmmCatalogRequestKey(request: DzmmCatalogRequest): string {
  return JSON.stringify({
    q: request.q?.trim().toLocaleLowerCase() ?? "",
    tags: [...(request.tags ?? [])].sort(),
    sort: request.sort ?? "new",
    authorIds: [...(request.authorIds ?? [])].sort(),
    ids: request.ids ?? [],
    since: request.since ?? 0,
    look: request.look ?? "",
  });
}

export type DzmmShelfPage<T> = {
  characters: T[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
  serverFiltered: boolean;
};

export type DzmmShelfFeed<T> = {
  shown: DzmmShelfPage<T> & { storedAt: number };
  ahead: (DzmmShelfPage<T> & { offset: number; storedAt: number }) | null;
};

function copyShelfPage<T>(page: DzmmShelfPage<T>): DzmmShelfPage<T> {
  return { ...page, characters: page.characters.slice() };
}

/** Read one feed. A feed older than the time limit is dropped. */
export function readDzmmShelfFeed<T>(store: Map<string, DzmmShelfFeed<T>>, key: string, now: number, ttl = DZMM_SHELF_CACHE_TTL_MS): DzmmShelfFeed<T> | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (!Number.isFinite(entry.shown.storedAt) || now - entry.shown.storedAt > ttl || now < entry.shown.storedAt) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, entry);
  const ahead = entry.ahead && entry.ahead.offset === entry.shown.nextOffset && now - entry.ahead.storedAt <= ttl && now >= entry.ahead.storedAt ? entry.ahead : null;
  return { shown: { ...copyShelfPage(entry.shown), storedAt: entry.shown.storedAt }, ahead: ahead ? { ...copyShelfPage(ahead), offset: ahead.offset, storedAt: ahead.storedAt } : null };
}

/** Remember a feed and the single prefetched page after it. Returns feeds that fell out of the limit. */
export function writeDzmmShelfFeed<T>(
  store: Map<string, DzmmShelfFeed<T>>,
  key: string,
  feed: DzmmShelfFeed<T>,
  now: number,
  limits?: { feeds?: number; pages?: number; pageSize?: number },
): string[] {
  const maxCards = (limits?.pages ?? DZMM_SHELF_CACHE_PAGES) * (limits?.pageSize ?? DZMM_PUBLIC_SHELF_PAGE_SIZE);
  if (feed.shown.characters.length > maxCards) return [];
  const maxFeeds = limits?.feeds ?? DZMM_SHELF_CACHE_FEEDS;
  const ahead = feed.ahead && feed.ahead.offset === feed.shown.nextOffset && feed.ahead.characters.length > 0
    ? { ...copyShelfPage(feed.ahead), offset: feed.ahead.offset, storedAt: now }
    : null;
  store.delete(key);
  store.set(key, { shown: { ...copyShelfPage(feed.shown), storedAt: now }, ahead });
  const evicted: string[] = [];
  while (store.size > maxFeeds) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
    evicted.push(oldest);
  }
  return evicted;
}

export function appendDzmmCatalogPage<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  const next = current.slice();
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

export function isDzmmListPreview(character: { listPreview?: boolean }): boolean {
  return character.listPreview === true;
}

export type XumengPlaySortMode = "recommended" | "heat" | "likes" | "updated" | "name";

/** The play page's 最新 tab follows publish time unless a metric sort is chosen. */
export function xumengPlayCatalogSort(tab: string, sortMode: XumengPlaySortMode): DzmmCatalogSort {
  if (sortMode === "name") return "name";
  if (sortMode === "likes") return "likes";
  if (tab === "最新") return sortMode === "heat" ? "hot" : "new";
  if (sortMode === "updated") return "new";
  return "hot";
}

export function xumengPlaySortSelection(tab: string, sortMode: XumengPlaySortMode): XumengPlaySortMode {
  if (tab === "最新" && sortMode !== "heat" && sortMode !== "likes" && sortMode !== "name") return "updated";
  return sortMode;
}

export function orderDzmmShelfByTime<T extends { createdAt: string }>(characters: readonly T[]): T[] {
  return [...characters].sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
}

/** Keep the fields the shelf paints. The playable prompt stays on the detail request. */
export function toDzmmCatalogCard(character: Character): Character {
  const description = character.description.replace(/\s+/g, " ").trim().slice(0, 180);
  return {
    id: character.id,
    name: character.name,
    author: character.author,
    heat: character.heat,
    likes: character.likes,
    cover: character.cover,
    tags: character.tags.slice(0, 100),
    description,
    personality: "",
    scenario: "",
    firstMessage: "",
    sourceUrl: "",
    sourceKind: character.sourceKind,
    promptOrigin: character.promptOrigin,
    ...(character.catalogReadiness ? { catalogReadiness: character.catalogReadiness } : {}),
    createdAt: character.createdAt,
    ...(character.publication ? { publication: character.publication } : {}),
    listPreview: true,
  };
}
