/** Actual TavernApp, import parser, editor, detail and request assembly; no external requests. */
import { createRoot } from "react-dom/client";
import TavernApp from "../../../../src/components/dzmm/tavern-app";
import { DZMM_INITIAL_STATE, hydrateDzmmState, type DzmmSavedState } from "../../../../src/lib/dzmm-storage";
import { DZMM_LISTED_CHARACTERS, parseCharacterImport, type Character } from "../../../../src/lib/dzmm-characters";
import { projectDzmmStoryCharacter, splitDzmmCharacterPresentation } from "../../../../src/lib/dzmm-character-presentation";
import { captureDzmmConversationOpening, applyDzmmConversationOpening } from "../../../../src/lib/dzmm-conversation-context";
import { prepareDzmmRequest } from "../../../../src/lib/dzmm-context";
import { buildDzmmPromptPlan, validateDzmmChatInput } from "../../../../src/lib/dzmm-chat";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import "../../src/page.css";

const ACCOUNT = "45454545-4545-4454-8454-454545454545";
const SERVER_KEY = "catalog-context-fixture-server-v1", STORAGE_KEY = "catalog-context-fixture-storage-v1";
const user: DzmmCloudUser = { id: ACCOUNT, email: "qa-catalog-context@example.invalid", nickname: "原创旅人", isGuest: false, role: "user" };
const imported = parseCharacterImport({ name: "原创地图员 · 完整导入验收", author: "本地原创", cover: "/__catalog-context/cover.svg",
  tags: ["一般向", "剧情"], description: "IMPORT_DESC：林舟是三十二岁的地图员，负责青桥镇的地图档案。",
  personality: "IMPORT_PERSON：细心、耐心，先听旅人的选择。", scenario: "IMPORT_SCENE：午后的地图馆，桌上铺着通往北桥的地图。",
  firstMessage: "IMPORT_OPEN：林舟摊开蓝色地图，请你一起核对北桥的位置。",
  systemPrompt: "IMPORT_SYSTEM：沿用角色已给出的设定。", postHistoryInstructions: "IMPORT_POST：等待旅人决定下一步。",
  characterBook: { entries: [{ id: "archive", keys: [], constant: true, content: "IMPORT_BOOK：借出的地图需要登记在蓝册中。" }] },
}, "local-catalog-context-mapkeeper");
const publicCards = DZMM_LISTED_CHARACTERS.filter(card => card.catalogReadiness === "public-context");
const missing = DZMM_LISTED_CHARACTERS.find(card => card.catalogReadiness === "metadata-only")!;
const initial = (): DzmmSavedState => ({ ...structuredClone(DZMM_INITIAL_STATE), custom: [structuredClone(imported)], conversations: [], favorites: [],
  preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: user.nickname, preset: "延续人物设定和已发生的事件，不替旅人决定下一步。", persona: "", theme: "dark", dark: true, locale: "zh-Hans" } });
