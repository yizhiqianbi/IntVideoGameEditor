import ids from "./shelf-ai-archive-ids.json";

/** Saved chats may reference these directory cards before their names are loaded. */
export const SHELF_AI_ARCHIVE_IDS: ReadonlySet<string> = new Set(ids);

export function isShelfDeferredAiArchiveId(id: string): boolean {
  return SHELF_AI_ARCHIVE_IDS.has(id);
}
