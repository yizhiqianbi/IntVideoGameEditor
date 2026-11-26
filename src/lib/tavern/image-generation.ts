/**
 * SillyTavern-style image generation settings.
 *
 * Mirrors ST's Image Generation extension: editable positive/negative prompt
 * templates with macros, character/scenario injection, a selectable aspect
 * ratio and an auto-generation trigger. The actual provider stays the site's
 * existing image channel; this module only shapes what is sent to it.
 */
import { expandTavernMacros, type TavernMacroContext } from "./macros";
import { parseTavernImagePresetId } from "./image";

export const TAVERN_IMAGE_SIZES = ["9:16", "3:4", "1:1", "4:3", "16:9"] as const;
export type TavernImageSize = (typeof TAVERN_IMAGE_SIZES)[number];
export type TavernImageAutoMode = "off" | "each" | "interval";

export type TavernImageGeneration = {
  /** Master switch: templates/auto generation are only applied when enabled. */
  enabled: boolean;
  autoMode: TavernImageAutoMode;
  /** 1–20; used when autoMode === "interval". */
  interval: number;
  size: TavernImageSize;
  promptPrefix: string;
  mainPrompt: string;
  negativePrompt: string;
  injectCharacter: boolean;
  injectScenario: boolean;
  /** Set when the user turns automatic chat images off. Absent means provide them. */
  autoOptOut?: boolean;
};

export const TAVERN_IMAGE_GENERATION_LIMITS = Object.freeze({
  promptPrefix: 400,
  mainPrompt: 800,
  negativePrompt: 400,
  interval: 20,
  prompt: 1900,
});

export const DEFAULT_TAVERN_IMAGE_GENERATION: TavernImageGeneration = Object.freeze({
  enabled: false,
  autoMode: "off",
  interval: 3,
  size: "3:4",
  promptPrefix: "",
  mainPrompt: "",
  negativePrompt: "",
  injectCharacter: true,
  injectScenario: false,
});

const SIZE_SET = new Set<string>(TAVERN_IMAGE_SIZES);
const AUTO_SET = new Set<string>(["off", "each", "interval"]);

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, max) : "";
}

export function parseTavernImageAutoMode(value: unknown): TavernImageAutoMode {
  return typeof value === "string" && AUTO_SET.has(value) ? value as TavernImageAutoMode : "off";
}

export function parseTavernImageSize(value: unknown): TavernImageSize {
  return typeof value === "string" && SIZE_SET.has(value) ? value as TavernImageSize : "3:4";
}

/** Parse a stored preference; returns undefined when nothing usable is present. */
export function parseTavernImageGeneration(value: unknown): TavernImageGeneration | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const intervalRaw = typeof source.interval === "number" && Number.isFinite(source.interval) ? Math.round(source.interval) : DEFAULT_TAVERN_IMAGE_GENERATION.interval;
  return {
    enabled: source.enabled === true,
    autoMode: parseTavernImageAutoMode(source.autoMode),
    interval: Math.min(TAVERN_IMAGE_GENERATION_LIMITS.interval, Math.max(1, intervalRaw)),
    size: parseTavernImageSize(source.size),
    promptPrefix: clean(source.promptPrefix, TAVERN_IMAGE_GENERATION_LIMITS.promptPrefix),
    mainPrompt: clean(source.mainPrompt, TAVERN_IMAGE_GENERATION_LIMITS.mainPrompt),
    negativePrompt: clean(source.negativePrompt, TAVERN_IMAGE_GENERATION_LIMITS.negativePrompt),
    injectCharacter: source.injectCharacter !== false,
    injectScenario: source.injectScenario === true,
    ...(source.autoOptOut === true ? { autoOptOut: true } : {}),
  };
}

/** New replies get an image. A stored "off" from before this default does not count as a choice. */
export function chatImageAutoMode(settings?: TavernImageGeneration | null): TavernImageAutoMode {
  if (settings?.autoOptOut) return settings.autoMode === "interval" ? "interval" : settings.autoMode === "each" ? "each" : "off";
  if (settings?.autoMode === "interval") return "interval";
  return "each";
}

/** The subset of card/user data injected into templates. */
export type TavernImageTemplateContext = TavernMacroContext & { appearance?: string };

function section(label: string, value: string | undefined): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? `${label}：${text.slice(0, 300)}` : "";
}

/**
 * Compose the final provider prompt around the base scene prompt.
 * Negative prompts are appended as an explicit avoid-list because the site's
 * image channel does not take a separate negative-prompt parameter.
 */
export function composeTavernImagePrompt(input: {
  base: string;
  generation: TavernImageGeneration;
  context: TavernImageTemplateContext;
  styleId?: string;
}): { prompt: string; size: TavernImageSize; macroWarnings: string[] } {
  const generation = input.generation;
  const context = input.context;
  const expand = (text: string) => {
    if (!text) return "";
    const result = expandTavernMacros(text, context);
    return result.text;
  };
  const unknown = new Set<string>();
  const expandTracked = (text: string) => {
    if (!text) return "";
    const result = expandTavernMacros(text, context);
    for (const token of result.unknown) unknown.add(token);
    return result.text;
  };
  void expand;
  const prefix = expandTracked(generation.promptPrefix);
  const main = expandTracked(generation.mainPrompt);
  const character = generation.injectCharacter ? [
    section("角色", context.characterName),
    section("外貌", context.appearance),
    section("性格", context.personality),
    section("设定", context.description),
  ].filter(Boolean).join("；") : "";
  const scenario = generation.injectScenario ? section("场景设定", context.scenario) : "";
  const parts = [prefix, main, character, scenario, input.base.trim()].filter(Boolean);
  let prompt = parts.join("，").replace(/[，,]{2,}/g, "，").replace(/^[，,]+|[，,]+$/g, "").trim();
  const negative = expandTracked(generation.negativePrompt);
  if (negative) prompt = `${prompt}；避免出现：${negative}`;
  const limit = TAVERN_IMAGE_GENERATION_LIMITS.prompt;
  const chars = Array.from(prompt);
  if (chars.length > limit) prompt = chars.slice(0, limit).join("").replace(/[\ud800-\udbff]$/u, "");
  return { prompt, size: parseTavernImageSize(generation.size), macroWarnings: [...unknown] };
}

/** Kept for the settings UI: is this style id still valid? */
export function normalizeTavernImageStyleId(value: unknown): string | undefined {
  return parseTavernImagePresetId(value);
}
