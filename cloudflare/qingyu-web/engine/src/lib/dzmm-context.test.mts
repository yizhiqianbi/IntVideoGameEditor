import test from "node:test";
import assert from "node:assert/strict";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import memoryModule from "./dzmm-story-memory";
import openingModule from "./dzmm-conversation-opening";
import characterContextModule from "./dzmm-character-context";
import type { DzmmCharacter, DzmmChatMessage } from "./dzmm-chat";

const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { DZMM_REQUEST_LIMIT_BYTES, DZMM_CONTEXT_LIMIT_CHARS, buildDzmmPromptPlan, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { createDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");
const { getDzmmConversationOpening } = openingModule as typeof import("./dzmm-conversation-opening");
const { DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH } = characterContextModule as typeof import("./dzmm-character-context");
const character: DzmmCharacter = { name: "林音", description: "书店店员", personality: "安静", scenario: "雨天", firstMessage: "你好。" };

function historyFromPlan(plan: ReturnType<typeof buildDzmmPromptPlan>) {
  return plan.messages.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source));
}

test("derived background precedes the first user turn exactly once while preserving card and user context", () => {
  const card = { ...character, id: "missing-opening", firstMessage: "", scenario: "", description: "雾港的档案馆保存着一张失踪地图。" };
  const original = JSON.stringify(card);
  const opening = getDzmmConversationOpening(card);
  const history: DzmmChatMessage[] = [...opening.messages, { role: "user", content: "我想查阅昨晚的借阅记录。" }];
  const request = prepareDzmmRequest(card, history);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  assert.equal(opening.kind, "background");
  assert.deepEqual(historyFromPlan(plan), history);
  assert.equal(request.character.description, card.description);
  assert.equal(request.messages.at(-1)?.content, history.at(-1)?.content);
  assert.equal(JSON.stringify(card), original);
});

test("Chinese UTF-8 body size trims history even when character count is below the context limit", () => {
  const largeCharacter = { ...character, description: "设".repeat(12_000), personality: "性".repeat(12_000) };
  const messages: DzmmChatMessage[] = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? "user" : "assistant",
    content: `消息 ${index}：${"中".repeat(1000)}`,
  }));
  const unbounded = { character: largeCharacter, messages, model: "balanced" };
  const encoder = new TextEncoder();
  assert.ok(encoder.encode(JSON.stringify(unbounded)).byteLength > DZMM_REQUEST_LIMIT_BYTES);
  const request = prepareDzmmRequest(largeCharacter, messages);
  assert.ok(request.messages.length < 40);
  assert.ok(encoder.encode(JSON.stringify(request)).byteLength <= DZMM_REQUEST_LIMIT_BYTES);
  assert.deepEqual(request.messages, messages.slice(-request.messages.length));
  assert.deepEqual(request.messages.at(-1), messages.at(-1));
  assert.doesNotThrow(() => validateDzmmChatInput(request));
});

