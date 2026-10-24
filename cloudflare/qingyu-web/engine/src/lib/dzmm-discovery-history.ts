import { DZMM_DISCOVERY_CATEGORIES, type DzmmDiscoveryFilters } from "./dzmm-discovery";

const HISTORY_KEY = "xumengDiscovery";
export const DZMM_CATEGORY_QUERY_MAX_LENGTH = 1000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type DzmmDiscoverySource = { route: string; filters: DzmmDiscoveryFilters };
export type DzmmDiscoveryHistoryItem = { version: 1; accountId: string; route: string } & (
  | { filters: DzmmDiscoveryFilters; origin?: never }
  | { origin?: DzmmDiscoverySource; filters?: never }
);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only real catalog slugs can be a saved discovery destination. */
export function dzmmDiscoveryRouteCategory(route: string): { category: string | null } | null {
  if (route === "category") return { category: null };
  const category = route.startsWith("category/") ? route.slice(9) : "";
  return DZMM_DISCOVERY_CATEGORIES.some(item => item.slug === category) ? { category } : null;
}

function filters(value: unknown): DzmmDiscoveryFilters | null {
  const item = object(value);
  if (!item || typeof item.sort !== "string" || !["hot", "new", "likes"].includes(item.sort)
    || typeof item.time !== "string" || !["today", "week", "month", "quarter", "all"].includes(item.time)
    || typeof item.query !== "string" || item.query.length > DZMM_CATEGORY_QUERY_MAX_LENGTH || item.query.includes("\0")) return null;
  return { sort: item.sort as DzmmDiscoveryFilters["sort"], time: item.time as DzmmDiscoveryFilters["time"], query: item.query };
}

export function dzmmDiscoverySource(route: string, value: unknown): DzmmDiscoverySource | null {
  const selected = filters(value);
  return dzmmDiscoveryRouteCategory(route) && selected ? { route, filters: selected } : null;
}

function parseItem(value: unknown): DzmmDiscoveryHistoryItem | null {
  const item = object(value);
  if (!item || item.version !== 1 || typeof item.accountId !== "string" || !SAFE_ID.test(item.accountId) || typeof item.route !== "string") return null;
  const base = { version: 1 as const, accountId: item.accountId, route: item.route };
  if (dzmmDiscoveryRouteCategory(item.route)) {
    const selected = filters(item.filters);
    return selected ? { ...base, filters: selected } : null;
  }
  if (!item.route.startsWith("character/") || !SAFE_ID.test(item.route.slice(10))) return null;
  if (item.origin === undefined) return base;
  const origin = object(item.origin);
  const source = origin && typeof origin.route === "string" ? dzmmDiscoverySource(origin.route, origin.filters) : null;
  return source ? { ...base, origin: source } : null;
}

/** A history entry belongs to one account and one exact URL, including its character ID. */
export function readDzmmDiscoveryHistory(state: unknown, accountId: string, route: string): DzmmDiscoveryHistoryItem | null {
  const item = parseItem(object(state)?.[HISTORY_KEY]);
  return item?.accountId === accountId && item.route === route ? item : null;
}

/** Copy only bounded fields; keep router/host history keys and never mutate the input. */
export function mergeDzmmDiscoveryHistory(state: unknown, value: unknown): Record<string, unknown> {
  const result = { ...object(state) };
  delete result[HISTORY_KEY];
  const item = parseItem(value);
  if (item) result[HISTORY_KEY] = item;
  return result;
}
