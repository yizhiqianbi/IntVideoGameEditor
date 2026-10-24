import type { DzmmModelPreset } from "./dzmm-models";
import { parseXumengNovelCharacters, type XumengNovelCharacter } from "./xumeng-performance-character";

export const DZMM_NOVEL_MAX_BODY_BYTES = 1_600_000;
export const DZMM_NOVEL_MAX_DRAFT_BYTES = 1_500_000;
export const DZMM_NOVEL_MAX_BACKUP_BYTES = 16_000_000;
export const DZMM_NOVEL_MAX_CHAPTERS = 100;
export const DZMM_NOVEL_MAX_CHAPTER_CHARS = 50_000;

export type DzmmNovelChapterDraft = { id: string; title: string; content: string };
export type DzmmNovelDraft = {
  id: string; title: string; synopsis: string; type: "novel" | "story";
  tags: string[]; notes: string; outline: string; characters?: XumengNovelCharacter[]; chapters: DzmmNovelChapterDraft[];
};
export type DzmmNovelWork = Omit<DzmmNovelDraft, "chapters"> & {
  version: number; createdAt: number; updatedAt: number;
};
export type DzmmNovelChapter = DzmmNovelChapterDraft & {
  workId: string; position: number; version: number; createdAt: number; updatedAt: number;
};
export type DzmmNovelWorkSummary = DzmmNovelWork & { chapterCount: number; wordCount: number };
export type DzmmNovelDetail = { accountId: string; work: DzmmNovelWork; chapters: DzmmNovelChapter[] };
export type DzmmNovelList = { accountId: string; works: DzmmNovelWorkSummary[] };
export type DzmmNovelGenerationInput = {
  operation: "outline" | "continue";
  work: Omit<DzmmNovelDraft, "id" | "chapters">;
  chapter?: { title: string; content: string };
  recentContext?: string;
  model: DzmmModelPreset; maxTokens?: number;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("作品应为有效的 JSON 对象。");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[], optional: string[] = []) {
  if (Object.keys(value).some(key => !fields.includes(key) && !optional.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) throw new Error("作品字段不完整或包含不支持的内容。");
}
function text(value: unknown, limit: number, label: string, required = false): string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0") || (required && !value.trim())) {
    throw new Error(`${label}${required ? "不能为空，且" : ""}不能超过 ${limit.toLocaleString("zh-CN")} 字。`);
  }
  return value;
}
export function parseDzmmNovelId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) throw new Error("作品或章节编号无效。");
  return value;
}
export function countDzmmNovelWords(content: string): number { return content.match(/\S/gu)?.length ?? 0; }
function parseDraft(value: unknown, options: { allowUntitled?: boolean; backup?: boolean } = {}): DzmmNovelDraft {
  const supplied = record(value);
  exact(supplied, ["id", "title", "synopsis", "type", "tags", "notes", "outline", "chapters"], ["characters"]);
  if (supplied.type !== "novel" && supplied.type !== "story") throw new Error("请选择小说或故事类型。");
  if (!Array.isArray(supplied.tags) || (!options.backup && supplied.tags.length > 20)) throw new Error("作品最多支持 20 个标签。");
  const tags = supplied.tags.map(tag => text(tag, options.backup ? DZMM_NOVEL_MAX_BACKUP_BYTES : 40, "每个标签", true));
  if (new Set(tags).size !== tags.length) throw new Error("标签不能重复。");
  if (!Array.isArray(supplied.chapters) || supplied.chapters.length > DZMM_NOVEL_MAX_CHAPTERS) throw new Error("作品最多保存 100 个章节。");
  const used = new Set<string>();
  const chapters = supplied.chapters.map(candidate => {
    const chapter = record(candidate); exact(chapter, ["id", "title", "content"]);
    const id = parseDzmmNovelId(chapter.id);
    if (used.has(id)) throw new Error("章节编号不能重复。");
    used.add(id);
    return { id, title: text(chapter.title, 120, "章节标题"), content: text(chapter.content, DZMM_NOVEL_MAX_CHAPTER_CHARS, "章节正文") };
  });
  const result: DzmmNovelDraft = { id: parseDzmmNovelId(supplied.id), title: text(supplied.title, 120, "作品标题", !options.allowUntitled),
    synopsis: text(supplied.synopsis, 4000, "作品简介"), type: supplied.type, tags,
    notes: text(supplied.notes, 8000, "创作指令"), outline: text(supplied.outline, 20000, "作品大纲"),
    ...(supplied.characters === undefined ? {} : { characters: parseXumengNovelCharacters(supplied.characters, { allowIncomplete: options.backup }) }), chapters };
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (options.backup && bytes > DZMM_NOVEL_MAX_BACKUP_BYTES) throw new Error("作品恢复副本或备份不能超过 16 MB。");
  if (!options.backup && bytes > DZMM_NOVEL_MAX_DRAFT_BYTES) throw new Error("整部作品不能超过 1.5 MB，请分为多部作品保存。内容尚未保存，请先导出备份。");
  return result;
}
export function parseDzmmNovelDraft(value: unknown, options: { allowUntitled?: boolean } = {}): DzmmNovelDraft {
  return parseDraft(value, { allowUntitled: options.allowUntitled });
}
export function parseDzmmNovelBackup(value: unknown): DzmmNovelDraft {
  // An unfinished tag edit must remain recoverable without becoming saveable.
  // Only editor recovery and private backups use this parser; structure and
  // manuscript field limits remain the same as the cloud draft contract.
  return parseDraft(value, { allowUntitled: true, backup: true });
}

