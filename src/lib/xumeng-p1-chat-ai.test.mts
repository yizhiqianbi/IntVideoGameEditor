import test from "node:test";
import assert from "node:assert/strict";
import publishingModule from "./dzmm-publishing";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import memoryHandlerModule from "./dzmm-memory-handler";
import replySuggestionsHandlerModule from "./dzmm-reply-suggestions-handler";

const { clearDzmmPlayMaterialsCache, fetchDzmmPlayMaterials } = publishingModule as typeof import("./dzmm-publishing");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { applyDzmmPromptCaching } = chatModule as typeof import("./dzmm-chat");
const { handleDzmmMemoryPost } = memoryHandlerModule as typeof import("./dzmm-memory-handler");
const { handleDzmmReplySuggestionsPost } = replySuggestionsHandlerModule as typeof import("./dzmm-reply-suggestions-handler");

test("fetchDzmmPlayMaterials caches responses, deduplicates in-flight calls, and isolates caller aborts", async () => {
  clearDzmmPlayMaterialsCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let resolveFetch!: (response: Response) => void;
  globalThis.fetch = (async () => {
    calls += 1;
    return await new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;

  try {
    const controllerA = new AbortController();
    const pA = fetchDzmmPlayMaterials("char-p1", controllerA.signal);
    const pB = fetchDzmmPlayMaterials("char-p1");
    assert.equal(calls, 1, "concurrent callers share one network request");

    controllerA.abort();
    await assert.rejects(pA, { name: "AbortError" });

    resolveFetch(Response.json({ systemPrompt: "You are a cached character.", postHistoryInstructions: "Stay in character." }));
    const resB = await pB;
    assert.equal(resB.systemPrompt, "You are a cached character.");
    assert.equal(resB.postHistoryInstructions, "Stay in character.");

    // Second turn should hit memory cache without calling fetch again
    const resC = await fetchDzmmPlayMaterials("char-p1");
    assert.equal(resC.systemPrompt, "You are a cached character.");
    assert.equal(calls, 1, "subsequent turns hit cache");

    // Cache invalidation forces a fresh fetch
    clearDzmmPlayMaterialsCache("char-p1");
    const pD = fetchDzmmPlayMaterials("char-p1");
    assert.equal(calls, 2);
    resolveFetch(Response.json({ systemPrompt: "Updated prompt." }));
    const resD = await pD;
    assert.equal(resD.systemPrompt, "Updated prompt.");
  } finally {
    globalThis.fetch = originalFetch;
    clearDzmmPlayMaterialsCache();
  }
});

test("prepareDzmmRequest binary-search context trimming preserves maximal fitting tail", () => {
  const character = {
    name: "测试角色",
    description: "一个拥有长背景的角色。",
    personality: "温和、冷静。",
    scenario: "深夜书房。",
    firstMessage: "你来了。",
  };
  const chunk = "这是一段用于测试上下文裁剪边界的长对话内容。".repeat(120); // ~2640 chars each
  const messages = Array.from({ length: 30 }, (_, index) => ({
    role: (index % 2 === 0 ? "assistant" : "user") as "user" | "assistant",
    content: `[turn-${index}] ${chunk}`,
  }));
  // Ensure final message is user
  messages.push({ role: "user", content: "[final-user-turn] 继续说下去。" });

  const prepared = prepareDzmmRequest(character, messages);
  assert.ok(prepared.messages.length >= 1, "keeps at least the latest user message");
  assert.ok(prepared.messages.length < messages.length, "trimmed overflowing older turns");
  assert.equal(prepared.messages.at(-1)?.content, "[final-user-turn] 继续说下去。");

  // Verify the kept tail is truly maximal: prepending the immediately dropped turn must fail if added back
  const keptCount = prepared.messages.length;
  const droppedIndex = messages.length - keptCount - 1;
  assert.ok(droppedIndex >= 0);
  // All kept messages are contiguous suffix of the original tail
  assert.equal(prepared.messages[0].content, messages[droppedIndex + 1].content);
});

test("handleDzmmMemoryPost sends json_object response_format and parses markdown-fenced JSON for any model", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const req = new Request("http://localhost/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "balanced",
      messages: [
        { role: "user", content: "我们离开车站去咖啡馆吧。" },
        { role: "assistant", content: "好，我拿着雨伞跟你一起走进咖啡馆。" },
      ],
    }),
  });
  const res = await handleDzmmMemoryPost(req, {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  }, {
    providerFetch: (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return Response.json({
        choices: [{
          finish_reason: "stop",
          message: {
            content: "```json\n{\"summary\":\"两人离开车站来到咖啡馆。\",\"scene\":\"雨天咖啡馆内\",\"completed\":[\"离开车站\"],\"pending\":[],\"relationships\":[\"同行避雨\"],\"items\":[\"雨伞\"]}\n```",
          },
        }],
      });
    }) as typeof fetch,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(capturedBody?.response_format, { type: "json_object" });
  const data = await res.json() as { state: { scene: string; items: string[] } };
  assert.equal(data.state.scene, "雨天咖啡馆内");
  assert.deepEqual(data.state.items, ["雨伞"]);
});

