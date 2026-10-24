/** Real TavernApp and cloud hook, scoped local storage and fully isolated fetch. */
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import { DZMM_INITIAL_STATE, hydrateDzmmState, type DzmmSavedState } from "../../../../src/lib/dzmm-storage";
import type { Character } from "../../../../src/lib/dzmm-characters";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import { appendDzmmWorldSnapshot, createDzmmWorldState } from "../../../../src/lib/dzmm-world-state";
import "../../src/page.css";

const ACCOUNT = "55555555-5555-4555-8555-555555555555";
const SERVER_KEY = "qingyu-message-flow-server-v1";
const STORAGE_KEY = "qingyu-message-flow-storage-v1";
const user: DzmmCloudUser = { id: ACCOUNT, email: "qa-message-flow@example.invalid", nickname: "本地旅人", isGuest: false, role: "user" };
const cover = "/dist/assets/qingyu/brand/qingyu-character-placeholder.svg";
function character(id: string, name: string, opening: string): Character {
  return { id, name, author: "本地原创", heat: "0", likes: "0", cover, tags: ["一般向", "剧情"],
    description: "普通原创角色，仅用来验收消息输入和失败恢复。", personality: "耐心、细心。", scenario: "午后的图书馆与花园。",
    firstMessage: opening, sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-07T00:00:00.000Z" };
}
const characters = [character("qa-message-flow-map", "原创地图员A", "地图员摊开地图，等你核对桥的位置。"),
  character("qa-message-flow-garden", "原创园丁B", "园丁放下水壶，请你看看今天的新芽。")];
function originalWorld(opening: string, index: number) {
  const world = createDzmmWorldState(); world.location = "原创图书馆"; world.clock.elapsedMinutes = 25;
  return appendDzmmWorldSnapshot(undefined, [{ id: `qa-message-flow-opening-${index}`, role: "assistant", content: opening }], world, 1791400000000, "story");
}
const initialState = (): DzmmSavedState => ({ ...structuredClone(DZMM_INITIAL_STATE), custom: characters,
  conversations: characters.map((card, index) => ({ id: `qa-message-flow-${index}`, characterId: card.id, title: card.name,
    messages: [{ id: `qa-message-flow-opening-${index}`, role: "assistant" as const, content: card.firstMessage }],
    worldClockMode: "story" as const, worldState: originalWorld(card.firstMessage, index), updatedAt: Date.now() - index * 1000 })),
  preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, theme: "dark", dark: true } });
