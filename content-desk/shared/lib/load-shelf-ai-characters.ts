import type { Character } from "./shelf-characters";

let pending: Promise<typeof import("./shelf-ai-characters")> | null = null;

export function loadShelfAiCharacters() {
  pending ??= import("./shelf-ai-characters");
  return pending;
}

export async function shelfDeferredAiArchiveCharacter(id: string): Promise<Character | null> {
  const loaded = await loadShelfAiCharacters();
  return loaded.shelfAiArchiveCharacter(id);
}
