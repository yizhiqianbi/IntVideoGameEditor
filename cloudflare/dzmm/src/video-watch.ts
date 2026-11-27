import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

export const VIDEO_EPISODE_CREDITS = 50;
/** 每部短剧前 3 集免费试看。 */
export const VIDEO_FREE_EPISODES = 3;

const EPISODE = /^hg-([0-9]{4,8})-([0-9]{1,3})$/;

export function videoEpisodeTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const episodeId = (value as { episodeId?: unknown }).episodeId;
  const match = typeof episodeId === "string" ? EPISODE.exec(episodeId) : null;
  if (!match) return null;
  const episodeNumber = Number(match[2]);
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 999) return null;
  return { episodeId, dramaId: `hg-${match[1]}`, episodeNumber };
}

const PLAY_GAP_MS = 10 * 60 * 1000;
const PLAY_HOUR_CAP = 240;

export async function handleVideoWatch(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/v1/videos/play") return recordPlay(request, env, user);
  if (path !== "/v1/videos/unlock" && path !== "/v1/videos/unlocks") return null;
  if (user.isGuest) throw new ApiError(403, "请先登录后再观看后续剧集。");
  if (path === "/v1/videos/unlocks") {
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    const dramaId = url.searchParams.get("dramaId") ?? "";
    if (!/^hg-[0-9]{4,8}$/.test(dramaId)) throw new ApiError(400, "短剧编号无效。");
    const rows = await env.DB.prepare("SELECT episode_id FROM video_episode_unlocks WHERE user_id=? AND drama_id=? ORDER BY episode_number")
      .bind(user.id, dramaId).all<{ episode_id: string }>();
    return json({ episodeIds: rows.results.map(row => row.episode_id) });
  }
  if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
  const target = videoEpisodeTarget(await readJson(request, 2048));
  if (!target) throw new ApiError(400, "剧集编号无效。");
  if (target.episodeNumber <= VIDEO_FREE_EPISODES) return json({ unlocked: true, chargedCredits: 0, balance: await balance(env, user.id) });
  const now = Date.now();
  const vip = await env.DB.prepare(`SELECT 1 AS ok FROM subscription_periods WHERE user_id=? AND revoked_at IS NULL AND starts_at<=? AND expires_at>? LIMIT 1`)
    .bind(user.id, now, now).first<{ ok: number }>();
  if (vip) return json({ unlocked: true, chargedCredits: 0, vip: true, balance: await balance(env, user.id) });
  const inserted = await env.DB.prepare(`INSERT INTO video_episode_unlocks(user_id,episode_id,drama_id,episode_number,credits,created_at)
    SELECT ?1,?2,?3,?4,${VIDEO_EPISODE_CREDITS},?5
    WHERE EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_guest=0)
    AND EXISTS(SELECT 1 FROM credit_usage_balances WHERE user_id=?1 AND balance>=${VIDEO_EPISODE_CREDITS})
    AND NOT EXISTS(SELECT 1 FROM video_episode_unlocks WHERE user_id=?1 AND episode_id=?2)`)
    .bind(user.id, target.episodeId, target.dramaId, target.episodeNumber, now).run();
  if (inserted.meta.changes === 1) return json({ unlocked: true, chargedCredits: VIDEO_EPISODE_CREDITS, balance: await balance(env, user.id) });
  const owned = await env.DB.prepare("SELECT 1 AS ok FROM video_episode_unlocks WHERE user_id=? AND episode_id=?").bind(user.id, target.episodeId).first();
  if (owned) return json({ unlocked: true, chargedCredits: 0, balance: await balance(env, user.id) });
  const wallet = await env.DB.prepare("SELECT balance FROM credit_usage_balances WHERE user_id=?").bind(user.id).first<{ balance: number }>();
  throw new ApiError(402, `当前金币不足，这一集需要 ${VIDEO_EPISODE_CREDITS} 金币。`, {
    code: "insufficient_credits", requiredCredits: VIDEO_EPISODE_CREDITS, availableCredits: Number(wallet?.balance ?? 0),
  });
}

async function recordPlay(request: Request, env: Env, user: UserRecord) {
  if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
  const target = videoEpisodeTarget(await readJson(request, 2048));
  if (!target) throw new ApiError(400, "剧集编号无效。");
  const access = await playAccess(env, user, target);
  if (!access) throw new ApiError(402, "这一集还没有解锁。");
  const now = Date.now();
  try {
    await env.DB.prepare(`INSERT INTO video_plays(id,user_id,episode_id,drama_id,episode_number,access,created_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7
      WHERE NOT EXISTS(SELECT 1 FROM video_plays WHERE user_id=?2 AND episode_id=?3 AND created_at>?8)
      AND (SELECT COUNT(*) FROM video_plays WHERE user_id=?2 AND created_at>?9)<${PLAY_HOUR_CAP}`)
      .bind(crypto.randomUUID(), user.id, target.episodeId, target.dramaId, target.episodeNumber, access, now, now - PLAY_GAP_MS, now - 60 * 60 * 1000).run();
  } catch (error) {
    if (!String(error).includes("no such table")) throw error;
  }
  return json({ recorded: true });
}

async function playAccess(env: Env, user: UserRecord, target: { episodeId: string; episodeNumber: number }) {
  if (target.episodeNumber <= VIDEO_FREE_EPISODES) return "free" as const;
  const owned = await env.DB.prepare("SELECT 1 AS ok FROM video_episode_unlocks WHERE user_id=? AND episode_id=?").bind(user.id, target.episodeId).first();
  if (owned) return "paid" as const;
  const now = Date.now();
  const vip = await env.DB.prepare("SELECT 1 AS ok FROM subscription_periods WHERE user_id=? AND revoked_at IS NULL AND starts_at<=? AND expires_at>? LIMIT 1")
    .bind(user.id, now, now).first();
  if (vip) return "vip" as const;
  return null;
}

async function balance(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT balance FROM credit_usage_balances WHERE user_id=?").bind(userId).first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}
