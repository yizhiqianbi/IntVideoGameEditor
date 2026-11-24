import { projectShelfOpeningMessage, splitShelfCharacterPresentation } from "./shelf-character-presentation";
import { getFolioSpeechVoice, FOLIO_DEFAULT_SPEECH_VOICE, type FolioSpeechVoiceId } from "./folio-voices";
import { parseFolioInteractionTemplate, type FolioInteractionTemplate } from "./folio-interaction-panels";
import { parseFolioFrontendScripts, type FolioFrontendScript } from "./folio-frontend-card";

export type ShelfOpeningMessage = { role: "user" | "assistant"; content: string };
export type ShelfCharacterBookEntry = {
  id?: string; name?: string; keys: string[]; secondaryKeys?: string[]; content: string;
  enabled?: boolean; constant?: boolean; selective?: boolean; caseSensitive?: boolean; insertionOrder?: number;
  position?: "before_char" | "after_char";
};
export type ShelfCharacterBook = { name?: string; description?: string; scanDepth?: number; entries: ShelfCharacterBookEntry[] };
export type FolioStatusBar = { template: string; initialState: string; updateRules: string };
export type ShelfCharacterPromptContext = {
  systemPrompt?: string; postHistoryInstructions?: string; messageExamples?: string;
  alternateGreetings?: string[]; openingMessages?: ShelfOpeningMessage[]; characterBook?: ShelfCharacterBook;
  interactionTemplate?: FolioInteractionTemplate;
  statusBar?: FolioStatusBar; appearance?: string; interactionSettings?: string; sourceChannel?: string;
};
export type ShelfCharacterContext = ShelfCharacterPromptContext & {
  gallery?: string[]; introduction?: string; creatorNotes?: string; suggestedReplies?: string[]; speechVoice?: FolioSpeechVoiceId;
  /** Display and prompt regex from the card. Never part of the model request. */
  frontendScripts?: FolioFrontendScript[];
};
export const SHELF_CHARACTER_PROMPT_FIELDS = ["systemPrompt", "postHistoryInstructions", "messageExamples", "alternateGreetings", "openingMessages", "characterBook", "interactionTemplate", "statusBar", "appearance", "interactionSettings", "sourceChannel"] as const;
export const SHELF_CHARACTER_CONTEXT_FIELDS = [...SHELF_CHARACTER_PROMPT_FIELDS, "gallery", "introduction", "creatorNotes", "suggestedReplies", "speechVoice", "frontendScripts"] as const;
export const DEFAULT_SHELF_CHARACTER_BOOK_SCAN_DEPTH = 10;
/** One lore entry. Card prose fields stay within 15,000 characters, and the whole card within 5 MB. */
export const SHELF_WORLD_BOOK_ENTRY_LIMIT = 100_000;
export const SHELF_CHARACTER_PROSE_LIMIT = 15_000;
export const SHELF_CHARACTER_CARD_MAX_BYTES = 5 * 1024 * 1024;

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

export function parseShelfImageUrl(value: unknown): string {
  const url = text(value, "图片地址", 2048, true).trim();
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try { const parsed = new URL(url); if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return url; } catch {}
  throw new Error("图片地址仅支持本地路径或 HTTP / HTTPS，不能包含账户凭据。");
}

