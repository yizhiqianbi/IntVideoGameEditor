/**
 * Canonical SillyTavern character-card model (spec v2/v3) and conversion to the
 * context shape this project stores today.
 *
 * The parser is lossless for the fields the engine understands and preserves
 * unknown extensions verbatim so an imported card can be exported again. Fields
 * the engine cannot honour are reported instead of being silently dropped.
 */

import type { DzmmCharacterContext } from "../dzmm-character-context";
import {
  TAVERN_ENTRY_POSITION,
  parseTavernWorldbook,
  type TavernEntryPosition,
  type TavernEntryRole,
  type TavernWorldbook,
  type TavernWorldbookEntry,
} from "./worldbook";

export const TAVERN_CARD_SPEC_V2 = "chara_card_v2";
export const TAVERN_CARD_SPEC_V3 = "chara_card_v3";
export const TAVERN_CARD_SPEC_VERSION = "3.0";

export type TavernCardData = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  character_book?: TavernWorldbook;
  extensions: Record<string, unknown>;
};

export type TavernCard = {
  spec: typeof TAVERN_CARD_SPEC_V2 | typeof TAVERN_CARD_SPEC_V3;
  spec_version: string;
  data: TavernCardData;
};

/** Minimal source shape; matches both `Character` and the stored context. */
export type TavernCardSource = Partial<DzmmCharacterContext> & {
  name?: string;
  author?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  tags?: string[];
  characterVersion?: string;
  /** Raw ST extensions when the caller already has them. */
  extensions?: Record<string, unknown>;
};

export type TavernCompatibilityReport = {
  supported: string[];
  unsupported: string[];
  warnings: string[];
};

const PROSE_LIMIT = 100_000;
const GREETING_LIMIT = 20;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, max = PROSE_LIMIT): string {
  return typeof value === "string" && value.length <= max && !value.includes("\0") ? value : "";
}

function list(value: unknown, max = GREETING_LIMIT): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const text = str(item);
    return text.trim() ? [text] : [];
  }).slice(0, max);
}

function bookFromSource(source: TavernCardSource): TavernWorldbook | undefined {
  if (source.characterBook) return source.characterBook as TavernWorldbook;
  const raw = source.extensions?.character_book;
  return raw ? parseTavernWorldbook(raw) : undefined;
}

function v2Position(position: TavernEntryPosition): "before_char" | "after_char" {
  return position === TAVERN_ENTRY_POSITION.AFTER_CHAR ? "after_char" : "before_char";
}

function roleName(role: TavernEntryRole): number {
  return role === "user" ? 1 : role === "assistant" ? 2 : 0;
}

/** Convert a world book back to the v3 card shape without losing extension data. */
export function serializeTavernWorldbook(book: TavernWorldbook): Record<string, unknown> {
  return {
    name: book.name,
    description: book.description,
    ...(book.scanDepth !== undefined ? { scan_depth: book.scanDepth } : {}),
    entries: book.entries.map(entry => ({
      id: entry.id,
      keys: entry.keys,
      secondary_keys: entry.secondaryKeys,
      comment: entry.comment,
      content: entry.content,
      constant: entry.constant,
      selective: entry.selective,
      insertion_order: entry.order,
      enabled: entry.enabled,
      ...(entry.position === TAVERN_ENTRY_POSITION.BEFORE_CHAR || entry.position === TAVERN_ENTRY_POSITION.AFTER_CHAR
        ? { position: v2Position(entry.position) }
        : {}),
      case_sensitive: entry.caseSensitive,
      use_regex: entry.useRegex,
      match_whole_words: entry.matchWholeWords,
      selective_logic: entry.selectiveLogic,
      probability: entry.probability,
      use_probability: entry.useProbability,
      group: entry.group,
      group_weight: entry.groupWeight,
      prevent_recursion: entry.preventRecursion,
      exclude_recursion: entry.excludeRecursion,
      delay_until_recursion: entry.delayUntilRecursion,
      sticky: entry.sticky,
      cooldown: entry.cooldown,
      delay: entry.delay,
      use_budget: entry.useBudget,
      extensions: {
        position: entry.position,
        depth: entry.depth,
        role: roleName(entry.role),
        ...(entry.scanDepth !== undefined ? { scan_depth: entry.scanDepth } : {}),
      },
    })),
  };
}

