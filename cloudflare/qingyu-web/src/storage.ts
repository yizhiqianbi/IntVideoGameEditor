import { characters, getCharacter, type Conversation, type CustomCharacter } from "./catalog";
import { hasBlockedContent } from "./safety";
export const STORAGE_KEY = "qingyu:journey:v1";
export interface Journey { version: 1; favorites: string[]; conversations: Conversation[]; custom: CustomCharacter[]; activeConversationId?: string }
export const emptyJourney = (): Journey => ({ version: 1, favorites: [], conversations: [], custom: [] });
export function parseJourney(raw: string | null): Journey {
  if (!raw) return emptyJourney();
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.favorites) || !Array.isArray(data.conversations) || !Array.isArray(data.custom)) throw new Error("旅程数据格式不正确");
  const custom = data.custom.filter((c: CustomCharacter) => c && typeof c.id === "string" && /^custom-[\w-]{1,80}$/.test(c.id) && getCharacter(c.baseId) && typeof c.name === "string" && c.name.length <= 16 && typeof c.description === "string" && c.description.length <= 600 && !hasBlockedContent(c.name + c.description) && Number.isFinite(c.createdAt)).slice(0, 40);
  const conversations = data.conversations.filter((c: Conversation) => c && typeof c.id === "string" && c.id.length < 100 && getCharacter(c.characterId) && ["demo", "live"].includes(c.mode) && Number.isFinite(c.updatedAt) && typeof c.node === "string" && getCharacter(c.characterId)?.scenes[c.node] && (!c.customId || custom.some((d: CustomCharacter) => d.id === c.customId)) && Array.isArray(c.messages) && c.messages.every(m => m && ["user", "assistant"].includes(m.role) && typeof m.id === "string" && typeof m.content === "string" && m.content.length <= 4000 && !hasBlockedContent(m.content))).slice(0, 80).map((c: Conversation) => ({ ...c, messages: c.messages.slice(-80) }));
  return { version: 1, favorites: data.favorites.filter((id: unknown) => typeof id === "string" && characters.some(c => c.id === id)), conversations, custom, activeConversationId: conversations.some((c: Conversation) => c.id === data.activeConversationId) ? data.activeConversationId : undefined };
}
