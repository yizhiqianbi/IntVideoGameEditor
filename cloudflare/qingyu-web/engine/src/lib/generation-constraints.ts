const NEGATIVE_LIMIT = 1600;
const ALREADY_NEGATED =
  /^(无|不要|禁止|勿|非|no\s|not\s|without\s|don't\s|do not\s)/i;

export const ADULT_NEGATIVE_PROMPT =
  "无未成年人、无儿童、无青少年、无幼态面孔、无未成年体态、无校服";

export const ANATOMY_NEGATIVE_PROMPT =
  "无多余肢体、无缺失肢体、无重复手臂或腿、无多余手指、无手指粘连、无关节扭曲、无五官错位、无重复面孔、无异常身体比例、无蜡质皮肤、无塑料皮肤、无油腻高光、无美颜磨皮";

export const GENITAL_NEGATIVE_PROMPT =
  "无畸形生殖器、无多余性器官、无错位阴茎、无错位阴道、无儿童性征、无解剖错误的性器官";

export const SOUND_NEGATIVE_PROMPT =
  "无字幕、无口型错位、无机械配音、无多余说话人、无突然出现的背景音乐、无含糊对白";

export const HUMAN_NEGATIVE_PROMPT = [
  ANATOMY_NEGATIVE_PROMPT,
  GENITAL_NEGATIVE_PROMPT,
  "无无意重复人物、无文字水印",
  ADULT_NEGATIVE_PROMPT,
].join("、");

export const SCENE_NEGATIVE_PROMPT = [
  "无扭曲建筑、无错误透视、无重复物体、无拼接痕迹、无杂乱伪影、无文字水印",
  ADULT_NEGATIVE_PROMPT,
].join("、");

export const VIDEO_NEGATIVE_PROMPT = [
  "无身份或面容突变、无肢体畸形、无手指粘连、无服装无故变化、无画面闪烁、无动作跳变、无物体瞬移",
  "无油腻皮肤、无塑料感、无美颜磨皮",
  ANATOMY_NEGATIVE_PROMPT,
  GENITAL_NEGATIVE_PROMPT,
  SOUND_NEGATIVE_PROMPT,
  "无文字水印",
  ADULT_NEGATIVE_PROMPT,
].join("、");

export function defaultAssetNegative(kind: "reference" | "scene") {
  return kind === "scene" ? SCENE_NEGATIVE_PROMPT : HUMAN_NEGATIVE_PROMPT;
}

const CANNED_NEGATIVES = new Set([
  VIDEO_NEGATIVE_PROMPT,
  HUMAN_NEGATIVE_PROMPT,
  SCENE_NEGATIVE_PROMPT,
]);

export function isCannedNegative(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (CANNED_NEGATIVES.has(text)) return true;
  const compact = text.replace(/无/g, "").replace(/no\s+/gi, "").replace(/\s+/g, "");
  const marks = ["手指粘连", "未成年人", "面容突变", "五官错位", "蜡质皮肤", "校服"];
  return marks.filter((mark) => compact.includes(mark)).length >= 3;
}

export function userNegativePrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && !isCannedNegative(text) ? text : "";
}

export function formatNegativeClause(clause: string) {
  const text = clause.trim().replace(/^[,，、;；]+|[,，、;；]+$/g, "");
  if (!text) return "";
  if (ALREADY_NEGATED.test(text)) return text;
  return /^[a-z0-9]/i.test(text) ? `no ${text}` : `无${text}`;
}

export function formatNegativePrompt(raw: string) {
  return raw
    .split(/[,，、;；\n]+/)
    .map(formatNegativeClause)
    .filter(Boolean)
    .join("、");
}

export function withNegativePrompt(prompt: string, negative: unknown): string {
  if (negative === undefined || negative === "") return prompt;
  if (typeof negative !== "string" || negative.length > NEGATIVE_LIMIT)
    throw new Error(`负面提示词须为不超过 ${NEGATIVE_LIMIT} 字的文本。`);
  const text = formatNegativePrompt(negative.trim());
  return text ? `${prompt}\n\n负面：${text}` : prompt;
}
