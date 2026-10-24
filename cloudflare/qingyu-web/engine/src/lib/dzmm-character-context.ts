import { projectDzmmOpeningMessage, splitDzmmCharacterPresentation } from "./dzmm-character-presentation";

export type DzmmOpeningMessage = { role: "user" | "assistant"; content: string };
export type DzmmCharacterBookEntry = {
  id?: string; name?: string; keys: string[]; secondaryKeys?: string[]; content: string;
  enabled?: boolean; constant?: boolean; selective?: boolean; caseSensitive?: boolean; insertionOrder?: number;
  position?: "before_char" | "after_char";
};
export type DzmmCharacterBook = { name?: string; description?: string; scanDepth?: number; entries: DzmmCharacterBookEntry[] };
export type DzmmCharacterPromptContext = {
  systemPrompt?: string; postHistoryInstructions?: string; messageExamples?: string;
  alternateGreetings?: string[]; openingMessages?: DzmmOpeningMessage[]; characterBook?: DzmmCharacterBook;
};
export type DzmmCharacterContext = DzmmCharacterPromptContext & {
  gallery?: string[]; introduction?: string; creatorNotes?: string; suggestedReplies?: string[];
};
export const DZMM_CHARACTER_PROMPT_FIELDS = ["systemPrompt", "postHistoryInstructions", "messageExamples", "alternateGreetings", "openingMessages", "characterBook"] as const;
export const DZMM_CHARACTER_CONTEXT_FIELDS = [...DZMM_CHARACTER_PROMPT_FIELDS, "gallery", "introduction", "creatorNotes", "suggestedReplies"] as const;
export const DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH = 10;

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
  const entries = book.entries.map((candidate): DzmmCharacterBookEntry => {
    const entry = record(candidate, "世界书条目");
    const result: DzmmCharacterBookEntry = {
      keys: strings(entry.keys ?? [], "世界书关键词", 20, 120), content: text(entry.content, "世界书内容", 8000, true),
    };
    if (entry.id !== undefined) {
      const id = typeof entry.id === "number" && Number.isSafeInteger(entry.id) && entry.id >= 0 ? String(entry.id) : text(entry.id, "世界书条目 ID", 120, true).trim();
      if (ids.has(id)) throw new Error("世界书条目 ID 不能重复。");
      ids.add(id); result.id = id;
    }
    const name = supplied(entry, "name", "comment");
    if (name !== undefined) result.name = text(name, "世界书条目名称", 120);
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
      if (typeof order !== "number" || !Number.isInteger(order) || order < 0 || order > 100000) throw new Error("世界书排序必须是 0 至 100000 的整数。");
      result.insertionOrder = order;
    }
    if (entry.position !== undefined) {
      if (entry.position !== "before_char" && entry.position !== "after_char") throw new Error("世界书位置仅支持 before_char 或 after_char。");
      result.position = entry.position;
    }
    if (!result.constant && !result.keys.length) throw new Error("普通世界书条目需要至少一个关键词，或启用常驻。");
    return result;
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

/** Author notes survive as display data; only PROMPT_FIELDS may enter a model request. */
export function parseDzmmCharacterContext(value: Record<string, unknown>): DzmmCharacterContext {
  const context: DzmmCharacterContext = {};
  for (const [field, alias, label, limit] of [
    ["systemPrompt", "system_prompt", "角色系统设定", 12000],
    ["postHistoryInstructions", "post_history_instructions", "历史后指令", 8000],
    ["messageExamples", "mes_example", "对话示例", 12000],
    ["introduction", "introduction", "角色卡介绍", 12000],
    ["creatorNotes", "creator_notes", "作者备注", 12000],
  ] as const) {
    const candidate = supplied(value, field, alias);
    if (candidate !== undefined) context[field] = text(candidate, label, limit);
  }
  const greetings = supplied(value, "alternateGreetings", "alternate_greetings");
  if (greetings !== undefined) context.alternateGreetings = strings(greetings, "备选开场", 20, 12000);
  const opening = supplied(value, "openingMessages", "opening_messages");
  if (opening !== undefined) {
    if (!Array.isArray(opening) || opening.length > 20) throw new Error("初始消息必须是最多 20 条的列表。");
    context.openingMessages = opening.map(candidate => {
      const message = record(candidate, "初始消息");
      if (message.role !== "user" && message.role !== "assistant") throw new Error("初始消息只支持 user 或 assistant。");
      return { role: message.role, content: text(message.content, "初始消息正文", 12000, true) };
    });
  }
  const book = supplied(value, "characterBook", "character_book");
  if (book !== undefined) context.characterBook = parseBook(book);
  if (value.gallery !== undefined) {
    if (!Array.isArray(value.gallery) || value.gallery.length > 20) throw new Error("角色图库最多 20 张图片。");
    context.gallery = value.gallery.map(parseDzmmImageUrl);
  }
  if (value.suggestedReplies !== undefined) context.suggestedReplies = strings(value.suggestedReplies, "推荐回复", 12, 500);
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 512 * 1024) throw new Error("角色扩展设定总量不能超过 512 KB。");
  return context;
}

export function pickDzmmCharacterContext(value: Record<string, unknown>): DzmmCharacterContext {
  return Object.fromEntries(DZMM_CHARACTER_CONTEXT_FIELDS.flatMap(field => value[field] === undefined ? [] : [[field, value[field]]])) as DzmmCharacterContext;
}

type OpeningCharacter = { firstMessage?: string; openingMessages?: DzmmOpeningMessage[]; alternateGreetings?: string[] };
export function getDzmmOpeningMessages(character: OpeningCharacter, index = 0): DzmmOpeningMessage[] {
  if (!Number.isInteger(index) || index < 0) throw new Error("开场选择必须是非负整数。");
  if (index > 0) {
    const greeting = character.alternateGreetings?.[index - 1];
    if (!greeting?.trim()) throw new Error("所选备选开场不存在。");
    const content = splitDzmmCharacterPresentation(greeting).body;
    return content ? [{ role: "assistant", content }] : [];
  }
  if (character.openingMessages?.length) return character.openingMessages.map(projectDzmmOpeningMessage).filter(message => message.content);
  const content = splitDzmmCharacterPresentation(character.firstMessage || "").body;
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
