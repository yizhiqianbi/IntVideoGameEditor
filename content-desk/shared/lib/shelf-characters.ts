import shelfAiMetadata from "./shelf-ai-listed-metadata.json";
import publicContextMeta from "./shelf-public-context-metadata.json";
import { SHELF_CHARACTER_CARD_MAX_BYTES, SHELF_CHARACTER_PROSE_LIMIT, parseShelfCharacterContext, parseShelfImageUrl, pickShelfCharacterContext, type ShelfCharacterContext } from "./shelf-character-context";

export { SHELF_CHARACTER_CARD_MAX_BYTES };
import { compileShelfPrivateWorldBook, type ShelfCharacterAuthoringDraft } from "./shelf-character-draft";
import { FOLIO_EXPORTED_SHELF_RECORDS, FOLIO_USER_PROVIDED_SHELF_RECORDS, readFolioCardProvenance } from "./folio-card-shelf";
import { folioHomepageStat } from "./folio-homepage-stats";
import { fillCustomShelfTags } from "./folio-shelf-tags";
import { FOLIO_DEFAULT_SPEECH_VOICE } from "./folio-voices";
import retiredCards from "./folio-retired-cards.json";

export const DEFAULT_SHELF_CHARACTER_COVER = "/assets/desk/brand/placeholder.svg";

export type Character = ShelfCharacterContext & {
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
  /** Shelf rows omit the playable prompt. Open the full card before starting a chat. */
  listPreview?: boolean;
  /** Public-introduction archive rows keep a short shelf line until the full text is opened. */
  introductionDeferred?: boolean;
  /** Scraped public context keeps a short shelf line until a chat needs the full text. */
  contextDeferred?: boolean;
  /** The current account's site like state is loaded separately from the card snapshot. */
  siteLikeCount?: number;
  siteLiked?: boolean;
  authoringDraft?: ShelfCharacterAuthoringDraft | null;
};

export const SHELF_SOURCE_NOTE =
  "角色名称、作者与已观察到的热度来自公开页面。简介、性格、场景和开场白均为本地重新创作，仅参考题材，不代表原站完整角色卡或隐藏提示词。未观察到的数据标为未知。";

export const SHELF_PUBLIC_INTRODUCTION_NOTE =
  "角色介绍保留原站公开页面原文，并注明作者与出处。聊天以这段公开介绍作为设定；未获取独立原始性格、场景、开场白或世界书，不补写成原版角色卡。";

export const SHELF_CATEGORIES = [
  "全部",
  "大世界",
  "仙侠古风",
  "奇幻",
  "都市",
  "剧情",
  "一般向",
  "自定义",
  "世界模拟",
  "奇幻冒险",
  "修仙",
  "都市异能",
  "人生模拟",
] as const;

type CatalogInput = Omit<
  Character,
  "sourceUrl" | "sourceKind" | "promptOrigin" | "createdAt"
>;

function publicCharacter(character: CatalogInput): Character {
  return {
    ...character,
    sourceUrl: `/character/${character.id}`,
    sourceKind: "public-summary",
    promptOrigin: "original",
    createdAt: "2026-10-02T00:00:00.000Z",
    tags: fillCustomShelfTags(character.name, character.tags),
  };
}

export const SHELF_ORIGINAL_CHARACTERS: Character[] = [];

export type ShelfAiMetadataRecord = {
  id: number;
  title: string;
  author: string;
  image: string;
  likes: number;
  tags: string[];
  isGame: boolean;
  source: string;
  publishedAt: string;
};

function scrapedTags(record: ShelfAiMetadataRecord): string[] {
  const title = record.title.toLowerCase();
  const tags = [record.isGame ? "游戏" : "剧情", ...record.tags];
  if (/修仙|仙侠|江湖|道祖|师尊|武侠/.test(title)) tags.push("仙侠古风");
  if (/都市|校园|女友|妻|恋|直播|论坛/.test(title)) tags.push("都市");
  if (/世界|模拟|大世界|卡牌|塔防/.test(title)) tags.push("世界模拟");
  return [...new Set(tags)].slice(0, 6);
}