type Server = { version: number; state: DzmmSavedState };
function readServer(): Server {
  try { const value = JSON.parse(sessionStorage.getItem(SERVER_KEY) ?? "null");
    if (Number.isSafeInteger(value?.version) && Array.isArray(value.state?.conversations)) return value;
  } catch { /* Fixture state only. */ }
  return { version: 0, state: initialState() };
}
let server = readServer();
let storage: Record<string, string> = {};
try { storage = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { /* Fixture state only. */ }
const persistStorage = () => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
Object.defineProperty(window, "localStorage", { configurable: true, value: {
  get length() { return Object.keys(storage).length; }, key(index: number) { return Object.keys(storage)[index] ?? null; },
  getItem(key: string) { return Object.hasOwn(storage, key) ? storage[key] : null; },
  setItem(key: string, value: string) { storage[String(key)] = String(value); persistStorage(); },
  removeItem(key: string) { delete storage[key]; persistStorage(); }, clear() { storage = {}; persistStorage(); },
} satisfies Storage });

const fixture = { counts: {} as Record<string, number>, writes: 0, mockChatPosts: 0, blockedRequests: 0,
  nextPut: "success" as "success" | "failure" | "committed-response-lost",
  nextChat: "success" as "success" | "hold-failure" | "failure" | "whitespace" | "whitespace-error" | "whitespace-hold" | "partial-error" | "partial-hold", pending: false,
  release: null as null | (() => void), lastSubmitted: "", note: "请在真实消息输入框编辑，不会请求模型。" };
const controls = createRoot(document.getElementById("fixture-controls")!);
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="消息输入隔离验收控制台">
    <h1>消息输入 · 真实页面隔离验收</h1>
    <p>只有两段普通原创本地会话。所有 fetch 在本页模拟；未知、外部接口拒绝；充值、签到、投稿、模型和媒体生成都不会执行。</p>
    <p>会话保持：在A输入未发送文字→点击A→切B输入另一句→切回A；分别检查输入。失败保持：挂起下一次回复→发送A句→等待时输入B句→释放503，检查B句与恢复原句的入口。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => { fixture.nextPut = "failure"; fixture.note = "下次保存仅在本地失败，服务端不提交。"; renderControls(); }}>下次保存不提交返回503</button>
      <button type="button" onClick={() => { fixture.nextPut = "committed-response-lost"; fixture.note = "下次保存先本地提交，再模拟响应丢失。"; renderControls(); }}>下次保存提交后丢失响应</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "whitespace-error"; renderControls(); }}>下次空白后错误</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "whitespace-hold"; renderControls(); }}>下次空白后挂起</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "partial-hold"; renderControls(); }}>下次有效正文后挂起</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "partial-error"; renderControls(); }}>下次有效正文后错误</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "whitespace"; fixture.note = "下一次仅返回两个换行，然后结束。"; renderControls(); }}>下次回复仅空白</button>

      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "hold-failure"; fixture.note = "下一次发送仅在本地挂起，请在等待时输入下一句，再释放503或使用产品停止。"; renderControls(); }}>挂起下一次回复后返回503</button>
      <button type="button" disabled={!fixture.pending} onClick={() => fixture.release?.()}>释放挂起回复为503</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "failure"; fixture.note = "下一次发送立即返回本地503。"; renderControls(); }}>下次回复立即503</button>
      <button type="button" disabled={fixture.pending} onClick={() => { fixture.nextChat = "success"; fixture.note = "下一次发送返回固定原创测试句，不调用模型。"; renderControls(); }}>下一次回复正常模拟</button>
      <button type="button" disabled={fixture.pending} onClick={() => { sessionStorage.removeItem(SERVER_KEY); sessionStorage.removeItem(STORAGE_KEY); location.hash = "chat"; location.reload(); }}>清空本场景</button>
    </div>
    <p role="status">{fixture.note}</p>
    <pre aria-label="消息输入模拟状态">{JSON.stringify({ nextPut: fixture.nextPut, nextChat: fixture.nextChat, pending: fixture.pending,
      lastSubmitted: fixture.lastSubmitted, mockChatPosts: fixture.mockChatPosts, mockStateWrites: fixture.writes,
      blockedRequests: fixture.blockedRequests, serverVersion: server.version,
      composer: document.querySelector<HTMLTextAreaElement>('#root textarea[aria-label="发送消息"]')?.value ?? null,
      savedConversations: server.state.conversations.map(item => ({ id: item.id, title: item.title, messages: item.messages.length })),
      requests: fixture.counts,
      serverTexts: server.state.conversations.map(c => ({id:c.id, messages:c.messages.map(m => m.content)})),
      localBackups: Object.fromEntries(Object.entries(storage).filter(([key]) => key.startsWith("qingyu-cloud-backup:") || key.startsWith("qingyu-cloud-recovery:")).map(([key,raw]) => {const v=JSON.parse(raw);return [key,{version:v.version,conversations:v.state.conversations.map((c: DzmmSavedState["conversations"][number]) => ({id:c.id,messages:c.messages.map(m => m.content)}))}];})) }, null, 2)}</pre>
  </section>);
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function envelope() { return { user, state: structuredClone(server.state), version: server.version, initialized: true }; }
function holdChat(signal?: AbortSignal | null): Promise<void> {
  fixture.pending = true; renderControls();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { signal?.removeEventListener("abort", abort); fixture.pending = false; fixture.release = null; renderControls(); };
    const abort = () => { cleanup(); reject(new DOMException("本地模拟停止", "AbortError")); };
    fixture.release = () => { cleanup(); resolve(); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const signal = init?.signal ?? request?.signal; signal?.throwIfAborted();
  const key = `${method} ${url.pathname}`; fixture.counts[key] = (fixture.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== location.origin) { fixture.blockedRequests++; return finish({ error: "禁止外部接口。" }, 501); }
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: true, model: "local-fixture", note: "本地模拟，无模型调用。" });
  if (url.pathname === "/api/chat" && method === "POST") {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    fixture.mockChatPosts++; fixture.lastSubmitted = body.messages?.filter((message: { role: string; content: string }) => message.role === "user").at(-1)?.content ?? "";
    const mode = fixture.nextChat; fixture.nextChat = "success";
    if (mode === "hold-failure") await holdChat(signal);
    if (mode === "failure" || mode === "hold-failure") return finish({ error: "本地模拟回复503，未调用真实模型。" }, 503);
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    if (mode === "whitespace-hold" || mode === "partial-hold") {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode(frame({ type: "text", text: mode === "whitespace-hold" ? "\n\n" : "  \n地图员把第七处标记写进新地图。  " })));
        void holdChat(signal).then(() => { controller.enqueue(encoder.encode(frame({ type: "error", message: "本地模拟空白后中断。" }))); controller.close(); }, error => controller.error(error));
      } }), { headers: { "Content-Type": "text/event-stream" } });
    }
    fixture.note = "固定原创测试回复已返回，未调用模型或扣费。"; renderControls();
    const text = mode.startsWith("whitespace") ? "\n\n" : mode === "partial-error" ? "  \n地图员把第七处标记写进新地图。  " : "地图员在纸上补好桥的标记，请你核对下一处。";
    const end = mode.endsWith("error") ? { type: "error", message: "本地模拟输出后中断。" } : { type: "done" };
    return new Response(frame({ type: "text", text }) + frame(end), { headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.pathname === "/api/backend/v1/session" && method === "GET") return finish({ user, authenticated: true });
  if (url.pathname === "/api/backend/v1/state" && method === "GET") return finish(envelope());
  if (url.pathname === "/api/backend/v1/state" && method === "PUT") {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    const mode = fixture.nextPut; fixture.nextPut = "success";
    if (mode === "failure") return finish({ error: "本地模拟保存503：没有提交。" }, 503);
    if (body.accountId !== ACCOUNT) return finish({ error: "模拟账号不匹配。" }, 401);
    if (body.version !== server.version) return finish({ ...envelope(), error: "模拟版本冲突。" }, 409);
    if (!Array.isArray(body.state?.conversations)) return finish({ error: "模拟保存缺少会话。" }, 400);
    const parsed = hydrateDzmmState(JSON.stringify(body.state));
    if (parsed.warnings.length) return finish({ error: parsed.warnings.join(" ") }, 400);
    server = { version: server.version + 1, state: structuredClone(body.state) }; fixture.writes++;
    sessionStorage.setItem(SERVER_KEY, JSON.stringify(server));
    if (mode === "committed-response-lost") { renderControls(); throw new TypeError("本地模拟：提交后的响应丢失"); }
    return finish(envelope());
  }
  // Private novel navigation acceptance never saves or calls a model.
  if (url.pathname === "/api/backend/v1/novels" && method === "GET") return finish({ accountId: ACCOUNT, works: [] });
  if (url.pathname === "/api/backend/v1/characters" && method === "GET") return finish({ characters: [] });
  if (url.pathname === "/api/backend/v1/publishing/catalog" && method === "GET") return finish({ characters: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/billing/config" && method === "GET") return finish({ enabled: false,
    priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000,
    rounding: "ceil_combined", outputIncludesReasoning: true, failureRule: "no_valid_output_refund",
    cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
  if (url.pathname === "/api/backend/v1/chat-media" && method === "GET") return finish({ accountId: ACCOUNT,
    conversationId: url.searchParams.get("conversationId"), vip: { active: false, expiresAt: null, adminPreview: false },
    features: { audio: false, image: false }, limits: { audio: 0, image: 0, maxVoiceChars: 800 }, usage: { audio: 0, image: 0 }, assets: [], ...(url.searchParams.get("pagination") === "1" ? { directory: { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null } } : {}) });
  fixture.blockedRequests++; fixture.note = `已拒绝未知请求：${key}`;
  return finish({ error: "这个隔离页面不提供此接口。" }, 501);
};

if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#chat`);
renderControls();
createRoot(document.getElementById("root")!).render(<TavernApp />);
setInterval(renderControls, 750);
