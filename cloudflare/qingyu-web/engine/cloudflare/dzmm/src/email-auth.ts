import { createHmac, randomBytes, randomInt } from "node:crypto";
import { credentials, currentUser, digest, hashPassword, normalizeEmail, rateLimit, SESSION_AGE, sessionCookie, tokenFrom, toUser, type UserRow } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env } from "./types";
import { emailSignupCreditStatement } from "./signup-credits";
import { referralCodeForUser, referralCodeFromBody, findInviter, referralRewardStatements } from "./referrals";

const EXPIRES_IN = 600;
const RESEND_AFTER = 60;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type EmailAuthOptions = { emailFetch?: (url: string, init?: RequestInit) => Promise<Response> };

function configured(env: Env): boolean {
  const provider = env.EMAIL_PROVIDER ?? "cloudflare";
  const providerConfigured = provider === "cloudflare" ? typeof env.EMAIL?.send === "function"
    : provider === "resend" && typeof env.RESEND_API_KEY === "string" && /^re_[^\s\0]{1,4000}$/.test(env.RESEND_API_KEY);
  if (env.EMAIL_AUTH_ENABLED !== "true" || !providerConfigured
    || typeof env.EMAIL_OTP_SECRET !== "string" || env.EMAIL_OTP_SECRET.length < 32 || env.EMAIL_OTP_SECRET.includes("\0")) return false;
  try { return normalizeEmail(env.EMAIL_FROM) === env.EMAIL_FROM; } catch { return false; }
}

function requireConfiguration(env: Env): void {
  if (!configured(env)) throw new ApiError(503, "邮箱验证码登录尚未开通，请稍后再试。");
}

function codeHash(env: Env, challengeId: string, email: string, code: string): string {
  return createHmac("sha256", env.EMAIL_OTP_SECRET!).update(JSON.stringify([challengeId, email, code])).digest("hex");
}

function allowedFields(body: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(body).some(key => !fields.includes(key))) throw new ApiError(400, "登录请求包含不支持的字段。");
}

type CodePurpose = "login" | "password_reset";

