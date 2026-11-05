/** How long the open chat should wait before reading the session again. */
export function nextCompanionPollDelay(options: {
  failures: number;
  followUp: boolean;
  visible: boolean;
  retryAfterMs?: number;
}): number {
  const failures = Math.max(0, Math.floor(options.failures));
  const visibleBase = options.followUp && failures === 0 ? 2_000 : 8_000;
  const base = options.visible ? visibleBase : 20_000;
  const backedOff = failures === 0 ? base : Math.min(120_000, base * 2 ** Math.min(failures, 4));
  const hinted = options.retryAfterMs !== undefined && Number.isFinite(options.retryAfterMs)
    ? Math.min(120_000, Math.max(0, options.retryAfterMs))
    : 0;
  return Math.max(backedOff, hinted);
}

/** Cold start stays quick on the first miss, then stops hitting /health every second. */
export function nextHealthRetryDelay(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt));
  return Math.min(8_000, 1_000 * 2 ** Math.min(step - 1, 3));
}

/** These answers mean the engine is still booting. The message was not accepted. */
const STARTING_SEND_CODES = new Set(["CONTAINER_STARTING", "NATIVE_NOT_READY"]);
/** A measured pool boot was 17.2s. Eight attempts cover about 45s without a new request id. */
export const STARTING_SEND_ATTEMPTS = 8;
export const TRANSIENT_SEND_ATTEMPTS = 2;

export function sendAttemptLimit(code: string | undefined): number {
  return code && STARTING_SEND_CODES.has(code) ? STARTING_SEND_ATTEMPTS : TRANSIENT_SEND_ATTEMPTS;
}

/** Boot failures retry on the health schedule. Other transient failures stay at 8s. */
export function nextSendRetryDelay(code: string | undefined, attempts: number): number {
  if (code && STARTING_SEND_CODES.has(code)) return nextHealthRetryDelay(attempts + 1);
  return 8_000;
}

/** One reply can run planner, memory, and the spoken answer before any assistant line exists. */
export const REPLY_GRACE_MS = 60_000;

type TranscriptMessage = { id?: string; role?: string; text?: string; requestId?: string; media?: unknown[] };

/** The user line is not the reply. Keep waiting until an assistant message follows it. */
export function assistantRepliedAfter(messages: readonly TranscriptMessage[], requestId: string): boolean {
  const index = messages.findIndex(message => message.id === requestId || message.requestId === requestId);
  if (index < 0) return false;
  return messages.slice(index + 1).some(message => message.role === "assistant" && (
    (typeof message.text === "string" && message.text.trim().length > 0)
    || (Array.isArray(message.media) && message.media.length > 0)
  ));
}

/** A parked chat is readable. Focusing the composer is the moment to start the engine. */
export function shouldWakeParked(parked: boolean | undefined, started: boolean): boolean {
  return parked === true && !started;
}

/** Accepted sends stay inside the first generation until the grace window ends. */
export function generationStillOpen(items: readonly { state: string; createdAt: string }[], now: number): boolean {
  return items.some(item => {
    if (item.state === "queued" || item.state === "sending") return true;
    if (item.state !== "accepted") return false;
    const age = now - Date.parse(item.createdAt);
    return !Number.isFinite(age) || age < REPLY_GRACE_MS;
  });
}

/** A checkpoint wake answers with these codes. The transcript already on screen stays. */
export function quietSessionPoll(code: string | undefined): boolean {
  return code === "CONTAINER_STARTING" || code === "NATIVE_NOT_READY";
}

export function recoveryFacts(value: unknown): { snapshotVerified?: boolean; deliveryAmbiguous?: boolean } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.snapshotVerified === "boolean" ? { snapshotVerified: record.snapshotVerified } : {}),
    ...(typeof record.deliveryAmbiguous === "boolean" ? { deliveryAmbiguous: record.deliveryAmbiguous } : {}),
  };
}

export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, Math.round(seconds * 1000));
  const when = Date.parse(header);
  if (!Number.isFinite(when)) return undefined;
  return Math.min(120_000, Math.max(0, when - now));
}
