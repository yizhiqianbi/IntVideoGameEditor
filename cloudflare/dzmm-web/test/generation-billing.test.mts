import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";
import type { DzmmBillingFinalizeRpcInput, DzmmBillingReserveRpcInput } from "../../../src/lib/dzmm-generation-billing";
import type { DzmmCreditCostPolicy } from "../../../src/lib/dzmm-credit-pricing";

const origin = "https://billing-gateway.example.test";
const accountId = "account-from-server-session";
const sessionToken = "a".repeat(64);
const claimToken = "b".repeat(64);
const requestId = "9d28d8f4-0817-4aab-a4b1-c7a816c77b54";
const reservationId = "generation_server_reservation";
const chatInput = { character: { name: "书库管理员" }, messages: [{ role: "user", content: "查看地图。" }], maxTokens: 512 };
const novelInput = { operation: "outline", work: { title: "原创旧地图", synopsis: "核对桥址的短篇。", type: "story",
  tags: ["科幻"], notes: "线索有因果。", outline: "" }, model: "balanced", maxTokens: 512 };
const state = { summary: "旅人收到地图。", scene: "书库", completed: ["收到地图"], pending: [], relationships: [], items: ["地图"] };
function environment(overrides: Partial<Env> = {}): Env {
  return { ASSETS: { fetch: async () => new Response("SPA") }, BACKEND: { fetch: async () => Response.json({ user: { id: accountId } }) },
    BILLING: { reserve: async () => ({ enabled: false }), finalize: async () => { throw new Error("disabled billing must not settle"); } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: "mock-provider-key", DZMM_BASE_URL: "https://provider.test/v1",
    DZMM_MODEL: "provider/model", ...overrides };
}
function request(path = "/api/chat", body: unknown = chatInput, headers?: HeadersInit) {
  const merged = new Headers({
    Origin: origin, "Content-Type": "application/json", Cookie: `other=unused; dzmm_session=${sessionToken}`,
    "X-Xumeng-Request-Id": requestId,
  });
  new Headers(headers).forEach((value, name) => merged.set(name, value));
  return new Request(`${origin}${path}`, { method: "POST", body: JSON.stringify(body), headers: merged });
}
function sse(usage = true) {
  return new Response('data: {"id":"gen-server-only","choices":[{"delta":{"content":"管理员展开地图。"}}]}\n\n'
    + (usage ? 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":160,"completion_tokens":35,"completion_tokens_details":{"reasoning_tokens":30}}}\n\n' : "")
    + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
}
function binding(costPolicy?: DzmmCreditCostPolicy) {
  const reserves: DzmmBillingReserveRpcInput[] = [];
  const finalizations: DzmmBillingFinalizeRpcInput[] = [];
  return { reserves, finalizations, service: {
    async reserve(input: DzmmBillingReserveRpcInput) { reserves.push(input);
      return { enabled: true, created: true, receipt: { id: reservationId, ...(costPolicy ? { costPolicy } : {}) }, claimToken }; },
    async finalize(input: DzmmBillingFinalizeRpcInput) { finalizations.push(input); return { receipt: { id: reservationId,
      status: !input.usage || (costPolicy && input.usage.providerCostUsd === undefined) ? "pending" : "settled" } }; },
  } };
}

test("novel gateway requires real session, shares chat limits and billing before provider", async () => {
  let calls = 0;
  const rejected = await fetchRequest(request("/api/novel-generation", novelInput), environment({
    BACKEND: { fetch: async () => Response.json({ error: "no session" }, { status: 401 }) },
  }), { providerFetch: async () => { calls++; return sse(); } });
  assert.equal(rejected.status, 401); assert.equal(calls, 0);
  const keys: string[] = [], bill = binding(), waits: Promise<unknown>[] = [];
  const accepted = await fetchRequest(request("/api/novel-generation", novelInput), environment({ BILLING: bill.service,
    CHAT_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: true }; } },
  }), { waitUntil: promise => { waits.push(promise); }, providerFetch: async () => { calls++; return sse(); } });
  assert.equal(accepted.status, 200); assert.equal(await accepted.text(), "管理员展开地图。"); await Promise.all(waits);
  assert.deepEqual(keys, ["chat:ip:unknown", `chat:user:${accountId}`]);
  assert.equal(bill.reserves[0].operation, "chat"); assert.equal(bill.reserves[0].accountId, accountId);
  assert.equal(bill.finalizations[0].hasValidOutput, true); assert.equal(calls, 1);
});

