import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { ApiError, json } from "./http";
import type { Env, UserRecord } from "./types";

export const REFERRAL_SIGNUP_POINTS = 20;
export const REFERRAL_ACTIVITY_POINTS = 500;
export const REFERRAL_ACTIVITY_DAYS = 3;
/** Immediate registration grant. Later active days are recorded separately. */
export const REFERRAL_REWARD_POINTS = REFERRAL_SIGNUP_POINTS;
const CODE = /^[A-Z0-9]{6,64}$/;

/** Stable code for an account. The UUID makes this unique without exposing a
 * mutable nickname or requiring a second secret to be stored. */
export function referralCodeForUser(userId: string): string {
  return `XM${userId.replace(/-/g, "").toUpperCase().slice(0, 30)}`;
}

export function normalizeReferralCode(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 80 || value.includes("\0")) {
    throw new ApiError(400, "邀请码格式不正确。");
  }
  const code = value.trim().toUpperCase();
  if (!CODE.test(code)) throw new ApiError(400, "邀请码格式不正确。");
  return code;
}

/** Accept both names while clients migrate from inviteCode to referralCode. */
export function referralCodeFromBody(body: Record<string, unknown>): string | null {
  const a = normalizeReferralCode(body.inviteCode);
  const b = normalizeReferralCode(body.referralCode);
  if (a && b && a !== b) throw new ApiError(400, "邀请码只能填写一个。");
  return a ?? b;
}

export async function findInviter(env: Pick<Env, "DB">, code: string, inviteeId?: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE referral_code=? AND is_guest=0")
    .bind(code).first<{ id: string }>();
  if (!row || (inviteeId && row.id === inviteeId)) throw new ApiError(400, "邀请码无效或不能邀请自己。");
  return row.id;
}

/** Stamp the first-touch row when this account finishes registration. */
export function acquisitionRegisteredStatement(
  env: Pick<Env, "DB">,
  userId: string,
  nonce: string,
  now: number,
  challengeId?: string,
): D1PreparedStatement {
  if (challengeId) {
    return env.DB.prepare(`UPDATE acquisition_touches SET registered_at=?
      WHERE user_id=? AND registered_at IS NULL
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_guest=0 AND mutation_token=?)
        AND EXISTS(SELECT 1 FROM email_auth_challenges WHERE id=? AND claim_nonce=? AND registered=1)`)
      .bind(now, userId, userId, nonce, challengeId, nonce);
  }
  return env.DB.prepare(`UPDATE acquisition_touches SET registered_at=?
    WHERE user_id=? AND registered_at IS NULL
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_guest=0 AND mutation_token=?)`)
    .bind(now, userId, userId, nonce);
}

/** Statements appended to the account-registration transaction. */
export function referralRewardStatements(
  env: Pick<Env, "DB">,
  code: string | null,
  inviteeId: string,
  registrationNonce: string,
  createdAt: number,
): D1PreparedStatement[] {
  if (!code) return [];
  const referralId = crypto.randomUUID();
  return [
    env.DB.prepare(`INSERT INTO referral_events(id,inviter_id,invitee_id,referral_code,created_at,reward_schedule)
      SELECT ?,u.id,?,?,?,'staged' FROM users u
      WHERE u.referral_code=? AND u.is_guest=0 AND u.id<>?
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_guest=0 AND mutation_token=?)
      ON CONFLICT(invitee_id) DO NOTHING`)
      .bind(referralId, inviteeId, code, createdAt, code, inviteeId, inviteeId, registrationNonce),
    env.DB.prepare(`INSERT INTO referral_rewards(referral_id,user_id,points,created_at,expires_at)
      SELECT id,inviter_id,?, ?,NULL FROM referral_events
      WHERE id=? AND invitee_id=? AND reward_schedule='staged'
      ON CONFLICT(referral_id) DO NOTHING`)
      .bind(REFERRAL_SIGNUP_POINTS, createdAt, referralId, inviteeId),
  ];
}