/** Parse a v2/v3 card (or a bare card body) into the canonical model. */
export function parseTavernCard(value: unknown): { card: TavernCard; warnings: string[] } {
  const warnings: string[] = [];
  if (!record(value)) throw new Error("角色卡必须是 JSON 对象。");
  const spec = value.spec === TAVERN_CARD_SPEC_V3 ? TAVERN_CARD_SPEC_V3 : value.spec === TAVERN_CARD_SPEC_V2 ? TAVERN_CARD_SPEC_V2 : undefined;
  if (!spec && (value.spec !== undefined || value.spec_version !== undefined)) warnings.push(`未知的角色卡规范 ${String(value.spec ?? value.spec_version)}，已按 v3 容错解析。`);
  const data = record(value.data) ? value.data : value;
  const extensions = record(data.extensions) ? { ...data.extensions } : {};
  const characterBookRaw = data.character_book ?? data.characterBook;
  const characterBook = characterBookRaw ? parseTavernWorldbook(characterBookRaw) : undefined;
  const card: TavernCard = {
    spec: spec ?? TAVERN_CARD_SPEC_V3,
    spec_version: str(value.spec_version, 40) || TAVERN_CARD_SPEC_VERSION,
    data: {
      name: str(data.name, 400),
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      first_mes: str(data.first_mes ?? data.firstMessage),
      mes_example: str(data.mes_example ?? data.messageExamples ?? data.message_examples),
      creator_notes: str(data.creator_notes ?? data.creatorcomment),
      system_prompt: str(data.system_prompt ?? data.systemPrompt),
      post_history_instructions: str(data.post_history_instructions ?? data.postHistoryInstructions),
      alternate_greetings: list(data.alternate_greetings ?? data.alternateGreetings),
      group_only_greetings: list(data.group_only_greetings ?? data.groupOnlyGreetings),
      tags: list(data.tags, 64).map(tag => tag.slice(0, 64)),
      creator: str(data.creator ?? data.author, 200),
      character_version: str(data.character_version, 200),
      ...(characterBook ? { character_book: characterBook } : {}),
      extensions,
    },
  };
  if (!card.data.name.trim()) throw new Error("角色卡缺少角色名。");
  if (characterBookRaw && !characterBook) warnings.push("世界书格式无法识别，已忽略。");
  if (card.data.group_only_greetings.length) warnings.push("群聊专属开场已保留，仅在群聊中可用。");
  const unsupported = unsupportedFields(card.data.extensions);
  if (unsupported.length) warnings.push(`原卡含本站未执行的扩展：${unsupported.join("、")}。`);
  return { card, warnings };
}

const KNOWN_EXTENSION_GROUPS = new Set(["talkativeness", "fav", "world", "depth_prompt", "xumeng", "xumeng_image", "regex_scripts"]);

function unsupportedFields(extensions: Record<string, unknown>): string[] {
  return Object.keys(extensions).filter(key => !KNOWN_EXTENSION_GROUPS.has(key)).slice(0, 10);
}

/** Convert our stored context/character into a canonical v3 card. */
export function tavernCardFromContext(source: TavernCardSource): TavernCard {
  const book = bookFromSource(source);
  const openings = source.openingMessages ?? [];
  const assistantOpenings = openings.filter(message => message.role === "assistant").map(message => message.content);
  const firstMessage = (source.firstMessage ?? "").trim() || assistantOpenings[0] || "";
  const alternateGreetings = [...(source.alternateGreetings ?? []), ...assistantOpenings.slice(1)].filter(Boolean).slice(0, GREETING_LIMIT - 1);
  const extensions = { ...(source.extensions ?? {}) };
  const xumeng = record(extensions.xumeng) ? extensions.xumeng : {};
  const nextXumeng = { ...xumeng };
  if (source.speechVoice) nextXumeng.speechVoice = source.speechVoice;
  // ST's v3 card has no user-role opening slot; keep the full opening list in the
  // project extension so a user-authored opening round-trips intact.
  if (openings.some(message => message.role === "user")) nextXumeng.openingMessages = openings;
  if (Object.keys(nextXumeng).length) extensions.xumeng = nextXumeng;
  return {
    spec: TAVERN_CARD_SPEC_V3,
    spec_version: TAVERN_CARD_SPEC_VERSION,
    data: {
      name: source.name ?? "",
      description: source.description ?? "",
      personality: source.personality ?? "",
      scenario: source.scenario ?? "",
      first_mes: firstMessage,
      mes_example: source.messageExamples ?? "",
      creator_notes: source.creatorNotes ?? "",
      system_prompt: source.systemPrompt ?? "",
      post_history_instructions: source.postHistoryInstructions ?? "",
      alternate_greetings: alternateGreetings,
      group_only_greetings: [],
      tags: (source.tags ?? []).slice(0, 64),
      creator: source.author ?? "",
      character_version: source.characterVersion ?? "",
      ...(book ? { character_book: book } : {}),
      extensions,
    },
  };
}

