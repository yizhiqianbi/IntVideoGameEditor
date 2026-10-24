import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { ApiError, json, readJson, readOptionalJson } from "./http";
import type { Env, UserRecord } from "./types";
import { handleEmailAuth, type EmailAuthOptions } from "./email-auth";
import { passwordSignupCreditStatement, publicSignupCreditConfig } from "./signup-credits";
import { referralCodeForUser, referralCodeFromBody, findInviter, referralRewardStatements } from "./referrals";

const SESSION_NAME = "qingyu_session";
export const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type UserRow = {
  id: string;
  email: string | null;
  nickname: string;
  is_guest: number;
  version: number;
  role: "user" | "super";
  password_hash?: string | null;
  email_verified_at?: number | null;
};

export function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    isGuest: row.is_guest === 1,
    role: row.role === "super" ? "super" : "user",
    version: row.version,
    emailVerified: row.is_guest !== 1 && row.email_verified_at != null,
    hasPassword: row.is_guest !== 1 && Boolean(row.password_hash),
    passwordSetupRequired: row.is_guest !== 1 && row.email_verified_at != null && !row.password_hash,
  };
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenFrom(request: Request) {
  const values = (request.headers.get("cookie") || "").split(";");
  const value = values.find((part) =>
    part.trim().startsWith(`${SESSION_NAME}=`),
  );
  const token = value?.trim().slice(SESSION_NAME.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function sessionCookie(request: Request, token: string, expires = false) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_NAME}=${expires ? "" : token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expires ? 0 : SESSION_AGE / 1000}${secure}`;
}

export async function currentUser(
  request: Request,
  env: Env,
): Promise<UserRecord | null> {
  const token = tokenFrom(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id,u.email,u.nickname,u.is_guest,u.version,u.role,u.password_hash,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.is_demo=0",
  )
    .bind(digest(token), Date.now())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function requireUser(
  request: Request,
  env: Env,
): Promise<UserRecord> {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, "登录状态已失效，请重新登录。");
  return user;
}

export async function rateLimit(
  request: Request,
  env: Env,
  scope: string,
  maximum: number,
  identity?: string,
) {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  // Cloudflare overwrites CF-Connecting-IP at its edge. Local tests have a shared local bucket.
  const key = digest(
    `${scope}:${identity || request.headers.get("cf-connecting-ip") || "local"}`,
  );
  const row = await env.DB.prepare(
    `INSERT INTO auth_rate_limits (key,count,window_start) VALUES (?,1,?)
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,
       window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, now - window, now - window)
    .first<{ count: number }>();
  if (!row || row.count > maximum)
    throw new ApiError(429, "操作过于频繁，请稍后再试。");
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || !body || Array.isArray(body)) {
    throw new ApiError(400, "请求应为 JSON 对象。");
  }
  return body as Record<string, unknown>;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254) {
    throw new ApiError(400, "请输入有效的邮箱。");
  }
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes("\0")) {
    throw new ApiError(400, "请输入有效的邮箱。");
  }
  return email;
}

export function credentials(body: Record<string, unknown>, minimumPasswordLength = 12) {
  const email = normalizeEmail(body.email);
  if (
    typeof body.password !== "string" ||
    body.password.length < minimumPasswordLength ||
    body.password.length > 256 ||
    body.password.includes("\0")
  ) {
    throw new ApiError(400, `密码需要 ${minimumPasswordLength} 至 256 个字符。`);
  }
  return { email, password: body.password };
}

function nickname(body: Record<string, unknown>) {
  if (
    typeof body.nickname !== "string" ||
    !body.nickname.trim() ||
    body.nickname.length > 30 ||
    body.nickname.includes("\0")
  ) {
    throw new ApiError(400, "昵称需要 1 至 30 个字符。");
  }
  return body.nickname.trim();
}

function hex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function fromHex(value: string) {
  return new Uint8Array(
    value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)),
  );
}
function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT, (error, value) =>
      error ? reject(error) : resolve(value),
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${hex(salt)}$${hex(key)}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
) {
  const parts = stored?.split("$");
  const valid =
    parts?.length === 6 &&
    parts[0] === "scrypt" &&
    parts[1] === "32768" &&
    parts[2] === "8" &&
    parts[3] === "3" &&
    /^[a-f0-9]{32}$/.test(parts[4]) &&
    /^[a-f0-9]{64}$/.test(parts[5]);
  const salt = valid ? fromHex(parts![4]) : new Uint8Array(16).fill(0x5a);
  const expected = valid ? fromHex(parts![5]) : new Uint8Array(32);
  const key = await derive(password, salt);
  return timingSafeEqual(key, expected) && Boolean(valid);
}