function scrapedCover(value: string): string {
  const marker = "/pub_card_images/";
  const file = value.split(marker)[1]?.split("?")[0];
  if (!file) return DEFAULT_SHELF_CHARACTER_COVER;
  try {
    return `https://pxlorbit.com/storage/v1/object/public/pub_card_images/${encodeURIComponent(decodeURIComponent(file))}`;
  } catch {
    return DEFAULT_SHELF_CHARACTER_COVER;
  }
}

type PublicContextCard = {
  id: string;
  shelfDescription: string;
  shelfFirstMessage: string;
  descriptionSha256: string;
  contextDeferred?: boolean;
};

/** Public narrative and opening evidence is distinct from directory metadata. */
const publicContexts = new Map((publicContextMeta.characters as PublicContextCard[]).map((card) => [card.id, card]));

/** Missing character context stays missing: never synthesize a generic persona. */
export function buildShelfAiCharacters(records: readonly ShelfAiMetadataRecord[]): Character[] {
  return records.map((record) => {
    const name = record.title.trim() || `公开角色 ${record.id}`;
    const sourceUrl = record.source || `/character/${record.id}`;
    const createdAt = Number.isFinite(Date.parse(record.publishedAt))
      ? new Date(record.publishedAt).toISOString()
      : "2026-10-14T00:00:00.000Z";
    return {
      id: String(record.id),
      name,
      author: record.author.trim() || "匿名创作者",
      heat: folioHomepageStat(String(record.id))?.heat ?? "—",
      likes: folioHomepageStat(String(record.id))?.likes ?? (Number.isSafeInteger(record.likes) && record.likes >= 0 ? String(record.likes) : "—"),
      cover: scrapedCover(record.image),
      tags: scrapedTags(record),
      description: publicContexts.get(String(record.id))?.shelfDescription ?? "",
      personality: "",
      scenario: "",
      firstMessage: publicContexts.get(String(record.id))?.shelfFirstMessage ?? "",
      sourceUrl,
      sourceKind: "public-summary",
      promptOrigin: publicContexts.has(String(record.id)) ? "public-verbatim" : "unavailable",
      publicIntroductionSha256: publicContexts.get(String(record.id))?.descriptionSha256,
      catalogReadiness: publicContexts.has(String(record.id)) ? "public-context" : "metadata-only",
      ...(publicContexts.get(String(record.id))?.contextDeferred ? { contextDeferred: true } : {}),
      createdAt,
    };
  });
}

const listedAiIds = new Set((shelfAiMetadata.records as ShelfAiMetadataRecord[]).map((record) => String(record.id)));
if (listedAiIds.size !== publicContexts.size || [...publicContexts.keys()].some((id) => !listedAiIds.has(id))) {
  throw new Error("公开语境角色与首页摘要不一致。");
}

export const SHELF_AI_CHARACTERS: Character[] = buildShelfAiCharacters(shelfAiMetadata.records as ShelfAiMetadataRecord[]);

export const SHELF_CHARACTERS: Character[] = [...SHELF_ORIGINAL_CHARACTERS];

const IMPORT_MAX_LENGTH = SHELF_CHARACTER_CARD_MAX_BYTES;

/** Decode supplied file bytes without silently replacing malformed text. */
export function decodeShelfCharacterImportBytes(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > IMPORT_MAX_LENGTH) throw new Error("角色卡文件不能超过 5 MB。");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。"); }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function boundedImportBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > IMPORT_MAX_LENGTH) throw new Error("角色卡文件不能超过 5 MB。");
  return bytes;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function pngTextChunks(bytes: Uint8Array): Map<string, string> {
  const found = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const next = start + length + 4;
    if (next > bytes.length) throw new Error("图片文件不完整，无法读取其中的角色卡。");
    if (type === "tEXt") {
      const data = bytes.subarray(start, start + length);
      const split = data.indexOf(0);
      if (split > 0) {
        const key = new TextDecoder("latin1").decode(data.subarray(0, split));
        if (!found.has(key)) found.set(key, new TextDecoder("latin1").decode(data.subarray(split + 1)));
      }
    }
    if (type === "IEND") return found;
    offset = next;
  }
  throw new Error("图片文件不完整，无法读取其中的角色卡。");
}

