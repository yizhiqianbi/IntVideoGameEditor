/**
 * SillyTavern-compatible world book (character book) activation.
 *
 * Behaviour is modelled on the documented ST world-info semantics: keyword and
 * secondary-key matching with four selective logics, whole-word and regex
 * keys, constant entries, probability, groups, recursion rounds, token budget,
 * sticky/cooldown/delay and depth/role insertion positions. This module is a
 * clean implementation over the public card fields; it never executes card
 * scripts.
 */

export const TAVERN_SELECTIVE_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3,
} as const;
export type TavernSelectiveLogic = (typeof TAVERN_SELECTIVE_LOGIC)[keyof typeof TAVERN_SELECTIVE_LOGIC];

/** ST position values. 0/1 are the v2 card positions; 2-4 are insertion modes. */
export const TAVERN_ENTRY_POSITION = {
  BEFORE_CHAR: 0,
  AFTER_CHAR: 1,
  AN_TOP: 2,
  AN_BOTTOM: 3,
  AT_DEPTH: 4,
} as const;
export type TavernEntryPosition = (typeof TAVERN_ENTRY_POSITION)[keyof typeof TAVERN_ENTRY_POSITION];

export const TAVERN_ENTRY_ROLE = { system: 0, user: 1, assistant: 2 } as const;
export type TavernEntryRole = keyof typeof TAVERN_ENTRY_ROLE;

export type TavernWorldbookEntry = {
  id: string;
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: TavernSelectiveLogic;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
  order: number;
  position: TavernEntryPosition;
  depth: number;
  role: TavernEntryRole;
  probability: number;
  useProbability: boolean;
  group: string;
  groupWeight: number;
  preventRecursion: boolean;
  excludeRecursion: boolean;
  delayUntilRecursion: boolean;
  scanDepth?: number;
  sticky: number;
  cooldown: number;
  delay: number;
  useBudget: boolean;
};

export type TavernWorldbook = {
  name: string;
  description: string;
  scanDepth?: number;
  entries: TavernWorldbookEntry[];
};

export type TavernActivationMessage = { role: "user" | "assistant" | "system"; content: string };

export type TavernActivationStateValue = {
  /** Turn number the entry last triggered, used by sticky/cooldown/delay. */
  lastTurn?: number;
};

export type TavernActivationOptions = {
  /** Number of recent messages used for keyword scanning. Overrides the book value. */
  scanDepth?: number;
  /** Extra text that participates in scanning (for example the pending user input). */
  extraScanText?: string;
  /** Maximum recursion rounds, including the first. ST defaults to 2. */
  recursionLimit?: number;
  /** Token budget for activated content. 0 disables budgeting. */
  tokenBudget?: number;
  /** Monotonic turn counter used by sticky/cooldown/delay. */
  turn?: number;
  /** Deterministic seed for probability rolls. Same seed produces the same set. */
  seed?: number;
  /** Per-entry activation history. Omit to ignore sticky/cooldown/delay. */
  state?: Readonly<Record<string, TavernActivationStateValue>>;
};

export type TavernSkippedEntry = { id: string; reason: "disabled" | "no-match" | "probability" | "group" | "recursion" | "budget" | "cooldown" | "delay" };

export type TavernActivationResult = {
  /** Entries injected in front of the character definition. */
  beforeChar: TavernWorldbookEntry[];
  /** Entries injected after the character definition (after_char and AN positions). */
  afterChar: TavernWorldbookEntry[];
  /** Entries injected at a chat depth with an explicit role. */
  atDepth: Array<{ entry: TavernWorldbookEntry; depth: number; role: TavernEntryRole }>;
  /** Every entry that survived matching and budget, in insertion order. */
  activated: TavernWorldbookEntry[];
  skipped: TavernSkippedEntry[];
  /** Approximate token cost of the injected content. */
  estimatedTokens: number;
  warnings: string[];
  /** Entry ids that should be recorded in the activation state for sticky/cooldown. */
  activatedIds: string[];
};

const ENTRY_LIMIT = 1000;
const CONTENT_LIMIT = 100_000;
const KEY_LIMIT = 20;
const KEY_CHARS = 160;

const DEFAULT_SCAN_DEPTH = 10;
const DEFAULT_RECURSION_LIMIT = 2;
const DEFAULT_STICKY = 0;
/** Untrusted cards may contain pathological regex keys; cap pattern length and
 * the text a regex is allowed to scan so a card cannot stall the worker. */
