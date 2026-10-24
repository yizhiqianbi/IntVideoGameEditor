import type { DzmmCreditCostPolicy } from "./dzmm-credit-pricing";

export type DzmmSelectableModelId = "grok" | "grok46" | "gemini31" | "gemini" | "claude" | "gpt" | "deepseek" | "qwen" | "gemma26" | "gemma31";
/** Legacy modes remain valid stored/request values; new choices are server-owned IDs. */
export type DzmmModelPreset = DzmmSelectableModelId | "fast" | "balanced" | "story";
/** Default for new XUMENG conversations, including the girlfriend chat. */
export const DZMM_DEFAULT_MODEL: DzmmSelectableModelId = "qwen";
export type DzmmModelOption = {
  readonly id: DzmmSelectableModelId;
  readonly label: string;
  readonly description: string;
  readonly providerModel: string;
  readonly canonicalModel: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly maxInputUsdPerMillion: number;
  readonly maxOutputUsdPerMillion: number;
  readonly providerMaxPromptUsdPerMillion: number;
  readonly contextLength: number;
  readonly supportsTemperature: boolean;
  /** null means the official model supports an on/off switch, no effort tier.
   * false means the provider rejects a reasoning field, so the request omits it. */
  readonly reasoningEffort: "low" | null | false;
};

/** Official OpenRouter /api/v1/models snapshot, 2026-10-22. Base prices are
 * estimates, not charges. Frozen input ceilings also cover catalogue cache
 * writes and long-context tiers; provider prompt filters use their own cap.
 * Evidence: output/xumeng/multi-models/openrouter-catalog-20261008.json. */
