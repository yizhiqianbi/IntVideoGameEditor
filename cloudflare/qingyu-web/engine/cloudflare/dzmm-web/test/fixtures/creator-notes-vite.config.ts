import type { IncomingMessage, ServerResponse } from "node:http";
import { mergeConfig, type Plugin } from "vite";
import base from "../../vite.config.ts";
import { normalizeState } from "../../../dzmm/src/data.ts";
import { ApiError, MAX_BODY_BYTES } from "../../../dzmm/src/http.ts";
import { DZMM_INITIAL_STATE, type DzmmSavedState } from "../../../../src/lib/dzmm-storage.ts";
import type { Character } from "../../../../src/lib/dzmm-characters.ts";

const ACCOUNT = "36363636-3636-4363-8363-363636363636";
const user = { id: ACCOUNT, email: "qa-creator-notes@example.invalid", nickname: "原创书信旅人", isGuest: false, role: "user" as const };
const cards: Character[] = [
  { id: "local-notes-letter", name: "原创港口书信·沈岚", author: "本地原创", heat: "0", likes: "0", cover: "/__notes/cover.svg", tags: ["一般向", "剧情"],
    description: "【感谢绘图者提供封面。】\n\n给远行的朋友：\n\n我是沈岚，今年31岁，负责港口的地图档案。下午的潮水渐渐退去，资料室里只剩翻动旧纸的声音。我把你上次寄来的信放在窗边，等你来一起核对通往灯塔的道路。\n\n桌上摊着一封尚未寄出的书信和两份港口地图，窗外停泊着准备出航的小船。你可以先读信，也可以问我这些地图为何有不同的标记。我们还没决定下一步。\n\n愿这次重逢能把没说完的话慢慢说清楚。\n\n——沈岚留。\n\nPS：作者补充\n主要测试模型为med。\n更新说明：修改港口名称。",
    personality: "耐心、谨慎，愿意慢慢解释地图和书信。", scenario: "", firstMessage: "", sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-08T00:00:00.000Z" },
  { id: "local-notes-paper", name: "原创地图纸条·陆遥", author: "本地原创", heat: "0", likes: "0", cover: "/__notes/cover.svg", tags: ["一般向", "剧情"],
    description: "陆遥，34岁，是灯塔资料室的管理员。他把一张写给朋友的纸条放在地图旁边，等待你一起确认旧桥的位置。\n\n纸条写着：\nPS：别忘了带地图，这是给你的纸条。\n\n陆遥还没有收起地图，也没有替你决定要不要出发。",
    creatorNotes: "作者备注：本角色用于普通书信与地图探索。感谢测试者帮忙核对正文。",
    personality: "细心、坦率，先确认资料再行动。", scenario: "", firstMessage: "", sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-08T00:00:00.000Z" },
];
function initialState(seed = true): DzmmSavedState {
  return { ...structuredClone(DZMM_INITIAL_STATE), custom: seed ? structuredClone(cards) : [], conversations: [], favorites: [],
    preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, theme: "dark", dark: true, worldClockMode: "story" } };
}
type StateServer = { version: number; state: DzmmSavedState; writes: number; reads: number; rejectedWrites: number; events: Record<string, unknown>[] };
const freshServer = (seed = true): StateServer => ({ version: 0, state: normalizeState(initialState(seed)), writes: 0, reads: 0, rejectedWrites: 0, events: [] });
let stateServer = freshServer();
const envelope = () => ({ user, state: structuredClone(stateServer.state), version: stateServer.version, initialized: true });
const summary = () => ({ ...structuredClone(stateServer), accountId: ACCOUNT });
function reply(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(value));
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
const sharedLocalApi: Plugin = { name: "creator-notes-isolated-shared-state", configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (!url.pathname.startsWith("/__notes/")) { next(); return; }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) { reply(response, { error: "仅限本机验收接口。" }, 403); return; }
    if (request.headers.origin && request.headers.origin !== url.origin) { reply(response, { error: "仅限同源本地请求。" }, 403); return; }
    const method = request.method ?? "GET";
    if (url.pathname === "/__notes/cover.svg" && method === "GET") {
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#29283b"/><rect x="27" y="46" width="106" height="72" rx="8" fill="#ec77ae"/><path d="m30 49 50 39 50-39" stroke="#fff" stroke-width="6" fill="none"/></svg>'); return;
    }
    if (url.pathname === "/__notes/snapshot" && method === "GET") { reply(response, summary()); return; }
    if (url.pathname === "/__notes/state" && method === "GET") { stateServer.reads++; reply(response, envelope()); return; }
    if (request.headers["x-notes-fixture"] !== "1") { reply(response, { error: "需要本地验收标记。" }, 403); return; }
    if (url.pathname === "/__notes/reset" && method === "POST") {
      try { const body = await bodyJson(request); stateServer = freshServer(body.seed !== false); reply(response, summary()); }
      catch (error) { reply(response, { error: error instanceof Error ? error.message : "无法重置本地记录。" }, 400); }
      return;
    }
    if (url.pathname !== "/__notes/state" || method !== "PUT") { reply(response, { error: "本地验收接口不存在。" }, 404); return; }
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
      stateServer.events.push({ type: "write", version: stateServer.version, tab: request.headers["x-notes-tab"] ?? "unknown" });
      stateServer.events = stateServer.events.slice(-40); reply(response, envelope());
    } catch (error) { reply(response, { error: error instanceof Error ? error.message : "本地模拟保存失败。" }, error instanceof ApiError ? error.status : 500); }
  });
} };

export default mergeConfig(base, { plugins: [sharedLocalApi], server: { hmr: false, host: "127.0.0.1", port: 21426, strictPort: true } });