test("novel cannot bypass empty wallet, rate limit or mutation origin", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return sse(); };
  const empty = await fetchRequest(request("/api/novel-generation", novelInput), environment({ BILLING: {
    reserve: async () => ({ error: { status: 402, message: "余额不足", code: "CREDIT_INSUFFICIENT" } }),
    finalize: async () => { throw new Error("no lease"); },
  } }), { providerFetch: fetcher });
  assert.equal(empty.status, 402);
  const limited = await fetchRequest(request("/api/novel-generation", novelInput), environment({ CHAT_RATE_LIMITER: {
    limit: async () => ({ success: false }),
  } }), { providerFetch: fetcher });
  assert.equal(limited.status, 429);
  const cross = await fetchRequest(request("/api/novel-generation", novelInput, { Origin: "https://foreign.test" }), environment(), { providerFetch: fetcher });
  assert.equal(cross.status, 403); assert.equal(calls, 0);
});

test("only the named server binding receives session capability, identity and actual usage", async () => {
  const bill = binding();
  const waits: Promise<unknown>[] = [];
  const response = await fetchRequest(request("/api/chat", chatInput, { "X-Account-Id": "forged-account", "X-Credit-Price": "0" }),
    environment({ BILLING: bill.service }), { waitUntil: promise => { waits.push(promise); }, providerFetch: async (_url, options) => {
      assert.equal(bill.reserves.length, 1);
      const body = options!.body as string;
      assert.ok(!body.includes(sessionToken) && !body.includes(claimToken) && !body.includes("forged-account"));
      return sse();
    } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "管理员展开地图。");
  await Promise.all(waits);
  assert.equal(bill.reserves[0].accountId, accountId);
  assert.equal(bill.reserves[0].sessionToken, sessionToken);
  assert.equal(bill.reserves[0].requestId, requestId);
  assert.equal(bill.reserves[0].model, "provider/model");
  assert.equal(bill.reserves[0].maxOutputTokens, 512);
  assert.match(bill.reserves[0].requestFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(bill.finalizations, [{ reservationId, accountId, claimToken, outcome: "completed", hasValidOutput: true,
    generationId: "gen-server-only", usage: { promptTokens: 160, completionTokens: 35 } }]);
  assert.equal(response.headers.get("X-Xumeng-Request-Id"), requestId);
  const publicHeaders = JSON.stringify([...response.headers]);
  assert.ok(!publicHeaders.includes(sessionToken) && !publicHeaders.includes(claimToken) && !publicHeaders.includes("gen-server-only"));
});

test("actual-cost RPC recovers missing cost even when valid stream token counts were delivered", async () => {
  const costPolicy: DzmmCreditCostPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
  const bill = binding(costPolicy), waits: Promise<unknown>[] = [];
  let metadataCalls = 0;
  const response = await fetchRequest(request(), environment({ BILLING: bill.service, DZMM_BASE_URL: "https://openrouter.ai/api/v1",
    DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" }), {
    waitUntil: promise => { waits.push(promise); },
    providerFetch: async (_url, options) => {
      assert.deepEqual(JSON.parse(String(options!.body)).provider, { max_price: { prompt: 4.4, completion: 13.2 } });
      return sse();
    },
    billingMetadataFetch: async () => {
      metadataCalls++;
      return Response.json({ data: { id: "gen-server-only", model: "provider/model", native_tokens_prompt: 160,
        native_tokens_completion: 35, native_tokens_reasoning: 30, total_cost: 0.00053 } });
    },
  });
  assert.equal(await response.text(), "管理员展开地图。");
  await Promise.all(waits);
  assert.equal(metadataCalls, 1);
  assert.deepEqual(bill.finalizations[0].usage, { promptTokens: 160, completionTokens: 35 });
  assert.deepEqual(bill.finalizations[1].usage, { promptTokens: 160, completionTokens: 35, providerCostUsd: 0.00053 });
});

test("trusted zero actual cost settles without initiating metadata recovery", async () => {
  const costPolicy: DzmmCreditCostPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
  const bill = binding(costPolicy), waits: Promise<unknown>[] = [];
  let metadataCalls = 0;
  const response = await fetchRequest(request(), environment({ BILLING: bill.service, DZMM_BASE_URL: "https://openrouter.ai/api/v1",
    DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" }), {
    waitUntil: promise => { waits.push(promise); },
    providerFetch: async () => new Response('data: {"id":"gen-server-only","choices":[{"delta":{"content":"管理员展开地图。"}}]}\n\n'
      + 'data: {"choices":[],"usage":{"prompt_tokens":160,"completion_tokens":35,"cost":0}}\n\n'
      + 'data: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }),
    billingMetadataFetch: async () => { metadataCalls++; throw new Error("must not recover settled zero cost"); },
  });
  assert.equal(await response.text(), "管理员展开地图。");
  await Promise.all(waits);
  assert.equal(metadataCalls, 0);
  assert.equal(bill.finalizations[0].usage!.providerCostUsd, 0);
});

test("cost-mode grants with missing or excessive provider caps are released before any model traffic", async () => {
  const costPolicy: DzmmCreditCostPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
  let modelCalls = 0;
  for (const caps of [{}, { DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.5", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" }]) {
    const bill = binding(costPolicy);
    const response = await fetchRequest(request(), environment({ BILLING: bill.service, DZMM_BASE_URL: "https://openrouter.ai/api/v1", ...caps }), {
      providerFetch: async () => { modelCalls++; return sse(); },
    });
    assert.equal(response.status, 503);
    assert.equal(bill.reserves.length, 1);
    assert.deepEqual(bill.finalizations, [{ reservationId, accountId, claimToken, outcome: "failed", hasValidOutput: false }]);
  }
  assert.equal(modelCalls, 0);
});

test("memory shares the same protected binding and native token accounting", async () => {
  const bill = binding();
  const response = await fetchRequest(request("/api/memory", { messages: [{ role: "user", content: "我收下地图。" }] }),
    environment({ BILLING: bill.service }), { providerFetch: async () => Response.json({ id: "gen-memory-server", usage: { prompt_tokens: 70, completion_tokens: 55 },
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(state) } }] }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state });
  assert.equal(bill.reserves[0].operation, "memory");
  assert.deepEqual(bill.finalizations[0].usage, { promptTokens: 70, completionTokens: 55 });
});

test("chat, novel and memory use quoted caps in the final provider body and its reservation fingerprint", async () => {
  for (const path of ["/api/chat", "/api/novel-generation", "/api/memory"]) {
    const bill = binding(), quotes: DzmmBillingReserveRpcInput[] = [], order: string[] = [];
    const output = path === "/api/memory" ? 512 : 384;
    const input = path === "/api/memory" ? { messages: [{ role: "user", content: "收到了地图。" }] }
      : path === "/api/novel-generation" ? { ...novelInput, maxTokens: 2048 }
      : { ...chatInput, maxTokens: 2048, world: { clockMode: "story" } };
    const reserve = bill.service.reserve;
    const response = await fetchRequest(request(path, input), environment({ BILLING: {
      ...bill.service,
      async quote(preflight) { order.push("quote"); quotes.push(preflight);
        return { enabled: true, maxOutputTokens: output, requiredCredits: 100, availableCredits: 100 }; },
      async reserve(preflight) { order.push("reserve"); return reserve(preflight); },
    } }), { providerFetch: async (_url, init) => {
      order.push("provider"); const body = String(init!.body), parsed = JSON.parse(body);
      assert.equal(parsed.max_tokens, output); assert.equal(bill.reserves[0].maxOutputTokens, output);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
        byte => byte.toString(16).padStart(2, "0")).join("");
      assert.equal(bill.reserves[0].requestFingerprint, digest);
      assert.notEqual(quotes[0].requestFingerprint, digest);
      assert.equal(quotes[0].inputTokenUpperBound, bill.reserves[0].inputTokenUpperBound);
      assert.equal(quotes[0].sessionToken, sessionToken); assert.equal(quotes[0].accountId, accountId);
      assert.ok(parsed.messages.some((message: { content: string }) => message.content.includes("地图")));
      return path === "/api/memory" ? Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(state) } }],
        usage: { prompt_tokens: 100, completion_tokens: 60 } }) : sse();
    } });
    assert.equal(response.status, 200); await response.text();
    assert.deepEqual(order, ["quote", "reserve", "provider"]);
    assert.equal(bill.finalizations[0].hasValidOutput, true);
    if (path !== "/api/memory") assert.equal(response.headers.get("X-Xumeng-Max-Output-Tokens"), String(output));
  }
});