function pngTextValue(chunks: Map<string, string>, name: string): string | undefined {
  for (const [key, value] of chunks) if (key.toLowerCase() === name) return value;
  return undefined;
}

function decodeEmbeddedCharacterCard(encoded: string): string {
  const compact = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error("图片里的角色卡数据无法读取。");
  let binary: string;
  try { binary = atob(compact); }
  catch { throw new Error("图片里的角色卡数据无法读取。"); }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(decoded); }
  catch { throw new Error("图片里的角色卡数据无法读取。"); }
}

/** A PNG may carry a SillyTavern card in a tEXt chunk. ccv3 is newer than chara. */
export function readShelfCharacterImportText(input: Uint8Array | ArrayBuffer): { text: string; embeddedPng: boolean } {
  const bytes = boundedImportBytes(input);
  if (!isPng(bytes)) return { text: decodeShelfCharacterImportBytes(bytes), embeddedPng: false };
  const chunks = pngTextChunks(bytes);
  const embedded = pngTextValue(chunks, "ccv3") ?? pngTextValue(chunks, "chara");
  if (!embedded) throw new Error("这张图片里没有嵌入的角色卡。");
  return { text: decodeEmbeddedCharacterCard(embedded), embeddedPng: true };
}

export function shelfPngCharacterFile(file: File, bytes: Uint8Array): File {
  if (file.type === "image/png") return file;
  const name = file.name.toLowerCase().endsWith(".png") ? file.name : `${file.name || "character"}.png`;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "image/png" });
}
const IMPORT_TEXT_LIMITS = {
  name: 120,
  author: 120,
  description: SHELF_CHARACTER_PROSE_LIMIT,
  personality: SHELF_CHARACTER_PROSE_LIMIT,
  scenario: SHELF_CHARACTER_PROSE_LIMIT,
  firstMessage: SHELF_CHARACTER_PROSE_LIMIT,
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
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("tags 必须是最多 100 个标签的数组。");
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
    return DEFAULT_SHELF_CHARACTER_COVER;
  }
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("cover 必须是有效的图片地址。");
  }
  return parseShelfImageUrl(value);
}

