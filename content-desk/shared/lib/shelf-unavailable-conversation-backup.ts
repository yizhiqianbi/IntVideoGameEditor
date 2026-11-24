import { SHELF_CHARACTER_PROSE_LIMIT } from "./shelf-character-context";
import { SHELF_CONVERSATION_BACKUP_MAX_BYTES } from "./shelf-conversation-backup";
import { parseShelfConversationOpening } from "./shelf-conversation-context";
import { createShelfStoryMemory, matchesShelfStoryMemory, parseStoryMemory } from "./shelf-story-memory";
import { isShelfPublishedCharacterId, type ShelfSavedConversation, type ShelfSavedMessage } from "./shelf-storage";
import { rebindShelfWorldJournal } from "./shelf-world-client";

const SPEC = "folio_conversation_archive_v1";
const MAX_TIMESTAMP = 8_640_000_000_000_000;
export type ShelfUnavailableConversationBackup = {
  spec: typeof SPEC;
  character: null;
  conversation: ShelfSavedConversation;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && Boolean(value.trim()) && !value.includes("\0");
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TIMESTAMP;
}
function checkSize(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > SHELF_CONVERSATION_BACKUP_MAX_BYTES) {
    throw new Error("会话文件不能超过 2 MB。");
  }
}
function sourceConversation(value: unknown): Record<string, unknown> & {
  id: string; characterId: string; title: string; updatedAt: number; messages: ShelfSavedMessage[];
} {
  if (!record(value) || !text(value.id, 120) || !text(value.characterId, 120)
    || !isShelfPublishedCharacterId(value.characterId) || !text(value.title, 12_000) || !timestamp(value.updatedAt)) {
    throw new Error("缺卡会话存档需要有效的公开角色关联、会话 ID、标题与时间。");
  }
  if (!Array.isArray(value.messages) || !value.messages.every(message => record(message)
    && text(message.id, 120) && (message.role === "user" || message.role === "assistant") && text(message.content, SHELF_CHARACTER_PROSE_LIMIT))) {
    throw new Error(`会话格式无效：每条消息需要有效 ID、角色与不超过 ${SHELF_CHARACTER_PROSE_LIMIT} 字的非空文本。`);
  }
  return value as ReturnType<typeof sourceConversation>;
}

/** Preserve a literal archive, without pretending the missing card is known. */
export function createShelfUnavailableConversationBackup(conversation: ShelfSavedConversation): ShelfUnavailableConversationBackup {
  sourceConversation(conversation);
  return { spec: SPEC, character: null, conversation: structuredClone(conversation) };
}

/** This imports a missing-card reference, never a replacement playable card.
 * Ordinary character-backed files return null for the existing importer.
 */
export function parseShelfUnavailableConversationBackup(
  raw: string, options: { createId?: () => string; now?: number } = {},
): ShelfSavedConversation | null {
  checkSize(raw);
  const imported: unknown = JSON.parse(raw);
  if (!record(imported) || imported.spec !== SPEC) return null;
  if (imported.character !== null || Object.keys(imported).some(key => !["spec", "character", "conversation"].includes(key))) {
    throw new Error("缺卡会话存档不能包含伪造的角色卡或未知字段。");
  }
  const source = sourceConversation(imported.conversation);
  const updatedAt = options.now ?? Date.now();
  if (!timestamp(updatedAt)) throw new Error("导入会话的时间无效。");
  // Validate the entire source first. Once it is accepted, generate detached,
  // collision-free IDs without altering any original message text or order.
  const used = new Set([source.id, ...source.messages.map(message => message.id)].flatMap(id => [id, id.trim()]));
  const createId = options.createId ?? (() => crypto.randomUUID());
  function newId(): string {
    const supplied = createId();
    if (!text(supplied, 120)) throw new Error("新会话或消息 ID 无效。");
    const candidate = supplied.trim();
    let id = candidate, suffix = 1;
    while (used.has(id)) {
      const ending = `-${suffix++}`;
      id = candidate.slice(0, 120 - ending.length) + ending;
    }
    used.add(id);
    return id;
  }
  const conversation: ShelfSavedConversation = {
    id: newId(), characterId: source.characterId, title: source.title, updatedAt,
    messages: source.messages.map(({ role, content }) => ({ id: newId(), role, content })),
  };
  if (source.worldClockMode === "story" || source.worldClockMode === "realtime") conversation.worldClockMode = source.worldClockMode;
  if (source.opening !== undefined) {
    try { conversation.opening = parseShelfConversationOpening(source.opening); }
    catch { /* Optional damage must not discard the original message history. */ }
  }
  const worldState = rebindShelfWorldJournal(source.worldState, source.messages, conversation.messages);
  if (worldState) conversation.worldState = worldState;
  if (source.storyMemory !== undefined) {
    try {
      const memory = parseStoryMemory(source.storyMemory);
      if (matchesShelfStoryMemory(memory, source.messages)) {
        conversation.storyMemory = createShelfStoryMemory(memory.state, conversation.messages.slice(0, memory.sourceCount));
      }
    } catch { /* Invalid optional memory never discards the original messages. */ }
  }
  return conversation;
}