test("quote failure and invalid caps never reserve funds or call the provider", async () => {
  let reserves = 0, providers = 0;
  for (const value of [{ error: { status: 402, message: "当前可用100，最低需要116 Credit。", code: "CREDIT_INSUFFICIENT" } },
    { enabled: true, maxOutputTokens: 2049 }, { enabled: true, maxOutputTokens: 127 }, { enabled: true, maxOutputTokens: 512.5 }]) {
    const response = await fetchRequest(request("/api/chat", { ...chatInput, maxTokens: 2048 }), environment({ BILLING: {
      async quote() { return value; }, async reserve() { reserves++; return { enabled: false }; },
      async finalize() { throw new Error("No hold"); },
    } }), { providerFetch: async () => { providers++; return sse(); } });
    assert.equal(response.status, "error" in value ? 402 : 503);
  }
  assert.equal(reserves, 0); assert.equal(providers, 0);
});

test("cancel during readonly quote never establishes a late reservation", async () => {
  let release!: () => void, started!: () => void, reserves = 0, providers = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const abort = new AbortController(), original = request();
  const pending = fetchRequest(new Request(original, { signal: abort.signal }), environment({ BILLING: {
    async quote() { started(); await gate; return { enabled: true, maxOutputTokens: 256 }; },
    async reserve() { reserves++; return { enabled: false }; }, async finalize() { throw new Error("No hold"); },
  } }), { providerFetch: async () => { providers++; return sse(); } });
  await ready; abort.abort(); release();
  assert.equal((await pending).status, 499); assert.equal(reserves, 0); assert.equal(providers, 0);
});

