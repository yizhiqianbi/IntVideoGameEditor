import authorRecords from "../../../src/lib/dzmm-authors.json";
import { DZMM_LISTED_CHARACTERS } from "../../../src/lib/dzmm-bundled-cards";
import {
  QUALIFIED_USER_MESSAGES, RECOMMENDATION_ACTIONS, RECOMMENDATION_CHARACTER_ID, RECOMMENDATION_EVENT_RETENTION_MS,
  RECOMMENDATION_PERIODS, RECOMMENDATION_RANK_SURFACES, RECOMMENDATION_SURFACES, rankXumengRecommendations,
  recommendationDay, recommendationDayStart, toRecommendationCandidate,
  type RecommendationAction, type RecommendationCandidate, type RecommendationDaily, type RecommendationPeriod,
  type RecommendationRankSurface, type RecommendationResult, type RecommendationSurface,
} from "../../../src/lib/xumeng-recommendations";
import { rateLimit } from "./auth";
import { markAcquisitionStarted } from "./acquisition";
import { listCatalogMatchIds } from "./publishing";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const DAY_SQL = (column: string) => `strftime('%Y-%m-%d', ${column}/1000.0, 'unixepoch', '+8 hours')`;
const UPSERT_DAILY = `INSERT INTO recommendation_item_daily(character_id, day_key, impressions, opens, starts, qualified, likes, favorites)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(character_id, day_key) DO UPDATE SET
    impressions=MIN(1000000000, recommendation_item_daily.impressions+excluded.impressions),
    opens=MIN(1000000000, recommendation_item_daily.opens+excluded.opens),
    starts=MIN(1000000000, recommendation_item_daily.starts+excluded.starts),
    qualified=MIN(1000000000, recommendation_item_daily.qualified+excluded.qualified),
    likes=MIN(1000000000, recommendation_item_daily.likes+excluded.likes),
    favorites=MIN(1000000000, recommendation_item_daily.favorites+excluded.favorites)`;
const FACT_COLUMNS = { like: "likes", favorite: "favorites", qualified: "qualified" } as const;
type FactKind = keyof typeof FACT_COLUMNS;
type FactRow = { user_id: string; character_id: string; day_key: string };
type CountRow = { character_id: string; day_key: string; qualified: number; likes: number; favorites: number };

const LIKE_BACKFILL_SQL = `SELECT l.user_id AS user_id, l.character_id AS character_id, ${DAY_SQL("l.created_at")} AS day_key
  FROM character_likes l JOIN users u ON u.id=l.user_id AND u.is_demo=0
  WHERE NOT EXISTS (SELECT 1 FROM recommendation_backfill b WHERE b.user_id=l.user_id AND b.character_id=l.character_id AND b.kind='like')
  LIMIT 100`;
const FAVORITE_BACKFILL_SQL = `SELECT f.user_id AS user_id, f.character_id AS character_id, ${DAY_SQL("u.created_at")} AS day_key
  FROM favorites f JOIN users u ON u.id=f.user_id AND u.is_demo=0
  WHERE NOT EXISTS (SELECT 1 FROM recommendation_backfill b WHERE b.user_id=f.user_id AND b.character_id=f.character_id AND b.kind='favorite')
  LIMIT 100`;
const QUALIFIED_BACKFILL_SQL = `SELECT c.user_id AS user_id, c.character_id AS character_id,
  ${DAY_SQL("MAX(c.updated_at)")} AS day_key
  FROM conversations c JOIN users u ON u.id=c.user_id AND u.is_demo=0
  JOIN (SELECT user_id, conversation_id, SUM(role='user') AS user_messages FROM messages GROUP BY user_id, conversation_id) m
    ON m.user_id=c.user_id AND m.conversation_id=c.id
  GROUP BY c.user_id, c.character_id
  HAVING SUM(m.user_messages)>=${QUALIFIED_USER_MESSAGES}
    AND NOT EXISTS (SELECT 1 FROM recommendation_backfill b WHERE b.user_id=c.user_id AND b.character_id=c.character_id AND b.kind='qualified')
  LIMIT 100`;
