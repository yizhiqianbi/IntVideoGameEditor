import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import modelsModule from "./dzmm-models";
import chatModule from "./dzmm-chat";
import storageModule from "./dzmm-storage";
import billingModule from "./dzmm-generation-billing";
import pricingModule from "./dzmm-credit-pricing";
const { DZMM_MODEL_OPTIONS, DZMM_OFFERED_MODEL_OPTIONS, DZMM_DEFAULT_MODEL, isDzmmModelPreset, normalizeDzmmModelSelection,
  matchesDzmmFrozenProviderModel, dzmmModelCostPolicy } = modelsModule as typeof import("./dzmm-models");
const { readDzmmProviderConfig, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { DZMM_INITIAL_STATE, hydrateDzmmState } = storageModule as typeof import("./dzmm-storage");
const { readDzmmProviderMaxPrice } = billingModule as typeof import("./dzmm-generation-billing");
const { parseDzmmCreditCostPolicy } = pricingModule as typeof import("./dzmm-credit-pricing");
const policy = { version: 1 as const, multiplier: 3 as const, usdToCny: 6.704588, creditsPerCny: 100 as const,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };

test("fixed selections agree with the official catalogue, including canonical identities and highest cache/context tiers", async () => {
  const evidence = JSON.parse(await readFile(new URL("../../output/xumeng/multi-models/openrouter-catalog-20261008.json", import.meta.url), "utf8"));
  assert.equal(evidence.source, "https://openrouter.ai/api/v1/models");
  assert.equal(DZMM_DEFAULT_MODEL, "qwen"); assert.equal(DZMM_MODEL_OPTIONS.length, 12);
  assert.deepEqual(DZMM_OFFERED_MODEL_OPTIONS.map(option => option.id), ["grok", "grok46", "deepseek", "qwen", "gemma26", "gemma31", "cydonia", "venice"]);
  for (const option of DZMM_MODEL_OPTIONS) {
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
  assert.equal(readDzmmProviderConfig({ DZMM_API_KEY: "isolated-key" }).models.balanced, "qwen/qwen3-30b-a3b-instruct-2507");
  assert.equal(DZMM_INITIAL_STATE.preferences.model, "qwen");
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
  assert.equal(normalizeDzmmModelSelection("story"), "qwen");
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
    assert.ok(matchesDzmmFrozenProviderModel(option.canonicalModel, option.providerModel));
    assert.equal(matchesDzmmFrozenProviderModel(`${option.canonicalModel}-future`, option.providerModel), false);
  }
  assert.deepEqual(dzmmModelCostPolicy(policy, "provider/unknown"), policy);
  assert.deepEqual(policy, { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 });
});
