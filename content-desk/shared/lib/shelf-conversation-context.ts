import type { ShelfCharacter } from "./shelf-chat";
import { SHELF_CHARACTER_CARD_MAX_BYTES, SHELF_CHARACTER_PROSE_LIMIT, type ShelfOpeningMessage } from "./shelf-character-context";
import { getShelfConversationOpening, type ShelfConversationOpeningCharacter } from "./shelf-conversation-opening";
import type { ShelfSavedConversation } from "./shelf-storage";
import { matchesShelfStoryMemory } from "./shelf-story-memory";
import { projectShelfSourceOpeningHistory, splitShelfCharacterPresentation } from "./shelf-character-presentation";

export type ShelfConversationOpeningSnapshot = {
  version: 1;
  kind: "opening" | "background" | "welcome";
  source: "template" | "history";
  messages: ShelfOpeningMessage[];
};

type ConversationContext = {
  messages: readonly ShelfOpeningMessage[];
  opening?: ShelfConversationOpeningSnapshot;
};

/** A small, immutable-in-use opening record; real history is never relabeled as a template. */
export function parseShelfConversationOpening(value: unknown): ShelfConversationOpeningSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("会话开场格式无效。");
  const supplied = value as Record<string, unknown>;
  if (supplied.version !== 1 || !["opening", "background", "welcome"].includes(supplied.kind as string)
    || (supplied.source !== "template" && supplied.source !== "history")
    || !Array.isArray(supplied.messages) || supplied.messages.length > 20
    || (supplied.source === "template" && !supplied.messages.length)
    || (supplied.source === "history" && supplied.messages.length)) throw new Error("会话开场版本、来源或消息列表无效。");
  const messages = supplied.messages.map((candidate): ShelfOpeningMessage => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("会话开场消息格式无效。");
    const message = candidate as Record<string, unknown>;
    if ((message.role !== "assistant" && message.role !== "user") || typeof message.content !== "string"
      || !message.content.trim() || message.content.length > SHELF_CHARACTER_PROSE_LIMIT || message.content.includes("\0")) {
      throw new Error(`会话开场消息应为不超过 ${SHELF_CHARACTER_PROSE_LIMIT} 字的非空文本。`);
    }
    return { role: message.role, content: message.content };
  });
  const opening: ShelfConversationOpeningSnapshot = { version: 1,
    kind: supplied.kind as ShelfConversationOpeningSnapshot["kind"], source: supplied.source, messages };
  if (new TextEncoder().encode(JSON.stringify(opening)).byteLength > SHELF_CHARACTER_CARD_MAX_BYTES) throw new Error("会话开场总量不能超过 5 MB。");
  return opening;
}

export function captureShelfConversationOpening(
  character: Readonly<ShelfConversationOpeningCharacter>, index = 0,
): ShelfConversationOpeningSnapshot {
  return parseShelfConversationOpening({ version: 1, source: "template", ...getShelfConversationOpening(character, index) });
}

function matchesOpeningPrefix(opening: ShelfConversationOpeningSnapshot, messages: readonly ShelfOpeningMessage[]): boolean {
  return opening.messages.every((message, index) => messages[index]?.role === message.role
    && messages[index]?.content.trim() === message.content.trim());
}

/** Editing or deleting any authored opening turn makes the real edited history authoritative. */
export function reconcileShelfConversationOpening(
  opening: ShelfConversationOpeningSnapshot, messages: readonly ShelfOpeningMessage[],
): ShelfConversationOpeningSnapshot {
  if (opening.source === "history" || matchesOpeningPrefix(opening, messages)) return opening;
  return { version: 1, kind: opening.kind, source: "history", messages: [] };
}

