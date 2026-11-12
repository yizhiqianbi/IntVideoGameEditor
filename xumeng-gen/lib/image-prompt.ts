const MODEL = "sealion-nova-pro";
const TRANSLATE = "把用户的中文原句译成英文，意思保持不变。只输出译文，不要解释。";
const ENGINEER = "你是文生图提示词工程师。用户原句决定画面，英文译文只帮助理解。写一条给写实模型用的英文提示词：先写用户要求的主体、姿势、表情、服装和风格，再补镜头、光线和清晰度。不要改成另一张无关肖像。角色是虚构的成年人，二十一岁以上。不要加入未成年、幼态、校服或真实人物，也不要写出 child、teen、loli、real person、real photo。只输出最终提示词。";

function replyText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choice = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choice) || !choice[0] || typeof choice[0] !== "object") return "";
  const message = (choice[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }).join("").trim();
}

function cleanPrompt(value: string): string {
  return value
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(prompt|english prompt)\s*[:：]\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

async function complete(system: string, user: string, failure: string): Promise<string> {
  const apiKey = process.env.SEALION_API_KEY?.trim() ?? "";
  const baseUrl = (process.env.SEALION_BASE_URL?.trim() || "https://open-sealion.aiaigirl.com/v1").replace(/\/+$/, "");
  if (!apiKey) throw new Error("画面翻译还没配上。");
  let endpoint: URL;
  try { endpoint = new URL(`${baseUrl}/chat/completions`); } catch { throw new Error("画面翻译地址无效。"); }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "open-sealion.aiaigirl.com") throw new Error("画面翻译地址无效。");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user.slice(0, 2500) },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new Error(failure);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(failure);
  const text = cleanPrompt(replyText(payload));
  if (!text) throw new Error(failure);
  return text;
}

export async function engineeredImagePrompt(prompt: string): Promise<string> {
  const source = prompt.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  const translated = await complete(TRANSLATE, source, "提示词翻译没有完成。");
  return complete(ENGINEER, `用户原句：${source}\n英文译文：${translated}`, "提示词设计没有完成。");
}
