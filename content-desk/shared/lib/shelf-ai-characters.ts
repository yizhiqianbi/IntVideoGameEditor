import fullMetadata from "./shelf-ai-metadata-2026-10-14.json";
import listedMetadata from "./shelf-ai-listed-metadata.json";
import archiveIds from "./shelf-ai-archive-ids.json";
import { buildShelfAiCharacters, type Character, type ShelfAiMetadataRecord } from "./shelf-characters";

const listedRecords = listedMetadata.records as ShelfAiMetadataRecord[];
const fullRecords = fullMetadata.records as ShelfAiMetadataRecord[];
const archive = archiveIds as string[];

const listedById = new Map(listedRecords.map((record) => [String(record.id), record]));
for (const record of fullRecords) {
  const listed = listedById.get(String(record.id));
  if (listed && JSON.stringify(listed) !== JSON.stringify(record)) {
    throw new Error("首页角色摘要与公开目录不一致。");
  }
}

/** Sixty archive cards. Background-only cards stay here and off the public shelf. */
export const SHELF_AI_CHARACTERS: Character[] = buildShelfAiCharacters(fullRecords);

const metadataOnlyIds = SHELF_AI_CHARACTERS.filter((character) => character.catalogReadiness === "metadata-only").map((character) => character.id);
if (archive.length !== metadataOnlyIds.length || archive.some((id, index) => id !== metadataOnlyIds[index])) {
  throw new Error("目录角色编号与正文不一致。");
}

const archiveById = new Map(SHELF_AI_CHARACTERS.map((character) => [character.id, character]));

export function shelfAiArchiveCharacter(id: string): Character | null {
  const character = archiveById.get(id);
  return character?.catalogReadiness === "metadata-only" ? character : null;
}
