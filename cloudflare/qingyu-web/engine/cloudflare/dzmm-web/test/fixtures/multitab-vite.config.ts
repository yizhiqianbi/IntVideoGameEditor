import type { IncomingMessage, ServerResponse } from "node:http";
import { mergeConfig, type Plugin } from "vite";
import base from "../../vite.config.ts";
import { normalizeState } from "../../../dzmm/src/data.ts";
import { ApiError, MAX_BODY_BYTES } from "../../../dzmm/src/http.ts";
import { DZMM_INITIAL_STATE, type DzmmSavedState } from "../../../../src/lib/dzmm-storage.ts";
import type { Character } from "../../../../src/lib/dzmm-characters.ts";
import { appendDzmmWorldSnapshot, createDzmmWorldState } from "../../../../src/lib/dzmm-world-state.ts";

// This disposable API deliberately lives outside either page's storage. Two
// genuine tabs therefore share cloud revisions and native browser localStorage.
const ACCOUNT = "23232323-2323-4232-8232-232323232323";
const user = { id: ACCOUNT, email: "qa-round23-multitab@example.invalid", nickname: "多窗本地旅人", isGuest: false, role: "user" as const };
const seedCard = (id: string, name: string, opening: string): Character => ({
  id, name, author: "本地原创", heat: "0", likes: "0", cover: "/__round23/cover.svg", tags: ["一般向", "剧情"],
  description: "普通原创角色，仅用于同源多窗口离线备份验收。", personality: "耐心、细心。", scenario: "午后的原创图书馆与花园。",
  firstMessage: opening, sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-08T00:00:00.000Z",
});
function initialState(): DzmmSavedState {
  const custom = [seedCard("qa-round23-map", "原创多窗地图员A", "地图员摊开地图，等你核对桥的位置。"),
    seedCard("qa-round23-garden", "原创多窗园丁B", "园丁放下水壶，请你看看今天的新芽。")];
  return { ...structuredClone(DZMM_INITIAL_STATE), custom, favorites: [], conversations: custom.map((card, index) => {
    const messages = [{ id: `qa-round23-opening-${index}`, role: "assistant" as const, content: card.firstMessage }];
    const world = createDzmmWorldState(); world.location = "原创多窗图书馆"; world.clock.elapsedMinutes = 25;
    return { id: `qa-round23-conversation-${index}`, characterId: card.id, title: card.name, messages, worldClockMode: "story" as const,
      worldState: appendDzmmWorldSnapshot(undefined, messages, world, 1791400000000, "story"), updatedAt: 1791400000000 - index * 1000 };
  }), preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, theme: "dark", dark: true } };
}
type StateServer = { version: number; state: DzmmSavedState; writes: number; reads: number; rejectedWrites: number; events: Record<string, unknown>[] };
const freshServer = (): StateServer => ({ version: 0, state: normalizeState(initialState()), writes: 0, reads: 0, rejectedWrites: 0, events: [] });
let stateServer = freshServer();
const envelope = () => ({ user, state: structuredClone(stateServer.state), version: stateServer.version, initialized: true });
const summary = () => ({ version: stateServer.version, state: structuredClone(stateServer.state), writes: stateServer.writes,
  reads: stateServer.reads, rejectedWrites: stateServer.rejectedWrites, events: structuredClone(stateServer.events), accountId: ACCOUNT });
function reply(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
async function bodyJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let bytes = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part); bytes += chunk.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new ApiError(413, "本地模拟请求超过2MB。");
    parts.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new ApiError(400, "本地模拟请求需要有效JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "本地模拟请求应为JSON对象。");
  return value as Record<string, unknown>;
}
const sharedLocalApi: Plugin = { name: "round23-isolated-shared-state", configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (!url.pathname.startsWith("/__round23/")) { next(); return; }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) { reply(response, { error: "仅限本机验收接口。" }, 403); return; }
    if (request.headers.origin && request.headers.origin !== url.origin) { reply(response, { error: "仅限同源本地请求。" }, 403); return; }
    const method = request.method ?? "GET";
    if (url.pathname === "/__round23/cover.svg" && method === "GET") {
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#29283b"/><path d="M30 115 70 35 125 110" fill="none" stroke="#ec77ae" stroke-width="12"/><circle cx="70" cy="35" r="10" fill="#fff"/></svg>'); return;
    }
    if (url.pathname === "/__round23/snapshot" && method === "GET") { reply(response, summary()); return; }
    if (url.pathname === "/__round23/state" && method === "GET") { stateServer.reads++; reply(response, envelope()); return; }
    if (request.headers["x-round23-fixture"] !== "1") { reply(response, { error: "需要本地验收标记。" }, 403); return; }
    if (url.pathname === "/__round23/reset" && method === "POST") { stateServer = freshServer(); reply(response, summary()); return; }
    if (url.pathname !== "/__round23/state" || method !== "PUT") { reply(response, { error: "本地验收接口不存在。" }, 404); return; }
    try {
      const body = await bodyJson(request);
      if (body.accountId !== ACCOUNT) throw new ApiError(401, "本地模拟账号不匹配。");
      if (!Number.isInteger(body.version) || Number(body.version) < 0) throw new ApiError(400, "本地模拟版本无效。");
      const normalized = normalizeState(body.state);
      // There is no await between revision comparison and commit: the fixture
      // gives competing actual tabs the same atomic optimistic-write contract.
      if (body.version !== stateServer.version) {
        stateServer.rejectedWrites++;
        stateServer.events.push({ type: "conflict", tab: request.headers["x-round23-tab"] ?? "unknown", expected: body.version, actual: stateServer.version, at: Date.now() });
        stateServer.events = stateServer.events.slice(-40);
        reply(response, { ...envelope(), error: "本地模拟版本冲突，云端已经有其他修改。" }, 409); return;
      }
      stateServer.state = normalized; stateServer.version++; stateServer.writes++;
      stateServer.events.push({ type: "write", tab: request.headers["x-round23-tab"] ?? "unknown", version: stateServer.version, at: Date.now(),
        conversations: normalized.conversations.map(item => ({ id: item.id, messages: item.messages.map(message => message.content) })) });
      stateServer.events = stateServer.events.slice(-40);
      reply(response, envelope());
    } catch (error) { reply(response, { error: error instanceof Error ? error.message : "本地模拟保存失败。" }, error instanceof ApiError ? error.status : 500); }
  });
} };

export default mergeConfig(base, { plugins: [sharedLocalApi], server: { hmr: false, host: "127.0.0.1", strictPort: true } });