const REGEX_KEY_MAX_CHARS = 200;
const REGEX_SCAN_MAX_CHARS = 12_000;
const DEFAULT_COOLDOWN = 0;
const DEFAULT_DELAY = 0;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, max: number): string {
  return typeof value === "string" && value.length <= max && !value.includes("\0") ? value : "";
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const text = str(item, KEY_CHARS).trim();
    return text ? [text] : [];
  }).slice(0, KEY_LIMIT);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(value, fallback, min, max));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** v2 cards use string positions; ST internal uses numbers. */
export function parseTavernPosition(value: unknown, extensionPosition?: unknown): TavernEntryPosition {
  if (typeof value === "string") {
    if (value === "before_char") return TAVERN_ENTRY_POSITION.BEFORE_CHAR;
    if (value === "after_char") return TAVERN_ENTRY_POSITION.AFTER_CHAR;
    if (value === "at_depth") return TAVERN_ENTRY_POSITION.AT_DEPTH;
    if (value === "an_top") return TAVERN_ENTRY_POSITION.AN_TOP;
    if (value === "an_bottom") return TAVERN_ENTRY_POSITION.AN_BOTTOM;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4) return value as TavernEntryPosition;
  if (typeof extensionPosition === "number" && Number.isInteger(extensionPosition) && extensionPosition >= 0 && extensionPosition <= 4) {
    return extensionPosition as TavernEntryPosition;
  }
  return TAVERN_ENTRY_POSITION.BEFORE_CHAR;
}

export function parseTavernRole(value: unknown): TavernEntryRole {
  if (value === 1 || value === "user") return "user";
  if (value === 2 || value === "assistant") return "assistant";
  return "system";
}

function parseSelectiveLogic(value: unknown): TavernSelectiveLogic {
  if (value === 1 || value === 2 || value === 3) return value as TavernSelectiveLogic;
  return TAVERN_SELECTIVE_LOGIC.AND_ANY;
}

/**
 * Parse one raw world-book entry. Accepts the v2/v3 card shape as well as the
 * flatter ST internal shape, so imports from either source are lossless for the
 * fields this engine supports.
 */
export function parseTavernWorldbookEntry(value: unknown, index = 0): TavernWorldbookEntry | null {
  if (!record(value)) return null;
  const content = str(value.content, CONTENT_LIMIT);
  if (!content.trim()) return null;
  const extensions = record(value.extensions) ? value.extensions : {};
  const keys = strList(value.keys ?? value.key);
  const secondaryKeys = strList(value.secondary_keys ?? value.keysecondary ?? value.secondaryKeys ?? extensions.secondary_keys);
  const rawId = value.id ?? value.uid;
  const id = typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId)
    : typeof rawId === "string" && rawId.trim() && rawId.length <= 120 && !rawId.includes("\0") ? rawId.trim()
      : `entry-${index}`;
  const position = parseTavernPosition(value.position, extensions.position);
  const role = parseTavernRole(value.role ?? extensions.role);
  const selective = bool(value.selective, false);
  const constant = bool(value.constant, false);
  return {
    id,
    comment: str(value.comment ?? value.name, 200),
    keys,
    secondaryKeys,
    content,
    enabled: bool(value.enabled, true),
    constant,
    selective,
    selectiveLogic: parseSelectiveLogic(value.selectiveLogic ?? value.selective_logic ?? extensions.selectiveLogic),
    caseSensitive: bool(value.case_sensitive ?? value.caseSensitive, false),
    matchWholeWords: bool(value.match_whole_words ?? value.matchWholeWords ?? extensions.match_whole_words, false),
    useRegex: bool(value.use_regex ?? value.useRegex ?? extensions.use_regex, false),
    order: int(value.insertion_order ?? value.insertionOrder ?? value.order, index, -1_000_000, 1_000_000),
    position,
    depth: int(value.depth ?? extensions.depth, 4, 0, 10_000),
    role,
    probability: int(value.probability, 100, 0, 100),
    useProbability: bool(value.useProbability ?? value.use_probability, false),
    group: str(value.group ?? extensions.group, 120),
    groupWeight: num(value.group_weight ?? value.groupWeight ?? extensions.group_weight, 100, 0, 10_000),
    preventRecursion: bool(value.prevent_recursion ?? value.preventRecursion ?? extensions.prevent_recursion, false),
    excludeRecursion: bool(value.exclude_recursion ?? value.excludeRecursion ?? extensions.exclude_recursion, false),
    delayUntilRecursion: bool(value.delay_until_recursion ?? value.delayUntilRecursion ?? extensions.delay_until_recursion, false),
    scanDepth: typeof (value.scan_depth ?? value.scanDepth) === "number" ? int(value.scan_depth ?? value.scanDepth, DEFAULT_SCAN_DEPTH, 1, 1000) : undefined,
    sticky: int(value.sticky ?? extensions.sticky, DEFAULT_STICKY, 0, 1000),
    cooldown: int(value.cooldown ?? extensions.cooldown, DEFAULT_COOLDOWN, 0, 1000),
    delay: int(value.delay ?? extensions.delay, DEFAULT_DELAY, 0, 1000),
    useBudget: bool(value.use_budget ?? value.useBudget ?? extensions.use_budget, true),
  };
}

