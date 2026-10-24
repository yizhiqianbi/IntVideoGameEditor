import { parseCharacterImport, type Character } from "./dzmm-characters";
import { parseDzmmConversationOpening, resolveDzmmConversationOpening } from "./dzmm-conversation-context";
import { rebindDzmmWorldJournal } from "./dzmm-world-client";
import { createDzmmStoryMemory, matchesDzmmStoryMemory, parseStoryMemory } from "./dzmm-story-memory";
import type { DzmmSavedConversation, DzmmSavedMessage } from "./dzmm-storage";

export const DZMM_CONVERSATION_BACKUP_MAX_BYTES = 2_000_000;

/** A backup restores all original messages; file size, rather than turn count, bounds imports. */
export function parseDzmmConversationBackup(raw: string, options: { createId?: () => string; now?: number } = {}): {
  character: Character; conversation: DzmmSavedConversation;
} {
  if (new TextEncoder().encode(raw).byteLength > DZMM_CONVERSATION_BACKUP_MAX_BYTES) {
    throw new Error("会话文件不能超过 2 MB。");
  }
  const imported = JSON.parse(raw);
  if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("会话格式无效。");
  const character = parseCharacterImport(imported.character);
  if (!Array.isArray(imported.messages) || !imported.messages.every((message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    const item = message as Record<string, unknown>;
    return (item.role === "assistant" || item.role === "user") && typeof item.content === "string"
      && item.content.trim().length > 0 && !item.content.includes("\0") && item.content.length <= 12000;
  })) throw new Error("会话格式无效：消息应为非空文本，且每条不超过 12000 字。");
  const createId = options.createId ?? (() => crypto.randomUUID());
  const conversation: DzmmSavedConversation = {
    id: createId(), characterId: character.id, title: character.name, updatedAt: options.now ?? Date.now(),
    messages: imported.messages.map((message: DzmmSavedMessage) => ({ role: message.role, content: message.content, id: createId() })),
    worldClockMode: imported.worldClockMode === "realtime" ? "realtime" : "story",
  };
  if (imported.opening !== undefined) {
    try { conversation.opening = parseDzmmConversationOpening(imported.opening); }
    catch { /* Damaged optional metadata must not discard the original history. */ }
  }
  conversation.opening = resolveDzmmConversationOpening(character, conversation);
  const worldState = rebindDzmmWorldJournal(imported.worldState, imported.messages, conversation.messages);
  if (worldState) conversation.worldState = worldState;
  if (imported.storyMemory !== undefined) {
    try {
      const memory = parseStoryMemory(imported.storyMemory);
      if (matchesDzmmStoryMemory(memory, imported.messages)) {
        conversation.storyMemory = createDzmmStoryMemory(memory.state, conversation.messages.slice(0, memory.sourceCount));
      }
    } catch { /* Invalid optional memory never discards imported original messages. */ }
  }
  return { character, conversation };
}
