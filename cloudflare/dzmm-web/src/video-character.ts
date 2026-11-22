export interface VideoCharacterEnv {
  DZMM_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DZMM_BASE_URL?: string;
  OPENROUTER_BASE_URL?: string;
  DZMM_STORY_MODEL?: string;
  DZMM_MODEL?: string;
  VIDEO_CARD_MODEL?: string;
}

export type GeneratedVideoCharacter = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  tags: string[];
};

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/;
const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";

function endpoint(env: VideoCharacterEnv): { url: string; key: string; model: string } | null {
  const key = (env.OPENROUTER_API_KEY || env.DZMM_API_KEY || "").trim();
  const model = (env.VIDEO_CARD_MODEL || env.DZMM_STORY_MODEL || env.DZMM_MODEL || "").trim();
  if (key.length < 20 || !MODEL_NAME.test(model)) return null;
  let root: URL;
  try { root = new URL((env.OPENROUTER_BASE_URL || env.DZMM_BASE_URL || "https://openrouter.ai/api/v1").trim()); } catch { return null; }
  if (root.protocol !== "https:") return null;
  return { url: `${root.href.replace(/\/+$/, "")}/chat/completions`, key, model };
}

function systemPrompt(): string {
  return [
    "你是「叙梦」酒馆的角色卡作者。叙梦的角色卡不是自由系统提示，而是一张可直接开聊的卡：",
    "name（角色名）、description（外貌、身份、关系、世界观底色）、personality（行为逻辑、说话方式、欲望与边界）、scenario（与玩家相遇时的具体场景）、firstMessage（角色说的第一段话和动作，第二人称面对玩家）。",
    "根据用户给的短剧信息，写一张成年角色的卡。要求：",
    "1. 角色必须成年，关系与性张力可以成人向，但保持自愿、可拒绝、不写真实人物。",
    "2. description 要写具体身体特征、穿着、职业/身份和隐藏动机，不要只写形容词。",
    "3. personality 要写出角色会主动做什么、不会做什么、被拒绝时怎么反应。",
    "4. scenario 写一个具体的当下地点、时间、正在发生的事，让玩家一开口就能接。",
    "5. firstMessage 用第二人称「你」称呼玩家，包含角色的动作、台词和一句钩子，250-450 字。",
    "6. tags 给 4-6 个中文标签。",
    "只输出一个 JSON 对象，不要 Markdown，不要解释。字段名必须是 name、description、personality、scenario、firstMessage、tags。",
  ].join("\n");
}

function parseContent(payload: unknown): unknown {
  const choice = payload && typeof payload === "object" ? (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content : "";
  const raw = typeof choice === "string" ? choice : Array.isArray(choice) ? choice.map(part => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("") : "";
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

export async function generateVideoCharacter(env: VideoCharacterEnv, input: { title: string; synopsis: string; tags: string[]; category: string }): Promise<GeneratedVideoCharacter> {
  const target = endpoint(env);
  if (!target) throw new Error("AI 角色卡服务还没配置。");
  const context = [
    `短剧标题：${clean(input.title, 120)}`,
    `分类：${clean(input.category, 40) || "短剧"}`,
    `简介：${clean(input.synopsis, 1200) || "（无简介）"}`,
    `标签：${input.tags.map(tag => clean(tag, 30)).filter(Boolean).slice(0, 10).join("、") || "（无）"}`,
  ].join("\n");
  const response = await fetch(target.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: target.model,
      temperature: 0.82,
      max_tokens: 1800,
      messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: context }],
    }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "AI 角色卡服务暂时繁忙，请稍后再试。" : "AI 角色卡生成失败，请稍后再试。");
  const card = parseContent(await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!card) throw new Error("AI 没有返回可用的角色卡，请重试。");
  const name = clean(card.name, 40);
  const description = clean(card.description, 4000);
  const personality = clean(card.personality, 2000);
  const scenario = clean(card.scenario, 1200);
  const firstMessage = clean(card.firstMessage, 2000);
  const tags = Array.isArray(card.tags) ? card.tags.map(tag => clean(tag, 24)).filter(Boolean).slice(0, 6) : [];
  if (!name || !description || !firstMessage) throw new Error("AI 返回的角色卡信息不完整，请重试。");
  return { name, description, personality, scenario, firstMessage, tags: tags.length ? tags : ["短剧", "AI生成"] };
}
