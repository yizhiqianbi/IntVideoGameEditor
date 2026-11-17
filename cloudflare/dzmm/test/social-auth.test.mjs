import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { tsImport } from "tsx/esm/api";
import { splitSqlStatements } from "./sql-migrations.mjs";

const { fetchRequest } = await tsImport("../src/app.ts", import.meta.url);
const { socialCallbackUrl, socialLoginAvailability, resetSocialAuthCacheForTests } = await tsImport("../src/social-auth.ts", import.meta.url);
const { publicOauthCookie } = await tsImport("../../../src/lib/xumeng-session-cookie.ts", import.meta.url);
const { NEW_SIGNUP_CREDITS } = await tsImport("../src/signup-credits.ts", import.meta.url);

let store;
let DB;
let keys;
const CLIENT_ID = "google-client-id";
const originalFetch = globalThis.fetch;

before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: "2026-10-01",
    modules: true,
    script: "export default { fetch() { return new Response('social login test') } }",
    d1Databases: { DB: "social-login-tests" },
  }));
  DB = await store.getD1Database("DB");
  const files = (await readdir(new URL("../migrations/", import.meta.url))).filter(file => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await DB.batch(splitSqlStatements(sql).filter(part => part.trim()).map(part => DB.prepare(part)));
  }
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
});

after(async () => {
  globalThis.fetch = originalFetch;
  await store?.dispose();
});

function env(extra = {}) {
  return {
    DB,
    APP_ORIGINS: "https://create.xumengchat.top https://xumengchat.top",
    GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
    ...extra,
  };
}

