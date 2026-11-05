import { companionClockLabel, companionClockVisible } from "./companion-clock";

export type CompanionThreadSource = {
  id: string;
  createdAt: string;
  kind: "message" | "photo";
};

export type CompanionThreadRow =
  | { kind: "time"; id: string; label: string }
  | { kind: "message" | "photo"; id: string }
  | { kind: "typing"; id: "typing" }
  | { kind: "empty"; id: "empty" }
  | { kind: "stalled"; id: "stalled" };

/** Real transcript rows only. Scripted persona lines are not messages. */
export function buildCompanionThreadRows(
  sources: readonly CompanionThreadSource[],
  options: { typing: boolean; stalled: boolean },
): CompanionThreadRow[] {
  const rows: CompanionThreadRow[] = [];
  let previous: string | undefined;
  for (const source of sources) {
    if (companionClockVisible(source.createdAt, previous)) {
      const label = companionClockLabel(source.createdAt);
      if (label) rows.push({ kind: "time", id: `time:${source.id}`, label });
    }
    rows.push({ kind: source.kind, id: source.id });
    previous = source.createdAt;
  }
  if (options.typing) rows.push({ kind: "typing", id: "typing" });
  if (options.stalled) rows.push({ kind: "stalled", id: "stalled" });
  if (!rows.length) rows.push({ kind: "empty", id: "empty" });
  return rows;
}

type SessionMessage = { id: string; role?: string; text?: string };
type SessionReceipt = { requestId: string; status: string; confirmed?: boolean };
type SessionSnapshot = {
  id: string;
  title?: string;
  status?: string;
  connection?: string;
  error?: string;
  messages?: readonly SessionMessage[];
  receipts?: readonly SessionReceipt[];
};

export type PrefaceLatch = { id: string; show: boolean; at: number };

type PrefaceMessage = { text?: string; createdAt?: string };

/**
 * Default opening lines for a chat that has no earlier transcript.
 * A line the user sends after the empty chat was seen stays below them.
 * A transcript that already existed, or one that arrives with an older time, does not get these lines added.
 */
export function openingPreface(
  lines: readonly string[] | undefined,
  activeId: string | null,
  session: { id: string; messages?: readonly PrefaceMessage[] } | null,
  sessionsKnown: boolean,
  latch: PrefaceLatch | null,
  now: number,
  visible: (message: PrefaceMessage) => boolean,
): { lines: readonly string[]; latch: PrefaceLatch | null } {
  if (!lines?.length || !sessionsKnown) return { lines: [], latch };
  const loaded = Boolean(activeId && session?.id === activeId);
  if (!loaded) {
    if (activeId && latch?.id === activeId) return { lines: latch.show ? lines : [], latch };
    return { lines, latch };
  }
  const at = latch?.id === activeId ? latch.at : now;
  const prior = (session?.messages ?? []).some(message => {
    if (!visible(message)) return false;
    const time = Date.parse(message.createdAt || "");
    return !Number.isFinite(time) || time < at;
  });
  const show = !prior;
  const next = latch?.id === activeId && latch.show === show && latch.at === at ? latch : { id: activeId as string, show, at };
  return { lines: show ? lines : [], latch: next };
}

/** One character has one memory. A later empty or short session does not replace it. */
export function pickCompanionSession<T extends { id: string; messages?: readonly unknown[] }>(sessions: readonly T[], savedId: string | null): T | undefined {
  const saved = savedId ? sessions.find(item => item.id === savedId) : undefined;
  const richest = sessions.reduce<T | undefined>((best, item) => (item.messages?.length ?? 0) > (best?.messages?.length ?? 0) ? item : best, undefined);
  const savedCount = saved?.messages?.length ?? 0;
  const richestCount = richest?.messages?.length ?? 0;
  if (saved && savedCount > 0 && savedCount >= richestCount) return saved;
  if (richestCount > 0) return richest;
  return saved ?? sessions[0];
}

function sameSnapshot(previous: SessionSnapshot, next: SessionSnapshot) {
  if (previous.title !== next.title || previous.status !== next.status || previous.connection !== next.connection || previous.error !== next.error) return false;
  const previousMessages = previous.messages ?? [];
  const nextMessages = next.messages ?? [];
  if (previousMessages.length !== nextMessages.length) return false;
  for (let index = 0; index < previousMessages.length; index += 1) {
    const left = previousMessages[index];
    const right = nextMessages[index];
    if (!left || !right || left.id !== right.id || left.role !== right.role || left.text !== right.text) return false;
  }
  const previousReceipts = previous.receipts ?? [];
  const nextReceipts = next.receipts ?? [];
  if (previousReceipts.length !== nextReceipts.length) return false;
  for (let index = 0; index < previousReceipts.length; index += 1) {
    const left = previousReceipts[index];
    const right = nextReceipts[index];
    if (!left || !right || left.requestId !== right.requestId || left.status !== right.status || Boolean(left.confirmed) !== Boolean(right.confirmed)) return false;
  }
  return true;
}

type MergeMessage = { id: string; createdAt?: string; requestId?: string };

function sameTranscriptMessage(left: MergeMessage, right: MergeMessage) {
  return left.id === right.id
    || Boolean(left.requestId && (left.requestId === right.requestId || left.requestId === right.id))
    || Boolean(right.requestId && (right.requestId === left.requestId || right.requestId === left.id));
}

/** Local lines stay until the cloud copy of the same send arrives. The cloud copy then replaces the local one. */
export function mergeCompanionMessages<T extends MergeMessage>(current: readonly T[], incoming: readonly T[]): T[] {
  const merged: T[] = [];
  const place = (item: T, preferIncoming: boolean) => {
    const index = merged.findIndex(existing => sameTranscriptMessage(existing, item));
    if (index < 0) merged.push(item);
    else if (preferIncoming) merged[index] = { ...merged[index], ...item, requestId: item.requestId || merged[index].requestId };
  };
  for (const item of current) place(item, false);
  for (const item of incoming) place(item, true);
  if (!merged.every(item => Number.isFinite(Date.parse(item.createdAt || "")))) return merged;
  return merged.sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "") || left.id.localeCompare(right.id));
}

/** Cloud fields replace the same line. A later read that omits a line, or arrives under a new session id, does not drop the cache. An unchanged read returns the same object. */
export function applyCompanionSession<T extends SessionSnapshot>(previous: T | null, next: T): T {
  if (!previous) return next;
  const merged = { ...next, messages: mergeCompanionMessages(previous.messages ?? [], next.messages ?? []) } as T;
  if (previous.id === next.id && sameSnapshot(previous, merged)) return previous;
  return merged;
}
