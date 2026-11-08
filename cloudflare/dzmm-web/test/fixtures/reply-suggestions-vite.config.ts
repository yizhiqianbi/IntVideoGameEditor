import type { IncomingMessage, ServerResponse } from "node:http";
import { mergeConfig, type Plugin } from "vite";
import base from "../../vite.config.ts";
import { normalizeState } from "../../../dzmm/src/data.ts";
import { ApiError, MAX_BODY_BYTES } from "../../../dzmm/src/http.ts";
import { DZMM_INITIAL_STATE, type DzmmSavedState } from "../../../../src/lib/dzmm-storage.ts";
import type { Character } from "../../../../src/lib/dzmm-characters.ts";
import { captureDzmmConversationOpening } from "../../../../src/lib/dzmm-conversation-context.ts";
import { appendDzmmWorldSnapshot, createDzmmWorldState } from "../../../../src/lib/dzmm-world-state.ts";

const ACCOUNT = "25252525-2525-4252-8252-252525252525";
const user = { id: ACCOUNT, email: "qa-reply-suggestions@example.invalid", nickname: "原创时钟旅人", isGuest: false, role: "user" as const };
const card: Character = { id: "local-reply-clockkeeper", name: "原创时钟馆·乔岚", author: "本地原创", heat: "0", likes: "0",
  cover: "/__reply/cover.svg", tags: ["一般向", "剧情"],
  description: "乔岚，30岁，时钟馆修理师。玩家是来帮忙核对零件的访客。她希望在闭馆前修好旧钟；可靠核对会影响她是否愿意委托检查。",
  personality: "细心、务实，愿意解释图纸，不把尚未发生的行动当成事实。", scenario: "下午的时钟馆工作台，两枚齿轮和一份旧钟图纸。",
  firstMessage: "乔岚把两枚大小相近的齿轮放到工作台上，指向旧钟的图纸。\u201c轴径还没核对，你想先量尺寸，还是一起找原图？\u201d",
  sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-08T00:00:00.000Z" };
function initialState(seed = true): DzmmSavedState {
  const state: DzmmSavedState = { ...structuredClone(DZMM_INITIAL_STATE), custom: [], conversations: [], favorites: [],
    preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, theme: "dark", dark: true, worldClockMode: "story" } };
  if (!seed) return state;
  const messages: DzmmSavedState["conversations"][number]["messages"] = [
    { id: "reply-opening", role: "assistant", content: card.firstMessage },
    { id: "reply-user", role: "user", content: "我想先用卡尺核对轴径，再一起看原图。" },
    { id: "reply-latest", role: "assistant", content: "乔岚核对了你报出的读数。\u201c轴径已经对上了，接下来得找原图确认装配方向。资料柜就在工作台旁边，你想一起查哪一页？\u201d" },
  ];
  const first = createDzmmWorldState(); first.location = "时钟馆工作台"; first.clock.elapsedMinutes = 5;
  first.facts = ["两枚齿轮等待核对。"]; first.threads = [];
  const latest = structuredClone(first); latest.clock.elapsedMinutes = 10; latest.facts = ["齿轮轴径已核对，装配方向尚未确认。"];
  state.custom = [structuredClone(card)];
  state.conversations = [{ id: "reply-original", characterId: card.id, title: card.name, messages, updatedAt: 1791410100000,
    opening: captureDzmmConversationOpening(card), worldClockMode: "story",
    worldState: appendDzmmWorldSnapshot(appendDzmmWorldSnapshot(undefined, messages.slice(0, 1), first, 1791410000000, "story"), messages, latest, 1791410100000, "story") }];
  return state;
}
type StateServer = { version: number; state: DzmmSavedState; writes: number; reads: number; rejectedWrites: number; events: Record<string, unknown>[] };
const freshServer = (seed = true): StateServer => ({ version: 0, state: normalizeState(initialState(seed)), writes: 0, reads: 0, rejectedWrites: 0, events: [] });
let stateServer = freshServer();
const envelope = () => ({ user, state: structuredClone(stateServer.state), version: stateServer.version, initialized: true });
const summary = () => ({ ...structuredClone(stateServer), accountId: ACCOUNT });
function reply(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
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
const sharedLocalApi: Plugin = { name: "reply-suggestions-isolated-shared-state", configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (!url.pathname.startsWith("/__reply/")) { next(); return; }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) { reply(response, { error: "仅限本机验收接口。" }, 403); return; }
    if (request.headers.origin && request.headers.origin !== url.origin) { reply(response, { error: "仅限同源本地请求。" }, 403); return; }
    const method = request.method ?? "GET";
    if (url.pathname === "/__reply/cover.svg" && method === "GET") {
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#29283b"/><circle cx="80" cy="80" r="49" fill="none" stroke="#ec77ae" stroke-width="8"/><path d="M80 44v36l25 14" stroke="#fff" stroke-width="7" fill="none"/></svg>'); return;
    }
    if (url.pathname === "/__reply/snapshot" && method === "GET") { reply(response, summary()); return; }
    if (url.pathname === "/__reply/state" && method === "GET") { stateServer.reads++; reply(response, envelope()); return; }
    if (request.headers["x-reply-fixture"] !== "1") { reply(response, { error: "需要本地验收标记。" }, 403); return; }
    if (url.pathname === "/__reply/reset" && method === "POST") {
      try { const body = await bodyJson(request); stateServer = freshServer(body.seed !== false); reply(response, summary()); }
      catch (error) { reply(response, { error: error instanceof Error ? error.message : "无法重置本地记录。" }, 400); }
      return;
    }
    if (url.pathname !== "/__reply/state" || method !== "PUT") { reply(response, { error: "本地验收接口不存在。" }, 404); return; }
    try {
      const body = await bodyJson(request);
      if (body.accountId !== ACCOUNT) throw new ApiError(401, "本地模拟账号不匹配。");
      if (!Number.isInteger(body.version) || Number(body.version) < 0) throw new ApiError(400, "本地模拟版本无效。");
      const normalized = normalizeState(body.state);
      if (body.version !== stateServer.version) {
        stateServer.rejectedWrites++; stateServer.events.push({ type: "conflict", expected: body.version, actual: stateServer.version });
        reply(response, { ...envelope(), error: "本地模拟版本冲突，云端已经有其他修改。" }, 409); return;
      }
      stateServer.state = normalized; stateServer.version++; stateServer.writes++;
      stateServer.events.push({ type: "write", version: stateServer.version, tab: request.headers["x-reply-tab"] ?? "unknown" });
      stateServer.events = stateServer.events.slice(-40); reply(response, envelope());
    } catch (error) { reply(response, { error: error instanceof Error ? error.message : "本地模拟保存失败。" }, error instanceof ApiError ? error.status : 500); }
  });
} };

export default mergeConfig(base, { plugins: [sharedLocalApi], server: { hmr: false, host: "127.0.0.1", port: 21425, strictPort: true } });