function number(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > 8_640_000_000_000_000) throw new Error(`${label}无效。`);
  return value as number;
}
function metadata(value: Record<string, unknown>) {
  const createdAt = number(value.createdAt, "创建时间"), updatedAt = number(value.updatedAt, "更新时间");
  if (updatedAt < createdAt) throw new Error("作品时间无效。");
  return { version: number(value.version, "作品版本", 1), createdAt, updatedAt };
}
function parseWork(value: unknown): DzmmNovelWork {
  const supplied = record(value);
  const { chapters: _, ...work } = parseDzmmNovelDraft({ id: supplied.id, title: supplied.title, synopsis: supplied.synopsis,
    type: supplied.type, tags: supplied.tags, notes: supplied.notes, outline: supplied.outline,
    ...(supplied.characters === undefined ? {} : { characters: supplied.characters }), chapters: [] });
  void _;
  return { ...work, ...metadata(supplied) };
}
export function parseDzmmNovelDetail(value: unknown, accountId: string): DzmmNovelDetail {
  const supplied = record(value);
  if (!accountId || supplied.accountId !== accountId) throw new Error("当前账号已改变，请重新加载作品。");
  const work = parseWork(supplied.work);
  if (!Array.isArray(supplied.chapters)) throw new Error("作品章节列表无效。");
  const chapters = supplied.chapters.map((candidate, position): DzmmNovelChapter => {
    const chapter = record(candidate);
    if (chapter.workId !== work.id || chapter.position !== position) throw new Error("作品章节归属或顺序无效。");
    return { id: parseDzmmNovelId(chapter.id), workId: work.id, position,
      title: text(chapter.title, 120, "章节标题"), content: text(chapter.content, DZMM_NOVEL_MAX_CHAPTER_CHARS, "章节正文"), ...metadata(chapter) };
  });
  parseDzmmNovelDraft({ ...dzmmNovelDraftFromDetail({ accountId, work, chapters }) });
  return { accountId, work, chapters };
}
export function parseDzmmNovelList(value: unknown, accountId: string): DzmmNovelList {
  const supplied = record(value);
  if (!accountId || supplied.accountId !== accountId) throw new Error("当前账号已改变，请重新加载作品。");
  if (!Array.isArray(supplied.works)) throw new Error("私人作品列表无效。");
  const ids = new Set<string>();
  const works = supplied.works.map(candidate => {
    const work = parseWork(candidate), item = record(candidate);
    if (ids.has(work.id)) throw new Error("私人作品编号重复。");
    ids.add(work.id);
    return { ...work, chapterCount: number(item.chapterCount, "章节数"), wordCount: number(item.wordCount, "字数") };
  });
  return { accountId, works };
}
export function dzmmNovelDraftFromDetail(detail: DzmmNovelDetail): DzmmNovelDraft {
  const { id, title, synopsis, type, tags, notes, outline, characters } = detail.work;
  return { id, title, synopsis, type, tags: [...tags], notes, outline,
    ...(characters === undefined ? {} : { characters: characters.map(character => ({ ...character })) }),
    chapters: detail.chapters.map(({ id: chapterId, title: chapterTitle, content }) => ({ id: chapterId, title: chapterTitle, content })) };
}
export function createDzmmNovelDraft(type: "novel" | "story" = "novel", createId: () => string = () => crypto.randomUUID()): DzmmNovelDraft {
  return { id: createId(), title: "", synopsis: "", type, tags: [], notes: "", outline: "",
    chapters: [{ id: createId(), title: "第一章", content: "" }] };
}
export function exportDzmmNovelJson(draft: DzmmNovelDraft): string {
  return JSON.stringify({ schema: "qingyu-novel", version: 1, work: parseDzmmNovelBackup(draft) });
}
export function exportDzmmNovelText(draft: DzmmNovelDraft): string {
  const work = parseDzmmNovelBackup(draft);
  return [work.title || "未命名作品", work.synopsis, ...work.chapters.map((chapter, index) => `${chapter.title || `第${index + 1}章`}\n\n${chapter.content}`)].filter(Boolean).join("\n\n");
}
/** A private copy owns independent work, chapter and cast identifiers. */
export function cloneDzmmNovelDraft(draft: DzmmNovelDraft, createId: () => string = () => crypto.randomUUID()): DzmmNovelDraft {
  const source = parseDzmmNovelBackup(draft);
  const used = new Set([source.id, ...source.chapters.map(chapter => chapter.id), ...(source.characters ?? []).map(character => character.id)]);
  const nextId = () => {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const id = parseDzmmNovelId(createId());
      if (!used.has(id)) { used.add(id); return id; }
    }
    throw new Error("无法创建独立副本编号，请稍后重试。");
  };
  return { ...source, id: nextId(), chapters: source.chapters.map(chapter => ({ ...chapter, id: nextId() })),
    ...(source.characters === undefined ? {} : { characters: source.characters.map(character => ({ ...character, id: nextId() })) }) };
}
export function decodeDzmmNovelImportBytes(bytes: Uint8Array | ArrayBuffer): string {
  if (bytes.byteLength > DZMM_NOVEL_MAX_DRAFT_BYTES) throw new Error("导入文件不能超过 1.5 MB。");
  try {
    // Preserve the authored text and BOM; the import parser handles a leading
    // file marker. Invalid bytes must never become replacement characters.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { throw new Error("文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。"); }
}
export function parseDzmmNovelImport(raw: string, options: { format: "json" | "txt"; filename?: string; createId?: () => string }): DzmmNovelDraft {
  if (new TextEncoder().encode(raw).byteLength > DZMM_NOVEL_MAX_DRAFT_BYTES) throw new Error("导入文件不能超过 1.5 MB。");
  const content = raw.replace(/^\uFEFF/, "");
  const createId = options.createId ?? (() => crypto.randomUUID());
  if (options.format === "json") {
    let supplied: Record<string, unknown>;
    try { supplied = record(JSON.parse(content)); } catch { throw new Error("请导入晴屿导出的作品 JSON 文件。"); }
    if (supplied.schema !== "qingyu-novel" || supplied.version !== 1) throw new Error("作品备份格式或版本不受支持。");
    const draft = parseDzmmNovelBackup(supplied.work);
    return cloneDzmmNovelDraft(draft, createId);
  }
  if (!content.trim()) throw new Error("故事文件没有正文。");
  const chapters: DzmmNovelChapterDraft[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + DZMM_NOVEL_MAX_CHAPTER_CHARS, content.length);
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    chapters.push({ id: createId(), title: chapters.length ? `导入正文 ${chapters.length + 1}` : "导入正文", content: content.slice(start, end) });
    start = end;
  }
  return parseDzmmNovelDraft({ ...createDzmmNovelDraft("story", createId), title: (options.filename ?? "导入故事").replace(/\.[^.]+$/, "").slice(0, 120) || "导入故事", chapters });
}
