import type { DzmmCreditCostPolicy } from "./dzmm-credit-pricing";

export type DzmmSelectableModelId = "grok" | "grok46" | "gemini31" | "gemini4a" | "gemini4c" | "cydonia" | "gemini" | "claude" | "gpt" | "deepseek" | "qwen" | "heretic" | "gemma26" | "gemma31" | "venice";
/** Legacy modes remain valid stored/request values; new choices are server-owned IDs. */
export type DzmmModelPreset = DzmmSelectableModelId | "fast" | "balanced" | "story";
/** Default for new XUMENG conversations. */
export const DZMM_DEFAULT_MODEL: DzmmSelectableModelId = "gemma31";
/** Story chat 1x base floor: 8 credits (¥0.08) per turn. */
export const DZMM_BASE_TURN_CREDITS = 8 as const;

export type DzmmModelTierId = "weiguang" | "liuying" | "feiyue" | "xingqiong";
export type DzmmModelMultiplier = 1 | 2 | 3 | 5 | 6;
export type DzmmModelTier = {
  readonly id: DzmmModelTierId;
  readonly name: string;
  readonly subtitle: string;
};

export const DZMM_MODEL_TIERS: readonly DzmmModelTier[] = Object.freeze([
  { id: "weiguang", name: "微光 · 入门轻享", subtitle: "1× 倍率 · 8 金币起/轮" },
  { id: "liuying", name: "流萤 · 进阶热选", subtitle: "2× 倍率 · 16 金币起/轮" },
  { id: "feiyue", name: "绯月 · 高阶沉浸", subtitle: "3× 倍率 · 24 金币起/轮" },
  { id: "xingqiong", name: "星穹 · 旗舰殿堂", subtitle: "5×–6× 倍率 · 40 金币起/轮" },
].map(tier => Object.freeze(tier as DzmmModelTier)));

export type DzmmWhatsTokenRoute = {
  /** Exact Model ID on https://www.whatstoken.ai/v1/chat/completions. */
  readonly model: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly maxInputUsdPerMillion: number;
  readonly maxOutputUsdPerMillion: number;
};

export type DzmmModelOption = {
  readonly id: DzmmSelectableModelId;
  readonly label: string;
  readonly description: string;
  readonly tier: DzmmModelTierId;
  readonly rateMultiplier: DzmmModelMultiplier;
  /** Minimum credits charged per story chat turn (DZMM_BASE_TURN_CREDITS * rateMultiplier). */
  readonly minCredits: number;
  readonly badge?: string;
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
  /** Direct OpenAI-compatible host. Absent models stay on OpenRouter unless whatstoken is configured. */
  readonly route?: "sealion";
  /** WhatsToken relay mapping (preferred when WHATSTOKEN_API_KEY is bound; avoids regional blocks). */
  readonly whatstoken?: DzmmWhatsTokenRoute;
};

/** Official OpenRouter /api/v1/models snapshot (2026-10-22) paired with verified
 * WhatsToken marketplace direct channels (2026-11-26) for CN-accessible models.
 * Evidence: output/xumeng/multi-models/openrouter-catalog-20261008.json &
 * https://www.whatstoken.ai/api/v1/marketplace/public. */
