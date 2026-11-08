import ids from "./dzmm-public-introduction-ids.json";

/** Saved chats may reference these archive ids before their shelf text is loaded. */
export const DZMM_PUBLIC_INTRODUCTION_IDS: ReadonlySet<string> = new Set(ids);

export function isDzmmDeferredIntroductionId(id: string): boolean {
  return DZMM_PUBLIC_INTRODUCTION_IDS.has(id);
}
