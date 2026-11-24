const MINOR_SCENE = /校服|小学生|中学生|高中生|初中生|幼女|幼男|萝莉|正太|未成年|儿童|underage|\bloli\b|\bshota\b/i;
const INSTRUCTION = /忽略之前|系统提示|提示词|\bignore previous\b|\bsystem prompt\b/i;
const PREFIX = "第一人称主观视角，镜头就是你的眼睛。参考图一中的角色看着你，脸、发型和肤色保持不变。不要画出你的脸。衣着和身体按当下状态直接画。这一刻：";
const SUFFIX = "。无文字、无水印、无未成年人、无幼态面孔、无校服。";

/** Scene text for a girlfriend still. Identity stays on the reference photo. */
export function companionStillPrompt(scene: string): string | null {
  const cleaned = scene.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (MINOR_SCENE.test(cleaned)) return null;
  const kept = cleaned.split(/(?<=[。！？.!?])\s*/u).map(part => part.trim()).filter(part => part && !INSTRUCTION.test(part)).join("");
  const moment = kept || "她看着镜头，室内暖光";
  const budget = 800 - Array.from(PREFIX + SUFFIX).length;
  return PREFIX + Array.from(moment).slice(0, Math.max(0, budget)).join("").replace(/[\ud800-\udbff]$/, "") + SUFFIX;
}