export const DZMM_MODEL_OPTIONS: readonly DzmmModelOption[] = Object.freeze([
  { id: "grok", label: "星穹 · 魅影", description: "俏皮反差，戏剧张力与突破感拉满", tier: "xingqiong", rateMultiplier: 5, minCredits: 40, badge: "张力",
    providerModel: "x-ai/grok-4.7", canonicalModel: "x-ai/grok-4.7-20260916",
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2,
    providerMaxPromptUsdPerMillion: 4.4, contextLength: 500000, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "grok-4.7-supergrok", inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.6, maxInputUsdPerMillion: 0.4, maxOutputUsdPerMillion: 1.2 }) },
  { id: "grok46", label: "星穹 · 魅影旧版", description: "经典魅影风格对照", tier: "xingqiong", rateMultiplier: 5, minCredits: 40,
    providerModel: "x-ai/grok-4.6", canonicalModel: "x-ai/grok-4.6-20260810",
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2,
    providerMaxPromptUsdPerMillion: 4.4, contextLength: 500000, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "grok-4.6-supergrok", inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.6, maxInputUsdPerMillion: 0.4, maxOutputUsdPerMillion: 1.2 }) },
  { id: "gemini31", label: "流萤 · 灵犀", description: "极速响应，百万级长记忆基础款", tier: "liuying", rateMultiplier: 2, minCredits: 16,
    providerModel: "google/gemini-3.1-flash-lite", canonicalModel: "google/gemini-3.1-flash-lite-20260507",
    inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5, maxInputUsdPerMillion: 0.275, maxOutputUsdPerMillion: 1.65,
    providerMaxPromptUsdPerMillion: 0.275, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "gemini-3.7-flash", inputUsdPerMillion: 0.4275, outputUsdPerMillion: 2.1375, maxInputUsdPerMillion: 0.4275, maxOutputUsdPerMillion: 2.1375 }) },
  { id: "cydonia", label: "微光 · 暮色", description: "无拘角色演绎，氛围直白浓郁", tier: "weiguang", rateMultiplier: 1, minCredits: 8,
    providerModel: "thedrummer/cydonia-24b-v4.1", canonicalModel: "thedrummer/cydonia-24b-v4.1",
    inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.5, maxInputUsdPerMillion: 0.3, maxOutputUsdPerMillion: 0.5,
    providerMaxPromptUsdPerMillion: 0.3, contextLength: 131072, supportsTemperature: true, reasoningEffort: false },
  { id: "gemini4a", label: "星穹 · 银辉", description: "百万级长上下文细腻写作", tier: "xingqiong", rateMultiplier: 6, minCredits: 48,
    providerModel: "google/gemini-4-argon", canonicalModel: "google/gemini-4-argon-20261013",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, maxInputUsdPerMillion: 2, maxOutputUsdPerMillion: 10,
    providerMaxPromptUsdPerMillion: 2, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "gemini-4-argon-economy", inputUsdPerMillion: 0.4, outputUsdPerMillion: 2, maxInputUsdPerMillion: 0.4, maxOutputUsdPerMillion: 2 }) },
  { id: "gemini4c", label: "星穹 · 曜石", description: "百万级长记忆与史诗推演，顶级沉浸体验", tier: "xingqiong", rateMultiplier: 6, minCredits: 48, badge: "旗舰巅峰",
    providerModel: "google/gemini-4-carbon", canonicalModel: "google/gemini-4-carbon-20261110",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, maxInputUsdPerMillion: 2, maxOutputUsdPerMillion: 10,
    providerMaxPromptUsdPerMillion: 2, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "gemini-4-carbon-economy", inputUsdPerMillion: 0.8, outputUsdPerMillion: 4, maxInputUsdPerMillion: 0.8, maxOutputUsdPerMillion: 4 }) },
  { id: "gemini", label: "绯月 · 绘境", description: "强画面感描写，百万级长记忆不失忆", tier: "feiyue", rateMultiplier: 3, minCredits: 24, badge: "长记忆",
    providerModel: "google/gemini-3.8-flash", canonicalModel: "google/gemini-3.8-flash-20260902",
    inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75, maxInputUsdPerMillion: 0.825, maxOutputUsdPerMillion: 4.125,
    providerMaxPromptUsdPerMillion: 0.825, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "gemini-3.8-flash", inputUsdPerMillion: 0.3525, outputUsdPerMillion: 1.7625, maxInputUsdPerMillion: 0.3525, maxOutputUsdPerMillion: 1.7625 }) },
  { id: "claude", label: "星穹 · 墨韵", description: "殿堂级小说文笔，人物立体零 OOC", tier: "xingqiong", rateMultiplier: 6, minCredits: 48, badge: "顶级文笔",
    providerModel: "anthropic/claude-sonnet-5.5", canonicalModel: "anthropic/claude-sonnet-5.5-20260928",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 11,
    providerMaxPromptUsdPerMillion: 2.2, contextLength: 1000000, supportsTemperature: false, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "claude-sonnet-5-5-aws", inputUsdPerMillion: 1.24, outputUsdPerMillion: 6.2, maxInputUsdPerMillion: 1.24, maxOutputUsdPerMillion: 6.2 }) },
  { id: "gpt", label: "星穹 · 穹顶", description: "复杂世界观推演，史诗长篇不断线", tier: "xingqiong", rateMultiplier: 6, minCredits: 48,
    providerModel: "openai/gpt-6.1-sol", canonicalModel: "openai/gpt-6.1-sol-20260929",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, maxInputUsdPerMillion: 5.5, maxOutputUsdPerMillion: 16.5,
    providerMaxPromptUsdPerMillion: 4.4, contextLength: 1050000, supportsTemperature: false, reasoningEffort: "low" },
  { id: "deepseek", label: "流萤 · 织梦", description: "中文文笔细腻，情绪拉扯感极强", tier: "liuying", rateMultiplier: 2, minCredits: 16, badge: "热选",
    providerModel: "deepseek/deepseek-v4.1-flash", canonicalModel: "deepseek/deepseek-v4.1-flash-20260910",
    inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, maxInputUsdPerMillion: 0.33, maxOutputUsdPerMillion: 1.32,
    providerMaxPromptUsdPerMillion: 0.33, contextLength: 1048576, supportsTemperature: true, reasoningEffort: "low",
    whatstoken: Object.freeze({ model: "deepseek-v4-1-flash", inputUsdPerMillion: 0.072, outputUsdPerMillion: 0.288, maxInputUsdPerMillion: 0.072, maxOutputUsdPerMillion: 0.288 }) },
  { id: "heretic", label: "微光 · 暗涌", description: "直白释放，无拘沉浸剧情体验", tier: "weiguang", rateMultiplier: 1, minCredits: 8,
    providerModel: "gemma4-26b-a4b-ultra-heretic", canonicalModel: "gemma4-31b-heretic-nvfp4",
    // Direct host, not an OpenRouter catalogue row. Tariff matches Qwen so a
    // missing provider cost still settles inside the existing cheap ceiling.
    inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.3, maxInputUsdPerMillion: 0.1, maxOutputUsdPerMillion: 0.3,
    providerMaxPromptUsdPerMillion: 0.1, contextLength: 131072, supportsTemperature: true, reasoningEffort: false, route: "sealion" },
  { id: "qwen", label: "微光 · 素笺", description: "自然中文语感，轻快日常对话", tier: "weiguang", rateMultiplier: 1, minCredits: 8,
    providerModel: "qwen/qwen3-30b-a3b-instruct-2507", canonicalModel: "qwen/qwen3-30b-a3b-instruct-2507",
    // Match the verified OpenRouter catalogue tariff. The final usage frame is
    // still authoritative for settlement when a provider promotion applies.
    inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.3, maxInputUsdPerMillion: 0.1, maxOutputUsdPerMillion: 0.3,
    providerMaxPromptUsdPerMillion: 0.1, contextLength: 262144, supportsTemperature: true, reasoningEffort: false,
    whatstoken: Object.freeze({ model: "qwen3.8-flash", inputUsdPerMillion: 0.1005, outputUsdPerMillion: 0.3149, maxInputUsdPerMillion: 0.1005, maxOutputUsdPerMillion: 0.3149 }) },
  { id: "gemma26", label: "微光 · 晨露", description: "轻盈迅捷，日常快速对戏", tier: "weiguang", rateMultiplier: 1, minCredits: 8,
    providerModel: "google/gemma-4-26b-a4b-it", canonicalModel: "google/gemma-4-26b-a4b-it-20260403",
    inputUsdPerMillion: 0.09, outputUsdPerMillion: 0.3, maxInputUsdPerMillion: 0.09, maxOutputUsdPerMillion: 0.3,
    providerMaxPromptUsdPerMillion: 0.09, contextLength: 262144, supportsTemperature: true, reasoningEffort: null },
  { id: "gemma31", label: "微光 · 轻语", description: "流畅稳定，高性价比日常首选", tier: "weiguang", rateMultiplier: 1, minCredits: 8, badge: "默认",
    providerModel: "google/gemma-4-31b-it", canonicalModel: "google/gemma-4-31b-it-20260402",
    inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.4, maxInputUsdPerMillion: 0.2, maxOutputUsdPerMillion: 0.4,
    providerMaxPromptUsdPerMillion: 0.2, contextLength: 262144, supportsTemperature: true, reasoningEffort: null },
  { id: "venice", label: "微光 · 幽影", description: "低门槛无拘对戏", tier: "weiguang", rateMultiplier: 1, minCredits: 8,
    providerModel: "cognitivecomputations/dolphin-mistral-24b-venice-edition", canonicalModel: "venice/uncensored",
    inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.9, maxInputUsdPerMillion: 0.2, maxOutputUsdPerMillion: 0.9,
    providerMaxPromptUsdPerMillion: 0.2, contextLength: 128000, supportsTemperature: true, reasoningEffort: false },
].map(option => Object.freeze(option as DzmmModelOption)));

