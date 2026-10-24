/** Actual TavernApp and suggestion handler; disposable fake provider and native browser storage. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import { handleDzmmReplySuggestionsPost } from "../../../../src/lib/dzmm-reply-suggestions-handler";
import type { DzmmReplySuggestion } from "../../../../src/lib/dzmm-reply-suggestions";
import "../../src/page.css";

const ACCOUNT = "25252525-2525-4252-8252-252525252525";
const user: DzmmCloudUser = { id: ACCOUNT, email: "qa-reply-suggestions@example.invalid", nickname: "原创时钟旅人", isGuest: false, role: "user" };
const nativeFetch = window.fetch.bind(window), nativeStorage = window.localStorage;
const CONTROL_KEY = "reply-suggestions-controls-v1", TAB_KEY = "reply-suggestions-tab-v1";
let tabId = sessionStorage.getItem(TAB_KEY);
if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem(TAB_KEY, tabId); }
type Mode = "normal" | "503" | "incomplete" | "hold";
const fixture = { tabId, nextMode: "normal" as Mode, pending: false, suggestionPosts: 0, providerCalls: 0,
  mockChatPosts: 0, abortedSuggestions: 0, blockedRequests: 0, counts: {} as Record<string, number>,
  requests: [] as Record<string, unknown>[], providerRequests: [] as Record<string, unknown>[], chatRequests: [] as Record<string, unknown>[],
  responses: [] as { status: number; mode: Mode }[], server: null as null | Record<string, unknown>,
  note: "普通原创私人会话；行动建议使用实际 handler，本地假供应商不调用模型。" };
let releaseHeld: (() => void) | null = null;
let releaseChat: (() => void) | null = null;
let chatMode: "normal" | "hold" | "blank" = "normal";
let chatPending = false;
const controls = createRoot(document.getElementById("fixture-controls")!);
function setNextMode(value: Mode) {
  fixture.nextMode = value; sessionStorage.setItem(CONTROL_KEY, value);
  fixture.note = `下一次行动建议：${value === "normal" ? "正常三个方向" : value === "503" ? "接口503" : value === "incomplete" ? "供应商只返回两个方向" : "供应商挂起，可使用产品停止"}。`;
  renderControls();
}
const savedMode = sessionStorage.getItem(CONTROL_KEY);
if (savedMode === "503" || savedMode === "incomplete" || savedMode === "hold") fixture.nextMode = savedMode;
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
function counters() { return { suggestionPosts: fixture.suggestionPosts, providerCalls: fixture.providerCalls, mockChatPosts: fixture.mockChatPosts,
  abortedSuggestions: fixture.abortedSuggestions, blockedRequests: fixture.blockedRequests, pending: fixture.pending, chatPending, nextMode: fixture.nextMode, counts: { ...fixture.counts } }; }
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="行动建议隔离验收控制台">
    <h1>每条角色回复的帮我想想 · 真实页面隔离验收</h1>
    <p>普通原创30岁时钟馆修理师；一段本地私人会话，原生 storage 和实际云端 CAS。建议使用实际 handler 与假供应商；聊天回复单独模拟；外部请求、支付、签到、投稿和媒体接口全部拒绝。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => setNextMode("normal")}>下次建议正常三个方向</button>
      <button type="button" onClick={() => setNextMode("503")}>下次建议接口503</button>
      <button type="button" onClick={() => setNextMode("incomplete")}>下次建议不足三个</button>
      <button type="button" onClick={() => setNextMode("hold")}>挂起下一次建议</button>
      <button type="button" disabled={!fixture.pending} onClick={() => releaseHeld?.()}>放行挂起建议</button>
      <button type="button" onClick={() => void refreshServer()}>刷新共享服务端状态</button>
      <button type="button" onClick={() => void resetFixture()}>重置本地原创场景</button>
    </div>
    <p role="status">{fixture.note}</p>
    <pre aria-label="行动建议模拟状态">{JSON.stringify({ ...counters(), serverVersion: fixture.server?.version,
      nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype,
      composer: document.querySelector<HTMLTextAreaElement>('#root textarea[aria-label="发送消息"]')?.value ?? null }, null, 2)}</pre>
  </section>);
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const requestBody = async (request: Request | null, init?: RequestInit) => typeof init?.body === "string" ? init.body : request ? await request.clone().text() : "{}";
async function refreshServer() {
  const response = await nativeFetch("/__reply/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error("本地验收状态读取失败。");
  fixture.server = await response.json() as Record<string, unknown>; renderControls(); return fixture.server;
}
async function resetFixture(reload = true) {
  releaseHeld?.(); releaseChat?.();
  const response = await nativeFetch("/__reply/reset", { method: "POST", headers: { "Content-Type": "application/json", "X-Reply-Fixture": "1" }, body: JSON.stringify({ seed: reload }) });
  if (!response.ok) throw new Error("本地验收状态重置失败。");
  for (const key of Object.keys(ownBackups(nativeStorage))) nativeStorage.removeItem(key);
  for (const key of Object.keys(ownBackups(sessionStorage))) sessionStorage.removeItem(key);
  if (nativeStorage.getItem("qingyu-cloud-local-owner") === ACCOUNT) nativeStorage.removeItem("qingyu-cloud-local-owner");
  if (sessionStorage.getItem("qingyu-cloud-local-owner") === ACCOUNT) sessionStorage.removeItem("qingyu-cloud-local-owner");
  sessionStorage.removeItem(`qingyu-reply-options-v2:${ACCOUNT}`);
  sessionStorage.removeItem(CONTROL_KEY); sessionStorage.removeItem(TAB_KEY);
  fixture.server = await response.json() as Record<string, unknown>;
  fixture.suggestionPosts = 0; fixture.providerCalls = 0; fixture.mockChatPosts = 0; fixture.abortedSuggestions = 0;
  fixture.requests = []; fixture.providerRequests = []; fixture.chatRequests = []; fixture.responses = []; fixture.counts = {};
  fixture.nextMode = "normal"; fixture.pending = false;
  if (reload) { location.hash = "chat"; location.reload(); } else renderControls();
}
function holdProvider(signal?: AbortSignal | null): Promise<void> {
  fixture.pending = true; renderControls();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); fixture.pending = false; releaseHeld = null; renderControls(); };
    const abort = () => { fixture.abortedSuggestions++; finish(); reject(new DOMException("本地供应商等待已取消", "AbortError")); };
    releaseHeld = () => { finish(); resolve(); };
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  });
}
function suggestions(target: string, call: number): { options: DzmmReplySuggestion[] } {
  const variant = target.includes("原图确认") ? "原图" : target.includes("清单") ? "清单" : "开场";
  return { options: [
    { direction: "交流了解", title: `${variant}·了解来源${call}`, reply: `${variant === "原图" ? "这份原图是在哪个档案里找到的？" : variant === "清单" ? "清单上还有哪些需要核对的项目？" : "这两枚齿轮各自有什么用途？"}我想先听你介绍。` },
    { direction: "行动探索", title: `${variant}·共同核对${call}`, reply: variant === "原图" ? "我想与你一起翻查资料柜，把原图里的装配方向核对清楚。" : variant === "清单" ? "我想先按清单核对下一项，再与你确认是否可以继续。" : "我想先量这两枚齿轮的轴径，再把读数与你核对。" },
    { direction: "调整节奏", title: `${variant}·稍作整理${call}`, reply: variant === "原图" ? "我们先把已经确认的尺寸写下来，整理好再去找原图吧。" : variant === "清单" ? "我们暂时停一下，把清单里已完成和未完成的事项分清楚。" : "我想先仔细看看工作台和图纸，整理一下再决定从哪里开始。" },
  ] };
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase(), signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted(); const key = `${method} ${url.pathname}`; fixture.counts[key] = (fixture.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== location.origin) { fixture.blockedRequests++; return finish({ error: "本地隔离验收拒绝外部请求。" }, 501); }
  if (url.pathname.startsWith("/__reply/")) return nativeFetch(url, init);
  if (url.pathname === "/api/backend/v1/session" && method === "GET") return finish({ user, authenticated: true });
  if (url.pathname === "/api/backend/v1/state" && (method === "GET" || method === "PUT")) {
    const response = await nativeFetch("/__reply/state", { method, cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Reply-Fixture": "1", "X-Reply-Tab": fixture.tabId! }, body: method === "PUT" ? await requestBody(request, init) : undefined });
    void refreshServer(); return response;
  }
  if (url.pathname === "/api/reply-suggestions" && method === "POST") {
    const raw = await requestBody(request, init), body = JSON.parse(raw) as Record<string, unknown>;
    fixture.suggestionPosts++; fixture.requests.push(structuredClone(body));
    const call = fixture.suggestionPosts, mode = fixture.nextMode; fixture.nextMode = "normal"; sessionStorage.removeItem(CONTROL_KEY);
    if (mode === "503") { fixture.responses.push({ status: 503, mode }); return finish({ error: "本地模拟建议服务503，原始对话保留。" }, 503); }
    const result = await handleDzmmReplySuggestionsPost(new Request(url, { method: "POST", body: raw, signal }),
      { DZMM_API_KEY: "local-reply-fixture-not-a-real-key", DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_MODEL: "local/reply", DZMM_FAST_MODEL: "local/reply", DZMM_STORY_MODEL: "local/reply",
        DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" },
      { providerFetch: async (_url, providerInit) => {
        fixture.providerCalls++; fixture.providerRequests.push(JSON.parse(String(providerInit?.body)) as Record<string, unknown>);
        if (mode === "hold") await holdProvider(providerInit?.signal);
        const messages = body.messages as { role: string; content: string }[];
        const target = messages.filter(message => message.role === "assistant").at(-1)?.content ?? "";
        const branches = suggestions(target, call); if (mode === "incomplete") branches.options.pop();
        return Response.json({ id: `gen-local-reply-${call}`, usage: { prompt_tokens: 310, completion_tokens: 190, cost: 0 },
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(branches) } }] });
      } });
    fixture.responses.push({ status: result.status, mode }); renderControls(); signal?.throwIfAborted(); return result;
  }
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: true, model: "local-reply-fixture", note: "本地模拟，无模型调用。" });
  if (url.pathname === "/api/chat" && method === "POST") {
    const body = JSON.parse(await requestBody(request, init)) as Record<string, unknown>; fixture.mockChatPosts++; fixture.chatRequests.push(body); renderControls();
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const mode = chatMode; chatMode = "normal";
    const text = mode === "blank" ? "   \n" : "乔岚把待查的清单放到工作台上。\u201c我们先核对这一项，再一起决定下一步。\u201d";
    if (mode !== "hold") return new Response(frame({ type: "text", text }) + frame({ type: "done" }), { headers: { "Content-Type": "text/event-stream" } });
    chatPending = true;
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(frame({ type: "text", text: "乔岚把待查的清单" })));
      const abort = () => { chatPending = false; releaseChat = null; controller.error(new DOMException("停止本地流", "AbortError")); };
      releaseChat = () => { signal?.removeEventListener("abort", abort); chatPending = false; releaseChat = null;
        controller.enqueue(encoder.encode(frame({ type: "text", text }) + frame({ type: "done" }))); controller.close(); };
      signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    } }), { headers: { "Content-Type": "text/event-stream" } });
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
Object.assign(window, { __replySuggestions: { accountId: ACCOUNT, user, setChatMode: (value: typeof chatMode) => { chatMode = value; }, releaseChat: () => releaseChat?.(), setNextMode, release: () => releaseHeld?.(), counters, refreshServer, reset: resetFixture,
  snapshot: async () => ({ server: await refreshServer(), tab: structuredClone({ ...fixture, server: undefined }), backups: ownBackups(nativeStorage), tabBackups: ownBackups(sessionStorage),
    nativeStorage: nativeStorage === window.localStorage && Object.getPrototypeOf(nativeStorage) === Storage.prototype }) } });
if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#chat`);
renderControls(); createRoot(document.getElementById("root")!).render(<StrictMode><TavernApp /></StrictMode>);
