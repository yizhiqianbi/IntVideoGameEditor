import exportedRecords from "./xumeng-exported-cards-2026-10-21.json";
import userRecords from "./xumeng-user-provided-cards-2026-10-24.json";
import exportedMeta from "./xumeng-exported-cards-metadata.json";
import userMeta from "./xumeng-user-provided-cards-metadata.json";
import {
  DZMM_AI_CHARACTERS,
  DZMM_CHARACTERS,
  parseCharacterImport,
  XUMENG_RETIRED_CARD_IDS,
  type Character,
} from "./dzmm-characters";
import { fillCustomShelfTags } from "./xumeng-shelf-tags";
import { xumengHomepageStat } from "./xumeng-homepage-stats";

type ManifestRow = { id: string; sha256: string };

function assertSameManifest(full: readonly ManifestRow[], meta: readonly ManifestRow[], label: string) {
  if (full.length !== meta.length || full.some((record, index) => record.id !== meta[index]?.id || record.sha256 !== meta[index]?.sha256)) {
    throw new Error(`${label}清单与正文不一致。`);
  }
}

assertSameManifest(exportedRecords, exportedMeta, "导出角色卡");
assertSameManifest(userRecords, userMeta, "用户提供角色卡");

/** Playable copies of the pinned exports. The homepage ships only the shelf manifest. */
export const DZMM_EXPORTED_FULL_CHARACTERS: Character[] = exportedRecords.map(record => ({
  ...parseCharacterImport({ ...record.card, data: { ...record.card.data, author: record.author,
    cover: `/dzmm/exported-cards/foreverse-${record.slug}-cover.png` } }, record.id),
  sourceUrl: record.sourceUrl,
  sourceKind: "public-summary",
  promptOrigin: "public-verbatim",
  catalogReadiness: "full-card",
  heat: xumengHomepageStat(record.id)?.heat ?? "—",
  likes: xumengHomepageStat(record.id)?.likes ?? "0",
  createdAt: record.createdAt,
}));

/** Supplied originals have their own provenance and assets; they never inherit
 * another creator's source URL, license, or popularity. Extensions stay inert. */
export const DZMM_USER_PROVIDED_FULL_CHARACTERS: Character[] = userRecords.map(record => {
  const parsed = parseCharacterImport(record.card, record.id);
  return {
    ...parsed,
    tags: fillCustomShelfTags(parsed.name, parsed.tags),
    author: record.author || "用户提供",
    cover: record.coverUrl,
    sourceUrl: "",
    sourceKind: "public-summary",
    promptOrigin: "public-verbatim",
    catalogReadiness: "full-card",
    heat: xumengHomepageStat(record.id)?.heat ?? "—",
    likes: xumengHomepageStat(record.id)?.likes ?? "0",
    createdAt: record.createdAt,
  };
});

export const DZMM_CATALOG_CHARACTERS: Character[] = [
  ...DZMM_AI_CHARACTERS,
  ...DZMM_CHARACTERS,
  ...DZMM_EXPORTED_FULL_CHARACTERS,
  ...DZMM_USER_PROVIDED_FULL_CHARACTERS,
];

export const DZMM_LISTED_CHARACTERS: Character[] = [
  ...DZMM_EXPORTED_FULL_CHARACTERS,
  ...DZMM_USER_PROVIDED_FULL_CHARACTERS,
  ...DZMM_AI_CHARACTERS.filter(character => character.catalogReadiness === "full-card"),
].filter(character => !XUMENG_RETIRED_CARD_IDS.has(character.id));

const bundledById = new Map(DZMM_LISTED_CHARACTERS.map(character => [character.id, character]));

export function dzmmBundledCharacter(id: string): Character | null {
  return bundledById.get(id) ?? null;
}
