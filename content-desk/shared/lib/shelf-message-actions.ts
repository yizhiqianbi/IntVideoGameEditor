import { parseShelfConversationOpening, reconcileShelfConversationOpening } from "./shelf-conversation-context";
import { createShelfStoryMemory, matchesShelfStoryMemory, parseStoryMemory } from "./shelf-story-memory";
import type { ShelfSavedConversation } from "./shelf-storage";
import { rebindShelfWorldJournal } from "./shelf-world-client";
import { pruneShelfWorldJournal } from "./shelf-world-state";

export const SHELF_MESSAGE_EDIT_MAX_CHARS = 12_000;

/** Preserve the exact text, role and ID; only facts covered by unchanged prefixes survive. */
export function editShelfConversationMessage(
  conversation: Readonly<ShelfSavedConversation>, messageId: string, content: string,
  options: { now?: number } = {},
): ShelfSavedConversation {
  if (typeof content !== "string" || !content.trim() || content.includes("\0")
    || content.length > SHELF_MESSAGE_EDIT_MAX_CHARS) {
    throw new Error("消息应为非空文本，且不超过 12000 字。");
  }
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error("这条消息已不存在，请重新打开消息菜单。");
  if (conversation.messages[index].content === content) return conversation;

  const messages = conversation.messages.map((message, position) => ({ ...message,
    ...(position === index ? { content } : {}) }));
  const { opening: previousOpening, storyMemory: previousMemory, worldState: previousWorld, ...rest } = conversation;
  const opening = previousOpening
    ? parseShelfConversationOpening(reconcileShelfConversationOpening(previousOpening, messages)) : undefined;
  const storyMemory = matchesShelfStoryMemory(previousMemory, messages) ? parseStoryMemory(previousMemory) : undefined;
  const worldState = pruneShelfWorldJournal(previousWorld, messages);
  return { ...rest, messages, updatedAt: options.now ?? Date.now(),
    ...(opening ? { opening } : {}), ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

function regenerationPrefixLength(conversation: Readonly<ShelfSavedConversation>, messageId: string): number {
  const target = conversation.messages.findIndex(message => message.id === messageId);
  if (target < 0 || conversation.messages[target].role !== "assistant") return 0;
  for (let index = target - 1; index >= 0; index--) {
    if (conversation.messages[index].role === "user") return index + 1;
  }
  return 0;
}

/** Authored assistant openings without an earlier user turn cannot be regenerated. */
export function canRegenerateShelfMessage(conversation: Readonly<ShelfSavedConversation>, messageId: string): boolean {
  return regenerationPrefixLength(conversation, messageId) > 0;
}

/** Rewind a detached branch to the user turn; never replace or truncate the original conversation. */
export function createShelfRegenerationBranch(
  conversation: Readonly<ShelfSavedConversation>, assistantMessageId: string,
  options: { createId?: () => string; now?: number } = {},
): ShelfSavedConversation {
  const prefixLength = regenerationPrefixLength(conversation, assistantMessageId);
  if (!prefixLength) throw new Error("只能重新生成有前置用户消息的助手回复。");
  const original = conversation.messages.slice(0, prefixLength);
  const createId = options.createId ?? (() => crypto.randomUUID());
  const usedIds = new Set([conversation.id, ...conversation.messages.map(message => message.id)]);
  function uniqueId(): string {
    const supplied = createId();
    if (typeof supplied !== "string" || !supplied.trim() || supplied.trim().length > 120 || supplied.includes("\0")) {
      throw new Error("新分支的消息标识无效。");
    }
    const base = supplied.trim();
    let id = base;
    let suffix = 1;
    while (usedIds.has(id)) {
      const ending = `-${suffix++}`;
      id = `${base.slice(0, 120 - ending.length)}${ending}`;
    }
    usedIds.add(id);
    return id;
  }
  const id = uniqueId();
  const messages = original.map(message => ({ ...message, id: uniqueId() }));
  const { opening: previousOpening, storyMemory: previousMemory, worldState: previousWorld, ...rest } = conversation;
  const opening = previousOpening
    ? parseShelfConversationOpening(reconcileShelfConversationOpening(previousOpening, original)) : undefined;
  const storyMemory = previousMemory && matchesShelfStoryMemory(previousMemory, original)
    ? createShelfStoryMemory(previousMemory.state, messages.slice(0, previousMemory.sourceCount)) : undefined;
  const worldState = rebindShelfWorldJournal(previousWorld, original, messages);
  return { ...rest, id, title: `${conversation.title.slice(0, 100)} · 重生成分支`, messages,
    updatedAt: options.now ?? Date.now(), ...(opening ? { opening } : {}),
    ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

/** Capture the selected reply's complete history without carrying facts from later turns. */
export function captureShelfReplySuggestionContext(
  conversation: Readonly<ShelfSavedConversation>, assistantMessageId: string,
): ShelfSavedConversation {
  const target = conversation.messages.findIndex(message => message.id === assistantMessageId);
  if (target < 0) throw new Error("这条消息已不存在，请重新打开消息菜单。");
  if (conversation.messages[target].role !== "assistant") throw new Error("只能为助手回复提供行动建议。");
  const messages = conversation.messages.slice(0, target + 1).map(message => ({ ...message }));
  const { opening: previousOpening, storyMemory: previousMemory, worldState: previousWorld, ...rest } = conversation;
  const opening = previousOpening
    ? parseShelfConversationOpening(reconcileShelfConversationOpening(previousOpening, messages)) : undefined;
  const storyMemory = matchesShelfStoryMemory(previousMemory, messages) ? parseStoryMemory(previousMemory) : undefined;
  const worldState = pruneShelfWorldJournal(previousWorld, messages);
  return { ...rest, messages, ...(opening ? { opening } : {}),
    ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

/** Branch ends at the chosen assistant reply so the caller can send that suggestion. */
export function createShelfReplySuggestionBranch(
  conversation: Readonly<ShelfSavedConversation>, assistantMessageId: string,
  options: { createId?: () => string; now?: number } = {},
): ShelfSavedConversation {
  const context = captureShelfReplySuggestionContext(conversation, assistantMessageId);
  const createId = options.createId ?? (() => crypto.randomUUID());
  const usedIds = new Set([conversation.id, ...conversation.messages.map(message => message.id)]);
  function uniqueId(): string {
    const supplied = createId();
    if (typeof supplied !== "string" || !supplied.trim() || supplied.trim().length > 120 || supplied.includes("\0")) {
      throw new Error("新分支的消息标识无效。");
    }
    const base = supplied.trim();
    let id = base;
    let suffix = 1;
    while (usedIds.has(id)) {
      const ending = `-${suffix++}`;
      id = `${base.slice(0, 120 - ending.length)}${ending}`;
    }
    usedIds.add(id);
    return id;
  }
  const id = uniqueId();
  const messages = context.messages.map(message => ({ ...message, id: uniqueId() }));
  const { storyMemory: previousMemory, worldState: previousWorld, ...rest } = context;
  const storyMemory = previousMemory
    ? createShelfStoryMemory(previousMemory.state, messages.slice(0, previousMemory.sourceCount)) : undefined;
  const worldState = rebindShelfWorldJournal(previousWorld, context.messages, messages);
  return { ...rest, id, title: `${conversation.title.slice(0, 100)} · 行动分支`, messages,
    updatedAt: options.now ?? Date.now(), ...(storyMemory ? { storyMemory } : {}),
    ...(worldState ? { worldState } : {}) };
}
