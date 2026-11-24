/**
 * SillyTavern-style image generation presets.
 *
 * A preset is a named prompt template: a style prefix, a suffix and a negative
 * list. Presets only shape the prompt for the existing image providers; no new
 * provider or billing path is introduced. Unknown ids fall back to the current
 * (unstyled) behaviour so old clients keep working.
 */

export type TavernImagePreset = {
  id: string;
  name: string;
  description: string;
  prefix: string;
  suffix: string;
  negative: string;
};

export const TAVERN_IMAGE_PRESETS: readonly TavernImagePreset[] = Object.freeze([
  { id: "xumeng", name: "叙梦写实", description: "跟着角色封面出图", prefix: "", suffix: "", negative: "" },
  { id: "cinematic", name: "电影剧照", description: "强影视光比、浅景深、胶片质感", prefix: "电影剧照质感，影视级布光，浅景深，35mm 胶片颗粒，", suffix: "，画面叙事感强，构图完整。", negative: "二次元，卡通，平涂，塑料皮肤，低清晰度" },
  { id: "anime", name: "二次元赛璐璐", description: "日系动画赛璐璐上色，线条干净", prefix: "日系动画赛璐璐风格，干净线稿，平涂上色，", suffix: "，色彩明亮，人物比例协调。", negative: "照片质感，写实皮肤，3D 渲染，脏污线稿" },
  { id: "watercolor", name: "水彩插画", description: "纸面水彩晕染，柔和边缘", prefix: "手绘水彩插画，纸面纹理，柔和晕染，", suffix: "，留白自然，笔触可见。", negative: "照片，3D 渲染，过度清晰，塑料感" },
  { id: "noir", name: "暗调胶片", description: "低调黑白/低饱和，硬光与阴影", prefix: "暗调胶片摄影，低调黑白偏冷，硬光与深阴影，", suffix: "，氛围压抑，细节保留。", negative: "高饱和，明亮糖果色，卡通，平光" },
]);

const PRESET_LIMIT = 40;
const PROMPT_LIMIT = 1400;

export function parseTavernImagePresetId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || id.length > PRESET_LIMIT || id.includes("\0")) return undefined;
  return TAVERN_IMAGE_PRESETS.some(preset => preset.id === id) ? id : undefined;
}

export function tavernImagePreset(id: string | undefined): TavernImagePreset | undefined {
  if (!id) return undefined;
  return TAVERN_IMAGE_PRESETS.find(preset => preset.id === id);
}

/** Compose the final prompt for a provider. Unknown/absent presets are no-ops. */
export function applyTavernImagePreset(prompt: string, presetId: string | undefined): string {
  const preset = tavernImagePreset(presetId);
  if (!preset || (!preset.prefix && !preset.suffix && !preset.negative) || !prompt.trim()) return prompt;
  const negative = preset.negative ? `；避免出现：${preset.negative}。` : "";
  const composed = `${preset.prefix}${prompt}${preset.suffix}${negative}`;
  const characters = Array.from(composed);
  if (characters.length <= PROMPT_LIMIT) return composed;
  // Never cut a surrogate pair in half when the prompt is clamped.
  return characters.slice(0, PROMPT_LIMIT).join("").replace(/[\ud800-\udbff]$/u, "");
}

/** Default preset id for new conversations. */
export const DEFAULT_TAVERN_IMAGE_PRESET = "xumeng";
