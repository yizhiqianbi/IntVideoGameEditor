export const GROK_MODELS = ["grok-4.3", "grok-4.6"] as const;
export type GrokModel = (typeof GROK_MODELS)[number];
export const SCRIPT_MODELS = [
  { id: "grok-4.6", name: "Grok 4.6" },
  { id: "grok-4.3", name: "Grok 4.3" },
  { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5" },
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5" },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna" },
  { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
] as const;
export const SCRIPT_TONES = ["standard", "suspense", "comedy"] as const;
export type ScriptTone = (typeof SCRIPT_TONES)[number];
export const DEFAULT_SCRIPT_PROVIDER = "openrouter";
export const DEFAULT_SCRIPT_MODEL: GrokModel = "grok-4.6";
export const DEFAULT_SCRIPT_TONE: ScriptTone = "standard";

export const TONE_OPTIONS = [
  {
    id: "standard",
    label: "常规剧情",
    hint: "以人物目标、冲突和情节变化推动故事",
  },
  {
    id: "suspense",
    label: "悬疑推理",
    hint: "用线索、悬念和人物选择推进剧情",
  },
  {
    id: "comedy",
    label: "轻松喜剧",
    hint: "用反差、误会和对白节奏制造幽默",
  },
] as const;

export function normalizeTone(value: unknown): ScriptTone {
  if (value === "suspense" || value === "comedy") return value;
  // Retired presets in older archives open in the general story mode.
  return "standard";
}

export function scriptConnection(
  body: Record<string, unknown>,
  env: Record<string, string | undefined>,
) {
  const provider = body.scriptProvider ?? DEFAULT_SCRIPT_PROVIDER;
  if (provider !== "openrouter" && provider !== "xai")
    throw new Error("剧本服务无效");
  const model = body.scriptModel ?? DEFAULT_SCRIPT_MODEL;
  if (!SCRIPT_MODELS.some(option => option.id === model))
    throw new Error("请选择支持的剧本模型（Grok / Claude / OpenAI）");
  if (provider === "xai" && !(GROK_MODELS as readonly unknown[]).includes(model))
    throw new Error("xAI 官方接口仅支持 Grok，请切换到 OpenRouter。");
  const supplied =
    typeof body.scriptKey === "string" ? body.scriptKey.trim() : "";
  const key =
    supplied || (provider === "xai" ? env.XAI_API_KEY : env.OPENROUTER_API_KEY);
  if (!key)
    throw new Error(
      `请在连接设置中填写 ${provider === "xai" ? "xAI" : "OpenRouter"} API Key，以启用 Grok 剧本 Agent。`,
    );
  const base =
    provider === "xai"
      ? "https://api.x.ai/v1"
      : supplied
        ? "https://openrouter.ai/api/v1"
        : env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  return {
    key,
    url: `${base.replace(/\/$/, "")}/chat/completions`,
    model: provider === "xai" || String(model).includes("/") ? String(model) : `x-ai/${model}`,
  };
}

export function scriptTone(value: unknown) {
  if (
    value !== undefined &&
    value !== "standard" &&
    value !== "suspense" &&
    value !== "comedy" &&
    value !== "sensual" &&
    value !== "explicit" &&
    value !== "mature"
  )
    throw new Error("剧情风格无效");
  const tone =
    value === undefined ? DEFAULT_SCRIPT_TONE : normalizeTone(value);
  if (tone === "suspense")
    return "采用悬疑推理短剧风格，用线索、悬念和人物选择推动故事。重视信息分配与伏笔回收，保持逻辑连续。";
  if (tone === "comedy")
    return "采用轻松喜剧风格，通过人物反差、误会和对白节奏制造幽默，保留清晰的故事目标与情节变化。";
  return "采用通用影视短剧风格，重视人物动机、对立目标与每场价值转折。对白是行动，有潜台词。以用户提供的故事为准，不擅自添加特殊题材。";
}
