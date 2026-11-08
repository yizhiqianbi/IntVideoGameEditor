import fullMetadata from "./dzmm-ai-metadata-2026-10-14.json";
import listedMetadata from "./dzmm-ai-listed-metadata.json";
import archiveIds from "./dzmm-ai-archive-ids.json";
import { buildDzmmAiCharacters, type Character } from "./dzmm-characters";

const listedById = new Map(listedMetadata.records.map((record) => [String(record.id), record]));
for (const record of fullMetadata.records) {
  const listed = listedById.get(String(record.id));
  if (listed && JSON.stringify(listed) !== JSON.stringify(record)) {
    throw new Error("首页角色摘要与公开目录不一致。");
  }
}

/** Sixty archive cards. Background-only cards stay here and off the public shelf. */
export const DZMM_AI_CHARACTERS: Character[] = buildDzmmAiCharacters(fullMetadata.records);

const metadataOnlyIds = DZMM_AI_CHARACTERS.filter((character) => character.catalogReadiness === "metadata-only").map((character) => character.id);
if (archiveIds.length !== metadataOnlyIds.length || archiveIds.some((id, index) => id !== metadataOnlyIds[index])) {
  throw new Error("目录角色编号与正文不一致。");
}

const archiveById = new Map(DZMM_AI_CHARACTERS.map((character) => [character.id, character]));

export function dzmmAiArchiveCharacter(id: string): Character | null {
  const character = archiveById.get(id);
  return character?.catalogReadiness === "metadata-only" ? character : null;
}
