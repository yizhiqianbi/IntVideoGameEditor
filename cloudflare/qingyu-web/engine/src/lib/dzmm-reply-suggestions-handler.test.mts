import test from "node:test";
import assert from "node:assert/strict";
import handlerModule from "./dzmm-reply-suggestions-handler";
import billingModule from "./dzmm-generation-billing";
import type { DzmmBillingCompletion, DzmmBillingPreflight } from "./dzmm-generation-billing";
const { handleDzmmReplySuggestionsPost } = handlerModule as typeof import("./dzmm-reply-suggestions-handler");
const { DzmmBillingError } = billingModule as typeof import("./dzmm-generation-billing");
const secret = "mock-provider-key-never-returned";
const env = { DZMM_API_KEY: secret, DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_MODEL: "provider/model",
  DZMM_FAST_MODEL: "provider/fast", DZMM_STORY_MODEL: "provider/story",
  DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" };
const input = { character: { name: "原创地图保管员" }, model: "balanced", maxTokens: 2048,
  messages: [{ role: "assistant", content: "保管员指向图上的两个入口，等待核对。" }, { role: "user", content: "REQUEST_ONLY" }] };
const branches = { options: [
  { direction: "交流了解", title: "询问差异", reply: "这两个入口有什么差别？我想先了解一下。" },
  { direction: "行动探索", title: "核对图纸", reply: "我想先用原图核对这两个标记的位置。" },
  { direction: "调整节奏", title: "停留整理", reply: "我们先把已知的线索整理一下，暂时不出发。" },
] };
function request(value: unknown = input, signal?: AbortSignal) { return new Request("https://app.test/api/reply-suggestions", {
  method: "POST", body: JSON.stringify(value), signal,
}); }
function provider(content: unknown = branches, finishReason: unknown = "stop", cost: unknown = 0.00053) {
  return Response.json({ id: "gen-suggestions-local", usage: { prompt_tokens: 310, completion_tokens: 190,
    completion_tokens_details: { reasoning_tokens: 70 }, cost },
    choices: [{ finish_reason: finishReason, message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
}
function billing() {
  const quotes: DzmmBillingPreflight[] = [], completions: DzmmBillingCompletion[] = [], waits: Promise<unknown>[] = [];
  return { quotes, completions, waits, waitUntil(promise: Promise<unknown>) { waits.push(promise); },
    billing: { async reserve(preflight: DzmmBillingPreflight) { quotes.push(preflight); return { async finalize(value: DzmmBillingCompletion) { completions.push(value); } }; } } };
}

test("venice suggestions omit structured outputs and reasoning, which that model does not accept", async () => {
  const bill = billing();
  const response = await handleDzmmReplySuggestionsPost(request({ ...input, model: "venice" }), env, { ...bill,
    providerFetch: async (_url, options) => {
      const sent = JSON.parse(String(options!.body));
      assert.equal(sent.model, "cognitivecomputations/dolphin-mistral-24b-venice-edition");
      assert.deepEqual(sent.response_format, { type: "json_object" });
      assert.equal(sent.reasoning, undefined);
      assert.deepEqual(sent.provider.max_price, { prompt: 0.2, completion: 0.9, request: 0 });
      return provider();
    },
  });
  assert.equal(response.status, 200);
});

test("complete distinct branches use chat billing, low reasoning, price caps and trusted actual cost", async () => {
  const bill = billing();
  const response = await handleDzmmReplySuggestionsPost(request(), env, { ...bill, providerFetch: async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${secret}`);
    assert.equal(bill.quotes[0].operation, "chat");
    const sent = JSON.parse(String(options!.body));
    assert.equal(sent.stream, false); assert.equal(sent.max_tokens, 512);
    assert.equal(sent.model, "provider/model"); assert.equal(bill.quotes[0].model, sent.model);
    assert.deepEqual(sent.reasoning, { effort: "low" });
    assert.deepEqual(sent.provider, { max_price: { prompt: 4.4, completion: 13.2 } });
    assert.equal(sent.response_format.type, "json_schema"); assert.equal(sent.response_format.json_schema.strict, true);
    assert.equal(sent.response_format.json_schema.schema.properties.options.minItems, 3);
    assert.equal(sent.response_format.json_schema.schema.properties.options.maxItems, 3);
    assert.doesNotMatch(JSON.stringify(sent.messages), /REQUEST_ONLY|<xumeng-state>/);
    return provider();
  } });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), branches);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Xumeng-Max-Output-Tokens"), "512");
  assert.match(response.headers.get("X-Xumeng-Prompt-Version")!, /reply-branches/);
  await Promise.all(bill.waits);
  assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true, generationId: "gen-suggestions-local",
    usage: { promptTokens: 310, completionTokens: 190, providerCostUsd: 0.00053 } }]);
});

test("affordability rebuilds the exact provider body and reserve at the chosen shorter budget", async () => {
  const bill = billing(); let quote: DzmmBillingPreflight | undefined;
  const response = await handleDzmmReplySuggestionsPost(request(), env, { ...bill,
    billing: { ...bill.billing, async limitOutputTokens(preflight) { quote = preflight; return 384; } },
    providerFetch: async (_url, options) => {
      assert.equal(JSON.parse(String(options!.body)).max_tokens, 384);
      assert.equal(quote?.maxOutputTokens, 512); assert.equal(bill.quotes[0].maxOutputTokens, 384);
      assert.notEqual(quote?.requestFingerprint, bill.quotes[0].requestFingerprint);
      return provider();
    },
  });
  assert.equal(response.status, 200);
});

test("suggestions retain the selected ordinary chat model and unchanged server price guarantees", async () => {
  for (const [preset, model] of [["fast", "provider/fast"], ["balanced", "provider/model"], ["story", "provider/story"]] as const) {
    const bill = billing();
    const response = await handleDzmmReplySuggestionsPost(request({ ...input, model: preset }), env, { ...bill,
      providerFetch: async (_url, supplied) => {
        const sent = JSON.parse(String(supplied!.body));
        assert.equal(sent.model, model); assert.equal(bill.quotes[0].model, model);
        assert.deepEqual(sent.reasoning, { effort: "low" });
        assert.deepEqual(sent.provider.max_price, { prompt: 4.4, completion: 13.2 });
        return provider();
      },
    });
    assert.equal(response.status, 200);
  }
});

test("partial, duplicate, invalid, extra and non-stop suggestions release the whole reservation", async () => {
  const cases: Array<[unknown, unknown]> = [[{ options: branches.options.slice(0, 2) }, "stop"],
    [{ options: branches.options.map((option, index) => index === 1 ? { ...option, reply: branches.options[0].reply } : option) }, "stop"],
    [{ ...branches, state: {} }, "stop"], ["{\"options\":[", "stop"], [branches, "length"], [branches, undefined],
    [" ", "stop"], ["```json\n" + JSON.stringify(branches) + "\n```", "stop"]];
  for (const [content, finishReason] of cases) {
    const bill = billing();
    const response = await handleDzmmReplySuggestionsPost(request(), env, { ...bill, providerFetch: async () => {
      const returned = provider(content, finishReason === undefined ? null : finishReason);
      return returned;
    } });
    assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /mock-provider-key|"options"/);
    assert.equal(bill.completions.length, 1);
    assert.equal(bill.completions[0].outcome, "failed"); assert.equal(bill.completions[0].hasValidOutput, false);
  }
});

test("caller costs, pending turns, oversized input and invalid caps stop before reserve and provider", async () => {
  const bill = billing(); let calls = 0;
  const options = { ...bill, providerFetch: async () => { calls++; return provider(); } };
  for (const value of [{ ...input, providerCostUsd: 0 }, { ...input, messages: [{ role: "user", content: "未回复" }] },
    { ...input, maxTokens: 0 }, { ...input, character: { name: "人", description: "文".repeat(12001) } }]) {
    assert.equal((await handleDzmmReplySuggestionsPost(request(value), env, options)).status, 400);
  }
  const large = new Request("https://app.test/api/reply-suggestions", { method: "POST", body: "文".repeat(60001) });
  assert.equal((await handleDzmmReplySuggestionsPost(large, env, options)).status, 400);
  assert.equal((await handleDzmmReplySuggestionsPost(request(), { ...env, DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "" }, options)).status, 503);
  assert.equal(calls, 0); assert.equal(bill.quotes.length, 0);
});

test("empty wallet stops before reserve, while upstream rejection refunds once", async () => {
  const bill = billing(); let calls = 0;
  const denied = await handleDzmmReplySuggestionsPost(request(), env, { ...bill,
    billing: { ...bill.billing, async limitOutputTokens() { throw new DzmmBillingError(402, "余额不足", "CREDIT_INSUFFICIENT"); } },
    providerFetch: async () => { calls++; return provider(); },
  });
  assert.equal(denied.status, 402); assert.equal(bill.quotes.length, 0); assert.equal(calls, 0);
  const rejected = await handleDzmmReplySuggestionsPost(request(), env, { ...bill, providerFetch: async () => new Response(secret, { status: 503 }) });
  assert.equal(rejected.status, 502); assert.doesNotMatch(await rejected.text(), new RegExp(secret));
  assert.deepEqual(bill.completions, [{ outcome: "failed", hasValidOutput: false }]);
});

test("missing usage remains absent and custom providers cannot supply official USD cost", async () => {
  for (const baseUrl of [env.DZMM_BASE_URL, "https://custom.test/v1"]) {
    const bill = billing();
    const response = await handleDzmmReplySuggestionsPost(request(), { ...env, DZMM_BASE_URL: baseUrl,
      DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: undefined, DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: undefined }, {
      ...bill, providerFetch: async () => baseUrl === env.DZMM_BASE_URL
        ? Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(branches) } }] }) : provider(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(bill.completions[0].usage, baseUrl === env.DZMM_BASE_URL ? undefined : { promptTokens: 310, completionTokens: 190 });
  }
});

test("cancelling a partially read response returns no branch and releases its reservation once", async () => {
  const bill = billing(), abort = new AbortController();
  let started!: () => void, cancelled = false;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const pending = handleDzmmReplySuggestionsPost(request(input, abort.signal), env, { ...bill, providerFetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"choices":[')); started(); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json" } }) });
  await reading; await new Promise(resolve => setImmediate(resolve)); abort.abort();
  const response = await pending; await Promise.all(bill.waits);
  assert.equal(response.status, 499); assert.equal(cancelled, true);
  assert.deepEqual(bill.completions, [{ outcome: "cancelled", hasValidOutput: false }]);
});

test("45 second provider timeout is sanitized and refundable", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bill = billing(); let started!: () => void;
  const fetching = new Promise<void>(resolve => { started = resolve; });
  const pending = handleDzmmReplySuggestionsPost(request(), env, { ...bill, providerFetch: async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new Error(secret)), { once: true }); started();
  }) });
  await fetching; t.mock.timers.tick(45000);
  const response = await pending;
  assert.equal(response.status, 504); assert.doesNotMatch(await response.text(), new RegExp(secret));
  assert.deepEqual(bill.completions, [{ outcome: "failed", hasValidOutput: false }]);
});

test("oversized provider response is cancelled and cannot count as valid delivered suggestions", async () => {
  const bill = billing(); let cancelled = false;
  const response = await handleDzmmReplySuggestionsPost(request(), env, { ...bill, providerFetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(64001)); }, cancel() { cancelled = true; },
  }), { headers: { "X-Generation-Id": "gen-local-too-large" } }) });
  assert.equal(response.status, 502); assert.equal(cancelled, true);
  assert.deepEqual(bill.completions, [{ outcome: "failed", hasValidOutput: false, generationId: "gen-local-too-large" }]);
});

test("cancellation during affordability quote never acquires a lease or starts a provider", async () => {
  const bill = billing(), abort = new AbortController(); let started!: () => void, release!: () => void, calls = 0;
  const entering = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = handleDzmmReplySuggestionsPost(request(input, abort.signal), env, { ...bill,
    billing: { ...bill.billing, async limitOutputTokens() { started(); await gate; return 384; } },
    providerFetch: async () => { calls++; return provider(); },
  });
  await entering; abort.abort(); release();
  assert.equal((await pending).status, 499); assert.equal(calls, 0); assert.equal(bill.quotes.length, 0);
});