export function parseTavernWorldbook(value: unknown): TavernWorldbook {
  const book = record(value) ? value : {};
  const rawEntries = Array.isArray(book.entries) ? book.entries : [];
  const entries: TavernWorldbookEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.min(rawEntries.length, ENTRY_LIMIT); index++) {
    const entry = parseTavernWorldbookEntry(rawEntries[index], index);
    if (!entry) continue;
    let id = entry.id;
    let suffix = 2;
    while (seen.has(id)) id = `${entry.id}#${suffix++}`;
    seen.add(id);
    entries.push(entry.id === id ? entry : { ...entry, id });
  }
  const scanDepth = typeof book.scan_depth === "number"
    ? int(book.scan_depth, DEFAULT_SCAN_DEPTH, 1, 1000)
    : typeof book.scanDepth === "number" ? int(book.scanDepth, DEFAULT_SCAN_DEPTH, 1, 1000) : undefined;
  return {
    name: str(book.name, 200),
    description: str(book.description, 2000),
    ...(scanDepth !== undefined ? { scanDepth } : {}),
    entries,
  };
}

/** Rough token estimate: CJK characters cost one token each, other text ~4 chars. */
export function estimateTavernTokens(text: string): number {
  let tokens = 0;
  for (const character of text) {
    tokens += /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u.test(character) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

function hashSeed(seed: number, id: string): number {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function probabilityAllows(seed: number, entry: TavernWorldbookEntry): boolean {
  if (!entry.useProbability || entry.probability >= 100) return true;
  if (entry.probability <= 0) return false;
  return (hashSeed(seed, entry.id) % 100) < entry.probability;
}

type CompiledKey = { test: (haystack: string) => boolean; warning?: string };

function compileKey(key: string, entry: TavernWorldbookEntry): CompiledKey | null {
  if (!key) return null;
  const pattern = entry.matchWholeWords ? `(?<![\\p{L}\\p{N}])${escapeRegExp(key)}(?![\\p{L}\\p{N}])` : escapeRegExp(key);
  if (entry.useRegex) {
    if (key.length > REGEX_KEY_MAX_CHARS) {
      return { test: (haystack) => haystack.includes(key), warning: `世界书条目 ${entry.id} 的正则关键词过长，已按普通关键词匹配。` };
    }
    try {
      const regex = new RegExp(key, entry.caseSensitive ? "u" : "iu");
      return { test: (haystack) => regex.test(haystack.slice(0, REGEX_SCAN_MAX_CHARS)) };
    } catch {
      return { test: (haystack) => haystack.includes(key), warning: `世界书条目 ${entry.id} 的正则关键词无效，已按普通关键词匹配：${key}` };
    }
  }
  if (!entry.matchWholeWords) {
    const needle = normalize(key, entry.caseSensitive);
    return { test: (haystack) => haystack.includes(needle) };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, entry.caseSensitive ? "u" : "iu");
  } catch {
    const needle = normalize(key, entry.caseSensitive);
    return { test: (haystack) => haystack.includes(needle) };
  }
  return { test: (haystack) => regex.test(haystack) };
}

type CompiledEntry = { entry: TavernWorldbookEntry; primary: CompiledKey[]; secondary: CompiledKey[]; warnings: string[] };

function compileEntry(entry: TavernWorldbookEntry): CompiledEntry {
  const warnings: string[] = [];
  const compile = (key: string) => {
    const compiled = compileKey(key, entry);
    if (compiled?.warning) warnings.push(compiled.warning);
    return compiled;
  };
  return {
    entry,
    primary: entry.keys.map(compile).filter((item): item is CompiledKey => Boolean(item)),
    secondary: entry.secondaryKeys.map(compile).filter((item): item is CompiledKey => Boolean(item)),
    warnings,
  };
}

function selectiveMatches(compiled: CompiledEntry, haystack: string): boolean {
  const { entry } = compiled;
  const primaryMatch = entry.constant || compiled.primary.some(key => key.test(haystack));
  if (!primaryMatch) return false;
  if (!entry.selective || compiled.secondary.length === 0) return true;
  const secondary = compiled.secondary;
  switch (entry.selectiveLogic) {
    case TAVERN_SELECTIVE_LOGIC.AND_ALL:
      return secondary.every(key => key.test(haystack));
    case TAVERN_SELECTIVE_LOGIC.NOT_ALL:
      return !secondary.every(key => key.test(haystack));
    case TAVERN_SELECTIVE_LOGIC.NOT_ANY:
      return !secondary.some(key => key.test(haystack));
    default:
      return secondary.some(key => key.test(haystack));
  }
}

function scanText(messages: ReadonlyArray<TavernActivationMessage>, depth: number, extra?: string): string {
  const recent = messages.slice(-Math.max(1, depth)).map(message => message.content).join("\n");
  return extra ? `${recent}\n${extra}` : recent;
}

type Candidate = { compiled: CompiledEntry; round: number };

/**
 * Activate a world book for one turn. Deterministic for a given message list,
 * seed and state: the same inputs always produce the same injected entries.
 */
export function activateTavernWorldbook(
  book: TavernWorldbook,
  messages: ReadonlyArray<TavernActivationMessage>,
  options: TavernActivationOptions = {},
): TavernActivationResult {
  const depth = Math.max(1, options.scanDepth ?? book.scanDepth ?? DEFAULT_SCAN_DEPTH);
  const recursionLimit = Math.max(1, Math.min(5, options.recursionLimit ?? DEFAULT_RECURSION_LIMIT));
  const turn = options.turn ?? 0;
  const seed = options.seed ?? turn;
  const state = options.state ?? {};
  const skipped: TavernSkippedEntry[] = [];
  const warnings: string[] = [];
  const compiled = book.entries.map(compileEntry);
  const activated = new Map<string, Candidate>();
  const blocked = new Map<string, "no-match" | "probability" | "cooldown" | "delay" | "recursion">();


  function consider(candidate: CompiledEntry, round: number, fromRecursion: boolean, source: string) {
    const { entry } = candidate;
    if (activated.has(entry.id) || !entry.enabled) return;
    const history = state[entry.id];
    if (entry.sticky > 0 && history?.lastTurn !== undefined && turn - history.lastTurn <= entry.sticky) {
      activated.set(entry.id, { compiled: candidate, round });
      return;
    }
    if (entry.delay > 0 && (!history?.lastTurn || turn - history.lastTurn < entry.delay)) {
      blocked.set(entry.id, "delay");
      return;
    }
    if (entry.cooldown > 0 && history?.lastTurn !== undefined && turn - history.lastTurn <= entry.cooldown) {
      blocked.set(entry.id, "cooldown");
      return;
    }
    if (fromRecursion && entry.excludeRecursion) return;
    if (entry.delayUntilRecursion && !fromRecursion) {
      blocked.set(entry.id, "delay");
      return;
    }
    const scan = entry.caseSensitive ? source : source.toLowerCase();
    if (!selectiveMatches(candidate, scan)) {
      blocked.set(entry.id, "no-match");
      return;
    }
    if (!probabilityAllows(seed, entry)) {
      blocked.set(entry.id, "probability");
      return;
    }
    activated.set(entry.id, { compiled: candidate, round });
  }

  // Round 1 scans conversation text; later rounds also scan activated content.
  let roundText = scanText(messages, depth, options.extraScanText);
  for (let round = 0; round < recursionLimit; round++) {
    for (const candidate of compiled) consider(candidate, round + 1, round > 0, roundText);
    const recursionSource = [...activated.values()]
      .filter(item => !item.compiled.entry.preventRecursion)
      .map(item => item.compiled.entry.content)
      .join("\n");
    if (!recursionSource) break;
    roundText = `${roundText}\n${recursionSource}`;
    if (round + 1 < recursionLimit) {
      for (const candidate of compiled) {
        const scan = candidate.entry.caseSensitive ? roundText : roundText.toLowerCase();
        if (!activated.has(candidate.entry.id) && selectiveMatches(candidate, scan)) consider(candidate, round + 2, true, roundText);
      }
    }
  }

  // Group resolution: only the highest-weight entry per group survives.
  const selected = new Map<string, Candidate>();
  const groups = new Map<string, Candidate[]>();
  for (const candidate of activated.values()) {
    const group = candidate.compiled.entry.group;
    if (!group) {
      selected.set(candidate.compiled.entry.id, candidate);
      continue;
    }
    const list = groups.get(group) ?? [];
    list.push(candidate);
    groups.set(group, list);
  }
  for (const [group, list] of groups) {
    const sorted = [...list].sort((left, right) => right.compiled.entry.groupWeight - left.compiled.entry.groupWeight
      || left.compiled.entry.order - right.compiled.entry.order);
    selected.set(sorted[0].compiled.entry.id, sorted[0]);
    for (const loser of sorted.slice(1)) skipped.push({ id: loser.compiled.entry.id, reason: "group" });
  }

  // Insertion order is the full order number; ties keep card order.
  const ordered = [...selected.values()].sort((left, right) => left.compiled.entry.order - right.compiled.entry.order
    || left.compiled.entry.id.localeCompare(right.compiled.entry.id));
  for (const candidate of compiled) {
    const entry = candidate.entry;
    if (activated.has(entry.id)) continue;
    if (!entry.enabled) skipped.push({ id: entry.id, reason: "disabled" });
    else if (blocked.has(entry.id)) skipped.push({ id: entry.id, reason: blocked.get(entry.id) as TavernSkippedEntry["reason"] });
    else skipped.push({ id: entry.id, reason: "recursion" });
  }

  // Budget applies only to entries that opt in, in insertion order.
  const tokenBudget = Math.max(0, options.tokenBudget ?? 0);
  const budgeted: Candidate[] = [];
  let usedTokens = 0;
  let budgetWarnings = 0;
  for (const candidate of ordered) {
    const entry = candidate.compiled.entry;
    const cost = estimateTavernTokens(entry.content);
    if (tokenBudget > 0 && entry.useBudget && usedTokens + cost > tokenBudget) {
      skipped.push({ id: entry.id, reason: "budget" });
      budgetWarnings++;
      continue;
    }
    usedTokens += cost;
    budgeted.push(candidate);
  }
  if (budgetWarnings > 0) warnings.push(`世界书超出 token 预算，已跳过 ${budgetWarnings} 条。`);
  for (const candidate of budgeted) for (const warning of candidate.compiled.warnings) warnings.push(warning);

  const beforeChar: TavernWorldbookEntry[] = [];
  const afterChar: TavernWorldbookEntry[] = [];
  const atDepth: Array<{ entry: TavernWorldbookEntry; depth: number; role: TavernEntryRole }> = [];
  for (const candidate of budgeted) {
    const entry = candidate.compiled.entry;
    switch (entry.position) {
      case TAVERN_ENTRY_POSITION.BEFORE_CHAR:
        beforeChar.push(entry);
        break;
      case TAVERN_ENTRY_POSITION.AT_DEPTH:
        atDepth.push({ entry, depth: entry.depth, role: entry.role });
        break;
      default:
        afterChar.push(entry);
        break;
    }
  }
  atDepth.sort((left, right) => right.depth - left.depth || left.entry.order - right.entry.order);

  return {
    beforeChar,
    afterChar,
    atDepth,
    activated: budgeted.map(candidate => candidate.compiled.entry),
    skipped,
    estimatedTokens: usedTokens,
    warnings,
    activatedIds: budgeted.map(candidate => candidate.compiled.entry.id),
  };
}

/** Fold the previous activation state and the current turn into the next state. */
export function nextTavernActivationState(
  previous: Readonly<Record<string, TavernActivationStateValue>> | undefined,
  result: TavernActivationResult,
  turn: number,
): Record<string, TavernActivationStateValue> {
  const next: Record<string, TavernActivationStateValue> = { ...(previous ?? {}) };
  for (const id of result.activatedIds) next[id] = { lastTurn: turn };
  return next;
}