test("a budget-limited incomplete memory cannot replace facts or incur a valid-output debit", async () => {
  const bill = binding();
  const response = await fetchRequest(request("/api/memory", { messages: [{ role: "user", content: "收到地图。" }] }),
    environment({ BILLING: { ...bill.service, async quote() { return { enabled: true, maxOutputTokens: 512 }; } } }),
    { providerFetch: async () => Response.json({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(state) } }],
      usage: { prompt_tokens: 100, completion_tokens: 512 } }) });
  assert.equal(response.status, 502); assert.equal(bill.reserves[0].maxOutputTokens, 512);
  assert.equal(bill.finalizations[0].hasValidOutput, false); assert.equal(bill.finalizations[0].outcome, "failed");
});

test("an explicitly disabled server tariff preserves current free chat without settlement", async () => {
  let reserves = 0;
  let finalizations = 0;
  const response = await fetchRequest(request(), environment({ BILLING: {
    async reserve() { reserves++; return { enabled: false }; },
    async finalize() { finalizations++; throw new Error("must not finalize"); },
  } }), { providerFetch: async () => sse() });
  assert.equal(await response.text(), "管理员展开地图。");
  assert.equal(reserves, 1);
  assert.equal(finalizations, 0);
});

test("insufficient balance and duplicate claims reject before any provider spend", async () => {
  let providerCalls = 0;
  const values = [{ error: { status: 402, message: "Credit 余额不足，请先充值。", code: "CREDIT_INSUFFICIENT" } },
    { enabled: true, created: false, receipt: { id: reservationId } }];
  for (const value of values) {
    const response = await fetchRequest(request(), environment({ BILLING: { async reserve() { return value; }, async finalize() { throw new Error("must not finalize"); } } }),
      { providerFetch: async () => { providerCalls++; return sse(); } });
    assert.equal(response.status, "error" in value ? 402 : 409);
    const body = await response.json() as { error: string; code: string };
    assert.equal(body.code, "error" in value ? "CREDIT_INSUFFICIENT" : "BILLING_REQUEST_USED");
    assert.ok(!JSON.stringify(body).includes(claimToken));
  }
  assert.equal(providerCalls, 0);
});

