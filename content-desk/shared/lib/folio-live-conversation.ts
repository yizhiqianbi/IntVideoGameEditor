import type { ShelfStoryMessage } from "./shelf-story-memory";
import { latestShelfWorldSnapshot, resolveShelfWorldRuntime, type ShelfWorldClockMode } from "./shelf-world-state";
import { buildFolioLiveSceneFromConversation } from "./folio-live-scene";

/** Only a snapshot covering this exact dialogue can claim to describe its current world. */
export function buildFolioLiveConversationHandoff(
  messages: readonly (ShelfStoryMessage & { pending?: boolean })[],
  journal: unknown,
  now: number,
  clockMode: ShelfWorldClockMode = "story",
) {
  const latest = latestShelfWorldSnapshot(journal, messages);
  const current = latest?.sourceCount === messages.length && !messages.some(row => row.pending)
    ? resolveShelfWorldRuntime(journal, messages, now, clockMode)?.state : undefined;
  return buildFolioLiveSceneFromConversation(messages, current, "当前角色会话");
}