async function deliverCode(env: Env, options: EmailAuthOptions, challengeId: string, email: string, code: string, purpose: CodePurpose = "login"): Promise<void> {
  const label = purpose === "password_reset" ? "重置密码" : "登录";
  const message = { from: env.EMAIL_FROM!, to: email, subject: `晴屿${label}验证码`,
    text: `你的晴屿${label}验证码是 ${code}，10 分钟内有效。请勿将验证码告诉他人。如果不是你发起的操作，请忽略此邮件。`,
    html: `<p>你的晴屿${label}验证码是 <strong>${code}</strong>，10 分钟内有效。</p><p>请勿将验证码告诉他人。如果不是你发起的操作，请忽略此邮件。</p>` };
  if ((env.EMAIL_PROVIDER ?? "cloudflare") === "cloudflare") {
    const delivery = await env.EMAIL!.send(message);
    if (!delivery || typeof delivery.messageId !== "string" || !delivery.messageId) throw new Error("Email delivery did not return a message ID");
    return;
  }
  const response = await (options.emailFetch ?? fetch)("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY!}`, "Content-Type": "application/json", "Idempotency-Key": challengeId },
    body: JSON.stringify(message), redirect: "manual", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > 65536) {
    await response.body?.cancel(); throw new Error("Email provider did not accept delivery");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error("Email response too large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  if (!result || typeof result !== "object" || Array.isArray(result)
    || typeof (result as { id?: unknown }).id !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test((result as { id: string }).id)) throw new Error("Email provider did not return a message ID");
}

async function requestCode(request: Request, env: Env, options: EmailAuthOptions, purpose: CodePurpose = "login"): Promise<Response> {
  requireConfiguration(env);
  const body = await readJson(request, 2048);
  allowedFields(body, ["email"]);
  const email = normalizeEmail(body.email);
  await rateLimit(request, env, "email-code-request-ip", 30);
  await rateLimit(request, env, "email-code-request-email", 10, email);
  const now = Date.now();
  const challengeId = crypto.randomUUID();
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  // Password reset requests reserve a cooldown even for unknown mailboxes so
  // the response does not disclose whether an address has an account.
  const existingOwner = purpose === "password_reset"
    ? await env.DB.prepare("SELECT id FROM users WHERE email=? AND is_guest=0 AND COALESCE(is_demo,0)=0").bind(email).first<{ id: string }>()
    : null;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO email_auth_cooldowns(email,challenge_id,requested_at) VALUES(?,?,?)
      ON CONFLICT(email) DO UPDATE SET challenge_id=excluded.challenge_id,requested_at=excluded.requested_at
      WHERE requested_at<=?`).bind(email, challengeId, now, now - RESEND_AFTER * 1000),
    env.DB.prepare(`UPDATE email_auth_challenges SET invalidated_at=? WHERE email=? AND purpose=? AND consumed_at IS NULL AND invalidated_at IS NULL
      AND EXISTS(SELECT 1 FROM email_auth_cooldowns WHERE email=? AND challenge_id=?)`).bind(now, email, purpose, email, challengeId),
    env.DB.prepare(`INSERT INTO email_auth_challenges(id,email,code_hash,created_at,expires_at,purpose)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM email_auth_cooldowns WHERE email=? AND challenge_id=?) AND (?='login' OR EXISTS(SELECT 1 FROM users WHERE email=? AND is_guest=0 AND COALESCE(is_demo,0)=0))`)
      .bind(challengeId, email, codeHash(env, challengeId, email, code), now, now + EXPIRES_IN * 1000, purpose, email, challengeId, purpose, email),
  ]);
  if (results[0].meta.changes !== 1) throw new ApiError(429, "请等待 60 秒后再获取验证码。", { resendAfter: RESEND_AFTER });
  // Unknown password-reset addresses deliberately return the same shape and
  // status as known addresses, but never create a usable challenge or send mail.
  if (purpose === "password_reset" && !existingOwner) {
    return json({ challengeId, expiresIn: EXPIRES_IN, resendAfter: RESEND_AFTER });
  }
  try {
    await deliverCode(env, options, challengeId, email, code, purpose);
  } catch {
    // A delayed failure from an older send must never invalidate its successor.
    await env.DB.prepare("UPDATE email_auth_challenges SET send_status='failed',invalidated_at=COALESCE(invalidated_at,?) WHERE id=? AND consumed_at IS NULL")
      .bind(Date.now(), challengeId).run();
    throw new ApiError(503, "验证码邮件发送失败，请稍后重新获取。");
  }
  const sent = await env.DB.prepare("UPDATE email_auth_challenges SET send_status='sent' WHERE id=? AND send_status='pending' AND invalidated_at IS NULL AND consumed_at IS NULL")
    .bind(challengeId).run();
  if (sent.meta.changes !== 1) throw new ApiError(409, "验证码已更新，请使用最新邮件中的验证码。");
  return json({ challengeId, expiresIn: EXPIRES_IN, resendAfter: RESEND_AFTER });
}

async function verifyCode(request: Request, env: Env): Promise<Response> {
  requireConfiguration(env);
  const body = await readJson(request, 2048);
  allowedFields(body, ["email", "challengeId", "code", "nickname", "accountId", "inviteCode", "referralCode"]);
  const email = normalizeEmail(body.email);
  const referralCode = referralCodeFromBody(body);
  if (typeof body.challengeId !== "string" || !UUID.test(body.challengeId)
    || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new ApiError(400, "请输入有效的六位验证码。");
  if (body.nickname !== undefined && (typeof body.nickname !== "string" || !body.nickname.trim()
    || body.nickname.length > 30 || body.nickname.includes("\0"))) throw new ApiError(400, "昵称需要 1 至 30 个字符。");
  await rateLimit(request, env, "email-code-verify-ip", 100);
  await rateLimit(request, env, "email-code-verify-email", 30, email);
  const current = await currentUser(request, env);
  if ((current || body.accountId !== undefined) && (typeof body.accountId !== "string" || !UUID.test(body.accountId)))
    throw new ApiError(400, "请提供当前账户编号。");
  if (body.accountId !== undefined && body.accountId !== current?.id) throw new ApiError(409, "账户已切换，请刷新登录页面后重试。");
  const oldToken = tokenFrom(request);
  const oldHash = oldToken ? digest(oldToken) : "";
  const guestId = current?.isGuest ? current.id : "";
  const canCreateWithoutGuest = current === null ? 1 : 0;
  const name = typeof body.nickname === "string" ? body.nickname.trim() : current?.isGuest ? current.nickname : "晴屿用户";
  // A code only applies to a new account (or a guest being upgraded). Existing
  // mailbox owners are logging in and must not be able to mint a referral.
  const existingOwner = await env.DB.prepare("SELECT id FROM users WHERE email=? AND is_guest=0")
    .bind(email).first<{ id: string }>();
  const appliedReferralCode = referralCode && !existingOwner && (current === null || Boolean(guestId)) ? referralCode : null;
  if (appliedReferralCode) await findInviter(env, appliedReferralCode, guestId || undefined);
  const challengeId = body.challengeId.toLowerCase();
  const candidateId = crypto.randomUUID();
  const referralInviteeId = guestId || candidateId;
  const nonce = crypto.randomUUID();
  const token = Array.from(randomBytes(32), byte => byte.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  const hash = codeHash(env, challengeId, email, body.code);
  // Resolve the email owner inside the transaction. If no owner exists, the
  // original guest session must still belong to a guest before upgrading it.
  const gate = "EXISTS(SELECT 1 FROM email_auth_challenges c WHERE c.id=? AND c.claim_nonce=? AND c.target_user_id=users.id)";
  const claimed = "id=? AND claim_nonce=?";
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE email_auth_challenges SET attempts=attempts+1 WHERE id=? AND email=? AND purpose='login' AND code_hash<>?
      AND attempts<5 AND consumed_at IS NULL AND invalidated_at IS NULL AND send_status='sent' AND expires_at>?`)
      .bind(challengeId, email, hash, now),
    env.DB.prepare(`UPDATE email_auth_challenges SET attempts=attempts+1,consumed_at=?,claim_nonce=?,
      target_user_id=COALESCE((SELECT id FROM users WHERE email=? AND is_guest=0),
        (SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.is_guest=1 AND s.token_hash=? AND s.expires_at>?),?),
      registered=CASE WHEN EXISTS(SELECT 1 FROM users WHERE email=? AND is_guest=0) THEN 0 ELSE 1 END,
      legacy_reset=CASE WHEN EXISTS(SELECT 1 FROM users WHERE email=? AND is_guest=0 AND email_verified_at IS NULL) THEN 1 ELSE 0 END
      WHERE id=? AND email=? AND purpose='login' AND code_hash=? AND attempts<5 AND consumed_at IS NULL AND invalidated_at IS NULL AND send_status='sent' AND expires_at>?
      AND EXISTS(SELECT 1 FROM email_auth_cooldowns WHERE email=? AND challenge_id=email_auth_challenges.id)
      AND (EXISTS(SELECT 1 FROM users WHERE email=? AND is_guest=0) OR ?=1 OR
        EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.is_guest=1 AND s.token_hash=? AND s.expires_at>?))`)
      .bind(now, nonce, email, guestId, oldHash, now, candidateId, email, email, challengeId, email, hash, now,
        email, email, canCreateWithoutGuest, guestId, oldHash, now),
    env.DB.prepare(`INSERT INTO users(id,email,password_hash,nickname,is_guest,version,mutation_token,created_at,email_verified_at,referral_code)
      SELECT target_user_id,email,NULL,?,0,0,?,?,?,? FROM email_auth_challenges WHERE ${claimed} AND registered=1
      AND NOT EXISTS(SELECT 1 FROM users WHERE id=email_auth_challenges.target_user_id)`)
      .bind(name, nonce, now, now, referralCodeForUser(candidateId), challengeId, nonce),
    env.DB.prepare(`UPDATE users SET email=?,password_hash=NULL,nickname=?,is_guest=0,email_verified_at=?,version=version+1,mutation_token=?,referral_code=COALESCE(referral_code,?)
      WHERE id=? AND is_guest=1 AND ${gate}
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=users.id AND expires_at>?)`)
      .bind(email, name, now, nonce, referralCodeForUser(guestId), guestId, challengeId, nonce, oldHash, now),
    env.DB.prepare(`UPDATE users SET password_hash=CASE WHEN email_verified_at IS NULL THEN NULL ELSE password_hash END,
      version=version+CASE WHEN email_verified_at IS NULL THEN 1 ELSE 0 END,email_verified_at=COALESCE(email_verified_at,?),mutation_token=?
      WHERE email=? AND is_guest=0 AND ${gate}
      AND EXISTS(SELECT 1 FROM email_auth_challenges WHERE ${claimed} AND registered=0)`)
      .bind(now, nonce, email, challengeId, nonce, challengeId, nonce),
    env.DB.prepare(`UPDATE preferences SET nickname=? WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_token=?)
      AND EXISTS(SELECT 1 FROM email_auth_challenges WHERE ${claimed} AND registered=1)`)
      .bind(name, guestId, guestId, nonce, challengeId, nonce),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT target_user_id FROM email_auth_challenges WHERE ${claimed} AND (registered=1 OR legacy_reset=1))
      AND EXISTS(SELECT 1 FROM users WHERE id=sessions.user_id AND mutation_token=?)`).bind(challengeId, nonce, nonce),
    env.DB.prepare(`DELETE FROM sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM email_auth_challenges c JOIN users u ON u.id=c.target_user_id
      WHERE c.id=? AND c.claim_nonce=? AND u.mutation_token=?)`).bind(oldHash, challengeId, nonce, nonce),
    env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at)
      SELECT ?,u.id,?,? FROM email_auth_challenges c JOIN users u ON u.id=c.target_user_id
      WHERE c.id=? AND c.claim_nonce=? AND u.mutation_token=? AND u.email=c.email AND u.is_guest=0 AND u.email_verified_at IS NOT NULL`)
      .bind(digest(token), now + SESSION_AGE, now, challengeId, nonce, nonce),
    env.DB.prepare(`SELECT u.id,u.email,u.nickname,u.is_guest,u.version,u.role,u.password_hash,u.email_verified_at,c.registered
      FROM email_auth_challenges c JOIN users u ON u.id=c.target_user_id JOIN sessions s ON s.user_id=u.id
      WHERE c.id=? AND c.claim_nonce=? AND s.token_hash=?`).bind(challengeId, nonce, digest(token)),
    emailSignupCreditStatement(env, challengeId, nonce, now),
    ...referralRewardStatements(env, appliedReferralCode, referralInviteeId, nonce, now),
  ]);
  if (results[8].meta.changes !== 1) {
    if (current && results[1].meta.changes === 0 && (await env.DB.prepare("SELECT id FROM email_auth_challenges WHERE id=? AND email=? AND purpose='login' AND code_hash=? AND attempts<5 AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>?")
      .bind(challengeId, email, hash, now).first())) throw new ApiError(409, "账号状态已改变，请退出或刷新后重试。");
    throw new ApiError(400, "验证码不正确、已过期或已使用，请重新获取。");
  }
  const row = results[9].results[0] as unknown as UserRow & { registered: number };
  const user = toUser(row);
  return json({ user, authenticated: true, registered: row.registered === 1, passwordSetupRequired: user.passwordSetupRequired }, 200,
    { "Set-Cookie": sessionCookie(request, token) });
}

