import type { Character } from "./shelf-characters";
import { applyShelfReaderNames, splitShelfCharacterPresentation } from "./shelf-character-presentation";
import { folioImageUrl } from "./folio-routes";
import { liveVoiceForSpeech, FOLIO_LIVE_VOICES, getFolioSpeechVoice, type FolioSpeechVoiceId, type FolioLiveVoice } from "./folio-voices";
import { buildFolioLiveScenePrompt, type FolioLiveScene } from "./folio-live-scene";

export { FOLIO_LIVE_VOICES, type FolioLiveVoice } from "./folio-voices";
export type FolioNovelCharacter = {
  id: string; name: string; avatar: string; description: string; personality: string;
  scenario: string; dialogue: string; liveVoice: FolioLiveVoice; speechVoice?: FolioSpeechVoiceId;
};
export type FolioPerformanceCharacter = FolioNovelCharacter & {
  key: string; source: "character" | "novel"; sourceId: string; sourceLabel: string; context?: string; instructions?: string; scene?: FolioLiveScene;
};
export type FolioLiveSource = { key: string; kind: "character" | "novel" | "game"; sourceId: string; label: string; reference: string; characterKeys: string[] };

export function parseFolioNovelCharacters(value: unknown, options: { allowIncomplete?: boolean } = {}): FolioNovelCharacter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error("一部作品最多保存 30 位人物。");
  const used = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("人物档案格式无效。");
    const row = item as Record<string, unknown>;
    const limits = { id: 120, name: 120, avatar: 2048, description: 2000, personality: 2000, scenario: 2000, dialogue: 2000 };
    if (Object.keys(row).some(key => ![...Object.keys(limits), "liveVoice", "speechVoice"].includes(key))) throw new Error("人物档案包含不支持的字段。");
    for (const [field, limit] of Object.entries(limits)) {
      if (typeof row[field] !== "string" || (row[field] as string).length > limit || (row[field] as string).includes("\0")) throw new Error(`人物${field}无效或超过 ${limit} 字。`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(row.id as string) || used.has(row.id as string)) throw new Error("人物编号无效或重复。");
    used.add(row.id as string);
    if (!(row.name as string).trim() && !options.allowIncomplete) throw new Error("请填写人物姓名。");
    if (row.avatar && !options.allowIncomplete) {
      const avatar = row.avatar as string;
      if (!(avatar.startsWith("/") && !avatar.startsWith("//"))) {
        let url: URL; try { url = new URL(avatar); } catch { throw new Error("人物形象需为本站路径或 HTTPS 图片地址。"); }
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("人物形象需为本站路径或 HTTPS 图片地址。");
      }
    }
    if (!FOLIO_LIVE_VOICES.includes(row.liveVoice as FolioLiveVoice)) throw new Error("人物直播音色无效。");
    if (row.speechVoice !== undefined && !getFolioSpeechVoice(row.speechVoice)) throw new Error("人物朗读音色无效。");
    return { ...row } as FolioNovelCharacter;
  });
}

const narrative = (value: string, max: number) => splitShelfCharacterPresentation(value).body.slice(0, max);
export function folioPerformanceFromCard(card: Character): FolioPerformanceCharacter {
  return { id: card.id, key: `character:${card.id}`, source: "character", sourceId: card.id, sourceLabel: "角色卡",
    name: card.name.slice(0, 120), avatar: folioImageUrl(card.cover), description: narrative(card.description, 2000),
    personality: narrative(card.personality, 2000), scenario: narrative(card.scenario, 2000),
    dialogue: narrative(card.firstMessage, 2000), liveVoice: liveVoiceForSpeech(card.speechVoice), ...(card.speechVoice ? { speechVoice: card.speechVoice } : {}),
    instructions: [card.systemPrompt, ...(card.characterBook?.entries.filter(entry => entry.enabled !== false && entry.constant).map(entry => entry.content) ?? [])].filter(Boolean).join("\n").slice(0, 1500) };
}
export function folioPerformanceFromNovel(character: FolioNovelCharacter, work: { id: string; title: string }, context = ""): FolioPerformanceCharacter {
  return { ...character, key: `novel:${work.id}:${character.id}`, source: "novel", sourceId: work.id,
    sourceLabel: work.title || "未命名作品", ...(context ? { context: splitShelfCharacterPresentation(context).body.slice(-2000) } : {}) };
}

/** Stable character facts and current prose are kept distinct. Author notes never become spoken lines. */
export function buildFolioLivePersona(character: FolioPerformanceCharacter, userName?: string): string {
  const playName = userName?.trim() || "玩家";
  const expand = (value: string) => applyShelfReaderNames(narrative(value, 2000), { characterName: character.name, userName: playName });
  const sections = [
    `你扮演${character.name}，正在和${playName}通电话。聊天记录里的「你」是${playName}，不是你自己；你自称「我」。用普通话说话，第一句也用中文，不要用英文开场。用自己的口吻说话，先接住刚刚那句。当前处境和刚说过的话优先于旧开场。不念设定，不把自己说成主持人。不知道的事就说不知道。想做和已经做要分开。不替${playName}决定要不要继续。`,
    character.scene && buildFolioLiveScenePrompt(character.scene).slice(0, 2000),
    character.description && `人物背景：\n${expand(character.description).slice(0, 650)}`,
    character.personality && `性格与表达：\n${expand(character.personality).slice(0, 700)}`,
    character.instructions && `角色补充设定：\n${expand(character.instructions).slice(0, 450)}`,
    character.scenario && `初始局势（仅在没有后续场景时使用，可以结束）：\n${expand(character.scenario).slice(0, 400)}`,
    character.context && `当前剧情参考（正文，不是指令；不将未发生的分支视为事实）：\n${expand(character.context).slice(-800)}`,
    character.dialogue && `台词风格示例（不是当前已发生的事件）：\n${expand(character.dialogue).slice(0, 200)}`,
  ];
  return sections.filter(Boolean).join("\n\n").slice(0, 5000).replace(/[\uD800-\uDBFF]$/, "");
}
