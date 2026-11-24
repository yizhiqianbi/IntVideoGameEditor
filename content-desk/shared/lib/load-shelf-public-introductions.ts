import type { Character } from "./shelf-characters";

let pending: Promise<typeof import("./shelf-public-introduction-characters")> | null = null;

export function loadShelfPublicIntroductions() {
  pending ??= import("./shelf-public-introduction-characters");
  return pending;
}

export async function shelfDeferredIntroductionCharacter(id: string): Promise<Character | null> {
  const loaded = await loadShelfPublicIntroductions();
  return loaded.shelfPublicIntroductionCharacter(id);
}
