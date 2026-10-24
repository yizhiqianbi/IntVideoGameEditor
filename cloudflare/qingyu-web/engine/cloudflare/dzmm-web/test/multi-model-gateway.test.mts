import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { fetchRequest, type Env } from "../src/worker";
import { DZMM_MODEL_OPTIONS, dzmmModelCostPolicy } from "../../../src/lib/dzmm-models";
import type { DzmmBillingFinalizeRpcInput, DzmmBillingReserveRpcInput } from "../../../src/lib/dzmm-generation-billing";
const origin = "https://model-gateway.example.test", accountId = "isolated-model-account";
const officialCatalog = JSON.parse(await readFile(new NodeURL("../../../output/xumeng/multi-models/openrouter-catalog-20261008.json", import.meta.url), "utf8"));
const policy = { version: 1 as const, multiplier: 3 as const, usdToCny: 6.704588, creditsPerCny: 100 as const,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
const state = { summary: "收到原图。", scene: "书库", completed: ["收到原图"], pending: [], relationships: [], items: ["原图"] };
const options = [
  { direction: "交流了解", title: "了解入口", reply: "你能先解释这两个入口的区别吗？" },
  { direction: "行动探索", title: "核对原图", reply: "我想先用原图核对入口的位置。" },
  { direction: "调整节奏", title: "稍作休息", reply: "我们先休息一下，再整理已确认的线索。" },
];
function request(path: string, body: unknown) {
  return new Request(`${origin}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
    Cookie: `dzmm_session=${"a".repeat(64)}`, "X-Xumeng-Request-Id": crypto.randomUUID() }, body: JSON.stringify(body) });
}

test("registered selections route chat, memory, novel and suggestions with supported reasoning, per-model cap and frozen receipt", async () => {
  for (const option of DZMM_MODEL_OPTIONS) for (const path of ["/api/chat", "/api/memory", "/api/novel-generation", "/api/reply-suggestions"]) {
    const quotes: DzmmBillingReserveRpcInput[] = [], reservations: DzmmBillingReserveRpcInput[] = [], finalized: DzmmBillingFinalizeRpcInput[] = [];
    const env: Env = { ASSETS: { fetch: async () => new Response("SPA") },
      BACKEND: { fetch: async () => Response.json({ user: { id: accountId } }) },
      CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: "isolated-no-provider-key",
      DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_MODEL: "x-ai/grok-4.6",
      // These legacy Grok caps must not become Gemini/Claude/GPT/DeepSeek/Qwen caps.
      DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2",
      BILLING: {
        async quote(preflight) { quotes.push(preflight); return { enabled: true, maxOutputTokens: 512 }; },
        async reserve(preflight) { reservations.push(preflight); return { enabled: true, created: true,
          receipt: { id: "isolated_model_hold", model: preflight.model, costPolicy: dzmmModelCostPolicy(policy, preflight.model) }, claimToken: "c".repeat(64) }; },
        async finalize(fact) { finalized.push(fact); return { receipt: { status: "settled" } }; },
      } };
    const messages = [{ role: "assistant", content: "请先核对原图上的两个入口。" }, { role: "user", content: "查看原图。" }];
    const body = path === "/api/memory" ? { messages, model: option.id }
      : path === "/api/novel-generation" ? { operation: "outline", work: { title: "原创桥图", synopsis: "核对入口。", type: "story",
        tags: [], notes: "", outline: "" }, model: option.id, maxTokens: 1024 }
      : { character: { name: "原创书库员" }, messages, model: option.id, maxTokens: 1024 };
    let calls = 0;
    const response = await fetchRequest(request(path, body), env, { providerFetch: async (_url, init) => {
      calls++; assert.equal(reservations.length, 1); const payload = String(init?.body), sent = JSON.parse(payload);
      const official = officialCatalog.models.find((model: { id: string }) => model.id === sent.model);
      assert.ok(official);
      assert.equal(sent.model, option.providerModel);
      // OpenRouter says an omitted supported_efforts means this model does
      // not expose effort selection. Strict routing must not invent a low tier.
      if (option.reasoningEffort === false) assert.equal(Object.hasOwn(sent, "reasoning"), false);
      else assert.deepEqual(sent.reasoning, official.reasoning?.supported_efforts?.includes("low") ? { effort: "low" } : { enabled: false });
      assert.deepEqual(sent.provider.max_price, { prompt: option.providerMaxPromptUsdPerMillion, completion: option.maxOutputUsdPerMillion, request: 0 });
      assert.equal(sent.provider.require_parameters, true);
      assert.equal(Object.hasOwn(sent, "temperature"), option.supportsTemperature);
      assert.equal(sent.max_tokens, 512); assert.equal(quotes[0].model, sent.model); assert.equal(reservations[0].model, sent.model);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload))), byte => byte.toString(16).padStart(2, "0")).join("");
      assert.equal(reservations[0].requestFingerprint, hash);
      if (quotes[0].maxOutputTokens !== reservations[0].maxOutputTokens) assert.notEqual(quotes[0].requestFingerprint, reservations[0].requestFingerprint);
      if (path === "/api/memory" || path === "/api/reply-suggestions") return Response.json({ id: "gen-isolated-model", model: option.canonicalModel,
        usage: { prompt_tokens: 140, completion_tokens: 45, cost: 0.004 }, choices: [{ finish_reason: "stop", message: {
          content: JSON.stringify(path === "/api/memory" ? state : { options }) } }] });
      return new Response(`data: ${JSON.stringify({ id: "gen-isolated-model", model: option.canonicalModel, choices: [{ delta: { content: "书库员展开原图。" } }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 140, completion_tokens: 45, cost: 0.004 } })}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream" } });
    } });
    assert.equal(response.status, 200, `${option.id} ${path}`); await response.text();
    assert.equal(calls, 1); assert.equal(finalized.length, 1); assert.equal(finalized[0].hasValidOutput, true);
    assert.equal(finalized[0].usage?.providerCostUsd, 0.004);
  }
});