const LIKE_RECONCILE_SQL = `SELECT b.user_id AS user_id, b.character_id AS character_id, b.day_key AS day_key
  FROM recommendation_backfill b JOIN users u ON u.id=b.user_id AND u.is_demo=0
  LEFT JOIN character_likes l ON l.user_id=b.user_id AND l.character_id=b.character_id
  WHERE b.kind='like' AND l.character_id IS NULL LIMIT 100`;
const POSITIVE_SQL = `SELECT character_id FROM character_likes WHERE user_id=?
  UNION SELECT character_id FROM favorites WHERE user_id=?
  UNION SELECT character_id FROM recommendation_backfill WHERE user_id=? AND kind='qualified'`;
const COOCCURRENCE_SQL = (placeholders: string) => `WITH positives AS (
    SELECT l.user_id AS user_id, l.character_id AS character_id FROM character_likes l JOIN users u ON u.id=l.user_id AND u.is_demo=0
    UNION SELECT f.user_id, f.character_id FROM favorites f JOIN users u ON u.id=f.user_id AND u.is_demo=0
    UNION SELECT b.user_id, b.character_id FROM recommendation_backfill b JOIN users u ON u.id=b.user_id AND u.is_demo=0 WHERE b.kind='qualified'
  )
  SELECT c.character_id AS character_id, a.character_id AS anchor_id, COUNT(*) AS support
  FROM positives a JOIN positives c ON c.user_id=a.user_id AND c.character_id<>a.character_id
  WHERE a.user_id<>? AND a.character_id IN (${placeholders})
  GROUP BY c.character_id, a.character_id
  HAVING COUNT(*)>=2`;

export const recommendationFactQueries = [
  LIKE_BACKFILL_SQL, FAVORITE_BACKFILL_SQL, QUALIFIED_BACKFILL_SQL, LIKE_RECONCILE_SQL, COOCCURRENCE_SQL("?"),
];

const authorByCharacter = new Map<string, string>();
for (const author of authorRecords as Array<{ id?: unknown; characterIds?: unknown }>) {
  if (typeof author.id !== "string" || !Array.isArray(author.characterIds)) continue;
  for (const id of author.characterIds) if (typeof id === "string") authorByCharacter.set(id, author.id);
}

const staticCandidates = new Map<string, RecommendationCandidate>();
for (const character of DZMM_LISTED_CHARACTERS) {
  const candidate = toRecommendationCandidate({
    id: character.id,
    tags: character.tags,
    authorId: authorByCharacter.get(character.id) ?? `name:${character.author.trim().toLowerCase()}`,
    createdAt: character.createdAt,
    listed: true,
  });
  if (candidate) staticCandidates.set(candidate.id, candidate);
}

function stringList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || text.length > itemMax || text.includes("\0") || result.includes(text)) continue;
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

function preferenceLists(raw: string | null): { blockedTags: string[]; followedAuthorIds: string[] } {
  try {
    const value = JSON.parse(raw || "{}") as { blockedTags?: unknown; followedAuthors?: unknown };
    return { blockedTags: stringList(value.blockedTags, 50, 40), followedAuthorIds: stringList(value.followedAuthors, 200, 120) };
  } catch {
    return { blockedTags: [], followedAuthorIds: [] };
  }
}

async function bumpDaily(env: Env, characterId: string, dayKey: string, column: "impressions" | "opens" | "starts" | "qualified" | "likes" | "favorites", amount = 1) {
  const counts = { impressions: 0, opens: 0, starts: 0, qualified: 0, likes: 0, favorites: 0 };
  counts[column] = amount;
  await env.DB.prepare(UPSERT_DAILY).bind(characterId, dayKey, counts.impressions, counts.opens, counts.starts, counts.qualified, counts.likes, counts.favorites).run();
}

