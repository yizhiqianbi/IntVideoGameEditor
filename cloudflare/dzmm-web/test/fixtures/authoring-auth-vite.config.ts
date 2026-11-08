import type { IncomingMessage, ServerResponse } from "node:http";
import { mergeConfig, type Plugin } from "vite";
import base from "../../vite.config.ts";
import { normalizeState } from "../../../dzmm/src/data.ts";
import { ApiError, MAX_BODY_BYTES } from "../../../dzmm/src/http.ts";
import { DZMM_INITIAL_STATE, type DzmmSavedState } from "../../../../src/lib/dzmm-storage.ts";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud.ts";
import type { Character } from "../../../../src/lib/dzmm-characters.ts";

const GUEST = "25252525-2525-4252-8252-252525252525";
const EXISTING = "25252525-2525-4252-8252-262626262626";
const COOKIE = "xumeng_authflow_session";
const TEST_PASSWORD = "Authflow-test-password-2026!";
const existingUser: DzmmCloudUser = { id: EXISTING, email: "existing-authflow@example.invalid", nickname: "原创修钟旅人", isGuest: false, role: "user" };
const guestUser: DzmmCloudUser = { id: GUEST, email: null, nickname: "原创游客", isGuest: true, role: "user" };
const seedCard: Character = {
  id: "local-authflow-existing-clock", name: "原创成年钟表修理师", author: existingUser.nickname,
  heat: "0", likes: "0", cover: "/__authflow/cover.svg", tags: ["一般向", "剧情"],
  description: "成年钟表修理师在港口修理旧钟，邀请旅人检查钟摆。", personality: "耐心细致。", scenario: "午后的钟表铺。",
  firstMessage: "工匠把工具箱打开，指向桌上的旧钟。", sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-08T00:00:00.000Z",
};
type Account = { user: DzmmCloudUser; state: DzmmSavedState; version: number; writes: number; reads: number };
type AuthHold = { action: string; accountId: string | null; email: string; release: () => void };
function initialState(user: DzmmCloudUser, seed: boolean): DzmmSavedState {
  return normalizeState({ ...structuredClone(DZMM_INITIAL_STATE), custom: seed && user.id === EXISTING ? [structuredClone(seedCard)] : [],
    conversations: [], favorites: [], preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, theme: "dark", dark: true } });
}
function initialAccounts(seed = true): Map<string, Account> {
  return new Map([guestUser, existingUser].map(user => [user.id, { user: { ...user }, state: initialState(user, seed), version: 0, writes: 0, reads: 0 }]));
}
let accounts = initialAccounts();
let events: Record<string, unknown>[] = [];
let sequence = 0;
let rejectedWrites = 0;
let authFailure = false;
let putFailure = false;
let holdNextAuth = false;
let held: AuthHold | null = null;
const challenges = new Map<string, { email: string; expiresAt: number }>();
function event(value: Record<string, unknown>) { events.push({ ...value, sequence: ++sequence, at: Date.now() }); events = events.slice(-100); }
function accountId(request: IncomingMessage): string | null {
  const entry = (request.headers.cookie ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  const id = entry?.slice(COOKIE.length + 1);
  return id && accounts.has(id) ? id : null;
}
function account(request: IncomingMessage): Account {
  const id = accountId(request), found = id ? accounts.get(id) : undefined;
  if (!found) throw new ApiError(401, "当前没有本地验收账号会话。");
  return found;
}
const envelope = (record: Account) => ({ user: { ...record.user }, state: structuredClone(record.state), version: record.version, initialized: true });
function summary(request: IncomingMessage) {
  return { accountId: accountId(request), guestAccountId: GUEST, existingAccountId: EXISTING,
    accounts: Object.fromEntries([...accounts].map(([id, record]) => [id, envelope(record)])),
    writes: Object.fromEntries([...accounts].map(([id, record]) => [id, record.writes])),
    reads: Object.fromEntries([...accounts].map(([id, record]) => [id, record.reads])), rejectedWrites,
    authFailure, putFailure, holdNextAuth, holdPending: Boolean(held),
    heldAuth: held ? { action: held.action, accountId: held.accountId, email: held.email } : null, events: structuredClone(events) };
}
function reply(response: ServerResponse, value: unknown, status = 200, cookie?: string | null) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(cookie !== undefined ? { "Set-Cookie": cookie ? `${COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax` : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } : {}) });
  response.end(JSON.stringify(value));
}
async function bodyJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let bytes = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part); bytes += chunk.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new ApiError(413, "本地模拟请求超过2MB。"); parts.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new ApiError(400, "本地模拟请求需要有效JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "本地模拟请求应为JSON对象。");
  return value as Record<string, unknown>;
}
async function waitForAuth(request: IncomingMessage, response: ServerResponse, action: string, email: string) {
  if (!holdNextAuth) return;
  if (held) throw new ApiError(409, "已有一项登录注册请求正在等待。");
  holdNextAuth = false;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { if (held?.release === release) held = null; reject(new ApiError(499, "本地验收认证请求已断开。")); };
    const release = () => { response.removeListener("close", abort); held = null; resolve(); };
    held = { action, email, accountId: accountId(request), release };
    response.once("close", abort);
    event({ type: "auth-held", action, accountId: accountId(request), email });
  });
}
const sharedLocalApi: Plugin = { name: "round25-isolated-authoring-auth", configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (!url.pathname.startsWith("/__authflow/")) { next(); return; }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) { reply(response, { error: "仅限本机验收接口。" }, 403); return; }
    if (request.headers.origin && request.headers.origin !== url.origin) { reply(response, { error: "仅限同源本地请求。" }, 403); return; }
    const method = request.method ?? "GET", path = url.pathname.slice("/__authflow".length);
    try {
      if (path === "/cover.svg" && method === "GET") {
        response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#29283b"/><circle cx="80" cy="80" r="43" fill="none" stroke="#ec77ae" stroke-width="9"/><path d="M80 48v34l25 15" fill="none" stroke="#fff" stroke-width="7"/></svg>'); return;
      }
      if (path === "/snapshot" && method === "GET") { reply(response, summary(request)); return; }
      if (path === "/session" && method === "GET") {
        const id = accountId(request), record = id ? accounts.get(id) : undefined;
        reply(response, { user: record ? { ...record.user } : null, authenticated: record ? !record.user.isGuest : false }); return;
      }
      if (path === "/state" && method === "GET") { const record = account(request); record.reads++; reply(response, envelope(record)); return; }
      if (request.headers["x-authflow-fixture"] !== "1") throw new ApiError(403, "需要本地验收标记。");
      if (path === "/reset" && method === "POST") {
        const body = await bodyJson(request); held?.release(); accounts = initialAccounts(body.seed !== false);
        events = []; sequence = 0; rejectedWrites = 0; authFailure = false; putFailure = false; holdNextAuth = false; challenges.clear();
        reply(response, summary(request), 200, null); return;
      }
      if (path === "/control" && method === "POST") {
        const body = await bodyJson(request);
        if (typeof body.authFailure === "boolean") authFailure = body.authFailure;
        if (typeof body.putFailure === "boolean") putFailure = body.putFailure;
        if (body.holdAuth === true) { if (held) throw new ApiError(409, "请先放行当前认证请求。"); holdNextAuth = true; }
        if (body.releaseAuth === true) held?.release();
        reply(response, summary(request)); return;
      }
      if (path === "/state" && method === "PUT") {
        const record = account(request), body = await bodyJson(request);
        event({ type: "state-attempt", cookieAccountId: record.user.id, accountId: body.accountId, expectedVersion: body.version, state: body.state });
        if (body.accountId !== record.user.id) { rejectedWrites++; throw new ApiError(401, "本地模拟账号已改变，禁止跨账号保存。"); }
        if (!Number.isInteger(body.version) || Number(body.version) < 0) throw new ApiError(400, "本地模拟版本无效。");
        const normalized = normalizeState(body.state);
        if (putFailure) { rejectedWrites++; event({ type: "state-rejected", accountId: record.user.id, status: 503 }); throw new ApiError(503, "本地模拟保存503：原始草稿仍保留。"); }
        if (body.version !== record.version) { rejectedWrites++; event({ type: "state-rejected", accountId: record.user.id, status: 409 }); reply(response, { ...envelope(record), error: "本地模拟CAS版本冲突。" }, 409); return; }
        record.state = normalized; record.version++; record.writes++;
        event({ type: "state-committed", accountId: record.user.id, version: record.version, state: structuredClone(normalized) });
        reply(response, envelope(record)); return;
      }
      if (path === "/auth/email/request" && method === "POST") {
        const body = await bodyJson(request), email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "本地测试邮箱无效。");
        if (authFailure) throw new ApiError(503, "本地模拟验证码503，没有发送邮件。");
        const challengeId = crypto.randomUUID(); challenges.set(challengeId, { email, expiresAt: Date.now() + 600000 });
        event({ type: "email-request", accountId: accountId(request), email });
        reply(response, { challengeId, expiresIn: 600, resendAfter: 60 }); return;
      }
      if (path === "/auth/email/verify" && method === "POST") {
        const body = await bodyJson(request), before = accountId(request);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const challenge = typeof body.challengeId === "string" ? challenges.get(body.challengeId) : undefined;
        event({ type: "auth-attempt", action: "email-verify", accountId: before, email, nickname: body.nickname });
        await waitForAuth(request, response, "email-verify", email);
        if (authFailure) throw new ApiError(503, "本地模拟认证503：账号未改变。");
        if (!challenge || challenge.email !== email || challenge.expiresAt < Date.now() || body.code !== "000000") throw new ApiError(401, "本地测试验证码无效。");
        if (body.accountId !== undefined && body.accountId !== before) throw new ApiError(401, "本地验证码账号绑定已改变。");
        let record = [...accounts.values()].find(value => !value.user.isGuest && value.user.email === email);
        const registered = !record;
        if (!record) {
          record = account(request);
          if (!record.user.isGuest || record.user.id !== GUEST) throw new ApiError(409, "本轮仅支持升级当前游客账号。");
          const nickname = typeof body.nickname === "string" && body.nickname.trim() ? body.nickname.trim() : record.user.nickname;
          record.user = { ...record.user, email, nickname, isGuest: false }; record.state.preferences.nickname = nickname;
        }
        challenges.delete(String(body.challengeId));
        event({ type: "auth-committed", action: "email-verify", beforeAccountId: before, accountId: record.user.id, registered,
          keptCharacterIds: record.state.custom.map(value => value.id) });
        reply(response, { user: { ...record.user }, authenticated: true, registered }, 200, record.user.id); return;
      }
      const action = /^\/auth\/(guest|register|login|logout)$/.exec(path)?.[1];
      if (action && method === "POST") {
        const body = await bodyJson(request), before = accountId(request);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        event({ type: "auth-attempt", action, accountId: before, email, nickname: body.nickname });
        if (action === "register" || action === "login") await waitForAuth(request, response, action, email);
        if (authFailure) { event({ type: "auth-rejected", action, accountId: before, status: 503 }); throw new ApiError(503, "本地模拟认证503：账号未改变。"); }
        if (action === "logout") { event({ type: "auth-committed", action, beforeAccountId: before, accountId: null }); reply(response, { ok: true }, 200, null); return; }
        if (action === "guest") {
          const record = accounts.get(GUEST)!;
          if (!record.user.isGuest) throw new ApiError(409, "固定游客账号已注册，请重置本地场景后再创建游客。");
          event({ type: "auth-committed", action, beforeAccountId: before, accountId: GUEST });
          reply(response, { user: { ...record.user }, authenticated: false }, 200, GUEST); return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.password !== TEST_PASSWORD) throw new ApiError(400, "本地测试邮箱或密码无效。");
        if (action === "login") {
          const record = [...accounts.values()].find(value => !value.user.isGuest && value.user.email === email);
          if (!record) throw new ApiError(401, "本地测试账号不存在。");
          event({ type: "auth-committed", action, beforeAccountId: before, accountId: record.user.id });
          reply(response, { user: { ...record.user }, authenticated: true }, 200, record.user.id); return;
        }
        const record = account(request);
        if (!record.user.isGuest || record.user.id !== GUEST) throw new ApiError(409, "本轮仅支持升级当前游客账号。");
        if ([...accounts.values()].some(value => value.user.email === email)) throw new ApiError(409, "本地测试邮箱已注册。");
        const nickname = typeof body.nickname === "string" && body.nickname.trim() ? body.nickname.trim() : record.user.nickname;
        record.user = { ...record.user, email, nickname, isGuest: false }; record.state.preferences.nickname = nickname;
        event({ type: "auth-committed", action, beforeAccountId: before, accountId: record.user.id, keptCharacterIds: record.state.custom.map(value => value.id) });
        reply(response, { user: { ...record.user }, authenticated: true }, 201, record.user.id); return;
      }
      throw new ApiError(404, "本地验收接口不存在。");
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) reply(response, { error: error instanceof Error ? error.message : "本地验收接口失败。" }, error instanceof ApiError ? error.status : 500);
    }
  });
} };

export default mergeConfig(base, { plugins: [sharedLocalApi], server: { port: 21427, hmr: false, host: "127.0.0.1", strictPort: true } });
