/**
 * SillyTavern-style group chat prompt assembly.
 *
 * A group conversation has 2-4 members. Each turn one member speaks: an explicit
 * speaker wins, then an @mention in the latest user message, then rotation that
 * avoids repeating the previous speaker. The active member's card drives the
 * character sections, every member is listed in the roster, world books are
 * merged, and prior assistant turns are labelled with the member who spoke.
 */

import {
  buildTavernPromptPlan,
  type TavernPromptMessage,
  type TavernPromptPlan,
  type TavernPromptSectionId,
  type TavernPromptSettings,
  type TavernRole,
} from "./prompt";
import { activateTavernWorldbook, parseTavernWorldbook, type TavernWorldbook, type TavernWorldbookEntry } from "./worldbook";
import { expandDzmmPromptMacros } from "../dzmm-prompt-card";
import { XUMENG_DEFAULT_LOCALE, xumengLocaleInstruction, type XumengLocale } from "../xumeng-i18n";

export type TavernGroupMember = {
  characterId: string;
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  appearance?: string;
  systemPrompt?: string;
  messageExamples?: string;
  characterBook?: TavernWorldbook;
};

export type TavernGroupMessage = { role: "user" | "assistant"; content: string; speaker?: string };

export type TavernGroupPromptInput = {
  members: TavernGroupMember[];
  messages: ReadonlyArray<TavernGroupMessage>;
  userName: string;
  locale?: XumengLocale;
  preset?: string;
  persona?: string;
  memory?: string;
  jailbreak?: string;
  opening?: TavernPromptMessage[];
  /** Explicit speaker name; when absent the engine selects one. */
  speaker?: string;
  settings?: TavernPromptSettings;
  seed?: number;
};

export type TavernGroupPromptResult = {
  speaker: TavernGroupMember;
  plan: TavernPromptPlan;
};

const MEMBER_LIMIT = 4;
const MEMBER_MINIMUM = 2;

export function parseTavernGroupMembers(value: unknown): TavernGroupMember[] {
  if (!Array.isArray(value) || value.length < MEMBER_MINIMUM || value.length > MEMBER_LIMIT) {
    throw new Error(`群聊成员必须是 ${MEMBER_MINIMUM} 至 ${MEMBER_LIMIT} 人。`);
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map(candidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("群聊成员格式无效。");
    const source = candidate as Record<string, unknown>;
    const characterId = typeof source.characterId === "string" ? source.characterId.trim() : "";
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!characterId || characterId.length > 120 || ids.has(characterId)) throw new Error("群聊成员角色无效或重复。");
    if (!name || name.length > 80 || names.has(name)) throw new Error("群聊成员名称无效或重复。");
    ids.add(characterId);
    names.add(name);
    const member: TavernGroupMember = { characterId, name };
    for (const field of ["description", "personality", "scenario", "appearance", "systemPrompt", "messageExamples"] as const) {
      const text = source[field];
      if (typeof text === "string" && text.trim()) member[field] = text;
    }
    if (source.characterBook !== undefined && source.characterBook !== null) {
      member.characterBook = parseTavernWorldbook(source.characterBook);
    }
    return member;
  });
}

function previousSpeakerName(messages: ReadonlyArray<TavernGroupMessage>): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") return messages[index].speaker ?? "";
  }
  return "";
}

/** Choose the next speaker. Deterministic for the same conversation state. */
export function selectTavernGroupSpeaker(
  members: ReadonlyArray<TavernGroupMember>,
  messages: ReadonlyArray<TavernGroupMessage>,
  explicit?: string,
): TavernGroupMember {
  if (members.length < MEMBER_MINIMUM) throw new Error("群聊至少需要两个成员。");
  if (explicit) {
    const named = members.find(member => member.name === explicit || member.characterId === explicit);
    if (!named) throw new Error(`群聊里没有名为「${explicit}」的成员。`);
    return named;
  }
  const latestUser = [...messages].reverse().find(message => message.role === "user");
  if (latestUser) {
    // Longest name first so "阿离" cannot shadow "阿离姐姐".
    const mentioned = [...members].sort((left, right) => right.name.length - left.name.length)
      .find(member => latestUser.content.includes(member.name));
    if (mentioned) return mentioned;
  }
  const previous = previousSpeakerName(messages);
  const eligible = members.filter(member => member.name !== previous);
  const rotation = eligible.length ? eligible : members;
  return rotation[rotation.length > 1 ? messages.length % rotation.length : 0];
}

