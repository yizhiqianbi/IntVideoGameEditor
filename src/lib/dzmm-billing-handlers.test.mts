import test from "node:test";
import assert from "node:assert/strict";
import chatHandlerModule from "./dzmm-chat-handler";
import memoryHandlerModule from "./dzmm-memory-handler";
import billingModule from "./dzmm-generation-billing";
import type { DzmmBillingCompletion, DzmmBillingPreflight, DzmmBillingLifecycle } from "./dzmm-generation-billing";

const { handleDzmmChatPost } = chatHandlerModule as typeof import("./dzmm-chat-handler");
const { handleDzmmMemoryPost } = memoryHandlerModule as typeof import("./dzmm-memory-handler");
const { DzmmBillingError } = billingModule as typeof import("./dzmm-generation-billing");
const env = { DZMM_API_KEY: "mock-private-key", DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "provider/model" };
const chatInput = { character: { name: "档案员" }, messages: [{ role: "user", content: "看看地图。" }], maxTokens: 512 };
const state = { summary: "旅人收下了地图。", scene: "书库", completed: ["收到地图"], pending: [], relationships: [], items: ["地图"] };
const encoder = new TextEncoder();
function request(body: unknown = chatInput, signal?: AbortSignal) {
  return new Request("https://app.test/api/chat", { method: "POST", body: JSON.stringify(body), signal });
}
function memoryRequest(signal?: AbortSignal) {
  return request({ messages: [{ role: "user", content: "我收下了地图。" }] }, signal);
}
function billed() {
  const quotes: DzmmBillingPreflight[] = [];
  const completions: DzmmBillingCompletion[] = [];
  const background: Promise<unknown>[] = [];
  const billing: DzmmBillingLifecycle = { async reserve(quote) {
    quotes.push(quote);
    return { async finalize(completion) { completions.push(completion); } };
  } };
  return { quotes, completions, background, billing, waitUntil: (promise: Promise<unknown>) => { background.push(promise); } };
}
function stream(chunks: string[], headers?: HeadersInit) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream", ...Object.fromEntries(new Headers(headers)) } });
}
function contentFrame(text = "地图上标记着旧码头。") {
  return `data: ${JSON.stringify({ id: "gen-billing-test", choices: [{ delta: { content: text } }] })}\n\n`;
}
const finishFrame = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const usageFrame = 'data: {"id":"gen-billing-test","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":300,"completion_tokens":40,"completion_tokens_details":{"reasoning_tokens":35}}}\n\n';

test("chat reserves the validated final prompt before generation and settles the last usage before EOF", async () => {
  const bill = billed();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const baseReserve = bill.billing.reserve;
  bill.billing.reserve = async quote => {
    const lease = await baseReserve(quote);
    return { async finalize(completion) { await gate; await lease!.finalize(completion); } };
  };
  const response = await handleDzmmChatPost(request(), env, { ...bill, providerFetch: async (_url, options) => {
    assert.equal(bill.quotes.length, 1);
    const payload = JSON.parse(options!.body as string);
    assert.equal(bill.quotes[0].model, payload.model);
    assert.equal(bill.quotes[0].maxOutputTokens, 512);
    assert.ok(bill.quotes[0].inputTokenUpperBound > new TextEncoder().encode(JSON.stringify(payload.messages)).byteLength);
    assert.match(bill.quotes[0].requestFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(!("stream_options" in payload), "OpenRouter automatically returns final usage.");
    return stream([contentFrame(), finishFrame, usageFrame, "data: [DONE]\n\n"]);
  } });
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "地图上标记着旧码头。");
  let eof = false;
  const finishing = reader.read().then(value => { eof = value.done; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(eof, false);
  assert.equal(bill.background.length, 1);
  release();
  assert.equal((await finishing).done, true);
  assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true,
    generationId: "gen-billing-test", usage: { promptTokens: 300, completionTokens: 40 } }]);
});

