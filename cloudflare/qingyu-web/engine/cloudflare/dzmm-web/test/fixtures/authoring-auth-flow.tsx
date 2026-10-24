/** Actual TavernApp + AccountModal, native storage and cookie-backed disposable auth/CAS. */
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import "../../src/page.css";

const GUEST = "25252525-2525-4252-8252-252525252525", EXISTING = "25252525-2525-4252-8252-262626262626";
const TEST_PASSWORD = "Authflow-test-password-2026!";
const nativeFetch = window.fetch.bind(window), nativeStorage = window.localStorage;
const TAB_KEY = "authflow-fixture-tab-v1";
let tabId = sessionStorage.getItem(TAB_KEY);
if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem(TAB_KEY, tabId); }
const fixture = { tabId, counts: {} as Record<string, number>, blockedRequests: 0, currentUser: null as DzmmCloudUser | null,
  server: null as null | Record<string, unknown>, note: "游客未保存草稿→实际密码注册/登录，身份由服务端HttpOnly本地cookie读取。" };
const controls = createRoot(document.getElementById("fixture-controls")!);
function ownBackups(storage: Storage) {
  const entries: [string, unknown][] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || ![GUEST, EXISTING].some(id => key === `qingyu-cloud-backup:${id}` || key === `qingyu-cloud-tab-backup:${id}` || key === `qingyu-cloud-recovery:${id}` || key.startsWith(`qingyu-cloud-recovery:${id}:`))) continue;
    try { entries.push([key, JSON.parse(storage.getItem(key) ?? "null")]); } catch { entries.push([key, { invalid: true }]); }
  }
  return Object.fromEntries(entries);
}
function counters() {
  return { counts: { ...fixture.counts }, blockedRequests: fixture.blockedRequests, currentUser: fixture.currentUser,
    authFailure: fixture.server?.authFailure, putFailure: fixture.server?.putFailure,
    holdNextAuth: fixture.server?.holdNextAuth, holdPending: fixture.server?.holdPending };
}
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="游客草稿注册登录隔离验收控制台">
    <h1>游客角色草稿 → 注册或登录 · 真实页面隔离验收</h1>
    <p>仅本地两个普通测试账号，实际编辑器和账号弹窗；原生 Storage、同源 cookie、共享 normalizeState/CAS。所有模型、充值、签到、公开投稿及媒体写入拒绝。</p>
    <p>已有账号：existing-authflow@example.invalid；注册可使用新测试邮箱。统一本地测试密码：{TEST_PASSWORD}；本地验证码：000000。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => void setAuthFailure(true)}>认证持续503</button>
      <button type="button" onClick={() => void setAuthFailure(false)}>恢复认证</button>
      <button type="button" onClick={() => void setPutFailure(true)}>保存持续503</button>
      <button type="button" onClick={() => void setPutFailure(false)}>恢复保存</button>
      <button type="button" onClick={() => void holdAuth()}>延迟下一次认证提交</button>
      <button type="button" onClick={() => void releaseAuth()}>放行认证提交</button>
      <button type="button" onClick={() => void refreshServer()}>刷新服务端状态</button>
      <button type="button" onClick={() => void resetFixture()}>重置本轮两个账号</button>
    </div>
    <p role="status">{fixture.note}</p>
    <pre aria-label="游客草稿认证模拟状态">{JSON.stringify({ ...counters(), cookieAccountId: fixture.server?.accountId,
      nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype }, null, 2)}</pre>
  </section>);
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const requestBody = async (request: Request | null, init?: RequestInit) => typeof init?.body === "string" ? init.body : request ? await request.clone().text() : "{}";
async function refreshServer() {
  const response = await nativeFetch("/__authflow/snapshot", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("本地验收状态读取失败。");
  fixture.server = await response.json() as Record<string, unknown>; renderControls(); return fixture.server;
}
async function control(value: Record<string, boolean>) {
  const response = await nativeFetch("/__authflow/control", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Authflow-Fixture": "1" }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error("本地验收控制失败。"); fixture.server = await response.json() as Record<string, unknown>; renderControls(); return fixture.server;
}
const setAuthFailure = (value: boolean) => control({ authFailure: value });
const setPutFailure = (value: boolean) => control({ putFailure: value });
const holdAuth = () => control({ holdAuth: true });
const releaseAuth = () => control({ releaseAuth: true });
async function resetFixture(reload = true) {
  const response = await nativeFetch("/__authflow/reset", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Authflow-Fixture": "1" }, body: JSON.stringify({ seed: reload }) });
  if (!response.ok) throw new Error("本地验收状态重置失败。");
  for (const storage of [nativeStorage, sessionStorage]) {
    for (const key of Object.keys(ownBackups(storage))) storage.removeItem(key);
    for (const key of ["qingyu-cloud-local-owner", "qingyu-cloud-migration-completed"]) {
      if ([GUEST, EXISTING].includes(storage.getItem(key) ?? "")) storage.removeItem(key);
    }
  }
  sessionStorage.removeItem(TAB_KEY); fixture.server = await response.json() as Record<string, unknown>;
  fixture.currentUser = null; fixture.counts = {}; fixture.blockedRequests = 0;
  if (reload) { location.hash = "studio/new"; location.reload(); } else renderControls();
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null, url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase(), signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted(); const key = `${method} ${url.pathname}`; fixture.counts[key] = (fixture.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== location.origin) { fixture.blockedRequests++; return finish({ error: "隔离场景拒绝外部网络请求。" }, 501); }
  if (url.pathname.startsWith("/__authflow/") || !url.pathname.startsWith("/api/")) return nativeFetch(input, init);
  if (url.pathname === "/api/backend/v1/session" && method === "GET"
    || url.pathname === "/api/backend/v1/state" && ["GET", "PUT"].includes(method)
    || /^\/api\/backend\/v1\/auth\/(guest|register|login|logout|email\/(request|verify))$/.test(url.pathname) && method === "POST") {
    const path = url.pathname.slice("/api/backend/v1".length);
    const response = await nativeFetch(`/__authflow${path}`, { method, credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Authflow-Fixture": "1", "X-Authflow-Tab": fixture.tabId! },
      ...(method === "GET" ? {} : { body: await requestBody(request, init) }) });
    const payload = await response.clone().json().catch(() => null);
    if (response.ok && payload && "user" in payload) fixture.currentUser = payload.user;
    if (response.ok && path === "/auth/logout") fixture.currentUser = null;
    void refreshServer().catch(() => undefined); renderControls(); return response;
  }
  const id = fixture.currentUser?.id ?? GUEST;
  if (["/api/backend/v1/auth/email/config", "/api/backend/v1/email-auth/config"].includes(url.pathname) && method === "GET") return finish({ enabled: true, expiresIn: 600, resendAfter: 60, note: "本地验收固定验证码，不发送真实邮件。" });
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: false, model: null, note: "本轮不调用模型。" });
  if (url.pathname === "/api/backend/v1/characters" && method === "GET") return finish({ characters: [] });
  if (url.pathname === "/api/backend/v1/publishing/catalog" && method === "GET") return finish({ characters: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/publishing/mine" && method === "GET") return finish({ publications: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/novels" && method === "GET") return finish({ accountId: id, works: [] });
  if (url.pathname === "/api/backend/v1/payments/wallet" && method === "GET") return finish({ accountId: id, mode: "test", testMode: true,
    provider: "stripe", balance: 100, totalPurchased: 0, totalRefunded: 0, orders: [], creditUnlimited: false, billingExempt: false });
  if (url.pathname === "/api/backend/v1/billing/usage" && method === "GET") return finish({ accountId: id, availableBalance: 100, reservedCredits: 0, totalSpent: 0, debtCredits: 0, items: [], nextCursor: null });
  if (url.pathname === "/api/backend/v1/billing/config" && method === "GET") return finish({ enabled: false,
    priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000,
    rounding: "ceil_combined", outputIncludesReasoning: true, failureRule: "no_valid_output_refund",
    cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
  fixture.blockedRequests++; fixture.note = `已拒绝本轮不需要的接口：${key}`; return finish({ error: "这个隔离页面禁止模型、交易、签到、投稿及其他写入。" }, 501);
};

Object.assign(window, { __authflow: { guestAccountId: GUEST, existingAccountId: EXISTING,
  existingEmail: "existing-authflow@example.invalid", password: TEST_PASSWORD, tabId: fixture.tabId,
  setAuthFailure, setPutFailure, holdAuth, releaseAuth, refreshServer, reset: resetFixture, counters,
  snapshot: async () => ({ server: await refreshServer(), tab: counters(), backups: ownBackups(nativeStorage), tabBackups: ownBackups(sessionStorage),
    nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype }),
} });
if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#studio/new`);
renderControls(); createRoot(document.getElementById("root")!).render(<TavernApp />);
setInterval(() => { void refreshServer().catch(() => undefined); }, 600);
