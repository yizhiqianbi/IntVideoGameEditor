import test from "node:test";
import assert from "node:assert/strict";
import billingModule from "./dzmm-generation-billing";
import chatModule from "./dzmm-chat";

const { readDzmmGenerationUsage, readDzmmGenerationId, createDzmmBillingPreflight,
  trustedDzmmGenerationUsage, readDzmmProviderMaxPrice, prepareDzmmBillingRequest } = billingModule as typeof import("./dzmm-generation-billing");
const { createDzmmSseParser } = chatModule as typeof import("./dzmm-chat");

test("usage requires both safe native token counts and never adds included reasoning", () => {
  assert.deepEqual(readDzmmGenerationUsage({ prompt_tokens: 101, completion_tokens: 53,
    completion_tokens_details: { reasoning_tokens: 45 }, prompt_tokens_details: { cached_tokens: 90 }, cost: 0.004 }),
  { promptTokens: 101, completionTokens: 53, providerCostUsd: 0.004 });
  for (const value of [null, {}, { prompt_tokens: 1 }, { prompt_tokens: 1, completion_tokens: "2" },
    { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: 1.5, completion_tokens: 2 },
    { prompt_tokens: NaN, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: 10_000_001 }]) {
    assert.equal(readDzmmGenerationUsage(value), undefined);
  }
  assert.deepEqual(readDzmmGenerationUsage({ prompt_tokens: 0, completion_tokens: 0 }), { promptTokens: 0, completionTokens: 0 });
});

test("provider cost preserves verified zero and canonical USD precision without invalidating legacy tokens", () => {
  for (const cost of [0, -0, 1e-12, 0.012345678901, 1_000_000]) {
    assert.deepEqual(readDzmmGenerationUsage({ prompt_tokens: 10, completion_tokens: 20, cost }),
      { promptTokens: 10, completionTokens: 20, providerCostUsd: cost === 0 ? 0 : cost });
  }
  for (const cost of [undefined, null, "0.005", NaN, Infinity, -Infinity, -1, 1_000_000.1, 1e-13, 0.1 + 0.2]) {
    assert.deepEqual(readDzmmGenerationUsage({ prompt_tokens: 10, completion_tokens: 20, cost }),
      { promptTokens: 10, completionTokens: 20 });
  }
  assert.equal(readDzmmGenerationUsage({ prompt_tokens: "10", completion_tokens: 20, cost: 0 }), undefined);
  assert.deepEqual(readDzmmGenerationUsage({ prompt_tokens: 10, completion_tokens: 20, providerCostUsd: 0 }),
    { promptTokens: 10, completionTokens: 20 }, "Only the provider's documented cost field is parsed.");
});