test("invalid input and unconfigured providers cannot reserve or incur a model bill", async () => {
  const bill = billed();
  let providerCalls = 0;
  const options = { ...bill, providerFetch: async () => { providerCalls++; throw new Error("must not call"); } };
  assert.equal((await handleDzmmChatPost(request({ ...chatInput, extra: "bad" }), env, options)).status, 400);
  assert.equal((await handleDzmmChatPost(request(), {}, options)).status, 503);
  assert.equal((await handleDzmmMemoryPost(request({ messages: [] }), env, options)).status, 400);
  assert.equal(bill.quotes.length, 0);
  assert.equal(providerCalls, 0);
});

test("insufficient Credit rejects before calling the provider and preserves the safe balance message", async () => {
  let providerCalls = 0;
  const billing: DzmmBillingLifecycle = { async reserve() { throw new DzmmBillingError(402, "Credit 余额不足，请先充值。"); } };
  for (const handler of [handleDzmmChatPost, handleDzmmMemoryPost]) {
    const response = await handler(handler === handleDzmmChatPost ? request() : memoryRequest(), env,
      { billing, providerFetch: async () => { providerCalls++; throw new Error("must not call"); } });
    assert.equal(response.status, 402);
    assert.match(await response.text(), /Credit 余额不足/);
  }
  assert.equal(providerCalls, 0);
});

test("provider rejection, empty replies and exceptions release a chat reservation without valid output", async () => {
  for (const providerFetch of [async () => new Response("private-upstream-error", { status: 500 }),
    async () => stream([contentFrame(" \n "), usageFrame, "data: [DONE]\n\n"]),
    async () => { throw new Error("private-upstream-error"); }]) {
    const bill = billed();
    const response = await handleDzmmChatPost(request(), env, { ...bill, providerFetch });
    assert.equal(response.status, 502);
    assert.equal(bill.completions.length, 1);
    assert.equal(bill.completions[0].hasValidOutput, false);
    assert.equal(bill.completions[0].outcome, "failed");
    assert.ok(!(await response.text()).includes("private-upstream-error"));
  }
});

test("partial cancellation preserves generation identity for pending usage and schedules finalization once", async () => {
  const bill = billed();
  const abort = new AbortController();
  let providerSignal: AbortSignal | null | undefined;
  let cancelled = false;
  const response = await handleDzmmChatPost(request(chatInput, abort.signal), env, { ...bill,
    providerFetch: async (_url, options) => {
      providerSignal = options?.signal;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(contentFrame())); },
        cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/event-stream" } });
    } });
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "地图上标记着旧码头。");
  abort.abort();
  await reader.cancel();
  await Promise.all(bill.background);
  assert.equal(providerSignal?.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(bill.background.length, 1);
  assert.deepEqual(bill.completions, [{ outcome: "cancelled", hasValidOutput: true, generationId: "gen-billing-test" }]);
});

test("interrupted nonempty output without usage becomes a single pending billing outcome", async () => {
  const bill = billed();
  const response = await handleDzmmChatPost(request(), env, { ...bill, providerFetch: async () => stream([contentFrame()]) });
  const reader = response.body!.getReader();
  assert.ok((await reader.read()).value);
  await assert.rejects(reader.read(), /提前中断/);
  assert.deepEqual(bill.completions, [{ outcome: "failed", hasValidOutput: true, generationId: "gen-billing-test" }]);
});

test("a complete reply with missing usage uses the generation header as a server-only reconciliation fallback", async () => {
  const bill = billed();
  const response = await handleDzmmChatPost(request(), env, { ...bill, providerFetch: async () => stream([
    'data: {"choices":[{"delta":{"content":"回复完成"}}]}\n\n', "data: [DONE]\n\n"], { "X-Generation-Id": "gen-header-only" }) });
  assert.equal(await response.text(), "回复完成");
  assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true, generationId: "gen-header-only" }]);
  assert.equal(response.headers.get("X-Generation-Id"), null);
});

test("cancellation while reserving releases the eventual lease and never starts generation", async () => {
  const bill = billed();
  const abort = new AbortController();
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const baseReserve = bill.billing.reserve;
  bill.billing.reserve = async quote => { started(); await gate; return baseReserve(quote); };
  let providerCalls = 0;
  const pending = handleDzmmChatPost(request(chatInput, abort.signal), env, { ...bill,
    providerFetch: async () => { providerCalls++; throw new Error("must not call"); } });
  await start;
  abort.abort();
  release();
  assert.equal((await pending).status, 499);
  assert.equal(providerCalls, 0);
  assert.deepEqual(bill.completions, [{ outcome: "cancelled", hasValidOutput: false }]);
});