function applyCharacterCardV3(card: Record<string, unknown>) {
  const name = card.name;
  if ((name === undefined || name === null || (typeof name === "string" && !name.trim())) && typeof card.nickname === "string" && card.nickname.trim()) {
    card.name = card.nickname;
  }
  const notes = card.creator_notes ?? card.creatorNotes;
  const notesEmpty = notes === undefined || notes === null || (typeof notes === "string" && !notes.trim());
  if (notesEmpty && isRecord(card.creator_notes_multilingual)) {
    const localized = card.creator_notes_multilingual;
    const preferred = ["zh-CN", "zh-Hans", "zh", "zh-TW", "en"];
    const chosen = preferred.map(key => localized[key]).find(value => typeof value === "string" && value.trim())
      ?? Object.values(localized).find(value => typeof value === "string" && value.trim());
    if (typeof chosen === "string") card.creator_notes = chosen;
  }
  const cover = card.cover;
  if ((cover === undefined || cover === null || cover === "") && Array.isArray(card.assets)) {
    const icon = card.assets.find(asset => isRecord(asset) && (asset.type === "icon" || asset.type === undefined)
      && typeof asset.uri === "string" && /^https?:\/\//i.test(asset.uri));
    if (isRecord(icon) && typeof icon.uri === "string") card.cover = icon.uri;
  }
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
  let parsed: unknown = input;
  if (typeof input === "string") {
    if (input.length > IMPORT_MAX_LENGTH || new TextEncoder().encode(input).byteLength > IMPORT_MAX_LENGTH) {
      throw new Error("角色卡文件不能超过 5 MB。");
    }
    try {
      parsed = JSON.parse(input.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("无法读取角色卡，请选择有效的 JSON 文件。");
    }
  }
  if (!isRecord(parsed)) throw new Error("角色卡必须是 JSON 对象。");
  const spec = parsed.spec;
  if (spec !== undefined && spec !== "chara_card_v2" && spec !== "chara_card_v3") {
    throw new Error("暂时仅支持普通 JSON 角色卡与 SillyTavern v2、v3 角色卡。");
  }
  const isSpecCard = spec === "chara_card_v2" || spec === "chara_card_v3";
  if (isSpecCard && !isRecord(parsed.data)) {
    throw new Error("SillyTavern v2 / v3 角色卡缺少有效的 data 对象。");
  }
  const card = isSpecCard ? { ...(parsed.data as Record<string, unknown>) } : parsed;
  if (spec === "chara_card_v3") applyCharacterCardV3(card);
  if (id !== undefined && (!id.trim() || id.length > 120 || id.includes("\0"))) {
    throw new Error("角色 ID 必须是最多 120 个字符的非空文本。");
  }
  const firstMessageKey = isSpecCard || card.firstMessage === undefined ? "first_mes" : "firstMessage";
  const character: Character = {
    id: id?.trim() ?? createImportId(),
    name: readText(card, "name", IMPORT_TEXT_LIMITS.name, true),
    author: readText(card, isSpecCard && card.author === undefined ? "creator" : "author", IMPORT_TEXT_LIMITS.author) || "本地导入",
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
    ...parseShelfCharacterContext(card),
  };
  // An uploaded card that never picked a voice still gets the tavern default,
  // so the new character can speak as soon as it is created.
  if (!character.speechVoice) character.speechVoice = FOLIO_DEFAULT_SPEECH_VOICE;
  if (new TextEncoder().encode(exportCharacterJson(character)).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色卡总量不能超过 5 MB，请减少扩展设定。");
  return character;
}

/** Export an editable local card without implying it contains the site's prompts. */
export function exportCharacterJson(character: Character): string {
  if (character.authoringDraft) throw new Error("这张角色还有未完成的世界书，请导出私人创作草稿，或完善后再导出角色卡。");
  if (character.introductionDeferred || character.contextDeferred) throw new Error("角色介绍仍在加载，请稍候再导出。");
  const originalExport = readFolioCardProvenance(character);
  const sourceNotes = originalExport?.provenanceKind === "user-provided"
    ? `此文件为用户提供角色卡的内容台兼容格式导出，并非原始下载文件。\n作者：${originalExport.attribution}\n来源：用户提供；许可未核验。\n原始 JSON：${originalExport.downloadUrl}\n原始 PNG：${originalExport.pngDownloadUrl}\n适配说明：${originalExport.changes}${originalExport.compatibilityNotes?.length ? `\n兼容说明：${originalExport.compatibilityNotes.join("；")}` : ""}`
    : originalExport
    ? `此文件为原始角色卡的内容台兼容格式导出，并非原始下载文件。\n作者：${originalExport.attribution}\n授权：${originalExport.licenseName}（${originalExport.licenseUrl}）\n原始来源：${originalExport.sourceUrl}\n原始 JSON：${originalExport.downloadUrl}\n适配说明：${originalExport.changes}`
    : character.catalogReadiness === "metadata-only"
    ? "此文件仅含目录信息，人物设定和开场尚未补齐。"
    : character.sourceKind === "public-summary"
    ? `${character.promptOrigin === "public-verbatim" ? SHELF_PUBLIC_INTRODUCTION_NOTE : SHELF_SOURCE_NOTE}${character.promptOrigin === "public-verbatim" && character.firstMessage ? "\n开场白为公开页面的渲染结果，称呼保留本次预览内容，不代表原始模板。" : ""}\n公开页面：${character.sourceUrl}`
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
      ...pickShelfCharacterContext(character as unknown as Record<string, unknown>),
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
  const compiled = compileShelfPrivateWorldBook(input.authoringDraft);
  const result = { ...character, ...compiled };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色与私人创作草稿总量不能超过 5 MB。");
  return result;
}

export function exportCharacterDraftJson(character: Character): string {
  const { authoringDraft, ...playable } = character;
  const payload = JSON.stringify({
    spec: "folio_authoring_draft_v1", data: { character: JSON.parse(exportCharacterJson(playable)), authoringDraft: authoringDraft ?? null },
  }, null, 2);
  if (new TextEncoder().encode(payload).byteLength > IMPORT_MAX_LENGTH) throw new Error("私人创作草稿文件不能超过 5 MB。");
  return payload;
}

/** Explicit private draft files are distinct from ordinary playable character cards. */
export function parseCharacterDraftImport(input: unknown, id?: string): Character {
  let parsed = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色文件不能超过 5 MB。");
    try { parsed = JSON.parse(input.replace(/^\uFEFF/, "")); } catch { throw new Error("无法读取角色文件，请选择有效的 JSON 文件。"); }
  }
  if (!isRecord(parsed) || parsed.spec !== "folio_authoring_draft_v1") return parseCharacterImport(parsed, id);
  if (!isRecord(parsed.data) || !isRecord(parsed.data.character)) throw new Error("私人创作草稿缺少有效的角色内容。");
  if (parsed.data.authoringDraft === undefined) throw new Error("私人创作草稿缺少创作数据。");
  return parsePrivateCharacter({ ...parsed.data.character, authoringDraft: parsed.data.authoringDraft }, id);
}

// Shelf rows keep the homepage graph free of card bodies. The deferred catalog
// replaces listPreview entries with the playable cards before a chat starts.
function shelfCharacter(record: {
  id: string; author: string; createdAt: string; sourceUrl?: string; cover: string;
  shelfName: string; shelfTags: readonly string[]; shelfDescription: string; userProvided?: boolean;
}): Character {
  const name = record.shelfName || "未命名角色";
  return {
    id: record.id,
    name,
    author: record.author || (record.userProvided ? "用户提供" : "匿名创作者"),
    heat: folioHomepageStat(record.id)?.heat ?? "—",
    likes: folioHomepageStat(record.id)?.likes ?? "0",
    cover: record.cover,
    tags: record.userProvided ? fillCustomShelfTags(name, record.shelfTags) : [...record.shelfTags],
    description: record.shelfDescription,
    personality: "",
    scenario: "",
    firstMessage: "",
    sourceUrl: record.sourceUrl ?? "",
    sourceKind: "public-summary",
    promptOrigin: "public-verbatim",
    catalogReadiness: "full-card",
    createdAt: record.createdAt,
    listPreview: true,
  };
}

const SHELF_EXPORTED_SHELF_CHARACTERS: Character[] = FOLIO_EXPORTED_SHELF_RECORDS.map(record => shelfCharacter({
  ...record,
  cover: `/shelf/exported-cards/${record.slug}-cover.png`,
}));

const SHELF_USER_PROVIDED_SHELF_CHARACTERS: Character[] = FOLIO_USER_PROVIDED_SHELF_RECORDS.map(record => shelfCharacter({
  ...record,
  author: record.author || "用户提供",
  cover: record.coverUrl,
  sourceUrl: "",
  userProvided: true,
}));

/** Archive lookup is reserved for saved chats; it must not populate public discovery. */
export const SHELF_CATALOG_CHARACTERS: Character[] = [...SHELF_AI_CHARACTERS, ...SHELF_CHARACTERS, ...SHELF_EXPORTED_SHELF_CHARACTERS, ...SHELF_USER_PROVIDED_SHELF_CHARACTERS];

// Keep the 55 metadata placeholders and the five background-only cards in the
// archive. Public discovery waits until a card and world book are complete.
export const FOLIO_RETIRED_CARD_IDS: ReadonlySet<string> = new Set(retiredCards.ids as string[]);
export const SHELF_LISTED_CHARACTERS: Character[] = [
  ...SHELF_EXPORTED_SHELF_CHARACTERS,
  ...SHELF_USER_PROVIDED_SHELF_CHARACTERS,
  ...SHELF_AI_CHARACTERS.filter(character => character.catalogReadiness === "full-card"),
].filter(character => !FOLIO_RETIRED_CARD_IDS.has(character.id));
const SHELF_LISTED_CHARACTER_IDS = new Set(SHELF_LISTED_CHARACTERS.map((character) => character.id));
export const isShelfListedCharacter = (character: Pick<Character, "id">): boolean =>
  SHELF_LISTED_CHARACTER_IDS.has(character.id);