function rosterText(members: ReadonlyArray<TavernGroupMember>, active: TavernGroupMember): string {
  return ["【群聊成员】", ...members.map(member => {
    const summary = (member.description ?? member.personality ?? "").replace(/\s+/g, " ").slice(0, 140);
    return `- ${member.name}${member.name === active.name ? "（本轮由 TA 回应）" : ""}：${summary || "按角色卡设定行动"}`;
  }), "【群聊规则】只写本轮发言成员的动作与台词，不替其他角色、其他成员或用户做决定；不同成员保持各自的声音。"]
    .join("\n");
}

function labelledHistory(messages: ReadonlyArray<TavernGroupMessage>, members: ReadonlyArray<TavernGroupMember>): TavernPromptMessage[] {
  const names = new Set(members.map(member => member.name));
  return messages.map(message => {
    if (message.role !== "assistant") return { role: message.role, content: message.content };
    const speaker = message.speaker && names.has(message.speaker) ? message.speaker : "";
    return { role: message.role, content: speaker ? `【${speaker}】${message.content}` : message.content };
  });
}

function mergeWorldbook(members: ReadonlyArray<TavernGroupMember>, messages: ReadonlyArray<TavernGroupMessage>, seed: number) {
  const before: TavernWorldbookEntry[] = [];
  const after: TavernWorldbookEntry[] = [];
  const atDepth: Array<{ entry: TavernWorldbookEntry; depth: number; role: "system" | "user" | "assistant" }> = [];
  for (const member of members) {
    if (!member.characterBook) continue;
    const activation = activateTavernWorldbook(member.characterBook, messages, { seed });
    before.push(...activation.beforeChar);
    after.push(...activation.afterChar);
    atDepth.push(...activation.atDepth.map(item => ({ entry: item.entry, depth: item.depth, role: item.role })));
  }
  return { before, after, atDepth };
}

export function buildTavernGroupPrompt(input: TavernGroupPromptInput): TavernGroupPromptResult {
  const members = parseTavernGroupMembers(input.members);
  const speaker = selectTavernGroupSpeaker(members, input.messages, input.speaker);
  const seed = input.seed ?? input.messages.length;
  const worldbook = mergeWorldbook(members, input.messages, seed);
  const active = speaker;
  const macro = { characterName: active.name, userName: input.userName || "用户", original: "" };
  const expand = (text?: string) => (text ? expandDzmmPromptMacros(text, macro) : undefined);
  const expandEntries = (entries: TavernWorldbookEntry[]) =>
    entries.map(entry => ({ ...entry, content: expandDzmmPromptMacros(entry.content, macro) }));
  const expandedExamples = active.messageExamples?.trim() ? expand(active.messageExamples) : undefined;
  const localeRule = `回复语言：${xumengLocaleInstruction(input.locale ?? XUMENG_DEFAULT_LOCALE)}`;
  const safetyRule = "互动边界：不替用户或其他群聊成员新增未授权的台词、行动或决定；不讨论现实政治，问到时用角色口吻一句带过。";
  const plan = buildTavernPromptPlan({
    characterName: active.name,
    userName: input.userName,
    main: [expand(active.systemPrompt), expand(rosterText(members, active))].filter(Boolean).join("\n\n"),
    personaDescription: expand(input.persona),
    charDescription: expand(active.description),
    charPersonality: expand(active.personality),
    scenario: expand(active.scenario),
    appearance: expand(active.appearance),
    preset: expand(input.preset),
    worldInfoBefore: expandEntries(worldbook.before),
    worldInfoAfter: expandEntries(worldbook.after),
    worldInfoAtDepth: worldbook.atDepth.map(item => ({
      ...item,
      entry: { ...item.entry, content: expandDzmmPromptMacros(item.entry.content, macro) },
    })),
    dialogueExamples: expandedExamples?.trim() ? [{ role: "system", content: `【${active.name} 的对话示例】\n${expandedExamples}` }] : [],
    history: labelledHistory(input.messages, members),
    opening: input.opening,
    memory: input.memory,
    postHistoryInstructions: [`本轮由「${active.name}」回应。`, localeRule, safetyRule].join("\n"),
    jailbreak: input.jailbreak,
  }, input.settings);
  return { speaker, plan };
}

export const TAVERN_GROUP_SECTION_ORDER: TavernPromptSectionId[] = ["main", "worldInfoBefore", "personaDescription", "charDescription", "charPersonality", "scenario", "appearance", "preset", "worldInfoAfter", "dialogueExamples", "chatHistory", "memory", "postHistoryInstructions", "statusPanel", "jailbreak"];

export type TavernGroupRole = TavernRole;