test("valid memory settles native usage after strict state validation", async () => {
  const bill = billed();
  const response = await handleDzmmMemoryPost(memoryRequest(), env, { ...bill, providerFetch: async (_url, options) => {
    assert.equal(bill.quotes.length, 1);
    assert.equal(bill.quotes[0].operation, "memory");
    assert.equal(bill.quotes[0].maxOutputTokens, 2048);
    assert.equal(JSON.parse(options!.body as string).stream, false);
    return Response.json({ id: "gen-memory", usage: { prompt_tokens: 70, completion_tokens: 80,
      completion_tokens_details: { reasoning_tokens: 50 } }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(state) } }] });
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state });
  assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true, generationId: "gen-memory",
    usage: { promptTokens: 70, completionTokens: 80 } }]);
});

test("malformed memory is released even when the provider generated tokens", async () => {
  const bill = billed();
  const response = await handleDzmmMemoryPost(memoryRequest(), env, { ...bill, providerFetch: async () => Response.json({
    id: "gen-bad-memory", usage: { prompt_tokens: 70, completion_tokens: 80 },
    choices: [{ finish_reason: "stop", message: { content: "not structured memory" } }],
  }) });
  assert.equal(response.status, 502);
  assert.deepEqual(bill.completions, [{ outcome: "failed", hasValidOutput: false, generationId: "gen-bad-memory",
    usage: { promptTokens: 70, completionTokens: 80 } }]);
});

test("billing transport failures never reveal RPC secrets or silently accept an unpaid stream", async () => {
  const bill = billed();
  bill.billing.reserve = async () => ({ async finalize() { throw new Error("private-RPC-claim-token"); } });
  const response = await handleDzmmChatPost(request(), env, { ...bill, providerFetch: async () => stream([contentFrame(), usageFrame, "data: [DONE]\n\n"]) });
  const reader = response.body!.getReader();
  assert.ok((await reader.read()).value);
  await assert.rejects(reader.read(), error => error instanceof Error && /余额结算/.test(error.message)
    && !error.message.includes("private-RPC-claim-token"));
});

test("memory cancellation during reserve releases the eventual lease without generating or replacing facts", async () => {
  const bill = billed();
  const abort = new AbortController();
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const baseReserve = bill.billing.reserve;
  bill.billing.reserve = async quote => { started(); await gate; return baseReserve(quote); };
  let calls = 0;
  const pending = handleDzmmMemoryPost(memoryRequest(abort.signal), env, { ...bill,
    providerFetch: async () => { calls++; throw new Error("must not generate"); } });
  await start;
  abort.abort();
  release();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal(calls, 0);
  assert.ok(!("state" in await response.json()));
  assert.deepEqual(bill.completions, [{ outcome: "cancelled", hasValidOutput: false }]);
});

test("a validated memory completion commits once when cancellation races its final settlement", async () => {
  const bill = billed();
  const abort = new AbortController();
  let entered!: () => void;
  let release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const baseReserve = bill.billing.reserve;
  bill.billing.reserve = async quote => {
    const lease = await baseReserve(quote);
    return { async finalize(completion) { entered(); await gate; await lease!.finalize(completion); } };
  };
  const pending = handleDzmmMemoryPost(memoryRequest(abort.signal), env, { ...bill, providerFetch: async () => Response.json({
    id: "gen-memory-finished", usage: { prompt_tokens: 40, completion_tokens: 50 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(state) } }],
  }) });
  await entering;
  abort.abort();
  release();
  assert.deepEqual(await (await pending).json(), { state });
  await Promise.all(bill.background);
  assert.equal(bill.background.length, 1);
  assert.deepEqual(bill.completions, [{ outcome: "completed", hasValidOutput: true, generationId: "gen-memory-finished",
    usage: { promptTokens: 40, completionTokens: 50 } }]);
});
