import { DZMM_DISCOVERY_CATEGORIES, type DzmmDiscoveryFilters } from "./dzmm-discovery";

const HISTORY_KEY = "xumengDiscovery";
export const DZMM_CATEGORY_QUERY_MAX_LENGTH = 1000;
export const DZMM_GLOBAL_QUERY_MAX_LENGTH = 120;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type DzmmTaskSelection = {
  hubTab: "platform" | "market";
  filter: "open" | "joined" | "my" | "completed" | "all" | "hidden" | "review";
  category: "all" | "roleplay" | "writing" | "feedback";
  query: string;
  taskId: string | null;
};

export type DzmmDiscoverySource = { route: string; filters: DzmmDiscoveryFilters; kind?: never }
  | { kind: "search"; route: string; query: string; filters?: never }
  | { kind: "task-market"; route: "tasks"; selection: DzmmTaskSelection; filters?: never };
export type DzmmDiscoveryHistoryItem = { version: 1; accountId: string | null; route: string } & (
  | { filters: DzmmDiscoveryFilters; origin?: never; taskSelection?: never }
  | { origin?: DzmmDiscoverySource; filters?: never; taskSelection?: never }
  | { taskSelection: DzmmTaskSelection; origin?: never; filters?: never }
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

/** Global search stores its exact accepted query and one canonical local route. */
export function dzmmSearchDiscoverySource(query: unknown): Extract<DzmmDiscoverySource, { kind: "search" }> | null {
  if (typeof query !== "string" || !query.trim() || query.length > DZMM_GLOBAL_QUERY_MAX_LENGTH || query.includes("\0")) return null;
  try { return { kind: "search", route: `search/${encodeURIComponent(query)}`, query }; } catch { return null; }
}

export function defaultDzmmTaskSelection(): DzmmTaskSelection {
  return { hubTab: "platform", filter: "open", category: "all", query: "", taskId: null };
}

/** Navigation only: task bodies, permissions, drafts and API results never enter history. */
export function dzmmTaskSelection(value: unknown): DzmmTaskSelection | null {
  const item = object(value);
  if (!item || !["platform", "market"].includes(item.hubTab as string)
    || !["open", "joined", "my", "completed", "all", "hidden", "review"].includes(item.filter as string)
    || !["all", "roleplay", "writing", "feedback"].includes(item.category as string)
    || typeof item.query !== "string" || item.query.length > DZMM_GLOBAL_QUERY_MAX_LENGTH || item.query.includes("\0")
    || (item.taskId !== null && (typeof item.taskId !== "string" || !SAFE_ID.test(item.taskId)))) return null;
  try { encodeURIComponent(item.query); } catch { return null; }
  return { hubTab: item.hubTab as DzmmTaskSelection["hubTab"], filter: item.filter as DzmmTaskSelection["filter"],
    category: item.category as DzmmTaskSelection["category"], query: item.query, taskId: item.taskId };
}

/** Apply current account permissions before a restored selection can initiate requests. */
export function dzmmTaskSelectionForRole(value: unknown, isSuper: boolean): DzmmTaskSelection {
  const selected = dzmmTaskSelection(value) ?? defaultDzmmTaskSelection();
  return selected.filter === "review" && !isSuper ? { ...selected, filter: "open", taskId: null } : selected;
}

export function dzmmTaskDiscoverySource(value: unknown): Extract<DzmmDiscoverySource, { kind: "task-market" }> | null {
  const selection = dzmmTaskSelection(value);
  return selection?.hubTab === "market" && selection.taskId ? { kind: "task-market", route: "tasks", selection } : null;
}

function parseItem(value: unknown): DzmmDiscoveryHistoryItem | null {
  const item = object(value);
  if (!item || item.version !== 1 || (item.accountId !== null && (typeof item.accountId !== "string" || !SAFE_ID.test(item.accountId))) || typeof item.route !== "string") return null;
  const base = { version: 1 as const, accountId: item.accountId, route: item.route };
  if (dzmmDiscoveryRouteCategory(item.route)) {
    if (item.accountId === null) return null;
    const selected = filters(item.filters);
    return selected ? { ...base, filters: selected } : null;
  }
  if (item.route === "tasks") {
    const selection = item.accountId !== null ? dzmmTaskSelection(item.taskSelection) : null;
    return selection ? { ...base, taskSelection: selection } : null;
  }
  if (!item.route.startsWith("character/") || !SAFE_ID.test(item.route.slice(10))) return null;
  if (item.origin === undefined) return item.accountId === null ? null : base;
  const origin = object(item.origin);
  if (origin?.kind === "search") {
    const source = dzmmSearchDiscoverySource(origin.query);
    return source && origin.route === source.route ? { ...base, origin: source } : null;
  }
  // Anonymous snapshots are limited to public search origins, never category/account state.
  if (item.accountId === null) return null;
  if (origin?.kind === "task-market") {
    const source = dzmmTaskDiscoverySource(origin.selection);
    return source && origin.route === source.route ? { ...base, origin: source } : null;
  }
  if (origin?.kind !== undefined) return null;
  const source = origin && typeof origin.route === "string" ? dzmmDiscoverySource(origin.route, origin.filters) : null;
  return source ? { ...base, origin: source } : null;
}

/** A history entry belongs to one account and one exact URL, including its character ID. */
export function readDzmmDiscoveryHistory(state: unknown, accountId: string | null, route: string): DzmmDiscoveryHistoryItem | null {
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
