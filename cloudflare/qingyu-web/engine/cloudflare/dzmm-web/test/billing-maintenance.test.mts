import test from "node:test";
import assert from "node:assert/strict";
import worker, { type Env } from "../src/worker";
import { reconcileBillingGeneration, runBillingMaintenance, type PendingBillingGeneration } from "../src/billing-maintenance";
import type { DzmmBillingFinalizeRpcInput } from "../../../src/lib/dzmm-generation-billing";
import { chargeDzmmProviderCostUsd, type DzmmCreditCostPolicy } from "../../../src/lib/dzmm-credit-pricing";
import { DZMM_MODEL_OPTIONS, dzmmModelCostPolicy } from "../../../src/lib/dzmm-models";

const pending: PendingBillingGeneration = { reservationId: "reservation-own", accountId: "account-own", claimToken: "c".repeat(64),
  generationId: "gen-owned", model: "provider/model", outcome: "cancelled" };
const now = Date.now();
const costPolicy: DzmmCreditCostPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
function environment(overrides: Partial<Env> = {}) {
  const finalized: DzmmBillingFinalizeRpcInput[] = [];
  const events: string[] = [];
  const env: Env = { ASSETS: { fetch: async () => new Response("SPA") }, BACKEND: { fetch: async () => Response.json({ user: null }) },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: "mock-metadata-key", DZMM_BASE_URL: "https://openrouter.ai/api/v1",
    DZMM_MODEL: "provider/model", BILLING: {
      async reserve() { throw new Error("Maintenance cannot reserve or generate"); },
      async finalize(input) { finalized.push(input); events.push("finalize"); return { receipt: { id: input.reservationId } }; },
      async getPending(limit) { assert.equal(limit, 10); events.push("getPending"); return { items: [{ ...pending, expiresAt: now + 600_000 }] }; },
      async releaseExpired() { events.push("releaseExpired"); return { released: 0 }; },
    }, ...overrides };
  return { env, finalized, events };
}
function metadata(extra: Record<string, unknown> = {}) {
  return Response.json({ data: { id: pending.generationId, model: pending.model,
    native_tokens_prompt: 200, native_tokens_completion: 40, native_tokens_reasoning: 0,
    total_cost: 9_999_999, cancelled: true, ...extra } });
}

test("metadata recovery uses only the exact original zero-reasoning generation and frozen model", async () => {
  const store = environment();
  const result = await reconcileBillingGeneration(store.env, pending, { metadataFetch: async (url, options) => {
    const target = new URL(String(url));
    assert.equal(target.origin, "https://openrouter.ai");
    assert.equal(target.pathname, "/api/v1/generation");
    assert.deepEqual([...target.searchParams], [["id", pending.generationId]]);
    assert.equal(options!.method, "GET");
    assert.equal(options!.redirect, "error");
    assert.equal(new Headers(options!.headers).get("Authorization"), "Bearer mock-metadata-key");
    assert.ok(options!.signal);
    return metadata();
  } });
  assert.equal(result, "reconciled");
  assert.deepEqual(store.finalized, [{ reservationId: pending.reservationId, accountId: pending.accountId, claimToken: pending.claimToken,
    generationId: pending.generationId, outcome: pending.outcome, hasValidOutput: true, usage: { promptTokens: 200, completionTokens: 40 } }]);
});

test("positive, missing, null or string reasoning counts remain pending rather than guessing output fees", async () => {
  for (const reasoning of [35, null, undefined, "0", -1]) {
    const store = environment();
    const result = await reconcileBillingGeneration(store.env, pending, { metadataFetch: async () => metadata({ native_tokens_reasoning: reasoning }) });
    assert.equal(result, "unverified");
    assert.equal(store.finalized.length, 0);
  }
});

test("actual-cost recovery uses total_cost including cache and thinking, with zero cost distinct from missing", async () => {
  for (const [cost, expectedCharge] of [[0, 0], [0.004, 9]] as const) {
    const store = environment();
    const result = await reconcileBillingGeneration(store.env, { ...pending, costPolicy }, { metadataFetch: async () => metadata({
      total_cost: cost, native_tokens_prompt: 2000, native_tokens_completion: 400,
      native_tokens_reasoning: 350, native_tokens_cached: 1900,
    }) });
    assert.equal(result, "reconciled");
    assert.deepEqual(store.finalized[0].usage, { promptTokens: 2000, completionTokens: 400, providerCostUsd: cost });
    assert.equal(chargeDzmmProviderCostUsd(store.finalized[0].usage!.providerCostUsd!, costPolicy), expectedCharge,
      "Actual cost covers cache discounts and reasoning without a second token-based charge.");
  }
  for (const native_tokens_reasoning of [undefined, null, 350]) {
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, { ...pending, costPolicy }, { metadataFetch: async () =>
      metadata({ total_cost: 0.004, native_tokens_reasoning }) }), "reconciled");
    assert.equal(store.finalized[0].usage?.providerCostUsd, 0.004);
  }
});

