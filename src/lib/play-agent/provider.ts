import { createGlmCodingPlanAdapter } from "./glm-adapter";
import { MOCK_PLAY_AGENT_ADAPTER } from "./mock-adapter";
import { createOpenRouterAdapter } from "./openrouter-adapter";

export type PlayAgentProviderId = "mock" | "glm-coding-plan" | "openrouter";

export type PlayAgentProviderConfig = {
  providerId: PlayAgentProviderId;
  apiKey: string | null;
  model: string;
  baseUrl: string;
};

const DEFAULT_GLM_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";
const DEFAULT_GLM_MODEL = "glm-4.7";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v3.2";

export function readPlayAgentProviderConfig(): PlayAgentProviderConfig {
  const requestedProvider = process.env.PLAY_AGENT_PROVIDER;
  const providerId: PlayAgentProviderId =
    requestedProvider === "openrouter" && process.env.OPENROUTER_API_KEY
      ? "openrouter"
      : requestedProvider === "glm-coding-plan" &&
          process.env.GLM_CODING_PLAN_API_KEY
        ? "glm-coding-plan"
        : "mock";

  return {
    providerId,
    apiKey:
      providerId === "openrouter"
        ? process.env.OPENROUTER_API_KEY?.trim() || null
        : process.env.GLM_CODING_PLAN_API_KEY?.trim() || null,
    model:
      providerId === "openrouter"
        ? process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
        : process.env.GLM_CODING_PLAN_MODEL?.trim() || DEFAULT_GLM_MODEL,
    baseUrl:
      providerId === "openrouter"
        ? process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL
        : process.env.GLM_CODING_PLAN_BASE_URL?.trim() || DEFAULT_GLM_BASE_URL,
  };
}

export function resolvePlayAgentProviderAdapter() {
  const config = readPlayAgentProviderConfig();

  if (config.providerId === "openrouter" && config.apiKey) {
    return createOpenRouterAdapter({
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      appName: "Fun-X-Studio",
      appUrl: "http://localhost:3000",
    });
  }

  if (config.providerId === "glm-coding-plan" && config.apiKey) {
    return createGlmCodingPlanAdapter({
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });
  }

  return MOCK_PLAY_AGENT_ADAPTER;
}

const playAgentProviderModule = {
  readPlayAgentProviderConfig,
  resolvePlayAgentProviderAdapter,
};

export default playAgentProviderModule;
