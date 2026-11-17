import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { ApiError, json } from "./http";
import type { Env } from "./types";
import { SESSION_AGE, authCookies, currentUser, digest, normalizeEmail, rateLimit } from "./auth";
import { passwordSignupCreditStatement } from "./signup-credits";
import { referralCodeForUser } from "./referrals";

type Provider = "google" | "telegram";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TRANSACTION_TTL = 10 * 60 * 1000;

type IdentityClaims = { sub: string; email: string | null; name: string };
type Jwk = JsonWebKey & { kid?: string };
type TransactionRow = { code_verifier: string; nonce_hash: string; guest_user_id: string | null };

const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();
let telegramCache: { at: number; authorization: string; token: string; jwks: string } | null = null;

export function resetSocialAuthCacheForTests() {
  jwksCache.clear();
  telegramCache = null;
}

export function socialLoginAvailability(env: Env) {
  return { google: configured(env, "google"), telegram: configured(env, "telegram") };
}

export function socialCallbackUrl(env: Env, provider: Provider) {
  const origin = publicOrigin(env);
  if (!origin) throw new ApiError(500, "站点地址还没配好。");
  return `${origin}/api/backend/v1/auth/${provider}/callback`;
}

export async function handleSocialAuth(request: Request, env: Env): Promise<Response | null> {
  if (env.SOCIAL_AUTH_CACHE === "off") resetSocialAuthCacheForTests();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/v1/auth/social/config") {
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    return json(socialLoginAvailability(env));
  }
  const match = path.match(/^\/v1\/auth\/(google|telegram)\/(start|callback)$/);
  if (!match) return null;
  const provider = match[1] as Provider;
  const action = match[2];
  if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
  if (!configured(env, provider)) throw new ApiError(503, provider === "google" ? "Google 登录尚未配置。" : "Telegram 登录尚未配置。");
  if (action === "start") return start(request, env, provider);
  return callback(request, env, provider, url);
}

function configured(env: Env, provider: Provider) {
  const client = clientCredentials(env, provider);
  return client !== null;
}

function clientCredentials(env: Env, provider: Provider) {
  const id = provider === "google" ? env.GOOGLE_OAUTH_CLIENT_ID : env.TELEGRAM_OAUTH_CLIENT_ID;
  const secret = provider === "google" ? env.GOOGLE_OAUTH_CLIENT_SECRET : env.TELEGRAM_OAUTH_CLIENT_SECRET;
  if (!id || !secret || id.length > 256 || secret.length > 512 || /[\u0000-\u0020]/.test(id) || /[\u0000-\u0020]/.test(secret)) return null;
  return { id, secret };
}

function httpsOrigin(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch { return ""; }
}

function publicOrigin(env: Env) {
  const origins = [env.PAYMENTS_RETURN_ORIGIN, ...(env.APP_ORIGINS || "").split(/[\s,]+/)].map(httpsOrigin).filter(Boolean);
  return origins.find(value => value === "https://xumengchat.top") || origins[0] || "";
}

