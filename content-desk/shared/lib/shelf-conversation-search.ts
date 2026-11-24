import type { Character } from "./shelf-characters";
import type { ShelfSavedConversation } from "./shelf-storage";

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Search only supplied visible fields; a word cannot span field boundaries. */
export function filterShelfSearchRows<T>(rows: readonly T[], query: string, getFields: (row: T) => readonly string[]): readonly T[] {
  const normalized = normalize(query);
  if (!normalized) return rows;
  const terms = normalized.split(" ");
  return rows.filter(row => {
    const fields = getFields(row).map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
}

export function filterShelfConversations(conversations: ShelfSavedConversation[], characters: readonly Character[], query: string): ShelfSavedConversation[];
export function filterShelfConversations(conversations: readonly ShelfSavedConversation[], characters: readonly Character[], query: string): readonly ShelfSavedConversation[];
/** Search only the caller's conversation collection and actual visible text.
 * Separate fields prevent a word from being fabricated across message edges.
 */
export function filterShelfConversations(
  conversations: readonly ShelfSavedConversation[], characters: readonly Character[], query: string,
): readonly ShelfSavedConversation[] {
  const names = new Map(characters.map(character => [character.id, character.name]));
  return filterShelfSearchRows(conversations, query, conversation => [conversation.title, names.get(conversation.characterId) ?? "",
    ...conversation.messages.map(message => message.content)]);
}
