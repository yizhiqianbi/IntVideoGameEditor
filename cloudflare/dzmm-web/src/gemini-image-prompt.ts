const PLACEHOLDER = "根据图片生成提示词";
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;
const DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

export interface GeminiPromptEnv {
  DZMM_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DZMM_BASE_URL?: string;
  OPENROUTER_BASE_URL?: string;
  GEMINI_PROMPT_MODEL?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

function endpoint(env: GeminiPromptEnv): { url: string; key: string; model: string } | null {
  const key = text(env.OPENROUTER_API_KEY) || text(env.DZMM_API_KEY);
  const model = text(env.GEMINI_PROMPT_MODEL) || "google/gemini-3.8-flash";
  if (key.length < 20 || !MODEL.test(model)) return null;
  let root: URL;
  try { root = new URL(text(env.OPENROUTER_BASE_URL) || text(env.DZMM_BASE_URL) || "https://openrouter.ai/api/v1"); }
  catch { return null; }
  if (root.protocol !== "https:" || root.hostname !== "openrouter.ai") return null;
  return { url: `${root.href.replace(/\/+$/, "")}/chat/completions`, key, model };
}

function instruction(prompt: string): string {
  const note = prompt === PLACEHOLDER ? "" : prompt.slice(0, 1000);
  return [
    "根据这张参考图，写一段可以直接用于出图或图生视频的中文提示词。",
    "写清主体、外观、姿态、场景、光线和镜头。只输出提示词本身，不要解释。",
    note ? `用户补充：${note}` : "",
  ].filter(Boolean).join("\n");
}

function messageText(payload: unknown): string {
  const choice = payload && typeof payload === "object"
    ? (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
    : "";
  const raw = typeof choice === "string"
    ? choice
    : Array.isArray(choice)
      ? choice.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("")
      : "";
  return raw.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function failureText(status: number, empty: boolean): string {
  if (status === 401 || status === 403) return "识图服务鉴权失败。";
  if (status === 402) return "识图服务额度不足。";
  if (status === 429) return "识图服务暂时繁忙。";
  if (status === 400 || status === 404 || status === 422) return "识图模型没有接受这次请求。";
  return empty ? "提示词没有写完。" : "识图服务暂时连不上。";
}

function jsonResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function writeGeminiImagePrompt(env: GeminiPromptEnv, prompt: string, image: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const picture = image.trim();
  if (!DATA_URL.test(picture) || picture.length > 12_000_000) return jsonResponse("请先连接一张图片。", 400);
  const upstream = endpoint(env);
  if (!upstream) return jsonResponse("识图服务还没接上。", 503);
  let response: Response;
  try {
    response = await fetchImpl(upstream.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstream.key}`,
        "X-Title": "Xumeng canvas prompt",
      },
      body: JSON.stringify({
        model: upstream.model,
        temperature: 0.4,
        max_tokens: 800,
        reasoning: { effort: "low" },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: instruction(text(prompt)) },
            { type: "image_url", image_url: { url: picture } },
          ],
        }],
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return jsonResponse("识图服务暂时连不上。", 503);
  }
  if (response.status >= 300 && response.status < 400) return jsonResponse("识图服务暂时连不上。", 503);
  const payload = await response.json().catch(() => null);
  const written = messageText(payload);
  if (!response.ok || !written) return jsonResponse(failureText(response.status, !written), response.status === 429 ? 429 : 502);
  return new Response(JSON.stringify({ text: written }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
