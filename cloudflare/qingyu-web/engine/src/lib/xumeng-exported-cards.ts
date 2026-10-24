type ExportedRecord = { id:string;slug:string;author:string;sourceUrl:string;downloadUrl:string;sha256:string;licenseName:string;licenseUrl:string;attribution:string;changes:string;version:string;sourceCommit:string;createdAt:string;card:unknown };
const records: ExportedRecord[] = [];

/** Fixed public exports only. The original JSON remains available separately;
 * these records retain all source fields for the runtime adapter and audit. */
export const XUMENG_EXPORTED_CARD_RECORDS = records;

export type XumengExportedCardMetadata = Omit<(typeof records)[number], "card">;
const metadataById = new Map(records.map(({ card: _card, ...metadata }) =>
  [metadata.id, Object.freeze(metadata)] as const));

type PublicCardReference = {
  id: string;
  sourceKind?: unknown;
  promptOrigin?: unknown;
  catalogReadiness?: unknown;
  publication?: unknown;
  authoringDraft?: unknown;
};

/** Provenance comes exclusively from this build's manifest, never card-supplied
 * source, download, attribution or license fields. Private copies have no claim
 * to the original-file download even when they retain the same display name. */
export function getXumengExportedCardMetadata(character: PublicCardReference): Readonly<XumengExportedCardMetadata> | undefined {
  if (character.sourceKind !== "public-summary" || character.promptOrigin !== "public-verbatim"
    || character.catalogReadiness !== "full-card" || character.publication !== undefined
    || character.authoringDraft != null) return undefined;
  return metadataById.get(character.id);
}
