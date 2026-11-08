import { appendDzmmWorldSnapshot, parseDzmmWorldJournal, pruneDzmmWorldJournal, type DzmmWorldJournal } from "./dzmm-world-state";
import type { DzmmStoryMessage } from "./dzmm-story-memory";

/** Rebind a copied conversation to its new message IDs without carrying unrelated branches. */
export function rebindDzmmWorldJournal(journal: unknown, original: readonly DzmmStoryMessage[],
  copied: readonly DzmmStoryMessage[]): DzmmWorldJournal | undefined {
  const valid = pruneDzmmWorldJournal(journal, original);
  if (!valid || copied.length !== original.length || copied.some((message, index) =>
    message.role !== original[index].role || message.content !== original[index].content)) return undefined;
  let rebound: DzmmWorldJournal = parseDzmmWorldJournal({ version: 1, snapshots: [],
    ...(valid.modeChanges !== undefined ? { modeChanges: valid.modeChanges } : {}) });
  for (const snapshot of valid.snapshots) rebound = appendDzmmWorldSnapshot(rebound,
    copied.slice(0, snapshot.sourceCount), snapshot.state, snapshot.recordedAt, snapshot.clockMode);
  return rebound;
}
