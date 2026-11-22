/**
 * SillyTavern-compatible prompt assembly (Prompt Manager semantics).
 *
 * Sections are named, orderable and individually toggleable, mirroring ST's
 * prompt manager. Depth-based injection (author's note, world-book @depth
 * entries, memory) is inserted inside the chat history instead of appending at
 * the end. Context budgeting trims the oldest *live* history first, never the
 * authored openings and never system instructions.
 */

import { estimateTavernTokens, type TavernEntryRole, type TavernWorldbookEntry } from "./worldbook";

export const TAVERN_PROMPT_SECTIONS = [
  "main",
  "worldInfoBefore",
  "personaDescription",
  "charDescription",
  "charPersonality",
  "scenario",
  "appearance",
  "preset",
  "worldInfoAfter",
  "dialogueExamples",
  "chatHistory",
  "authorNote",
  "memory",
  "postHistoryInstructions",
  "statusPanel",
  "jailbreak",
] as const;
export type TavernPromptSectionId = (typeof TAVERN_PROMPT_SECTIONS)[number];

export type TavernRole = "system" | "user" | "assistant";
export type TavernPromptMessage = { role: TavernRole; content: string };

export type TavernPromptInput = {
  characterName: string;
  userName: string;
  /** Card text after macro expansion. Empty strings are skipped. */
  main?: string;
  personaDescription?: string;
  charDescription?: string;
  charPersonality?: string;
  scenario?: string;
  appearance?: string;
  preset?: string;
  worldInfoBefore?: TavernWorldbookEntry[];
  worldInfoAfter?: TavernWorldbookEntry[];
  /** World-book entries activated with an explicit role and depth. */
  worldInfoAtDepth?: Array<{ entry: TavernWorldbookEntry; depth: number; role: TavernEntryRole }>;
  dialogueExamples?: TavernPromptMessage[];
  history: TavernPromptMessage[];
  /** Opening messages that are always kept in front of the live history. */
  opening?: TavernPromptMessage[];
  memory?: string;
  authorNote?: { content: string; depth: number; role: TavernRole };
  postHistoryInstructions?: string;
  statusPanel?: string;
  jailbreak?: string;
};

export type TavernPromptSettings = {
  /** Explicit section order; it is the complete list of injected sections. */
  order?: TavernPromptSectionId[];
  enabled?: Partial<Record<TavernPromptSectionId, boolean>>;
  /** Token budget for the whole prompt. 0 disables budgeting. */
  contextTokens?: number;
  /** Always keep at least this many recent live-history messages when trimming. */
  minimumHistory?: number;
};

export type TavernPromptSectionDiagnostic = {
  id: TavernPromptSectionId | "worldInfoAtDepth";
  role: TavernRole;
  chars: number;
  depth?: number;
};

export type TavernPromptPlan = {
  messages: TavernPromptMessage[];
  sections: TavernPromptSectionDiagnostic[];
  estimatedTokens: number;
  trimmedHistory: number;
  warnings: string[];
};

const DEFAULT_ORDER: TavernPromptSectionId[] = [...TAVERN_PROMPT_SECTIONS];
const DEFAULT_MINIMUM_HISTORY = 2;
const MESSAGE_OVERHEAD_TOKENS = 4;

function roleOf(role: TavernEntryRole): TavernRole {
  return role === "user" ? "user" : role === "assistant" ? "assistant" : "system";
}

function joinEntries(entries: TavernWorldbookEntry[] | undefined): string {
  return (entries ?? []).map(entry => entry.content).filter(content => content.trim()).join("\n");
}

type DepthInjection = { index: number; role: TavernRole; content: string; depth: number; id: TavernPromptSectionDiagnostic["id"] };

