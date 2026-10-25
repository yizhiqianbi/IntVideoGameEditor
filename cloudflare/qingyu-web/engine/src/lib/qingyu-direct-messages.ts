import type { DzmmConversationOpeningSnapshot } from "./dzmm-conversation-context";

export const QINGYU_DIRECT_MESSAGE_STYLE = [
  "这是手机私信，不是小说。只写他打出来发过去的字。",
  "一次回一到三条，每条单独一行，每条一般不超过二十五个字，口语，可以只回一个字。",
  "不写星号动作、旁白、环境、表情和心理，不写“他说”。想表达动作就用文字说出来，比如“刚到家”。",
  "可以偶尔用一个表情符号或“哈哈”“嗯”。不要每条都提问，也不要给选项。",
  "亲近可以，亲吻之后停笔。",
].join("\n");

/** Direct-message conversations keep the card, but its post-history slot asks for phone-style replies. */
export function withQingyuDirectMessageStyle<T extends { postHistoryInstructions?: string }>(character: T): T {
  const existing = character.postHistoryInstructions?.trim();
  return { ...character, postHistoryInstructions: existing ? `${existing}\n\n${QINGYU_DIRECT_MESSAGE_STYLE}` : QINGYU_DIRECT_MESSAGE_STYLE };
}

export function qingyuDirectOpening(lines: readonly string[]): DzmmConversationOpeningSnapshot {
  return { version: 1, kind: "opening", source: "template",
    messages: lines.filter(line => line.trim()).slice(0, 20).map(content => ({ role: "assistant" as const, content })) };
}

/** One reply becomes several bubbles; a line that is only an action stays as a quiet caption. */
export function splitQingyuDirectMessage(text: string): { text: string; aside: boolean }[] {
  return text.split(/\n+/).map(line => line.trim()).filter(Boolean)
    .map(line => /^\*[^*]+\*$/.test(line) ? { text: line.slice(1, -1).trim(), aside: true } : { text: line, aside: false })
    .filter(part => part.text);
}

export function qingyuDirectPreview(text: string): string {
  const parts = splitQingyuDirectMessage(text.replace(/\*[^*\n]*\*/g, " ").replace(/[ \t]+/g, " "));
  return parts.at(-1)?.text ?? "";
}