/** Curated 8 flagship tiers shown in the story model picker (ordered 1x -> 6x).
 * Stored rows and billing still accept every catalogue id for backward compatibility. */
export const DZMM_OFFERED_MODEL_OPTIONS = Object.freeze(
  (["gemma31", "qwen", "deepseek", "gemini31", "gemini", "grok", "claude", "gemini4c"] as const).flatMap(id => {
    const option = DZMM_MODEL_OPTIONS.find(item => item.id === id);
    return option ? [option] : [];
  }),
);

export function formatDzmmModelMultiplier(option: Pick<DzmmModelOption, "rateMultiplier">): string {
  return `${option.rateMultiplier}×`;
}

export function isDzmmModelPreset(value: unknown): value is DzmmModelPreset {
  return value === "fast" || value === "balanced" || value === "story" || DZMM_MODEL_OPTIONS.some(option => option.id === value);
}

/** Keep an offered choice. Legacy fast, balanced, story and retired ids map cleanly to the default model. */
export function normalizeDzmmModelSelection(value: DzmmModelPreset): DzmmSelectableModelId {
  return DZMM_OFFERED_MODEL_OPTIONS.find(option => option.id === value)?.id ?? DZMM_DEFAULT_MODEL;
}

export function findDzmmProviderModel(model: string): DzmmModelOption | undefined {
  return DZMM_MODEL_OPTIONS.find(option =>
    option.providerModel === model || option.canonicalModel === model || option.whatstoken?.model === model);
}

