import { projectDzmmOpeningMessage, splitDzmmCharacterPresentation } from "./dzmm-character-presentation";
import { getXumengSpeechVoice, XUMENG_DEFAULT_SPEECH_VOICE, type XumengSpeechVoiceId } from "./xumeng-voices";
import { parseXumengInteractionTemplate, type XumengInteractionTemplate } from "./xumeng-interaction-panels";
import { parseXumengFrontendScripts, type XumengFrontendScript } from "./xumeng-frontend-card";

export type DzmmOpeningMessage = { role: "user" | "assistant"; content: string };
export type DzmmCharacterBookEntry = {
  id?: string; name?: string; keys: string[]; secondaryKeys?: string[]; content: string;
  enabled?: boolean; constant?: boolean; selective?: boolean; caseSensitive?: boolean; insertionOrder?: number;
  position?: "before_char" | "after_char" | "an_top" | "an_bottom" | "at_depth";
  /** SillyTavern selective logic: 0 AND_ANY, 1 NOT_ALL, 2 NOT_ANY, 3 AND_ALL. */
  selectiveLogic?: number;
  matchWholeWords?: boolean; useRegex?: boolean;
  probability?: number; useProbability?: boolean;
  group?: string; groupWeight?: number;
  preventRecursion?: boolean; excludeRecursion?: boolean; delayUntilRecursion?: boolean;
  sticky?: number; cooldown?: number; delay?: number; useBudget?: boolean; scanDepth?: number;
  /** Depth-based insertion (only meaningful with position "at_depth"). */
  depth?: number; role?: "system" | "user" | "assistant";
};
export type DzmmCharacterBook = { name?: string; description?: string; scanDepth?: number; entries: DzmmCharacterBookEntry[] };
export type XumengStatusBar = { template: string; initialState: string; updateRules: string };
export type DzmmCharacterPromptContext = {
  systemPrompt?: string; postHistoryInstructions?: string; messageExamples?: string;
  alternateGreetings?: string[]; openingMessages?: DzmmOpeningMessage[]; characterBook?: DzmmCharacterBook;
  interactionTemplate?: XumengInteractionTemplate;
  statusBar?: XumengStatusBar; appearance?: string; interactionSettings?: string; sourceChannel?: string;
};
export type DzmmCharacterContext = DzmmCharacterPromptContext & {
  gallery?: string[]; introduction?: string; creatorNotes?: string; suggestedReplies?: string[]; speechVoice?: XumengSpeechVoiceId;
  /** Display and prompt regex from the card. Never part of the model request. */
  frontendScripts?: XumengFrontendScript[];
};
export const DZMM_CHARACTER_PROMPT_FIELDS = ["systemPrompt", "postHistoryInstructions", "messageExamples", "alternateGreetings", "openingMessages", "characterBook", "interactionTemplate", "statusBar", "appearance", "interactionSettings", "sourceChannel"] as const;
export const DZMM_CHARACTER_CONTEXT_FIELDS = [...DZMM_CHARACTER_PROMPT_FIELDS, "gallery", "introduction", "creatorNotes", "suggestedReplies", "speechVoice", "frontendScripts"] as const;
export const DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH = 10;
/** One lore entry. Card prose fields stay within 15,000 characters, and the whole card within 5 MB. */
export const DZMM_WORLD_BOOK_ENTRY_LIMIT = 100_000;
export const DZMM_CHARACTER_PROSE_LIMIT = 15_000;
export const DZMM_CHARACTER_CARD_MAX_BYTES = 5 * 1024 * 1024;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象。`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0") || (required && !value.trim())) {
    throw new Error(`${label}必须是不超过 ${maximum} 字${required ? "的非空" : "的"}文本，且不能包含无效字符。`);
  }
  return value;
}
function strings(value: unknown, label: string, maximum: number, textMaximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}必须是最多 ${maximum} 项的列表。`);
  return value.map(item => text(item, label, textMaximum, true));
}
function supplied(value: Record<string, unknown>, camel: string, snake: string): unknown {
  return value[camel] !== undefined ? value[camel] : value[snake];
}
function optionalText(value: Record<string, unknown>, field: string, label: string, maximum: number): string | undefined {
  return value[field] === undefined ? undefined : text(value[field], label, maximum);
}

