export type XumengGeneratedVideoCharacter = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  tags: string[];
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

export async function generateXumengVideoCharacter(input: { dramaId: string; title: string; synopsis: string; tags: string[]; category: string }, signal?: AbortSignal): Promise<{ card: XumengGeneratedVideoCharacter; official: boolean }> {
  const response = await fetch("/api/xumeng/video-character", {
    method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as { card?: unknown; error?: string; official?: unknown } | null;
  if (!response.ok) throw new Error(payload?.error || "AI 角色卡生成失败，请稍后再试。");
  const card = payload?.card;
  if (!record(card) || !text(card.name, 40) || !text(card.description, 4000) || !text(card.firstMessage, 2000)) throw new Error("AI 返回的角色卡信息不完整，请重试。");
  return {
    official: payload?.official === true,
    card: {
      name: card.name, description: card.description,
      personality: typeof card.personality === "string" ? card.personality : "",
      scenario: typeof card.scenario === "string" ? card.scenario : "",
      firstMessage: card.firstMessage,
      tags: Array.isArray(card.tags) ? card.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6) : [],
    },
  };
}
