import dzmmAiMetadata from "./dzmm-ai-listed-metadata.json";
import publicContextMeta from "./dzmm-public-context-metadata.json";
import { DZMM_CHARACTER_CARD_MAX_BYTES, DZMM_CHARACTER_PROSE_LIMIT, parseDzmmCharacterContext, parseDzmmImageUrl, pickDzmmCharacterContext, type DzmmCharacterContext } from "./dzmm-character-context";

export { DZMM_CHARACTER_CARD_MAX_BYTES };
import { compileDzmmPrivateWorldBook, type DzmmCharacterAuthoringDraft } from "./dzmm-character-draft";
import { XUMENG_EXPORTED_SHELF_RECORDS, XUMENG_USER_PROVIDED_SHELF_RECORDS, readXumengCardProvenance } from "./xumeng-card-shelf";
import { xumengHomepageStat } from "./xumeng-homepage-stats";
import { fillCustomShelfTags } from "./xumeng-shelf-tags";
import { XUMENG_DEFAULT_SPEECH_VOICE } from "./xumeng-voices";
import retiredCards from "./xumeng-retired-cards.json";

export const DEFAULT_DZMM_CHARACTER_COVER = "/dzmm/brand/xumeng-character-placeholder.svg";

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
  /** Shelf rows omit the playable prompt. Open the full card before starting a chat. */
  listPreview?: boolean;
  /** Public-introduction archive rows keep a short shelf line until the full text is opened. */
  introductionDeferred?: boolean;
  /** Scraped public context keeps a short shelf line until a chat needs the full text. */
  contextDeferred?: boolean;
  /** The current account's site like state is loaded separately from the card snapshot. */
  siteLikeCount?: number;
  siteLiked?: boolean;
  authoringDraft?: DzmmCharacterAuthoringDraft | null;
};

export const DZMM_SOURCE_NOTE =
  "角色名称、作者与已观察到的热度来自公开页面。简介、性格、场景和开场白均为本地重新创作，仅参考题材，不代表原站完整角色卡或隐藏提示词。未观察到的数据标为未知。";

export const DZMM_PUBLIC_INTRODUCTION_NOTE =
  "角色介绍保留原站公开页面原文，并注明作者与出处。聊天以这段公开介绍作为设定；未获取独立原始性格、场景、开场白或世界书，不补写成原版角色卡。";

export const DZMM_CATEGORIES = [
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
    sourceUrl: `https://www.dzmm.ai/character/${character.id}`,
    sourceKind: "public-summary",
    promptOrigin: "original",
    createdAt: "2026-10-02T00:00:00.000Z",
    tags: fillCustomShelfTags(character.name, character.tags),
  };
}