test("the verified OpenRouter canonical model recovers native usage and exact cost from the original generation", async () => {
  // Round17 read-only metadata and official model catalog both verified this exact alias.
  const original = { ...pending, generationId: "gen-1791381045-U6fOqdCEyg3KnjpiYUvi", model: "x-ai/grok-4.6", costPolicy };
  const store = environment();
  const result = await reconcileBillingGeneration(store.env, original, { metadataFetch: async (url, options) => {
    assert.equal(new URL(String(url)).searchParams.get("id"), original.generationId);
    assert.equal(options?.method, "GET");
    return metadata({ id: original.generationId, model: "x-ai/grok-4.6-20260810", provider_name: "xAI",
      tokens_prompt: 2724, tokens_completion: 303, native_tokens_prompt: 2247, native_tokens_completion: 964,
      native_tokens_reasoning: 768, total_cost: 0.010278 });
  } });
  assert.equal(result, "reconciled");
  assert.equal(store.finalized.length, 1);
  assert.deepEqual(store.finalized[0].usage, { promptTokens: 2247, completionTokens: 964, providerCostUsd: 0.010278 });
  assert.equal(chargeDzmmProviderCostUsd(store.finalized[0].usage!.providerCostUsd!, costPolicy), 21);
});

test("canonical compatibility never accepts unverified dates, variants, providers or different generation IDs", async () => {
  const original = { ...pending, model: "x-ai/grok-4.6", costPolicy };
  for (const extra of [
    { model: "x-ai/grok-4.6-20260901" }, { model: "x-ai/grok-4.6-20260810:free" },
    { model: "x-ai/grok-4.60-20260810" }, { model: "other/grok-4.6-20260810" },
    { model: "x-ai/grok-4.7-20260810" }, { model: undefined },
    { model: "x-ai/grok-4.6-20260810", id: "gen-not-owned" },
  ]) {
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, original, { metadataFetch: async () =>
      metadata({ total_cost: 0.010278, ...extra }) }), "unverified");
    assert.equal(store.finalized.length, 0);
  }
  const store = environment();
  assert.equal(await reconcileBillingGeneration(store.env, { ...pending, model: "unverified/alias", costPolicy }, {
    metadataFetch: async () => metadata({ model: "unverified/alias-20260810", total_cost: 0.010278 }),
  }), "unverified");
  assert.equal(store.finalized.length, 0);
});

test("cost-policy recovery never falls back to token pricing on missing, forged or out-of-range total cost", async () => {
  for (const total_cost of [undefined, null, "0.004", -1, 1_000_000.1, Infinity, 1e-13, 0.1 + 0.2]) {
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, { ...pending, costPolicy }, { metadataFetch: async () =>
      metadata({ total_cost, cost: 0.004, native_tokens_reasoning: 0 }) }), "unverified");
    assert.equal(store.finalized.length, 0);
  }
  for (const extra of [{ id: "gen-not-owned" }, { model: "provider/not-frozen" }, { native_tokens_prompt: "200" },
    { native_tokens_completion: null }, { native_tokens_completion: 1.5 }]) {
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, { ...pending, costPolicy }, { metadataFetch: async () =>
      metadata({ total_cost: 0.004, ...extra }) }), "unverified");
    assert.equal(store.finalized.length, 0);
  }
});

test("an invalid frozen cost policy cannot downgrade into legacy metadata recovery", async () => {
  let lookups = 0;
  for (const badPolicy of [null, {}, { ...costPolicy, multiplier: 2 }, { ...costPolicy, usdToCny: "6.704588" },
    { ...costPolicy, unknownFee: 99 }]) {
    const store = environment();
    const badPending = { ...pending, costPolicy: badPolicy } as unknown as PendingBillingGeneration;
    assert.equal(await reconcileBillingGeneration(store.env, badPending, { metadataFetch: async () => {
      lookups++; return metadata({ total_cost: 0.004 });
    } }), "unavailable");
    assert.equal(store.finalized.length, 0);
  }
  assert.equal(lookups, 0);
});

test("scheduled recovery preserves each pending reservation's cost policy rather than the current tariff", async () => {
  const store = environment();
  store.env.BILLING!.getPending = async () => ({ items: [{ ...pending, costPolicy, expiresAt: now + 600_000 }] });
  const result = await runBillingMaintenance(store.env, { now, metadataFetch: async () => metadata({
    total_cost: 0.004, native_tokens_reasoning: 35, native_tokens_cached: 180,
  }) });
  assert.equal(result.reconciled, 1);
  assert.equal(store.finalized.length, 1);
  assert.equal(store.finalized[0].usage?.providerCostUsd, 0.004);
});

test("mismatched IDs, models and malformed token counts can never settle a reservation", async () => {
  for (const extra of [{ id: "gen-somebody-else" }, { model: "provider/other" }, { native_tokens_prompt: -1 },
    { native_tokens_completion: 0.5 }, { native_tokens_prompt: "200" }, { native_tokens_completion: null }]) {
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, pending, { metadataFetch: async () => metadata(extra) }), "unverified");
    assert.equal(store.finalized.length, 0);
  }
});

