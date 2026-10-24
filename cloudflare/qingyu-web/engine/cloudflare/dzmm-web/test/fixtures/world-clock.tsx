/** Real TavernApp + useDzmmCloud; all application fetches are intercepted locally. */
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import { DZMM_INITIAL_STATE, type DzmmSavedState } from "../../../../src/lib/dzmm-storage";
import type { Character } from "../../../../src/lib/dzmm-characters";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import { appendDzmmWorldSnapshot, createDzmmWorldState } from "../../../../src/lib/dzmm-world-state";
import { currentDzmmWorldState } from "../../../../src/lib/dzmm-chat";
import { createDzmmStoryMemory } from "../../../../src/lib/dzmm-story-memory";
import "../../src/page.css";

const BASE_TIME = Date.parse("2026-10-07T00:00:00.000Z");
const CLOCK_KEY = "qingyu-world-clock-fixture-time-v1";
let clockMinutes = Number(sessionStorage.getItem(CLOCK_KEY) ?? 10);
Date.now = () => BASE_TIME + clockMinutes * 60_000;
function moveClock(minutes: number) { clockMinutes += minutes; sessionStorage.setItem(CLOCK_KEY,String(clockMinutes)); renderControls(); }
let capturedExport: unknown;
const ACCOUNT = "44444444-4444-4444-8444-444444444444";
const SERVER_KEY = "qingyu-fixture-world-clock-server-v1";
const STORAGE_KEY = "qingyu-fixture-world-clock-product-storage-v1";
const TEST_COVER = "/dist/assets/qingyu/brand/qingyu-character-placeholder.svg";
const user: DzmmCloudUser = { id: ACCOUNT, email: "qa-world-clock@example.invalid", nickname: "验收旅人", isGuest: sessionStorage.getItem("world-clock-guest") === "true", role: "user" };
const localCharacter: Character = {
  id: "qa-world-clock-original-mapkeeper", name: "原创地图员·时间模式验收", author: "本地验收",
  heat: "0", likes: "0", cover: TEST_COVER, tags: ["一般向", "剧情"],
  description: "这是普通原创的图书馆寻图故事，只用于本地备份验收。",
  personality: "地图员耐心、细心，帮助旅人核对普通地图。",
  scenario: "午后的原创图书馆，桌上放着一张尚未完成的地图。",
  firstMessage: "原创开场：地图员把一张地图摊在桌上，请你核对桥的位置。",
  sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-07T00:00:00.000Z",
};
const initialState = (): DzmmSavedState => ({ ...structuredClone(DZMM_INITIAL_STATE), custom: [], conversations: [], favorites: [],
  preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, dark: true, theme: "dark" } });
type MockServer = { accountId: string; version: number; initialized: boolean; state: DzmmSavedState };
function readServer(): MockServer {
  try { const saved = JSON.parse(sessionStorage.getItem(SERVER_KEY) ?? "null");
    if (saved?.accountId === ACCOUNT && Number.isSafeInteger(saved.version) && Array.isArray(saved.state?.conversations)) return saved;
  } catch { /* Invalid fixture state resets only this fixture. */ }
  return { accountId: ACCOUNT, version: 0, initialized: true, state: initialState() };
}
let server = readServer();
function persistServer() { sessionStorage.setItem(SERVER_KEY, JSON.stringify(server)); }

// A scoped Storage implementation ensures the real hook never reads unrelated local account data.
let productStorage: Record<string, string> = {};
try { productStorage = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { /* Fixture only. */ }
function persistProductStorage() { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(productStorage)); }
Object.defineProperty(window, "localStorage", { configurable: true, value: {
  get length() { return Object.keys(productStorage).length; },
  key(index: number) { return Object.keys(productStorage)[index] ?? null; },
  getItem(key: string) { return Object.hasOwn(productStorage, key) ? productStorage[key] : null; },
  setItem(key: string, value: string) { productStorage[String(key)] = String(value); persistProductStorage(); },
  removeItem(key: string) { delete productStorage[key]; persistProductStorage(); },
  clear() { productStorage = {}; persistProductStorage(); },
} satisfies Storage });