test("optional reply length is included in the exact UTF-8 boundary while retaining the latest turn and settings", () => {
  const largeCharacter = {
    ...character, description: "描".repeat(12_000), personality: "性".repeat(12_000), scenario: "景".repeat(12_000),
    firstMessage: "始".repeat(3_000),
  };
  const opening: DzmmChatMessage = { role: "assistant", content: largeCharacter.firstMessage };
  const latest: DzmmChatMessage = { role: "user", content: `最新用户输入：${"问".repeat(11_940)}` };
  const preset = "自然推进剧情。";
  const persona = "来自海港的旅人。";
  const encoder = new TextEncoder();
  const irreducible = prepareDzmmRequest(largeCharacter, [latest], preset, persona, "story");
  // This opening also occurs in the card. Deduplication leaves enough provider
  // headroom to isolate the browser request's exact UTF-8 byte boundary.
  const prototype = { ...irreducible, messages: [opening, { role: "assistant", content: "旧" }, latest] };
  const remaining = DZMM_REQUEST_LIMIT_BYTES - encoder.encode(JSON.stringify(prototype)).byteLength;
  assert.ok(remaining > 0);
  const previous: DzmmChatMessage = {
    role: "assistant", content: "旧".repeat(1 + Math.floor(remaining / 3)) + "x".repeat(remaining % 3),
  };
  assert.ok(previous.content.length <= 12_000);
  const legacy = prepareDzmmRequest(largeCharacter, [opening, previous, latest], preset, persona, "story");
  assert.equal(encoder.encode(JSON.stringify(legacy)).byteLength, DZMM_REQUEST_LIMIT_BYTES);
  assert.equal(legacy.messages.length, 3);
  assert.equal(Object.hasOwn(legacy, "maxTokens"), false, "Old calls must retain their original request shape.");
  assert.ok(encoder.encode(JSON.stringify({ ...legacy, maxTokens: 4096 })).byteLength > DZMM_REQUEST_LIMIT_BYTES,
    "Adding reply length after preparation would exceed the body limit.");

  const request = prepareDzmmRequest(largeCharacter, [opening, previous, latest], preset, persona, "story", 4096);
  assert.ok(encoder.encode(JSON.stringify(request)).byteLength <= DZMM_REQUEST_LIMIT_BYTES);
  assert.deepEqual(request.messages, [previous, latest]);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  assert.deepEqual(historyFromPlan(plan), [opening, previous, latest]);
  assert.ok(encoder.encode(JSON.stringify(plan.messages)).byteLength <= DZMM_REQUEST_LIMIT_BYTES);
  assert.equal(request.maxTokens, 4096);
  assert.equal(request.preset, preset);
  assert.equal(request.userPersona, persona);
  assert.equal(request.model, "story");
  assert.doesNotThrow(() => validateDzmmChatInput(request));
});

test("an irreducible oversized prompt plus latest turn produces a helpful error", () => {
  const largeCharacter = {
    name: "林音",
    description: "描".repeat(12_000),
    personality: "性".repeat(12_000),
    scenario: "景".repeat(12_000),
    firstMessage: "始".repeat(12_000),
  };
  assert.throws(() => prepareDzmmRequest(
    largeCharacter,
    [{ role: "assistant", content: "旧消息" }, { role: "user", content: "问".repeat(12_000) }],
    "预".repeat(8_000),
    "我".repeat(4_000),
  ), /最后一条消息总量过大.*缩短/);
});

test("the most recent user turn is retained within a maximum 40-message tail", () => {
  const messages: DzmmChatMessage[] = Array.from({ length: 100 }, (_, index) => ({
    role: index % 2 ? "user" : "assistant",
    content: `第 ${index} 条消息`,
  }));
  const request = prepareDzmmRequest(character, messages, "剧情风格", "旅人", "story");
  assert.equal(request.messages.length, 40);
  assert.deepEqual(request.messages, messages.slice(-40));
  assert.equal(request.messages.at(-1)?.content, "第 99 条消息");
  assert.equal(request.model, "story");
});

test("preparing a request copies inputs and removes character and message metadata", () => {
  const richCharacter = Object.freeze({ ...character, id: "local-private-id", tags: ["都市"], cover: "/example.webp" });
  const messages = Object.freeze([
    Object.freeze({ id: "opening", role: "assistant" as const, content: " 开场白 " }),
    Object.freeze({ id: "latest", role: "user" as const, content: " 你好 " }),
  ]);
  const request = prepareDzmmRequest(richCharacter, messages);
  assert.equal(messages[1].content, " 你好 ");
  assert.equal(request.messages[1].content, "你好");
  assert.notEqual(request.character, richCharacter);
  assert.notEqual(request.messages[1], messages[1]);
  assert.ok(!("id" in request.character) && !("tags" in request.character) && !("cover" in request.character));
  assert.deepEqual(Object.keys(request.messages[1]), ["role", "content"]);
});

test("character limits and the latest user's message are validated before sending", () => {
  assert.doesNotThrow(() => prepareDzmmRequest({ ...character, name: "名".repeat(120) }, [{ role: "user", content: "继续" }]));
  assert.throws(() => prepareDzmmRequest({ ...character, name: "名".repeat(121) }, [{ role: "user", content: "继续" }]), /角色名/);
  assert.throws(() => prepareDzmmRequest(character, [{ role: "user", content: "问".repeat(12_001) }]), /单条消息/);
  assert.throws(() => prepareDzmmRequest(character, [{ role: "assistant", content: "只有角色回复" }]), /用户消息/);
});

