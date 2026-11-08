import records from "./xumeng-exported-cards-metadata.json";
import { XUMENG_USER_PROVIDED_CARD_RECORDS } from "./xumeng-user-provided-cards";
import {
  installXumengCardProvenance,
  XUMENG_EXPORTED_SHELF_RECORDS,
  XUMENG_USER_PROVIDED_SHELF_RECORDS,
  type XumengCardProvenance,
} from "./xumeng-card-shelf";

export type XumengExportedCardMetadata = XumengCardProvenance;

const metadataById = new Map<string, Readonly<XumengCardProvenance>>(records.map(({ shelfName: _name, shelfTags: _tags, shelfDescription: _description, ...metadata }) =>
  [metadata.id, Object.freeze(metadata)] as const));
for (const record of XUMENG_USER_PROVIDED_CARD_RECORDS) {
  metadataById.set(record.id, Object.freeze({
    id: record.id, slug: record.slug, author: record.author || "用户提供", attribution: record.author || "用户提供",
    createdAt: record.createdAt, version: record.version, changes: record.changes,
    downloadUrl: record.downloadUrl, pngDownloadUrl: record.pngDownloadUrl, sha256: record.sha256,
    sourceUrl: "", sourceCommit: "", licenseName: "许可未核验", licenseUrl: "",
    provenanceKind: "user-provided", compatibilityNotes: Object.freeze([...record.compatibilityNotes]),
  }));
}

const shelfIds = [
  ...XUMENG_EXPORTED_SHELF_RECORDS.map((record) => record.id),
  ...XUMENG_USER_PROVIDED_SHELF_RECORDS.map((record) => record.id),
];
if (shelfIds.length !== metadataById.size || shelfIds.some((id) => !metadataById.has(id))) {
  throw new Error("角色卡来源清单与摘要不一致。");
}

installXumengCardProvenance(metadataById);

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
export function getXumengExportedCardMetadata(character: PublicCardReference): Readonly<XumengCardProvenance> | undefined {
  if (character.sourceKind !== "public-summary" || character.promptOrigin !== "public-verbatim"
    || character.catalogReadiness !== "full-card" || character.publication !== undefined
    || character.authoringDraft != null) return undefined;
  return metadataById.get(character.id);
}