const fixture = { counts: {} as Record<string, number>, putAccepted: 0, blockedRequests: 0,
  nextPutFailure: 0, note: "导入原创地图对话，在聊天设置切换时间模式；时钟按钮只推进本地模拟时间。",
  nextChatFailure: 0, nextUsageFailure: 0, holdMedia: false, lastChat: null as null | Record<string, unknown>,
  releaseMedia: null as null | (() => void),
  lastExport: null as null | { filename: string; bytes: number; messages: number; clockMode: string; worldSnapshots: number; memorySourceCount: number; openingSource: string },
};
const controls = createRoot(document.getElementById("fixture-controls")!);
function summary(state: DzmmSavedState | undefined) {
  return state?.conversations.map(conversation => ({ id: conversation.id, title: conversation.title,
    messages: conversation.messages.length, clockMode: conversation.worldClockMode ?? "story",
    worldSnapshots: conversation.worldState?.snapshots.length ?? 0, worldJournal: conversation.worldState,
    memorySourceCount: conversation.storyMemory?.sourceCount ?? 0, openingSource: conversation.opening?.source ?? "missing" })) ?? [];
}
function currentLocalState(): DzmmSavedState | undefined {
  try { return JSON.parse(productStorage[`qingyu-cloud-backup:${ACCOUNT}`] ?? "null")?.state; } catch { return undefined; }
}
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="时间模式本地隔离控制台">
    <h1>时间模式 · 真实页面隔离验收</h1>
    <p>下方为真实 TavernApp 和云端保存 Hook；模拟云端仅存在当前标签页。没有生产 API、模型、付款或公开发布。时钟由本地按钮推进，聊天计费关闭，所有剧情请求均为本地模拟。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => injectBackup(5)}>导入5条原创时间对话</button>
      <button type="button" onClick={() => moveClock(1440)}>前进24小时</button>
      <button type="button" onClick={() => moveClock(1)}>前进1分钟</button>
      <button type="button" onClick={() => { if (capturedExport) injectFile(capturedExport,"上次导出时间对话.json"); }}>重新导入上次导出</button>
      <button type="button" onClick={() => window.location.reload()}>刷新页面验证恢复</button>
      <button type="button" onClick={() => { sessionStorage.removeItem(SERVER_KEY); sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(CLOCK_KEY); location.hash = "chat"; window.location.reload(); }}>清空本场景重新验收</button>
    </div>
    <p className="fixture-note" role="status" aria-label="验收动作说明">{fixture.note}</p>
    <details><summary>模拟服务、产品本地备份与下载计数</summary>
      <pre aria-label="时间模式模拟状态">{JSON.stringify({ mockAccount: ACCOUNT, clockMinutes, serverVersion: server.version,
        acceptedPUT: fixture.putAccepted, pendingFailure: fixture.nextPutFailure, lastChat: fixture.lastChat, blockedRequests: fixture.blockedRequests,
        serverConversations: summary(server.state), productLocalConversations: summary(currentLocalState()),
        lastExport: fixture.lastExport, requests: fixture.counts }, null, 2)}</pre>
    </details>
  </section>);
}

