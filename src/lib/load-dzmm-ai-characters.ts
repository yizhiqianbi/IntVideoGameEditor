import type { Character } from "./dzmm-characters";

let pending: Promise<typeof import("./dzmm-ai-characters")> | null = null;

export function loadDzmmAiCharacters() {
  pending ??= import("./dzmm-ai-characters");
  return pending;
}

export async function dzmmDeferredAiArchiveCharacter(id: string): Promise<Character | null> {
  const loaded = await loadDzmmAiCharacters();
  return loaded.dzmmAiArchiveCharacter(id);
}
