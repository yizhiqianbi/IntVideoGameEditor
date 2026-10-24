import { getXumengExportedCardMetadata } from "./xumeng-exported-cards";
import { parseDzmmCharacterContext, parseDzmmImageUrl, pickDzmmCharacterContext, type DzmmCharacterContext } from "./dzmm-character-context";
import { compileDzmmPrivateWorldBook, type DzmmCharacterAuthoringDraft } from "./dzmm-character-draft";
import { QINGYU_CHARACTERS } from "./qingyu-catalog";
import { hasBlockedContent } from "./qingyu-content-policy";
export const DEFAULT_DZMM_CHARACTER_COVER = "/assets/qingyu/brand/qingyu-character-placeholder.svg";
export type Character = DzmmCharacterContext & {
  id: string;
  name: string;
  author: string;
  heat: string;
  likes: string;
  cover: string;
  tags: string[];
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  sourceUrl: string;
  sourceKind: "public-summary" | "original";
  promptOrigin: "original" | "public-verbatim" | "unavailable";
  /** Catalog completeness is independent from author attribution and saved chat state. */
  catalogReadiness?: "metadata-only" | "public-context" | "full-card";
  publicIntroductionSha256?: string;
  createdAt: string;
  publication?: { id: string; authorId: string; revision: number };
  /** The current account's site like state is loaded separately from the card snapshot. */
  siteLikeCount?: number;
  siteLiked?: boolean;
  authoringDraft?: DzmmCharacterAuthoringDraft | null;
};

export const DZMM_SOURCE_NOTE = "晴屿原创角色与故事。创作者可以保存私人作品，公开发布需通过内容检查。";
export const DZMM_PUBLIC_INTRODUCTION_NOTE = DZMM_SOURCE_NOTE;
export const DZMM_CATEGORIES = ["全部","都市日常","命定相遇","幻想冒险","轻悬疑","治愈","古风","自定义"] as const;
export const DZMM_ORIGINAL_CHARACTERS: Character[] = QINGYU_CHARACTERS;
export const DZMM_IMPORTED_PUBLIC_CHARACTERS: Character[] = [];
export const DZMM_AI_CHARACTERS: Character[] = [];
export const DZMM_CHARACTERS: Character[] = QINGYU_CHARACTERS;
const IMPORT_MAX_LENGTH = 256 * 1024;

/** Decode supplied file bytes without silently replacing malformed text. */
export function decodeDzmmCharacterImportBytes(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > IMPORT_MAX_LENGTH) throw new Error("角色卡文件不能超过 256 KB。");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。"); }
}
const IMPORT_TEXT_LIMITS = {
  name: 120,
  author: 120,
  description: 12000,
  personality: 12000,
  scenario: 12000,
  firstMessage: 12000,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(
  record: Record<string, unknown>,
  key: string,
  limit: number,
  required = false,
): string {
  const value = record[key];
  if (value === undefined || value === null) {
    if (required) throw new Error(`角色卡缺少 ${key}。`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`${key} 必须是文本。`);
  const text = value.trim();
  if (text.includes("\0")) throw new Error(`${key} 不能包含无效字符。`);
  if (required && !text) throw new Error(`角色卡的 ${key} 不能为空。`);
  if (text.length > limit) throw new Error(`${key} 不能超过 ${limit} 个字符。`);
  return text;
}

function readTags(value: unknown): string[] {
  if (value === undefined || value === null) return ["自定义"];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("tags 必须是最多 20 个标签的数组。");
  }
  const tags = value.map((tag: unknown) => {
    if (typeof tag !== "string" || tag.trim().length > 40 || tag.includes("\0")) {
      throw new Error("每个标签必须是最多 40 个字符的文本。");
    }
    return tag.trim();
  });
  const uniqueTags = [...new Set(tags.filter(Boolean))];
  return uniqueTags.length ? uniqueTags : ["自定义"];
}

function readCover(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_DZMM_CHARACTER_COVER;
  }
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("cover 必须是有效的图片地址。");
  }
  return parseDzmmImageUrl(value);
}