class Browser {
  constructor(ip = randomUUID()) {
    this.ip = ip;
    this.jar = new Map();
  }
  async send(path, { method = "GET", body, env: requestEnv = env() } = {}) {
    const response = await fetchRequest(new Request(`https://xumengchat.top${path}`, {
      method,
      headers: {
        Origin: "https://xumengchat.top",
        Cookie: [...this.jar].map(([name, value]) => `${name}=${value}`).join("; "),
        "CF-Connecting-IP": this.ip,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), requestEnv);
    for (const item of response.headers.getSetCookie?.() || []) {
      const pair = item.split(";")[0];
      const name = pair.slice(0, pair.indexOf("=")).trim();
      const value = pair.slice(pair.indexOf("=") + 1);
      if (/Max-Age=0/i.test(item) || !value) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const type = response.headers.get("content-type") || "";
    return { status: response.status, data: type.includes("json") ? await response.json() : await response.text() };
  }
}

async function sign(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${encode({ alg: "RS256", kid: "social-test", typ: "JWT" })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString("base64url")}`;
}

function installGoogle(nonce, claims) {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      jwk.kid = "social-test";
      jwk.alg = "RS256";
      return Response.json({ keys: [jwk] });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const body = String(init?.body || "");
      assert.match(body, /code_verifier=/);
      assert.match(body, new RegExp(`redirect_uri=${encodeURIComponent("https://xumengchat.top/api/backend/v1/auth/google/callback")}`));
      const token = await sign({
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce,
        ...claims,
      });
      return Response.json({ id_token: token });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

test("public callback stays on the main site and the worker exposes it to the browser", () => {
  assert.equal(socialCallbackUrl(env(), "google"), "https://xumengchat.top/api/backend/v1/auth/google/callback");
  assert.equal(socialCallbackUrl({ APP_ORIGINS: "http://127.0.0.1:3010", PAYMENTS_RETURN_ORIGIN: "https://xumengchat.top" }, "telegram"), "https://xumengchat.top/api/backend/v1/auth/telegram/callback");
  assert.equal(socialCallbackUrl(env(), "telegram"), "https://xumengchat.top/api/backend/v1/auth/telegram/callback");
  assert.deepEqual(socialLoginAvailability({ APP_ORIGINS: "https://xumengchat.top" }), { google: false, telegram: false });
  const rewritten = publicOauthCookie("xumeng_oauth=abc; HttpOnly; Path=/v1/auth; Max-Age=600", "/api/backend/");
  assert.equal(rewritten, "xumeng_oauth=abc; HttpOnly; Path=/api/backend/v1/auth; Max-Age=600");
});

test("Google and Telegram stay unavailable until both secrets exist", async () => {
  const browser = new Browser();
  const closed = await browser.send("/v1/auth/social/config", { env: { DB, APP_ORIGINS: "https://xumengchat.top" } });
  assert.deepEqual(closed.data, { google: false, telegram: false });
  const start = await browser.send("/v1/auth/google/start", { env: { DB, APP_ORIGINS: "https://xumengchat.top" } });
  assert.equal(start.status, 503);
  assert.equal(start.data.error, "Google 登录尚未配置。");
});

test("a guest becomes the Google account, and the same Google login does not grant the gift again", async () => {
  resetSocialAuthCacheForTests();
  const browser = new Browser();
  const guest = await browser.send("/v1/auth/guest", { method: "POST", body: {} });
  assert.equal(guest.status, 200);
  assert.equal(guest.data.user.isGuest, true);
  const guestId = guest.data.user.id;
  await DB.prepare("INSERT INTO preferences(user_id,nickname,persona,preset,model,dark,extra_json) VALUES (?,?,?,?,?,?,?)")
    .bind(guestId, "游客", "", "保持角色性格。", "fast", 1, "{}").run();
  const started = await browser.send("/v1/auth/google/start");
  assert.equal(started.status, 200);
  const authorization = new URL(started.data.url);
  assert.equal(authorization.hostname, "accounts.google.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const nonce = authorization.searchParams.get("nonce");
  installGoogle(nonce, { sub: "google-subject-1", email: "new-google@example.com", email_verified: true, name: "小林" });
  const done = await browser.send(`/v1/auth/google/callback?code=one-time-code&state=${authorization.searchParams.get("state")}`);
  assert.equal(done.status, 200);
  assert.match(done.data, /正在进入叙梦/);
  const session = await browser.send("/v1/session");
  assert.equal(session.data.user.id, guestId);
  assert.equal(session.data.user.isGuest, false);
  assert.equal(session.data.user.email, "new-google@example.com");
  assert.equal(session.data.user.nickname, "小林");
  assert.equal((await DB.prepare("SELECT nickname FROM preferences WHERE user_id=?").bind(guestId).first()).nickname, "小林");
  assert.equal(session.data.authenticated, true);
  const grants = await DB.prepare("SELECT credits, grant_key FROM trusted_credit_grants WHERE user_id=?").bind(guestId).all();
  assert.equal(grants.results.filter(row => row.grant_key === `new_signup:${guestId}`).length, 1);
  assert.equal(grants.results.find(row => row.grant_key === `new_signup:${guestId}`).credits, NEW_SIGNUP_CREDITS);
  await DB.prepare("UPDATE users SET nickname=? WHERE id=?").bind("自定名字", guestId).run();
  await DB.prepare("UPDATE preferences SET nickname=? WHERE user_id=?").bind("自定名字", guestId).run();
  const again = await browser.send("/v1/auth/google/start");
  const second = new URL(again.data.url);
  installGoogle(second.searchParams.get("nonce"), { sub: "google-subject-1", email: "new-google@example.com", email_verified: true, name: "小林" });
  const repeat = await browser.send(`/v1/auth/google/callback?code=second-code&state=${second.searchParams.get("state")}`);
  assert.equal(repeat.status, 200);
  const repeatedGrants = await DB.prepare("SELECT COUNT(*) AS count FROM trusted_credit_grants WHERE grant_key=?").bind(`new_signup:${guestId}`).first();
  assert.equal(repeatedGrants.count, 1);
  assert.equal((await DB.prepare("SELECT nickname FROM users WHERE id=?").bind(guestId).first()).nickname, "自定名字");
  assert.equal((await DB.prepare("SELECT nickname FROM preferences WHERE user_id=?").bind(guestId).first()).nickname, "自定名字");
  const identities = await DB.prepare("SELECT COUNT(*) AS count FROM external_identities WHERE provider='google' AND subject='google-subject-1'").first();
  assert.equal(identities.count, 1);
});

test("Google does not merge an existing email account or attach itself to another logged-in account", async () => {
  resetSocialAuthCacheForTests();
  const ownerId = randomUUID();
  await DB.prepare("INSERT INTO users(id,email,password_hash,nickname,is_guest,version,created_at,email_verified_at) VALUES (?,?,?,?,0,0,?,?)")
    .bind(ownerId, "taken-google@example.com", "stored-password", "已有用户", Date.now(), Date.now()).run();
  const guest = new Browser();
  await guest.send("/v1/auth/guest", { method: "POST", body: {} });
  const started = await guest.send("/v1/auth/google/start");
  const authorization = new URL(started.data.url);
  installGoogle(authorization.searchParams.get("nonce"), { sub: "google-subject-taken", email: "taken-google@example.com", email_verified: true, name: "别人" });
  const rejected = await guest.send(`/v1/auth/google/callback?code=taken-code&state=${authorization.searchParams.get("state")}`);
  assert.equal(rejected.status, 400);
  assert.match(rejected.data, /不会自动合并/);
  const owner = await DB.prepare("SELECT email,is_guest FROM users WHERE id=?").bind(ownerId).first();
  assert.equal(owner.email, "taken-google@example.com");
  assert.equal(owner.is_guest, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM external_identities WHERE subject='google-subject-taken'").first()).count, 0);

  const loggedIn = new Browser();
  const accountId = randomUUID();
  const token = createHash("sha256").update(randomUUID()).digest("hex");
  await DB.prepare("INSERT INTO users(id,email,password_hash,nickname,is_guest,version,mutation_token,created_at) VALUES (?,?,?,?,0,0,?,?)")
    .bind(accountId, "member@example.com", "stored-password", "会员", randomUUID(), Date.now()).run();
  await DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .bind(createHash("sha256").update(token).digest("hex"), accountId, Date.now() + 86_400_000, Date.now()).run();
  loggedIn.jar.set("dzmm_session", token);
  const memberStart = await loggedIn.send("/v1/auth/google/start");
  const memberUrl = new URL(memberStart.data.url);
  installGoogle(memberUrl.searchParams.get("nonce"), { sub: "google-subject-member", email: "fresh-member@example.com", email_verified: true, name: "会员" });
  const blocked = await loggedIn.send(`/v1/auth/google/callback?code=member-code&state=${memberUrl.searchParams.get("state")}`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.data, /请先退出/);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM external_identities WHERE subject='google-subject-member'").first()).count, 0);
});

test("Google can create an account when the browser has no guest session", async () => {
  resetSocialAuthCacheForTests();
  const browser = new Browser();
  const started = await browser.send("/v1/auth/google/start");
  const authorization = new URL(started.data.url);
  installGoogle(authorization.searchParams.get("nonce"), { sub: "google-subject-fresh", email: "fresh-google@example.com", email_verified: false, name: "游客" });
  const done = await browser.send(`/v1/auth/google/callback?code=fresh-code&state=${authorization.searchParams.get("state")}`);
  assert.equal(done.status, 200);
  const session = await browser.send("/v1/session");
  assert.equal(session.data.user.isGuest, false);
  assert.equal(session.data.user.email, null);
  assert.equal(session.data.user.nickname, "Google 用户");
  const row = await DB.prepare("SELECT email,is_guest FROM users WHERE id=?").bind(session.data.user.id).first();
  assert.equal(row.email, null);
  assert.equal(row.is_guest, 0);
  assert.equal((await DB.prepare("SELECT credits FROM trusted_credit_grants WHERE grant_key=?").bind(`new_signup:${session.data.user.id}`).first()).credits, NEW_SIGNUP_CREDITS);
});

test("Telegram start only accepts its own issuer", async () => {
  resetSocialAuthCacheForTests();
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://oauth.telegram.org/.well-known/openid-configuration");
    return Response.json({
      issuer: "https://oauth.telegram.org",
      authorization_endpoint: "https://oauth.telegram.org/auth",
      token_endpoint: "https://oauth.telegram.org/token",
      jwks_uri: "https://oauth.telegram.org/.well-known/jwks.json",
    });
  };
  const browser = new Browser();
  const telegramEnv = env({ TELEGRAM_OAUTH_CLIENT_ID: "telegram-client", TELEGRAM_OAUTH_CLIENT_SECRET: "telegram-secret", SOCIAL_AUTH_CACHE: "off" });
  const started = await browser.send("/v1/auth/telegram/start", { env: telegramEnv });
  assert.equal(started.status, 200);
  assert.equal(new URL(started.data.url).hostname, "oauth.telegram.org");
  resetSocialAuthCacheForTests();
  globalThis.fetch = async () => Response.json({
    issuer: "https://oauth.telegram.org",
    authorization_endpoint: "https://evil.example/auth",
    token_endpoint: "https://oauth.telegram.org/token",
    jwks_uri: "https://oauth.telegram.org/.well-known/jwks.json",
  });
  const rejected = await new Browser().send("/v1/auth/telegram/start", { env: telegramEnv });
  assert.equal(rejected.status, 503);
});