test("selected alternate scene survives long history and does not inject the default opening", () => {
  const card: DzmmCharacter = { ...character, openingMessages: [{ role: "user", content: "默认场景的来意" }, { role: "assistant", content: "默认书店场景" }],
    alternateGreetings: ["另一个灯塔场景", "未选择的车站场景"], systemPrompt: "保持这个场景。", postHistoryInstructions: "在结尾留出选择。" };
  const history: DzmmChatMessage[] = [{ role: "assistant", content: card.alternateGreetings![0] },
    ...Array.from({ length: 99 }, (_, index): DzmmChatMessage => ({ role: index % 2 ? "assistant" : "user", content: `后续消息${index}` }))];
  const request = prepareDzmmRequest(card, history);
  assert.equal(request.messages.length, 40);
  assert.deepEqual(request.character.openingMessages, [{ role: "assistant", content: "另一个灯塔场景" }]);
  assert.equal(request.character.firstMessage, undefined);
  assert.equal(request.character.alternateGreetings, undefined);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  const upstream = plan.messages;
  assert.deepEqual(upstream[1], { role: "assistant", content: "另一个灯塔场景" });
  assert.equal(upstream.filter(message => message.content === "另一个灯塔场景").length, 1);
  assert.deepEqual(historyFromPlan(plan).at(-1), history.at(-1));
  assert.deepEqual(upstream.at(-2), { role: "system", content: "在结尾留出选择。" });
  assert.equal(plan.diagnostics.segments.at(-1)?.source, "round-reminder");
  assert.ok(!JSON.stringify(upstream).includes("默认书店场景"));
  assert.ok(!JSON.stringify(upstream).includes("未选择的车站场景"));
});

test("multiple opening turns remain exactly once and display metadata never enters the model request", () => {
  const opening: DzmmChatMessage[] = [{ role: "user", content: "我来到港城" }, { role: "assistant", content: "欢迎来到书库" }];
  const card = { ...character, openingMessages: opening, introduction: "DISPLAY_ONLY_INTRO", gallery: ["/DISPLAY_ONLY_GALLERY.webp"],
    suggestedReplies: ["DISPLAY_ONLY_CHOICE"], creator_notes: "AUTHOR_NOTES_SECRET" };
  const history: DzmmChatMessage[] = [...opening, { role: "user", content: "找旧地图" }];
  const request = prepareDzmmRequest(card, history);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  const upstream = plan.messages;
  assert.deepEqual(historyFromPlan(plan), history);
  assert.equal(request.character.firstMessage, undefined);
  for (const excluded of ["DISPLAY_ONLY", "AUTHOR_NOTES_SECRET", "你好。"])
    assert.ok(!JSON.stringify(upstream).includes(excluded));
  const latestOnly = prepareDzmmRequest(card, [history.at(-1)!]);
  assert.deepEqual(historyFromPlan(buildDzmmPromptPlan(validateDzmmChatInput(latestOnly))), history);
});

test("worldbook activates constants and matching keys with disabled, selective, case and order controls", () => {
  const card: DzmmCharacter = { ...character, characterBook: { scanDepth: 1, entries: [
    { keys: [], constant: true, content: "常驻规则", insertionOrder: 3 },
    { keys: ["LIGHTHOUSE"], content: "灯塔线索", insertionOrder: 2 },
    { keys: ["LIGHTHOUSE"], content: "严格大小写未激活", caseSensitive: true },
    { keys: ["lighthouse"], content: "禁用条目", enabled: false },
    { keys: ["lighthouse"], secondaryKeys: ["map"], selective: true, content: "选择性线索", insertionOrder: 1 },
    { keys: ["书店"], content: "旧消息不激活" },
  ] } };
  const history: DzmmChatMessage[] = [{ role: "assistant", content: "书店" }, { role: "user", content: "find the lighthouse map" }];
  const request = prepareDzmmRequest(card, history);
  assert.deepEqual(request.character.characterBook?.entries.map(entry => entry.content), ["选择性线索", "灯塔线索", "常驻规则"]);
  assert.doesNotThrow(() => validateDzmmChatInput(request));
});

