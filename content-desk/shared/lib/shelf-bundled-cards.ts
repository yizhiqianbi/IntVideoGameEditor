import exportedRecords from "./folio-exported-cards-2026-10-21.json";
import userRecords from "./folio-user-provided-cards-2026-10-24.json";
import exportedMeta from "./folio-exported-cards-metadata.json";
import userMeta from "./folio-user-provided-cards-metadata.json";
import {
  SHELF_AI_CHARACTERS,
  SHELF_CHARACTERS,
  parseCharacterImport,
  FOLIO_RETIRED_CARD_IDS,
  type Character,
} from "./shelf-characters";
import { fillCustomShelfTags } from "./folio-shelf-tags";
import { folioHomepageStat } from "./folio-homepage-stats";

type ManifestRow = { id: string; sha256: string };
type BundledRecord = {
  id: string;
  slug: string;
  author: string;
  sourceUrl: string;
  coverUrl: string;
  createdAt: string;
  sha256: string;
  card: { data: { author?: string } };
};

const exported = exportedRecords as BundledRecord[];
const supplied = userRecords as BundledRecord[];
const exportedManifest = exportedMeta as ManifestRow[];
const suppliedManifest = userMeta as ManifestRow[];

function assertSameManifest(full: readonly ManifestRow[], meta: readonly ManifestRow[], label: string) {
  if (full.length !== meta.length || full.some((record, index) => record.id !== meta[index]?.id || record.sha256 !== meta[index]?.sha256)) {
    throw new Error(`${label}清单与正文不一致。`);
  }
}

assertSameManifest(exported, exportedManifest, "导出角色卡");
assertSameManifest(supplied, suppliedManifest, "用户提供角色卡");

/** Playable copies of the pinned exports. The homepage ships only the shelf manifest. */
export const SHELF_EXPORTED_FULL_CHARACTERS: Character[] = exported.map(record => ({
  ...parseCharacterImport({ ...record.card, data: { ...record.card.data, author: record.author,
    cover: `/shelf/exported-cards/${record.slug}-cover.png` } }, record.id),
  sourceUrl: record.sourceUrl,
  sourceKind: "public-summary",
  promptOrigin: "public-verbatim",
  catalogReadiness: "full-card",
  heat: folioHomepageStat(record.id)?.heat ?? "—",
  likes: folioHomepageStat(record.id)?.likes ?? "0",
  createdAt: record.createdAt,
}));

/** Supplied originals have their own provenance and assets; they never inherit
 * another creator's source URL, license, or popularity. Display regex can draw
 * a message panel; tavern scripts and plugins stay inert. */
export const SHELF_USER_PROVIDED_FULL_CHARACTERS: Character[] = supplied.map(record => {
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
    heat: folioHomepageStat(record.id)?.heat ?? "—",
    likes: folioHomepageStat(record.id)?.likes ?? "0",
    createdAt: record.createdAt,
  };
});

export const SHELF_CATALOG_CHARACTERS: Character[] = [
  ...SHELF_AI_CHARACTERS,
  ...SHELF_CHARACTERS,
  ...SHELF_EXPORTED_FULL_CHARACTERS,
  ...SHELF_USER_PROVIDED_FULL_CHARACTERS,
];

export const SHELF_LISTED_CHARACTERS: Character[] = [
  ...SHELF_EXPORTED_FULL_CHARACTERS,
  ...SHELF_USER_PROVIDED_FULL_CHARACTERS,
  ...SHELF_AI_CHARACTERS.filter(character => character.catalogReadiness === "full-card"),
].filter(character => !FOLIO_RETIRED_CARD_IDS.has(character.id));

const bundledById = new Map(SHELF_LISTED_CHARACTERS.map(character => [character.id, character]));

export function shelfBundledCharacter(id: string): Character | null {
  return bundledById.get(id) ?? null;
}
