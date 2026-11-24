/** Model-authored story facts. This module validates and schedules memory; it never infers facts. */
export type ShelfStoryState = {
  summary: string;
  scene: string;
  completed: string[];
  pending: string[];
  relationships: string[];
  items: string[];
};

export type ShelfStoryMemory = {
  version: 1;
  sourceCount: number;
  sourceFingerprint: string;
  state: ShelfStoryState;
};

export type ShelfStoryMessage = {
  role: "user" | "assistant";
  content: string;
  id?: string;
};

export type ShelfMemoryUpdate = {
  messagesToSummarize: ShelfStoryMessage[];
  sourcePrefix: ShelfStoryMessage[];
  previousState?: ShelfStoryState;
};

export const SHELF_STORY_STATE_LIMIT_CHARS = 6_000;
export const SHELF_STORY_SUMMARY_LIMIT_CHARS = 2_400;
export const SHELF_STORY_SCENE_LIMIT_CHARS = 1_000;
export const SHELF_STORY_LIST_MAX_ITEMS = 12;
export const SHELF_STORY_ITEM_LIMIT_CHARS = 400;
export const SHELF_MEMORY_TAIL_WINDOW = 40;
export const SHELF_MEMORY_MIN_RAW_MESSAGES = 28;
export const SHELF_MEMORY_BATCH_MAX_MESSAGES = 24;
export const SHELF_MEMORY_BATCH_LIMIT_CHARS = 24_000;

const STORY_LIST_FIELDS = ["completed", "pending", "relationships", "items"] as const;
const FINGERPRINT_PATTERN = /^shelf-v1-[a-f0-9]{32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFields(value: Record<string, unknown>, fields: readonly string[], label: string) {
  if (Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !fields.includes(field))) {
    throw new Error(`${label}字段无效。`);
  }
}

function readText(value: unknown, maximum: number, label: string, required = false): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")
    || (required && !value.trim())) {
    throw new Error(`${label}应为不超过 ${maximum} 字的${required ? "非空" : ""}文本。`);
  }
  // Preserve the exact model-authored text; validation must not invent or rewrite story facts.
  return value;
}

/** Reject unsupported fields and oversized model output instead of silently truncating facts. */
export function parseStoryState(value: unknown): ShelfStoryState {
  if (!isRecord(value)) throw new Error("剧情状态格式无效。");
  assertFields(value, ["summary", "scene", ...STORY_LIST_FIELDS], "剧情状态");
  const lists = {} as Pick<ShelfStoryState, typeof STORY_LIST_FIELDS[number]>;
  for (const field of STORY_LIST_FIELDS) {
    const list = value[field];
    if (!Array.isArray(list) || list.length > SHELF_STORY_LIST_MAX_ITEMS) {
      throw new Error(`剧情状态的 ${field} 应包含不超过 ${SHELF_STORY_LIST_MAX_ITEMS} 条记录。`);
    }
    lists[field] = Array.from(list, item => readText(item, SHELF_STORY_ITEM_LIMIT_CHARS, `剧情状态的 ${field}`, true));
  }
  const state: ShelfStoryState = {
    summary: readText(value.summary, SHELF_STORY_SUMMARY_LIMIT_CHARS, "剧情摘要"),
    scene: readText(value.scene, SHELF_STORY_SCENE_LIMIT_CHARS, "当前场景"),
    ...lists,
  };
  if (JSON.stringify(state).length > SHELF_STORY_STATE_LIMIT_CHARS) {
    throw new Error(`剧情状态总量不得超过 ${SHELF_STORY_STATE_LIMIT_CHARS} 字。`);
  }
  return state;
}

export function parseStoryMemory(value: unknown): ShelfStoryMemory {
  if (!isRecord(value)) throw new Error("剧情记忆格式无效。");
  assertFields(value, ["version", "sourceCount", "sourceFingerprint", "state"], "剧情记忆");
  if (value.version !== 1 || typeof value.sourceCount !== "number"
    || !Number.isSafeInteger(value.sourceCount) || value.sourceCount < 1
    || typeof value.sourceFingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.sourceFingerprint)) {
    throw new Error("剧情记忆版本或来源标记无效。");
  }
  return {
    version: 1,
    sourceCount: value.sourceCount,
    sourceFingerprint: value.sourceFingerprint,
    state: parseStoryState(value.state),
  };
}

