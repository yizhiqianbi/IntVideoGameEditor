import type { Character } from "./dzmm-characters";

let pending: Promise<typeof import("./dzmm-public-introduction-characters")> | null = null;

export function loadDzmmPublicIntroductions() {
  pending ??= import("./dzmm-public-introduction-characters");
  return pending;
}

export async function dzmmDeferredIntroductionCharacter(id: string): Promise<Character | null> {
  const loaded = await loadDzmmPublicIntroductions();
  return loaded.dzmmPublicIntroductionCharacter(id);
}
