import type { DzmmStoryMessage } from "./dzmm-story-memory";
import { latestDzmmWorldSnapshot, resolveDzmmWorldRuntime, type DzmmWorldClockMode } from "./dzmm-world-state";
import { buildXumengLiveSceneFromConversation } from "./xumeng-live-scene";

/** Only a snapshot covering this exact dialogue can claim to describe its current world. */
export function buildXumengLiveConversationHandoff(
  messages: readonly (DzmmStoryMessage & { pending?: boolean })[],
  journal: unknown,
  now: number,
  clockMode: DzmmWorldClockMode = "story",
) {
  const latest = latestDzmmWorldSnapshot(journal, messages);
  const current = latest?.sourceCount === messages.length && !messages.some(row => row.pending)
    ? resolveDzmmWorldRuntime(journal, messages, now, clockMode)?.state : undefined;
  return buildXumengLiveSceneFromConversation(messages, current, "当前角色会话");
}
