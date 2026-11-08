import type { Character } from "./dzmm-characters";

let pending: Promise<typeof import("./dzmm-bundled-cards")> | null = null;

/** Card bodies stay in their own chunk so the homepage does not parse them up front. */
export function loadDzmmBundledCards() {
  pending ??= import("./dzmm-bundled-cards");
  return pending;
}

export async function dzmmBundledPlayableCharacter(id: string): Promise<Character | null> {
  const loaded = await loadDzmmBundledCards();
  return loaded.dzmmBundledCharacter(id);
}
