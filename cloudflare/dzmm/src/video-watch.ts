import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

export const VIDEO_EPISODE_CREDITS = 50;

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

export async function handleVideoWatch(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
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
  if (target.episodeNumber === 1) return json({ unlocked: true, chargedCredits: 0, balance: await balance(env, user.id) });
  const now = Date.now();
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
  throw new ApiError(402, `当前可用 Credit 不足，这一集需要 ${VIDEO_EPISODE_CREDITS} Credit。`, {
    code: "insufficient_credits", requiredCredits: VIDEO_EPISODE_CREDITS, availableCredits: Number(wallet?.balance ?? 0),
  });
}

async function balance(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT balance FROM credit_usage_balances WHERE user_id=?").bind(userId).first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}