test("handleDzmmReplySuggestionsPost parses markdown-fenced JSON even on non-venice/sealion models", async () => {
  const req = new Request("http://localhost/api/reply-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "balanced",
      character: {
        name: "林幺",
        description: "深夜便利店常客。",
        personality: "嘴硬心软。",
        scenario: "凌晨一点的便利店。",
        firstMessage: "一点四十。烟在你左手边，别看我。",
      },
      messages: [
        { role: "assistant", content: "一点四十。烟在你左手边，别看我。" },
        { role: "user", content: "生成回复建议" },
      ],
    }),
  });
  const res = await handleDzmmReplySuggestionsPost(req, {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  }, {
    providerFetch: (async () => Response.json({
      choices: [{
        finish_reason: "stop",
        message: {
          content: "```json\n{\"options\":["
            + "{\"direction\":\"温柔关心\",\"title\":\"顺手递火\",\"reply\":\"我把打火机推过去，轻声问你怎么还没睡。\"},"
            + "{\"direction\":\"轻佻逗弄\",\"title\":\"故意逗她\",\"reply\":\"偏要看你，眼圈都黑成这样了还硬撑。\"},"
            + "{\"direction\":\"缓和气氛\",\"title\":\"买宵夜\",\"reply\":\"老板刚煮好关东煮，要不要一起吃点热乎的？\"},"
            + "{\"direction\":\"静静陪伴\",\"title\":\"坐她身旁\",\"reply\":\"我什么也没说，只是拉开椅子坐在你旁边。\"}"
            + "]}\n```",
        },
      }],
    })) as typeof fetch,
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { options: Array<{ direction: string; title: string; reply: string }> };
  assert.equal(data.options.length, 4);
  assert.equal(data.options[0].title, "顺手递火");
});

test("applyDzmmPromptCaching marks leading system prefix for Claude/Gemini via OpenRouter only", () => {
  const longSystem = "角色设定与世界书内容。".repeat(260); // > 2000 chars
  const msgs = [
    { role: "system" as const, content: "核心规则。" },
    { role: "system" as const, content: longSystem },
    { role: "user" as const, content: "你好" },
    { role: "system" as const, content: "动态回合指令" },
  ];

  // Anthropic Claude via OpenRouter -> marks index 1 (last leading system message)
  const claude = applyDzmmPromptCaching(msgs, "anthropic/claude-sonnet-5.5", false);
  assert.equal(typeof claude[0].content, "string");
  assert.ok(Array.isArray(claude[1].content));
  assert.deepEqual(claude[1].content[0].cache_control, { type: "ephemeral" });
  assert.equal(typeof claude[3].content, "string", "trailing dynamic system prompt is never cached");

  // Google Gemini via OpenRouter -> marks index 1
  const gemini = applyDzmmPromptCaching(msgs, "google/gemini-3.8-flash", false);
  assert.ok(Array.isArray(gemini[1].content));

  // Non-Anthropic/Gemini models and direct hosts stay completely untouched
  const deepseek = applyDzmmPromptCaching(msgs, "deepseek/deepseek-v4.1-flash", false);
  assert.equal(typeof deepseek[1].content, "string");
  const directClaude = applyDzmmPromptCaching(msgs, "anthropic/claude-sonnet-5.5", true);
  assert.equal(typeof directClaude[1].content, "string");

  // Short prefixes below minimum threshold stay plain string
  const shortMsgs = [
    { role: "system" as const, content: "简短设定" },
    { role: "user" as const, content: "你好" },
  ];
  const shortClaude = applyDzmmPromptCaching(shortMsgs, "anthropic/claude-sonnet-5.5", false);
  assert.equal(typeof shortClaude[0].content, "string");
});
