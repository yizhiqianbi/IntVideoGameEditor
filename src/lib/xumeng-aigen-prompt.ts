/** Image-prompt rewrite for the in-app AI 生图 form.
 * The button, request, and five-line result follow the Vercel image studio.
 * The call uses the site's existing OpenRouter text model when that key is set,
 * and the Vercel Sealion editor only when OpenRouter is not configured.
 */

import { chatPromptFormat } from "./xumeng-chat-prompt-format.ts";
import { GROK_PROMPT_MODEL } from "./xumeng-grok-image-prompt.ts";

const SEALION_HOST = "open-sealion.aiaigirl.com";
const SEALION_MODEL = "sealion-nova-pro";
const OPENROUTER_HOST = "openrouter.ai";

const BLOCKED = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;

export const AIGEN_IMAGE_OPTIMIZE_SYSTEM = [
  "你是生图提示词编辑。把用户的想法写成一条中文画面描述，让生图模型能按句执行。",
  "只输出提示词，不要解释，不要加引号。",
  "固定用这五行，每行一句：",
  "主体：画面里的人或物。人物必须是虚构的成年人，二十一岁以上，写清性别、体态和衣着。",
  "动作：按成人向写正在发生的身体接触。亲吻、抚摸、脱衣、体位和抽插用直接说法，不要改成隐喻。",
  "身体：只写画面里在场的人的性器官。只有女性时写阴唇、阴道、乳房、乳头、臀部和肛门，不要写阴茎、阴囊、阴蒂。只有男性时写阴茎、阴囊、臀部和肛门。男女都在才写双方接触到的器官，仍然不要写阴蒂。",
  "画面：构图、景别和背景。清晰，不要马赛克。",
  "光线：光线和质感。",
  "保留用户指定的主体和动作，把句子补成成人向细节。",
  "不要写未成年、幼态、校服、学生、真实人物或明星。",
  "总长度不超过600个字。",
].join("");

export const AIGEN_VIDEO_OPTIMIZE_SYSTEM = [
  "你是图生视频提示词编辑。把用户的想法改成一条中文分镜，让视频模型能按句执行。",
  "只输出提示词，不要解释，不要加引号。",
  "固定用这六行，每行一句：",
  "人物：虚构的成年角色，写明二十一岁以上、性别、体态，以及身上还穿着或已经脱掉的衣服。",
  "动作：按时间写身体动作。成人之间的亲吻、抚摸、脱衣、体位、抽插和节奏要写具体，不要改成隐喻。",
  "身体：只写画面里在场的人的性器官。只有女性时写阴唇、阴道、乳房、乳头、臀部和肛门，不要写阴茎、阴囊，也不要写阴蒂。只有男性时写阴茎、阴囊、臀部和肛门。男女都在才按接触写出双方的器官，仍然不要写阴蒂。写清状态和接触，不要用「那里」「下面」代替，也不要打码。",
  "镜头：景别、机位和运动。",
  "场景：地点和光线。",
  "声音：环境声、衣料、呼吸和身体接触的声音。",
  "画面：清晰，不要马赛克。",
  "保留用户指定的人物关系和动作，只把句子补细。",
  "不要写未成年、幼态、校服、学生、真实人物或明星。",
  "总长度不超过600个字。",
].join("");

export type AigenPromptKind = "image" | "video";

export type AigenPromptEnv = {
  GENERATION_OPENROUTER_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  SEALION_API_KEY?: string;
  SEALION_BASE_URL?: string;
};

export type AigenPromptResult =
  | { ok: true; prompt: string }
  | { ok: false; error: string; status: number };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lockedChatUrl(baseUrl: string, host: string): string | null {
  let endpoint: URL;
  try { endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`); }
  catch { return null; }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== host || endpoint.username || endpoint.password) return null;
  return endpoint.toString();
}

export function aigenImagePromptSource(value: string): string {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
}

export function cleanAigenImagePrompt(value: string): string {
  return String(value || "")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^["“]|["”]$/g, "")
    .split("\n")
    .map(line => line.replace(/[\u0000-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 800);
}

function replyText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (!part || typeof part !== "object") return "";
    const piece = (part as { text?: unknown }).text;
    return typeof piece === "string" ? piece : "";
  }).join("").trim();
}

/** OpenRouter Grok first, because that is the text model already used to rewrite image prompts. */
export function aigenImagePromptEndpoint(env: AigenPromptEnv): { url: string; key: string; model: string } | { error: string } | null {
  const openrouterKey = text(env.GENERATION_OPENROUTER_API_KEY) || text(env.OPENROUTER_API_KEY);
  if (openrouterKey.length >= 20) {
    const url = lockedChatUrl(text(env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1", OPENROUTER_HOST);
    return url ? { url, key: openrouterKey, model: GROK_PROMPT_MODEL } : { error: "提示词优化地址无效。" };
  }
  const sealionKey = text(env.SEALION_API_KEY);
  if (sealionKey.length >= 20) {
    const url = lockedChatUrl(text(env.SEALION_BASE_URL) || `https://${SEALION_HOST}/v1`, SEALION_HOST);
    return url ? { url, key: sealionKey, model: SEALION_MODEL } : { error: "提示词优化地址无效。" };
  }
  return null;
}

