import type { Character } from "./dzmm-characters";
import { isDzmmCharacterBlocked } from "./dzmm-discovery";
import { characterHasMinorShelfTag, recommendationShelfTags } from "./xumeng-shelf-tags";

/** A qualified chat is five user turns with the same public character. */
export const QUALIFIED_USER_MESSAGES = 5;
export const PERSONAL_POSITIVE_MINIMUM = 3;
export const COOCCURRENCE_SUPPORT = 2;
export const PERSONAL_BLEND = 0.65;
export const QUALITY_BLEND = 0.35;
export const EXPLORATION_WINDOW = 8;
export const EXPLORATION_SLOTS = 2;
export const DIVERSITY_CAP = 2;
export const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const HALF_LIFE_DAYS = 14;
export const SHRINKAGE_STRENGTH = 5;
export const QUALIFIED_WEIGHT = 5;
export const LIKE_WEIGHT = 2;
export const FAVORITE_WEIGHT = 3;
export const RECOMMENDATION_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const RECOMMENDATION_CHARACTER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOME_LIMIT = 200;
const RELATED_LIMIT = 8;

export const RECOMMENDATION_SURFACES = ["home", "for_you", "ranking", "related", "search", "category"] as const;
export const RECOMMENDATION_RANK_SURFACES = ["home", "for_you", "ranking", "related", "search", "category"] as const;
export const RECOMMENDATION_ACTIONS = ["impression", "open", "start", "depth", "like", "unlike", "favorite", "unfavorite", "hide"] as const;
export const RECOMMENDATION_PERIODS = ["day", "week", "all"] as const;
export const RECOMMENDATION_REASONS = ["quality", "same_tag", "followed_author", "same_author", "also_chatted", "explore", "ranking"] as const;
export const RECOMMENDATION_REASON_LABELS: Record<(typeof RECOMMENDATION_REASONS)[number], string> = {
  same_tag: "标签相近",
  followed_author: "你关注的作者",
  same_author: "同一作者",
  also_chatted: "聊过的人也在看",
  explore: "新上架",
  ranking: "本周热门",
  quality: "",
};

export type RecommendationSurface = (typeof RECOMMENDATION_SURFACES)[number];
export type RecommendationRankSurface = (typeof RECOMMENDATION_RANK_SURFACES)[number];
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];
export type RecommendationPeriod = (typeof RECOMMENDATION_PERIODS)[number];
export type RecommendationReason = (typeof RECOMMENDATION_REASONS)[number];

/** Card copy for a recommendation reason. Quality stays a ranking signal and is not shown. */
export function recommendationReasonText(reason: RecommendationReason | undefined): string {
  if (!reason || reason === "quality" || reason === "ranking") return "";
  return RECOMMENDATION_REASON_LABELS[reason];
}

export type RecommendationCandidate = {
  id: string;
  tags: readonly string[];
  authorId: string;
  createdAt: number;
  listed: boolean;
};

export type RecommendationDaily = {
  day: string;
  qualified: number;
  likes: number;
  favorites: number;
  /** Successful user-and-assistant rounds recorded for this Shanghai day. */
  rounds?: number;
};

export type RankXumengRecommendationsInput = {
  surface: RecommendationRankSurface;
  now: number;
  period?: RecommendationPeriod;
  seedId?: string;
  blockedTags?: readonly string[];
  followedAuthorIds?: readonly string[];
  hiddenIds?: readonly string[];
  positiveIds?: readonly string[];
  candidates: readonly RecommendationCandidate[];
  /** Home shelf tag. Cards must carry at least one of these tags. */
  tags?: readonly string[];
  /** Search and category matches. An empty list returns nothing. */
  allowedIds?: readonly string[];
  daily?: ReadonlyMap<string, readonly RecommendationDaily[]>;
  cooccurrence?: ReadonlyMap<string, number>;
};

export type RecommendationResult = {
  ids: string[];
  reasons: Record<string, RecommendationReason>;
  personalized: boolean;
};

type Scored = RecommendationCandidate & {
  score: number;
  fresh: boolean;
  primaryTag: string;
  reason: RecommendationReason;
};