test("worldbook default scans exactly the same ten-message range used by the editor", () => {
  const history: DzmmChatMessage[] = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "user" : "assistant",
    content: index === 1 ? "旧港口" : index === 2 ? "雨巷书店" : `普通消息${index}` }));
  const entries = [{ keys: ["旧港口"], content: "过期范围" }, { keys: ["雨巷书店"], content: "最近十条" }];
  const defaultCard = { ...character, characterBook: { entries } };
  const explicitCard = { ...character, characterBook: { entries, scanDepth: DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH } };
  assert.equal(DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH, 10);
  assert.deepEqual(prepareDzmmRequest(defaultCard, history).character.characterBook?.entries, [entries[1]]);
  assert.deepEqual(prepareDzmmRequest(defaultCard, history).character.characterBook?.entries,
    prepareDzmmRequest(explicitCard, history).character.characterBook?.entries);
  assert.deepEqual(prepareDzmmRequest({ ...character, characterBook: { entries, scanDepth: 4 } }, history).character.characterBook?.entries, []);
});

test("matching old memory omits covered raw turns and sits between the original opening and recent real history", () => {
  const card = Object.freeze({ ...character, firstMessage: "真实开场", messageExamples: "<START>\n{{user}}: EXAMPLE_ONLY\n{{char}}: EXAMPLE_REPLY" });
  const history = Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({ id: `turn-${index}`,
    role: index % 2 ? "user" as const : "assistant" as const, content: index === 0 ? card.firstMessage : `真实消息${index}` })));
  const state = { summary: "已得到写有 {{char}} 的纸条。", scene: "书店", completed: ["收到纸条"], pending: ["核对内容"],
    relationships: ["双方约好核对纸条"], items: ["纸条"] };
  const memory = Object.freeze(createDzmmStoryMemory(state, history.slice(0, 32)));
  const before = JSON.stringify({ card, history, memory });
  const request = prepareDzmmRequest(card, history, undefined, undefined, "story", 2048, { storyMemory: memory, userName: "旅人" });
  assert.deepEqual(request.messages, history.slice(32).map(({ role, content }) => ({ role, content })));
  assert.deepEqual(request.storyMemory, state);
  assert.equal(request.userName, "旅人");
  assert.ok(!JSON.stringify(request).includes("sourceFingerprint") && !JSON.stringify(request).includes("sourceCount"));
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  const openingIndex = plan.diagnostics.segments.findIndex(segment => segment.source === "opening");
  const memoryIndex = plan.diagnostics.segments.findIndex(segment => segment.source === "story-memory");
  const recentIndex = plan.diagnostics.segments.findIndex(segment => segment.source === "recent-history");
  assert.ok(openingIndex < memoryIndex && memoryIndex < recentIndex);
  assert.deepEqual(historyFromPlan(plan), [{ role: "assistant", content: card.firstMessage }, ...request.messages]);
  assert.equal(plan.messages.filter(message => message.content === card.firstMessage).length, 1);
  assert.match(plan.messages[memoryIndex].content, /\{\{char\}\}/, "Real memory text is literal, like real history.");
  assert.match(plan.messages.find((_message, index) => plan.diagnostics.segments[index].source === "example-boundary")!.content,
    /未在当前会话发生/);
  assert.equal(plan.diagnostics.exampleMessages, 2);
  assert.equal(plan.diagnostics.historyMessages, 28);
  assert.equal(plan.diagnostics.hasMemory, true);
  assert.equal(JSON.stringify({ card, history, memory }), before);
});

test("editing a covered source invalidates stale facts and restores available raw history", () => {
  const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "user" as const : "assistant" as const,
    content: `真实消息${index}` }));
  const state = { summary: "STALE_FACT: 旅人曾答应立即出发", scene: "海港", completed: [], pending: ["出发"], relationships: [], items: [] };
  const memory = createDzmmStoryMemory(state, history.slice(0, 12));
  const edited = history.map((message, index) => index === 3 ? { ...message, content: "我没有答应出发。" } : message);
  const request = prepareDzmmRequest(character, edited, undefined, undefined, "balanced", undefined, { storyMemory: memory });
  assert.equal(request.storyMemory, undefined);
  assert.deepEqual(request.messages, edited);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  assert.equal(plan.diagnostics.hasMemory, false);
  assert.ok(!JSON.stringify(plan.messages).includes("STALE_FACT"));
  assert.ok(plan.messages.some(message => message.content === "我没有答应出发。"));
});