/** Build the ordered section list, honouring settings toggles and order. */
export function buildTavernPromptPlan(input: TavernPromptInput, settings: TavernPromptSettings = {}): TavernPromptPlan {
  const enabled = settings.enabled ?? {};
  const order = settings.order?.length ? settings.order : DEFAULT_ORDER;
  const warnings: string[] = [];
  const opening = input.opening ?? [];
  const openingTokens = opening.reduce((sum, message) => sum + estimateTavernTokens(message.content) + MESSAGE_OVERHEAD_TOKENS, 0);
  const liveHistory: TavernPromptMessage[] = [...input.history];
  const contextTokens = Math.max(0, settings.contextTokens ?? 0);
  const minimumHistory = Math.max(0, settings.minimumHistory ?? DEFAULT_MINIMUM_HISTORY);

  function sectionMessages(id: TavernPromptSectionId): TavernPromptMessage[] {
    if (enabled[id] === false) return [];
    switch (id) {
      case "main":
        return input.main?.trim() ? [{ role: "system", content: input.main }] : [];
      case "worldInfoBefore": {
        const content = joinEntries(input.worldInfoBefore);
        return content ? [{ role: "system", content }] : [];
      }
      case "personaDescription":
        return input.personaDescription?.trim() ? [{ role: "system", content: input.personaDescription }] : [];
      case "charDescription":
        return input.charDescription?.trim() ? [{ role: "system", content: input.charDescription }] : [];
      case "charPersonality":
        return input.charPersonality?.trim() ? [{ role: "system", content: input.charPersonality }] : [];
      case "scenario":
        return input.scenario?.trim() ? [{ role: "system", content: input.scenario }] : [];
      case "appearance":
        return input.appearance?.trim() ? [{ role: "system", content: input.appearance }] : [];
      case "preset":
        return input.preset?.trim() ? [{ role: "system", content: input.preset }] : [];
      case "worldInfoAfter": {
        const content = joinEntries(input.worldInfoAfter);
        return content ? [{ role: "system", content }] : [];
      }
      case "dialogueExamples":
        return (input.dialogueExamples ?? []).filter(message => message.content.trim());
      case "authorNote":
        return input.authorNote?.content.trim() ? [{ role: input.authorNote.role, content: input.authorNote.content }] : [];
      case "memory":
        return input.memory?.trim() ? [{ role: "system", content: input.memory }] : [];
      case "postHistoryInstructions":
        return input.postHistoryInstructions?.trim() ? [{ role: "system", content: input.postHistoryInstructions }] : [];
      case "statusPanel":
        return input.statusPanel?.trim() ? [{ role: "system", content: input.statusPanel }] : [];
      case "jailbreak":
        return input.jailbreak?.trim() ? [{ role: "system", content: input.jailbreak }] : [];
      default:
        return [];
    }
  }

  /** @depth insertion happens inside history: depth 0 is after the latest message. */
  function depthInjections(history: ReadonlyArray<TavernPromptMessage>): DepthInjection[] {
    const injections: DepthInjection[] = [];
    for (const item of input.worldInfoAtDepth ?? []) {
      if (!item.entry.content.trim()) continue;
      injections.push({
        index: Math.max(0, history.length - item.depth), role: roleOf(item.role), content: item.entry.content,
        depth: item.depth, id: "worldInfoAtDepth",
      });
    }
    if (input.authorNote?.content.trim()) {
      // The author note is authored data: it is injected at depth unless the
      // section itself is explicitly disabled.
      const depth = Math.max(0, input.authorNote.depth);
      injections.push({ index: Math.max(0, history.length - depth), role: input.authorNote.role, content: input.authorNote.content, depth, id: "authorNote" });
    }
    return injections.sort((left, right) => left.index - right.index || right.depth - left.depth);
  }

  // Budget: reserve fixed sections and the authored openings, trim oldest live history.
  let trimmedHistory = 0;
  if (contextTokens > 0) {
    const fixed = order
      .filter(id => id !== "chatHistory" && id !== "authorNote")
      .flatMap(sectionMessages)
      .reduce((sum, message) => sum + estimateTavernTokens(message.content) + MESSAGE_OVERHEAD_TOKENS, 0);
    const depthTokens = (input.worldInfoAtDepth ?? []).reduce((sum, item) => sum + estimateTavernTokens(item.entry.content) + MESSAGE_OVERHEAD_TOKENS, 0);
    const noteTokens = input.authorNote?.content.trim() ? estimateTavernTokens(input.authorNote.content) + MESSAGE_OVERHEAD_TOKENS : 0;
    const remaining = contextTokens - fixed - depthTokens - noteTokens - openingTokens;
    let used = 0;
    const kept: TavernPromptMessage[] = [];
    for (let index = liveHistory.length - 1; index >= 0; index--) {
      const cost = estimateTavernTokens(liveHistory[index].content) + MESSAGE_OVERHEAD_TOKENS;
      const protectedHistory = liveHistory.length - index <= minimumHistory;
      if (used + cost > Math.max(0, remaining) && !protectedHistory) break;
      kept.unshift(liveHistory[index]);
      used += cost;
    }
    trimmedHistory = liveHistory.length - kept.length;
    liveHistory.splice(0, liveHistory.length, ...kept);
    if (trimmedHistory > 0) warnings.push(`上下文超出预算，已裁剪最旧的 ${trimmedHistory} 条历史消息。`);
  }

  const historyMessages: TavernPromptMessage[] = [...opening, ...liveHistory];
  const injections = depthInjections(historyMessages);

  const messages: TavernPromptMessage[] = [];
  const sections: TavernPromptSectionDiagnostic[] = [];
  let historyWritten = false;

  const push = (id: TavernPromptSectionDiagnostic["id"], role: TavernRole, content: string, extra: { depth?: number } = {}) => {
    if (!content.trim()) return;
    messages.push({ role, content });
    sections.push({ id, role, chars: content.length, ...extra });
  };

  function writeHistory() {
    if (historyWritten) return;
    historyWritten = true;
    const byIndex = new Map<number, DepthInjection[]>();
    for (const injection of injections) {
      const list = byIndex.get(injection.index) ?? [];
      list.push(injection);
      byIndex.set(injection.index, list);
    }
    const flush = (index: number) => {
      for (const injection of byIndex.get(index) ?? []) push(injection.id, injection.role, injection.content, { depth: injection.depth });
    };
    flush(0);
    for (let index = 0; index < historyMessages.length; index++) {
      const message = historyMessages[index];
      if (message.content.trim()) push("chatHistory", message.role, message.content);
      flush(index + 1);
    }
  }

  for (const id of order) {
    if (id === "chatHistory") {
      writeHistory();
      continue;
    }
    // The author note is injected at depth inside history, never duplicated as
    // a top-level section.
    if (id === "authorNote") continue;
    for (const message of sectionMessages(id)) push(id, message.role, message.content);
  }
  writeHistory();

  const estimatedTokens = messages.reduce((sum, message) => sum + estimateTavernTokens(message.content) + MESSAGE_OVERHEAD_TOKENS, 0);
  return { messages, sections, estimatedTokens, trimmedHistory, warnings };
}

/** Convenience: assemble with ST's documented default order. */
export function assembleTavernPrompt(input: TavernPromptInput, settings: TavernPromptSettings = {}): TavernPromptPlan {
  return buildTavernPromptPlan(input, settings);
}
