import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";
import type { DzmmTaskCenter, DzmmTaskClaim, DzmmTaskClaimResult, DzmmTaskId } from "../../../src/lib/dzmm-tasks";

const DAY = 24 * 60 * 60 * 1000;
const REWARD_VALIDITY = 30 * DAY;
const TASKS: Array<{ id: DzmmTaskId; title: string; description: string; points: number; target: number }> = [
  { id: "daily_checkin", title: "每日签到", description: "每天回来签到领取 5 Credit，北京时间 08:00 重置。", points: 5, target: 1 },
  { id: "first_conversation", title: "和角色说第一句话", description: "选一个喜欢的角色，发送第一句话并保存对话。", points: 5, target: 1 },
  { id: "publish_character", title: "发布你的第一个角色", description: "创建一个原创角色，审核通过并上架后领取奖励。", points: 20, target: 1 },
  { id: "follow_authors", title: "关注五位作者", description: "在角色广场关注 5 位作者，解锁更多故事。", points: 5, target: 5 },
  { id: "complete_profile", title: "写下个人介绍", description: "写一句自我介绍，让你的个人主页更完整。", points: 5, target: 1 },
  { id: "forum_reply", title: "在广场留下足迹", description: "回复一条帖子，和其他创作者打个招呼。", points: 5, target: 1 },
];
const TASK_IDS = new Set(TASKS.map(task => task.id));
// SQLite trim's default only removes ASCII spaces; match JavaScript trim for saved text.
const WHITESPACE = "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
const PREFERENCES_JSON = "CASE WHEN json_valid(p.extra_json) THEN p.extra_json ELSE '{}' END";
const CONDITIONS: Record<DzmmTaskId, string> = {
  daily_checkin: "1",
  first_conversation: "EXISTS(SELECT 1 FROM messages m WHERE m.user_id=u.id AND m.role='user')",
  publish_character: "EXISTS(SELECT 1 FROM character_publications p JOIN character_submissions s ON s.publication_id=p.id AND s.revision=p.approved_revision WHERE p.user_id=u.id AND p.is_listed=1 AND s.status='approved')",
  follow_authors: `COALESCE((SELECT COUNT(DISTINCT trim(value,${WHITESPACE})) FROM preferences p,json_each(${PREFERENCES_JSON},'$.followedAuthors') WHERE p.user_id=u.id AND json_type(${PREFERENCES_JSON},'$.followedAuthors')='array' AND type='text' AND length(trim(value,${WHITESPACE}))>0),0)`,
  complete_profile: `EXISTS(SELECT 1 FROM preferences p WHERE p.user_id=u.id AND json_type(${PREFERENCES_JSON},'$.bio')='text' AND length(trim(json_extract(${PREFERENCES_JSON},'$.bio'),${WHITESPACE}))>0)`,
  forum_reply: "EXISTS(SELECT 1 FROM forum_replies r WHERE r.user_id=u.id)",
};
type ClaimRow = { task_id: DzmmTaskId; period: string; points: number; claimed_at: number; expires_at: number | null };
function toClaim(row: ClaimRow): DzmmTaskClaim {
  // Community rewards are now spendable chat Credit and do not expire. Keep
  // the legacy expiry column in the audit tables, but do not expose it as a
  // wallet expiry to clients.
  return { taskId: row.task_id, period: row.period, points: row.points, claimedAt: row.claimed_at, expiresAt: null };
}
function period(taskId: DzmmTaskId, now: number) { return taskId === "daily_checkin" ? new Date(now).toISOString().slice(0, 10) : "once"; }