export function parseDzmmImageUrl(value: unknown): string {
  const url = text(value, "图片地址", 2048, true).trim();
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try { const parsed = new URL(url); if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return url; } catch {}
  throw new Error("图片地址仅支持本地路径或 HTTP / HTTPS，不能包含账户凭据。");
}

function parseBook(value: unknown): DzmmCharacterBook {
  const book = record(value, "世界书");
  if (!Array.isArray(book.entries) || book.entries.length > 200) throw new Error("世界书条目必须是最多 200 项的列表。");
  const ids = new Set<string>();
  const entries = book.entries.flatMap((candidate): DzmmCharacterBookEntry[] => {
    const entry = record(candidate, "世界书条目");
    // An entry without prose carries no source text, so skipping it loses
    // nothing. Entries with prose but no activation rule still fail below:
    // dropping reachable text silently would corrupt the source book.
    if (typeof entry.content === "string" && !entry.content.trim()) return [];
    const result: DzmmCharacterBookEntry = {
      keys: strings(entry.keys ?? [], "世界书关键词", 20, 120), content: text(entry.content, "世界书内容", DZMM_WORLD_BOOK_ENTRY_LIMIT, true),
    };
    if (entry.id !== undefined) {
      const id = typeof entry.id === "number" && Number.isSafeInteger(entry.id) && entry.id >= 0 ? String(entry.id) : text(entry.id, "世界书条目 ID", 120, true).trim();
      if (ids.has(id)) throw new Error("世界书条目 ID 不能重复。");
      ids.add(id); result.id = id;
    }
    const name = supplied(entry, "name", "comment");
    if (name !== undefined) result.name = text(Array.isArray(name) ? name.join("") : name, "世界书条目名称", 120);
    const secondaryKeys = supplied(entry, "secondaryKeys", "secondary_keys");
    if (secondaryKeys !== undefined) result.secondaryKeys = strings(secondaryKeys, "世界书次要关键词", 20, 120);
    for (const [field, alias] of [["enabled", "enabled"], ["constant", "constant"], ["selective", "selective"], ["caseSensitive", "case_sensitive"]] as const) {
      const candidate = supplied(entry, field, alias);
      if (candidate !== undefined) {
        if (typeof candidate !== "boolean") throw new Error(`世界书的 ${field} 必须是布尔值。`);
        result[field] = candidate;
      }
    }
    const order = supplied(entry, "insertionOrder", "insertion_order");
    if (order !== undefined) {
      if (typeof order !== "number" || !Number.isFinite(order)) throw new Error("世界书排序必须是有限数值。");
      // Source books use negative and fractional orders for relative sorting.
      // Rounding and clamping keeps their relative order inside the range
      // the runtime sorter supports.
      result.insertionOrder = Math.min(100000, Math.max(0, Math.round(order)));
    }
    const extensions: Record<string, unknown> = entry.extensions === undefined ? {} : record(entry.extensions, "世界书条目扩展");
    const positionName = (value: number) => value === 0 ? "before_char" as const : value === 1 ? "after_char" as const : value === 2 ? "an_top" as const : value === 3 ? "an_bottom" as const : "at_depth" as const;
    // ST cards carry both a v2 string position (before/after character) and a
    // numeric extensions.position (AN top/bottom, @depth). The numeric field is
    // the authoritative insertion mode, matching SillyTavern.
    if (typeof extensions.position === "number" && Number.isInteger(extensions.position) && extensions.position >= 0 && extensions.position <= 4) {
      result.position = positionName(extensions.position);
    } else {
      const rawPosition = supplied(entry, "position", "position");
      if (rawPosition !== undefined) {
        if (rawPosition === "before_char" || rawPosition === "after_char" || rawPosition === "an_top" || rawPosition === "an_bottom" || rawPosition === "at_depth") {
          result.position = rawPosition;
        } else if (typeof rawPosition === "number" && Number.isInteger(rawPosition) && rawPosition >= 0 && rawPosition <= 4) {
          result.position = positionName(rawPosition);
        } else {
          throw new Error("世界书位置仅支持 before_char、after_char、an_top、an_bottom 或 at_depth。");
        }
      }
    }
    // ST cards use snake_case; the app stores camelCase. Accept both so a raw
    // card and an exported card parse identically.
    const read = (camel: string, snake: string) => entry[camel] !== undefined ? entry[camel] : entry[snake];
    const numeric = (camel: string, snake: string, min: number, max: number, label: string) => {
      const candidate = read(camel, snake);
      if (candidate === undefined) return undefined;
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < min || candidate > max) {
        throw new Error(`世界书${label}必须是 ${min} 至 ${max} 的数值。`);
      }
      return Math.round(candidate);
    };
    const flag = (camel: string, snake: string) => {
      const candidate = read(camel, snake);
      if (candidate === undefined) return undefined;
      if (typeof candidate !== "boolean") throw new Error(`世界书 ${camel} 必须是布尔值。`);
      return candidate;
    };
    const selectiveLogic = numeric("selectiveLogic", "selective_logic", 0, 3, "选择逻辑");
    if (selectiveLogic !== undefined) result.selectiveLogic = selectiveLogic;
    for (const [camel, snake] of [["matchWholeWords", "match_whole_words"], ["useRegex", "use_regex"],
      ["useProbability", "use_probability"], ["preventRecursion", "prevent_recursion"],
      ["excludeRecursion", "exclude_recursion"], ["delayUntilRecursion", "delay_until_recursion"],
      ["useBudget", "use_budget"]] as const) {
      const value = flag(camel, snake);
      if (value !== undefined) result[camel] = value;
    }
    const probability = numeric("probability", "probability", 0, 100, "触发概率"); if (probability !== undefined) result.probability = probability;
    const group = read("group", "group");
    if (group !== undefined) {
      if (typeof group !== "string" || group.length > 120 || group.includes("\0")) throw new Error("世界书分组名必须是不超过 120 字的文本。");
      result.group = group;
    }
    const groupWeight = numeric("groupWeight", "group_weight", 0, 10000, "分组权重"); if (groupWeight !== undefined) result.groupWeight = groupWeight;
    const sticky = numeric("sticky", "sticky", 0, 1000, "粘性轮数"); if (sticky !== undefined) result.sticky = sticky;
    const cooldown = numeric("cooldown", "cooldown", 0, 1000, "冷却轮数"); if (cooldown !== undefined) result.cooldown = cooldown;
    const delay = numeric("delay", "delay", 0, 1000, "延迟轮数"); if (delay !== undefined) result.delay = delay;
    const entryScanDepth = numeric("scanDepth", "scan_depth", 1, 100, "扫描深度"); if (entryScanDepth !== undefined) result.scanDepth = entryScanDepth;
    const rawDepth = read("depth", "depth") ?? extensions.depth;
    if (rawDepth !== undefined) {
      if (typeof rawDepth !== "number" || !Number.isFinite(rawDepth) || rawDepth < 0 || rawDepth > 10000) throw new Error("世界书注入深度必须是 0 至 10000 的数值。");
      result.depth = Math.round(rawDepth);
    }
    const rawRole = read("role", "role") ?? extensions.role;
    if (rawRole !== undefined) {
      const role = rawRole === 0 || rawRole === "system" ? "system" : rawRole === 1 || rawRole === "user" ? "user" : rawRole === 2 || rawRole === "assistant" ? "assistant" : undefined;
      if (!role) throw new Error("世界书注入角色仅支持 system、user 或 assistant。");
      result.role = role;
    }
    if (!result.constant && !result.keys.length) throw new Error("普通世界书条目需要至少一个关键词，或启用常驻。");
    return [result];
  });
  const result: DzmmCharacterBook = { entries };
  const name = optionalText(book, "name", "世界书名称", 120);
  const description = optionalText(book, "description", "世界书说明", 2000);
  if (name !== undefined) result.name = name;
  if (description !== undefined) result.description = description;
  const depth = supplied(book, "scanDepth", "scan_depth");
  if (depth !== undefined) {
    if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > 40) throw new Error("世界书扫描深度必须是 1 至 40 的整数。");
    result.scanDepth = depth;
  }
  return result;
}