export function isDzmmWhatsTokenModel(model: string): boolean {
  return DZMM_MODEL_OPTIONS.some(option => option.whatstoken?.model === model);
}

/** Direct-tariff hosts (Sealion & WhatsToken) settle via token counts + frozen per-million
 * rates because they return standard OpenAI usage frames without OpenRouter's usage.cost. */
export function isDzmmDirectTariffModel(model: string): boolean {
  const option = findDzmmProviderModel(model);
  return Boolean(option && (option.route === "sealion" || option.whatstoken?.model === model));
}

/** Exact catalogue identities only. Unknown future dates and name prefixes do
 * not authorize settling an earlier model's frozen reservation. */
export function matchesDzmmFrozenProviderModel(received: unknown, expected: string): boolean {
  return typeof received === "string" && (received === expected
    || DZMM_MODEL_OPTIONS.some(option => option.providerModel === expected && option.canonicalModel === received));
}

/** Preserve the server's FX, markup and Credit unit; replace only the
 * verified model tariff (and story chat floor when enabled) before quote/reserve.
 * Finalization uses the DB snapshot. */
export function dzmmModelCostPolicy(
  policy: DzmmCreditCostPolicy,
  model: string,
  options?: { applyMinCredits?: boolean },
): DzmmCreditCostPolicy {
  const option = findDzmmProviderModel(model);
  if (!option) return { ...policy };
  const tariff = option.whatstoken?.model === model ? option.whatstoken : option;
  const applyMinCredits = options?.applyMinCredits ?? true;
  const base: DzmmCreditCostPolicy = {
    version: policy.version,
    multiplier: policy.multiplier,
    usdToCny: policy.usdToCny,
    creditsPerCny: policy.creditsPerCny,
    inputUsdPerMillion: tariff.inputUsdPerMillion,
    outputUsdPerMillion: tariff.outputUsdPerMillion,
    maxInputUsdPerMillion: tariff.maxInputUsdPerMillion,
    maxOutputUsdPerMillion: tariff.maxOutputUsdPerMillion,
  };
  return applyMinCredits ? { ...base, minCredits: option.minCredits } : base;
}

/** Some reasoning-only providers reject temperature rather than honoring it. */
export function dzmmModelTemperature(model: string, temperature: number): { temperature?: number } {
  return findDzmmProviderModel(model)?.supportsTemperature === false ? {} : { temperature };
}

/** Keep low for effort-capable OpenRouter models. Direct OpenAI-compatible relays
 * (WhatsToken / Sealion) and models without a reasoning parameter omit it cleanly. */
export function dzmmModelReasoning(model: string): { reasoning?: { effort: "low" } | { enabled: false } } {
  if (isDzmmWhatsTokenModel(model)) return {};
  const effort = findDzmmProviderModel(model)?.reasoningEffort;
  if (effort === false) return {};
  return { reasoning: effort === null ? { enabled: false } : { effort: "low" } };
}
