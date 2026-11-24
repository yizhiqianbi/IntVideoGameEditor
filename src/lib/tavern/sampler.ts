/**
 * SillyTavern-compatible sampler settings resolved to provider parameters.
 *
 * ST stores a sampler profile per preset (temperature, top_p, top_k, penalties,
 * context size, max tokens, stop sequences). Our hosted backend must also clamp
 * everything to what the chosen model accepts, so an imported card can never
 * push an unsupported parameter into the provider request.
 */

export type TavernSamplerSettings = {
  temperature: number;
  topP: number;
  topK: number;
  frequencyPenalty: number;
  presencePenalty: number;
  repeatPenalty: number;
  maxTokens: number;
  contextTokens: number;
  stop: string[];
};

export type TavernModelCapability = {
  id?: string;
  supportsTemperature: boolean;
  /** Provider context window in tokens. */
  contextLength: number;
  /** Provider maximum reply tokens, when known. */
  maxOutputTokens?: number;
  /** Providers that accept top_k / repetition_penalty (OpenRouter passthrough does not). */
  supportsTopK?: boolean;
};

export type TavernResolvedSampler = {
  settings: TavernSamplerSettings;
  /** Provider request fields. Only standard OpenAI-compatible keys are emitted by default. */
  providerParams: Record<string, number | string[]>;
  clamped: string[];
  ignored: string[];
};

export const TAVERN_SAMPLER_DEFAULTS: Readonly<TavernSamplerSettings> = Object.freeze({
  temperature: 0.75,
  topP: 1,
  topK: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repeatPenalty: 1,
  maxTokens: 4096,
  contextTokens: 32_000,
  stop: [],
});

const LIMITS = {
  temperature: [0, 2] as const,
  topP: [0, 1] as const,
  topK: [0, 200] as const,
  frequencyPenalty: [-2, 2] as const,
  presencePenalty: [-2, 2] as const,
  repeatPenalty: [0.5, 2] as const,
  maxTokens: [1, 16_384] as const,
  contextTokens: [512, 1_048_576] as const,
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numeric(value: unknown, fallback: number, range: readonly [number, number], label: string, clamped: string[]): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    clamped.push(label);
    return fallback;
  }
  const [min, max] = range;
  if (value < min) {
    clamped.push(label);
    return min;
  }
  if (value > max) {
    clamped.push(label);
    return max;
  }
  return value;
}

function stopList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item !== "string" || !item || item.length > 200 || item.includes("\0")) return [];
    return [item];
  }).slice(0, 8);
}

/** Parse an untrusted sampler object (card extension, preference or request). */
export function parseTavernSampler(value: unknown): { settings: TavernSamplerSettings; clamped: string[] } {
  const source = record(value) ? value : {};
  const clamped: string[] = [];
  const settings: TavernSamplerSettings = {
    temperature: numeric(source.temperature, TAVERN_SAMPLER_DEFAULTS.temperature, LIMITS.temperature, "temperature", clamped),
    topP: numeric(source.topP ?? source.top_p, TAVERN_SAMPLER_DEFAULTS.topP, LIMITS.topP, "topP", clamped),
    topK: numeric(source.topK ?? source.top_k, TAVERN_SAMPLER_DEFAULTS.topK, LIMITS.topK, "topK", clamped),
    frequencyPenalty: numeric(source.frequencyPenalty ?? source.frequency_penalty, TAVERN_SAMPLER_DEFAULTS.frequencyPenalty, LIMITS.frequencyPenalty, "frequencyPenalty", clamped),
    presencePenalty: numeric(source.presencePenalty ?? source.presence_penalty, TAVERN_SAMPLER_DEFAULTS.presencePenalty, LIMITS.presencePenalty, "presencePenalty", clamped),
    repeatPenalty: numeric(source.repeatPenalty ?? source.repeat_penalty, TAVERN_SAMPLER_DEFAULTS.repeatPenalty, LIMITS.repeatPenalty, "repeatPenalty", clamped),
    maxTokens: Math.round(numeric(source.maxTokens ?? source.max_tokens, TAVERN_SAMPLER_DEFAULTS.maxTokens, LIMITS.maxTokens, "maxTokens", clamped)),
    contextTokens: Math.round(numeric(source.contextTokens ?? source.context_tokens, TAVERN_SAMPLER_DEFAULTS.contextTokens, LIMITS.contextTokens, "contextTokens", clamped)),
    stop: stopList(source.stop ?? source.stop_sequences),
  };
  return { settings, clamped };
}