function parseBook(value: unknown): ShelfCharacterBook {
  const book = record(value, "世界书");
  if (!Array.isArray(book.entries) || book.entries.length > 200) throw new Error("世界书条目必须是最多 200 项的列表。");
  const ids = new Set<string>();
  const entries = book.entries.flatMap((candidate): ShelfCharacterBookEntry[] => {
    const entry = record(candidate, "世界书条目");
    // An entry without prose carries no source text, so skipping it loses
    // nothing. Entries with prose but no activation rule still fail below:
    // dropping reachable text silently would corrupt the source book.
    if (typeof entry.content === "string" && !entry.content.trim()) return [];
    const result: ShelfCharacterBookEntry = {
      keys: strings(entry.keys ?? [], "世界书关键词", 20, 120), content: text(entry.content, "世界书内容", SHELF_WORLD_BOOK_ENTRY_LIMIT, true),
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
    if (entry.position !== undefined) {
      if (entry.position !== "before_char" && entry.position !== "after_char") throw new Error("世界书位置仅支持 before_char 或 after_char。");
      result.position = entry.position;
    }
    if (!result.constant && !result.keys.length) throw new Error("普通世界书条目需要至少一个关键词，或启用常驻。");
    return [result];
  });
  const result: ShelfCharacterBook = { entries };
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

function parseStatusBar(value: unknown): FolioStatusBar {
  const bar = record(value, "状态栏");
  const template = supplied(bar, "template", "template");
  const initial = supplied(bar, "initialState", "initial_state");
  const rules = supplied(bar, "updateRules", "update_rules");
  const status: FolioStatusBar = {
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
export function parseShelfCharacterContext(value: Record<string, unknown>): ShelfCharacterContext {
  const context: ShelfCharacterContext = {};
  for (const [field, alias, label, limit] of [
    ["systemPrompt", "system_prompt", "角色系统设定", SHELF_CHARACTER_PROSE_LIMIT],
    ["postHistoryInstructions", "post_history_instructions", "历史后指令", SHELF_CHARACTER_PROSE_LIMIT],
    ["messageExamples", "mes_example", "对话示例", SHELF_CHARACTER_PROSE_LIMIT],
    ["introduction", "introduction", "角色卡介绍", SHELF_CHARACTER_PROSE_LIMIT],
    ["creatorNotes", "creator_notes", "作者备注", SHELF_CHARACTER_PROSE_LIMIT],
  ] as const) {
    const candidate = supplied(value, field, alias);
    if (candidate !== undefined) context[field] = text(candidate, label, limit);
  }
  const greetings = supplied(value, "alternateGreetings", "alternate_greetings");
  if (greetings !== undefined) context.alternateGreetings = strings(greetings, "备选开场", 20, SHELF_CHARACTER_PROSE_LIMIT);
  const opening = supplied(value, "openingMessages", "opening_messages");
  if (opening !== undefined) {
    if (!Array.isArray(opening) || opening.length > 20) throw new Error("初始消息必须是最多 20 条的列表。");
    context.openingMessages = opening.map(candidate => {
      const message = record(candidate, "初始消息");
      if (message.role !== "user" && message.role !== "assistant") throw new Error("初始消息只支持 user 或 assistant。");
      return { role: message.role, content: text(message.content, "初始消息正文", SHELF_CHARACTER_PROSE_LIMIT, true) };
    });
  }
  const book = supplied(value, "characterBook", "character_book");
  if (book !== undefined && book !== null) context.characterBook = parseBook(book);
  if (value.gallery !== undefined) {
    if (!Array.isArray(value.gallery) || value.gallery.length > 20) throw new Error("角色图库最多 20 张图片。");
    context.gallery = value.gallery.map(parseShelfImageUrl);
  }
  if (value.suggestedReplies !== undefined) context.suggestedReplies = strings(value.suggestedReplies, "推荐回复", 12, 500);
  const interaction = supplied(value, "interactionTemplate", "interaction_template");
  if (interaction !== undefined && interaction !== null) context.interactionTemplate = parseFolioInteractionTemplate(interaction);
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
    const voice = getFolioSpeechVoice(value.speechVoice);
    context.speechVoice = voice ? voice.id : FOLIO_DEFAULT_SPEECH_VOICE;
  }
  const frontendScripts = parseFolioFrontendScripts(value);
  if (frontendScripts) context.frontendScripts = frontendScripts;
  const encoded = () => new TextEncoder().encode(JSON.stringify(context)).byteLength;
  if (encoded() > SHELF_CHARACTER_CARD_MAX_BYTES) {
    delete context.frontendScripts;
    if (encoded() > SHELF_CHARACTER_CARD_MAX_BYTES) throw new Error("角色扩展设定总量不能超过 5 MB。");
  }
  return context;
}

export function pickShelfCharacterContext(value: Record<string, unknown>): ShelfCharacterContext {
  return Object.fromEntries(SHELF_CHARACTER_CONTEXT_FIELDS.flatMap(field => value[field] === undefined ? [] : [[field, value[field]]])) as ShelfCharacterContext;
}

type OpeningCharacter = {
  firstMessage?: string; openingMessages?: ShelfOpeningMessage[]; alternateGreetings?: string[];
};

export function getShelfOpeningMessages(character: OpeningCharacter, index = 0): ShelfOpeningMessage[] {
  if (!Number.isInteger(index) || index < 0) throw new Error("开场选择必须是非负整数。");
  if (index > 0) {
    const greeting = character.alternateGreetings?.[index - 1];
    if (!greeting?.trim()) throw new Error("所选备选开场不存在。");
    const content = splitShelfCharacterPresentation(greeting).body;
    return content ? [{ role: "assistant", content }] : [];
  }
  if (character.openingMessages?.length) return character.openingMessages.map(projectShelfOpeningMessage).filter(message => message.content);
  // Some exported cards provide only alternate greetings. Use the first
  // authored scene rather than turning description into invented dialogue.
  const content = splitShelfCharacterPresentation(character.firstMessage || "").body
    || character.alternateGreetings?.map(greeting => splitShelfCharacterPresentation(greeting).body).find(Boolean);
  return content ? [{ role: "assistant", content }] : [];
}

export function resolveShelfOpeningMessages(character: OpeningCharacter, messages: ReadonlyArray<ShelfOpeningMessage>): ShelfOpeningMessage[] {
  const primary = getShelfOpeningMessages(character);
  if (primary.length && primary.every((opening, index) => messages[index]?.role === opening.role && projectShelfOpeningMessage(messages[index]).content === opening.content)) return primary;
  const first = messages[0];
  if (first?.role === "assistant") {
    const alternative = character.alternateGreetings?.findIndex(greeting => greeting.trim() === first.content.trim()
      || splitShelfCharacterPresentation(greeting).body === projectShelfOpeningMessage(first).content) ?? -1;
    if (alternative >= 0) return getShelfOpeningMessages(character, alternative + 1);
  }
  return primary;
}

export function mergeShelfOpeningMessages(opening: ReadonlyArray<ShelfOpeningMessage>, messages: ReadonlyArray<ShelfOpeningMessage>): ShelfOpeningMessage[] {
  let repeated = 0;
  while (repeated < opening.length && messages[repeated]?.role === opening[repeated].role
    && messages[repeated]?.content.trim() === opening[repeated].content.trim()) repeated++;
  return [...opening, ...messages.slice(repeated)].map(message => ({ role: message.role, content: message.content.trim() }));
}

export function countShelfContextText(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countShelfContextText(item), 0);
  if (value && typeof value === "object") return Object.values(value).reduce<number>((sum, item) => sum + countShelfContextText(item), 0);
  return 0;
}

export function activateShelfCharacterBook(book: ShelfCharacterBook, messages: ReadonlyArray<ShelfOpeningMessage>): ShelfCharacterBook {
  const recent = messages.slice(-(book.scanDepth ?? DEFAULT_SHELF_CHARACTER_BOOK_SCAN_DEPTH)).map(message => message.content).join("\n");
  const entries = book.entries.filter(entry => {
    if (entry.enabled === false) return false;
    if (entry.constant) return true;
    const haystack = entry.caseSensitive ? recent : recent.toLowerCase();
    const includes = (key: string) => haystack.includes(entry.caseSensitive ? key : key.toLowerCase());
    return entry.keys.some(includes) && (!entry.selective || Boolean(entry.secondaryKeys?.some(includes)));
  }).sort((left, right) => (left.insertionOrder ?? 0) - (right.insertionOrder ?? 0));
  return { ...book, entries };
}