async function start(request: Request, env: Env, provider: Provider) {
  await rateLimit(request, env, `oauth-start:${provider}`, 30);
  const client = clientCredentials(env, provider);
  if (!client) throw new ApiError(503, "这个登录尚未配置。");
  const endpoint = await authorizationEndpoint(provider);
  const redirect = socialCallbackUrl(env, provider);
  const state = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const current = await currentUser(request, env);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM oauth_transactions WHERE expires_at<? OR (consumed_at IS NOT NULL AND consumed_at<?)").bind(now, now - TRANSACTION_TTL).run();
  await env.DB.prepare(`INSERT INTO oauth_transactions(id,provider,state_hash,nonce_hash,code_verifier,guest_user_id,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), provider, digest(state), digest(nonce), verifier, current?.isGuest ? current.id : null, now, now + TRANSACTION_TTL).run();
  const query = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirect,
    response_type: "code",
    scope: provider === "google" ? "openid email profile" : "openid profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (provider === "google") query.set("prompt", "select_account");
  const headers = new Headers();
  headers.append("Set-Cookie", oauthCookie(request, state));
  return json({ url: `${endpoint}?${query}` }, 200, headers);
}

async function callback(request: Request, env: Env, provider: Provider, url: URL) {
  try {
    await rateLimit(request, env, `oauth-callback:${provider}`, 60);
    const denied = url.searchParams.get("error");
    if (denied) return page(request, denied === "access_denied" ? "你取消了这次登录。" : "登录没有完成，请回到叙梦重试。");
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(state) || code.length < 1 || code.length > 2048 || /[\u0000-\u0020]/.test(code)) {
      return page(request, "登录请求无效，请回到叙梦重新登录。");
    }
    const cookieState = oauthStateFrom(request);
    if (!cookieState || !same(cookieState, state)) return page(request, "请回到叙梦重新发起登录。");
    const now = Date.now();
    const pending = await env.DB.prepare(`UPDATE oauth_transactions SET consumed_at=?
      WHERE state_hash=? AND provider=? AND consumed_at IS NULL AND expires_at>?
      RETURNING code_verifier, nonce_hash, guest_user_id`).bind(now, digest(state), provider, now).first<TransactionRow>();
    if (!pending) return page(request, "登录已过期，请回到叙梦重新登录。");
    await env.DB.prepare("UPDATE oauth_transactions SET code_verifier='' WHERE state_hash=?").bind(digest(state)).run();
    const claims = await exchange(env, provider, code, pending);
    const token = await connectIdentity(request, env, provider, claims, pending.guest_user_id);
    return page(request, "正在进入叙梦…", token);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "登录没有完成，请回到叙梦重试。";
    return page(request, message);
  }
}

async function exchange(env: Env, provider: Provider, code: string, pending: TransactionRow): Promise<IdentityClaims> {
  const client = clientCredentials(env, provider);
  if (!client) throw new ApiError(503, "这个登录尚未配置。");
  const tokenEndpoint = provider === "google" ? "https://oauth2.googleapis.com/token" : (await telegramDocument()).token;
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: socialCallbackUrl(env, provider),
      client_id: client.id,
      client_secret: client.secret,
      code_verifier: pending.code_verifier,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => null) as { id_token?: unknown } | null;
  if (response.status >= 300 && response.status < 400) throw new ApiError(502, "登录没有完成，请重试。");
  if (!response.ok || typeof body?.id_token !== "string" || body.id_token.length > 8000) throw new ApiError(401, "登录没有完成，请重试。");
  const jwks = provider === "google" ? "https://www.googleapis.com/oauth2/v3/certs" : (await telegramDocument()).jwks;
  const payload = await verifyIdToken(body.id_token, jwks, {
    issuer: provider === "google" ? GOOGLE_ISSUERS : [TELEGRAM_ISSUER],
    audience: client.id,
    nonceHash: pending.nonce_hash,
  });
  return claimsFrom(payload, provider);
}

async function connectIdentity(request: Request, env: Env, provider: Provider, claims: IdentityClaims, storedGuestId: string | null) {
  const linked = await env.DB.prepare("SELECT user_id FROM external_identities WHERE provider=? AND subject=?").bind(provider, claims.sub).first<{ user_id: string }>();
  if (linked) {
    await applyProviderName(env, linked.user_id, claims.name);
    return issueSession(env, linked.user_id);
  }
  const current = await currentUser(request, env);
  if (current && !current.isGuest) throw new ApiError(409, "当前已登录。请先退出，再使用这个方式登录。");
  const guestId = storedGuestId && current?.id === storedGuestId && current.isGuest ? current.id : null;
  if (claims.email) {
    const owner = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(claims.email).first<{ id: string }>();
    if (owner && owner.id !== guestId) throw new ApiError(409, "这个邮箱已经有叙梦账号。请先用邮箱登录，这次不会自动合并。");
  }
  const userId = guestId || crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const now = Date.now();
  try {
    const statements = guestId
      ? [
        env.DB.prepare(`UPDATE users SET email=CASE WHEN ?1 IS NULL THEN email ELSE ?1 END,
          nickname=CASE WHEN trim(nickname) IN ('', '游客', 'Telegram 用户', 'Google 用户') THEN ?2 ELSE nickname END,
          is_guest=0, email_verified_at=CASE WHEN ?1 IS NOT NULL THEN COALESCE(email_verified_at,?3) ELSE email_verified_at END,
          version=version+1, mutation_token=?4, referral_code=COALESCE(referral_code,?5)
          WHERE id=?6 AND is_guest=1 AND is_demo=0`).bind(claims.email, claims.name, now, nonce, referralCodeForUser(userId), userId),
        env.DB.prepare(`UPDATE preferences SET nickname=? WHERE user_id=? AND trim(nickname) IN ('', '游客', 'Telegram 用户', 'Google 用户')
          AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_token=?)`).bind(claims.name, userId, userId, nonce),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_token=?)").bind(userId, userId, nonce),
      ]
      : [
        env.DB.prepare(`INSERT INTO users(id,email,password_hash,nickname,is_guest,version,mutation_token,created_at,email_verified_at,referral_code)
          VALUES (?,?,NULL,?,0,0,?,?,?,?)`).bind(userId, claims.email, claims.name, nonce, now, claims.email ? now : null, referralCodeForUser(userId)),
      ];
    const token = hexBytes(randomBytes(32));
    const results = await env.DB.batch([
      ...statements,
      env.DB.prepare(`INSERT INTO external_identities(provider,subject,user_id,email,created_at)
        SELECT ?,?,id,?,? FROM users WHERE id=? AND mutation_token=? AND is_guest=0 AND is_demo=0`)
        .bind(provider, claims.sub, claims.email, now, userId, nonce),
      env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at)
        SELECT ?,id,?,? FROM users WHERE id=? AND mutation_token=? AND is_guest=0 AND is_demo=0`)
        .bind(digest(token), now + SESSION_AGE, now, userId, nonce),
      passwordSignupCreditStatement(env, userId, nonce, now),
    ]);
    const identityIndex = statements.length;
    if (results[identityIndex]?.meta.changes !== 1 || results[identityIndex + 1]?.meta.changes !== 1) {
      throw new ApiError(409, "账号状态已改变，请回到叙梦重试。");
    }
    return token;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const text = String(error);
    if (/external_identities/i.test(text)) throw new ApiError(409, "这个登录已经绑定了账号，请重试。");
    if (text.includes("UNIQUE")) throw new ApiError(409, "这个邮箱已经有叙梦账号。请先用邮箱登录，这次不会自动合并。");
    throw error;
  }
}

