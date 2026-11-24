import type { ShelfCatalogLook } from "./shelf-public-shelf";

/** Covers of the bundled shelf cards. Remote cards use character_looks instead. */
export const SHELF_LOCAL_LOOKS: Record<string, ShelfCatalogLook> = {};

export function shelfLocalLook(id: string): ShelfCatalogLook | null {
  return SHELF_LOCAL_LOOKS[id] ?? null;
}
