/** Actual TavernApp/cloud hook, real shared localStorage, disposable local API. */
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import type { DzmmSavedState } from "../../../../src/lib/dzmm-storage";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import "../../src/page.css";

const ACCOUNT = "23232323-2323-4232-8232-232323232323";
const user: DzmmCloudUser = { id: ACCOUNT, email: "qa-round23-multitab@example.invalid", nickname: "多窗本地旅人", isGuest: false, role: "user" };
const nativeFetch = window.fetch.bind(window);
const nativeStorage = window.localStorage;
const CONTROL_KEY = "round23-multitab-controls-v1";
const TAB_KEY = "round23-multitab-tab-v1";
let tabId = sessionStorage.getItem(TAB_KEY);
if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem(TAB_KEY, tabId); }
const storedControls = (() => { try { return JSON.parse(sessionStorage.getItem(CONTROL_KEY) ?? "{}"); } catch { return {}; } })();
const fixture = { tabId, failPut: storedControls.failPut === true, failGet: storedControls.failGet === true,
  counts: {} as Record<string, number>, mockChatPosts: 0, blockedRequests: 0, failedPuts: 0, failedGets: 0,
  holdNextPut: false, holdPending: false, heldPuts: 0,
  lastSubmitted: "", note: "本标签页正常读取和保存。请另开同源标签页，不同浏览器会话不会共享存储。",
  server: null as null | Record<string, unknown>, storageEvents: [] as Record<string, unknown>[] };
