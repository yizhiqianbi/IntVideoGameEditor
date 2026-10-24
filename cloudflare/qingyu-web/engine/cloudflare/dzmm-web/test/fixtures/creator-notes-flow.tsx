/** Actual TavernApp, Studio and Detail; own ordinary characters, native storage and shared CAS. */
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import "../../src/page.css";

const ACCOUNT = "36363636-3636-4363-8363-363636363636";
const user: DzmmCloudUser = { id: ACCOUNT, email: "qa-creator-notes@example.invalid", nickname: "原创书信旅人", isGuest: false, role: "user" };
const nativeFetch = window.fetch.bind(window), nativeStorage = window.localStorage;
const CONTROL_KEY = "creator-notes-controls-v1", TAB_KEY = "creator-notes-tab-v1";
let tabId = sessionStorage.getItem(TAB_KEY);
if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem(TAB_KEY, tabId); }
const fixture = { tabId, failPut: sessionStorage.getItem(CONTROL_KEY) === "503", counts: {} as Record<string, number>,
  mockChatPosts: 0, blockedRequests: 0, failedPuts: 0, chatRequests: [] as Record<string, unknown>[],
  server: null as null | Record<string, unknown>, note: "正文与作者备注隔离；原文保持，本地实际页面，没有模型或付款。" };
const controls = createRoot(document.getElementById("fixture-controls")!);
function ownBackups(storage: Storage) {
  const entries: [string, unknown][] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && (key === `qingyu-cloud-backup:${ACCOUNT}` || key === `qingyu-cloud-tab-backup:${ACCOUNT}` || key === `qingyu-cloud-recovery:${ACCOUNT}` || key.startsWith(`qingyu-cloud-recovery:${ACCOUNT}:`))) {
      const raw = storage.getItem(key); try { entries.push([key, JSON.parse(raw ?? "null")]); } catch { entries.push([key, { invalid: true }]); }
    }
  }
  return Object.fromEntries(entries);
}
function counters() { return { mockChatPosts: fixture.mockChatPosts, blockedRequests: fixture.blockedRequests,
  failedPuts: fixture.failedPuts, failPut: fixture.failPut, counts: { ...fixture.counts } }; }
