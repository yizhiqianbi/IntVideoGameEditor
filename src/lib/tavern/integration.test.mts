import test from "node:test";
import assert from "node:assert/strict";
import chatModule from "../dzmm-chat";
import handlerModule from "../dzmm-chat-handler";
import contextModule from "../dzmm-context";

const { buildDzmmPromptPlan, validateDzmmChatInput } = chatModule as typeof import("../dzmm-chat");
const { handleDzmmChatPost } = handlerModule as typeof import("../dzmm-chat-handler");

const history = [
  { role: "assistant" as const, content: "开场" },
  { role: "user" as const, content: "第一句" },
  { role: "assistant" as const, content: "回应一" },
  { role: "user" as const, content: "第二句" },
];

function input(overrides: Record<string, unknown> = {}) {
  return {
    character: { name: "裴聿", description: "大理寺少卿", firstMessage: "开场" },
    messages: history.slice(1),
    model: "grok",
    maxTokens: 256,
    ...overrides,
  } as never;
}

test("tavern style keeps xumeng style byte-identical when no promptStyle is sent", () => {
  const implicit = buildDzmmPromptPlan(input());
  const explicit = buildDzmmPromptPlan(input({ promptStyle: "xumeng" }));
  assert.deepEqual(implicit.messages, explicit.messages);
  assert.equal(implicit.diagnostics.version, explicit.diagnostics.version);
});

test("tavern style activates the world book with the SillyTavern engine", () => {
  const plan = buildDzmmPromptPlan(input({
    promptStyle: "tavern",
    character: {
      name: "裴聿", description: "大理寺少卿", firstMessage: "开场",
      characterBook: { entries: [
        { keys: [], constant: true, content: "CONSTANT_LORE", position: "before_char" },
        { keys: ["旧港"], content: "KEYWORD_LORE", position: "after_char" },
        { keys: ["车站"], content: "INACTIVE_LORE", position: "after_char" },
      ] },
    },
    messages: [...history.slice(1), { role: "user", content: "说说旧港" }],
  }));
  const contents = plan.messages.map(message => message.content).join("\n");
  assert.match(contents, /CONSTANT_LORE/u);
  assert.match(contents, /KEYWORD_LORE/u);
  assert.doesNotMatch(contents, /INACTIVE_LORE/u);
  assert.ok(plan.diagnostics.loreEntries >= 2);
});

test("@depth world-book entries are inserted inside the tavern chat history", () => {
  const plan = buildDzmmPromptPlan(input({
    promptStyle: "tavern",
    character: {
      name: "裴聿", description: "设定", firstMessage: "开场",
      characterBook: { entries: [
        { id: "depth", keys: [], constant: true, content: "DEPTH_LORE", extensions: { position: 4, depth: 1, role: 0 } },
      ] },
    },
    messages: history.slice(1),
  }));
  const contents = plan.messages.map(message => message.content);
  const depthIndex = contents.indexOf("DEPTH_LORE");
  assert.ok(depthIndex > 0);
  assert.ok(depthIndex < contents.indexOf("第二句"), "depth 1 inserts before the last history message");
  assert.ok(plan.messages[depthIndex].role === "system");
});

test("sampler request fields are validated", () => {
  const accepted = validateDzmmChatInput(input({ sampler: { temperature: 0.5, top_p: 0.9, stop: ["END"] } }));
  assert.equal(accepted.sampler?.temperature, 0.5);
  assert.equal(accepted.sampler?.top_p, 0.9);
  assert.deepEqual(accepted.sampler?.stop, ["END"]);
  assert.throws(() => validateDzmmChatInput(input({ sampler: { unsupportedField: 1 } })), /不支持的字段/u);
  assert.throws(() => validateDzmmChatInput(input({ sampler: { temperature: "hot" } })), /有限数值/u);
});