/** Legacy records recover only a complete, recognizable template prefix. Unknown history stays literal. */
export function resolveShelfConversationOpening(
  character: Readonly<ShelfConversationOpeningCharacter>, conversation: ConversationContext,
): ShelfConversationOpeningSnapshot {
  if (conversation.opening) return conversation.messages.length
    ? reconcileShelfConversationOpening(conversation.opening, conversation.messages) : conversation.opening;
  const primary = captureShelfConversationOpening(character);
  if (!conversation.messages.length) return primary;
  if (matchesOpeningPrefix(primary, conversation.messages)) return primary;
  const projected = projectShelfSourceOpeningHistory(character, conversation.messages);
  if (matchesOpeningPrefix(primary, projected)) {
    // Pin the actual legacy prefix, including its annotations. Only display/request projections
    // remove them; otherwise a clean snapshot would fail reconciliation against its raw history.
    const count = primary.messages.length + conversation.messages.length - projected.length;
    return { ...primary, messages: conversation.messages.slice(0, count).map(({ role, content }) => ({ role, content })) };
  }
  if (conversation.messages[0]?.role === "assistant") {
    const alternative = character.alternateGreetings?.findIndex(greeting => greeting.trim() === conversation.messages[0].content.trim()
      || splitShelfCharacterPresentation(greeting).body === splitShelfCharacterPresentation(conversation.messages[0].content).body) ?? -1;
    if (alternative >= 0) {
      const selected = captureShelfConversationOpening(character, alternative + 1);
      const selectedHistory = projectShelfSourceOpeningHistory({ openingMessages: [{ role: "assistant", content: character.alternateGreetings![alternative] }] }, conversation.messages);
      if (matchesOpeningPrefix(selected, selectedHistory)) return { ...selected,
        messages: conversation.messages.slice(0, selected.messages.length + conversation.messages.length - selectedHistory.length).map(({ role, content }) => ({ role, content })) };
    }
  }
  return { version: 1, kind: "opening", source: "history", messages: [] };
}

/** Reuse the existing chat protocol while giving this conversation's opening precedence over card revisions. */
export function applyShelfConversationOpening<T extends ShelfCharacter>(
  character: T & ShelfConversationOpeningCharacter, conversation: ConversationContext,
): T {
  const opening = resolveShelfConversationOpening(character, conversation);
  return { ...character, firstMessage: "", alternateGreetings: [],
    openingMessages: opening.messages.map(message => ({ ...message })) };
}

/** Pin legacy openings once and restore empty records from their own selected scene, without rewriting populated history. */
export function restoreShelfConversationContexts(
  conversations: ShelfSavedConversation[], characters: readonly ShelfConversationOpeningCharacter[],
  options: { createId?: () => string; now?: () => number } = {},
): ShelfSavedConversation[] {
  const byId = new Map(characters.map(character => [character.id, character]));
  const usedIds = new Set(conversations.flatMap(conversation => conversation.messages.map(message => message.id)));
  let changed = false;
  let restoredAt: number | undefined;
  const next = conversations.map(conversation => {
    const character = byId.get(conversation.characterId);
    const opening = conversation.opening ? (conversation.messages.length
      ? reconcileShelfConversationOpening(conversation.opening, conversation.messages) : conversation.opening)
      : character ? resolveShelfConversationOpening(character, conversation) : undefined;
    if (!opening) return conversation;
    if (conversation.messages.length || !opening.messages.length) {
      if (conversation.opening === opening) return conversation;
      changed = true;
      return { ...conversation, opening };
    }
    function uniqueId(): string {
      const candidate = (options.createId ?? (() => crypto.randomUUID()))().trim();
      const base = candidate && candidate.length <= 120 && !candidate.includes("\0") ? candidate : "opening-message";
      let id = base;
      let suffix = 1;
      while (usedIds.has(id)) {
        const ending = `-${suffix++}`;
        id = `${base.slice(0, 120 - ending.length)}${ending}`;
      }
      usedIds.add(id);
      return id;
    }
    changed = true;
    restoredAt ??= (options.now ?? Date.now)();
    const messages = opening.messages.map(message => ({ ...message, id: uniqueId() }));
    const restored = { ...conversation, opening, messages, updatedAt: restoredAt };
    if (restored.storyMemory && !matchesShelfStoryMemory(restored.storyMemory, messages)) delete restored.storyMemory;
    return restored;
  });
  return changed ? next : conversations;
}