export const DZMM_ORIGINAL_CHARACTERS: Character[] = [
  publicCharacter({
    id: "1323657",
    name: "自定义角色",
    author: "奈奈",
    heat: "2326.4万",
    likes: "4.2万",
    cover: "/dzmm/covers/1323657.webp",
    tags: ["自定义", "世界模拟", "大世界", "剧情", "一般向"],
    description: "把一个人物、一段相遇或一个世界写下来，让故事从你的设定开始。",
    personality: "你是一位耐心的故事搭档。先询问用户希望扮演的成年角色与故事背景，再按照确定的性格回应。亲密和性爱按成年人的具体身体来写，不改成隐喻或突然结束。保持设定连贯，尊重用户的选择，不替用户决定行动。",
    scenario: "用户与故事搭档一起建立原创人物和世界，每次交流推进一小段情节。",
    firstMessage: "欢迎来到你的故事。先告诉我：你想遇见怎样的角色？我们会在哪里相遇？如果还没有想好，也可以从一句简单的设定开始。",
  }),
  publicCharacter({
    id: "2999180",
    name: "《剑与魔法大世界模拟器》",
    author: "阿尔 ®️",
    heat: "197.4万",
    likes: "9210",
    cover: "/dzmm/covers/2999180.webp",
    tags: ["异世界", "角色扮演", "新手向", "低消耗", "大世界", "世界卡", "西幻", "阿尔卡", "奇幻", "剧情"],
    description: "从一座边境小镇出发，在剑术、魔法与未知大陆之间选择自己的道路。",
    personality: "你是一位细致的奇幻冒险叙述者。描绘环境和人物，给出可行选择，同时允许用户自由行动。魔法有规则与代价，人物各有动机；记住已经发生的事件。",
    scenario: "一名成年旅人来到群山之间的边境小镇，委托栏、法师书屋和旧城遗迹各自通向一段旅程。",
    firstMessage: "晨雾散开时，你抵达了青石镇。城门旁贴着一张护送商队的委托；书屋里，老法师正在寻找失踪的地图。你想先去哪里，或者先介绍一下自己？",
  }),
  publicCharacter({
    id: "3593542",
    name: "《自定义世界》",
    author: "阿尔 ®️",
    heat: "50万",
    likes: "297",
    cover: "/dzmm/covers/3593542.webp",
    tags: ["自定义", "世界模拟", "大世界", "一般向"],
    description: "为世界写下第一条规则，探索它会怎样改变生活、关系与命运。",
    personality: "你是一位开放而严谨的世界构建者。把用户提出的规则转化为具体场景，并说明规则的合理后果。不擅自更改核心设定，不预设用户的身份或情绪。",
    scenario: "一张空白地图等待命名。用户可以决定时代、地理、技术或魔法规则，再进入这个世界生活。",
    firstMessage: "地图还没有名字，故事也尚未开始。这个世界最特别的一条规则是什么？天空中有浮岛，记忆可以交易，或只是一个温暖的小镇，都可以成为起点。",
  }),
  publicCharacter({
    id: "3136355",
    name: "万界穿梭：我能够穿越无限世界",
    author: "阿尔 ®️",
    heat: "35.8万",
    likes: "183",
    cover: "/dzmm/covers/3136355.webp",
    tags: ["奇幻冒险", "世界模拟", "大世界", "奇幻", "剧情"],
    description: "一扇门连接不同的世界，每次穿越都是新的规则、同伴与选择。",
    personality: "你是跨世界旅程的引导者。为每个世界建立清晰规则与目标，延续旅人已经取得的经验。用探索、解谜和交流推动剧情，先确认用户的决定再描述结果。",
    scenario: "成年旅人收到一枚可以开启世界之门的罗盘。第一站可以是蒸汽都市、云海群岛或星际驿站。",
    firstMessage: "掌心的罗盘忽然亮起，面前出现三道门：齿轮与浓雾、云海与古树、星光与机械。门上各有一句提醒。你想靠近哪一道，还是先研究一下罗盘？",
  }),
  publicCharacter({
    id: "3300877",
    name: "《三万粉纪念：自定义世界》",
    author: "阿尔 ®️",
    heat: "86万",
    likes: "2034",
    cover: "/dzmm/covers/3300877.webp",
    tags: ["自定义", "世界模拟", "大世界", "剧情", "一般向"],
    description: "从一座城市或一片大陆开始，把细小的设定慢慢拼成属于你的世界。",
    personality: "你是一位善于协作的原创世界叙述者。用简短提问帮助用户确定世界观，之后提供自然的场景反馈。允许慢节奏日常与长线冒险，保持规则一致。",
    scenario: "用户是新世界的共同创作者，可以从地名、职业、人物关系或一件日常小事建立世界。",
    firstMessage: "我们先从一个地方开始吧。它是一座靠海的城、森林中的小屋，还是航行在星海里的空间站？告诉我它的名字，我会把第一幕写给你。",
  }),
  publicCharacter({
    id: "3624049",
    name: "异能都市：开局觉醒双异能，书写新世界传奇人生",
    author: "阿白",
    heat: "162.2万",
    likes: "2205",
    cover: "/dzmm/covers/3624049.webp",
    tags: ["都市异能", "奇幻冒险", "都市", "剧情", "一般向"],
    description: "城市里第一次出现无法解释的现象，而你同时发现了两种陌生的能力。",
    personality: "你是都市异能故事的叙述者。赋予能力清晰边界与成长过程，让调查和团队合作有意义。把普通生活与异常事件联系起来，不预设用户必须成为英雄。",
    scenario: "一名成年城市居民在停电之夜觉醒两种能力。清晨，一封来自城市异常调查所的邀请出现在门口。",
    firstMessage: "昨夜停电时，你先听见了远处的求助声，随后让一只坠落的杯子停在半空。现在，门口放着一封邀请。你想检查自己的能力，读信，还是照常出门？",
  }),
  publicCharacter({
    id: "1342638",
    name: "第二人生模拟系统",
    author: "托莉娜",
    heat: "288.4万",
    likes: "4502",
    cover: "/dzmm/covers/1342638.png",
    tags: ["人生模拟", "自定义", "都市", "剧情", "一般向"],
    description: "从成年后的一个新起点出发，看看不同的选择会把生活带向哪里。",
    personality: "你是温和、务实的人生模拟叙述者。根据用户的背景和选择呈现合理的生活事件，关注学习、职业、友情和个人成长。提供选择空间，不作真实人生预测。",
    scenario: "用户为一位成年原创人物设定职业、城市与当前目标，在虚构的人生中体验选择与变化。",
    firstMessage: "新的生活从今天开始。你希望在哪里生活，做什么工作，又想完成哪件一直放在心里的事？给我三个线索，我们就可以翻开第一页。",
  }),
  publicCharacter({
    id: "2844944",
    name: "【万粉纪念卡】《万界修仙沙盒》",
    author: "阿尔 ®️",
    heat: "—",
    likes: "—",
    cover: "/dzmm/covers/2844944.webp",
    tags: ["修仙", "世界模拟", "仙侠古风", "大世界"],
    description: "游历不同的修行世界，从一部功法、一间书院或一座山门建立自己的旅程。",
    personality: "你是修仙沙盒的讲述者。让功法、资源和修行进度保持一致；用探索、学习和协作推动成长。用户可以自定目标，不必追逐唯一的成就路线。",
    scenario: "一位成年修行者在山间驿站醒来，获得一张记载不同世界入口的旧图。",
    firstMessage: "驿站窗外，群山被薄雾遮住。桌上的旧图标出了三处入口：灵植谷、百工书院和听雨山门。店主告诉你，每处都欢迎愿意学习的人。你准备先去哪里？",
  }),
  publicCharacter({
    id: "2960923",
    name: "《天道洋柿子修仙模拟器》",
    author: "阿尔 ®️",
    heat: "180.5万",
    likes: "—",
    cover: "/dzmm/covers/2960923.webp",
    tags: ["修仙", "人生模拟", "仙侠古风", "剧情", "一般向"],
    description: "在轻松的修行日常中种田、读书、炼器，慢慢寻找自己的道。",
    personality: "你是一位轻松而细致的修行故事搭档。以日常劳动、知识积累和朋友间的合作建立成长体验。保持物品与能力的连续性，适度幽默，尊重用户的节奏。",
    scenario: "成年修行者接手一间山脚小院，院中有灵田、工具间和一柜尚未读完的旧书。",
    firstMessage: "小院的钥匙还带着晨露。灵田里长着几株红果，工具间的炉子需要修理，书柜里夹着一封前任主人的信。今天的修行，从哪件小事开始？",
  }),
  publicCharacter({
    id: "1276420",
    name: "化神期的我被小师妹污蔑偷她筑基丹？",
    author: "天禄",
    heat: "103.6万",
    likes: "1427",
    cover: "/dzmm/covers/1276420.webp",
    tags: ["修仙", "奇幻冒险", "仙侠古风", "剧情"],
    description: "一场失踪丹药的指控打破山门平静，你决定如何找到证据、还原真相。",
    personality: "你是注重证据与人物动机的修仙悬疑叙述者。所有角色均为成年人。让证词、记录和线索相互印证，允许沟通、调查与公开说明，不把报复设为默认选择。",
    scenario: "一名已成年的同门指认用户拿走了修行丹药。议事堂尚未作出判断，库房记录、目击者和药匣上的印记等待调查。",
    firstMessage: "议事堂内，长老请众人暂时安静。那位同门把空药匣放到桌上，说昨夜看见你经过库房。你知道事情另有隐情。你想先询问她的见闻，查看记录，还是检查药匣？",
  }),
];

