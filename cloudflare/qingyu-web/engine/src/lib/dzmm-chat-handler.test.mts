import test from "node:test";
import assert from "node:assert/strict";
import handlerModule from "./dzmm-chat-handler";
import contextModule from "./dzmm-context";
import characterModule from "./dzmm-characters";
import chatModule from "./dzmm-chat";
import memoryModule from "./dzmm-story-memory";
import type { DzmmBillingCompletion, DzmmBillingPreflight } from "./dzmm-generation-billing";
const { handleDzmmChatPost } = handlerModule as typeof import("./dzmm-chat-handler");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { parseCharacterImport } = characterModule as typeof import("./dzmm-characters");
const { buildDzmmPromptPlan, validateDzmmChatInput, DZMM_PROMPT_VERSION } = chatModule as typeof import("./dzmm-chat");
const { createDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");

const actualCostChatInput = { character: { name: "原创地图保管员" }, messages: [{ role: "user", content: "请展开地图。" }], maxTokens: 512 };
const actualCostEnvironment = { DZMM_API_KEY: "local-cost-fixture", DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_MODEL: "provider/model" };
function costChatRequest(body: unknown = actualCostChatInput, signal?: AbortSignal) {
  return new Request("https://app.test/api/chat", { method: "POST", body: JSON.stringify(body), signal });
}
function costChatBilling() {
  const completions: DzmmBillingCompletion[] = [];
  const quotes: DzmmBillingPreflight[] = [];
  const background: Promise<unknown>[] = [];
  return { completions, quotes, background, waitUntil(promise: Promise<unknown>) { background.push(promise); },
    billing: { async reserve(quote: DzmmBillingPreflight) { quotes.push(quote);
      return { async finalize(completion: DzmmBillingCompletion) { completions.push(completion); } }; } } };
}
function costChatFrames(cost: unknown, content = "保管员展开地图。") {
  return `data: ${JSON.stringify({ id: "gen-actual-cost", choices: [{ delta: { content } }] })}\n\n`
    + `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 300, completion_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 35 }, prompt_tokens_details: { cached_tokens: 250 }, cost } })}\n\n`;
}

test("chat forwards final official actual cost including zero and retains reasoning-inclusive native counts", async () => {
  for (const cost of [0, 0.0035]) {
    const bill = costChatBilling();
    const response = await handleDzmmChatPost(costChatRequest(), actualCostEnvironment, { ...bill, providerFetch: async () =>
      new Response(costChatFrames(cost) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }) });
    assert.equal(await response.text(), "保管员展开地图。");
    assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true, generationId: "gen-actual-cost",
      usage: { promptTokens: 300, completionTokens: 40, providerCostUsd: cost } }]);
    assert.equal(response.headers.get("X-Generation-Id"), null);
  }
});

test("chat invalid or missing actual cost remains absent and compatible providers cannot supply official USD cost", async () => {
  for (const [cost, baseUrl] of [[undefined, actualCostEnvironment.DZMM_BASE_URL], ["0.0035", actualCostEnvironment.DZMM_BASE_URL],
    [0.0035, "https://provider.test/v1"]] as const) {
    const bill = costChatBilling();
    const response = await handleDzmmChatPost(costChatRequest(), { ...actualCostEnvironment, DZMM_BASE_URL: baseUrl }, { ...bill, providerFetch: async () =>
      new Response(costChatFrames(cost) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }) });
    await response.text();
    assert.deepEqual(bill.completions[0].usage, { promptTokens: 300, completionTokens: 40 });
  }
});

test("partial cancellation forwards only cost already read on the server and finalizes once", async () => {
  for (const hasUsage of [true, false]) {
    const bill = costChatBilling();
    const abort = new AbortController();
    let cancelled = false;
    const response = await handleDzmmChatPost(costChatRequest(actualCostChatInput, abort.signal), actualCostEnvironment, {
      ...bill, providerFetch: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
        const frame = hasUsage ? costChatFrames(0.0012)
          : 'data: {"id":"gen-actual-cost","choices":[{"delta":{"content":"保管员展开地图。"}}]}\n\n';
        controller.enqueue(new TextEncoder().encode(frame));
      }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/event-stream" } }),
    });
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "保管员展开地图。");
    abort.abort();
    await reader.cancel();
    await Promise.all(bill.background);
    assert.equal(cancelled, true);
    assert.deepEqual(bill.completions, [{ outcome: "cancelled", hasValidOutput: true, generationId: "gen-actual-cost",
      ...(hasUsage ? { usage: { promptTokens: 300, completionTokens: 40, providerCostUsd: 0.0012 } } : {}) }]);
  }
});