test("custom providers and invalid generation IDs are never sent to arbitrary metadata endpoints", async () => {
  let fetches = 0;
  const metadataFetch: typeof fetch = async () => { fetches++; return metadata(); };
  for (const base of ["https://provider.test/v1", "http://localhost:8000/v1", "https://openrouter.ai/api/v1/other"]) {
    const store = environment({ DZMM_BASE_URL: base });
    assert.equal(await reconcileBillingGeneration(store.env, pending, { metadataFetch }), "unavailable");
  }
  assert.equal(await reconcileBillingGeneration(environment().env, { ...pending, generationId: "gen-x?other-id=bad" }, { metadataFetch }), "unavailable");
  assert.equal(fetches, 0);
});

test("missing metadata, provider failures and RPC errors remain safe without exposing capabilities", async () => {
  for (const metadataFetch of [async () => new Response("private provider text", { status: 404 }),
    async () => new Response("not JSON"), async () => { throw new Error(pending.claimToken); }]) {
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, pending, { metadataFetch }), "unavailable");
    assert.equal(store.finalized.length, 0);
  }
  const store = environment();
  store.env.BILLING!.finalize = async () => ({ error: { status: 503, message: pending.claimToken } });
  assert.equal(await reconcileBillingGeneration(store.env, pending, { metadataFetch: async () => metadata() }), "unavailable");
});

test("expired holds are released first even when pending reads and provider configuration fail", async () => {
  const store = environment({ DZMM_API_KEY: undefined });
  let releaseCalls = 0;
  store.env.BILLING!.releaseExpired = async () => { store.events.push("releaseExpired"); return { released: ++releaseCalls < 3 ? 50 : 2 }; };
  store.env.BILLING!.getPending = async () => { store.events.push("getPending"); throw new Error("private RPC failure"); };
  const result = await runBillingMaintenance(store.env, { metadataFetch: async () => { throw new Error("must not fetch"); } });
  assert.deepEqual(store.events, ["releaseExpired", "releaseExpired", "releaseExpired", "getPending"]);
  assert.deepEqual(result, { released: 102, reconciled: 0, unverified: 0, unavailable: 1 });
});

test("maintenance bounds expiry draining, pending pages and metadata concurrency", async () => {
  const store = environment();
  let releaseCalls = 0, active = 0, maximum = 0, lookups = 0;
  store.env.BILLING!.releaseExpired = async () => { releaseCalls++; return { released: 50 }; };
  store.env.BILLING!.getPending = async limit => { assert.equal(limit, 10); return { items: Array.from({ length: 10 }, (_, index) => ({
    ...pending, reservationId: `reservation-${index}`, generationId: `gen-${index}`, expiresAt: now + 600_000,
  })) }; };
  const result = await runBillingMaintenance(store.env, { now, metadataFetch: async url => {
    lookups++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return metadata({ id: new URL(String(url)).searchParams.get("id") });
  } });
  assert.equal(releaseCalls, 5);
  assert.equal(result.released, 250);
  assert.equal(lookups, 10);
  assert.equal(maximum, 3);
  assert.equal(result.reconciled, 10);
});

test("expired and malformed pending rows do not trigger generation lookups", async () => {
  const store = environment();
  store.env.BILLING!.getPending = async () => ({ items: [{ ...pending, expiresAt: now },
    { ...pending, claimToken: "invalid", expiresAt: now + 600_000 }] });
  const result = await runBillingMaintenance(store.env, { now, metadataFetch: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.unverified, 2);
  assert.equal(store.finalized.length, 0);
});

test("cron registers bounded maintenance with waitUntil and does not generate models", async () => {
  const store = environment({ DZMM_API_KEY: undefined });
  store.env.BILLING!.getPending = async () => ({ items: [] });
  const waits: Promise<unknown>[] = [];
  worker.scheduled({} as ScheduledController, store.env, { waitUntil: promise => { waits.push(promise); } } as ExecutionContext);
  assert.equal(waits.length, 1);
  assert.deepEqual(await waits[0], { released: 0, reconciled: 0, unverified: 0, unavailable: 0 });
  assert.equal(store.finalized.length, 0);
});

test("all selectable model canonical IDs reconcile only their own frozen holds", async () => {
  for (const option of DZMM_MODEL_OPTIONS) {
    const frozen = { ...pending, model: option.providerModel, costPolicy: dzmmModelCostPolicy(costPolicy, option.providerModel) };
    const store = environment();
    assert.equal(await reconcileBillingGeneration(store.env, frozen, { metadataFetch: async () => metadata({
      model: option.canonicalModel, total_cost: 0.004, native_tokens_reasoning: 15,
    }) }), "reconciled");
    assert.equal(store.finalized.length, 1); assert.equal(store.finalized[0].usage?.providerCostUsd, 0.004);
    for (const wrong of [`${option.canonicalModel}-future`, DZMM_MODEL_OPTIONS.find(other => other.id !== option.id)!.canonicalModel]) {
      assert.equal(await reconcileBillingGeneration(store.env, frozen, { metadataFetch: async () => metadata({ model: wrong, total_cost: 0.004 }) }), "unverified");
    }
    assert.equal(store.finalized.length, 1);
  }
});
