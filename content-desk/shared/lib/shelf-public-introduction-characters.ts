import dataset from "./shelf-public-introductions.json";
import metadata from "./shelf-public-introductions-metadata.json";
import type { Character } from "./shelf-characters";

type IntroductionRecord = {
  id: string;
  description?: string;
  sourceKind?: string;
  promptOrigin?: string;
};

type IntroductionShelf = IntroductionRecord & {
  id: string;
  introductionDeferred?: boolean;
  shelfDescription: string;
};
const records = dataset.characters as IntroductionRecord[];
const shelfRecords = metadata.characters as IntroductionShelf[];
if (records.length !== shelfRecords.length || records.some((record, index) => record.id !== shelfRecords[index]?.id)) {
  throw new Error("公开介绍清单与正文不一致。");
}

/** Full public introductions. The homepage keeps only the shelf manifest. */
export const SHELF_PUBLIC_INTRODUCTION_CHARACTERS: Character[] = records.map((record) => {
  const description = String(record.description ?? "").replace(/\s+/g, " ").trim();
  const shelf = shelfRecords.find((item) => item.id === record.id);
  if (!shelf || shelf.introductionDeferred !== description.length > shelf.shelfDescription.length) {
    throw new Error("公开介绍摘要与正文不一致。");
  }
  return {
    ...(record as unknown as Character),
    sourceKind: "public-summary",
    promptOrigin: "public-verbatim",
  };
});

const byId = new Map(SHELF_PUBLIC_INTRODUCTION_CHARACTERS.map((character) => [character.id, character]));

export function shelfPublicIntroductionCharacter(id: string): Character | null {
  return byId.get(id) ?? null;
}
