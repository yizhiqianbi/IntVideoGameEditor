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

export const DZMM_DISCOVERY_CATEGORIES = [
  { slug: "truelove", name: "纯爱", tags: ["纯爱", "甜宠", "wholesome"] },
  { slug: "girl", name: "女性向", tags: ["女性向", "female-oriented", "fem-audience"] },
  { slug: "ntr", name: "NTR", tags: ["NTR"] },
  { slug: "history", name: "古风历史", tags: ["古风历史", "古风"] },
  { slug: "sm", name: "调教", tags: ["调教"] },
  { slug: "emmmmm", name: "乱伦", tags: ["乱伦"] },
  { slug: "cultivation-sect", name: "仙侠古风", tags: ["仙侠古风", "修仙"] },
  { slug: "world", name: "大世界", tags: ["大世界", "世界模拟", "模拟器", "world-card", "scenario"] },
  { slug: "hougong", name: "后宫", tags: ["后宫"] },
  { slug: "foot-fetish", name: "足控", tags: ["足控"] },
  { slug: "acg", name: "同人", tags: ["同人"] },
  { slug: "yuri", name: "百合", tags: ["百合"] },
  { slug: "nanniang", name: "男娘", tags: ["男娘"] },
  { slug: "you", name: "油腻", tags: ["油腻"] },
  { slug: "futa", name: "扶她", tags: ["扶她"] },
  { slug: "sfw", name: "一般向", tags: ["一般向", "治愈", "cozy", "slice-of-life"] },
  { slug: "gay", name: "男同", tags: ["男同"] },
  { slug: "for-girls", name: "女性视角", tags: ["女性视角"] },
  { slug: "rpg", name: "游戏", tags: ["游戏", "RPG"] },
] as const;

export type DzmmDiscoverySort = "hot" | "new" | "likes";
export type DzmmDiscoveryTime = "today" | "week" | "month" | "quarter" | "all";
export type DzmmDiscoveryFilters = { sort: DzmmDiscoverySort; time: DzmmDiscoveryTime; query: string };

export function findCharacterAuthor(authors: readonly DzmmAuthor[], characterId: string): DzmmAuthor | undefined {
  return authors.find((author) => author.characterIds.includes(characterId));
}

export type CharacterAuthorTarget =
  | { kind: "author"; author: DzmmAuthor }
  | { kind: "profile" }
  | { kind: "unsigned" };

/** Public cards with only a display name, such as 原卡未署名, have no author page. */
export function resolveCharacterAuthorTarget(
  authors: readonly DzmmAuthor[],
  character: Pick<Character, "id" | "sourceKind" | "publication">,
): CharacterAuthorTarget {
  const author = findCharacterAuthor(authors, character.id);
  if (author) return { kind: "author", author };
  if (character.sourceKind === "original" && !character.publication) return { kind: "profile" };
  return { kind: "unsigned" };
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