let releaseHeldPut: (() => void) | null = null;
function persistControls() { sessionStorage.setItem(CONTROL_KEY, JSON.stringify({ failPut: fixture.failPut, failGet: fixture.failGet })); }
function backupMetadata(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    return { accountId: value.accountId, version: value.version, updatedAt: value.updatedAt,
      writerId: value.writerId, revision: value.revision, recoveryVersion: value.recoveryVersion, tabId: value.tabId, dirty: value.dirty,
      conversations: value.state?.conversations?.map((item: DzmmSavedState["conversations"][number]) => ({ id: item.id, title: item.title, messages: item.messages.map(message => message.content) })) };
  } catch { return { invalid: true, chars: raw.length }; }
}
function scopedBackups(storage: Storage) {
  const entries: [string, unknown][] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && (key === `qingyu-cloud-backup:${ACCOUNT}` || key === `qingyu-cloud-tab-backup:${ACCOUNT}`
      || key === `qingyu-cloud-recovery:${ACCOUNT}` || key.startsWith(`qingyu-cloud-recovery:${ACCOUNT}:`))) {
      entries.push([key, backupMetadata(storage.getItem(key))]);
    }
  }
  return Object.fromEntries(entries);
}
const browserBackups = () => scopedBackups(nativeStorage);
const tabBackups = () => scopedBackups(sessionStorage);
const controls = createRoot(document.getElementById("fixture-controls")!);
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="多窗口备份隔离验收控制台">
    <h1>多窗口备份 · 真实页面隔离验收</h1>
    <p>两张普通原创私人角色；同一个本地账号。云端模拟状态在Vite内存中共享，localStorage为浏览器原生。没有模型、扣费、公开投稿或外部接口。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => setPutFailure(true)}>本标签页保存持续503</button>
      <button type="button" onClick={() => setPutFailure(false)}>恢复本标签页保存</button>
      <button type="button" onClick={() => setGetFailure(true)}>本标签页读取持续503</button>
      <button type="button" onClick={() => setGetFailure(false)}>恢复本标签页读取</button>
      <button type="button" disabled={fixture.holdPending || fixture.holdNextPut} onClick={holdNextSaveResponse}>延迟下一次保存响应</button>
      <button type="button" disabled={!fixture.holdPending} onClick={releaseSaveResponse}>放行延迟保存响应</button>
      <button type="button" onClick={() => void refreshServer()}>刷新共享服务端状态</button>
      <button type="button" onClick={() => void resetFixture()}>清空本地与服务端测试记录</button>
    </div>
    <p role="status">{fixture.note}</p>
    <pre aria-label="多窗口模拟状态">{JSON.stringify({ tabId: fixture.tabId, failPut: fixture.failPut, failGet: fixture.failGet,
      mockChatPosts: fixture.mockChatPosts, blockedRequests: fixture.blockedRequests, failedPuts: fixture.failedPuts, failedGets: fixture.failedGets,
      holdNextPut: fixture.holdNextPut, holdPending: fixture.holdPending, heldPuts: fixture.heldPuts,
      serverVersion: fixture.server?.version, serverWrites: fixture.server?.writes, requests: fixture.counts,
      storageEvents: fixture.storageEvents.length, localStorageNative: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype,
      backups: browserBackups(), tabBackups: tabBackups() }, null, 2)}</pre>
  </section>);
}
function setPutFailure(value: boolean) {
  fixture.failPut = value; persistControls(); fixture.note = value ? "本标签页所有状态PUT持续返回503，服务端不提交；其他标签页不受影响。" : "本标签页状态PUT恢复；请使用产品重新同步或恢复操作。"; renderControls();
}
function setGetFailure(value: boolean) {
  fixture.failGet = value; persistControls(); fixture.note = value ? "本标签页状态GET持续返回503；刷新后也保留此故障，其他标签页不受影响。" : "本标签页状态GET恢复；请使用产品重新同步操作。"; renderControls();
}
function holdNextSaveResponse() {
  if (fixture.holdPending) return;
  fixture.holdNextPut = true;
  fixture.note = "下一次成功状态PUT将先提交到共享本地服务端，再延迟返回响应；可继续编辑并切换后续保存503。";
  renderControls();
}
function releaseSaveResponse() { releaseHeldPut?.(); }
function withholdCommittedResponse(response: Response, signal?: AbortSignal | null): Promise<Response> {
  fixture.holdNextPut = false; fixture.holdPending = true; fixture.heldPuts++;
  fixture.note = "状态PUT已在共享本地服务端提交，响应正在延迟。继续编辑后点击放行；后续PUT故障可以独立切换。";
  renderControls();
  return new Promise<Response>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      fixture.holdPending = false; releaseHeldPut = null;
      renderControls();
    };
    const abort = () => { finish(); reject(new DOMException("本地模拟保存响应等待已取消", "AbortError")); };
    releaseHeldPut = () => {
      fixture.note = "已放行先前提交的保存响应；服务端不重复提交。";
      finish(); resolve(response);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function refreshServer() {
  const response = await nativeFetch("/__round23/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error("本地验收状态读取失败。");
  fixture.server = await response.json() as Record<string, unknown>; renderControls(); return fixture.server;
}
async function resetFixture(reload = true) {
  const response = await nativeFetch("/__round23/reset", { method: "POST", headers: { "X-Round23-Fixture": "1" } });
  if (!response.ok) throw new Error("本地验收状态重置失败。");
  const keys = Object.keys(browserBackups()); for (const key of keys) nativeStorage.removeItem(key);
  for (const key of Object.keys(tabBackups())) sessionStorage.removeItem(key);
  if (nativeStorage.getItem("qingyu-cloud-local-owner") === ACCOUNT) nativeStorage.removeItem("qingyu-cloud-local-owner");
  if (sessionStorage.getItem("qingyu-cloud-local-owner") === ACCOUNT) sessionStorage.removeItem("qingyu-cloud-local-owner");
  sessionStorage.removeItem(CONTROL_KEY); sessionStorage.removeItem(TAB_KEY);
  fixture.server = await response.json() as Record<string, unknown>;
  if (reload) { location.hash = "chat"; location.reload(); } else renderControls();
}
window.addEventListener("storage", event => {
  if (event.key?.includes(ACCOUNT) && (event.key.startsWith("qingyu-cloud-backup:") || event.key.startsWith("qingyu-cloud-recovery:"))) {
    fixture.storageEvents.push({ key: event.key, old: backupMetadata(event.oldValue), next: backupMetadata(event.newValue), at: Date.now() });
    fixture.storageEvents = fixture.storageEvents.slice(-40); renderControls();
  }
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const requestBody = async (request: Request | null, init?: RequestInit) => typeof init?.body === "string" ? init.body : request ? await request.clone().text() : "{}";
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const signal = init?.signal ?? request?.signal; signal?.throwIfAborted();
  const key = `${method} ${url.pathname}`; fixture.counts[key] = (fixture.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== location.origin) { fixture.blockedRequests++; return finish({ error: "本地隔离验收拒绝外部请求。" }, 501); }
  if (url.pathname.startsWith("/__round23/")) return nativeFetch(url, init);
  if (url.pathname === "/api/backend/v1/session" && method === "GET") return finish({ user, authenticated: true });
  if (url.pathname === "/api/backend/v1/state" && (method === "GET" || method === "PUT")) {
    if (method === "GET" && fixture.failGet) { fixture.failedGets++; return finish({ error: "本标签页本地模拟读取503。" }, 503); }
    if (method === "PUT" && fixture.failPut) { fixture.failedPuts++; return finish({ error: "本标签页本地模拟保存503：没有提交。" }, 503); }
    const response = await nativeFetch("/__round23/state", { method, cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Round23-Fixture": "1", "X-Round23-Tab": fixture.tabId! },
      body: method === "PUT" ? await requestBody(request, init) : undefined });
    void refreshServer();
    if (method === "PUT" && response.ok && fixture.holdNextPut && !fixture.holdPending) return withholdCommittedResponse(response, signal);
    return response;
  }
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: true, model: "local-round23", note: "本地模拟，无模型调用。" });
  if (url.pathname === "/api/chat" && method === "POST") {
    const body = JSON.parse(await requestBody(request, init));
    fixture.mockChatPosts++; fixture.lastSubmitted = body.messages?.filter((item: { role: string }) => item.role === "user").at(-1)?.content ?? "";
    renderControls();
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    return new Response(frame({ type: "text", text: "原创多窗地图员记下这处标记，指向地图上的下一座桥。" }) + frame({ type: "done" }), { headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.pathname === "/api/backend/v1/characters" && method === "GET") return finish({ characters: [] });
  if (url.pathname === "/api/backend/v1/publishing/catalog" && method === "GET") return finish({ characters: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/novels" && method === "GET") return finish({ accountId: ACCOUNT, works: [] });
  if (url.pathname === "/api/backend/v1/billing/config" && method === "GET") return finish({ enabled: false,
    priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000,
    rounding: "ceil_combined", outputIncludesReasoning: true, failureRule: "no_valid_output_refund",
    cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
  if (url.pathname === "/api/backend/v1/chat-media" && method === "GET") return finish({ accountId: ACCOUNT,
    conversationId: url.searchParams.get("conversationId"), vip: { active: false, expiresAt: null, adminPreview: false },
    features: { audio: false, image: false }, limits: { audio: 0, image: 0, maxVoiceChars: 800 }, usage: { audio: 0, image: 0 }, assets: [], ...(url.searchParams.get("pagination") === "1" ? { directory: { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null } } : {}) });
  fixture.blockedRequests++; fixture.note = `已拒绝未知请求：${key}`; return finish({ error: "这个隔离页面不提供此接口。" }, 501);
};

const debug = { accountId: ACCOUNT, tabId: fixture.tabId, user, setPutFailure, setGetFailure, holdNextSaveResponse, releaseSaveResponse, refreshServer, reset: resetFixture,
  // Playwright waitForFunction treats an async predicate's Promise as truthy.
  // This getter is synchronous so it can be safely used for counter polling.
  counters: () => ({ failedPuts: fixture.failedPuts, failedGets: fixture.failedGets, mockChatPosts: fixture.mockChatPosts,
    blockedRequests: fixture.blockedRequests, heldPuts: fixture.heldPuts, holdPending: fixture.holdPending, holdNextPut: fixture.holdNextPut,
    counts: { ...fixture.counts } }),
  snapshot: async () => ({ server: await refreshServer(), tab: { ...fixture, server: undefined }, backups: browserBackups(), tabBackups: tabBackups(),
    nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype }),
};
Object.assign(window, { __multitab: debug });
if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#chat`);
renderControls(); createRoot(document.getElementById("root")!).render(<TavernApp />);
setInterval(() => { void refreshServer().catch(() => undefined); }, 750);
