import exportedShelf from "./xumeng-exported-cards-shelf.json";
import userShelf from "./xumeng-user-provided-cards-shelf.json";

export type XumengCardProvenance = {
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

export const XUMENG_EXPORTED_SHELF_RECORDS = exportedShelf;
export const XUMENG_USER_PROVIDED_SHELF_RECORDS = userShelf;

const pinnedIds = new Set<string>([
  ...exportedShelf.map((record) => record.id),
  ...userShelf.map((record) => record.id),
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
export function isXumengPinnedCard(character: PinnedCardReference): boolean {
  return character.sourceKind === "public-summary"
    && character.promptOrigin === "public-verbatim"
    && character.catalogReadiness === "full-card"
    && character.publication === undefined
    && character.authoringDraft == null
    && pinnedIds.has(character.id);
}

let provenanceById: ReadonlyMap<string, Readonly<XumengCardProvenance>> | null = null;

export function installXumengCardProvenance(records: ReadonlyMap<string, Readonly<XumengCardProvenance>>) {
  provenanceById = records;
}

export function readXumengCardProvenance(character: PinnedCardReference): Readonly<XumengCardProvenance> | undefined {
  if (!provenanceById || !isXumengPinnedCard(character)) return undefined;
  return provenanceById.get(character.id);
}

let pending: Promise<void> | null = null;

export function loadXumengCardProvenance() {
  pending ??= import("./xumeng-card-provenance").then(() => undefined);
  return pending;
}
