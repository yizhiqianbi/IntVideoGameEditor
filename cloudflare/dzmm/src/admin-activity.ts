import { json } from "./http";
import type { Env, UserRecord } from "./types";

const DAY = 86_400_000;
const SCENES = `SELECT 'chat:' || r.id AS id, r.user_id AS user_id, u.nickname AS nickname, 'chat' AS scene, COALESCE(NULLIF(r.model,''), r.operation) AS detail, -l.credits AS credits, l.created_at AS created_at
  FROM credit_usage_ledger l JOIN credit_usage_requests r ON r.id=l.usage_id JOIN users u ON u.id=r.user_id
  WHERE l.kind='charge' AND l.credits<0
  UNION ALL
  SELECT 'unlock:' || v.user_id || ':' || v.episode_id, v.user_id, u.nickname, 'video_unlock', v.episode_id, v.credits, v.created_at
  FROM video_episode_unlocks v JOIN users u ON u.id=v.user_id
  UNION ALL
  SELECT 'media:' || m.id, m.user_id, u.nickname, CASE m.kind WHEN 'audio' THEN 'chat_audio' ELSE 'chat_image' END, m.kind, m.credits, m.created_at
  FROM chat_media_usage m JOIN users u ON u.id=m.user_id
  WHERE m.status='ready' AND m.credits>0
  UNION ALL
  SELECT 'canvas:' || c.id, c.user_id, u.nickname, CASE c.kind WHEN 'video' THEN 'canvas_video' ELSE 'canvas_image' END, c.kind || ' ' || c.seconds || 's', c.credits, c.created_at
  FROM canvas_generation_charges c JOIN users u ON u.id=c.user_id
  WHERE c.status='charged' AND c.credits>0
  UNION ALL
  SELECT 'gen:' || l.job_id, l.user_id, u.nickname, CASE j.kind WHEN 'video' THEN 'generation_video' ELSE 'generation_image' END, j.kind, -l.credits, l.created_at
  FROM generation_credit_ledger l JOIN generation_jobs j ON j.id=l.job_id JOIN users u ON u.id=l.user_id
  WHERE l.kind='charge' AND l.credits<0
  UNION ALL
  SELECT 'call:' || c.id, c.user_id, u.nickname, 'call', c.kind, c.credits, COALESCE(c.finalized_at, c.created_at)
  FROM call_charges c JOIN users u ON u.id=c.user_id
  WHERE c.status='charged' AND c.credits>0
  UNION ALL
  SELECT 'companion:' || l.reservation_id, l.user_id, u.nickname, 'companion', l.outcome, -l.credits, l.created_at
  FROM companion_turn_ledger l JOIN users u ON u.id=l.user_id
  WHERE l.kind='charge' AND l.credits<0
  UNION ALL
  SELECT 'still:' || s.id, s.user_id, u.nickname, 'studio_still', s.template_id, s.credits, COALESCE(s.finalized_at, s.created_at)
  FROM studio_still_charges s JOIN users u ON u.id=s.user_id
  WHERE s.status='charged' AND s.credits>0`;

type WatchRow = { id: string; user_id: string; nickname: string; drama_id: string; episode_id: string; episode_number: number; kind: string; credits: number; created_at: number };
type SpendRow = { id: string; user_id: string; nickname: string; scene: string; detail: string; credits: number; created_at: number };
type HotRow = { user_id: string; nickname: string; events: number; credits: number };

function page(url: URL) {
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("page");
  }
  const userId = url.searchParams.get("userId");
  if (userId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId)) throw new Error("page");
  const allowed = ["limit", "offset", "userId"];
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) throw new Error("page");
  return { limit, offset, userId };
}

async function hasPlays(env: Env) {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='video_plays'").first<{ ok: number }>();
  return Boolean(row);
}

function watchSource(plays: boolean) {
  const unlocks = `SELECT v.user_id || ':' || v.episode_id AS id, v.user_id, u.nickname, v.drama_id, v.episode_id, v.episode_number, 'unlock' AS kind, v.credits, v.created_at
    FROM video_episode_unlocks v JOIN users u ON u.id=v.user_id`;
  if (!plays) return unlocks;
  return `${unlocks} UNION ALL
    SELECT p.id, p.user_id, u.nickname, p.drama_id, p.episode_id, p.episode_number, p.access, 0, p.created_at
    FROM video_plays p JOIN users u ON u.id=p.user_id`;
}

export async function handleAdminActivity(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/v1/admin/watches" && path !== "/v1/admin/spends") return null;
  if (request.method !== "GET") return json({ error: "此接口仅支持 GET。" }, 405);
  let query: ReturnType<typeof page>;
  try { query = page(url); } catch { return json({ error: "管理查询参数无效。" }, 400); }
  const filter = query.userId;
  if (path === "/v1/admin/spends") return spends(env, user, query.limit, query.offset, filter);
  return watches(env, user, query.limit, query.offset, filter);
}

async function watches(env: Env, user: UserRecord, limit: number, offset: number, filter: string | null) {
  const source = watchSource(await hasPlays(env));
  const since = Date.now() - DAY;
  const [listed, hot] = await Promise.all([
    env.DB.batch([
      env.DB.prepare(`SELECT * FROM (${source}) WHERE (? IS NULL OR user_id=?) ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(filter, filter, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM (${source}) WHERE (? IS NULL OR user_id=?)`).bind(filter, filter),
    ]),
    env.DB.prepare(`SELECT user_id, MAX(nickname) AS nickname, COUNT(*) AS events, SUM(credits) AS credits FROM (${source}) WHERE created_at>=? GROUP BY user_id ORDER BY events DESC, credits DESC LIMIT 8`).bind(since).all<HotRow>(),
  ]);
  const rows = listed[0].results as WatchRow[];
  const total = Number((listed[1].results[0] as { n: number }).n);
  return json({
    accountId: user.id,
    items: rows.map(row => ({
      id: row.id, userId: row.user_id, nickname: row.nickname || "用户", dramaId: row.drama_id, episodeId: row.episode_id,
      episodeNumber: row.episode_number, kind: row.kind, credits: row.credits, createdAt: row.created_at,
    })),
    hot: hot.results.map(row => ({ userId: row.user_id, nickname: row.nickname || "用户", events: Number(row.events), credits: Number(row.credits) })),
    note: "这里是站内打开和付费解锁。视频文件地址目前是公开的，绕过页面直接下载不会出现在这张表里。",
    total, limit, offset, hasMore: offset + limit < total,
  });
}

async function spends(env: Env, user: UserRecord, limit: number, offset: number, filter: string | null) {
  const listed = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM (${SCENES}) WHERE (? IS NULL OR user_id=?) ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(filter, filter, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${SCENES}) WHERE (? IS NULL OR user_id=?)`).bind(filter, filter),
  ]);
  const rows = listed[0].results as SpendRow[];
  const total = Number((listed[1].results[0] as { n: number }).n);
  return json({
    accountId: user.id,
    items: rows.map(row => ({
      id: row.id, userId: row.user_id, nickname: row.nickname || "用户", scene: row.scene,
      detail: String(row.detail || row.scene).slice(0, 80), credits: Number(row.credits), createdAt: row.created_at,
    })),
    total, limit, offset, hasMore: offset + limit < total,
  });
}
