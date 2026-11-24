import type { Character } from "./shelf-characters";

let pending: Promise<typeof import("./shelf-public-context-characters")> | null = null;

export function loadShelfPublicContext() {
  pending ??= import("./shelf-public-context-characters");
  return pending;
}

export async function shelfDeferredContextCharacter(character: Character): Promise<Character | null> {
  const loaded = await loadShelfPublicContext();
  const text = loaded.shelfPublicContextText(character.id);
  if (!text) return null;
  return {
    ...character,
    description: text.description,
    firstMessage: text.firstMessage,
    contextDeferred: undefined,
  };
}
