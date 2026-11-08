import type { Character } from "./dzmm-characters";

let pending: Promise<typeof import("./dzmm-public-context-characters")> | null = null;

export function loadDzmmPublicContext() {
  pending ??= import("./dzmm-public-context-characters");
  return pending;
}

export async function dzmmDeferredContextCharacter(character: Character): Promise<Character | null> {
  const loaded = await loadDzmmPublicContext();
  const text = loaded.dzmmPublicContextText(character.id);
  if (!text) return null;
  return {
    ...character,
    description: text.description,
    firstMessage: text.firstMessage,
    contextDeferred: undefined,
  };
}
