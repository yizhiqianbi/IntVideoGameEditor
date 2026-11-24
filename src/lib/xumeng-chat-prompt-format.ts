/** Prompt shape for a chat still or clip, chosen by the model that will render it.
 * Add a record here when a new model is wired up, and pass that same model id
 * from the call site. An unknown model is not rewritten with another model's format.
 */

export const CHAT_STILL_MODEL = "seedream-5-0-flash-NSFW";
/** One reference image is the frame at 0.00s, so the H3 skill mode is I2VA. */
export const CHAT_CLIP_MODEL = "minimax-h3-i2va";

export const H3_I2VA_FIRST_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

const SEEDREAM_CHAT_SYSTEM = [
  "你是 Seedream 的提示词编辑。下游模型是 seedream-5-0-flash，会另外收到参考图。参考图按传入顺序使用，提示词要写明第一张的角色。",
  "只输出一条提示词。用这一条回复的语言。写成一段话，不要分行，不要编号，不要解释，不要用引号包住整段。",
  "第一句写第一张参考图的角色：它负责这个人的脸、发型和画面里已经有的风格，这些保持不变。不要描写五官，不要另写画风或媒介。",
  "后面只写这一条回复里此刻看得见的衣着、姿势、动作、接触、表情和地点。没有写到的衣着、动作、地点和性行为不要补。已经写明的身体接触用直接说法。",
  "说出来的话不要写进画面。只有印在物体上的文字才加引号，并写它的位置。",
  "不要写 8K、masterpiece、best quality，也不要写一串不要什么。",
].join("");

const H3_I2VA_CHAT_SYSTEM = [
  "你是 MiniMax H3 的 I2VA 提示词编辑。下游是 5 秒图生视频。参考图是 0.00 秒的第一帧，会另外传入。",
  "只输出下面的结构，不要解释。画面用英文写。对白保留原句和原语言。",
  `第一行必须是：${H3_I2VA_FIRST_LINE}`,
  "空一行后，按这个顺序写三个字段：",
  "integrated_multimodal_description: [Shot 1] 从 <Picture 1> 里的人、衣着和构图开始，脸和画面风格保持不变。只接这一条回复里已经发生的一个连续动作：起始姿势，中间一次动作，结束姿势。一个景别，一种运镜，写成英文，例如 The camera holds a static shot。不要写 [Shot 2]。有对白就写 (S1) says: <d>[Chinese] 原句</d>，原句一字不改。没有对白就不要写 <d>。不要描写五官。",
  "overall_soundscape: 一到两句英文，只写听得见的环境声和动作声。不要把对白再写一遍。没有声音就写 N/A。",
  "non_diegetic_music: 没有配乐就写 N/A。",
  "没有的动作不要补。已经写明的身体接触用直接说法。动作要能在 5 秒里做完。",
].join("");

export type ChatPromptFormat = {
  model: string;
  system: string;
  maxChars: number;
  maxTokens: number;
  finish: (raw: string) => string | null;
};

function stripped(value: string): string {
  return String(value || "")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^(prompt|提示词)\s*[:：]\s*/i, "")
    .split("\n")
    .map(line => line.replace(/[\u0000-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .trim();
}

function finishSeedream(raw: string): string | null {
  const prompt = stripped(raw).replace(/\s*\n+\s*/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, 800);
  if (prompt.length < 5) return null;
  if (/主体：|动作：|身体：|integrated_multimodal_description|8K|masterpiece|best quality/i.test(prompt)) return null;
  if (!/参考图|reference image/i.test(prompt)) return null;
  return prompt;
}

function finishH3I2va(raw: string): string | null {
  const prompt = stripped(raw).slice(0, 1600);
  const lines = prompt.split("\n").map(line => line.trim()).filter(Boolean);
  if (lines[0] !== H3_I2VA_FIRST_LINE) return null;
  const description = prompt.indexOf("integrated_multimodal_description:");
  const sound = prompt.indexOf("overall_soundscape:");
  const music = prompt.indexOf("non_diegetic_music:");
  if (description < 0 || sound <= description || music <= sound) return null;
  if (/\[Shot 2\]/.test(prompt)) return null;
  return prompt;
}

const FORMATS: Record<string, ChatPromptFormat> = {
  [CHAT_STILL_MODEL]: {
    model: CHAT_STILL_MODEL,
    system: SEEDREAM_CHAT_SYSTEM,
    maxChars: 800,
    maxTokens: 500,
    finish: finishSeedream,
  },
  [CHAT_CLIP_MODEL]: {
    model: CHAT_CLIP_MODEL,
    system: H3_I2VA_CHAT_SYSTEM,
    maxChars: 1600,
    maxTokens: 900,
    finish: finishH3I2va,
  },
};

export function chatPromptFormat(model: string): ChatPromptFormat | null {
  return FORMATS[model] ?? null;
}