async function applyProviderName(env: Env, userId: string, name: string) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET nickname=? WHERE id=? AND is_guest=0 AND is_demo=0
      AND trim(nickname) IN ('', '游客', 'Telegram 用户', 'Google 用户')`).bind(name, userId),
    env.DB.prepare(`UPDATE preferences SET nickname=? WHERE user_id=?
      AND trim(nickname) IN ('', '游客', 'Telegram 用户', 'Google 用户')`).bind(name, userId),
  ]);
}

async function issueSession(env: Env, userId: string) {
  const token = hexBytes(randomBytes(32));
  const now = Date.now();
  const inserted = await env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_guest=0 AND is_demo=0)`)
    .bind(digest(token), userId, now + SESSION_AGE, now, userId).run();
  if (!inserted.meta.changes) throw new ApiError(403, "这个登录没有对应的可用账号。");
  return token;
}

function claimsFrom(payload: Record<string, unknown>, provider: Provider): IdentityClaims {
  const sub = typeof payload.sub === "string" ? payload.sub : typeof payload.sub === "number" && Number.isSafeInteger(payload.sub) ? String(payload.sub) : "";
  if (!sub || sub.length > 255 || /[\u0000-\u0020]/.test(sub)) throw new ApiError(401, "登录校验没有通过。");
  const given = [payload.given_name, payload.family_name].filter((part): part is string => typeof part === "string").join(" ");
  const username = typeof payload.preferred_username === "string" ? payload.preferred_username.replace(/^@+/, "") : "";
  const rawName = typeof payload.name === "string" && payload.name.trim() ? payload.name : given.trim() ? given : username;
  const name = rawName.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ").slice(0, 30);
  return { sub, email: verifiedEmail(payload), name: !name || name === "游客" ? (provider === "google" ? "Google 用户" : "Telegram 用户") : name };
}

function verifiedEmail(payload: Record<string, unknown>) {
  if (payload.email_verified !== true && payload.email_verified !== "true") return null;
  try { return normalizeEmail(payload.email); } catch { return null; }
}