test("a billed empty completion passes trusted cost but never claims valid user output", async () => {
  const bill = costChatBilling();
  const response = await handleDzmmChatPost(costChatRequest(), actualCostEnvironment, { ...bill, providerFetch: async () =>
    new Response(costChatFrames(0.0012, " \n ") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }) });
  assert.equal(response.status, 502);
  assert.equal(bill.completions[0].hasValidOutput, false);
  assert.equal(bill.completions[0].usage?.providerCostUsd, 0.0012);
});

test("chat caps official provider prices without disabling fallback and fails closed before reserve on bad caps", async () => {
  const caps = { DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" };
  const bill = costChatBilling();
  const response = await handleDzmmChatPost(costChatRequest(), { ...actualCostEnvironment, ...caps }, {
    ...bill, providerFetch: async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      assert.deepEqual(body.provider, { max_price: { prompt: 4.4, completion: 13.2 } });
      assert.ok(!Object.hasOwn(body.provider, "allow_fallbacks"));
      return new Response(costChatFrames(0.0035) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  assert.equal(await response.text(), "保管员展开地图。");
  for (const config of [{ ...actualCostEnvironment, DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4" },
    { ...actualCostEnvironment, ...caps, DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "bad" },
    { ...actualCostEnvironment, ...caps, DZMM_BASE_URL: "https://provider.test/v1" }]) {
    const rejectedBill = costChatBilling();
    const rejected = await handleDzmmChatPost(costChatRequest(), config, { ...rejectedBill, providerFetch: async () => {
      throw new Error("Invalid caps cannot start a model.");
    } });
    assert.equal(rejected.status, 503);
    assert.equal(rejectedBill.quotes.length, 0);
    assert.equal(rejectedBill.completions.length, 0);
  }
});

test("client supplied billing cost fields fail validation before reserve or model traffic", async () => {
  for (const extra of [{ providerCostUsd: 0 }, { usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } },
    { provider: { max_price: { prompt: 0, completion: 0 } } }]) {
    const bill = costChatBilling();
    const response = await handleDzmmChatPost(costChatRequest({ ...actualCostChatInput, ...extra }), actualCostEnvironment, {
      ...bill, providerFetch: async () => { throw new Error("Untrusted billing fields cannot start a model."); },
    });
    assert.equal(response.status, 400);
    assert.equal(bill.quotes.length, 0);
  }
});

for (const mode of ["fast", "balanced", "story"] as const) test(`actual ${mode} provider payload uses low reasoning, streams immediately, and preserves character context`, async () => {
  const card = parseCharacterImport({ spec: "chara_card_v2", data: {
    name: "地图保管员", description: "帮助成年旅人寻找旧地图。", personality: "沉着，答应的事会落实。", scenario: "港城书库的午后。",
    first_mes: "不应与多条初始消息重复。",
    system_prompt: "AUTHOR_SYSTEM_SENTINEL", mes_example: "EXAMPLE_SENTINEL", post_history_instructions: "FINAL_SYSTEM_SENTINEL",
    opening_messages: [{ role: "user", content: "我抵达海港" }, { role: "assistant", content: "欢迎来到书库" }],
    alternate_greetings: ["UNSELECTED_GREETING_SENTINEL"], creator_notes: "NEVER_SEND_AUTHOR_NOTES",
    introduction: "NEVER_SEND_DISPLAY_INTRO", suggestedReplies: ["NEVER_SEND_DISPLAY_CHOICES"], gallery: ["/NEVER_SEND_GALLERY.webp"],
    character_book: { entries: [
      { keys: [], constant: true, content: "CONSTANT_LORE_SENTINEL" },
      { keys: ["灯塔"], content: "KEYWORD_LORE_SENTINEL" },
      { keys: ["车站"], content: "INACTIVE_LORE_SENTINEL" },
      { keys: [], constant: true, content: "DISABLED_LORE_SENTINEL", enabled: false },
    ] },
  } });
  const history = [...card.openingMessages!,
    { role: "user" as const, content: "找找灯塔的旧地图" },
    { role: "assistant" as const, content: "旧地图已找到，保管员将它展开在桌上。" },
    { role: "user" as const, content: "嗯，慢慢看看，暂时不出发。" }];
  const prepared = prepareDzmmRequest(card, history, "安静叙事", "来自远方的旅人", mode, 4096);
  let actual: Record<string, unknown> | undefined;
  let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const providerFetch: typeof fetch = async (_url, options) => {
    actual = JSON.parse(options!.body as string);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      upstreamController = controller;
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"他指向地图上"}}]}\n\n'));
    } }),
      { headers: { "Content-Type": "text/event-stream" } });
  };
  const response = await handleDzmmChatPost(new Request("https://app.test/api/dzmm/chat", { method: "POST", body: JSON.stringify(prepared) }),
    { DZMM_API_KEY: "local-test-placeholder", DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "test/default",
      DZMM_FAST_MODEL: "test/fast", DZMM_BALANCED_MODEL: "test/balanced", DZMM_STORY_MODEL: "test/story" }, { providerFetch });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const first = await reader.read();
  const decoder = new TextDecoder();
  assert.equal(first.done, false);
  assert.equal(decoder.decode(first.value), "他指向地图上", "The first visible text must arrive before provider completion.");
  upstreamController.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"旧灯塔的位置。"}}]}\n\ndata: [DONE]\n\n'));
  upstreamController.close();
  let rest = "";
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    rest += decoder.decode(part.value, { stream: true });
  }
  rest += decoder.decode();
  reader.releaseLock();
  assert.equal(rest, "旧灯塔的位置。");
  const sent = actual!.messages as Array<{ role: string; content: string }>;
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(prepared));
  const actualHistory = sent.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source));
  assert.deepEqual(actualHistory, history);
  assert.deepEqual(sent.at(-2), { role: "system", content: "FINAL_SYSTEM_SENTINEL" });
  assert.equal(plan.diagnostics.segments.at(-1)?.source, "round-reminder");
  assert.match(sent.at(-1)!.content, /本轮回应.*最新用户消息/);
  assert.match(sent.at(-1)!.content, /历史中的重复句式不是写作模板/);
  assert.match(sent.at(-1)!.content, /暂停、思考或安静陪伴时，保持当前场景，不安排新事件/);
  assert.equal(sent[0].role, "system");
  assert.equal(actual!.model, `test/${mode}`);
  assert.deepEqual(actual!.reasoning, { effort: "low" });
  assert.equal(actual!.stream, true);
  assert.equal(actual!.temperature, mode === "story" ? 0.9 : 0.75);
  assert.equal(actual!.max_tokens, 4096);
  for (const expected of ["AUTHOR_SYSTEM_SENTINEL",
    card.name, card.description!, card.personality!, card.scenario!, "安静叙事", "来自远方的旅人"])
    assert.ok(sent[0].content.includes(expected));
  const exampleReference = sent.find((_message, index) => plan.diagnostics.segments[index].source === "example-reference");
  assert.match(exampleReference!.content, /EXAMPLE_SENTINEL/);
  assert.match(exampleReference!.content, /并非已发生的事件/);
  const lore = sent.find((_message, index) => plan.diagnostics.segments[index].source === "worldbook");
  assert.match(lore!.content, /CONSTANT_LORE_SENTINEL/);
  assert.match(lore!.content, /KEYWORD_LORE_SENTINEL/);
  for (const separate of ["EXAMPLE_SENTINEL", "CONSTANT_LORE_SENTINEL", "KEYWORD_LORE_SENTINEL"])
    assert.ok(!sent[0].content.includes(separate));
  assert.equal(response.headers.get("X-Xumeng-Prompt-Version"), DZMM_PROMPT_VERSION);
  for (const rule of [/接住用户本轮/, /主动采取具体行动/, /可辨识的新进展/, /完成的动作和结束的小段应当收束/,
    /短回复不代表用户同意/, /不替用户新增未授权的台词、行动、决定、想法或感情/, /暂停时不继续安排剧情事件/,
    /安静的陪伴、思考与等待也可以有意义/, /不机械地追加问题、强迫选项/])
    assert.match(sent[0].content, rule, `${mode} must receive the shared story progression and agency rules`);
  for (const excluded of ["NEVER_SEND", "INACTIVE_LORE_SENTINEL", "DISABLED_LORE_SENTINEL", "UNSELECTED_GREETING_SENTINEL", "不应与多条初始消息重复。"])
    assert.ok(!JSON.stringify(actual).includes(excluded));
});