function backup(messagesCount: number) {
  const messages = Array.from({ length: messagesCount }, (_, index) => ({ id: `qa-world-clock-original-${index}`,
    role: (index % 2 ? "user" : "assistant") as "user" | "assistant",
    content: index === 0 ? localCharacter.firstMessage : index === 2 ? "  **地图员摊开新图**\n桥在河流的东侧。  " : `${index % 2 ? "旅人询问" : "地图员回答"}第 ${index} 处地图标记，桥、道路和图书馆的普通原创内容。` }));
  const memory = createDzmmStoryMemory({ summary: "旅人与地图员已核对前面几处桥的位置。", scene: "原创图书馆",
    completed: ["核对旧桥位置"], pending: ["继续核对下一处标记"], relationships: ["地图员与旅人正在合作核对地图"], items: ["普通纸质地图"] }, messages.slice(0, Math.min(3, messages.length)));
  const state = createDzmmWorldState(); state.location = "原创图书馆";
  let worldState = appendDzmmWorldSnapshot(undefined, messages.slice(0,3), state, BASE_TIME, "realtime");
  const later = structuredClone(state); later.clock.elapsedMinutes = 10;
  later.location = "原创图书馆西厅"; later.facts = ["西厅的地图已经重新装订。"]; later.relationships = [{name:"地图员",affinity:5,trust:8,tension:0,note:"刚完成一次合作核对"}];
  worldState = appendDzmmWorldSnapshot(worldState,messages,later,BASE_TIME+10*60_000,"realtime");
  return { version: 1, character: { ...localCharacter, name: `${localCharacter.name}·${messagesCount}条` }, messages,
    opening: { version: 1, kind: "opening", source: "template", messages: [{ role: "assistant", content: localCharacter.firstMessage }] },
    worldClockMode: "realtime", worldState, storyMemory: memory };

}
function injectFile(value: unknown, filename: string) {
  const input = document.querySelectorAll<HTMLInputElement>('#root input[type="file"]')[1];
  if (!input) { fixture.note = "真实会话文件输入尚未挂载，请等待页面加载。"; renderControls(); return; }
  const file = new File([JSON.stringify(value, null, 2)], filename, { type: "application/json" });
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
  fixture.note = `已向真实会话导入输入选择 ${filename}（${file.size} 字节），等待真实导入提示和自动云端 PUT。`;
  renderControls(); input.dispatchEvent(new Event("change", { bubbles: true }));
}
function injectBackup(count: number) { injectFile(backup(count), `原创会话-${count}.json`); }
function injectInvalidBackup() { const value = backup(201); value.messages[100].content = ""; injectFile(value, "无效空消息.json"); }

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function envelope() { return { state: structuredClone(server.state), version: server.version, initialized: server.initialized, user }; }
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), window.location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const signal = init?.signal ?? request?.signal; signal?.throwIfAborted();
  const key = `${method} ${url.pathname}`; fixture.counts[key] = (fixture.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== window.location.origin) { fixture.blockedRequests++; return finish({ error: "隔离验收禁止外部请求。" }, 501); }
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: true, model: "local-fixture", note: "隔离验收不调用模型。" });
  if (url.pathname === "/api/chat" && method === "POST") {
    const body = JSON.parse(String(init?.body));
    const runtime = currentDzmmWorldState(body.world,Date.now(),body.messages.at(-1)?.content);
    fixture.lastChat = { messages: body.messages.length, lastRole: body.messages.at(-1)?.role, lastText: body.messages.at(-1)?.content, elapsedMinutes:runtime.clock.elapsedMinutes, location:runtime.location, relationships:runtime.relationships, facts:runtime.facts };
    if (fixture.nextChatFailure) { const status=fixture.nextChatFailure; fixture.nextChatFailure=0; return finish({error:"模拟余额不足，未请求真实模型。"}, status); }
    fixture.note = "已收到正确的本地正文请求；没有真实模型或扣费。"; renderControls();
    return new Response('data: '+JSON.stringify({type:"text",text:"地图员翻到河桥这一页，确认新标记已经补上。"})+'\n\n'+'data: '+JSON.stringify({type:"world",state:runtime,recordedAt:Date.now(),updated:false})+'\n\n'+'data: '+JSON.stringify({type:"done"})+'\n\n', {headers:{"Content-Type":"text/event-stream"}});
  }
  if (url.pathname === "/api/backend/v1/billing/usage" && method === "GET") {
    if (fixture.nextUsageFailure) {const status=fixture.nextUsageFailure;fixture.nextUsageFailure=0; return finish({error:"模拟消费读取失败"},status);}
    return finish({accountId:ACCOUNT, availableBalance:1000, reservedCredits:0,totalSpent:0,debtCredits:0,items:[],nextCursor:null});
  }
  if (url.pathname === "/api/backend/v1/chat-media/generate" && method === "POST") {
    if (fixture.holdMedia) await new Promise<void>(resolve => { fixture.releaseMedia=resolve; });
    return finish({error:"隔离模拟素材失败，没有真实生成。"},503);
  }
  if (url.pathname === "/api/backend/v1/session" && method === "GET") return finish({ user, authenticated: !user.isGuest });
  if (url.pathname === "/api/backend/v1/state" && method === "GET") return finish(envelope());
  if (url.pathname === "/api/backend/v1/state" && method === "PUT") {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    if (fixture.nextPutFailure) { const status = fixture.nextPutFailure; fixture.nextPutFailure = 0;
      fixture.note = `模拟 PUT ${status}：真实产品应保留本地导入记录，使用重新同步恢复。`;
      return finish({ error: "本地模拟保存失败；原始备份和当前内容仍可重试。" }, status); }
    if (body.accountId !== ACCOUNT) return finish({ error: "模拟账号不匹配。" }, 401);
    if (body.version !== server.version) return finish({ ...envelope(), error: "模拟版本冲突。" }, 409);
    if (!body.state || !Array.isArray(body.state.conversations)) return finish({ error: "模拟 PUT 缺少 state。" }, 400);
    server = { accountId: ACCOUNT, version: server.version + 1, initialized: true, state: structuredClone(body.state) };
    fixture.putAccepted++; persistServer(); fixture.note = "真实产品 PUT 已保存到本地模拟云端；可刷新页面核对完整历史。";
    return finish(envelope());
  }
  if (url.pathname === "/api/backend/v1/characters" && method === "GET") return finish({ characters: [{ ...localCharacter, id: "qa-world-clock-original-catalog", sourceKind: "public-summary" }] });
  if (url.pathname === "/api/backend/v1/publishing/catalog" && method === "GET") return finish({ characters: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/chat-media" && method === "GET") {
    const conversationId = url.searchParams.get("conversationId") ?? "";
    if (!server.state.conversations.some(conversation => conversation.id === conversationId)) return finish({ error: "模拟未保存会话。" }, 404);
    return finish({ accountId: ACCOUNT, conversationId, vip: { active: true, expiresAt: null, adminPreview: false },
      features: { audio: true, image: true }, limits: { audio: 20, image: 5, maxVoiceChars: 800 }, usage: { audio: 0, image: 0 }, assets: [], ...(url.searchParams.get("pagination") === "1" ? { directory: { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null } } : {}) });
  }
  if (url.pathname === "/api/backend/v1/billing/config" && method === "GET") return finish({ enabled: false,
    priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000,
    rounding: "ceil_combined", outputIncludesReasoning: true, failureRule: "no_valid_output_refund",
    cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
  fixture.blockedRequests++; fixture.note = `隔离模式拒绝未知请求：${key}`;
  return finish({ error: "本地隔离场景没有这个接口；模型、媒体生成、付款与公开发布均被禁止。" }, 501);
};

// Observe the real export Blob without sending a download or network request elsewhere.
const blobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob | MediaSource) => { const url = createObjectURL(blob); if (blob instanceof Blob) blobs.set(url, blob); return url; };
URL.revokeObjectURL = (url: string) => { blobs.delete(url); revokeObjectURL(url); };
const anchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  const blob = blobs.get(this.href);
  if (this.download && blob) {
    const filename = this.download;
    void blob.text().then(text => {
      const value = JSON.parse(text); capturedExport = value;
      fixture.lastExport = { filename, bytes: blob.size, messages: value.messages?.length ?? 0,
        clockMode: value.worldClockMode ?? "missing", worldSnapshots: value.worldState?.snapshots?.length ?? 0,
        memorySourceCount: value.storyMemory?.sourceCount ?? 0, openingSource: value.opening?.source ?? "missing" };
      fixture.note = `已捕获真实导出：${filename}，完整 ${fixture.lastExport.messages} 条消息。`;
      renderControls();
    });
    return;
  }
  if (this.origin !== window.location.origin) { fixture.blockedRequests++; fixture.note = "隔离模式禁止跳转外部网站。"; renderControls(); return; }
  anchorClick.call(this);
};

if (!window.location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#chat`);
renderControls();
createRoot(document.getElementById("root")!).render(<TavernApp />);
setInterval(renderControls, 750);
