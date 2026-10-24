import type { DzmmCharacter } from "./dzmm-chat";
import type { DzmmOpeningMessage } from "./dzmm-character-context";
import { getDzmmConversationOpening, type DzmmConversationOpeningCharacter } from "./dzmm-conversation-opening";
import type { DzmmSavedConversation } from "./dzmm-storage";
import { matchesDzmmStoryMemory } from "./dzmm-story-memory";
import { projectDzmmSourceOpeningHistory, splitDzmmCharacterPresentation } from "./dzmm-character-presentation";

export type DzmmConversationOpeningSnapshot = {
  version: 1;
  kind: "opening" | "background" | "welcome";
  source: "template" | "history";
  messages: DzmmOpeningMessage[];
};

type ConversationContext = {
  messages: readonly DzmmOpeningMessage[];
  opening?: DzmmConversationOpeningSnapshot;
};

/** A small, immutable-in-use opening record; real history is never relabeled as a template. */
export function parseDzmmConversationOpening(value: unknown): DzmmConversationOpeningSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("会话开场格式无效。");
  const supplied = value as Record<string, unknown>;
  if (supplied.version !== 1 || !["opening", "background", "welcome"].includes(supplied.kind as string)
    || (supplied.source !== "template" && supplied.source !== "history")
    || !Array.isArray(supplied.messages) || supplied.messages.length > 20
    || (supplied.source === "template" && !supplied.messages.length)
    || (supplied.source === "history" && supplied.messages.length)) throw new Error("会话开场版本、来源或消息列表无效。");
  const messages = supplied.messages.map((candidate): DzmmOpeningMessage => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("会话开场消息格式无效。");
    const message = candidate as Record<string, unknown>;
    if ((message.role !== "assistant" && message.role !== "user") || typeof message.content !== "string"
      || !message.content.trim() || message.content.length > 12_000 || message.content.includes("\0")) {
      throw new Error("会话开场消息应为不超过 12000 字的非空文本。");
    }
    return { role: message.role, content: message.content };
  });
  const opening: DzmmConversationOpeningSnapshot = { version: 1,
    kind: supplied.kind as DzmmConversationOpeningSnapshot["kind"], source: supplied.source, messages };
  if (new TextEncoder().encode(JSON.stringify(opening)).byteLength > 256 * 1024) throw new Error("会话开场总量不能超过 256 KB。");
  return opening;
}

export function captureDzmmConversationOpening(
  character: Readonly<DzmmConversationOpeningCharacter>, index = 0,
): DzmmConversationOpeningSnapshot {
  return parseDzmmConversationOpening({ version: 1, source: "template", ...getDzmmConversationOpening(character, index) });
}

function matchesOpeningPrefix(opening: DzmmConversationOpeningSnapshot, messages: readonly DzmmOpeningMessage[]): boolean {
  return opening.messages.every((message, index) => messages[index]?.role === message.role
    && messages[index]?.content.trim() === message.content.trim());
}

/** Editing or deleting any authored opening turn makes the real edited history authoritative. */
export function reconcileDzmmConversationOpening(
  opening: DzmmConversationOpeningSnapshot, messages: readonly DzmmOpeningMessage[],
): DzmmConversationOpeningSnapshot {
  if (opening.source === "history" || matchesOpeningPrefix(opening, messages)) return opening;
  return { version: 1, kind: opening.kind, source: "history", messages: [] };
}

/** Legacy records recover only a complete, recognizable template prefix. Unknown history stays literal. */
export function resolveDzmmConversationOpening(
  character: Readonly<DzmmConversationOpeningCharacter>, conversation: ConversationContext,
): DzmmConversationOpeningSnapshot {
  if (conversation.opening) return conversation.messages.length
    ? reconcileDzmmConversationOpening(conversation.opening, conversation.messages) : conversation.opening;
  const primary = captureDzmmConversationOpening(character);
  if (!conversation.messages.length) return primary;
  if (matchesOpeningPrefix(primary, conversation.messages)) return primary;
  const projected = projectDzmmSourceOpeningHistory(character, conversation.messages);
  if (matchesOpeningPrefix(primary, projected)) {
    // Pin the actual legacy prefix, including its annotations. Only display/request projections
    // remove them; otherwise a clean snapshot would fail reconciliation against its raw history.
    const count = primary.messages.length + conversation.messages.length - projected.length;
    return { ...primary, messages: conversation.messages.slice(0, count).map(({ role, content }) => ({ role, content })) };
  }
  if (conversation.messages[0]?.role === "assistant") {
    const alternative = character.alternateGreetings?.findIndex(greeting => greeting.trim() === conversation.messages[0].content.trim()
      || splitDzmmCharacterPresentation(greeting).body === splitDzmmCharacterPresentation(conversation.messages[0].content).body) ?? -1;
    if (alternative >= 0) {
      const selected = captureDzmmConversationOpening(character, alternative + 1);
      const selectedHistory = projectDzmmSourceOpeningHistory({ openingMessages: [{ role: "assistant", content: character.alternateGreetings![alternative] }] }, conversation.messages);
      if (matchesOpeningPrefix(selected, selectedHistory)) return { ...selected,
        messages: conversation.messages.slice(0, selected.messages.length + conversation.messages.length - selectedHistory.length).map(({ role, content }) => ({ role, content })) };
    }
  }
  return { version: 1, kind: "opening", source: "history", messages: [] };
}

/** Reuse the existing chat protocol while giving this conversation's opening precedence over card revisions. */
export function applyDzmmConversationOpening<T extends DzmmCharacter>(
  character: T & DzmmConversationOpeningCharacter, conversation: ConversationContext,
): T {
  const opening = resolveDzmmConversationOpening(character, conversation);
  return { ...character, firstMessage: "", alternateGreetings: [],
    openingMessages: opening.messages.map(message => ({ ...message })) };
}

/** Pin legacy openings once and restore empty records from their own selected scene, without rewriting populated history. */
export function restoreDzmmConversationContexts(
  conversations: DzmmSavedConversation[], characters: readonly DzmmConversationOpeningCharacter[],
  options: { createId?: () => string; now?: () => number } = {},
): DzmmSavedConversation[] {
  const byId = new Map(characters.map(character => [character.id, character]));
  const usedIds = new Set(conversations.flatMap(conversation => conversation.messages.map(message => message.id)));
  let changed = false;
  let restoredAt: number | undefined;
  const next = conversations.map(conversation => {
    const character = byId.get(conversation.characterId);
    const opening = conversation.opening ? (conversation.messages.length
      ? reconcileDzmmConversationOpening(conversation.opening, conversation.messages) : conversation.opening)
      : character ? resolveDzmmConversationOpening(character, conversation) : undefined;
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
    if (restored.storyMemory && !matchesDzmmStoryMemory(restored.storyMemory, messages)) delete restored.storyMemory;
    return restored;
  });
  return changed ? next : conversations;
}
