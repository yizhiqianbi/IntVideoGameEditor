import type { IncomingMessage, ServerResponse } from "node:http";
import { mergeConfig, type Plugin } from "vite";
import base from "../../vite.config.ts";
import { normalizeState } from "../../../dzmm/src/data.ts";
import { ApiError, MAX_BODY_BYTES } from "../../../dzmm/src/http.ts";
import { DZMM_INITIAL_STATE, type DzmmSavedState } from "../../../../src/lib/dzmm-storage.ts";
import { parseCharacterImport, type Character } from "../../../../src/lib/dzmm-characters.ts";

// This disposable API deliberately lives outside either page's storage. Two
// genuine tabs therefore share cloud revisions and native browser localStorage.
const ACCOUNT = "24242424-2424-4242-8242-242424242424";
const user = { id: ACCOUNT, email: "qa-round24-authoring@example.invalid", nickname: "原创草稿旅人", isGuest: false, role: "user" as const };
function initialState(): DzmmSavedState {
  return { ...structuredClone(DZMM_INITIAL_STATE), custom: [], conversations: [], favorites: [],
    preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, theme: "dark", dark: true } };
}
type StateServer = { version: number; state: DzmmSavedState; writes: number; reads: number; rejectedWrites: number; events: Record<string, unknown>[]; submissions: Record<string, unknown>[]; publications: Record<string, unknown>[] };
const freshServer = (): StateServer => ({ version: 0, state: normalizeState(initialState()), writes: 0, reads: 0, rejectedWrites: 0, events: [], submissions: [], publications: [] });
let stateServer = freshServer();
const envelope = () => ({ user, state: structuredClone(stateServer.state), version: stateServer.version, initialized: true });
const summary = () => ({ version: stateServer.version, state: structuredClone(stateServer.state), writes: stateServer.writes,
  reads: stateServer.reads, rejectedWrites: stateServer.rejectedWrites, events: structuredClone(stateServer.events), accountId: ACCOUNT, submissions: structuredClone(stateServer.submissions), publications: structuredClone(stateServer.publications) });
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
const sharedLocalApi: Plugin = { name: "round24-isolated-shared-state", configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (!url.pathname.startsWith("/__round24/")) { next(); return; }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) { reply(response, { error: "仅限本机验收接口。" }, 403); return; }
    if (request.headers.origin && request.headers.origin !== url.origin) { reply(response, { error: "仅限同源本地请求。" }, 403); return; }
    const method = request.method ?? "GET";
    if (url.pathname === "/__round24/cover.svg" && method === "GET") {
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#29283b"/><path d="M30 115 70 35 125 110" fill="none" stroke="#ec77ae" stroke-width="12"/><circle cx="70" cy="35" r="10" fill="#fff"/></svg>'); return;
    }
    if (url.pathname === "/__round24/snapshot" && method === "GET") { reply(response, summary()); return; }
    if (url.pathname === "/__round24/state" && method === "GET") { stateServer.reads++; reply(response, envelope()); return; }
    if (request.headers["x-round24-fixture"] !== "1") { reply(response, { error: "需要本地验收标记。" }, 403); return; }
    if (url.pathname === "/__round24/reset" && method === "POST") { stateServer = freshServer(); reply(response, summary()); return; }
    if (url.pathname === "/__round24/submissions" && method === "POST") {
      try {
        const body = await bodyJson(request);
        if (body.accountId !== ACCOUNT) throw new ApiError(401, "本地投稿账号不匹配。");
        if (!body.character || typeof body.character !== "object" || Array.isArray(body.character)) throw new ApiError(400, "本地投稿角色无效。");
        const raw = body.character as Record<string, unknown>;
        if (raw.sourceKind !== "original" || typeof raw.id !== "string" || !raw.id.startsWith("local-")) throw new ApiError(400, "仅允许本轮私人原创角色。");
        if (raw.authoringDraft) throw new ApiError(400, "投稿不得含未完成的编辑草稿。");
        const character: Character = parseCharacterImport(raw, raw.id);
        if (typeof body.publicationId !== "undefined" || typeof body.version !== "undefined") throw new ApiError(400, "本轮仅模拟首次投稿。");
        const capture = { accountId: body.accountId, character: structuredClone(character), at: Date.now(), failed: request.headers["x-round24-publishing-failure"] === "1" };
        stateServer.submissions.push(capture);
        if (capture.failed) { reply(response, { error: "本地模拟提交503：未创建公开投稿。" }, 503); return; }
        const id = `published-${crypto.randomUUID()}`, submissionId = crypto.randomUUID(), now = Date.now();
        const submission = { id: submissionId, publicationId: id, revision: 1, status: "pending", character,
          author: { id: ACCOUNT, nickname: user.nickname }, reason: "", createdAt: now, reviewedAt: null,
          publicationVersion: 1, isListed: false, approvedRevision: null, previewCoverUrl: character.cover };
        const publication = { id, ownerId: ACCOUNT, privateCharacterId: character.id, version: 1, currentRevision: 1,
          approvedRevision: null, isListed: false, createdAt: now, updatedAt: now, latestSubmission: submission };
        stateServer.publications.push(publication);
        reply(response, { publication, submission }, 201); return;
      } catch (error) { reply(response, { error: error instanceof Error ? error.message : "本地模拟投稿失败。" }, error instanceof ApiError ? error.status : 400); return; }
    }
    if (url.pathname === "/__round24/mine" && method === "GET") { reply(response, { publications: structuredClone(stateServer.publications), total: stateServer.publications.length, offset: 0, limit: 20, hasMore: false }); return; }
    if (url.pathname !== "/__round24/state" || method !== "PUT") { reply(response, { error: "本地验收接口不存在。" }, 404); return; }
    try {
      const body = await bodyJson(request);
      if (body.accountId !== ACCOUNT) throw new ApiError(401, "本地模拟账号不匹配。");
      if (!Number.isInteger(body.version) || Number(body.version) < 0) throw new ApiError(400, "本地模拟版本无效。");
      const normalized = normalizeState(body.state);
      // There is no await between revision comparison and commit: the fixture
      // gives competing actual tabs the same atomic optimistic-write contract.
      if (body.version !== stateServer.version) {
        stateServer.rejectedWrites++;
        stateServer.events.push({ type: "conflict", tab: request.headers["x-round24-tab"] ?? "unknown", expected: body.version, actual: stateServer.version, at: Date.now() });
        stateServer.events = stateServer.events.slice(-40);
        reply(response, { ...envelope(), error: "本地模拟版本冲突，云端已经有其他修改。" }, 409); return;
      }
      stateServer.state = normalized; stateServer.version++; stateServer.writes++;
      stateServer.events.push({ type: "write", tab: request.headers["x-round24-tab"] ?? "unknown", version: stateServer.version, at: Date.now(),
        custom: normalized.custom.map(item => ({ id: item.id, name: item.name, firstMessage: item.firstMessage })), conversations: normalized.conversations.map(item => ({ id: item.id, messages: item.messages.map(message => message.content) })) });
      stateServer.events = stateServer.events.slice(-40);
      reply(response, envelope());
    } catch (error) { reply(response, { error: error instanceof Error ? error.message : "本地模拟保存失败。" }, error instanceof ApiError ? error.status : 500); }
  });
} };

export default mergeConfig(base, { plugins: [sharedLocalApi], server: { hmr: false, host: "127.0.0.1", strictPort: true } });
