import type { Character } from "./dzmm-characters";
import metadata from "./dzmm-public-introductions-metadata.json";
import ids from "./dzmm-public-introduction-ids.json";

if (
  metadata.characters.length !== ids.length ||
  metadata.characters.some((character, index) => character.id !== ids[index])
) {
  throw new Error("公开介绍编号与摘要不一致。");
}

const characters: Character[] = metadata.characters.map((character) => ({
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

export function dzmmPublicIntroductionShelfCharacter(id: string): Character | null {
  return byId.get(id) ?? null;
}