async function resetPassword(request: Request, env: Env): Promise<Response> {
  requireConfiguration(env);
  const body = await readJson(request, 2048);
  allowedFields(body, ["email", "challengeId", "code", "newPassword"]);
  const email = normalizeEmail(body.email);
  if (typeof body.challengeId !== "string" || !UUID.test(body.challengeId)
    || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
    throw new ApiError(400, "请输入有效的六位验证码。");
  }
  const { password: newPassword } = credentials({ email, password: body.newPassword });
  await rateLimit(request, env, "password-reset-ip", 100);
  await rateLimit(request, env, "password-reset-email", 30, email);
  const challengeId = body.challengeId.toLowerCase();
  const hash = codeHash(env, challengeId, email, body.code);
  const now = Date.now();
  const candidate = await env.DB.prepare(`SELECT c.id FROM email_auth_challenges c
    JOIN users u ON u.email=c.email AND u.is_guest=0 AND COALESCE(u.is_demo,0)=0
    WHERE c.id=? AND c.email=? AND c.purpose='password_reset' AND c.code_hash=?
      AND c.attempts<5 AND c.consumed_at IS NULL AND c.invalidated_at IS NULL
      AND c.send_status='sent' AND c.expires_at>?`).bind(challengeId, email, hash, now).first();
  // Count failed attempts without revealing whether the challenge or mailbox
  // exists. The successful claim below repeats every guard transactionally.
  const nonce = crypto.randomUUID();
  const token = Array.from(randomBytes(32), byte => byte.toString(16).padStart(2, "0")).join("");
  if (!candidate) {
    await env.DB.prepare(`UPDATE email_auth_challenges SET attempts=attempts+1 WHERE id=? AND email=?
      AND purpose='password_reset' AND code_hash<>? AND attempts<5 AND consumed_at IS NULL
      AND invalidated_at IS NULL AND send_status='sent' AND expires_at>?`).bind(challengeId, email, hash, now).run();
    throw new ApiError(400, "验证码不正确、已过期或已使用，请重新获取。");
  }
  const passwordHash = await hashPassword(newPassword);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE email_auth_challenges SET attempts=attempts+1 WHERE id=? AND email=?
      AND purpose='password_reset' AND code_hash<>? AND attempts<5 AND consumed_at IS NULL
      AND invalidated_at IS NULL AND send_status='sent' AND expires_at>?`).bind(challengeId, email, hash, now),
    env.DB.prepare(`UPDATE email_auth_challenges SET attempts=attempts+1,consumed_at=?,claim_nonce=?,
      target_user_id=(SELECT id FROM users WHERE email=? AND is_guest=0 AND COALESCE(is_demo,0)=0)
      WHERE id=? AND email=? AND purpose='password_reset' AND code_hash=? AND attempts<5
      AND consumed_at IS NULL AND invalidated_at IS NULL AND send_status='sent' AND expires_at>?
      AND EXISTS(SELECT 1 FROM email_auth_cooldowns WHERE email=? AND challenge_id=email_auth_challenges.id)
      AND EXISTS(SELECT 1 FROM users WHERE email=? AND is_guest=0 AND COALESCE(is_demo,0)=0)`)
      .bind(now, nonce, email, challengeId, email, hash, now, email, email),
    env.DB.prepare(`UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?),
      version=version+1,mutation_token=? WHERE id=(SELECT target_user_id FROM email_auth_challenges WHERE id=? AND claim_nonce=?)
      AND email=? AND is_guest=0 AND COALESCE(is_demo,0)=0 AND EXISTS(SELECT 1 FROM email_auth_challenges WHERE id=? AND claim_nonce=? AND purpose='password_reset')`)
      .bind(passwordHash, now, nonce, challengeId, nonce, email, challengeId, nonce),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=(SELECT target_user_id FROM email_auth_challenges WHERE id=? AND claim_nonce=?)
      AND EXISTS(SELECT 1 FROM users WHERE id=sessions.user_id AND mutation_token=?)`)
      .bind(challengeId, nonce, nonce),
    env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at)
      SELECT ?,target_user_id,?,? FROM email_auth_challenges WHERE id=? AND claim_nonce=? AND purpose='password_reset'`)
      .bind(digest(token), now + SESSION_AGE, now, challengeId, nonce),
    env.DB.prepare(`SELECT u.id,u.email,u.nickname,u.is_guest,u.version,u.role,u.password_hash,u.email_verified_at
      FROM email_auth_challenges c JOIN users u ON u.id=c.target_user_id JOIN sessions s ON s.user_id=u.id
      WHERE c.id=? AND c.claim_nonce=? AND s.token_hash=?`).bind(challengeId, nonce, digest(token)),
  ]);
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1 || results[4].meta.changes !== 1) {
    throw new ApiError(400, "验证码不正确、已过期或已使用，请重新获取。");
  }
  const row = results[5].results[0] as unknown as UserRow;
  if (!row) throw new ApiError(409, "账号状态已改变，请重新获取验证码后重试。");
  return json({ user: toUser(row), authenticated: true, passwordChanged: true }, 200,
    { "Set-Cookie": sessionCookie(request, token) });
}

export async function handleEmailAuth(request: Request, env: Env, options: EmailAuthOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === "/v1/auth/email/config") {
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    const enabled = configured(env);
    return json({ enabled, expiresIn: EXPIRES_IN, resendAfter: RESEND_AFTER,
      note: enabled ? "邮箱验证码 10 分钟内有效，60 秒后可重新获取。" : "邮箱验证码登录尚未开通，正在等待发信服务配置完成。" });
  }
  if (path === "/v1/auth/password/forgot/request" || path === "/v1/auth/password/forgot/reset") {
    if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
    return path.endsWith("/request") ? requestCode(request, env, options, "password_reset") : resetPassword(request, env);
  }
  if (path !== "/v1/auth/email/request" && path !== "/v1/auth/email/verify") return null;
  if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
  return path.endsWith("/request") ? requestCode(request, env, options) : verifyCode(request, env);
}