function parseStatusBar(value: unknown): XumengStatusBar {
  const bar = record(value, "状态栏");
  const template = supplied(bar, "template", "template");
  const initial = supplied(bar, "initialState", "initial_state");
  const rules = supplied(bar, "updateRules", "update_rules");
  const status: XumengStatusBar = {
    template: template === undefined ? "" : text(template, "状态栏模板", 4000),
    initialState: initial === undefined ? "" : text(initial, "状态栏初始状态", 4000),
    updateRules: rules === undefined ? "" : text(rules, "状态栏更新规则", 8000),
  };
  if (!status.template.trim() && !status.initialState.trim() && !status.updateRules.trim()) {
    throw new Error("状态栏至少需要模板、初始状态或更新规则。");
  }
  return status;
}

/** Author notes survive as display data; only PROMPT_FIELDS may enter a model request. */
export function parseDzmmCharacterContext(value: Record<string, unknown>): DzmmCharacterContext {
  const context: DzmmCharacterContext = {};
  for (const [field, alias, label, limit] of [
    ["systemPrompt", "system_prompt", "角色系统设定", DZMM_CHARACTER_PROSE_LIMIT],
    ["postHistoryInstructions", "post_history_instructions", "历史后指令", DZMM_CHARACTER_PROSE_LIMIT],
    ["messageExamples", "mes_example", "对话示例", DZMM_CHARACTER_PROSE_LIMIT],
    ["introduction", "introduction", "角色卡介绍", DZMM_CHARACTER_PROSE_LIMIT],
    ["creatorNotes", "creator_notes", "作者备注", DZMM_CHARACTER_PROSE_LIMIT],
  ] as const) {
    const candidate = supplied(value, field, alias);
    if (candidate !== undefined) context[field] = text(candidate, label, limit);
  }
  const greetings = supplied(value, "alternateGreetings", "alternate_greetings");
  if (greetings !== undefined) context.alternateGreetings = strings(greetings, "备选开场", 20, DZMM_CHARACTER_PROSE_LIMIT);
  const opening = supplied(value, "openingMessages", "opening_messages");
  if (opening !== undefined) {
    if (!Array.isArray(opening) || opening.length > 20) throw new Error("初始消息必须是最多 20 条的列表。");
    context.openingMessages = opening.map(candidate => {
      const message = record(candidate, "初始消息");
      if (message.role !== "user" && message.role !== "assistant") throw new Error("初始消息只支持 user 或 assistant。");
      return { role: message.role, content: text(message.content, "初始消息正文", DZMM_CHARACTER_PROSE_LIMIT, true) };
    });
  }
  const book = supplied(value, "characterBook", "character_book");
  if (book !== undefined && book !== null) context.characterBook = parseBook(book);
  if (value.gallery !== undefined) {
    if (!Array.isArray(value.gallery) || value.gallery.length > 20) throw new Error("角色图库最多 20 张图片。");
    context.gallery = value.gallery.map(parseDzmmImageUrl);
  }
  if (value.suggestedReplies !== undefined) context.suggestedReplies = strings(value.suggestedReplies, "推荐回复", 12, 500);
  const interaction = supplied(value, "interactionTemplate", "interaction_template");
  if (interaction !== undefined && interaction !== null) context.interactionTemplate = parseXumengInteractionTemplate(interaction);
  const statusBar = supplied(value, "statusBar", "status_bar");
  if (statusBar !== undefined && statusBar !== null) context.statusBar = parseStatusBar(statusBar);
  const appearance = supplied(value, "appearance", "appearance_summary");
  if (typeof appearance === "string" && appearance.trim()) context.appearance = text(appearance, "外貌", 4000);
  const interactionSettings = supplied(value, "interactionSettings", "interaction_settings");
  if (typeof interactionSettings === "string" && interactionSettings.trim()) context.interactionSettings = text(interactionSettings, "互动设置", 8000);
  const sourceChannel = supplied(value, "sourceChannel", "source_channel");
  if (typeof sourceChannel === "string" && sourceChannel.trim()) context.sourceChannel = text(sourceChannel, "来源渠道", 40);
  // A card may name no voice, or a voice from a catalog we do not ship. Store
  // the tavern default instead of rejecting the card over an unusable voice.
  if (value.speechVoice !== undefined) {
    const voice = getXumengSpeechVoice(value.speechVoice);
    context.speechVoice = voice ? voice.id : XUMENG_DEFAULT_SPEECH_VOICE;
  }
  const frontendScripts = parseXumengFrontendScripts(value);
  if (frontendScripts) context.frontendScripts = frontendScripts;
  const encoded = () => new TextEncoder().encode(JSON.stringify(context)).byteLength;
  if (encoded() > DZMM_CHARACTER_CARD_MAX_BYTES) {
    delete context.frontendScripts;
    if (encoded() > DZMM_CHARACTER_CARD_MAX_BYTES) throw new Error("角色扩展设定总量不能超过 5 MB。");
  }
  return context;
}