type DzmmAiMetadataRecord = {
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

function scrapedTags(record: DzmmAiMetadataRecord): string[] {
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
  if (!file) return DEFAULT_DZMM_CHARACTER_COVER;
  try {
    return `https://pxlorbit.com/storage/v1/object/public/pub_card_images/${encodeURIComponent(decodeURIComponent(file))}`;
  } catch {
    return DEFAULT_DZMM_CHARACTER_COVER;
  }
}

/** Public narrative and opening evidence is distinct from directory metadata. */
const publicContexts = new Map(publicContextMeta.characters.map((card) => [card.id, card]));

/** Missing character context stays missing: never synthesize a generic persona. */
export function buildDzmmAiCharacters(records: readonly DzmmAiMetadataRecord[]): Character[] {
  return records.map((record) => {
    const name = record.title.trim() || `公开角色 ${record.id}`;
    const sourceUrl = record.source || `https://www.dzmm.ai/character/${record.id}`;
    const createdAt = Number.isFinite(Date.parse(record.publishedAt))
      ? new Date(record.publishedAt).toISOString()
      : "2026-10-14T00:00:00.000Z";
    return {
      id: String(record.id),
      name,
      author: record.author.trim() || "匿名创作者",
      heat: xumengHomepageStat(String(record.id))?.heat ?? "—",
      likes: xumengHomepageStat(String(record.id))?.likes ?? (Number.isSafeInteger(record.likes) && record.likes >= 0 ? String(record.likes) : "—"),
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

const listedAiIds = new Set((dzmmAiMetadata.records as DzmmAiMetadataRecord[]).map((record) => String(record.id)));
if (listedAiIds.size !== publicContexts.size || [...publicContexts.keys()].some((id) => !listedAiIds.has(id))) {
  throw new Error("公开语境角色与首页摘要不一致。");
}

export const DZMM_AI_CHARACTERS: Character[] = buildDzmmAiCharacters(dzmmAiMetadata.records as DzmmAiMetadataRecord[]);

export const DZMM_CHARACTERS: Character[] = [...DZMM_ORIGINAL_CHARACTERS];

const IMPORT_MAX_LENGTH = DZMM_CHARACTER_CARD_MAX_BYTES;

/** Decode supplied file bytes without silently replacing malformed text. */
export function decodeDzmmCharacterImportBytes(input: Uint8Array | ArrayBuffer): string {
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
export function readDzmmCharacterImportText(input: Uint8Array | ArrayBuffer): { text: string; embeddedPng: boolean } {
  const bytes = boundedImportBytes(input);
  if (!isPng(bytes)) return { text: decodeDzmmCharacterImportBytes(bytes), embeddedPng: false };
  const chunks = pngTextChunks(bytes);
  const embedded = pngTextValue(chunks, "ccv3") ?? pngTextValue(chunks, "chara");
  if (!embedded) throw new Error("这张图片里没有嵌入的角色卡。");
  return { text: decodeEmbeddedCharacterCard(embedded), embeddedPng: true };
}

export function dzmmPngCharacterFile(file: File, bytes: Uint8Array): File {
  if (file.type === "image/png") return file;
  const name = file.name.toLowerCase().endsWith(".png") ? file.name : `${file.name || "character"}.png`;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "image/png" });
}
const IMPORT_TEXT_LIMITS = {
  name: 120,
  author: 120,
  description: DZMM_CHARACTER_PROSE_LIMIT,
  personality: DZMM_CHARACTER_PROSE_LIMIT,
  scenario: DZMM_CHARACTER_PROSE_LIMIT,
  firstMessage: DZMM_CHARACTER_PROSE_LIMIT,
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
    return DEFAULT_DZMM_CHARACTER_COVER;
  }
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("cover 必须是有效的图片地址。");
  }
  return parseDzmmImageUrl(value);
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
    ...parseDzmmCharacterContext(card),
  };
  // An uploaded card that never picked a voice still gets the tavern default,
  // so the new character can speak as soon as it is created.
  if (!character.speechVoice) character.speechVoice = XUMENG_DEFAULT_SPEECH_VOICE;
  if (new TextEncoder().encode(exportCharacterJson(character)).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色卡总量不能超过 5 MB，请减少扩展设定。");
  return character;
}

/** Export an editable local card without implying it contains the site's prompts. */
export function exportCharacterJson(character: Character): string {
  if (character.authoringDraft) throw new Error("这张角色还有未完成的世界书，请导出私人创作草稿，或完善后再导出角色卡。");
  if (character.introductionDeferred || character.contextDeferred) throw new Error("角色介绍仍在加载，请稍候再导出。");
  const originalExport = readXumengCardProvenance(character);
  const sourceNotes = originalExport?.provenanceKind === "user-provided"
    ? `此文件为用户提供角色卡的叙梦兼容格式导出，并非原始下载文件。\n作者：${originalExport.attribution}\n来源：用户提供；许可未核验。\n原始 JSON：${originalExport.downloadUrl}\n原始 PNG：${originalExport.pngDownloadUrl}\n适配说明：${originalExport.changes}${originalExport.compatibilityNotes?.length ? `\n兼容说明：${originalExport.compatibilityNotes.join("；")}` : ""}`
    : originalExport
    ? `此文件为原始角色卡的叙梦兼容格式导出，并非原始下载文件。\n作者：${originalExport.attribution}\n授权：${originalExport.licenseName}（${originalExport.licenseUrl}）\n原始来源：${originalExport.sourceUrl}\n原始 JSON：${originalExport.downloadUrl}\n适配说明：${originalExport.changes}`
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
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > IMPORT_MAX_LENGTH) throw new Error("角色与私人创作草稿总量不能超过 5 MB。");
  return result;
}

export function exportCharacterDraftJson(character: Character): string {
  const { authoringDraft, ...playable } = character;
  const payload = JSON.stringify({
    spec: "xumeng_authoring_draft_v1", data: { character: JSON.parse(exportCharacterJson(playable)), authoringDraft: authoringDraft ?? null },
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
  if (!isRecord(parsed) || parsed.spec !== "xumeng_authoring_draft_v1") return parseCharacterImport(parsed, id);
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
    heat: xumengHomepageStat(record.id)?.heat ?? "—",
    likes: xumengHomepageStat(record.id)?.likes ?? "0",
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

const DZMM_EXPORTED_SHELF_CHARACTERS: Character[] = XUMENG_EXPORTED_SHELF_RECORDS.map(record => shelfCharacter({
  ...record,
  cover: `/dzmm/exported-cards/foreverse-${record.slug}-cover.png`,
}));

const DZMM_USER_PROVIDED_SHELF_CHARACTERS: Character[] = XUMENG_USER_PROVIDED_SHELF_RECORDS.map(record => shelfCharacter({
  ...record,
  author: record.author || "用户提供",
  cover: record.coverUrl,
  sourceUrl: "",
  userProvided: true,
}));

/** Archive lookup is reserved for saved chats; it must not populate public discovery. */
export const DZMM_CATALOG_CHARACTERS: Character[] = [...DZMM_AI_CHARACTERS, ...DZMM_CHARACTERS, ...DZMM_EXPORTED_SHELF_CHARACTERS, ...DZMM_USER_PROVIDED_SHELF_CHARACTERS];

// Keep the 55 metadata placeholders and the five background-only cards in the
// archive. Public discovery waits until a card and world book are complete.
export const XUMENG_RETIRED_CARD_IDS: ReadonlySet<string> = new Set(retiredCards.ids);
export const DZMM_LISTED_CHARACTERS: Character[] = [
  ...DZMM_EXPORTED_SHELF_CHARACTERS,
  ...DZMM_USER_PROVIDED_SHELF_CHARACTERS,
  ...DZMM_AI_CHARACTERS.filter(character => character.catalogReadiness === "full-card"),
].filter(character => !XUMENG_RETIRED_CARD_IDS.has(character.id));
const DZMM_LISTED_CHARACTER_IDS = new Set(DZMM_LISTED_CHARACTERS.map((character) => character.id));
export const isDzmmListedCharacter = (character: Pick<Character, "id">): boolean =>
  DZMM_LISTED_CHARACTER_IDS.has(character.id);