export const DZMM_MODEL_OPTIONS: readonly DzmmModelOption[] = Object.freeze([
  { id: "grok", label: "Grok 4.7", description: "俏皮风格对照", providerModel: "x-ai/grok-4.7", canonicalModel: "x-ai/grok-4.7-20260916",
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2,
    providerMaxPromptUsdPerMillion: 4.4, contextLength: 500000, supportsTemperature: true, reasoningEffort: "low" },
  { id: "grok46", label: "Grok 4.6", description: "上一版", providerModel: "x-ai/grok-4.6", canonicalModel: "x-ai/grok-4.6-20260810",
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2,
    providerMaxPromptUsdPerMillion: 4.4, contextLength: 500000, supportsTemperature: true, reasoningEffort: "low" },
  { id: "gemini31", label: "Gemini 3.1 Flash Lite", description: "快速低价", providerModel: "google/gemini-3.1-flash-lite", canonicalModel: "google/gemini-3.1-flash-lite-20260507",
    inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5, maxInputUsdPerMillion: 0.275, maxOutputUsdPerMillion: 1.65,
    providerMaxPromptUsdPerMillion: 0.275, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low" },
  { id: "gemini", label: "Gemini 3.8 Flash", description: "快速长上下文", providerModel: "google/gemini-3.8-flash", canonicalModel: "google/gemini-3.8-flash-20260902",
    inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75, maxInputUsdPerMillion: 0.825, maxOutputUsdPerMillion: 4.125,
    providerMaxPromptUsdPerMillion: 0.825, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low" },
  { id: "claude", label: "Claude Sonnet 5.5", description: "人物与长篇写作", providerModel: "anthropic/claude-sonnet-5.5", canonicalModel: "anthropic/claude-sonnet-5.5-20260928",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 11,
    providerMaxPromptUsdPerMillion: 2.2, contextLength: 1000000, supportsTemperature: false, reasoningEffort: "low" },
  { id: "gpt", label: "GPT 6.1 Sol", description: "通用创作与理解", providerModel: "openai/gpt-6.1-sol", canonicalModel: "openai/gpt-6.1-sol-20260929",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, maxInputUsdPerMillion: 5.5, maxOutputUsdPerMillion: 16.5,
    providerMaxPromptUsdPerMillion: 4.4, contextLength: 1050000, supportsTemperature: false, reasoningEffort: "low" },
  { id: "deepseek", label: "DeepSeek V4.1 Flash", description: "低成本对话", providerModel: "deepseek/deepseek-v4.1-flash", canonicalModel: "deepseek/deepseek-v4.1-flash-20260910",
    inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, maxInputUsdPerMillion: 0.33, maxOutputUsdPerMillion: 1.32,
    providerMaxPromptUsdPerMillion: 0.33, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low" },
  { id: "qwen", label: "Qwen3.6 Plus", description: "中文人物与细节", providerModel: "qwen/qwen3.6-plus", canonicalModel: "qwen/qwen3.6-plus-04-02",
    // Qingyu-only upgrade, verified 2026-10-24. Include cache writes and the
    // long-context tier in frozen ceilings. See character-cards-model-metadata.json.
    // Disable optional thinking so short chat budgets produce visible dialogue.
    inputUsdPerMillion: 0.325, outputUsdPerMillion: 1.95, maxInputUsdPerMillion: 1.625, maxOutputUsdPerMillion: 3.9,
    providerMaxPromptUsdPerMillion: 1.625, contextLength: 1000000, supportsTemperature: true, reasoningEffort: null },
  { id: "gemma26", label: "Gemma 4 26B", description: "官方指令，低价", providerModel: "google/gemma-4-26b-a4b-it", canonicalModel: "google/gemma-4-26b-a4b-it-20260403",
    inputUsdPerMillion: 0.09, outputUsdPerMillion: 0.3, maxInputUsdPerMillion: 0.09, maxOutputUsdPerMillion: 0.3,
    providerMaxPromptUsdPerMillion: 0.09, contextLength: 262144, supportsTemperature: true, reasoningEffort: null },
  { id: "gemma31", label: "Gemma 4 31B", description: "官方指令", providerModel: "google/gemma-4-31b-it", canonicalModel: "google/gemma-4-31b-it-20260402",
    inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.4, maxInputUsdPerMillion: 0.2, maxOutputUsdPerMillion: 0.4,
    providerMaxPromptUsdPerMillion: 0.2, contextLength: 262144, supportsTemperature: true, reasoningEffort: null },
].map(option => Object.freeze(option as DzmmModelOption)));

/** Models shown in the product picker. Other catalogue ids stay valid for stored rows and billing. */
export const DZMM_OFFERED_MODEL_OPTIONS = Object.freeze(
  (["grok", "grok46", "deepseek", "qwen", "gemma26", "gemma31"] as const).flatMap(id => {
    const option = DZMM_MODEL_OPTIONS.find(item => item.id === id);
    return option ? [option] : [];
  }),
);

export function isDzmmModelPreset(value: unknown): value is DzmmModelPreset {
  return value === "fast" || value === "balanced" || value === "story" || DZMM_MODEL_OPTIONS.some(option => option.id === value);
}

/** Keep an offered choice. Legacy presets and models no longer in the picker use Grok 4.7. */
export function normalizeDzmmModelSelection(value: DzmmModelPreset): DzmmSelectableModelId {
  return DZMM_OFFERED_MODEL_OPTIONS.find(option => option.id === value)?.id ?? DZMM_DEFAULT_MODEL;
}

export function findDzmmProviderModel(model: string): DzmmModelOption | undefined {
  return DZMM_MODEL_OPTIONS.find(option => option.providerModel === model || option.canonicalModel === model);
}

/** Exact catalogue identities only. Unknown future dates and name prefixes do
 * not authorize settling an earlier model's frozen reservation. */
export function matchesDzmmFrozenProviderModel(received: unknown, expected: string): boolean {
  return typeof received === "string" && (received === expected
    || DZMM_MODEL_OPTIONS.some(option => option.providerModel === expected && option.canonicalModel === received));
}

/** Preserve the server's FX, 3x multiplier and Credit unit; replace only the
 * verified model tariff before quote/reserve. Finalization uses the DB snapshot. */
export function dzmmModelCostPolicy(policy: DzmmCreditCostPolicy, model: string): DzmmCreditCostPolicy {
  const option = findDzmmProviderModel(model);
  return option ? { ...policy, inputUsdPerMillion: option.inputUsdPerMillion, outputUsdPerMillion: option.outputUsdPerMillion,
    maxInputUsdPerMillion: option.maxInputUsdPerMillion, maxOutputUsdPerMillion: option.maxOutputUsdPerMillion } : { ...policy };
}

/** Some reasoning-only providers reject temperature rather than honoring it. */
export function dzmmModelTemperature(model: string, temperature: number): { temperature?: number } {
  return findDzmmProviderModel(model)?.supportsTemperature === false ? {} : { temperature };
}

/** Keep low for effort-capable models. Models without a reasoning parameter
 * must omit it entirely rather than inventing a provider-specific switch. */
export function dzmmModelReasoning(model: string): { reasoning?: { effort: "low" } | { enabled: false } } {
  const effort = findDzmmProviderModel(model)?.reasoningEffort;
  if (effort === false) return {};
  return { reasoning: effort === null ? { enabled: false } : { effort: "low" } };
}