export function omitAbsentVideoOrgans(prompt: string, source: string): string {
  const cast = `${source}\n${String(prompt || "").replace(/阴茎|阴囊|阴唇|阴道|阴蒂|乳房|乳头/g, "")}`;
  const male = /男|他|丈夫|男友|男人/.test(cast);
  const female = /女|她|妻子|女友|女人/.test(cast);
  let next = String(prompt || "");
  if (female && !male) next = next.replace(/阴茎|阴囊/g, "");
  if (male && !female) next = next.replace(/阴唇|阴道|乳房|乳头/g, "");
  next = next.replace(/阴蒂/g, "");
  return next
    .replace(/[，、]{2,}/g, "，")
    .replace(/，([。\n])/g, "$1")
    .replace(/：，/g, "：")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function withNoMosaic(prompt: string): string {
  if (!prompt || prompt.includes("不要马赛克")) return prompt;
  return `${prompt}\n画面：清晰，不要马赛克。`.slice(0, 800);
}

export async function optimizeAigenPrompt(textValue: string, env: AigenPromptEnv, kind: AigenPromptKind = "image", fetchImpl: typeof fetch = fetch): Promise<AigenPromptResult> {
  const source = aigenImagePromptSource(textValue);
  if (BLOCKED.test(source)) return { ok: false, error: "不能优化这段描述。", status: 400 };
  const endpoint = aigenImagePromptEndpoint(env);
  if (!endpoint) return { ok: false, error: "提示词优化还没配上。", status: 503 };
  if ("error" in endpoint) return { ok: false, error: endpoint.error, status: 503 };
  let response: Response;
  try {
    response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.key}` },
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: 700,
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: kind === "video" ? AIGEN_VIDEO_OPTIMIZE_SYSTEM : AIGEN_IMAGE_OPTIMIZE_SYSTEM },
          { role: "user", content: source ? `用户原句：${source}` : (kind === "video" ? "用户还没有写内容。写一条虚构的成年人性爱镜头，地点在室内。" : "用户还没有写画面。写一张虚构的二十一岁以上成年人的画面。") },
        ],
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return { ok: false, error: "提示词没有优化完。", status: 502 };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, error: "提示词没有优化完。", status: 502 };
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: "提示词没有优化完。", status: 502 };
  const cleaned = cleanAigenImagePrompt(replyText(payload));
  const prompt = (kind === "video" ? withNoMosaic(omitAbsentVideoOrgans(cleaned, source)) : cleaned).slice(0, 800);
  if (prompt.length < 5 || BLOCKED.test(prompt)) return { ok: false, error: "提示词没有优化完。", status: 502 };
  return { ok: true, prompt };
}

export async function optimizeAigenImagePrompt(textValue: string, env: AigenPromptEnv, fetchImpl: typeof fetch = fetch): Promise<AigenPromptResult> {
  return optimizeAigenPrompt(textValue, env, "image", fetchImpl);
}

export function chatScenePromptSource(value: string): string {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

export type ChatScenePromptContext = {
  recentContext?: string;
  appearance?: string;
  scenario?: string;
};

function clipSceneMeta(value: string | undefined, max: number): string {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Rewrite the current reply into the prompt format of the model that will render it. */
export async function refineChatScenePrompt(
  textValue: string,
  model: string,
  env: AigenPromptEnv,
  fetchImpl: typeof fetch = fetch,
  context?: ChatScenePromptContext,
): Promise<AigenPromptResult> {
  const format = chatPromptFormat(model);
  if (!format) return { ok: false, error: "这个模型还没有对应的提示词格式。", status: 400 };
  const source = chatScenePromptSource(textValue);
  if (!source) return { ok: false, error: "这一段没有可整理的画面。", status: 400 };
  if (BLOCKED.test(source)) return { ok: false, error: "这一段不能生成。", status: 400 };
  const endpoint = aigenImagePromptEndpoint(env);
  if (!endpoint) return { ok: false, error: "提示词优化还没配上。", status: 503 };
  if ("error" in endpoint) return { ok: false, error: endpoint.error, status: 503 };
  const appearance = clipSceneMeta(context?.appearance, 220);
  const scenario = clipSceneMeta(context?.scenario, 240);
  const recent = clipSceneMeta(context?.recentContext, 680);
  const sections: string[] = [];
  if (appearance && !BLOCKED.test(appearance)) sections.push(`角色固有外貌与穿搭参考（仅在本轮未说明衣着时沿用）：${appearance}`);
  if (scenario && !BLOCKED.test(scenario)) sections.push(`世界与场景背景：${scenario}`);
  if (recent && !BLOCKED.test(recent)) sections.push(`前情上下文（仅用于延续地点、时间光线与未脱换的衣着，不要把旧动作画进当前帧）：${recent}`);
  sections.push(`这一条回复：${source}`);
  let response: Response;
  try {
    response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.key}` },
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: format.maxTokens,
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: format.system },
          { role: "user", content: sections.join("\n") },
        ],
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return { ok: false, error: "这一幕的提示词没有整理完。", status: 502 };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, error: "这一幕的提示词没有整理完。", status: 502 };
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: "这一幕的提示词没有整理完。", status: 502 };
  const prompt = format.finish(replyText(payload));
  if (!prompt || BLOCKED.test(prompt)) return { ok: false, error: "这一幕的提示词没有整理完。", status: 502 };
  return { ok: true, prompt };
}