async function ensureCode(env: Pick<Env, "DB">, user: UserRecord): Promise<string> {
  const existing = await env.DB.prepare("SELECT referral_code FROM users WHERE id=? AND is_guest=0")
    .bind(user.id).first<{ referral_code: string | null }>();
  if (!existing) throw new ApiError(401, "登录状态已失效，请重新登录。");
  if (existing.referral_code) return existing.referral_code;
  const code = referralCodeForUser(user.id);
  await env.DB.prepare("UPDATE users SET referral_code=? WHERE id=? AND is_guest=0 AND referral_code IS NULL")
    .bind(code, user.id).run();
  const row = await env.DB.prepare("SELECT referral_code FROM users WHERE id=?")
    .bind(user.id).first<{ referral_code: string | null }>();
  if (!row?.referral_code) throw new ApiError(409, "邀请码生成失败，请稍后重试。");
  return row.referral_code;
}

/** One Credit grant for the inviter when this invitee finishes a successful
 * round. The same Beijing day and days after the third are ignored. Legacy
 * invitations are not included. */
export function referralActivityStatement(
  env: Pick<Env, "DB">,
  inviteeId: string,
  dayKey: string,
  createdAt: number,
): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO referral_activity_rewards(referral_id,day_key,user_id,points,created_at)
    SELECT e.id,?,e.inviter_id,?,? FROM referral_events e
    WHERE e.invitee_id=? AND e.reward_schedule='staged'
      AND (SELECT COUNT(*) FROM referral_activity_rewards a WHERE a.referral_id=e.id) < ?
    ON CONFLICT(referral_id, day_key) DO NOTHING`)
    .bind(dayKey, REFERRAL_ACTIVITY_POINTS, createdAt, inviteeId, REFERRAL_ACTIVITY_DAYS);
}

export async function handleReferral(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path !== "/v1/referral" && path !== "/v1/referrals") return null;
  if (request.method !== "GET") throw new ApiError(405, "邀请码信息仅支持 GET。");
  if (user.isGuest) throw new ApiError(403, "请先注册或登录，再使用邀请码。");
  const inviteCode = await ensureCode(env, user);
  const [counts, reward, funnel] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM referral_events WHERE inviter_id=?").bind(user.id).first<{ count: number }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(points),0) AS points FROM (
      SELECT points FROM referral_rewards WHERE user_id=?1
      UNION ALL SELECT points FROM referral_activity_rewards WHERE user_id=?1
    )`).bind(user.id).first<{ points: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS opens,
      COALESCE(SUM(CASE WHEN registered_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS registrations,
      COALESCE(SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS started
      FROM acquisition_touches WHERE inviter_id=?`).bind(user.id).first<{ opens: number; registrations: number; started: number }>(),
  ]);
  const invitedCount = Number(counts?.count ?? 0);
  const earnedPoints = Number(reward?.points ?? 0);
  const configuredOrigins = (env.APP_ORIGINS || "").split(/[\s,]+/).filter(Boolean);
  const requestOrigin = request.headers.get("Origin");
  const origin = requestOrigin && configuredOrigins.includes(requestOrigin)
    ? requestOrigin
    : configuredOrigins.find(value => /^https:\/\//i.test(value))
      ?? (env.PAYMENTS_RETURN_ORIGIN && /^https:\/\//i.test(env.PAYMENTS_RETURN_ORIGIN) ? env.PAYMENTS_RETURN_ORIGIN : undefined)
      ?? configuredOrigins[0]
      ?? new URL(request.url).origin;
  return json({ accountId: user.id, isGuest: user.isGuest, inviteCode,
    inviteUrl: `${origin}/?invite=${encodeURIComponent(inviteCode)}`,
    rewardPoints: REFERRAL_SIGNUP_POINTS, rewardCredits: REFERRAL_SIGNUP_POINTS,
    activityRewardPoints: REFERRAL_ACTIVITY_POINTS, activityRewardDays: REFERRAL_ACTIVITY_DAYS,
    invitedCount, earnedPoints, earnedCredits: earnedPoints, pointsKind: "credit", modelBillingLinked: true, rewardUnit: "Credit",
    successfulInvites: invitedCount, totalRewardPoints: earnedPoints, totalRewardCredits: earnedPoints,
    opens: Number(funnel?.opens ?? 0), registrations: Number(funnel?.registrations ?? 0), startedChats: Number(funnel?.started ?? 0) });
}