test("only exact official OpenRouter USD metadata is trusted and caps fail closed when incomplete", () => {
  const usage = { promptTokens: 10, completionTokens: 20, providerCostUsd: 0.004 };
  assert.deepEqual(trustedDzmmGenerationUsage(usage, "https://openrouter.ai/api/v1/"), usage);
  for (const baseUrl of ["https://provider.test/v1", "https://openrouter.ai.evil.test/api/v1", "http://openrouter.ai/api/v1",
    "https://openrouter.ai/api/v1?other=1", "https://user@openrouter.ai/api/v1"]) {
    assert.deepEqual(trustedDzmmGenerationUsage(usage, baseUrl), { promptTokens: 10, completionTokens: 20 });
  }
  const caps = { DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" };
  assert.deepEqual(readDzmmProviderMaxPrice(caps, "https://openrouter.ai/api/v1"), { prompt: 4.4, completion: 13.2 });
  assert.equal(readDzmmProviderMaxPrice({}, "https://provider.test/v1"), undefined);
  for (const env of [{ DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4" },
    { ...caps, DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "" }, { ...caps, DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "Infinity" },
    { ...caps, DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "-1" }, { ...caps, DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "0" }]) {
    assert.throws(() => readDzmmProviderMaxPrice(env, "https://openrouter.ai/api/v1"), /成本上限配置无效/);
  }
  assert.throws(() => readDzmmProviderMaxPrice(caps, "https://provider.test/v1"), /成本上限配置无效/);
});

test("generation IDs cannot contain URL syntax, whitespace or unbounded provider text", () => {
  assert.equal(readDzmmGenerationId("gen-123_abc"), "gen-123_abc");
  for (const value of [null, "", "gen-123\nprivate", "https://evil.example", "gen-x?id=another", "x".repeat(201)]) {
    assert.equal(readDzmmGenerationId(value), undefined);
  }
});

test("preflight hashes the final provider body and overestimates Unicode text using UTF-8 bytes plus framing", async () => {
  const messages = [{ role: "system", content: "你好 🌱" }, { role: "user", content: "继续" }];
  const body = JSON.stringify({ model: "provider/model", messages, max_tokens: 512 });
  const quote = await createDzmmBillingPreflight("chat", "provider/model", messages, 512, body);
  assert.equal(quote.inputTokenUpperBound, new TextEncoder().encode(JSON.stringify(messages)).byteLength + 1024 + 128);
  assert.equal(quote.maxOutputTokens, 512);
  assert.equal(quote.operation, "chat");
  assert.match(quote.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(await createDzmmBillingPreflight("chat", "provider/model", messages, 512, body), quote);
  assert.notEqual((await createDzmmBillingPreflight("chat", "provider/model", messages, 512, body + " ")).requestFingerprint,
    quote.requestFingerprint);
});

test("affordability caps change the exact provider body fingerprint without trimming input", async () => {
  const messages = [{ role: "user", content: "核对桥的年代 🌱" }];
  const buildBody = (max_tokens: number) => JSON.stringify({ messages, model: "provider/model", max_tokens });
  const original = await createDzmmBillingPreflight("chat", "provider/model", messages, 2048, buildBody(2048));
  let quoted = 0;
  const prepared = await prepareDzmmBillingRequest("chat", "provider/model", messages, 2048, buildBody, {
    async limitOutputTokens(preflight) { quoted++; assert.deepEqual(preflight, original); return 512; },
    async reserve() { throw new Error("Preparation must never mutate funds"); },
  });
  assert.equal(quoted, 1); assert.equal(prepared.maxOutputTokens, 512);
  assert.deepEqual(JSON.parse(prepared.providerBody), { messages, model: "provider/model", max_tokens: 512 });
  assert.equal(prepared.preflight.inputTokenUpperBound, original.inputTokenUpperBound);
  assert.notEqual(prepared.preflight.requestFingerprint, original.requestFingerprint);
  assert.deepEqual(prepared.preflight, await createDzmmBillingPreflight("chat", "provider/model", messages, 512, buildBody(512)));
});

test("malformed or raised output quotes cannot underfund a provider request", async () => {
  for (const [operation, cap] of [["chat", 127], ["chat", 2049], ["chat", 512.5], ["chat", NaN], ["memory", 511]] as const) {
    await assert.rejects(prepareDzmmBillingRequest(operation, "provider/model", [{ role: "user", content: "你好" }], 2048,
      max_tokens => JSON.stringify({ max_tokens }), { async limitOutputTokens() { return cap; }, async reserve() { throw new Error("No hold"); } }),
    /无效的回复预算/);
  }
});

test("SSE continues beyond finish_reason to the final OpenRouter usage frame", () => {
  const parser = createDzmmSseParser();
  assert.deepEqual(parser.push('data: {"id":"gen-openrouter","choices":[{"delta":{"content":"完成"}}]}\n\n'), ["完成"]);
  parser.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
  assert.equal(parser.done, false);
  assert.equal(parser.usage, undefined);
  parser.push('data: {"id":"gen-openrouter","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":150,"completion_tokens":30,"completion_tokens_details":{"reasoning_tokens":20}}}\n\n');
  assert.equal(parser.done, false);
  assert.deepEqual(parser.usage, { promptTokens: 150, completionTokens: 30 });
  parser.push('data: [DONE]\n\n');
  assert.equal(parser.done, true);
  assert.equal(parser.generationId, "gen-openrouter");
});

test("SSE accepts empty-choice usage frames and never emits reasoning as story text", () => {
  const parser = createDzmmSseParser();
  assert.deepEqual(parser.push('data: {"id":"gen-elsewhere","choices":[{"delta":{"reasoning":"private thoughts","content":"回复"}}]}\n\n'), ["回复"]);
  assert.deepEqual(parser.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":6}}\n\ndata: [DONE]\n\n'), []);
  assert.deepEqual(parser.usage, { promptTokens: 8, completionTokens: 6 });
  assert.equal(parser.generationId, "gen-elsewhere");
});

test("invalid final usage clears earlier provisional counts so billing can wait for reconciliation", () => {
  const parser = createDzmmSseParser();
  parser.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":6}}\n\n');
  parser.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":"bad"}}\n\ndata: [DONE]\n\n');
  assert.equal(parser.usage, undefined);
});

test("SSE keeps final actual cost including free cache hits and removes an invalid replacement cost", () => {
  const parser = createDzmmSseParser();
  parser.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":6,"cost":0.006}}\n\n');
  assert.equal(parser.usage?.providerCostUsd, 0.006);
  parser.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":6,"cost":0}}\n\ndata: [DONE]\n\n');
  assert.deepEqual(parser.usage, { promptTokens: 8, completionTokens: 6, providerCostUsd: 0 });
  const replacement = createDzmmSseParser();
  replacement.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":6,"cost":0.006}}\n\n');
  replacement.push('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":6,"cost":"invalid"}}\n\ndata: [DONE]\n\n');
  assert.deepEqual(replacement.usage, { promptTokens: 8, completionTokens: 6 });
});