export function pickDzmmCharacterContext(value: Record<string, unknown>): DzmmCharacterContext {
  return Object.fromEntries(DZMM_CHARACTER_CONTEXT_FIELDS.flatMap(field => value[field] === undefined ? [] : [[field, value[field]]])) as DzmmCharacterContext;
}

type OpeningCharacter = {
  firstMessage?: string; openingMessages?: DzmmOpeningMessage[]; alternateGreetings?: string[];
};

export function getDzmmOpeningMessages(character: OpeningCharacter, index = 0): DzmmOpeningMessage[] {
  if (!Number.isInteger(index) || index < 0) throw new Error("开场选择必须是非负整数。");
  if (index > 0) {
    const greeting = character.alternateGreetings?.[index - 1];
    if (!greeting?.trim()) throw new Error("所选备选开场不存在。");
    const content = splitDzmmCharacterPresentation(greeting).body;
    return content ? [{ role: "assistant", content }] : [];
  }
  if (character.openingMessages?.length) return character.openingMessages.map(projectDzmmOpeningMessage).filter(message => message.content);
  // Some exported cards provide only alternate greetings. Use the first
  // authored scene rather than turning description into invented dialogue.
  const content = splitDzmmCharacterPresentation(character.firstMessage || "").body
    || character.alternateGreetings?.map(greeting => splitDzmmCharacterPresentation(greeting).body).find(Boolean);
  return content ? [{ role: "assistant", content }] : [];
}

