import dataset from "./dzmm-public-introductions.json";
import metadata from "./dzmm-public-introductions-metadata.json";
import type { Character } from "./dzmm-characters";

type IntroductionRecord = {
  id: string;
  description?: string;
  sourceKind?: string;
  promptOrigin?: string;
};

const records = dataset.characters as IntroductionRecord[];
if (records.length !== metadata.characters.length || records.some((record, index) => record.id !== metadata.characters[index]?.id)) {
  throw new Error("公开介绍清单与正文不一致。");
}

/** Full public introductions. The homepage keeps only the shelf manifest. */
export const DZMM_PUBLIC_INTRODUCTION_CHARACTERS: Character[] = records.map((record) => {
  const description = String(record.description ?? "").replace(/\s+/g, " ").trim();
  const shelf = metadata.characters.find((item) => item.id === record.id);
  if (!shelf || shelf.introductionDeferred !== description.length > shelf.shelfDescription.length) {
    throw new Error("公开介绍摘要与正文不一致。");
  }
  return {
    ...(record as unknown as Character),
    sourceKind: "public-summary",
    promptOrigin: "public-verbatim",
  };
});

const byId = new Map(DZMM_PUBLIC_INTRODUCTION_CHARACTERS.map((character) => [character.id, character]));

export function dzmmPublicIntroductionCharacter(id: string): Character | null {
  return byId.get(id) ?? null;
}
