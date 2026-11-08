import test from "node:test";
import assert from "node:assert/strict";
import handlerModule from "./dzmm-novel-handler";
import type { DzmmBillingCompletion, DzmmBillingPreflight } from "./dzmm-generation-billing";
const { handleDzmmNovelPost, prepareDzmmNovelGeneration } = handlerModule as typeof import("./dzmm-novel-handler");
const work = { title: "未建之桥", synopsis: "地图员核对旧航志。", type: "story", tags: ["科幻"],
  notes: "三章收束主线。", outline: "发现→核对→修正地图。" };
const input = { operation: "continue", work, chapter: { title: "第一章", content: "林澈把航志翻到末页。" },
  recentContext: "林澈已经拿到了原始地图。", model: "balanced", maxTokens: 512 };
const env = { DZMM_API_KEY: "isolated-provider", DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_MODEL: "provider/model",
  DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" };
function request(body: unknown = input) { return new Request("https://app.test/api/novel-generation", { method: "POST", body: JSON.stringify(body) }); }
function billing() {
  const completions: DzmmBillingCompletion[] = [], quotes: DzmmBillingPreflight[] = [], waits: Promise<unknown>[] = [];
  return { completions, quotes, waits, waitUntil(promise: Promise<unknown>) { waits.push(promise); },
    billing: { async reserve(quote: DzmmBillingPreflight) { quotes.push(quote);
      return { async finalize(completion: DzmmBillingCompletion) { completions.push(completion); } }; } } };
}

test("novel prompt treats current chapter as latest fiction and separates outline from continuation", () => {
  const plan = prepareDzmmNovelGeneration(input);
  assert.equal(plan.input.world, undefined);
  assert.equal(plan.plan.diagnostics.historyMessages, 0);
  assert.match(plan.plan.messages[0].content, /作者可以安排全部虚构人物/);
  const materials = plan.plan.messages[1].content;
  assert.match(materials, /只输出新增的章节正文/);
  assert.match(materials, /林澈把航志翻到末页/);
  assert.match(materials, /林澈已经拿到了原始地图/);
  const outline = prepareDzmmNovelGeneration({ operation: "outline", work, model: "fast" });
  assert.match(outline.plan.messages[1].content, /分章事件/);
  assert.doesNotMatch(outline.plan.messages[1].content, /只输出新增的章节正文/);
});
test("novel prompts preserve cast constraints distinctly from authored notes, dialogue examples and current prose", () => {
  const characters = [{ id: "map-reader", name: "林澈", avatar: "https://example.test/avatar.png", description: "成年地图员。",
    personality: "谨慎，先核对测量。", scenario: "尚未见到原图。", dialogue: "“我会先核对日期。”", liveVoice: "Tina" }];
  for (const operation of ["outline", "continue"]) {
    const plan = prepareDzmmNovelGeneration(operation === "outline" ? { operation, work: { ...work, characters }, model: "fast" } : { ...input, work: { ...work, characters } });
    assert.match(plan.plan.messages[0].content, /characters 是稳定的人物档案/);
    assert.match(plan.plan.messages[0].content, /notes 是作者的创作意图/);
    assert.match(plan.plan.messages[0].content, /不要把作者备注直接写成台词/);
    const material = plan.plan.messages[1].content;
    const authored = JSON.parse(material.slice(material.indexOf("作者资料：\n") + "作者资料：\n".length));
    assert.deepEqual(authored.work.characters, characters);
    assert.equal(authored.work.notes, work.notes);
    if (operation === "continue") assert.equal(authored.chapter.content, input.chapter.content);
  }
  assert.throws(() => prepareDzmmNovelGeneration({ ...input, work: { ...work, characters: [{ ...characters[0], name: "" }] } }), /姓名/);
});

test("client-forged costs and unknown fields, invalid chapter and excessive context never call provider or reserve", async () => {
  for (const body of [{ ...input, cost: 0 }, { ...input, work: { ...work, systemPrompt: "forged" } },
    { ...input, chapter: { title: "章", content: "a".repeat(12001) } }, { ...input, recentContext: "a".repeat(6501) },
    { ...input, operation: "outline" }, { ...input, model: "forged-model" }]) {
    const bill = billing(); let calls = 0;
    const response = await handleDzmmNovelPost(request(body), env, { ...bill, providerFetch: async () => { calls++; return new Response(); } });
    assert.equal(response.status, 400); assert.equal(calls, 0); assert.equal(bill.quotes.length, 0);
  }
});

test("novel streams plain text with low reasoning and shared trusted actual-cost settlement", async () => {
  const bill = billing();
  const response = await handleDzmmNovelPost(request(), env, { ...bill, providerFetch: async (_url, options) => {
    assert.equal(bill.quotes[0].operation, "chat");
    const body = JSON.parse(String(options!.body));
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.deepEqual(body.provider, { max_price: { prompt: 4.4, completion: 13.2 } });
    assert.equal(body.max_tokens, 512);
    assert.match(body.messages[1].content, /林澈把航志翻到末页/);
    return new Response('data: {"id":"gen-novel-test","choices":[{"delta":{"content":"末页记着桥址的测量日期。"}}]}\n\n'
      + 'data: {"choices":[],"usage":{"prompt_tokens":600,"completion_tokens":80,"cost":0.002}}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } });
  } });
  assert.equal(response.status, 200); assert.match(response.headers.get("Content-Type")!, /^text\/plain/);
  assert.equal(await response.text(), "末页记着桥址的测量日期。"); await Promise.all(bill.waits);
  assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true, generationId: "gen-novel-test",
    usage: { promptTokens: 600, completionTokens: 80, providerCostUsd: 0.002 } }]);
});

test("novel pre-output upstream failure returns error and refunds using shared lifecycle", async () => {
  const bill = billing();
  const response = await handleDzmmNovelPost(request(), env, { ...bill, providerFetch: async () => new Response("unavailable", { status: 503 }) });
  assert.equal(response.status, 502); await Promise.all(bill.waits);
  assert.equal(bill.completions.length, 1); assert.equal(bill.completions[0].hasValidOutput, false);
  assert.equal(bill.completions[0].outcome, "failed");
});
