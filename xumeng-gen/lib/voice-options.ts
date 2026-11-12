export const PRESET_VOICES = ["中文女", "中文男", "日语男", "粤语女", "英文女", "英文男", "韩语女"] as const;

export function voiceChoice(value: string): boolean {
  return /^[\u4e00-\u9fffA-Za-z0-9]{2,16}$/.test(value) && !value.startsWith("c_");
}

export function orderVoices(names: readonly string[]): string[] {
  const allowed = new Set(names.filter(voiceChoice));
  const preferred = PRESET_VOICES.filter(name => allowed.has(name));
  const rest = [...allowed].filter(name => !preferred.some(item => item === name) && /^[\u4e00-\u9fff]{2,8}$/.test(name)).sort((left, right) => left.localeCompare(right, "zh"));
  const voices = [...preferred, ...rest];
  return voices.length ? voices : [...PRESET_VOICES];
}