function setPutFailure(value: boolean) {
  fixture.failPut = value; if (value) sessionStorage.setItem(CONTROL_KEY, "503"); else sessionStorage.removeItem(CONTROL_KEY);
  fixture.note = value ? "本标签页保存持续503，没有提交服务端。" : "本标签页保存恢复。"; renderControls();
}
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="作者备注隔离验收控制台">
    <h1>故事正文与作者备注 · 真实页面隔离验收</h1>
    <p>两个原创成年角色：书信故事含封面致谢和作者补充；另一张卡有明确作者备注及必须保留的故事内 PS。实际详情、列表、创作编辑器和默认背景开场；原生 storage、共享 CAS。外部模型、支付、签到、投稿与媒体接口拒绝。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => setPutFailure(true)}>本标签页保存持续503</button>
      <button type="button" onClick={() => setPutFailure(false)}>恢复本标签页保存</button>
      <button type="button" onClick={() => void refreshServer()}>刷新共享服务端状态</button>
      <button type="button" onClick={() => void resetFixture()}>重置本地原创场景</button>
    </div>
    <p role="status">{fixture.note}</p>
    <pre aria-label="作者备注模拟状态">{JSON.stringify({ ...counters(), serverVersion: fixture.server?.version,
      nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype }, null, 2)}</pre>
  </section>);
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const requestBody = async (request: Request | null, init?: RequestInit) => typeof init?.body === "string" ? init.body : request ? await request.clone().text() : "{}";
async function refreshServer() {
  const response = await nativeFetch("/__notes/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error("本地验收状态读取失败。"); fixture.server = await response.json() as Record<string, unknown>; renderControls(); return fixture.server;
}
async function resetFixture(reload = true) {
  const response = await nativeFetch("/__notes/reset", { method: "POST", headers: { "Content-Type": "application/json", "X-Notes-Fixture": "1" }, body: JSON.stringify({ seed: reload }) });
  if (!response.ok) throw new Error("本地验收状态重置失败。");
  for (const key of Object.keys(ownBackups(nativeStorage))) nativeStorage.removeItem(key);
  for (const key of Object.keys(ownBackups(sessionStorage))) sessionStorage.removeItem(key);
  if (nativeStorage.getItem("qingyu-cloud-local-owner") === ACCOUNT) nativeStorage.removeItem("qingyu-cloud-local-owner");
  if (sessionStorage.getItem("qingyu-cloud-local-owner") === ACCOUNT) sessionStorage.removeItem("qingyu-cloud-local-owner");
  sessionStorage.removeItem(CONTROL_KEY); sessionStorage.removeItem(TAB_KEY);
  fixture.server = await response.json() as Record<string, unknown>; fixture.failPut = false; fixture.mockChatPosts = 0; fixture.failedPuts = 0; fixture.chatRequests = []; fixture.counts = {};
  if (reload) { location.hash = "characters"; location.reload(); } else renderControls();
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase(), signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted(); const key = `${method} ${url.pathname}`; fixture.counts[key] = (fixture.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== location.origin) { fixture.blockedRequests++; return finish({ error: "本地隔离验收拒绝外部请求。" }, 501); }
  if (url.pathname.startsWith("/__notes/")) return nativeFetch(url, init);
  if (url.pathname === "/api/backend/v1/session" && method === "GET") return finish({ user, authenticated: true });
  if (url.pathname === "/api/backend/v1/state" && (method === "GET" || method === "PUT")) {
    if (method === "PUT" && fixture.failPut) { fixture.failedPuts++; return finish({ error: "本标签页本地保存503：没有提交。" }, 503); }
    const response = await nativeFetch("/__notes/state", { method, cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Notes-Fixture": "1", "X-Notes-Tab": fixture.tabId! }, body: method === "PUT" ? await requestBody(request, init) : undefined });
    void refreshServer(); return response;
  }
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: true, model: "local-notes-fixture", note: "本地模拟，无模型调用。" });
  if (url.pathname === "/api/chat" && method === "POST") {
    const body = JSON.parse(await requestBody(request, init)) as Record<string, unknown>; fixture.mockChatPosts++; fixture.chatRequests.push(structuredClone(body)); renderControls();
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    return new Response(frame({ type: "text", text: "沈岚把书信放在地图旁，指着旧桥的标记。\u201c我们先看看这里写了什么，再一起决定下一步。\u201d" }) + frame({ type: "done" }), { headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.pathname === "/api/backend/v1/payments/wallet" && method === "GET") return finish({ accountId: ACCOUNT, mode: "test", testMode: true,
    provider: "stripe", balance: 100, totalPurchased: 0, totalRefunded: 0, orders: [], creditUnlimited: false, billingExempt: false });
  if (url.pathname === "/api/backend/v1/billing/usage" && method === "GET") return finish({ accountId: ACCOUNT, availableBalance: 100, reservedCredits: 0, totalSpent: 0, debtCredits: 0, items: [], nextCursor: null });
  if (url.pathname === "/api/backend/v1/billing/config" && method === "GET") return finish({ enabled: false, priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000,
    rounding: "ceil_combined", outputIncludesReasoning: true, failureRule: "no_valid_output_refund", cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
  if (url.pathname === "/api/backend/v1/characters" && method === "GET") return finish({ characters: [] });
  if ((url.pathname === "/api/backend/v1/publishing/catalog" || url.pathname === "/api/backend/v1/publishing/mine") && method === "GET") return finish({ characters: [], publications: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/novels" && method === "GET") return finish({ accountId: ACCOUNT, works: [] });
  if (url.pathname === "/api/backend/v1/chat-media" && method === "GET") return finish({ accountId: ACCOUNT, conversationId: url.searchParams.get("conversationId"),
    vip: { active: false, expiresAt: null, adminPreview: false }, features: { audio: false, image: false }, limits: { audio: 0, image: 0, maxVoiceChars: 800 }, usage: { audio: 0, image: 0 }, assets: [], ...(url.searchParams.get("pagination") === "1" ? { directory: { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null } } : {}) });
  fixture.blockedRequests++; fixture.note = `已拒绝未知请求：${key}`; return finish({ error: "这个隔离页面不提供此接口。" }, 501);
};
Object.assign(window, { __creatorNotes: { accountId: ACCOUNT, user, counters, setPutFailure, refreshServer, reset: resetFixture,
  snapshot: async () => ({ server: await refreshServer(), tab: structuredClone({ ...fixture, server: undefined }), backups: ownBackups(nativeStorage), tabBackups: ownBackups(sessionStorage),
    nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype }) } });
if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#characters`);
renderControls(); createRoot(document.getElementById("root")!).render(<TavernApp />);