test("sampler settings reach the provider request and override the fixed temperature", async () => {
  let body: Record<string, unknown> | undefined;
  const providerFetch: typeof fetch = async (_url, options) => {
    body = JSON.parse(options!.body as string);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const response = await handleDzmmChatPost(
    new Request("https://app.test/api/dzmm/chat", { method: "POST", body: JSON.stringify(input({ sampler: { temperature: 0.3, top_p: 0.85, frequency_penalty: 0.2 } })) }),
    { DZMM_API_KEY: "local-test-placeholder", DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "test/default",
      DZMM_FAST_MODEL: "test/fast", DZMM_BALANCED_MODEL: "test/balanced", DZMM_STORY_MODEL: "test/story" },
    { providerFetch },
  );
  assert.equal(response.status, 200);
  await response.body?.cancel();
  assert.equal(body?.temperature, 0.3);
  assert.equal(body?.top_p, 0.85);
  assert.equal(body?.frequency_penalty, 0.2);
});

test("prepareDzmmRequest forwards a sampler profile into the request body", () => {
  const character = { id: "c1", name: "裴聿", author: "作者", heat: "0", likes: "0", cover: "/x.png", tags: [],
    description: "设定", personality: "冷静", scenario: "长安", firstMessage: "开场", sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-01-01T00:00:00.000Z" } as never;
  const request = contextModule.prepareDzmmRequest(character, [
    { role: "assistant", content: "开场" },
    { role: "user", content: "继续" },
  ], "预设", "旅人", "grok", 256, { promptStyle: "tavern", sampler: { temperature: 0.4, top_p: 0.8 } });
  assert.equal(request.sampler?.temperature, 0.4);
  assert.equal(request.sampler?.top_p, 0.8);
  const validated = validateDzmmChatInput(request);
  assert.equal(validated.sampler?.temperature, 0.4);
});

test("group chat request returns the chosen speaker and a multi-character prompt", async () => {
  let body: Record<string, unknown> | undefined;
  const providerFetch: typeof fetch = async (_url, options) => {
    body = JSON.parse(options!.body as string);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"我在。"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const groupInput = {
    character: { name: "裴聿", description: "主角色" },
    messages: [{ role: "assistant", content: "开场", speaker: "裴聿" }, { role: "user", content: "唐团团，面包还有吗？" }],
    model: "grok",
    maxTokens: 128,
    promptStyle: "tavern",
    group: { members: [
      { characterId: "c1", name: "裴聿", description: "大理寺少卿" },
      { characterId: "c2", name: "唐团团", description: "面包店老板娘" },
    ] },
  };
  const response = await handleDzmmChatPost(
    new Request("https://app.test/api/dzmm/chat", { method: "POST", body: JSON.stringify(groupInput) }),
    { DZMM_API_KEY: "local-test-placeholder", DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "test/default",
      DZMM_FAST_MODEL: "test/fast", DZMM_BALANCED_MODEL: "test/balanced", DZMM_STORY_MODEL: "test/story" },
    { providerFetch },
  );
  assert.equal(response.status, 200);
  assert.equal(decodeURIComponent(response.headers.get("X-Xumeng-Speaker") ?? ""), "唐团团");
  await response.body?.cancel();
  const messages = (body?.messages ?? []) as Array<{ role: string; content: string }>;
  const joined = messages.map(message => message.content).join("\n");
  assert.match(joined, /群聊成员/u);
  assert.match(joined, /本轮由「唐团团」回应/u);
  assert.match(joined, /【裴聿】开场/u);
});

test("configured memory injection lands inside history at the chosen depth", () => {
  const storyMemory = { summary: "早期剧情摘要", scene: "", completed: [], pending: [], relationships: [], items: [] };
  const memory = JSON.stringify(storyMemory);
  const plan = buildDzmmPromptPlan(input({
    promptStyle: "tavern",
    storyMemory,
    memoryConfig: { depth: 1, role: "system" },
    messages: [
      { role: "assistant", content: "开场" },
      { role: "user", content: "第一句" },
      { role: "assistant", content: "回应一" },
      { role: "user", content: "第二句" },
    ],
  }));
  const contents = plan.messages.map(message => message.content);
  const memoryIndex = contents.findIndex(content => content.includes("早期剧情摘要"));
  assert.ok(memoryIndex > 0, "memory block is injected");
  assert.equal(memoryIndex, contents.indexOf("第二句") - 1, "depth 1 places memory before the last message");
  assert.equal(plan.messages[memoryIndex].role, "system");
});

test("absent memory config keeps the legacy memory placement", () => {
  const storyMemory = { summary: "旧版记忆", scene: "", completed: [], pending: [], relationships: [], items: [] };
  const plan = buildDzmmPromptPlan(input({ promptStyle: "tavern", storyMemory }));
  const contents = plan.messages.map(message => message.content);
  const memoryIndex = contents.findIndex(content => content.includes("旧版记忆"));
  assert.ok(memoryIndex > 0);
  assert.ok(memoryIndex < contents.indexOf("第一句"), "legacy memory stays before the recent history");
});