/** Convert a canonical card back to the context fields stored by this app. */
export function contextFromTavernCard(card: TavernCard): DzmmCharacterContext {
  const data = card.data;
  const context: DzmmCharacterContext = {
    systemPrompt: data.system_prompt,
    postHistoryInstructions: data.post_history_instructions,
    messageExamples: data.mes_example,
    creatorNotes: data.creator_notes,
    alternateGreetings: data.alternate_greetings,
    ...(data.character_book ? { characterBook: data.character_book } : {}),
  };
  const extensions = record(data.extensions) ? data.extensions : {};
  const xumeng = record(extensions.xumeng) ? extensions.xumeng : {};
  const savedOpenings = xumeng.openingMessages;
  if (Array.isArray(savedOpenings)) {
    const parsed = savedOpenings.flatMap(item => {
      if (!record(item) || (item.role !== "user" && item.role !== "assistant")) return [];
      const content = typeof item.content === "string" ? item.content : "";
      return content.trim() ? [{ role: item.role, content }] : [];
    }).slice(0, 20);
    if (parsed.length) context.openingMessages = parsed;
  }
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== "" && value !== undefined)) as DzmmCharacterContext;
}

/** Export the canonical card as the JSON written to disk. */
export function serializeTavernCard(card: TavernCard): Record<string, unknown> {
  return {
    spec: TAVERN_CARD_SPEC_V3,
    spec_version: TAVERN_CARD_SPEC_VERSION,
    data: {
      name: card.data.name,
      description: card.data.description,
      personality: card.data.personality,
      scenario: card.data.scenario,
      first_mes: card.data.first_mes,
      mes_example: card.data.mes_example,
      creator_notes: card.data.creator_notes,
      system_prompt: card.data.system_prompt,
      post_history_instructions: card.data.post_history_instructions,
      alternate_greetings: card.data.alternate_greetings,
      group_only_greetings: card.data.group_only_greetings,
      tags: card.data.tags,
      creator: card.data.creator,
      character_version: card.data.character_version,
      ...(card.data.character_book ? { character_book: serializeTavernWorldbook(card.data.character_book) } : {}),
      extensions: card.data.extensions,
    },
  };
}

/** Report which parts of a card the engine will honour, for import UX and tests. */
export function tavernCompatibilityReport(card: TavernCard): TavernCompatibilityReport {
  const supported: string[] = ["description", "personality", "scenario", "first_mes", "mes_example", "system_prompt", "post_history_instructions", "alternate_greetings", "tags"];
  const unsupported: string[] = [];
  const warnings: string[] = [];
  if (card.data.character_book) {
    supported.push("character_book");
    const advanced = card.data.character_book.entries.filter(entry => entry.useRegex || entry.excludeRecursion || entry.preventRecursion || entry.delayUntilRecursion || entry.sticky > 0 || entry.cooldown > 0 || entry.probability < 100);
    if (advanced.length) warnings.push(`${advanced.length} 条世界书条目使用了高级触发规则，按本引擎语义执行。`);
  } else {
    warnings.push("这张卡没有世界书。");
  }
  if (card.data.group_only_greetings.length) supported.push("group_only_greetings");
  if (!card.data.system_prompt && !card.data.description) warnings.push("角色卡缺少系统设定和描述，回复可能缺少人设依据。");
  for (const key of unsupportedFields(card.data.extensions)) unsupported.push(`extensions.${key}`);
  return { supported, unsupported, warnings };
}

export function tavernEntryPositionName(position: TavernEntryPosition): string {
  return position === TAVERN_ENTRY_POSITION.BEFORE_CHAR ? "before_char"
    : position === TAVERN_ENTRY_POSITION.AFTER_CHAR ? "after_char"
      : position === TAVERN_ENTRY_POSITION.AN_TOP ? "an_top"
        : position === TAVERN_ENTRY_POSITION.AN_BOTTOM ? "an_bottom" : "at_depth";
}

export function tavernWorldbookCharacterKeys(book: TavernWorldbook | undefined): string[] {
  if (!book) return [];
  return book.entries.flatMap((entry: TavernWorldbookEntry) => [...entry.keys, ...entry.secondaryKeys]);
}
