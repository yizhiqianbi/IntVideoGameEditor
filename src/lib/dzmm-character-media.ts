import dataset from "./dzmm-character-media.json";
import type { Character } from "./dzmm-characters";

type PublicMedia = {
  sourceUrl: string;
  observedAt: string;
  gallery: { path: string; sha256: string }[];
  opening?: { text: string; sha256: string; origin: "public-rendered" };
};
const media = dataset.characters as Record<string, PublicMedia>;

/** Supplements stay separate from the independently verified introduction catalog. */
export function getDzmmCharacterMedia(character: Character): PublicMedia | undefined {
  return character.sourceKind === "public-summary" && character.promptOrigin === "public-verbatim" ? media[character.id] : undefined;
}

export function withDzmmPublicOpening(character: Character): Character {
  const opening = getDzmmCharacterMedia(character)?.opening;
  return opening ? { ...character, firstMessage: opening.text } : character;
}
