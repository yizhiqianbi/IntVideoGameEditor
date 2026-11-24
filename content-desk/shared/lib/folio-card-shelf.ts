import exportedShelf from "./folio-exported-cards-shelf.json";
import userShelf from "./folio-user-provided-cards-shelf.json";

export type FolioCardProvenance = {
  id: string;
  slug: string;
  author: string;
  attribution: string;
  createdAt: string;
  version: string;
  changes: string;
  downloadUrl: string;
  sha256: string;
  sourceUrl: string;
  sourceCommit: string;
  licenseName: string;
  licenseUrl: string;
  provenanceKind?: "author-export" | "user-provided";
  pngDownloadUrl?: string;
  compatibilityNotes?: readonly string[];
};

export type FolioShelfRecord = FolioCardProvenance & {
  shelfName: string;
  shelfTags: string[];
  shelfDescription: string;
  coverUrl: string;
  userProvided?: boolean;
};

export const FOLIO_EXPORTED_SHELF_RECORDS = exportedShelf as FolioShelfRecord[];
export const FOLIO_USER_PROVIDED_SHELF_RECORDS = userShelf as FolioShelfRecord[];

const pinnedIds = new Set<string>([
  ...FOLIO_EXPORTED_SHELF_RECORDS.map((record) => record.id),
  ...FOLIO_USER_PROVIDED_SHELF_RECORDS.map((record) => record.id),
]);

type PinnedCardReference = {
  id: string;
  sourceKind?: unknown;
  promptOrigin?: unknown;
  catalogReadiness?: unknown;
  publication?: unknown;
  authoringDraft?: unknown;
};

/** Shelf identity is enough to recognize a pinned card. Provenance loads later. */
export function isFolioPinnedCard(character: PinnedCardReference): boolean {
  return character.sourceKind === "public-summary"
    && character.promptOrigin === "public-verbatim"
    && character.catalogReadiness === "full-card"
    && character.publication === undefined
    && character.authoringDraft == null
    && pinnedIds.has(character.id);
}

let provenanceById: ReadonlyMap<string, Readonly<FolioCardProvenance>> | null = null;

export function installFolioCardProvenance(records: ReadonlyMap<string, Readonly<FolioCardProvenance>>) {
  provenanceById = records;
}

export function readFolioCardProvenance(character: PinnedCardReference): Readonly<FolioCardProvenance> | undefined {
  if (!provenanceById || !isFolioPinnedCard(character)) return undefined;
  return provenanceById.get(character.id);
}

let pending: Promise<void> | null = null;

export function loadFolioCardProvenance() {
  pending ??= import("./folio-card-provenance").then(() => undefined);
  return pending;
}