test("invalid UUIDs are rejected before session, rate limits, billing or model calls", async () => {
  let calls = 0;
  const env = environment({ BACKEND: { fetch: async () => { calls++; throw new Error("must not fetch session"); } } });
  for (const value of ["", "forged-request", requestId + "-extra"]) {
    const response = await fetchRequest(request("/api/chat", chatInput, { "X-Xumeng-Request-Id": value }), env,
      { providerFetch: async () => { calls++; return sse(); } });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_REQUEST_ID");
  }
  assert.equal(calls, 0);
});

test("request IDs generated for old clients remain safe and supplied UUIDs normalize casing", async () => {
  const bill = binding();
  const headers = new Headers(request().headers);
  headers.delete("X-Xumeng-Request-Id");
  const old = new Request(`${origin}/api/chat`, { method: "POST", headers, body: JSON.stringify(chatInput) });
  const response = await fetchRequest(old, environment({ BILLING: bill.service }), { providerFetch: async () => sse() });
  await response.text();
  assert.match(bill.reserves[0].requestId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(response.headers.get("X-Xumeng-Request-Id"), bill.reserves[0].requestId);
  const upper = await fetchRequest(request("/api/chat", chatInput, { "X-Xumeng-Request-Id": requestId.toUpperCase() }), environment({ BILLING: bill.service }),
    { providerFetch: async () => sse() });
  await upper.text();
  assert.equal(bill.reserves[1].requestId, requestId);
});

test("public HTTP proxies cannot reach reserve, finalize or reconciliation methods", async () => {
  let backendCalls = 0;
  const bill = binding();
  const env = environment({ BILLING: bill.service, BACKEND: { fetch: async () => { backendCalls++; throw new Error("must not proxy billing"); } } });
  for (const path of ["/api/backend/v1/internal/billing/reserve", "/api/backend/v1/billing/quote", "/api/backend/v1/billing/reserve", "/api/backend/v1/billing/finalize",
    "/api/dzmm/backend/v1/billing/getPending", "/api/backend/v1/billing/releaseExpired", "/api/backend/v1/billing/%72eserve"]) {
    const response = await fetchRequest(request(path), env);
    assert.equal(response.status, 404, path);
  }
  assert.equal(backendCalls, 0);
  assert.equal(bill.reserves.length, 0);
  assert.equal(bill.finalizations.length, 0);
});

test("malformed RPC grants and unavailable billing fail closed without revealing private capabilities", async () => {
  let providerCalls = 0;
  for (const reserve of [async () => { throw new Error(claimToken); }, async () => ({}),
    async () => ({ enabled: true, created: true, receipt: { id: reservationId }, claimToken: "bad" })]) {
    const response = await fetchRequest(request(), environment({ BILLING: { reserve, async finalize() { throw new Error("must not finalize"); } } }),
      { providerFetch: async () => { providerCalls++; return sse(); } });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(claimToken));
  }
  assert.equal(providerCalls, 0);
});

test("missing usage is passed as pending data instead of inventing token counts", async () => {
  const bill = binding();
  const response = await fetchRequest(request(), environment({ BILLING: bill.service }), { providerFetch: async () => sse(false) });
  await response.text();
  assert.deepEqual(bill.finalizations[0], { reservationId, accountId, claimToken, outcome: "completed", hasValidOutput: true,
    generationId: "gen-server-only" });
});