async function addFact(env: Env, userId: string, characterId: string, kind: FactKind, dayKey: string): Promise<boolean> {
  const inserted = await env.DB.prepare(`INSERT INTO recommendation_backfill(user_id, character_id, kind, day_key) VALUES (?,?,?,?)
    ON CONFLICT(user_id, character_id, kind) DO NOTHING`).bind(userId, characterId, kind, dayKey).run();
  if (!inserted.meta.changes) return false;
  await bumpDaily(env, characterId, dayKey, FACT_COLUMNS[kind]);
  return true;
}

async function removeFact(env: Env, userId: string, characterId: string, kind: FactKind): Promise<boolean> {
  const row = await env.DB.prepare("SELECT day_key FROM recommendation_backfill WHERE user_id=? AND character_id=? AND kind=?").bind(userId, characterId, kind).first<{ day_key: string }>();
  if (!row) return false;
  const column = FACT_COLUMNS[kind];
  await env.DB.batch([
    env.DB.prepare(`UPDATE recommendation_item_daily SET ${column}=MAX(0, ${column}-1) WHERE character_id=? AND day_key=?`).bind(characterId, row.day_key),
    env.DB.prepare("DELETE FROM recommendation_backfill WHERE user_id=? AND character_id=? AND kind=?").bind(userId, characterId, kind),
  ]);
  return true;
}

