import test from "node:test";
import assert from "node:assert/strict";

import providerModule from "./provider";

const {
  resolvePlayAgentProviderAdapter,
  readPlayAgentProviderConfig,
} = providerModule as typeof import("./provider");

test("falls back to mock provider when no coding env is configured", () => {
  const previousProvider = process.env.PLAY_AGENT_PROVIDER;
  const previousKey = process.env.GLM_CODING_PLAN_API_KEY;

  delete process.env.PLAY_AGENT_PROVIDER;
  delete process.env.GLM_CODING_PLAN_API_KEY;

  const config = readPlayAgentProviderConfig();
  const adapter = resolvePlayAgentProviderAdapter();

  assert.equal(config.providerId, "mock");
  assert.equal(adapter.name, "mock-play-agent");

  process.env.PLAY_AGENT_PROVIDER = previousProvider;
  process.env.GLM_CODING_PLAN_API_KEY = previousKey;
});

test("resolves glm coding provider when env is configured", () => {
  const previousProvider = process.env.PLAY_AGENT_PROVIDER;
  const previousKey = process.env.GLM_CODING_PLAN_API_KEY;
  const previousModel = process.env.GLM_CODING_PLAN_MODEL;

  process.env.PLAY_AGENT_PROVIDER = "glm-coding-plan";
  process.env.GLM_CODING_PLAN_API_KEY = "local-test-key";
  process.env.GLM_CODING_PLAN_MODEL = "glm-4.7";

  const config = readPlayAgentProviderConfig();
  const adapter = resolvePlayAgentProviderAdapter();

  assert.equal(config.providerId, "glm-coding-plan");
  assert.equal(config.model, "glm-4.7");
  assert.equal(adapter.name, "glm-coding-plan");

  process.env.PLAY_AGENT_PROVIDER = previousProvider;
  process.env.GLM_CODING_PLAN_API_KEY = previousKey;
  process.env.GLM_CODING_PLAN_MODEL = previousModel;
});

test("resolves openrouter provider when env is configured", () => {
  const previousProvider = process.env.PLAY_AGENT_PROVIDER;
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MODEL;

  process.env.PLAY_AGENT_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "sk-or-local-test";
  process.env.OPENROUTER_MODEL = "deepseek/deepseek-v3.2";

  const config = readPlayAgentProviderConfig();
  const adapter = resolvePlayAgentProviderAdapter();

  assert.equal(config.providerId, "openrouter");
  assert.equal(config.model, "deepseek/deepseek-v3.2");
  assert.equal(adapter.name, "openrouter");

  process.env.PLAY_AGENT_PROVIDER = previousProvider;
  process.env.OPENROUTER_API_KEY = previousKey;
  process.env.OPENROUTER_MODEL = previousModel;
});
