import { prepareShelfRequest } from "./shelf-context";
import { normalizeShelfModelSelection } from "./shelf-models";
import { applyShelfConversationOpening } from "./shelf-conversation-context";
import { captureShelfReplySuggestionContext } from "./shelf-message-actions";
import { fingerprintShelfStoryMessages } from "./shelf-story-memory";
import { SHELF_REPLY_SUGGESTIONS_MAX_TOKENS, parseShelfReplySuggestions, type ShelfReplySuggestion } from "./shelf-reply-suggestions";
import type { Character } from "./shelf-characters";
import { resolveShelfConversationPersona, type ShelfPreferences, type ShelfSavedConversation, type ShelfSavedMessage } from "./shelf-storage";

/** Incremental prefix keys invalidate later suggestions after an earlier edit, without quadratic history serialization. */
export function shelfReplySuggestionPrefixKeys(messages: readonly ShelfSavedMessage[]): string[] {
  let previous = "reply-options-v1";
  return messages.map(message => {
    previous = fingerprintShelfStoryMessages([{ role: "user", content: previous }, message]);
    return previous;
  });
}

/** Settings can contain many legal fields and snapshots; never treat their combined JSON as one limited chat message. */
export function shelfReplySuggestionSettingsKey(settings: readonly unknown[]): string {
  const serialized = JSON.stringify(settings);
  const chunks = [];
  for (let index = 0; index < serialized.length; index += 11900) {
    chunks.push({ role: "user" as const, content: `settings:${serialized.slice(index, index + 11900)}` });
  }
  return fingerprintShelfStoryMessages(chunks);
}

export function prepareShelfReplySuggestionsRequest(character: Character, conversation: ShelfSavedConversation,
  messageId: string, preferences: ShelfPreferences) {
  if (character.authoringDraft) throw new Error("请先在创作中心完善角色世界书，再生成行动建议。");
  const context = captureShelfReplySuggestionContext(conversation, messageId);
  const snapshot = context.worldState?.snapshots.at(-1);
  const request = prepareShelfRequest(applyShelfConversationOpening(character, context),
    [...context.messages, { role: "user", content: "为这条角色回复提供三个不同方向的下一步建议。" }],
    preferences.preset, resolveShelfConversationPersona(preferences, conversation.id), normalizeShelfModelSelection(preferences.model), SHELF_REPLY_SUGGESTIONS_MAX_TOKENS, { userName: preferences.nickname, storyMemory: context.storyMemory,
      ...(snapshot ? { world: { clockMode: snapshot.clockMode, state: snapshot.state, recordedAt: snapshot.recordedAt } } : {}), locale: preferences.locale });
  if (request.messages.length < 2 || request.messages.at(-2)?.role !== "assistant") {
    throw new Error("角色设定过长，无法保留当前回复。请精简设定后再生成建议。");
  }
  return request;
}

export class ShelfReplySuggestionsError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); this.name = "ShelfReplySuggestionsError"; }
}

export async function fetchShelfReplySuggestions(request: ReturnType<typeof prepareShelfReplySuggestionsRequest>,
  signal: AbortSignal): Promise<ShelfReplySuggestion[]> {
  signal.throwIfAborted();
  const response = await fetch("/api/reply-suggestions", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-内容台-Request-Id": crypto.randomUUID() },
    body: JSON.stringify(request), signal });
  const payload: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    throw new ShelfReplySuggestionsError(response.status, typeof body?.error === "string" ? body.error : "行动建议生成失败，请重试。",
      typeof body?.code === "string" ? body.code : undefined);
  }
  return parseShelfReplySuggestions(payload);
}

export type ShelfReplySuggestionInsertion = { before: string; after: string };
/** Switching choices replaces only our untouched insertion; edited user text is never removed. */
export function insertShelfReplySuggestion(draft: string, reply: string, previous?: ShelfReplySuggestionInsertion): ShelfReplySuggestionInsertion {
  const before = previous && draft === previous.after ? previous.before : draft;
  const after = before ? `${before}\n${reply}` : reply;
  if (after.length > 12000) throw new Error("输入框已接近字数上限，请先整理已有文字，再选择建议。");
  return { before, after };
}
