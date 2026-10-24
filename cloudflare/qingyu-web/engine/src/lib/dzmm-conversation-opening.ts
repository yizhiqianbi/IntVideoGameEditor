import { getDzmmOpeningMessages, type DzmmOpeningMessage } from "./dzmm-character-context";
import type { DzmmSavedConversation } from "./dzmm-storage";
import { matchesDzmmStoryMemory } from "./dzmm-story-memory";
import { splitDzmmCharacterPresentation } from "./dzmm-character-presentation";

export type DzmmConversationOpeningCharacter = {
  id: string;
  name: string;
  firstMessage?: string;
  openingMessages?: DzmmOpeningMessage[];
  alternateGreetings?: string[];
  scenario?: string;
  description?: string;
};

export type DzmmConversationOpening = {
  kind: "opening" | "background" | "welcome";
  messages: DzmmOpeningMessage[];
};

const MAX_OPENING_CHARS = 12_000;

function boundedText(value: string): string {
  if (value.length <= MAX_OPENING_CHARS) return value;
  let end = MAX_OPENING_CHARS;
  // Do not split a surrogate pair at the saved-message limit.
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return value.slice(0, end).trimEnd();
}

/** Story prose stays literal; clear author notes remain on the card rather than in dialogue. */
export function getDzmmConversationOpening(
  character: Readonly<DzmmConversationOpeningCharacter>,
  index = 0,
): DzmmConversationOpening {
  // Keep the author-opening precedence and alternate-selection validation in one place.
  const opening = getDzmmOpeningMessages(character, index);
  if (opening.length) return {
    kind: "opening",
    messages: opening.map(message => ({ ...message, content: boundedText(message.content) })),
  };
  const background = splitDzmmCharacterPresentation(character.scenario || "").body
    || splitDzmmCharacterPresentation(character.description || "").body;
  if (background) return { kind: "background", messages: [{ role: "assistant", content: boundedText(background) }] };
  const name = character.name.trim() || "故事角色";
  return {
    kind: "welcome",
    messages: [{ role: "assistant", content: boundedText(`你好，我是${name}。你想从什么场景开始？可以先说一句话，或告诉我你在故事中的身份。`) }],
  };
}

type RestoreOptions = { createId?: () => string; now?: () => number };

export function restoreDzmmEmptyConversations(
  conversations: DzmmSavedConversation[],
  characters: readonly DzmmConversationOpeningCharacter[],
  options?: RestoreOptions,
): DzmmSavedConversation[];
export function restoreDzmmEmptyConversations(
  conversations: readonly DzmmSavedConversation[],
  characters: readonly DzmmConversationOpeningCharacter[],
  options?: RestoreOptions,
): readonly DzmmSavedConversation[];
/** Restore only empty, known-character records without changing existing conversation history. */
export function restoreDzmmEmptyConversations(
  conversations: readonly DzmmSavedConversation[],
  characters: readonly DzmmConversationOpeningCharacter[],
  options: RestoreOptions = {},
): readonly DzmmSavedConversation[] {
  const byId = new Map(characters.map(character => [character.id, character]));
  if (!conversations.some(conversation => !conversation.messages.length && byId.has(conversation.characterId))) return conversations;
  const usedIds = new Set(conversations.flatMap(conversation => conversation.messages.map(message => message.id)));
  const createId = options.createId ?? (() => crypto.randomUUID());
  const updatedAt = (options.now ?? Date.now)();
  function uniqueId(): string {
    const candidate = createId().trim();
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
  return conversations.map(conversation => {
    if (conversation.messages.length) return conversation;
    const character = byId.get(conversation.characterId);
    if (!character) return conversation;
    const messages = getDzmmConversationOpening(character).messages.map(message => ({ ...message, id: uniqueId() }));
    const restored = { ...conversation, messages, updatedAt };
    if (restored.storyMemory && !matchesDzmmStoryMemory(restored.storyMemory, messages)) delete restored.storyMemory;
    return restored;
  });
}
