import ids from "./shelf-public-introduction-ids.json";

/** Saved chats may reference these archive ids before their shelf text is loaded. */
export const SHELF_PUBLIC_INTRODUCTION_IDS: ReadonlySet<string> = new Set(ids);

export function isShelfDeferredIntroductionId(id: string): boolean {
  return SHELF_PUBLIC_INTRODUCTION_IDS.has(id);
}