test("even memory covering the latest source leaves the latest user turn verbatim", () => {
  const history: DzmmChatMessage[] = [{ role: "assistant", content: "已找到地图。" }, { role: "user", content: "暂时不要出发。" }];
  const memory = createDzmmStoryMemory({ summary: "地图已找到。", scene: "书店", completed: ["找到地图"], pending: [], relationships: [], items: [] }, history);
  const request = prepareDzmmRequest(character, history, undefined, undefined, "balanced", undefined, { storyMemory: memory });
  assert.deepEqual(request.messages, [history.at(-1)]);
});

test("history trimming accounts for macro expansion and ensures both final provider budgets fit", () => {
  const card = { name: "林音", systemPrompt: "{{original}}".repeat(25) };
  const history: DzmmChatMessage[] = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? "user" : "assistant", content: `${index}${"中".repeat(3999)}`,
  }));
  const raw = validateDzmmChatInput({ character: card, messages: history });
  assert.throws(() => buildDzmmPromptPlan(raw), /展开后的.*过长/);
  const request = prepareDzmmRequest(card, history);
  assert.ok(request.messages.length < history.length);
  assert.deepEqual(request.messages.at(-1), history.at(-1));
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  assert.ok(plan.messages.reduce((sum, message) => sum + message.content.length, 0) <= DZMM_CONTEXT_LIMIT_CHARS);
  assert.ok(new TextEncoder().encode(JSON.stringify(plan.messages)).byteLength <= DZMM_REQUEST_LIMIT_BYTES);
  assert.deepEqual(request.messages, history.slice(-request.messages.length));
});

test("an irreducible expanded author prompt fails helpfully even if its raw text is small", () => {
  const card = { name: "林音", systemPrompt: "{{original}}".repeat(100) };
  assert.throws(() => prepareDzmmRequest(card, [{ role: "user", content: "继续" }]), /最后一条消息总量过大.*缩短/);
  assert.throws(() => prepareDzmmRequest(character, [{ role: "user", content: "继续" }], undefined, undefined, "balanced", undefined,
    { userName: "名".repeat(31) }), /用户称呼/);
});

test("UTF-8 budget includes rich opening, author fields, activated lore and reply length", () => {
  const inactive = Array.from({ length: 15 }, (_, index) => ({ keys: [`never-${index}`], content: "不".repeat(3000) }));
  const card: DzmmCharacter = { name: "港城档案员", description: "描".repeat(12000), systemPrompt: "系".repeat(12000),
    messageExamples: "例".repeat(6000), postHistoryInstructions: "后".repeat(2000),
    openingMessages: [{ role: "user", content: "来到海港" }, { role: "assistant", content: "始".repeat(6000) }],
    characterBook: { entries: [{ keys: [], constant: true, content: "规则".repeat(3000) }, ...inactive] } };
  const history: DzmmChatMessage[] = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "user" : "assistant", content: `${index}${"中".repeat(1000)}` }));
  const request = prepareDzmmRequest(card, history, "保留写作预设", "旅人人设", "story", 4096);
  assert.ok(new TextEncoder().encode(JSON.stringify(request)).byteLength <= DZMM_REQUEST_LIMIT_BYTES);
  assert.ok(request.messages.length < 40);
  assert.deepEqual(request.messages.at(-1), history.at(-1));
  assert.deepEqual(request.character.openingMessages, card.openingMessages);
  assert.equal(request.character.characterBook?.entries.length, 1);
  assert.equal(request.preset, "保留写作预设");
  assert.equal(request.userPersona, "旅人人设");
  assert.equal(request.maxTokens, 4096);
  assert.doesNotThrow(() => validateDzmmChatInput(request));
});
