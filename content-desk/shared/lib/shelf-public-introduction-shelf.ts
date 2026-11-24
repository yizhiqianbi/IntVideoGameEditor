import type { Character } from "./shelf-characters";
import metadata from "./shelf-public-introductions-metadata.json";
import ids from "./shelf-public-introduction-ids.json";

type IntroductionShelfCard = {
  id: string;
  name: string;
  author: string;
  heat: string;
  likes: string;
  cover: string;
  tags: string[];
  shelfDescription: string;
  sourceUrl: string;
  createdAt: string;
  publicIntroductionSha256?: string;
  introductionDeferred?: boolean;
};
const shelfCards = metadata.characters as IntroductionShelfCard[];
const shelfIds = ids as string[];
if (
  shelfCards.length !== shelfIds.length ||
  shelfCards.some((character, index) => character.id !== shelfIds[index])
) {
  throw new Error("公开介绍编号与摘要不一致。");
}

const characters: Character[] = shelfCards.map((character) => ({
  id: character.id,
  name: character.name,
  author: character.author,
  heat: character.heat,
  likes: character.likes,
  cover: character.cover,
  tags: [...character.tags],
  description: character.shelfDescription,
  personality: "",
  scenario: "",
  firstMessage: "",
  sourceUrl: character.sourceUrl,
  sourceKind: "public-summary",
  promptOrigin: "public-verbatim",
  createdAt: character.createdAt,
  publicIntroductionSha256: character.publicIntroductionSha256,
  ...(character.introductionDeferred ? { introductionDeferred: true } : {}),
}));

const byId = new Map(characters.map((character) => [character.id, character]));

export function shelfPublicIntroductionShelfCharacter(id: string): Character | null {
  return byId.get(id) ?? null;
}
