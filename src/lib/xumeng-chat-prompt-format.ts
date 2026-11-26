/** Prompt shape for a chat still or clip, chosen by the model that will render it.
 * Add a record here when a new model is wired up, and pass that same model id
 * from the call site. An unknown model is not rewritten with another model's format.
 */

export const CHAT_STILL_MODEL = "seedream-5-0-flash-NSFW";
/** One reference image is the frame at 0.00s, so the H3 skill mode is I2VA. */
export const CHAT_CLIP_MODEL = "minimax-h3-i2va";

export const H3_I2VA_FIRST_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

const SEEDREAM_CHAT_SYSTEM = [
  "你是 Seedream 的摄影导演与提示词编辑。下游模型是 seedream-5-0-flash，会另外收到参考图。参考图按传入顺序使用，提示词第一句必须明确指向第一张参考图里的角色。",
  "只输出一条提示词。用这一条回复的语言。写成一段自然流畅的画面描述，不要分行，不要编号，不要解释，不要用引号包住整段。",
  "第一句写第一张参考图的角色：保持第一张参考图中人物的脸部特征、发型与原有画风媒介不变。不要重描五官，不要另起冲突画风。",
  "若输入提供了前情上下文或角色固有外貌，只用来延续此刻所在地点、时间光线与尚未脱换的衣着，绝对不要把前情里已经结束的旧动作画进当前帧。",
  "正文聚焦这一条回复里此刻定格的瞬间，按自然语序写清衣着状态与材质、人物姿态动作与身体接触（已写明的成人向接触直接如实描写，未写的不要自行臆造）、微表情与视线方向、所处具体环境与前景道具。",
  "自然融入一条电影摄影级导演指令：明确景别（特写、近景、半身、中景或全身）与机位角度（微俯、平视、侧逆光或过肩），写清主光源方向、冷暖色温氛围与前后景虚实景深，避免平光正脸证件照。",
  "说出来的话不要写进画面。只有印在物体上的文字才加引号，并写它的位置。",
  "不要写 8K、masterpiece、best quality，也不要写一长串不要什么。",
].join("");

const H3_I2VA_CHAT_SYSTEM = [
  "你是 MiniMax H3 的 I2VA 提示词编辑。下游是 5 秒图生视频。参考图是 0.00 秒的第一帧（可能是角色封面或本轮已生成的剧情画面），会另外传入。",
  "只输出下面的结构，不要解释。画面用英文写。对白保留原句和原语言。",
  `第一行必须是：${H3_I2VA_FIRST_LINE}`,
  "空一行后，按这个顺序写三个字段：",
  "integrated_multimodal_description: [Shot 1] 从 <Picture 1> 里的人物、衣着、场景光线和构图自然承接，脸部与画风保持不变。若提供了前情上下文，仅用于延续氛围与未更换的衣着。聚焦这一条回复里已经发生的一个连贯动作：起始姿态，中间带细微神态、呼吸与衣料晃动的变化过程，结束姿态。写清一个景别和一种平滑电影运镜，写成英文，例如 The camera slowly pushes in 或 The camera holds a steady medium close-up。不要写 [Shot 2]。有对白就写 (S1) says: <d>[Chinese] 原句</d>，原句一字不改。没有对白就不要写 <d>。不要描写五官。",
  "overall_soundscape: 一到两句英文，只写听得见的环境声、衣料摩擦与动作声。不要把对白再写一遍。没有声音就写 N/A。",
  "non_diegetic_music: 没有配乐就写 N/A。",
  "没有的动作不要补。已经写明的身体接触用直接说法。动作要能在 5 秒里完整自然做完。",
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
  const cleaned = stripped(raw).replace(/\s*\n+\s*/g, " ").replace(/[ \t]+/g, " ").trim();
  if (cleaned.length < 5) return null;
  if (/主体：|动作：|身体：|integrated_multimodal_description|8K|masterpiece|best quality/i.test(cleaned)) return null;
  const anchored = /参考图|reference image/i.test(cleaned)
    ? cleaned
    : (/\p{Script=Han}/u.test(cleaned)
      ? `保持第一张参考图中的角色脸部、发型与画面风格不变，${cleaned}`
      : `Keep the face, hairstyle, and visual style of the character in the first reference image unchanged, ${cleaned}`);
  return anchored.slice(0, 800);
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