async function issueSession(request: Request, env: Env, user: UserRecord, expectedPasswordHash?: string) {
  const identity = await env.DB.prepare("SELECT is_demo FROM users WHERE id=?").bind(user.id).first<{ is_demo: number }>();
  if (identity?.is_demo === 1) throw new ApiError(409, "演示署名不能用于登录或创建游客会话。");
  const token = hex(randomBytes(32));
  const oldToken = tokenFrom(request);
  const statements = [];
  if (oldToken)
    statements.push(
      expectedPasswordHash
        ? env.DB.prepare("DELETE FROM sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND is_guest=0)").bind(digest(oldToken), user.id, expectedPasswordHash)
        : env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(digest(oldToken)),
    );
  statements.push(
    expectedPasswordHash ? env.DB.prepare(
      "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) SELECT ?,id,?,? FROM users WHERE id=? AND password_hash=? AND is_guest=0",
    ).bind(digest(token), Date.now() + SESSION_AGE, Date.now(), user.id, expectedPasswordHash) : env.DB.prepare(
      "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
    ).bind(digest(token), user.id, Date.now() + SESSION_AGE, Date.now()),
  );
  const results = await env.DB.batch(statements);
  if (results.at(-1)?.meta.changes !== 1) throw new ApiError(401, "邮箱或密码不正确。");
  return json({ user, authenticated: !user.isGuest }, 200, {
    "Set-Cookie": sessionCookie(request, token),
  });
}

async function createGuest(request: Request, env: Env) {
  const body = bodyRecord(await readOptionalJson(request, 64 * 1024));
  if (Object.hasOwn(body, "role")) throw new ApiError(400, "账户权限只能由管理员设置。");
  for (const key of ["id", "userId"]) if (Object.hasOwn(body, key)) {
    const supplied = body[key];
    if (typeof supplied === "string" && UUID.test(supplied)) {
      const row = await env.DB.prepare("SELECT is_demo FROM users WHERE id=?").bind(supplied.toLowerCase()).first<{ is_demo: number }>();
      if (row?.is_demo === 1) throw new ApiError(409, "演示署名不能用于登录或创建游客会话。");
    }
    throw new ApiError(400, "游客身份编号由服务器生成，不能指定已有身份。");
  }
  const existing = await currentUser(request, env);
  if (existing)
    return json({ user: existing, authenticated: !existing.isGuest });
  await rateLimit(request, env, "guest", 60);
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: null,
    nickname: "游客",
    isGuest: true,
    role: "user",
    version: 0,
    emailVerified: false,
    hasPassword: false,
    passwordSetupRequired: false,
  };
  if (await env.DB.prepare("SELECT is_demo FROM users WHERE id=?").bind(user.id).first()) throw new ApiError(409, "游客身份编号发生冲突，请重试。");
  try {
    await env.DB.prepare(
      "INSERT INTO users (id,email,password_hash,nickname,is_guest,version,created_at) VALUES (?,NULL,NULL,?,1,0,?)",
    ).bind(user.id, user.nickname, Date.now()).run();
  } catch (error) {
    // Never adopt a pre-existing row if a generated guest UUID collides.
    if (/UNIQUE constraint failed: users\.id/i.test(String(error))) throw new ApiError(409, "游客身份编号发生冲突，请重试。");
    throw error;
  }
  return issueSession(request, env, user);
}

async function register(request: Request, env: Env) {
  const body = bodyRecord(await readJson(request, 64 * 1024));
  if (Object.hasOwn(body, "role")) throw new ApiError(400, "账户权限只能由管理员设置。");
  const { email, password } = credentials(body);
  const name = nickname(body);
  const referralCode = referralCodeFromBody(body);
  await rateLimit(request, env, "register", 20);
  const current = await currentUser(request, env);
  if (current && !current.isGuest)
    throw new ApiError(409, "当前已登录，请先退出再注册其他账号。");
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?")
    .bind(email)
    .first();
  if (exists) throw new ApiError(409, "这个邮箱已注册，请登录。");
  const passwordHash = await hashPassword(password);
  const userId = current?.id || crypto.randomUUID();
  if (referralCode) await findInviter(env, referralCode, userId);
  const token = hex(randomBytes(32));
  const nonce = crypto.randomUUID();
  const now = Date.now();
  let registeredVersion = 0;
  try {
    if (current) {
      const results = await env.DB.batch<{ version: number }>([
        env.DB.prepare(
          "UPDATE users SET email=?,password_hash=?,nickname=?,is_guest=0,version=version+1,mutation_token=?,referral_code=COALESCE(referral_code,?) WHERE id=? AND is_guest=1 RETURNING version",
        ).bind(email, passwordHash, name, nonce, referralCodeForUser(userId), userId),
        env.DB.prepare(
          "UPDATE preferences SET nickname=? WHERE user_id=? AND EXISTS (SELECT 1 FROM users WHERE id=? AND mutation_token=?)",
        ).bind(name, userId, userId, nonce),
        env.DB.prepare(
          "DELETE FROM sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM users WHERE id=? AND mutation_token=?)",
        ).bind(userId, userId, nonce),
        env.DB.prepare(
          "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND mutation_token=?)",
        ).bind(digest(token), userId, now + SESSION_AGE, now, userId, nonce),
        passwordSignupCreditStatement(env, userId, nonce, now),
        ...referralRewardStatements(env, referralCode, userId, nonce, now),
      ]);
      if (!results[0].meta.changes)
        throw new ApiError(409, "账号状态已改变，请刷新后重试。");
      registeredVersion = Number(results[0].results[0].version);
    } else {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (id,email,password_hash,nickname,is_guest,version,mutation_token,created_at,referral_code) VALUES (?,?,?,?,0,0,?,?,?)",
        ).bind(userId, email, passwordHash, name, nonce, now, referralCodeForUser(userId)),
        env.DB.prepare(
          "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
        ).bind(digest(token), userId, now + SESSION_AGE, now),
        passwordSignupCreditStatement(env, userId, nonce, now),
        ...(referralRewardStatements(env, referralCode, userId, nonce, now)),
      ]);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (String(error).includes("UNIQUE"))
      throw new ApiError(409, "这个邮箱已注册，请登录。");
    throw error;
  }
  const user: UserRecord = {
    id: userId,
    email,
    nickname: name,
    isGuest: false,
    role: "user",
    version: registeredVersion,
    emailVerified: false,
    hasPassword: true,
    passwordSetupRequired: false,
  };
  return json({ user, authenticated: true }, 201, {
    "Set-Cookie": sessionCookie(request, token),
  });
}

