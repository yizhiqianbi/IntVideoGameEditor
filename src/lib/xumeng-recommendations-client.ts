import {
  RECOMMENDATION_ACTIONS, RECOMMENDATION_CHARACTER_ID, RECOMMENDATION_REASONS, RECOMMENDATION_SURFACES,
  type RecommendationAction, type RecommendationPeriod, type RecommendationRankSurface, type RecommendationReason, type RecommendationSurface,
} from "./xumeng-recommendations";

const API = "/api/backend/v1/recommendations";

export type XumengRecommendationEvent = {
  characterId: string;
  surface: RecommendationSurface;
  action: RecommendationAction;
  position?: number;
};

export type XumengRecommendationPage = {
  ids: string[];
  reasons: Record<string, RecommendationReason>;
  personalized: boolean;
  hiddenIds: string[];
};

export type XumengRecommendationQuery = {
  surface: RecommendationRankSurface;
  period?: RecommendationPeriod;
  seed?: string;
  tags?: readonly string[];
  q?: string;
  since?: number;
  look?: "photo" | "anime";
};

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !RECOMMENDATION_CHARACTER_ID.test(item) || ids.includes(item)) continue;
    ids.push(item);
    if (ids.length >= max) break;
  }
  return ids;
}

function reasonMap(value: unknown): Record<string, RecommendationReason> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const reasons: Record<string, RecommendationReason> = {};
  for (const [id, reason] of Object.entries(value as Record<string, unknown>)) {
    if (!RECOMMENDATION_CHARACTER_ID.test(id)) continue;
    if (typeof reason !== "string" || !RECOMMENDATION_REASONS.includes(reason as RecommendationReason)) continue;
    reasons[id] = reason as RecommendationReason;
  }
  return reasons;
}

export function readXumengRecommendationPage(value: unknown): XumengRecommendationPage {
  if (!value || typeof value !== "object") throw new Error("推荐结果无效。");
  const record = value as Record<string, unknown>;
  return {
    ids: stringList(record.ids, 200),
    reasons: reasonMap(record.reasons),
    personalized: record.personalized === true,
    hiddenIds: stringList(record.hiddenIds, 500),
  };
}

export async function fetchXumengRecommendations(query: XumengRecommendationQuery, signal?: AbortSignal): Promise<XumengRecommendationPage> {
  const params = new URLSearchParams({ surface: query.surface });
  if (query.period) params.set("period", query.period);
  if (query.seed) params.set("seed", query.seed);
  if (query.tags?.length) params.set("tags", query.tags.join(","));
  if (query.q) params.set("q", query.q);
  if (query.since != null) params.set("since", String(query.since));
  if (query.look) params.set("look", query.look);
  const response = await fetch(`${API}?${params}`, { credentials: "same-origin", cache: "no-store", signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("推荐暂时没有更新。");
  return readXumengRecommendationPage(body);
}

export async function recordXumengRecommendationEvents(events: readonly XumengRecommendationEvent[], signal?: AbortSignal): Promise<number> {
  const acceptedEvents = events.filter((event) => RECOMMENDATION_CHARACTER_ID.test(event.characterId)
    && RECOMMENDATION_SURFACES.includes(event.surface)
    && RECOMMENDATION_ACTIONS.includes(event.action)
    && (event.position === undefined || (Number.isInteger(event.position) && event.position >= 0 && event.position <= 500))).slice(0, 40);
  if (!acceptedEvents.length) return 0;
  try {
    const response = await fetch(`${API}/events`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: acceptedEvents.map((event) => ({
        characterId: event.characterId,
        surface: event.surface,
        action: event.action,
        ...(event.position === undefined ? {} : { position: event.position }),
      })) }),
    });
    if (!response.ok) return 0;
    const body = await response.json().catch(() => null) as { accepted?: unknown } | null;
    return typeof body?.accepted === "number" && body.accepted > 0 ? body.accepted : 0;
  } catch {
    return 0;
  }
}

export function recommendationRequestAborted(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}
