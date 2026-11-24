/** Prompt rewrite for x-ai/grok-imagine-image-2.0.
 * Shape follows xAI's image prompting guide and the public scenario-grok-imagine-image skill:
 * one photograph in prose, subject first, positives instead of a negative list, quoted in-image text.
 */

export const GROK_IMAGE_MODEL = "x-ai/grok-imagine-image-2.0";
export const GROK_PROMPT_MODEL = "x-ai/grok-4.7";

const BLOCKED = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;

export const GROK_IMAGE_OPTIMIZE_SYSTEM = [
  "你是 Grok Imagine Image 2.0 的提示词编辑。下游模型是 grok-imagine-image-2.0，只吃一条画面描述。",
  "只输出这张照片的描述，不要解释，不要标题，不要用引号包住整段。",
  "写成一段自然语言，顺序固定：主体，细节和机位，色块与道具，光线，颜色，构图。不要写成编号清单。",
  "主体放在第一句：是什么、二十一岁以上的虚构成年人、正处于什么状态、在什么地方。",
  "细节要能指认：材质、数量、相机角度，每样只写一次。",
  "光线写光源、方向和软硬。颜色把主体和背景分开写。构图写裁切和哪里清晰。",
  "用户要求出现在画面里的文字，用引号保留原句，并在段末写没有其他文字。",
  "不要写 8K、masterpiece、best quality，也不要写一长串不要什么。想排除的东西改成画面里要看见的东西。",
  "成人之间的身体和动作，按用户原句写成看得见的事实，不要改成隐喻。用户没写的性行为不要自行加上。",
  "不要写未成年、幼态、校服、学生、真实人物或明星。",
  "如果这是在改一张已有的图，只写要改的部分，并写明姿势、背景和光线保持不变。",
  "用用户原来的语言。中文就写中文。整段不超过 180 个词。",
].join("");

export function grokImagePromptSource(value: string): string {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
}

export function grokImagePromptBlocked(value: string): boolean {
  return BLOCKED.test(value);
}

export function cleanGrokImagePrompt(value: string): string {
  return String(value || "")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^(prompt|提示词)\s*[:：]\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .split("\n")
    .map(line => line.replace(/[\u0000-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 800);
}

export function grokImageOptimizeMessages(text: string, edit = false): { system: string; user: string } | { error: string } {
  const source = grokImagePromptSource(text);
  if (source.length < 2) return { error: "先写一句再优化。" };
  if (grokImagePromptBlocked(source)) return { error: "不能优化这段描述。" };
  const user = edit
    ? `这是在修改一张已有的图。用户原句：${source}`
    : `这是一张新图。用户原句：${source}`;
  return { system: GROK_IMAGE_OPTIMIZE_SYSTEM, user };
}
