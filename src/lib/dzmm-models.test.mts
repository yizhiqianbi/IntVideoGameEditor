import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import modelsModule from "./dzmm-models";
import chatModule from "./dzmm-chat";
import storageModule from "./dzmm-storage";
import billingModule from "./dzmm-generation-billing";
import pricingModule from "./dzmm-credit-pricing";
const { DZMM_MODEL_OPTIONS, DZMM_OFFERED_MODEL_OPTIONS, DZMM_DEFAULT_MODEL, DZMM_BASE_TURN_CREDITS, DZMM_MODEL_TIERS,
  isDzmmModelPreset, normalizeDzmmModelSelection, matchesDzmmFrozenProviderModel, dzmmModelCostPolicy,
  findDzmmProviderModel, isDzmmWhatsTokenModel, isDzmmDirectTariffModel, dzmmModelReasoning } = modelsModule as typeof import("./dzmm-models");
const { readDzmmProviderConfig, resolveDzmmChatUpstream, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { DZMM_INITIAL_STATE, hydrateDzmmState } = storageModule as typeof import("./dzmm-storage");
const { readDzmmProviderMaxPrice } = billingModule as typeof import("./dzmm-generation-billing");
const { parseDzmmCreditCostPolicy } = pricingModule as typeof import("./dzmm-credit-pricing");
const policy = { version: 1 as const, multiplier: 3 as const, usdToCny: 6.704588, creditsPerCny: 100 as const,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };

test("curated Oriental Dreamland tiers enforce 8-credit base floor and 1x-6x multipliers", () => {
  assert.equal(DZMM_DEFAULT_MODEL, "gemma31");
  assert.equal(DZMM_MODEL_OPTIONS.length, 15);
  assert.equal(DZMM_BASE_TURN_CREDITS, 8);
  assert.equal(DZMM_MODEL_TIERS.length, 4);
  assert.deepEqual(DZMM_OFFERED_MODEL_OPTIONS.map(option => option.id), ["gemma31", "qwen", "deepseek", "gemini31", "gemini", "grok", "claude", "gemini4c"]);
  assert.equal(normalizeDzmmModelSelection("deepseek"), "deepseek");
  assert.equal(normalizeDzmmModelSelection("claude"), "claude");
  assert.equal(normalizeDzmmModelSelection("gemini4c"), "gemini4c");
  assert.equal(normalizeDzmmModelSelection("qwen"), "qwen");
  assert.equal(normalizeDzmmModelSelection("heretic"), "gemma31");
  assert.equal(normalizeDzmmModelSelection("gpt"), "gemma31");
  for (const option of DZMM_MODEL_OPTIONS) {
    assert.equal(option.minCredits, DZMM_BASE_TURN_CREDITS * option.rateMultiplier);
    assert.ok(option.minCredits >= 8);
    assert.ok(DZMM_MODEL_TIERS.some(tier => tier.id === option.tier));
    assert.ok(Object.isFrozen(option));
  }
});

test("fixed selections agree with the official catalogue, including canonical identities and highest cache/context tiers", async (t) => {
  let evidenceRaw: string;
  try {
    evidenceRaw = await readFile(new URL("../../output/xumeng/multi-models/openrouter-catalog-20261008.json", import.meta.url), "utf8");
  } catch {
    t.skip("local OpenRouter snapshot is not checked into the workspace");
    return;
  }
  const evidence = JSON.parse(evidenceRaw);
  assert.equal(evidence.source, "https://openrouter.ai/api/v1/models");
  for (const option of DZMM_MODEL_OPTIONS) {
    if (option.route === "sealion") {
      assert.equal(option.providerModel, "gemma4-26b-a4b-ultra-heretic");
      assert.equal(option.canonicalModel, "gemma4-31b-heretic-nvfp4");
      assert.equal(option.reasoningEffort, false);
      continue;
    }
    const official = evidence.models.find((model: { id: string }) => model.id === option.providerModel);
    assert.ok(official); assert.equal(option.canonicalModel, official.canonical_slug);
    assert.equal(option.contextLength, official.context_length);
    assert.ok(Math.abs(option.inputUsdPerMillion - Number(official.pricing.prompt) * 1000000) < 1e-9);
    assert.ok(Math.abs(option.outputUsdPerMillion - Number(official.pricing.completion) * 1000000) < 1e-9);
    const tiers = [official.pricing, ...(official.pricing.overrides ?? [])];
    const promptMax = Math.max(...tiers.map(tier => Number(tier.prompt ?? official.pricing.prompt) * 1000000));
    const inputMax = Math.max(...tiers.flatMap(tier => [tier.prompt, tier.input_cache_write, tier.input_cache_write_1h]
      .filter(value => value !== undefined).map(value => Number(value) * 1000000)));
    const outputMax = Math.max(...tiers.map(tier => Number(tier.completion ?? official.pricing.completion) * 1000000));
    assert.ok(option.providerMaxPromptUsdPerMillion >= promptMax);
    assert.ok(option.maxInputUsdPerMillion >= inputMax); assert.ok(option.maxOutputUsdPerMillion >= outputMax);
    assert.equal(option.supportsTemperature, official.supported_parameters.includes("temperature"));
    const supportsLowEffort = official.reasoning?.supported_efforts?.includes("low") === true;
    const supportsReasoning = official.supported_parameters.includes("reasoning");
    assert.equal(option.reasoningEffort, supportsLowEffort ? "low" : supportsReasoning ? null : false);
    if (option.reasoningEffort === false) assert.equal(supportsReasoning, false);
    assert.equal(official.supported_parameters.includes("structured_outputs"), option.id !== "venice");
    assert.ok(Object.isFrozen(option));
  }
});

test("new requests and imported preferences accept only server IDs while old modes and unknown warnings survive", () => {
  const config = readDzmmProviderConfig({ DZMM_API_KEY: "isolated-key", DZMM_MODEL: "legacy/default", DZMM_FAST_MODEL: "legacy/fast" });
  assert.equal(config.models.fast, "legacy/fast"); assert.equal(config.models.balanced, "legacy/default");
  assert.equal(readDzmmProviderConfig({ DZMM_API_KEY: "isolated-key" }).models.balanced, "google/gemma-4-31b-it");
  assert.equal(DZMM_INITIAL_STATE.preferences.model, "gemma31");
  for (const model of ["fast", "balanced", "story", ...DZMM_MODEL_OPTIONS.map(option => option.id)]) {
    assert.ok(isDzmmModelPreset(model));
    assert.equal(validateDzmmChatInput({ character: { name: "原创图书员" }, messages: [{ role: "user", content: "看地图。" }], model }).model, model);
    assert.equal(hydrateDzmmState(JSON.stringify({ version: 1, preferences: { model } })).state.preferences.model, model);
  }
  for (const option of DZMM_MODEL_OPTIONS) assert.equal(config.models[option.id], option.providerModel);
  for (const model of ["unknown", "__proto__", "x-ai/grok-4.6", { id: "grok" }]) {
    assert.equal(isDzmmModelPreset(model), false);
    assert.throws(() => validateDzmmChatInput({ character: { name: "图书员" }, messages: [{ role: "user", content: "看地图。" }], model }));
    assert.ok(hydrateDzmmState(JSON.stringify({ version: 1, preferences: { model } })).warnings.some(warning => warning.includes("本地模型模式无效")));
  }
  assert.equal(normalizeDzmmModelSelection("story"), "gemma31");
});

test("provider caps and frozen tariff come from the same exact model, retaining FX and rejecting speculative canonical versions", () => {
  for (const option of DZMM_MODEL_OPTIONS) {
    const frozen = dzmmModelCostPolicy(policy, option.providerModel);
    assert.ok(parseDzmmCreditCostPolicy(frozen)); assert.equal(frozen.usdToCny, policy.usdToCny);
    assert.equal(frozen.multiplier, 3); assert.equal(frozen.creditsPerCny, 100);
    assert.deepEqual(readDzmmProviderMaxPrice({}, "https://openrouter.ai/api/v1", option.providerModel), {
      prompt: option.providerMaxPromptUsdPerMillion, completion: option.maxOutputUsdPerMillion, request: 0,
    });
    assert.equal(frozen.maxInputUsdPerMillion, option.maxInputUsdPerMillion);
    assert.equal(frozen.maxOutputUsdPerMillion, option.maxOutputUsdPerMillion);
    assert.equal(frozen.minCredits, option.minCredits);
    const memoryPolicy = dzmmModelCostPolicy(policy, option.providerModel, { applyMinCredits: false });
    assert.equal(memoryPolicy.minCredits, undefined);
    assert.ok(parseDzmmCreditCostPolicy(memoryPolicy));
    assert.ok(matchesDzmmFrozenProviderModel(option.canonicalModel, option.providerModel));
    assert.equal(matchesDzmmFrozenProviderModel(`${option.canonicalModel}-future`, option.providerModel), false);
  }
  assert.deepEqual(dzmmModelCostPolicy(policy, "provider/unknown"), policy);
  assert.deepEqual(policy, { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 });
});

test("non-Gemma flagship models route through WhatsToken when configured, keep Gemma on OpenRouter, and guard SSRF", () => {
  const wtExpectedIds = ["qwen", "deepseek", "gemini31", "gemini", "grok", "claude", "gemini4c"] as const;
  for (const id of wtExpectedIds) {
    const option = DZMM_MODEL_OPTIONS.find(entry => entry.id === id);
    assert.ok(option?.whatstoken, `${id} should have a WhatsToken mapping`);
    const wt = option.whatstoken;
    assert.equal(findDzmmProviderModel(wt.model)?.id, id);
    assert.equal(isDzmmWhatsTokenModel(wt.model), true);
    assert.equal(isDzmmDirectTariffModel(wt.model), true);
    assert.deepEqual(dzmmModelReasoning(wt.model), {});
    const frozen = dzmmModelCostPolicy(policy, wt.model);
    assert.ok(parseDzmmCreditCostPolicy(frozen));
    assert.equal(frozen.inputUsdPerMillion, wt.inputUsdPerMillion);
    assert.equal(frozen.outputUsdPerMillion, wt.outputUsdPerMillion);
    assert.equal(frozen.maxInputUsdPerMillion, wt.maxInputUsdPerMillion);
    assert.equal(frozen.maxOutputUsdPerMillion, wt.maxOutputUsdPerMillion);
    assert.equal(frozen.minCredits, option.minCredits);
    assert.equal(dzmmModelCostPolicy(policy, wt.model, { applyMinCredits: false }).minCredits, undefined);
  }
  for (const id of ["gemma31", "gemma26", "heretic", "gpt"] as const) {
    const option = DZMM_MODEL_OPTIONS.find(entry => entry.id === id);
    assert.equal(option?.whatstoken, undefined);
  }
  const envWithWt = { DZMM_API_KEY: "openrouter-key", WHATSTOKEN_API_KEY: "wt-secret-key" };
  const config = readDzmmProviderConfig(envWithWt);
  const top = resolveDzmmChatUpstream(envWithWt, "gemini4c", config);
  assert.equal(top.endpoint, "https://www.whatstoken.ai/v1/chat/completions");
  assert.equal(top.model, "gemini-4-carbon-economy");
  assert.equal(top.direct, true);
  assert.equal(top.configured, true);

  const ds = resolveDzmmChatUpstream(envWithWt, "deepseek", config);
  assert.equal(ds.endpoint, "https://www.whatstoken.ai/v1/chat/completions");
  assert.equal(ds.model, "deepseek-v4-1-flash");
  assert.equal(ds.direct, true);
  assert.equal(ds.configured, true);

  const gemma = resolveDzmmChatUpstream(envWithWt, "gemma31", config);
  assert.equal(gemma.endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(gemma.model, "google/gemma-4-31b-it");
  assert.equal(gemma.direct, false);
  assert.equal(gemma.configured, true);

  const fallback = resolveDzmmChatUpstream({ ...envWithWt, DZMM_WHATSTOKEN_CHAT_ENABLED: "false" }, "claude", config);
  assert.equal(fallback.endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(fallback.model, "anthropic/claude-sonnet-5.5");
  assert.equal(fallback.direct, false);

  const ssrf = resolveDzmmChatUpstream({ ...envWithWt, WHATSTOKEN_BASE_URL: "https://evil.example/v1" }, "gemini4c", config);
  assert.equal(ssrf.direct, true);
  assert.equal(ssrf.configured, false);
});
