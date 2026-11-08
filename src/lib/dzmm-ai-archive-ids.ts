import ids from "./dzmm-ai-archive-ids.json";

/** Saved chats may reference these directory cards before their names are loaded. */
export const DZMM_AI_ARCHIVE_IDS: ReadonlySet<string> = new Set(ids);

export function isDzmmDeferredAiArchiveId(id: string): boolean {
  return DZMM_AI_ARCHIVE_IDS.has(id);
}