async function applyFacts(env: Env, rows: FactRow[], kind: FactKind) {
  if (!rows.length) return 0;
  const inserted = await env.DB.batch(rows.map((row) => env.DB.prepare(`INSERT INTO recommendation_backfill(user_id, character_id, kind, day_key) VALUES (?,?,?,?)
    ON CONFLICT(user_id, character_id, kind) DO NOTHING`).bind(row.user_id, row.character_id, kind, row.day_key)));
  const totals = new Map<string, number>();
  inserted.forEach((result, index) => {
    if (!result.meta.changes) return;
    const row = rows[index]!;
    const key = `${row.character_id}\0${row.day_key}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  });
  const updates = [...totals].map(([key, amount]) => {
    const [characterId, dayKey] = key.split("\0");
    const counts = { impressions: 0, opens: 0, starts: 0, qualified: 0, likes: 0, favorites: 0 };
    counts[FACT_COLUMNS[kind]] = amount;
    return env.DB.prepare(UPSERT_DAILY).bind(characterId, dayKey, counts.impressions, counts.opens, counts.starts, counts.qualified, counts.likes, counts.favorites);
  });
  if (updates.length) await env.DB.batch(updates);
  return rows.length;
}

export async function syncRecommendationFacts(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM recommendation_events WHERE id IN (SELECT id FROM recommendation_events WHERE created_at<? LIMIT 200)")
    .bind(now - RECOMMENDATION_EVENT_RETENTION_MS).run();
  for (const [sql, kind] of [[LIKE_BACKFILL_SQL, "like"], [FAVORITE_BACKFILL_SQL, "favorite"], [QUALIFIED_BACKFILL_SQL, "qualified"]] as const) {
    for (let round = 0; round < 5; round += 1) {
      const page = await env.DB.prepare(sql).all<FactRow>();
      const wrote = await applyFacts(env, page.results, kind);
      if (wrote < 100) break;
    }
  }
  for (let round = 0; round < 5; round += 1) {
    const stale = await env.DB.prepare(LIKE_RECONCILE_SQL).all<FactRow>();
    if (!stale.results.length) break;
    await env.DB.batch(stale.results.flatMap((row) => [
      env.DB.prepare("UPDATE recommendation_item_daily SET likes=MAX(0, likes-1) WHERE character_id=? AND day_key=?").bind(row.character_id, row.day_key),
      env.DB.prepare("DELETE FROM recommendation_backfill WHERE user_id=? AND character_id=? AND kind='like'").bind(row.user_id, row.character_id),
    ]));
    if (stale.results.length < 100) break;
  }
}

async function loadCandidates(env: Env): Promise<RecommendationCandidate[]> {
  const candidates = new Map(staticCandidates);
  const published = await env.DB.prepare(`SELECT p.id AS id, p.user_id AS user_id, s.snapshot_json AS snapshot_json,
    COALESCE(s.reviewed_at, p.created_at) AS listed_at
    FROM character_publications p
    JOIN character_submissions s ON s.publication_id=p.id AND s.revision=p.approved_revision AND s.status='approved'
    WHERE p.is_listed=1 LIMIT 500`).all<{ id: string; user_id: string; snapshot_json: string; listed_at: number }>();
  for (const row of published.results) {
    let tags: string[] = [];
    try {
      const snapshot = JSON.parse(row.snapshot_json) as { tags?: unknown };
      if (Array.isArray(snapshot.tags)) tags = snapshot.tags.filter((tag): tag is string => typeof tag === "string");
    } catch { continue; }
    const candidate = toRecommendationCandidate({ id: row.id, tags, authorId: `user:${row.user_id}`, createdAt: Number(row.listed_at) || 0, listed: true });
    if (candidate) candidates.set(candidate.id, candidate);
    else candidates.delete(row.id);
  }
  return [...candidates.values()];
}

export async function loadCooccurrence(env: Env, userId: string, anchorIds: readonly string[]): Promise<Map<string, number>> {
  const support = new Map<string, number>();
  const anchors = [...new Set(anchorIds)].slice(0, 40);
  if (!anchors.length) return support;
  const rows = await env.DB.prepare(COOCCURRENCE_SQL(anchors.map(() => "?").join(","))).bind(userId, ...anchors)
    .all<{ character_id: string; support: number }>();
  for (const row of rows.results) {
    const count = Number(row.support) || 0;
    if (count > (support.get(row.character_id) ?? 0)) support.set(row.character_id, count);
  }
  return support;
}

export async function recommendForUser(env: Env, user: UserRecord, options: {
  surface: RecommendationRankSurface;
  period?: RecommendationPeriod;
  seedId?: string;
  tags?: readonly string[];
  q?: string;
  since?: number | null;
  look?: "photo" | "anime" | null;
  now?: number;
}): Promise<RecommendationResult & { hiddenIds: string[] }> {
  const now = options.now ?? Date.now();
  await syncRecommendationFacts(env, now);
  const [preference, hiddenRows, positiveRows, dailyRows, roundRows, candidates] = await Promise.all([
    env.DB.prepare("SELECT extra_json FROM preferences WHERE user_id=?").bind(user.id).first<{ extra_json: string }>(),
    env.DB.prepare("SELECT character_id FROM recommendation_hidden WHERE user_id=?").bind(user.id).all<{ character_id: string }>(),
    env.DB.prepare(POSITIVE_SQL).bind(user.id, user.id, user.id).all<{ character_id: string }>(),
    env.DB.prepare("SELECT character_id, day_key, qualified, likes, favorites FROM recommendation_item_daily").all<CountRow>(),
    env.DB.prepare("SELECT character_id, day_key, rounds FROM character_chat_rounds").all<{ character_id: string; day_key: string; rounds: number }>(),
    loadCandidates(env),
  ]);
  const lists = preferenceLists(preference?.extra_json ?? null);
  const hiddenIds = hiddenRows.results.map((row) => row.character_id);
  const positiveIds = positiveRows.results.map((row) => row.character_id);
  const daily = new Map<string, RecommendationDaily[]>();
  for (const row of dailyRows.results) {
    const bucket = daily.get(row.character_id) ?? [];
    bucket.push({ day: row.day_key, qualified: Number(row.qualified) || 0, likes: Number(row.likes) || 0, favorites: Number(row.favorites) || 0 });
    daily.set(row.character_id, bucket);
  }
  for (const row of roundRows.results) {
    const bucket = daily.get(row.character_id) ?? [];
    const existing = bucket.find((item) => item.day === row.day_key);
    const rounds = Number(row.rounds) || 0;
    if (existing) existing.rounds = rounds;
    else bucket.push({ day: row.day_key, qualified: 0, likes: 0, favorites: 0, rounds });
    daily.set(row.character_id, bucket);
  }
  const anchors = options.surface === "related" && options.seedId ? [options.seedId] : positiveIds.slice(0, 40);
  const cooccurrence = await loadCooccurrence(env, user.id, anchors);
  const allowedIds = options.surface === "search" || options.surface === "category"
    ? options.surface === "search" && !options.q
      ? []
      : await listCatalogMatchIds(env, { q: options.q, tags: options.tags, since: options.since, look: options.look })
    : undefined;
  const ranked = rankXumengRecommendations({
    surface: options.surface, now, period: options.period, seedId: options.seedId,
    blockedTags: lists.blockedTags, followedAuthorIds: lists.followedAuthorIds,
    hiddenIds, positiveIds, candidates, daily, cooccurrence,
    tags: options.surface === "home" ? options.tags : undefined,
    allowedIds,
  });
  return { ...ranked, hiddenIds };
}

type IncomingEvent = { characterId: string; surface: RecommendationSurface; action: RecommendationAction; position?: number };

function readEvents(body: Record<string, unknown>): IncomingEvent[] {
  if (!Array.isArray(body.events)) throw new ApiError(400, "请提供要记录的行为。");
  if (body.events.length > 40) throw new ApiError(400, "一次最多记录 40 条行为。");
  const events: IncomingEvent[] = [];
  for (const value of body.events) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const characterId = record.characterId;
    const surface = record.surface;
    const action = record.action;
    if (typeof characterId !== "string" || !RECOMMENDATION_CHARACTER_ID.test(characterId)) continue;
    if (typeof surface !== "string" || !RECOMMENDATION_SURFACES.includes(surface as RecommendationSurface)) continue;
    if (typeof action !== "string" || !RECOMMENDATION_ACTIONS.includes(action as RecommendationAction)) continue;
    const position = record.position;
    if (position !== undefined && (!Number.isInteger(position) || Number(position) < 0 || Number(position) > 500)) continue;
    events.push({ characterId, surface: surface as RecommendationSurface, action: action as RecommendationAction, ...(position === undefined ? {} : { position: Number(position) }) });
  }
  return events;
}

async function seenToday(env: Env, userId: string, event: IncomingEvent, dayStart: number): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS found FROM recommendation_events
    WHERE user_id=? AND character_id=? AND surface=? AND action=? AND created_at>=? LIMIT 1`)
    .bind(userId, event.characterId, event.surface, event.action, dayStart).first<{ found: number }>();
  return Boolean(row);
}

async function insertEvent(env: Env, userId: string, event: IncomingEvent, now: number) {
  await env.DB.prepare("INSERT INTO recommendation_events(user_id, character_id, surface, action, position, created_at) VALUES (?,?,?,?,?,?)")
    .bind(userId, event.characterId, event.surface, event.action, event.position ?? null, now).run();
}

export async function recordRecommendationEvents(env: Env, userId: string, events: IncomingEvent[], now = Date.now()): Promise<number> {
  await syncRecommendationFacts(env, now);
  const dayStart = recommendationDayStart(recommendationDay(now));
  const dayKey = recommendationDay(now);
  let accepted = 0;
  for (const event of events) {
    if (event.action === "depth") {
      const count = await env.DB.prepare(`SELECT COALESCE(SUM(m.role='user'), 0) AS total FROM messages m
        JOIN conversations c ON c.user_id=m.user_id AND c.id=m.conversation_id
        WHERE c.user_id=? AND c.character_id=?`).bind(userId, event.characterId).first<{ total: number }>();
      if ((Number(count?.total) || 0) < QUALIFIED_USER_MESSAGES) continue;
      const added = await addFact(env, userId, event.characterId, "qualified", dayKey);
      if (!added && await seenToday(env, userId, event, dayStart)) continue;
      if (added || !(await seenToday(env, userId, event, dayStart))) await insertEvent(env, userId, event, now);
      accepted += 1;
      continue;
    }
    if ((event.action === "impression" || event.action === "open" || event.action === "start" || event.action === "hide") && await seenToday(env, userId, event, dayStart)) {
      if (event.action === "hide") await env.DB.prepare("INSERT INTO recommendation_hidden(user_id, character_id, created_at) VALUES (?,?,?) ON CONFLICT(user_id, character_id) DO NOTHING").bind(userId, event.characterId, now).run();
      if (event.action === "start") await markAcquisitionStarted(env, userId, now);
      continue;
    }
    if (event.action === "start") await markAcquisitionStarted(env, userId, now);
    if (event.action === "favorite") await addFact(env, userId, event.characterId, "favorite", dayKey);
    if (event.action === "unfavorite") await removeFact(env, userId, event.characterId, "favorite");
    if (event.action === "hide") await env.DB.prepare("INSERT INTO recommendation_hidden(user_id, character_id, created_at) VALUES (?,?,?) ON CONFLICT(user_id, character_id) DO NOTHING").bind(userId, event.characterId, now).run();
    if (event.action === "impression" || event.action === "open" || event.action === "start") {
      const column = event.action === "impression" ? "impressions" : event.action === "open" ? "opens" : "starts";
      await bumpDaily(env, event.characterId, dayKey, column);
    }
    await insertEvent(env, userId, event, now);
    accepted += 1;
  }
  return accepted;
}

function readRankFilter(url: URL): { tags: string[]; q: string; since: number | null; look: "photo" | "anime" | null } {
  const rawQuery = url.searchParams.get("q") ?? "";
  if (rawQuery.length > 40 || rawQuery.includes("\0")) throw new ApiError(400, "搜索词无效。");
  const tags = (url.searchParams.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 8 || tags.some((tag) => tag.length > 40 || /[\0,%]/.test(tag))) throw new ApiError(400, "标签无效。");
  const sinceRaw = url.searchParams.get("since");
  let since: number | null = null;
  if (sinceRaw) {
    if (!/^\d+$/.test(sinceRaw)) throw new ApiError(400, "时间范围无效。");
    since = Number(sinceRaw);
    if (since > 10_000_000_000_000) throw new ApiError(400, "时间范围无效。");
  }
  const lookRaw = url.searchParams.get("look");
  if (lookRaw && lookRaw !== "photo" && lookRaw !== "anime") throw new ApiError(400, "画面类型无效。");
  return {
    tags: [...new Set(tags)],
    q: rawQuery.trim().toLocaleLowerCase().replace(/[%_]/g, ""),
    since,
    look: lookRaw === "photo" || lookRaw === "anime" ? lookRaw : null,
  };
}

export async function handleRecommendations(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/recommendations" && request.method === "GET") {
    await rateLimit(request, env, "recommendation-read", 180, user.id);
    const surface = url.searchParams.get("surface");
    if (!surface || !RECOMMENDATION_RANK_SURFACES.includes(surface as RecommendationRankSurface)) throw new ApiError(400, "推荐入口无效。");
    const periodValue = url.searchParams.get("period");
    if (periodValue && !RECOMMENDATION_PERIODS.includes(periodValue as RecommendationPeriod)) throw new ApiError(400, "榜单周期无效。");
    const seed = url.searchParams.get("seed") || undefined;
    if (surface === "related" && (!seed || !RECOMMENDATION_CHARACTER_ID.test(seed))) throw new ApiError(400, "请提供当前角色。");
    const filter = readRankFilter(url);
    const result = await recommendForUser(env, user, {
      surface: surface as RecommendationRankSurface,
      period: (periodValue || "week") as RecommendationPeriod,
      seedId: seed,
      tags: filter.tags,
      q: filter.q,
      since: filter.since,
      look: filter.look,
    });
    return json(result);
  }
  if (url.pathname === "/v1/recommendations/events" && request.method === "POST") {
    await rateLimit(request, env, "recommendation-events", 300, user.id);
    const events = readEvents(await readJson(request, 16_384));
    if (!events.length) throw new ApiError(400, "没有可记录的行为。");
    const accepted = await recordRecommendationEvents(env, user.id, events);
    return json({ accepted });
  }
  return null;
}
