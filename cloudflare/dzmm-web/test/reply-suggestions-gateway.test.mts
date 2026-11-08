import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";
import type { DzmmBillingFinalizeRpcInput, DzmmBillingReserveRpcInput } from "../../../src/lib/dzmm-generation-billing";
const origin = "https://suggestions-gateway.test", accountId = "server-suggestions-account";
const requestId = "74b57614-52c5-4890-9062-ec727f575834", token = "t".repeat(64), claimToken = "c".repeat(64);
const input = { character: { name: "原创保管员" }, messages: [{ role: "assistant", content: "两个入口还需要核对。" }, { role: "user", content: "占位" }], model: "balanced" };
const options = [
  { direction: "交流了解", title: "了解入口", reply: "你能先解释这两个入口的区别吗？" },
  { direction: "行动探索", title: "核对原图", reply: "我想先用原图核对入口的位置。" },
  { direction: "调整节奏", title: "稍作休息", reply: "我们先休息一下，再整理已确认的线索。" },
];
function environment(overrides: Partial<Env> = {}): Env {
  return { ASSETS: { fetch: async () => new Response("SPA") }, BACKEND: { fetch: async () => Response.json({ user: { id: accountId } }) },
    BILLING: { reserve: async () => ({ enabled: false }), finalize: async () => { throw new Error("Disabled billing must not finalize"); } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: "mock-provider-secret",
    DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "provider/model", ...overrides };
}
function request(path = "/api/reply-suggestions", body: unknown = input, headers?: HeadersInit) {
  const merged = new Headers({ Origin: origin, "Content-Type": "application/json", Cookie: `dzmm_session=${token}`, "X-Xumeng-Request-Id": requestId });
  new Headers(headers).forEach((value, key) => merged.set(key, value));
  return new Request(`${origin}${path}`, { method: "POST", headers: merged, body: JSON.stringify(body) });
}
function provider() { return Response.json({ id: "gen-local-suggestions", usage: { prompt_tokens: 100, completion_tokens: 90 },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ options }) } }] }); }

test("both suggestions routes reuse server identity and named billing capabilities with their own limiter keys", async () => {
  for (const path of ["/api/reply-suggestions", "/api/dzmm/reply-suggestions"]) {
    const limits: string[] = [], reserves: DzmmBillingReserveRpcInput[] = [], finalizations: DzmmBillingFinalizeRpcInput[] = [];
    const response = await fetchRequest(request(path, input, { "X-Account-Id": "forged-account" }), environment({
      CHAT_RATE_LIMITER: { limit: async ({ key }) => { limits.push(key); return { success: true }; } },
      BILLING: {
        async quote(value) { assert.equal(value.accountId, accountId); assert.equal(value.operation, "chat"); return { enabled: true, maxOutputTokens: 384 }; },
        async reserve(value) { reserves.push(value); return { enabled: true, created: true, receipt: { id: "usage_local_suggestions" }, claimToken }; },
        async finalize(value) { finalizations.push(value); return { receipt: { status: "settled" } }; },
      },
    }), { providerFetch: async (_url, supplied) => {
      assert.equal(reserves.length, 1);
      const body = String(supplied!.body), sent = JSON.parse(body);
      assert.equal(sent.max_tokens, 384); assert.equal(sent.model, "provider/model");
      assert.equal(reserves[0].model, sent.model); assert.deepEqual(sent.reasoning, { effort: "low" });
      assert.doesNotMatch(body, /forged-account/); assert.ok(!body.includes(token) && !body.includes(claimToken)); return provider();
    } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { options });
    assert.deepEqual(limits, ["reply-suggestions:ip:unknown", `reply-suggestions:user:${accountId}`]);
    assert.equal(reserves[0].accountId, accountId); assert.equal(reserves[0].sessionToken, token);
    assert.equal(reserves[0].requestId, requestId); assert.equal(reserves[0].operation, "chat");
    assert.equal(reserves[0].maxOutputTokens, 384); assert.match(reserves[0].requestFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(finalizations.length, 1); assert.equal(finalizations[0].hasValidOutput, true);
    assert.equal(response.headers.get("X-Xumeng-Request-Id"), requestId);
  }
});

test("suggestions cannot bypass session, wallet, rate, request identity or origin guards", async () => {
  let calls = 0; const providerFetch = async () => { calls++; return provider(); };
  const noSession = await fetchRequest(request(), environment({ BACKEND: { fetch: async () => Response.json({ user: null }) } }), { providerFetch });
  assert.equal(noSession.status, 401);
  const noWallet = await fetchRequest(request(), environment({ BILLING: {
    quote: async () => ({ error: { status: 402, message: "余额不足", code: "CREDIT_INSUFFICIENT" } }),
    reserve: async () => { assert.fail("Quote denial cannot reserve"); }, finalize: async () => {},
  } }), { providerFetch });
  assert.equal(noWallet.status, 402);
  const limited = await fetchRequest(request(), environment({ CHAT_RATE_LIMITER: { limit: async () => ({ success: false }) } }), { providerFetch });
  assert.equal(limited.status, 429);
  const crossSite = await fetchRequest(request(undefined, input, { Origin: "https://foreign.test" }), environment(), { providerFetch });
  assert.equal(crossSite.status, 403);
  const badId = await fetchRequest(request(undefined, input, { "X-Xumeng-Request-Id": "forged" }), environment(), { providerFetch });
  assert.equal(badId.status, 400);
  assert.equal(calls, 0);
});

test("suggestions expose POST only and reject unsupported media before session bindings", async () => {
  let calls = 0;
  const env = environment({ BACKEND: { fetch: async () => { calls++; throw new Error("Unexpected session"); } } });
  for (const method of ["GET", "HEAD", "PUT", "OPTIONS"]) {
    const response = await fetchRequest(new Request(`${origin}/api/reply-suggestions`, { method, headers: { Origin: origin } }), env);
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), "POST");
  }
  const rejected = await fetchRequest(request(undefined, input, { "Content-Type": "text/plain" }), env);
  assert.equal(rejected.status, 415); assert.equal(calls, 0);
});