export function resolveDzmmOpeningMessages(character: OpeningCharacter, messages: ReadonlyArray<DzmmOpeningMessage>): DzmmOpeningMessage[] {
  const primary = getDzmmOpeningMessages(character);
  if (primary.length && primary.every((opening, index) => messages[index]?.role === opening.role && projectDzmmOpeningMessage(messages[index]).content === opening.content)) return primary;
  const first = messages[0];
  if (first?.role === "assistant") {
    const alternative = character.alternateGreetings?.findIndex(greeting => greeting.trim() === first.content.trim()
      || splitDzmmCharacterPresentation(greeting).body === projectDzmmOpeningMessage(first).content) ?? -1;
    if (alternative >= 0) return getDzmmOpeningMessages(character, alternative + 1);
  }
  return primary;
}

export function mergeDzmmOpeningMessages(opening: ReadonlyArray<DzmmOpeningMessage>, messages: ReadonlyArray<DzmmOpeningMessage>): DzmmOpeningMessage[] {
  let repeated = 0;
  while (repeated < opening.length && messages[repeated]?.role === opening[repeated].role
    && messages[repeated]?.content.trim() === opening[repeated].content.trim()) repeated++;
  return [...opening, ...messages.slice(repeated)].map(message => ({ role: message.role, content: message.content.trim() }));
}

export function countDzmmContextText(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countDzmmContextText(item), 0);
  if (value && typeof value === "object") return Object.values(value).reduce<number>((sum, item) => sum + countDzmmContextText(item), 0);
  return 0;
}

export function activateDzmmCharacterBook(book: DzmmCharacterBook, messages: ReadonlyArray<DzmmOpeningMessage>): DzmmCharacterBook {
  const recent = messages.slice(-(book.scanDepth ?? DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH)).map(message => message.content).join("\n");
  const entries = book.entries.filter(entry => {
    if (entry.enabled === false) return false;
    if (entry.constant) return true;
    const haystack = entry.caseSensitive ? recent : recent.toLowerCase();
    const includes = (key: string) => haystack.includes(entry.caseSensitive ? key : key.toLowerCase());
    return entry.keys.some(includes) && (!entry.selective || Boolean(entry.secondaryKeys?.some(includes)));
  }).sort((left, right) => (left.insertionOrder ?? 0) - (right.insertionOrder ?? 0));
  return { ...book, entries };
}