export function recommendationDay(now: number): string {
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function recommendationDayStart(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - SHANGHAI_OFFSET_MS;
}

export function recommendationWindowStart(period: RecommendationPeriod, now: number): number | null {
  if (period === "all") return null;
  const start = recommendationDayStart(recommendationDay(now));
  if (!Number.isFinite(start)) return null;
  if (period === "day") return start;
  const weekday = new Date(now + SHANGHAI_OFFSET_MS).getUTCDay();
  return start - ((weekday + 6) % 7) * DAY_MS;
}

export function isPublicRecommendationCharacter(character: {
  id: string;
  tags?: readonly string[];
  sourceKind?: string;
  publication?: unknown;
  catalogReadiness?: string | null;
  authoringDraft?: unknown;
}): boolean {
  if (character.authoringDraft) return false;
  if (character.catalogReadiness === "metadata-only" || character.catalogReadiness === "public-context") return false;
  if (character.sourceKind === "original" && !character.publication) return false;
  if (character.id.startsWith("local-") || !RECOMMENDATION_CHARACTER_ID.test(character.id)) return false;
  if (characterHasMinorShelfTag(character.tags ?? [])) return false;
  return true;
}

export function toRecommendationCandidate(input: {
  id: string;
  tags: readonly string[];
  authorId: string;
  createdAt: string | number;
  listed: boolean;
}): RecommendationCandidate | null {
  if (!input.listed || !isPublicRecommendationCharacter({ id: input.id, tags: input.tags, sourceKind: "public-summary" })) return null;
  const createdAt = typeof input.createdAt === "number" ? input.createdAt : Date.parse(input.createdAt);
  return {
    id: input.id,
    tags: input.tags,
    authorId: input.authorId || `name:${input.id}`,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    listed: true,
  };
}

function blocked(tags: readonly string[], blockedTags: readonly string[]): boolean {
  return isDzmmCharacterBlocked({ tags: [...tags] } as Character, blockedTags);
}

function countable(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function tagSet(tags: readonly string[]): Set<string> {
  return new Set(recommendationShelfTags(tags).map((tag) => tag.toLowerCase()));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const tag of left) if (right.has(tag)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

function decayedQuality(rows: readonly RecommendationDaily[] | undefined, now: number): { value: number; evidence: number } {
  let value = 0;
  let evidence = 0;
  for (const row of rows ?? []) {
    const start = recommendationDayStart(row.day);
    if (!Number.isFinite(start)) continue;
    const ageDays = Math.max(0, (now - start) / DAY_MS);
    const weight = 0.5 ** (ageDays / HALF_LIFE_DAYS);
    const qualified = countable(row.qualified);
    const likes = countable(row.likes);
    const favorites = countable(row.favorites);
    value += weight * (qualified * QUALIFIED_WEIGHT + likes * LIKE_WEIGHT + favorites * FAVORITE_WEIGHT);
    evidence += weight * (qualified + likes + favorites);
  }
  return { value, evidence };
}

function windowScore(rows: readonly RecommendationDaily[] | undefined, period: RecommendationPeriod, now: number): number {
  const start = recommendationWindowStart(period, now);
  let qualified = 0;
  let likes = 0;
  for (const row of rows ?? []) {
    const dayStart = recommendationDayStart(row.day);
    if (!Number.isFinite(dayStart) || (start !== null && dayStart < start)) continue;
    qualified += countable(row.qualified);
    likes += countable(row.likes);
  }
  return qualified * QUALIFIED_WEIGHT + likes * LIKE_WEIGHT;
}

function byScore(left: Scored, right: Scored): number {
  return right.score - left.score || left.id.localeCompare(right.id);
}

function diversify(ordered: Scored[]): Scored[] {
  const pool = [...ordered];
  const result: Scored[] = [];
  while (pool.length) {
    const window = result.slice(-(EXPLORATION_WINDOW - 1));
    const index = pool.findIndex((item) => fits(window, item));
    if (index < 0) result.push(pool.shift()!);
    else result.push(pool.splice(index, 1)[0]!);
  }
  return result;
}

function fits(window: readonly Scored[], item: Scored): boolean {
  if (window.filter((other) => other.authorId === item.authorId).length >= DIVERSITY_CAP) return false;
  if (!item.primaryTag) return true;
  return window.filter((other) => other.primaryTag === item.primaryTag).length < DIVERSITY_CAP;
}

function sevenDayHeat(rows: readonly RecommendationDaily[] | undefined, now: number): number {
  const earliest = recommendationDayStart(recommendationDay(now - 6 * DAY_MS));
  let rounds = 0;
  let qualified = 0;
  let useRounds = false;
  for (const row of rows ?? []) {
    const start = recommendationDayStart(row.day);
    if (!Number.isFinite(start) || start < earliest) continue;
    if (typeof row.rounds === "number") { useRounds = true; rounds += countable(row.rounds); }
    qualified += countable(row.qualified);
  }
  return useRounds ? rounds : qualified;
}

function homeFreshKey(day: string, id: string): number {
  let hash = 0;
  const text = `${day}:${id}`;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  return hash;
}

/** Home shelf: three cards by the last seven Shanghai days of successful rounds, then one new card. */
function rankHomeShelf(candidates: readonly RecommendationCandidate[], daily: ReadonlyMap<string, readonly RecommendationDaily[]>, now: number): RecommendationResult {
  const day = recommendationDay(now);
  const scored = candidates.map((candidate) => ({
    candidate,
    score: sevenDayHeat(daily.get(candidate.id), now),
    fresh: now - candidate.createdAt <= FRESH_WINDOW_MS && candidate.createdAt <= now + DAY_MS,
  })).sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const heat = scored.filter((item) => !(item.fresh && item.score === 0));
  const fresh = scored.filter((item) => item.fresh)
    .sort((left, right) => homeFreshKey(day, left.candidate.id) - homeFreshKey(day, right.candidate.id) || left.candidate.id.localeCompare(right.candidate.id));
  const used = new Set<string>();
  const ordered: typeof scored = [];
  const explored = new Set<string>();
  const take = (queue: typeof scored, explore: boolean) => {
    while (queue.length && used.has(queue[0]!.candidate.id)) queue.shift();
    const item = queue.shift();
    if (!item) return false;
    used.add(item.candidate.id);
    ordered.push(item);
    if (explore) explored.add(item.candidate.id);
    return true;
  };
  while (used.size < scored.length) {
    let taken = 0;
    while (taken < 3 && take(heat, false)) taken += 1;
    const inserted = take(fresh, true);
    if (!inserted && taken === 0) break;
  }
  const reasons: Record<string, RecommendationReason> = {};
  const ids = ordered.slice(0, HOME_LIMIT).map((item) => {
    reasons[item.candidate.id] = explored.has(item.candidate.id) ? "explore" : "quality";
    return item.candidate.id;
  });
  return { ids, reasons, personalized: false };
}

function finish(items: Scored[], explored: ReadonlySet<string>, personalized: boolean, limit: number): RecommendationResult {
  const reasons: Record<string, RecommendationReason> = {};
  const ids = items.slice(0, limit).map((item) => {
    reasons[item.id] = explored.has(item.id) ? "explore" : item.reason;
    return item.id;
  });
  return { ids, reasons, personalized };
}

export function rankXumengRecommendations(input: RankXumengRecommendationsInput): RecommendationResult {
  const blockedTags = input.blockedTags ?? [];
  const hidden = new Set(input.hiddenIds ?? []);
  const followed = new Set(input.followedAuthorIds ?? []);
  const daily = input.daily ?? new Map<string, readonly RecommendationDaily[]>();
  const cooccurrence = input.cooccurrence ?? new Map<string, number>();
  const anchorable = input.candidates.filter((candidate) => candidate.listed && isPublicRecommendationCharacter({
    id: candidate.id, tags: candidate.tags, sourceKind: "public-summary",
  }) && !blocked(candidate.tags, blockedTags));
  const anchorById = new Map(anchorable.map((candidate) => [candidate.id, candidate]));
  const allowed = input.allowedIds === undefined ? null : new Set(input.allowedIds);
  const requiredTags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0))].slice(0, 8);
  const inScope = (candidate: RecommendationCandidate) => {
    if (input.surface === "related" || input.surface === "ranking") return true;
    if (allowed && !allowed.has(candidate.id)) return false;
    if (requiredTags.length > 0 && !requiredTags.some((tag) => candidate.tags.includes(tag))) return false;
    return true;
  };
  const recommendable = anchorable.filter((candidate) => !hidden.has(candidate.id) && inScope(candidate));

  if (input.surface === "home") return rankHomeShelf(recommendable, daily, input.now);

  if (input.surface === "ranking") {
    const period = input.period ?? "week";
    const ranked = recommendable.flatMap((candidate) => {
      const score = windowScore(daily.get(candidate.id), period, input.now);
      if (score <= 0) return [];
      return [{ ...candidate, score, fresh: false, primaryTag: "", reason: "ranking" as const }];
    }).sort(byScore);
    return finish(ranked, new Set(), false, HOME_LIMIT);
  }

  const seed = input.surface === "related" && input.seedId ? anchorById.get(input.seedId) : undefined;
  if (input.surface === "related" && !seed) return { ids: [], reasons: {}, personalized: false };
  const positiveAnchors = (input.positiveIds ?? []).flatMap((id) => {
    const candidate = anchorById.get(id);
    return candidate ? [candidate] : [];
  });
  const anchors = input.surface === "related" && seed ? [seed] : positiveAnchors;
  const personalized = input.surface === "related" ? true : positiveAnchors.length >= PERSONAL_POSITIVE_MINIMUM;
  const activeAnchors = personalized ? anchors : [];
  const pool = recommendable.filter((candidate) => candidate.id !== seed?.id);
  const quality = pool.map((candidate) => decayedQuality(daily.get(candidate.id), input.now));
  const evidence = quality.reduce((total, item) => total + item.evidence, 0);
  const prior = evidence > 0 ? quality.reduce((total, item) => total + item.value, 0) / evidence : 0;
  const qualityScore = quality.map((item) => item.evidence > 0
    ? (item.evidence / (item.evidence + SHRINKAGE_STRENGTH)) * (item.value / item.evidence) + (SHRINKAGE_STRENGTH / (item.evidence + SHRINKAGE_STRENGTH)) * prior
    : 0);
  const maxQuality = Math.max(0, ...qualityScore);
  const anchorTags = activeAnchors.map((anchor) => tagSet(anchor.tags));
  const rawPersonal = pool.map((candidate) => {
    const tags = tagSet(candidate.tags);
    let bestTag = 0;
    let sameAuthor = false;
    for (let index = 0; index < activeAnchors.length; index += 1) {
      const anchor = activeAnchors[index]!;
      if (anchor.id === candidate.id) continue;
      bestTag = Math.max(bestTag, jaccard(tags, anchorTags[index]!));
      if (anchor.authorId && anchor.authorId === candidate.authorId) sameAuthor = true;
    }
    const also = (cooccurrence.get(candidate.id) ?? 0) >= COOCCURRENCE_SUPPORT;
    const followedAuthor = followed.has(candidate.authorId);
    const raw = bestTag + (followedAuthor ? 0.35 : 0) + (sameAuthor ? 0.25 : 0) + (also ? 0.4 : 0);
    const reason = strongestReason(bestTag, followedAuthor, sameAuthor, also);
    return { raw, reason };
  });
  const maxPersonal = Math.max(0, ...rawPersonal.map((item) => item.raw));
  const scored: Scored[] = pool.map((candidate, index) => {
    const qualityNorm = maxQuality > 0 ? qualityScore[index]! / maxQuality : 0;
    const personalNorm = personalized && maxPersonal > 0 ? rawPersonal[index]!.raw / maxPersonal : 0;
    const personalReason = rawPersonal[index]!.reason;
    const reason: RecommendationReason = personalized && personalReason !== "quality" ? personalReason : "quality";
    return {
      ...candidate,
      score: personalized ? PERSONAL_BLEND * personalNorm + QUALITY_BLEND * qualityNorm : qualityNorm,
      fresh: input.now - candidate.createdAt <= FRESH_WINDOW_MS && candidate.createdAt <= input.now + DAY_MS,
      primaryTag: recommendationShelfTags(candidate.tags)[0]?.toLowerCase() ?? "",
      reason,
    };
  }).sort(byScore);
  const diverse = diversify(scored);
  return finish(diverse, new Set<string>(), personalized, input.surface === "related" ? RELATED_LIMIT : HOME_LIMIT);
}

function strongestReason(tag: number, followedAuthor: boolean, sameAuthor: boolean, also: boolean): RecommendationReason {
  const parts: Array<[RecommendationReason, number]> = [
    ["also_chatted", also ? 0.4 : 0],
    ["followed_author", followedAuthor ? 0.35 : 0],
    ["same_author", sameAuthor ? 0.25 : 0],
    ["same_tag", tag],
  ];
  let best: RecommendationReason = "quality";
  let score = 0;
  for (const [reason, value] of parts) {
    if (value > score) { best = reason; score = value; }
  }
  return best;
}