test("a client cannot supply raw provider slugs or price caps on any generation workflow", async () => {
  let calls = 0;
  const env: Env = { ASSETS: { fetch: async () => new Response("SPA") }, BACKEND: { fetch: async () => Response.json({ user: { id: accountId } }) },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: "isolated-key", BILLING: {
      reserve: async () => { calls++; throw new Error("invalid requests cannot reserve"); }, finalize: async () => {},
    } };
  for (const path of ["/api/chat", "/api/memory", "/api/novel-generation", "/api/reply-suggestions"]) {
    for (const extra of [{ model: "google/gemini-3.8-flash" }, { model: "grok-unknown" }, { model: "grok", provider: { max_price: { prompt: 0.01, completion: 0.01 } } }]) {
      const messages = [{ role: "assistant", content: "原图在桌上。" }, { role: "user", content: "继续核对。" }];
      const body = path === "/api/memory" ? { messages, ...extra }
        : path === "/api/novel-generation" ? { operation: "outline", work: { title: "原创桥图", synopsis: "核对入口。", type: "story", tags: [], notes: "", outline: "" }, ...extra }
        : { character: { name: "原创图书员" }, messages, ...extra };
      const response = await fetchRequest(request(path, body), env, { providerFetch: async () => { calls++; throw new Error("invalid requests cannot spend"); } });
      assert.equal(response.status, 400, path);
    }
  }
  assert.equal(calls, 0);
});


test("registered-model grants with the wrong frozen identity, tariff or missing actual-cost policy release the hold before provider traffic", async () => {
  let calls = 0;
  for (const mismatch of ["model", "policy", "missing"] as const) {
    const finalizations: DzmmBillingFinalizeRpcInput[] = [];
    const env: Env = { ASSETS: { fetch: async () => new Response("SPA") }, BACKEND: { fetch: async () => Response.json({ user: { id: accountId } }) },
      CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: "isolated-no-provider-key", BILLING: {
        async reserve(preflight) { return { enabled: true, created: true, receipt: { id: "isolated_model_mismatch",
          model: mismatch === "model" ? "x-ai/grok-4.6" : preflight.model,
          ...(mismatch === "missing" ? {} : { costPolicy: mismatch === "policy" ? policy : dzmmModelCostPolicy(policy, preflight.model) }) }, claimToken: "c".repeat(64) }; },
        async finalize(fact) { finalizations.push(fact); return { receipt: { status: "released" } }; },
      } };
    const response = await fetchRequest(request("/api/chat", { character: { name: "原创图书员" }, messages: [{ role: "user", content: "核对原图。" }], model: "deepseek" }), env,
      { providerFetch: async () => { calls++; throw new Error("mismatched grants cannot spend"); } });
    assert.equal(response.status, 503); assert.equal(finalizations.length, 1); assert.equal(finalizations[0].hasValidOutput, false);
  }
  assert.equal(calls, 0);
});