async function login(request: Request, env: Env) {
  // Login must accept passwords that were created before the current
  // registration policy was introduced. The hash check still decides whether
  // the credential is valid; this only prevents the registration minimum from
  // rejecting an existing short password before it can be checked.
  const { email, password } = credentials(
    bodyRecord(await readJson(request, 64 * 1024)),
    1,
  );
  await rateLimit(request, env, "login-ip", 60);
  await rateLimit(request, env, "login-email", 20, email);
  const row = await env.DB.prepare(
    "SELECT id,email,nickname,is_guest,version,role,password_hash,email_verified_at FROM users WHERE email=? AND is_guest=0",
  )
    .bind(email)
    .first<UserRow>();
  if (!(await verifyPassword(password, row?.password_hash)) || !row) {
    throw new ApiError(401, "邮箱或密码不正确。");
  }
  return issueSession(request, env, toUser(row), row.password_hash!);
}

async function changePassword(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (user.isGuest) throw new ApiError(400, "游客账号尚未设置密码，请先注册账号。");
  const body = bodyRecord(await readJson(request, 64 * 1024));
  if (typeof body.accountId !== "string" || !UUID.test(body.accountId)) throw new ApiError(400, "请提供当前账户编号。");
  if (body.accountId !== user.id) throw new ApiError(409, "账户已切换，请刷新设置页面后重试。");
  if (typeof body.currentPassword !== "string" || body.currentPassword.length > 256 || body.currentPassword.includes("\0")) {
    throw new ApiError(400, "请输入当前密码。");
  }
  const { password: newPassword } = credentials({ email: user.email, password: body.newPassword });
  await rateLimit(request, env, "password-ip", 30);
  await rateLimit(request, env, "password-account", 10, user.id);
  const row = await env.DB.prepare("SELECT password_hash,email_verified_at FROM users WHERE id=? AND is_guest=0")
    .bind(user.id).first<{ password_hash: string | null; email_verified_at: number | null }>();
  const settingFirstPassword = row?.password_hash === null && row.email_verified_at !== null && body.currentPassword === "";
  if (!row || (!settingFirstPassword && !(await verifyPassword(body.currentPassword, row.password_hash)))) {
    throw new ApiError(401, "当前密码不正确。");
  }
  const token = tokenFrom(request);
  if (!token) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const sessionHash = digest(token);
  const passwordHash = await hashPassword(newPassword);
  // The old hash and current session are checked inside the transaction so a
  // concurrent password change or revoked session cannot change the account.
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash=? WHERE id=? AND password_hash IS ? AND is_guest=0
      AND (?=0 OR email_verified_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=users.id AND expires_at>?)`)
      .bind(passwordHash, user.id, row.password_hash, settingFirstPassword ? 1 : 0, sessionHash, Date.now()),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND token_hash<>?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)`)
      .bind(user.id, sessionHash, user.id, passwordHash),
  ]);
  if (result[0].meta.changes !== 1) throw new ApiError(409, "账号状态已改变，请重新登录后重试。");
  return json({ passwordChanged: true, accountId: user.id });
}

export async function handleAuth(
  request: Request,
  env: Env,
  options: EmailAuthOptions = {},
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === "/v1/session") {
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    const user = await currentUser(request, env);
    return json({ user, authenticated: Boolean(user && !user.isGuest) });
  }
  if (!path.startsWith("/v1/auth/")) return null;
  if (path === "/v1/auth/signup/config") {
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    return json(publicSignupCreditConfig());
  }
  const emailResponse = await handleEmailAuth(request, env, options);
  if (emailResponse) return emailResponse;
  if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
  if (path === "/v1/auth/guest") return createGuest(request, env);
  if (path === "/v1/auth/register") return register(request, env);
  if (path === "/v1/auth/login") return login(request, env);
  if (path === "/v1/auth/password") return changePassword(request, env);
  if (path === "/v1/auth/logout") {
    const token = tokenFrom(request);
    if (token)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(digest(token))
        .run();
    return json({ user: null, authenticated: false }, 200, {
      "Set-Cookie": sessionCookie(request, "", true),
    });
  }
  throw new ApiError(404, "账号接口不存在。");
}
