import { ApiError } from "./http";
import { OPENROUTER_ORIGIN, type GenerationFetch } from "./generation-provider";
import { cleanGrokImagePrompt, grokImageOptimizeMessages, grokImagePromptBlocked, GROK_PROMPT_MODEL } from "../../../src/lib/xumeng-grok-image-prompt";

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
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }).join("").trim();
}

export async function optimizeGrokImagePrompt(text: string, edit: boolean, key: string, fetcher: GenerationFetch = fetch): Promise<string> {
  const messages = grokImageOptimizeMessages(text, edit);
  if ("error" in messages) throw new ApiError(400, messages.error);
  let response: Response;
  try {
    response = await fetcher(`${OPENROUTER_ORIGIN}/api/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROK_PROMPT_MODEL,
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new ApiError(502, "提示词没有优化完。");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(502, "提示词没有优化完。");
  const prompt = cleanGrokImagePrompt(replyText(payload));
  if (prompt.length < 5 || grokImagePromptBlocked(prompt)) throw new ApiError(502, "提示词没有优化完。");
  return prompt;
}
