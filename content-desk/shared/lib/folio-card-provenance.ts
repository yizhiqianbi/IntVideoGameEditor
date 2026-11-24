import records from "./folio-exported-cards-metadata.json";
import { FOLIO_USER_PROVIDED_CARD_RECORDS } from "./folio-user-provided-cards";
import {
  installFolioCardProvenance,
  FOLIO_EXPORTED_SHELF_RECORDS,
  FOLIO_USER_PROVIDED_SHELF_RECORDS,
  type FolioCardProvenance,
} from "./folio-card-shelf";

export type FolioExportedCardMetadata = FolioCardProvenance;

const metadataById = new Map<string, Readonly<FolioCardProvenance>>((records as Array<FolioCardProvenance & {
  shelfName?: string; shelfTags?: string[]; shelfDescription?: string;
}>).map(({ shelfName: _name, shelfTags: _tags, shelfDescription: _description, ...metadata }) =>
  [metadata.id, Object.freeze(metadata)] as const));
for (const record of FOLIO_USER_PROVIDED_CARD_RECORDS) {
  metadataById.set(record.id, Object.freeze({
    id: record.id, slug: record.slug, author: record.author || "用户提供", attribution: record.author || "用户提供",
    createdAt: record.createdAt, version: record.version, changes: record.changes,
    downloadUrl: record.downloadUrl, pngDownloadUrl: record.pngDownloadUrl, sha256: record.sha256,
    sourceUrl: "", sourceCommit: "", licenseName: "许可未核验", licenseUrl: "",
    provenanceKind: "user-provided", compatibilityNotes: Object.freeze([...record.compatibilityNotes]),
  }));
}

const shelfIds = [
  ...FOLIO_EXPORTED_SHELF_RECORDS.map((record) => record.id),
  ...FOLIO_USER_PROVIDED_SHELF_RECORDS.map((record) => record.id),
];
if (shelfIds.length !== metadataById.size || shelfIds.some((id) => !metadataById.has(id))) {
  throw new Error("角色卡来源清单与摘要不一致。");
}

installFolioCardProvenance(metadataById);

type PublicCardReference = {
  id: string;
  sourceKind?: unknown;
  promptOrigin?: unknown;
  catalogReadiness?: unknown;
  publication?: unknown;
  authoringDraft?: unknown;
};

/** Provenance comes exclusively from this build's manifest, never card-supplied
 * source, download, attribution or license fields. */
export function getFolioExportedCardMetadata(character: PublicCardReference): Readonly<FolioCardProvenance> | undefined {
  if (character.sourceKind !== "public-summary" || character.promptOrigin !== "public-verbatim"
    || character.catalogReadiness !== "full-card" || character.publication !== undefined
    || character.authoringDraft != null) return undefined;
  return metadataById.get(character.id);
}
