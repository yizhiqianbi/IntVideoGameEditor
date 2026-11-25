import { parseDzmmConversationOpening, reconcileDzmmConversationOpening } from "./dzmm-conversation-context";
import { createDzmmStoryMemory, matchesDzmmStoryMemory, parseStoryMemory } from "./dzmm-story-memory";
import type { DzmmSavedConversation } from "./dzmm-storage";
import { rebindDzmmWorldJournal } from "./dzmm-world-client";
import { pruneDzmmWorldJournal } from "./dzmm-world-state";

export const DZMM_MESSAGE_EDIT_MAX_CHARS = 12_000;

/** Preserve the exact text, role and ID; only facts covered by unchanged prefixes survive. */
export function editDzmmConversationMessage(
  conversation: Readonly<DzmmSavedConversation>, messageId: string, content: string,
  options: { now?: number } = {},
): DzmmSavedConversation {
  if (typeof content !== "string" || !content.trim() || content.includes("\0")
    || content.length > DZMM_MESSAGE_EDIT_MAX_CHARS) {
    throw new Error("消息应为非空文本，且不超过 12000 字。");
  }
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error("这条消息已不存在，请重新打开消息菜单。");
  if (conversation.messages[index].content === content) return conversation;

  const messages = conversation.messages.map((message, position) => {
    if (position !== index) return { ...message };
    if (message.swipes?.length) {
      const activeIndex = Math.min(message.swipes.length - 1, Math.max(0, message.swipeIndex ?? 0));
      const swipes = message.swipes.map((variant, i) => (i === activeIndex ? content : variant));
      return { ...message, content, swipes, swipeIndex: activeIndex };
    }
    return { ...message, content };
  });
  const { opening: previousOpening, storyMemory: previousMemory, worldState: previousWorld, ...rest } = conversation;
  const opening = previousOpening
    ? parseDzmmConversationOpening(reconcileDzmmConversationOpening(previousOpening, messages)) : undefined;
  const storyMemory = matchesDzmmStoryMemory(previousMemory, messages) ? parseStoryMemory(previousMemory) : undefined;
  const worldState = pruneDzmmWorldJournal(previousWorld, messages);
  return { ...rest, messages, updatedAt: options.now ?? Date.now(),
    ...(opening ? { opening } : {}), ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

function regenerationPrefixLength(conversation: Readonly<DzmmSavedConversation>, messageId: string): number {
  const target = conversation.messages.findIndex(message => message.id === messageId);
  if (target < 0 || conversation.messages[target].role !== "assistant") return 0;
  for (let index = target - 1; index >= 0; index--) {
    if (conversation.messages[index].role === "user") return index + 1;
  }
  return 0;
}

/** Authored assistant openings without an earlier user turn cannot be regenerated. */
export function canRegenerateDzmmMessage(conversation: Readonly<DzmmSavedConversation>, messageId: string): boolean {
  return regenerationPrefixLength(conversation, messageId) > 0;
}

/** Rewind a detached branch to the user turn; never replace or truncate the original conversation. */
export function createDzmmRegenerationBranch(
  conversation: Readonly<DzmmSavedConversation>, assistantMessageId: string,
  options: { createId?: () => string; now?: number } = {},
): DzmmSavedConversation {
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
    ? parseDzmmConversationOpening(reconcileDzmmConversationOpening(previousOpening, original)) : undefined;
  const storyMemory = previousMemory && matchesDzmmStoryMemory(previousMemory, original)
    ? createDzmmStoryMemory(previousMemory.state, messages.slice(0, previousMemory.sourceCount)) : undefined;
  const worldState = rebindDzmmWorldJournal(previousWorld, original, messages);
  return { ...rest, id, title: `${conversation.title.slice(0, 100)} · 重生成分支`, messages,
    updatedAt: options.now ?? Date.now(), ...(opening ? { opening } : {}),
    ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

/** Capture the selected reply's complete history without carrying facts from later turns. */
export function captureDzmmReplySuggestionContext(
  conversation: Readonly<DzmmSavedConversation>, assistantMessageId: string,
): DzmmSavedConversation {
  const target = conversation.messages.findIndex(message => message.id === assistantMessageId);
  if (target < 0) throw new Error("这条消息已不存在，请重新打开消息菜单。");
  if (conversation.messages[target].role !== "assistant") throw new Error("只能为助手回复提供行动建议。");
  const messages = conversation.messages.slice(0, target + 1).map(message => ({ ...message }));
  const { opening: previousOpening, storyMemory: previousMemory, worldState: previousWorld, ...rest } = conversation;
  const opening = previousOpening
    ? parseDzmmConversationOpening(reconcileDzmmConversationOpening(previousOpening, messages)) : undefined;
  const storyMemory = matchesDzmmStoryMemory(previousMemory, messages) ? parseStoryMemory(previousMemory) : undefined;
  const worldState = pruneDzmmWorldJournal(previousWorld, messages);
  return { ...rest, messages, ...(opening ? { opening } : {}),
    ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

/** Branch ends at the chosen assistant reply so the caller can send that suggestion. */
export function createDzmmReplySuggestionBranch(
  conversation: Readonly<DzmmSavedConversation>, assistantMessageId: string,
  options: { createId?: () => string; now?: number } = {},
): DzmmSavedConversation {
  const context = captureDzmmReplySuggestionContext(conversation, assistantMessageId);
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
    ? createDzmmStoryMemory(previousMemory.state, messages.slice(0, previousMemory.sourceCount)) : undefined;
  const worldState = rebindDzmmWorldJournal(previousWorld, context.messages, messages);
  return { ...rest, id, title: `${conversation.title.slice(0, 100)} · 行动分支`, messages,
    updatedAt: options.now ?? Date.now(), ...(storyMemory ? { storyMemory } : {}),
    ...(worldState ? { worldState } : {}) };
}

export const DZMM_MESSAGE_SWIPE_LIMIT = 8;

function withSwipeMessages(
  conversation: Readonly<DzmmSavedConversation>,
  messageId: string,
  update: (message: DzmmSavedConversation["messages"][number]) => DzmmSavedConversation["messages"][number] | undefined,
  now: number,
): DzmmSavedConversation {
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error("这条消息已不存在，请重新打开消息菜单。");
  const updated = update(conversation.messages[index]);
  if (!updated || updated === conversation.messages[index]) return conversation;
  const messages = conversation.messages.map((message, position) => position === index ? updated : message);
  const { opening: previousOpening, storyMemory: previousMemory, worldState: previousWorld, ...rest } = conversation;
  const opening = previousOpening
    ? parseDzmmConversationOpening(reconcileDzmmConversationOpening(previousOpening, messages)) : undefined;
  const storyMemory = matchesDzmmStoryMemory(previousMemory, messages) ? parseStoryMemory(previousMemory) : undefined;
  const worldState = pruneDzmmWorldJournal(previousWorld, messages);
  return { ...rest, messages, updatedAt: now,
    ...(opening ? { opening } : {}), ...(storyMemory ? { storyMemory } : {}), ...(worldState ? { worldState } : {}) };
}

/** Switch between stored swipe variants of one assistant turn. */
export function switchDzmmMessageSwipe(
  conversation: Readonly<DzmmSavedConversation>, messageId: string, index: number, options: { now?: number } = {},
): DzmmSavedConversation {
  return withSwipeMessages(conversation, messageId, message => {
    if (message.role !== "assistant" || !message.swipes || message.swipes.length < 2) throw new Error("这条消息没有可切换的版本。");
    if (!Number.isInteger(index) || index < 0 || index >= message.swipes.length) throw new Error("版本序号无效。");
    if ((message.swipeIndex ?? 0) === index) return undefined;
    return { ...message, content: message.swipes[index], swipeIndex: index };
  }, options.now ?? Date.now());
}

/** Append one more generated variant and activate it. */
export function appendDzmmMessageSwipe(
  conversation: Readonly<DzmmSavedConversation>, messageId: string, content: string, options: { now?: number } = {},
): DzmmSavedConversation {
  if (typeof content !== "string" || !content.trim() || content.includes("\0") || content.length > DZMM_MESSAGE_EDIT_MAX_CHARS) {
    throw new Error("新版本正文应为不超过 12000 字的非空文本。");
  }
  return withSwipeMessages(conversation, messageId, message => {
    if (message.role !== "assistant") throw new Error("只有角色回复可以生成新版本。");
    const swipes = [...(message.swipes ?? [message.content])];
    if (swipes[swipes.length - 1] === content) throw new Error("新版本与当前版本相同。");
    if (swipes.length >= DZMM_MESSAGE_SWIPE_LIMIT) throw new Error(`每条回复最多保存 ${DZMM_MESSAGE_SWIPE_LIMIT} 个版本。`);
    return { ...message, content, swipes: [...swipes, content], swipeIndex: swipes.length };
  }, options.now ?? Date.now());
}

/** Merge a newly regenerated assistant reply into an existing assistant turn as a swipe variant. */
export function mergeDzmmRegeneratedAssistantMessage(
  previous: Readonly<DzmmSavedConversation["messages"][number]>,
  content: string,
  speaker?: string,
): DzmmSavedConversation["messages"][number] {
  const existing = (previous.swipes?.length ? previous.swipes : [previous.content]).filter(Boolean);
  const sameAsLast = existing.at(-1) === content;
  let swipes = sameAsLast ? [...existing] : [...existing, content];
  if (swipes.length > DZMM_MESSAGE_SWIPE_LIMIT) swipes = swipes.slice(-DZMM_MESSAGE_SWIPE_LIMIT);
  const swipeIndex = swipes.length - 1;
  return {
    ...previous,
    role: "assistant",
    content,
    ...(speaker ? { speaker } : {}),
    ...(swipes.length >= 2 ? { swipes, swipeIndex } : {}),
  };
}