function copyMessage(value: ShelfStoryMessage): ShelfStoryMessage {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant")) {
    throw new Error("剧情记忆的来源消息格式无效。");
  }
  const content = readText(value.content, 12_000, "来源消息", true);
  const id = value.id === undefined ? undefined : readText(value.id, 120, "来源消息 ID", true);
  return { role: value.role, content, ...(id === undefined ? {} : { id }) };
}

/**
 * Synchronous 128-bit accidental-invalidation cache key, usable in browsers and Workers.
 * This is NOT a cryptographic digest, authentication proof, or trust boundary.
 * Canonical tuples include exact role/content and ID presence/value, so edits, deletions,
 * regenerated turns, and branches with new IDs invalidate the previously covered prefix.
 */
export function fingerprintShelfStoryMessages(messages: readonly ShelfStoryMessage[]): string {
  const canonical = JSON.stringify(Array.from(messages, value => {
    const message = copyMessage(value);
    return [message.role, message.content, message.id === undefined ? 0 : 1, message.id ?? ""];
  }));
  // cyrb128; no asynchronous Web Crypto or platform-specific dependency is needed.
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < canonical.length; index++) {
    const code = canonical.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  const hashes = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1];
  return `shelf-v1-${hashes.map(hash => (hash >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

export function createShelfStoryMemory(state: unknown, messagesPrefix: readonly ShelfStoryMessage[]): ShelfStoryMemory {
  if (!messagesPrefix.length) throw new Error("剧情记忆必须来源于至少一条原始消息。");
  return {
    version: 1,
    sourceCount: messagesPrefix.length,
    sourceFingerprint: fingerprintShelfStoryMessages(messagesPrefix),
    state: parseStoryState(state),
  };
}

/** Raw turns after the covered prefix may change without invalidating earlier established facts. */
export function matchesShelfStoryMemory(memory: unknown, fullHistory: readonly ShelfStoryMessage[]): boolean {
  try {
    const parsed = parseStoryMemory(memory);
    return parsed.sourceCount <= fullHistory.length
      && parsed.sourceFingerprint === fingerprintShelfStoryMessages(fullHistory.slice(0, parsed.sourceCount));
  } catch {
    return false;
  }
}

/**
 * Schedule one bounded model update. Call again with the returned memory until the needed
 * prefix is covered. Normal overflow leaves 28 recent raw turns; a context-budget cutoff
 * may request more coverage, while always retaining the latest turn verbatim.
 * Invalid memory is discarded: rebuilding starts from original messages without stale facts.
 */
export function selectShelfMemoryUpdate(
  fullHistory: readonly ShelfStoryMessage[],
  existingMemory?: unknown,
  options: { minimumSourceCount?: number } = {},
): ShelfMemoryUpdate | null {
  const requested = options.minimumSourceCount ?? 0;
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new Error("剧情记忆的最小覆盖条数无效。");
  }
  const previous = matchesShelfStoryMemory(existingMemory, fullHistory) ? parseStoryMemory(existingMemory) : undefined;
  const covered = previous?.sourceCount ?? 0;
  const normalTarget = fullHistory.length - covered > SHELF_MEMORY_TAIL_WINDOW
    ? fullHistory.length - SHELF_MEMORY_MIN_RAW_MESSAGES : covered;
  const target = Math.min(Math.max(normalTarget, requested), fullHistory.length - 1);
  if (target <= covered) return null;

  const sourcePrefix = fullHistory.slice(0, covered).map(copyMessage);
  const messagesToSummarize: ShelfStoryMessage[] = [];
  let chars = 0;
  for (let index = covered; index < target && messagesToSummarize.length < SHELF_MEMORY_BATCH_MAX_MESSAGES; index++) {
    const message = copyMessage(fullHistory[index]);
    if (chars + message.content.length > SHELF_MEMORY_BATCH_LIMIT_CHARS) break;
    chars += message.content.length;
    sourcePrefix.push(message);
    messagesToSummarize.push(message);
  }
  return { messagesToSummarize, sourcePrefix, ...(previous ? { previousState: previous.state } : {}) };
}
