import type { Character } from "./dzmm-characters";
import type { DzmmSavedConversation } from "./dzmm-storage";

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Search only supplied visible fields; a word cannot span field boundaries. */
export function filterDzmmSearchRows<T>(rows: readonly T[], query: string, getFields: (row: T) => readonly string[]): readonly T[] {
  const normalized = normalize(query);
  if (!normalized) return rows;
  const terms = normalized.split(" ");
  return rows.filter(row => {
    const fields = getFields(row).map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
}

export function filterDzmmConversations(conversations: DzmmSavedConversation[], characters: readonly Character[], query: string): DzmmSavedConversation[];
export function filterDzmmConversations(conversations: readonly DzmmSavedConversation[], characters: readonly Character[], query: string): readonly DzmmSavedConversation[];
/** Search only the caller's conversation collection and actual visible text.
 * Separate fields prevent a word from being fabricated across message edges.
 */
export function filterDzmmConversations(
  conversations: readonly DzmmSavedConversation[], characters: readonly Character[], query: string,
): readonly DzmmSavedConversation[] {
  const names = new Map(characters.map(character => [character.id, character.name]));
  return filterDzmmSearchRows(conversations, query, conversation => [conversation.title, names.get(conversation.characterId) ?? "",
    ...conversation.messages.map(message => message.content)]);
}