function createImportId(): string {
  const platformCrypto = (globalThis as unknown as {crypto?: {randomUUID?: () => string}}).crypto;
  if (typeof platformCrypto?.randomUUID === "function") {
    return `local-${platformCrypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Parse only supplied card data; importing never requests hidden site prompts. */
export function parseCharacterImport(input: unknown, id?: string): Character {
  if (hasBlockedContent(typeof input === "string" ? input : JSON.stringify(input) ?? "")) throw new Error("晴屿仅支持全年龄角色卡，请移除不适合的内容。");
  let parsed: unknown = input;
  if (typeof input === "string") {
    if (input.length > IMPORT_MAX_LENGTH || new TextEncoder().encode(input).byteLength > IMPORT_MAX_LENGTH) {
      throw new Error("角色卡文件不能超过 256 KB。");
    }
    try {
      parsed = JSON.parse(input.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("无法读取角色卡，请选择有效的 JSON 文件。");
    }
  }
  if (!isRecord(parsed)) throw new Error("角色卡必须是 JSON 对象。");
  if (parsed.spec !== undefined && parsed.spec !== "chara_card_v2") {
    throw new Error("暂时仅支持普通 JSON 角色卡与 SillyTavern v2 角色卡。");
  }
  const isV2 = parsed.spec === "chara_card_v2";
  if (isV2 && !isRecord(parsed.data)) {
    throw new Error("SillyTavern v2 角色卡缺少有效的 data 对象。");
  }
  const card = isV2 ? (parsed.data as Record<string, unknown>) : parsed;
  if (id !== undefined && (!id.trim() || id.length > 120 || id.includes("\0"))) {
    throw new Error("角色 ID 必须是最多 120 个字符的非空文本。");
  }
  const firstMessageKey = isV2 || card.firstMessage === undefined ? "first_mes" : "firstMessage";
  const character: Character = {
    id: id?.trim() ?? createImportId(),
    name: readText(card, "name", IMPORT_TEXT_LIMITS.name, true),
    author: readText(card, isV2 && card.author === undefined ? "creator" : "author", IMPORT_TEXT_LIMITS.author) || "本地导入",
    heat: "0",
    likes: "0",
    cover: readCover(card.cover),
    tags: readTags(card.tags),
    description: readText(card, "description", IMPORT_TEXT_LIMITS.description),
    personality: readText(card, "personality", IMPORT_TEXT_LIMITS.personality),
    scenario: readText(card, "scenario", IMPORT_TEXT_LIMITS.scenario),
    firstMessage: readText(card, firstMessageKey, IMPORT_TEXT_LIMITS.firstMessage),
    sourceUrl: "",
    sourceKind: "original",
    promptOrigin: "original",
    createdAt: new Date().toISOString(),
    ...parseDzmmCharacterContext(card),
  };
  if (new TextEncoder().encode(exportCharacterJson(character)).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色卡总量不能超过 256 KB，请减少扩展设定。");
  return character;
}

/** Export an editable local card without implying it contains the site's prompts. */
export function exportCharacterJson(character: Character): string {
  if (character.authoringDraft) throw new Error("这张角色还有未完成的世界书，请导出私人创作草稿，或完善后再导出角色卡。");
  const originalExport = getXumengExportedCardMetadata(character);
  const sourceNotes = originalExport
    ? `此文件为原始角色卡的晴屿兼容格式导出，并非原始下载文件。\n作者：${originalExport.attribution}\n授权：${originalExport.licenseName}（${originalExport.licenseUrl}）\n原始来源：${originalExport.sourceUrl}\n原始 JSON：${originalExport.downloadUrl}\n适配说明：${originalExport.changes}`
    : character.catalogReadiness === "metadata-only"
    ? "此文件仅含目录信息，人物设定和开场尚未补齐。"
    : character.sourceKind === "public-summary"
    ? `${character.promptOrigin === "public-verbatim" ? DZMM_PUBLIC_INTRODUCTION_NOTE : DZMM_SOURCE_NOTE}${character.promptOrigin === "public-verbatim" && character.firstMessage ? "\n开场白为公开页面的渲染结果，称呼保留本次预览内容，不代表原始模板。" : ""}\n公开页面：${character.sourceUrl}`
    : "用户提供的本地角色卡。";
  return JSON.stringify(
    {
      name: character.name,
      author: character.author,
      cover: character.cover,
      tags: character.tags,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      firstMessage: character.firstMessage,
      ...pickDzmmCharacterContext(character as unknown as Record<string, unknown>),
      creatorNotes: character.creatorNotes ?? "",
      // Keep exact author text in the canonical display field. The compatible
      // notes field also retains provenance, without growing on a round trip.
      creator_notes: character.creatorNotes ? `${character.creatorNotes}\n\n${sourceNotes}` : sourceNotes,
    },
    null,
    2,
  );
}

/** Private storage is the only card path that restores unfinished authoring data. */
export function parsePrivateCharacter(input: unknown, id?: string): Character {
  const character = parseCharacterImport(input, id);
  if (!isRecord(input) || input.authoringDraft === undefined) return character;
  if (input.authoringDraft === null) return { ...character, authoringDraft: null };
  const compiled = compileDzmmPrivateWorldBook(input.authoringDraft);
  const result = { ...character, ...compiled };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色与私人创作草稿总量不能超过 256 KB。");
  return result;
}

export function exportCharacterDraftJson(character: Character): string {
  const { authoringDraft, ...playable } = character;
  const payload = JSON.stringify({
    spec: "xumeng_authoring_draft_v1", data: { character: JSON.parse(exportCharacterJson(playable)), authoringDraft: authoringDraft ?? null },
  }, null, 2);
  if (new TextEncoder().encode(payload).byteLength > IMPORT_MAX_LENGTH) throw new Error("私人创作草稿文件不能超过 256 KB。");
  return payload;
}

/** Explicit private draft files are distinct from ordinary playable character cards. */
export function parseCharacterDraftImport(input: unknown, id?: string): Character {
  let parsed = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色文件不能超过 256 KB。");
    try { parsed = JSON.parse(input.replace(/^\uFEFF/, "")); } catch { throw new Error("无法读取角色文件，请选择有效的 JSON 文件。"); }
  }
  if (!isRecord(parsed) || parsed.spec !== "xumeng_authoring_draft_v1") return parseCharacterImport(parsed, id);
  if (!isRecord(parsed.data) || !isRecord(parsed.data.character)) throw new Error("私人创作草稿缺少有效的角色内容。");
  if (parsed.data.authoringDraft === undefined) throw new Error("私人创作草稿缺少创作数据。");
  return parsePrivateCharacter({ ...parsed.data.character, authoringDraft: parsed.data.authoringDraft }, id);
}

export const DZMM_EXPORTED_FULL_CHARACTERS: Character[] = [];
export const DZMM_CATALOG_CHARACTERS: Character[] = QINGYU_CHARACTERS;
export const DZMM_LISTED_CHARACTERS: Character[] = QINGYU_CHARACTERS;
const ids = new Set(QINGYU_CHARACTERS.map(c => c.id));
export const isDzmmListedCharacter = (character: Pick<Character,"id">) => ids.has(character.id);
