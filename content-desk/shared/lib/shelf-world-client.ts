import { appendShelfWorldSnapshot, parseShelfWorldJournal, pruneShelfWorldJournal, type ShelfWorldJournal } from "./shelf-world-state";
import type { ShelfStoryMessage } from "./shelf-story-memory";

/** Rebind a copied conversation to its new message IDs without carrying unrelated branches. */
export function rebindShelfWorldJournal(journal: unknown, original: readonly ShelfStoryMessage[],
  copied: readonly ShelfStoryMessage[]): ShelfWorldJournal | undefined {
  const valid = pruneShelfWorldJournal(journal, original);
  if (!valid || copied.length !== original.length || copied.some((message, index) =>
    message.role !== original[index].role || message.content !== original[index].content)) return undefined;
  let rebound: ShelfWorldJournal = parseShelfWorldJournal({ version: 1, snapshots: [],
    ...(valid.modeChanges !== undefined ? { modeChanges: valid.modeChanges } : {}) });
  for (const snapshot of valid.snapshots) rebound = appendShelfWorldSnapshot(rebound,
    copied.slice(0, snapshot.sourceCount), snapshot.state, snapshot.recordedAt, snapshot.clockMode);
  return rebound;
}