const SAMPLER_KEYS = ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "repeatPenalty", "maxTokens", "contextTokens"] as const;

/** Merge profile order: server default < card extension < conversation override < request.
 * Only keys explicitly present in a layer override earlier layers. */
export function mergeTavernSampler(...layers: unknown[]): { settings: TavernSamplerSettings; clamped: string[] } {
  let settings: TavernSamplerSettings = { ...TAVERN_SAMPLER_DEFAULTS, stop: [] };
  const clamped: string[] = [];
  for (const layer of layers) {
    if (!layer || !record(layer)) continue;
    const parsed = parseTavernSampler(layer);
    for (const key of SAMPLER_KEYS) {
      const present = layer[key] !== undefined || (key === "topP" && layer.top_p !== undefined)
        || (key === "topK" && layer.top_k !== undefined)
        || (key === "frequencyPenalty" && layer.frequency_penalty !== undefined)
        || (key === "presencePenalty" && layer.presence_penalty !== undefined)
        || (key === "repeatPenalty" && layer.repeat_penalty !== undefined)
        || (key === "maxTokens" && layer.max_tokens !== undefined)
        || (key === "contextTokens" && layer.context_tokens !== undefined);
      if (present) settings = { ...settings, [key]: parsed.settings[key] };
    }
    if (layer.stop !== undefined || layer.stop_sequences !== undefined) settings = { ...settings, stop: parsed.settings.stop };
    clamped.push(...parsed.clamped);
  }
  return { settings, clamped: [...new Set(clamped)] };
}

/** Fit a sampler profile to a concrete model capability. */
export function resolveTavernSampler(settings: TavernSamplerSettings, capability: TavernModelCapability): TavernResolvedSampler {
  const clamped: string[] = [];
  const ignored: string[] = [];
  const contextTokens = Math.max(512, Math.min(settings.contextTokens, capability.contextLength));
  if (contextTokens !== settings.contextTokens) clamped.push("contextTokens");
  const providerMaxOutput = capability.maxOutputTokens ?? capability.contextLength;
  const maxTokens = Math.max(1, Math.min(settings.maxTokens, providerMaxOutput, Math.max(1, contextTokens - 1)));
  if (maxTokens !== settings.maxTokens) clamped.push("maxTokens");

  const providerParams: Record<string, number | string[]> = {};
  if (capability.supportsTemperature) providerParams.temperature = settings.temperature;
  else ignored.push("temperature");
  if (settings.topP !== 1) providerParams.top_p = settings.topP;
  if (settings.frequencyPenalty !== 0) providerParams.frequency_penalty = settings.frequencyPenalty;
  if (settings.presencePenalty !== 0) providerParams.presence_penalty = settings.presencePenalty;
  if (settings.stop.length) providerParams.stop = settings.stop;
  if (settings.topK > 0) {
    if (capability.supportsTopK) providerParams.top_k = settings.topK;
    else ignored.push("topK");
  }
  if (settings.repeatPenalty !== 1) {
    if (capability.supportsTopK) providerParams.repetition_penalty = settings.repeatPenalty;
    else ignored.push("repeatPenalty");
  }
  providerParams.max_tokens = maxTokens;

  return { settings: { ...settings, contextTokens, maxTokens }, providerParams, clamped: [...new Set(clamped)], ignored };
}

/** Compact ST-style sampler profile for storage in card/preference extensions. */
export function serializeTavernSampler(settings: Partial<TavernSamplerSettings>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "repeatPenalty", "maxTokens", "contextTokens"] as const) {
    const value = settings[key];
    if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  if (settings.stop?.length) output.stop = settings.stop;
  return output;
}
