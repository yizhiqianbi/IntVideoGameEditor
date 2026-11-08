import { splitDzmmDraftKeywords } from "./dzmm-character-draft";
import { expandDzmmPromptMacros } from "./dzmm-prompt-card";

export type DzmmAuthoringReviewInput = {
  name: string;
  introduction: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  messageExamples: string;
  messages: readonly { role: "user" | "assistant"; content: string }[];
  greetings: readonly string[];
  selectedOpening: number;
  entries: readonly {
    entry: { name?: string; enabled?: boolean; constant?: boolean; selective?: boolean; content: string };
    keysText: string;
    secondaryText: string;
  }[];
};
export type DzmmAuthoringReviewWarning = {
  id: string;
  message: string;
  target: "identity" | "opening" | "book";
};
export type DzmmAuthoringReview = {
  modelFields: string[];
  hasScenario: boolean;
  assistantMessages: number;
  userMessages: number;
  enabledBookEntries: number;
  constantBookEntries: number;
  warnings: DzmmAuthoringReviewWarning[];
};

const MODEL_FIELDS = [
  ["description", "详细描述"],
  ["personality", "性格与说话方式"],
  ["scenario", "故事场景"],
  ["systemPrompt", "系统指令"],
  ["postHistoryInstructions", "后置指令"],
  ["messageExamples", "对话示例"],
] as const;
const MACRO_REFERENCE = Object.freeze({ characterName: "角色", userName: "玩家", original: "默认指令" });

function hasUnknownMacro(text: string): boolean {
  return Array.from(text.matchAll(/\{\{[^{}]*\}\}/g)).some(([macro]) =>
    expandDzmmPromptMacros(macro, MACRO_REFERENCE) === macro,
  );
}
function hasKeywordMacro(text: string): boolean { return /\{\{[^{}]*\}\}/.test(text); }

/** Filled fields and literal capability warnings, never a story-quality score or save validator. */
export function analyzeDzmmAuthoringReview(input: DzmmAuthoringReviewInput): DzmmAuthoringReview {
  const warnings: DzmmAuthoringReviewWarning[] = [];
  function checkMacros(text: string, id: string, label: string, target: DzmmAuthoringReviewWarning["target"]) {
    if (hasUnknownMacro(text)) warnings.push({ id, target,
      message: `${label}含未执行的占位符。目前仅支持 {{char}}、{{user}}、{{original}}；其他写法会作为普通文字保留。` });
  }
  for (const [field, label] of MODEL_FIELDS) checkMacros(input[field], `macros-${field}`, label, "identity");
  input.messages.forEach((message, index) => checkMacros(message.content, `macros-opening-${index}`, `主开场第 ${index + 1} 条消息`, "opening"));
  input.greetings.forEach((greeting, index) => checkMacros(greeting, `macros-greeting-${index}`, `备选开场 ${index + 1}`, "opening"));

  const enabledEntries = input.entries.filter(({ entry }) => entry.enabled !== false);
  input.entries.forEach(({ entry, keysText, secondaryText }, index) => {
    if (entry.enabled === false) return;
    const label = entry.name?.trim() || `词条 ${index + 1}`;
    checkMacros(entry.content, `macros-book-${index}`, label, "book");
    if (entry.constant === true) return;
    if (entry.selective === true && !splitDzmmDraftKeywords(secondaryText).length) warnings.push({
      id: `secondary-book-${index}`, target: "book", message: `${label}启用了同时匹配辅助词，但还没有辅助关键词，无法通过关键词激活。`,
    });
    if (hasKeywordMacro(keysText) || hasKeywordMacro(secondaryText)) warnings.push({
      id: `keywords-book-${index}`, target: "book", message: `${label}的关键词含占位符。关键词不会展开占位符，只按原文匹配；请填写具体名称或别名。`,
    });
  });

  // Match the editor preview: a removed or invalid alternative falls back to the main opening.
  const alternative = input.selectedOpening > 0 ? input.greetings[input.selectedOpening - 1] : undefined;
  const preview = alternative === undefined ? input.messages : [{ role: "assistant" as const, content: alternative }];
  return {
    modelFields: MODEL_FIELDS.filter(([field]) => input[field].trim()).map(([, label]) => label),
    hasScenario: Boolean(input.scenario.trim()),
    assistantMessages: preview.filter(message => message.role === "assistant" && message.content.trim()).length,
    userMessages: preview.filter(message => message.role === "user" && message.content.trim()).length,
    enabledBookEntries: enabledEntries.length,
    constantBookEntries: enabledEntries.filter(({ entry }) => entry.constant === true).length,
    warnings,
  };
}
