import { SHELF_CHARACTER_CARD_MAX_BYTES, SHELF_WORLD_BOOK_ENTRY_LIMIT, parseShelfCharacterContext, type ShelfCharacterBook, type ShelfCharacterBookEntry } from "./shelf-character-context";

export type ShelfAuthoringBookEntry = Omit<ShelfCharacterBookEntry, "keys" | "secondaryKeys"> & {
  keysText: string; secondaryText: string;
};
export type ShelfCharacterAuthoringDraft = {
  version: 1;
  characterBook: Omit<ShelfCharacterBook, "entries"> & { entries: ShelfAuthoringBookEntry[] };
};

type BookEntryDraft = { entry: ShelfCharacterBookEntry; keysText: string; secondaryText: string };

/** Ignore untouched placeholders during private saves; retain all authored text and changed settings. */
export function omitBlankShelfBookDraftEntries<T extends BookEntryDraft>(entries: readonly T[]): T[] {
  return entries.filter(({ entry, keysText, secondaryText }) =>
    [entry.name ?? "", entry.content, keysText, secondaryText, ...entry.keys, ...(entry.secondaryKeys ?? [])].some(value => value.trim())
    || entry.enabled === false || entry.constant === true || entry.selective === true
    || entry.caseSensitive === true || entry.insertionOrder !== undefined,
  );
}

export function splitShelfDraftKeywords(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean))];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("私人创作草稿必须是 JSON 对象。");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw new Error(`私人创作草稿文本无效或超过 ${maximum} 字。`);
  return value;
}

/** Private authoring data permits missing content/activation but retains normal type and size limits. */
export function parseShelfCharacterAuthoringDraft(value: unknown): ShelfCharacterAuthoringDraft {
  const draft = object(value);
  if (draft.version !== 1) throw new Error("私人创作草稿版本不受支持。");
  const book = object(draft.characterBook);
  if (!Array.isArray(book.entries) || book.entries.length > 200) throw new Error("私人世界书最多保存 200 个词条。");
  const ids = new Set<string>();
  const entries = book.entries.map(candidate => {
    const supplied = object(candidate);
    const entry: ShelfAuthoringBookEntry = {
      content: text(supplied.content, SHELF_WORLD_BOOK_ENTRY_LIMIT), keysText: text(supplied.keysText, 2419), secondaryText: text(supplied.secondaryText, 2419),
    };
    if (supplied.id !== undefined) {
      const id = text(supplied.id, 120).trim();
      if (!id || ids.has(id)) throw new Error("私人世界书词条 ID 不能为空或重复。");
      ids.add(id); entry.id = id;
    }
    if (supplied.name !== undefined) entry.name = text(supplied.name, 120);
    for (const field of ["enabled", "constant", "selective", "caseSensitive"] as const) {
      if (supplied[field] === undefined) continue;
      if (typeof supplied[field] !== "boolean") throw new Error("私人世界书设置需要是布尔值。");
      entry[field] = supplied[field];
    }
    if (supplied.insertionOrder !== undefined) {
      if (typeof supplied.insertionOrder !== "number" || !Number.isInteger(supplied.insertionOrder) || supplied.insertionOrder < 0 || supplied.insertionOrder > 100000) throw new Error("私人世界书排序需要为 0–100000 的整数。");
      entry.insertionOrder = supplied.insertionOrder;
    }
    return entry;
  });
  const result: ShelfCharacterAuthoringDraft = { version: 1, characterBook: { entries } };
  if (book.name !== undefined) result.characterBook.name = text(book.name, 120);
  if (book.description !== undefined) result.characterBook.description = text(book.description, 2000);
  if (book.scanDepth !== undefined) {
    if (typeof book.scanDepth !== "number" || !Number.isInteger(book.scanDepth) || book.scanDepth < 1 || book.scanDepth > 40) throw new Error("私人世界书扫描范围需要为 1–40 的整数。");
    result.characterBook.scanDepth = book.scanDepth;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > SHELF_CHARACTER_CARD_MAX_BYTES) throw new Error("私人创作草稿不能超过 5 MB。");
  return result;
}

export function authoringEntryToBookEntry({ keysText, secondaryText, ...entry }: ShelfAuthoringBookEntry): ShelfCharacterBookEntry {
  return { ...entry, keys: splitShelfDraftKeywords(keysText), ...(secondaryText ? { secondaryKeys: splitShelfDraftKeywords(secondaryText) } : {}) };
}

/** Compile only complete entries; the full authored order is kept separately whenever any row is incomplete. */
export function compileShelfPrivateWorldBook(value: unknown): {
  characterBook: ShelfCharacterBook; authoringDraft: ShelfCharacterAuthoringDraft | null;
} {
  const draft = parseShelfCharacterAuthoringDraft(value);
  const { entries, ...metadata } = draft.characterBook;
  const complete: ShelfCharacterBookEntry[] = [];
  for (const entry of entries) {
    try {
      const parsed = parseShelfCharacterContext({ characterBook: { entries: [authoringEntryToBookEntry(entry)] } }).characterBook?.entries[0];
      if (parsed) complete.push(parsed);
    } catch { /* Valid private text remains in authoringDraft until the author finishes the row. */ }
  }
  const characterBook = parseShelfCharacterContext({ characterBook: { ...metadata, entries: complete } }).characterBook!;
  return { characterBook, authoringDraft: complete.length === entries.length ? null : draft };
}