/** One consistent D1 snapshot contains conditions, claims and balances, all scoped to this account. */
export async function readTaskCenter(env: Env, user: UserRecord, now = Date.now()): Promise<DzmmTaskCenter> {
  const result = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT u.is_guest,${TASKS.map(task => `${CONDITIONS[task.id]} AS ${task.id}`).join(",")} FROM users u WHERE u.id=?`).bind(user.id),
    env.DB.prepare("SELECT task_id,period,points,claimed_at,expires_at FROM task_claims WHERE user_id=? AND (task_id<>'daily_checkin' OR period=?)").bind(user.id, period("daily_checkin", now)),
    env.DB.prepare(`SELECT COALESCE(SUM(points),0) AS total_earned,
      COALESCE(SUM(points),0) AS balance,
      0 AS expired,
      0 AS expiring_soon,
      NULL AS earliest_expiry_at FROM (
        SELECT user_id,points,expires_at FROM task_claims
        UNION ALL SELECT user_id,points,expires_at FROM task_market_rewards
        UNION ALL SELECT user_id,points,expires_at FROM referral_rewards
      ) WHERE user_id=?1`).bind(user.id),
    env.DB.prepare("SELECT task_id,period,points,claimed_at,expires_at FROM task_claims WHERE user_id=? ORDER BY claimed_at DESC,task_id,period LIMIT 20").bind(user.id),
    env.DB.prepare("SELECT balance FROM credit_usage_balances WHERE user_id=?").bind(user.id),
  ]);
  const progress = result[0].results[0];
  if (!progress) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const isGuest = Boolean(progress.is_guest);
  const claims = new Map((result[1].results as unknown as ClaimRow[]).map(row => [row.task_id, toClaim(row)]));
  const rewardStats = result[2].results[0] as Record<string, number | null>;
  const wallet = result[4].results[0] as { balance: number } | undefined;
  if (!wallet || !Number.isSafeInteger(Number(wallet.balance)) || Number(wallet.balance) < 0)
    throw new ApiError(503, "Credit 钱包余额需要核对，请稍后重试。");
  return {
    accountId: user.id, isGuest, serverTime: now, resetAt: (Math.floor(now / DAY) + 1) * DAY, timezone: "UTC",
    pointsKind: "credit", modelBillingLinked: true, rewardUnit: "Credit", note: "任务和邀请奖励会直接计入聊天 Credit 钱包，可用于聊天与记忆；Credit 到账后长期有效。",
    points: { balance: Number(wallet.balance), totalEarned: Number(rewardStats.total_earned), expired: Number(rewardStats.expired),
      expiringSoon: Number(rewardStats.expiring_soon), earliestExpiryAt: rewardStats.earliest_expiry_at === null ? null : Number(rewardStats.earliest_expiry_at) },
    tasks: TASKS.map(task => {
      const claim = claims.get(task.id);
      const currentProgress = Math.min(Number(progress[task.id]), task.target);
      const eligible = currentProgress >= task.target;
      return { id: task.id, title: task.title, description: task.description, rewardPoints: task.points,
        repeat: task.id === "daily_checkin" ? "daily" : "once", expiresAfterDays: null,
        period: period(task.id, now), progress: currentProgress, target: task.target, eligible, claimed: Boolean(claim),
        claimable: !isGuest && eligible && !claim, claimedAt: claim?.claimedAt ?? null, rewardExpiresAt: claim?.expiresAt ?? null };
    }),
    recentClaims: (result[3].results as unknown as ClaimRow[]).map(toClaim),
  };
}

export async function handleTasks(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path !== "/v1/tasks" && !path.startsWith("/v1/tasks/")) return null;
  if (path === "/v1/tasks") {
    if (request.method !== "GET") throw new ApiError(405, "任务进度仅支持 GET。");
    return json(await readTaskCenter(env, user));
  }
  const match = /^\/v1\/tasks\/([^/]+)\/claim$/.exec(path);
  if (!match || !TASK_IDS.has(match[1] as DzmmTaskId)) throw new ApiError(404, "任务不存在。");
  if (request.method !== "POST") throw new ApiError(405, "领取任务奖励仅支持 POST。");
  const body = await readJson(request, 2048);
  if (typeof body.accountId !== "string" || body.accountId !== user.id) throw new ApiError(401, "当前账户已切换，请刷新任务中心后重试。");
  if (Object.keys(body).some(key => key !== "accountId")) throw new ApiError(400, "任务进度、奖励与领取日期只能由服务端确定。");
  if (user.isGuest) throw new ApiError(403, "请先注册或登录，再领取 Credit 奖励。");
  await rateLimit(request, env, "tasks-claim-account", 90, user.id);
  await rateLimit(request, env, "tasks-claim-ip", 300);
  const taskId = match[1] as DzmmTaskId;
  const task = TASKS.find(candidate => candidate.id === taskId)!;
  const now = Date.now();
  const claimPeriod = period(taskId, now);
  // Keep the legacy task table's daily expiry invariant for audit and
  // eligibility compatibility; the Credit projection remains permanent.
  const expiresAt = taskId === "daily_checkin" ? now + REWARD_VALIDITY : null;
  // Conditions are rechecked within the insertion statement, so a concurrent
  // delete/takedown/profile change cannot earn rewards based on a stale GET.
  const inserted = await env.DB.prepare(`INSERT INTO task_claims(user_id,task_id,period,points,claimed_at,expires_at)
    SELECT u.id,?2,?3,?4,?5,?6 FROM users u WHERE u.id=?1 AND u.is_guest=0 AND (${CONDITIONS[taskId]})>=?7
    ON CONFLICT(user_id,task_id,period) DO NOTHING RETURNING user_id`).bind(user.id, taskId, claimPeriod, task.points, now, expiresAt, task.target).first<{ user_id: string }>();
  const center = await readTaskCenter(env, user);
  const claimed = await env.DB.prepare("SELECT task_id,period,points,claimed_at,expires_at FROM task_claims WHERE user_id=? AND task_id=? AND period=?")
    .bind(user.id, taskId, claimPeriod).first<ClaimRow>();
  if (!inserted) {
    if (claimed) throw new ApiError(409, "这项任务奖励已领取。", { center });
    if (center.isGuest) throw new ApiError(403, "请先注册或登录，再领取 Credit 奖励。");
    throw new ApiError(400, "任务条件尚未完成，请先完成任务再领取奖励。", { center });
  }
  if (!claimed) throw new ApiError(409, "任务状态已改变，请刷新任务中心后重试。");
  const response: DzmmTaskClaimResult = { ...center, claim: toClaim(claimed) };
  return json(response, 201);
}