test("model endpoint rejects display fields and malformed worldbook before calling a provider", async () => {
  const payload = { character: { name: "角色" }, messages: [{ role: "user", content: "继续" }] };
  let calls = 0;
  const providerFetch: typeof fetch = async () => { calls++; throw new Error("Must not run"); };
  for (const extra of [{ introduction: "仅用于界面" }, { suggestedReplies: ["选项"] }, { gallery: ["/image.webp"] },
    { characterBook: { entries: [{ keys: ["x"], content: "x", enabled: "yes" }] } }]) {
    const response = await handleDzmmChatPost(new Request("https://app.test/chat", { method: "POST", body: JSON.stringify({ ...payload, character: { ...payload.character, ...extra } }) }),
      { DZMM_API_KEY: "local-test-placeholder" }, { providerFetch });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test("the real model payload marks examples as fiction and inserts verified old memory before literal recent history", async () => {
  const card = parseCharacterImport({ spec: "chara_card_v2", data: {
    name: "地图保管员", description: "{{char}}协助{{user}}核对地图。", first_mes: "欢迎来到书库，{{user}}。",
    system_prompt: "保持{{char}}的语气，称呼{{user}}。",
    mes_example: "<START>\n{{user}}: EXAMPLE_TRAVEL: 我已经到达灯塔。\n{{char}}: EXAMPLE_SUCCESS: 你打开了灯塔的大门。",
    post_history_instructions: "AUTHOR_END: {{char}}给{{user}}留出回应空间。",
    character_book: { entries: [{ keys: [], constant: true, content: "地图由{{char}}保管，{{user}}可以借阅。" }] },
  } });
  const old = [{ role: "assistant" as const, content: card.firstMessage! },
    { role: "user" as const, content: "请帮我找地图。" },
    { role: "assistant" as const, content: "已找到旧地图，在书庫桌上展开。" }];
  const latest = { role: "user" as const, content: "暂时别出发。我说的 {{char}} 和 {{original}} 都是原文。" };
  const state = { summary: "已找到旧地图，尚未出发。", scene: "书库桌前", completed: ["找到旧地图"],
    pending: ["核对灯塔入口"], relationships: ["保管员协助查地图"], items: ["旧地图在桌上"] };
  const memory = createDzmmStoryMemory(state, old);
  const prepared = prepareDzmmRequest(card, [...old, latest], "安静查看地图", "一位旅人", "story", 1024,
    { storyMemory: memory, userName: "旅人" });
  let actual: Record<string, unknown> | undefined;
  const response = await handleDzmmChatPost(new Request("https://app.test/api/dzmm/chat", { method: "POST", body: JSON.stringify(prepared) }),
    { DZMM_API_KEY: "test-private-key" }, { providerFetch: async (_url, options) => {
      actual = JSON.parse(options!.body as string);
      return new Response('data: {"choices":[{"delta":{"content":"保管员将地图转向你。"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } });
    } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "保管员将地图转向你。");
  const sent = actual!.messages as Array<{ role: string; content: string }>;
  const exampleStart = sent.findIndex(message => message.content.includes("未在当前会话发生"));
  const exampleEnd = sent.findIndex(message => message.content.startsWith("示例结束"));
  const opening = sent.findIndex(message => message.role === "assistant" && message.content === "欢迎来到书库，旅人。");
  const memoryPosition = sent.findIndex(message => message.content.includes("较早真实历史的剧情记录"));
  const recent = sent.findIndex(message => message.content === latest.content);
  assert.ok(exampleStart >= 1 && exampleStart < exampleEnd && exampleEnd < opening && opening < memoryPosition && memoryPosition < recent);
  assert.deepEqual(sent.slice(exampleStart + 1, exampleEnd), [
    { role: "user", content: "EXAMPLE_TRAVEL: 我已经到达灯塔。" },
    { role: "assistant", content: "EXAMPLE_SUCCESS: 你打开了灯塔的大门。" },
  ]);
  assert.match(sent[memoryPosition].content, /之后的真实消息优先/);
  assert.deepEqual(JSON.parse(sent[memoryPosition].content.split("\n").slice(1).join("\n")), state);
  assert.deepEqual(sent[recent], latest, "Macros in real user history must remain literal.");
  assert.ok(!JSON.stringify(actual).includes("sourceFingerprint") && !JSON.stringify(actual).includes("sourceCount"));
  assert.ok(!sent.some(message => message.content === old[1].content || message.content === old[2].content));
  assert.deepEqual(sent.at(-2), { role: "system", content: "AUTHOR_END: 地图保管员给旅人留出回应空间。" });
  assert.match(sent.at(-1)!.content, /用户未授权的台词、行动、感情和重大选择留给用户/);
  assert.deepEqual(JSON.parse(response.headers.get("X-Xumeng-Context")!), {
    historyMessages: 1, exampleMessages: 2, loreEntries: 1, hasMemory: true,
  });
});

test("macro amplification is rejected before calling a provider even when the raw card fits input limits", async () => {
  let calls = 0;
  const payload = { character: { name: "角色", systemPrompt: "{{original}}".repeat(100) }, messages: [{ role: "user", content: "继续" }] };
  assert.doesNotThrow(() => validateDzmmChatInput(payload));
  const response = await handleDzmmChatPost(new Request("https://app.test/chat", { method: "POST", body: JSON.stringify(payload) }),
    { DZMM_API_KEY: "test-private-key" }, { providerFetch: async () => { calls++; throw new Error("must not call provider"); } });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /展开后的.*过长/);
  assert.equal(calls, 0);
});