async function verifyIdToken(token: string, jwksUrl: string, checks: { issuer: string[]; audience: string; nonceHash: string }) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "登录校验没有通过。");
  let header: { alg?: unknown; kid?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64urlBytes(parts[1])));
  } catch { throw new ApiError(401, "登录校验没有通过。"); }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 200) throw new ApiError(401, "登录校验没有通过。");
  const key = await signingKey(jwksUrl, header.kid);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new ApiError(401, "登录校验没有通过。");
  const issuers = checks.issuer;
  if (typeof payload.iss !== "string" || !issuers.includes(payload.iss)) throw new ApiError(401, "登录校验没有通过。");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(checks.audience)) throw new ApiError(401, "登录校验没有通过。");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() - 60_000) throw new ApiError(401, "登录校验没有通过。");
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf * 1000 > Date.now() + 60_000)) throw new ApiError(401, "登录校验没有通过。");
  if (typeof payload.nonce !== "string" || !same(digest(payload.nonce), checks.nonceHash)) throw new ApiError(401, "登录校验没有通过。");
  return payload;
}

async function signingKey(jwksUrl: string, kid: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const keys = await loadJwks(jwksUrl, attempt === 1);
    const jwk = keys.find(key => key.kid === kid && key.kty === "RSA" && key.n && key.e && !key.d);
    if (!jwk) continue;
    return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true, key_ops: ["verify"] }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  throw new ApiError(401, "登录校验没有通过。");
}

async function loadJwks(url: string, force: boolean) {
  const cached = jwksCache.get(url);
  if (cached && !force && Date.now() - cached.at < 10 * 60 * 1000) return cached.keys;
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
  const body = await response.json().catch(() => null) as { keys?: Jwk[] } | null;
  if (!response.ok || response.status >= 300 && response.status < 400 || !Array.isArray(body?.keys)) throw new ApiError(503, "登录校验暂时不可用。");
  jwksCache.set(url, { at: Date.now(), keys: body.keys });
  return body.keys;
}

async function authorizationEndpoint(provider: Provider) {
  if (provider === "google") return "https://accounts.google.com/o/oauth2/v2/auth";
  return (await telegramDocument()).authorization;
}

async function telegramDocument() {
  if (telegramCache && Date.now() - telegramCache.at < 60 * 60 * 1000) return telegramCache;
  const response = await fetch(`${TELEGRAM_ISSUER}/.well-known/openid-configuration`, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
  const doc = await response.json().catch(() => null) as { issuer?: unknown; authorization_endpoint?: unknown; token_endpoint?: unknown; jwks_uri?: unknown } | null;
  const authorization = typeof doc?.authorization_endpoint === "string" ? doc.authorization_endpoint : "";
  const token = typeof doc?.token_endpoint === "string" ? doc.token_endpoint : "";
  const jwks = typeof doc?.jwks_uri === "string" ? doc.jwks_uri : "";
  if (!response.ok || doc?.issuer !== TELEGRAM_ISSUER || [authorization, token, jwks].some(value => !value.startsWith(`${TELEGRAM_ISSUER}/`))) {
    throw new ApiError(503, "Telegram 登录暂时不可用。");
  }
  telegramCache = { at: Date.now(), authorization, token, jwks };
  return telegramCache;
}

function oauthCookie(request: Request, state: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `xumeng_oauth=${state}; HttpOnly; SameSite=Lax; Path=/v1/auth; Max-Age=600${secure}`;
}

function oauthStateFrom(request: Request) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("xumeng_oauth=")) continue;
    const value = trimmed.slice("xumeng_oauth=".length);
    if (/^[A-Za-z0-9_-]{43,128}$/.test(value)) return value;
  }
  return "";
}

function page(request: Request, message: string, token?: string) {
  const headers = token ? authCookies(request, token) : new Headers();
  headers.append("Set-Cookie", oauthCookie(request, "").replace("Max-Age=600", "Max-Age=0"));
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  headers.set("x-content-type-options", "nosniff");
  const safe = escapeHtml(message);
  const html = token
    ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>正在进入叙梦</title></head><body><p>${safe}</p><script>location.replace("/")</script></body></html>`
    : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>登录没有完成</title></head><body><p>${safe}</p><p><a href="/">回到叙梦</a></p></body></html>`;
  return new Response(html, { status: token ? 200 : 400, headers });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] || char);
}

function hexBytes(value: Uint8Array) {
  return Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function same(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
