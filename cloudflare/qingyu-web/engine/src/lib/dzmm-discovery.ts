import type { Character } from "./dzmm-characters";

export type DzmmAuthor = {
  id: string;
  name: string;
  sourceUrl: string;
  characterIds: string[];
  identityVerified?: boolean;
};

export type DzmmForumTopic = {
  id: string;
  title: string;
  body?: string;
  author?: string;
  category?: string;
  updatedAt?: string | number;
};

export const DZMM_DISCOVERY_CATEGORIES = [{"slug": "truelove", "name": "命定相遇", "tags": ["命定相遇", "纯爱", "甜宠"]}, {"slug": "girl", "name": "都市日常", "tags": ["都市日常", "日常"]}, {"slug": "history", "name": "古风", "tags": ["古风", "古风历史"]}, {"slug": "world", "name": "幻想冒险", "tags": ["幻想冒险", "奇幻", "大世界"]}, {"slug": "mystery", "name": "轻悬疑", "tags": ["轻悬疑", "解谜"]}, {"slug": "sfw", "name": "治愈", "tags": ["治愈", "一般向"]}, {"slug": "rpg", "name": "互动游戏", "tags": ["游戏", "RPG"]}] as const;

export type DzmmDiscoverySort = "hot" | "new" | "likes";
export type DzmmDiscoveryTime = "today" | "week" | "month" | "quarter" | "all";
export type DzmmDiscoveryFilters = { sort: DzmmDiscoverySort; time: DzmmDiscoveryTime; query: string };

export function findCharacterAuthor(authors: readonly DzmmAuthor[], characterId: string): DzmmAuthor | undefined {
  return authors.find((author) => author.characterIds.includes(characterId));
}

export function isInDzmmCategory(character: Character, slug: string): boolean {
  const category = DZMM_DISCOVERY_CATEGORIES.find((item) => item.slug === slug);
  return Boolean(category && character.tags.some((tag) => category.tags.some((categoryTag) => categoryTag.toLowerCase() === tag.toLowerCase())));
}

export function isDzmmCharacterBlocked(character: Character, blockedTags: readonly string[] = []): boolean {
  const blocked = new Set(blockedTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  return character.tags.some((tag) => blocked.has(tag.toLowerCase()));
}

export function dzmmMetricValue(text: string): number | null {
  const normalized = text.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?\s*[万亿]?$/.test(normalized)) return null;
  const value = Number.parseFloat(normalized);
  return value * (normalized.includes("亿") ? 100_000_000 : normalized.includes("万") ? 10_000 : 1);
}

/** Use the application's Shanghai calendar, including when the browser uses another timezone. */
export function dzmmDiscoveryCutoff(time: DzmmDiscoveryTime, now = Date.now()): number | null {
  if (time === "all") return null;
  const date = new Date(now + 8 * 60 * 60 * 1000);
  const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
  const midnight = Date.UTC(year, month, day) - 8 * 60 * 60 * 1000;
  if (time === "today") return midnight;
  if (time === "week") return midnight - ((date.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000;
  if (time === "month") return Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000;
  return Date.UTC(year, month - 2, 1) - 8 * 60 * 60 * 1000;
}

export function filterDzmmCharacters(characters: readonly Character[], options: {
  query?: string;
  category?: string | null;
  sort?: DzmmDiscoverySort;
  time?: DzmmDiscoveryTime;
  blockedTags?: readonly string[];
  now?: number;
} = {}): Character[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const cutoff = dzmmDiscoveryCutoff(options.time ?? "all", options.now);
  const result = characters.filter((character) => {
    if (isDzmmCharacterBlocked(character, options.blockedTags)) return false;
    if (options.category && !isInDzmmCategory(character, options.category)) return false;
    if (query && !`${character.name} ${character.author} ${character.introduction ?? ""} ${character.description} ${character.tags.join(" ")}`.toLocaleLowerCase().includes(query)) return false;
    if (cutoff !== null && (!Number.isFinite(Date.parse(character.createdAt)) || Date.parse(character.createdAt) < cutoff)) return false;
    return true;
  });
  return result.sort((a, b) => {
    if (options.sort === "new") return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    const left = dzmmMetricValue(options.sort === "likes" ? a.likes : a.heat);
    const right = dzmmMetricValue(options.sort === "likes" ? b.likes : b.heat);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return right - left;
  });
}

export function searchDzmmAuthors(authors: readonly DzmmAuthor[], query: string): DzmmAuthor[] {
  const term = query.trim().toLocaleLowerCase();
  return authors.filter((author) => !term || `${author.name} ${author.id}`.toLocaleLowerCase().includes(term));
}