type Server = { version: number; state: DzmmSavedState };
function readServer(): Server {
  try { const saved = JSON.parse(sessionStorage.getItem(SERVER_KEY) ?? "null");
    if (Number.isSafeInteger(saved?.version) && Array.isArray(saved?.state?.custom)) return saved;
  } catch { /* Only this fixture's scoped data. */ }
  return { version: 0, state: initial() };
}
let server = readServer();
let storage: Record<string, string> = {};
try { storage = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { /* Only this fixture's data. */ }
const persistStorage = () => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
Object.defineProperty(window, "localStorage", { configurable: true, value: {
  get length() { return Object.keys(storage).length; }, key(index: number) { return Object.keys(storage)[index] ?? null; },
  getItem(key: string) { return Object.hasOwn(storage, key) ? storage[key] : null; },
  setItem(key: string, value: string) { storage[String(key)] = String(value); persistStorage(); },
  removeItem(key: string) { delete storage[key]; persistStorage(); }, clear() { storage = {}; persistStorage(); },
} satisfies Storage });

const fixture = { requests: {} as Record<string, number>, blocked: 0, mockChatPosts: 0, suggestionPosts: 0, stateWrites: 0,
  lastRequest: null as null | Record<string, unknown>, note: "点击下方场景入口，随后操作真实详情页。发送仅捕获本地请求并返回503；新开场自动建议请求也在本地返回501，不会访问外网或模型。" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const envelope = () => ({ user, initialized: true, version: server.version, state: structuredClone(server.state) });

function cardChecks(card: Character) {
  const projected = projectDzmmStoryCharacter(card);
  const opening = captureDzmmConversationOpening(card);
  const messages = [...opening.messages.map((message, index) => ({ ...message, id: `opening-${index}` })), { id: "local-user", role: "user" as const, content: "我先观察当前场景。" }];
  const request = prepareDzmmRequest(applyDzmmConversationOpening(card, { opening, messages }), messages, "延续当前故事。", undefined, "balanced");
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  const body = JSON.stringify(plan.messages);
  return { id: card.id, readiness: card.catalogReadiness ?? "original-import", descriptionChars: card.description.length,
    visibleIntroChars: splitDzmmCharacterPresentation(card.description).body.length, firstMessageChars: card.firstMessage.length,
    requestHasExactDescription: request.character.description === projected.description,
    requestHasSavedOpening: JSON.stringify(request.character.openingMessages) === JSON.stringify(opening.messages),
    openingSegments: plan.diagnostics.segments.filter(segment => segment.source === "opening").length,
    containsSourceLabel: /来自\s*(?:dzmm|DZMM)|from\s+dzmm/i.test(body) };
}
const pureChecks = [imported, ...publicCards].map(cardChecks);
function currentDetailCheck() {
  const id = decodeURIComponent(location.hash.match(/^#character\/(.+)$/)?.[1] ?? "");
  const card = [imported, ...DZMM_LISTED_CHARACTERS, ...server.state.custom].find(value => value.id === id);
  const detail = document.querySelector('section[aria-labelledby="character-detail-title"]');
  if (!card || !detail) return null;
  const bodies = [...detail.querySelectorAll<HTMLElement>("[data-story-body]")].map(item => item.textContent?.trim() ?? "");
  const intro = splitDzmmCharacterPresentation(card.introduction || card.description || "").body.trim();
  const opening = splitDzmmCharacterPresentation(card.firstMessage).body.trim();
  const visibleText = (detail as HTMLElement).innerText;
  return { id, metadataOnly: card.catalogReadiness === "metadata-only", introShownExactly: Boolean(intro) && bodies.includes(intro),
    openingExpected: Boolean(opening), openingShownExactly: Boolean(opening) && bodies.includes(opening),
    sourceLabelShown: /来自\s*(?:dzmm|DZMM)|from\s+dzmm/i.test(visibleText),
    completeCardWarningShown: visibleText.includes("完整角色卡和世界书尚未补齐"),
    editOnlyActionShown: [...detail.querySelectorAll("button")].some(button => button.textContent?.trim() === "补充角色设定") };
}
function snapshot() {
  return { requests: { ...fixture.requests }, blocked: fixture.blocked, mockChatPosts: fixture.mockChatPosts, suggestionPosts: fixture.suggestionPosts,
    stateWrites: fixture.stateWrites, serverVersion: server.version, conversations: server.state.conversations.map(item => ({ id: item.id, characterId: item.characterId,
      messageCount: item.messages.length, openingSource: item.opening?.source })), currentDetail: currentDetailCheck(),
    editorVisible: [...document.querySelectorAll("#root h1")].some(item => item.textContent === "编辑角色" || item.textContent === "创建角色副本"),
    lastRequest: fixture.lastRequest, pureChecks };
}
const controls = createRoot(document.getElementById("fixture-controls")!);
function navigate(id: string) { location.hash = `character/${encodeURIComponent(id)}`; }
function reset() {
  sessionStorage.removeItem(SERVER_KEY); sessionStorage.removeItem(STORAGE_KEY);
  location.hash = `character/${imported.id}`; location.reload();
}
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="目录设定隔离验收控制台"><h1>目录设定与首次对话 · 本地隔离验收</h1>
    <p>真实 TavernApp、详情和编辑器。原创卡由正式导入解析器载入。只有本地测试账户，外部网络由 CSP 禁止；支付、模型、媒体及未知接口全部拒绝。</p>
    <div className="fixture-actions"><button onClick={() => navigate(imported.id)}>① 完整原创导入：打开详情</button>
      <button onClick={() => navigate(missing.id)}>② 缺设定：打开详情 #{missing.id}</button>
      {publicCards.map((card, index) => <button key={card.id} onClick={() => navigate(card.id)}>③ 公开背景 {index + 1} #{card.id}{card.firstMessage ? " · 有开场" : " · 仅背景"}</button>)}
      <button onClick={renderControls}>刷新验收状态</button><button onClick={reset}>清空并重置本地场景</button></div>
    <p>{fixture.note}</p><details open><summary>验收状态（仅计数和布尔值，不展开公开角色正文）</summary><pre aria-label="目录设定验收状态">{JSON.stringify(snapshot(), null, 2)}</pre></details>
  </section>);
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null, url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase(); (init?.signal ?? request?.signal)?.throwIfAborted();
  const key = `${method} ${url.pathname}`; fixture.requests[key] = (fixture.requests[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return json(value, status); };
  if (url.origin !== location.origin) { fixture.blocked++; return finish({ error: "隔离验收拒绝外部请求。" }, 501); }
  if (url.pathname === "/api/backend/v1/session" && method === "GET") return finish({ user, authenticated: true });
  if (url.pathname === "/api/backend/v1/state" && method === "GET") return finish(envelope());
  if (url.pathname === "/api/backend/v1/state" && method === "PUT") {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    if (body.accountId !== ACCOUNT) return finish({ error: "本地测试账户不匹配。" }, 401);
    if (body.version !== server.version) return finish({ ...envelope(), error: "本地模拟版本冲突。" }, 409);
    const parsed = hydrateDzmmState(JSON.stringify(body.state));
    if (parsed.warnings.length) return finish({ error: parsed.warnings.join(" ") }, 400);
    server = { version: server.version + 1, state: parsed.state }; fixture.stateWrites++;
    sessionStorage.setItem(SERVER_KEY, JSON.stringify(server)); return finish(envelope());
  }
  if (url.pathname === "/api/chat" && method === "GET") return finish({ configured: true, model: "local-fixture", note: "本地请求捕获，不调用模型。" });
  if (url.pathname === "/api/chat" && method === "POST") {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}"); fixture.mockChatPosts++;
    const payload = JSON.stringify(body);
    fixture.lastRequest = { requestCharacterName: body.character?.name, descriptionChars: body.character?.description?.length ?? 0,
      openingMessages: body.character?.openingMessages?.length ?? 0, messageCount: body.messages?.length ?? 0,
      originalMarkers: Object.fromEntries(["IMPORT_DESC", "IMPORT_PERSON", "IMPORT_SCENE", "IMPORT_OPEN", "IMPORT_SYSTEM", "IMPORT_POST", "IMPORT_BOOK"].map(marker => [marker, payload.includes(marker)])) };
    fixture.note = "首条真实请求已在本地捕获，返回测试503；模型与自动建议接口都未访问外网。";
    return finish({ error: "本地验收已捕获请求；未调用模型。" }, 503);
  }
  if (/suggestion/.test(url.pathname)) { fixture.suggestionPosts++; fixture.blocked++; return finish({ error: "本轮禁止行动建议请求。" }, 501); }
  if (url.pathname === "/api/backend/v1/characters" && method === "GET") return finish({ characters: [] });
  if (url.pathname === "/api/backend/v1/publishing/catalog" && method === "GET") return finish({ characters: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/publishing/mine" && method === "GET") return finish({ publications: [], total: 0, offset: 0, limit: 20, hasMore: false });
  if (url.pathname === "/api/backend/v1/publishing/likes" && method === "GET") return finish({ likes: Object.fromEntries((url.searchParams.get("ids") ?? "").split(",").map(id => [id, { count: 0, liked: false }])) });
  if (url.pathname === "/api/backend/v1/novels" && method === "GET") return finish({ accountId: ACCOUNT, works: [] });
  if (url.pathname === "/api/backend/v1/billing/config" && method === "GET") return finish({ enabled: false, priceRevision: null,
    inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000, rounding: "ceil_combined", outputIncludesReasoning: true,
    failureRule: "no_valid_output_refund", cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
  if (url.pathname === "/api/backend/v1/chat-media" && method === "GET") return finish({ accountId: ACCOUNT, conversationId: url.searchParams.get("conversationId"),
    vip: { active: false, expiresAt: null, adminPreview: false }, features: { audio: false, image: false }, limits: { audio: 0, image: 0, maxVoiceChars: 800 }, usage: { audio: 0, image: 0 }, assets: [],
    ...(url.searchParams.get("pagination") === "1" ? { directory: { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null } } : {}) });
  fixture.blocked++; return finish({ error: "隔离验收未提供此接口。" }, 501);
};

Object.assign(window, { __catalogContext: { snapshot, reset, originalId: imported.id, missingId: missing.id, publicIds: publicCards.map(card => card.id) } });
if (!location.hash) history.replaceState(null, "", `${location.pathname}#character/${imported.id}`);
renderControls(); createRoot(document.getElementById("root")!).render(<TavernApp />);
setInterval(renderControls, 750);