test("unauthenticated and rate-limited users cannot reserve Credit", async () => {
  const bill = binding();
  const noSession = await fetchRequest(request(), environment({ BILLING: bill.service, BACKEND: { fetch: async () => Response.json({ user: null }) } }));
  assert.equal(noSession.status, 401);
  const limited = await fetchRequest(request(), environment({ BILLING: bill.service, CHAT_RATE_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(limited.status, 429);
  assert.equal(bill.reserves.length, 0);
});

test("every model alias fails closed when its server billing binding is missing", async () => {
  let providerCalls = 0;
  for (const path of ["/api/chat", "/api/dzmm/chat", "/api/memory", "/api/dzmm/memory"]) {
    const body = path.endsWith("memory") ? { messages: [{ role: "user", content: "我收下地图。" }] } : chatInput;
    const response = await fetchRequest(request(path, body), environment({ BILLING: undefined }),
      { providerFetch: async () => { providerCalls++; return sse(); } });
    assert.equal(response.status, 503, path);
    assert.equal((await response.json() as { code: string }).code, "BILLING_UNAVAILABLE");
  }
  assert.equal(providerCalls, 0);
});

test("missing usage receives a short server-only metadata recovery through waitUntil", async () => {
  const bill = binding();
  const waits: Promise<unknown>[] = [];
  let modelCalls = 0, metadataCalls = 0;
  const response = await fetchRequest(request(), environment({ BILLING: bill.service, DZMM_BASE_URL: "https://openrouter.ai/api/v1" }), {
    waitUntil: promise => { waits.push(promise); },
    providerFetch: async () => { modelCalls++; return sse(false); },
    billingMetadataFetch: async (url, options) => {
      metadataCalls++;
      assert.equal(new URL(String(url)).pathname, "/api/v1/generation");
      assert.equal(options!.method, "GET");
      return Response.json({ data: { id: "gen-server-only", model: "provider/model", native_tokens_prompt: 160,
        native_tokens_completion: 35, native_tokens_reasoning: 0 } });
    },
  });
  assert.equal(await response.text(), "管理员展开地图。");
  await Promise.all(waits);
  assert.equal(modelCalls, 1);
  assert.equal(metadataCalls, 1);
  assert.equal(waits.length, 2);
  assert.equal(bill.finalizations.length, 2);
  assert.equal(bill.finalizations[0].usage, undefined);
  assert.deepEqual(bill.finalizations[1].usage, { promptTokens: 160, completionTokens: 35 });
});


test("Super zero-charge grants keep provider caps and actual cost accounting through the real gateway", async () => {
  const costPolicy: DzmmCreditCostPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
  for (const validCaps of [true, false]) {
    const bill = binding(costPolicy); let providerCalls = 0;
    const service = { ...bill.service, quote: async () => ({ enabled: true, billingExempt: true,
      maxOutputTokens: 512, requiredCredits: 0, availableCredits: null }),
      reserve: async (input: DzmmBillingReserveRpcInput) => ({ ...await bill.service.reserve(input),
        billingExempt: true, receipt: { id: reservationId, costPolicy, billingExempt: true, reservedCredits: 0, chargedCredits: 0 } }) };
    const response = await fetchRequest(request(), environment({ BILLING: service, DZMM_BASE_URL: "https://openrouter.ai/api/v1",
      ...(validCaps ? { DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: "4.4", DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: "13.2" } : {}) }), {
      providerFetch: async (_url, options) => {
        providerCalls++; const body = JSON.parse(String(options!.body));
        assert.equal(body.max_tokens, 512);
        assert.deepEqual(body.provider, { max_price: { prompt: 4.4, completion: 13.2 } });
        return new Response('data: {"id":"gen-super-test","choices":[{"delta":{"content":"管理员展开地图。"}}]}\n\n'
          + 'data: {"choices":[],"usage":{"prompt_tokens":160,"completion_tokens":35,"cost":0.00053}}\n\n'
          + 'data: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    assert.equal(response.status, validCaps ? 200 : 503);
    const text = await response.text(); if (validCaps) assert.equal(text, "管理员展开地图。");
    assert.equal(providerCalls, validCaps ? 1 : 0); assert.equal(bill.reserves.length, 1);
    assert.equal(bill.finalizations.length, 1);
    assert.equal(bill.finalizations[0].hasValidOutput, validCaps);
    if (validCaps) assert.equal(bill.finalizations[0].usage?.providerCostUsd, 0.00053);
  }
});
