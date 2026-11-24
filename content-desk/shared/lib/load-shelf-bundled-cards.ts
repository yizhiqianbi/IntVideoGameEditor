import type { Character } from "./shelf-characters";

let pending: Promise<typeof import("./shelf-bundled-cards")> | null = null;

/** Card bodies stay in their own chunk so the homepage does not parse them up front. */
export function loadShelfBundledCards() {
  pending ??= import("./shelf-bundled-cards");
  return pending;
}

export async function shelfBundledPlayableCharacter(id: string): Promise<Character | null> {
  const loaded = await loadShelfBundledCards();
  return loaded.shelfBundledCharacter(id);
}
