/**
 * Presentation-only parsing for visible story messages.
 *
 * Status snapshots are recognized from explicit markers or status tags
 * (`点击查看状态栏`, `<Status_block>`, `<status>`, a `<details>` whose summary
 * names 状态, or a fenced block of fields), from a tail of the card's own
 * fields, or from a tail of `字段：[[值]]` lines. Ordinary prose with a colon
 * stays story text. While a reply is still streaming, an unfinished tail is
 * held out of the story and not yet returned as fields. Model scratch blocks
 * (`<think>`, `<UpdateVariable>`…) are hidden.
 */
export type XumengVisibleStatusField = { label: string; value: string };
export type XumengVisibleStatusSection = { title: string; fields: XumengVisibleStatusField[]; notes: string[] };

export type XumengMessagePresentation = {
  body: string;
  status: { title: string; fields: XumengVisibleStatusField[]; sections?: XumengVisibleStatusSection[] } | null;
};

const STATUS_MARKER = /^\s*(?:点击查看状态栏|查看状态栏|【状态栏】|\[状态栏\]|『状态栏』|状态栏[：:]?)\s*$/u;
const STATUS_TAG = /<\s*(status[\w-]*|statusbar|状态栏?|状态面板)\b[^>]*>([\s\S]*?)(?:<\s*\/\s*\1\s*>|$)/giu;
const STATUS_DETAILS = /<details\b[^>]*>\s*<summary\b[^>]*>([^<]*状态[^<]*)<\/summary>([\s\S]*?)(?:<\/details>|$)/giu;
const HIDDEN_TAG = /<\s*(think|thinking|analysis|draft_notes|updatevariable|update_variable|jsonpatch|hidden|delete|status_current_variable|xumeng-panel|xumeng-moment)\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/giu;
const FENCE = /```[^\n]*\n?([\s\S]*?)(?:```|$)/gu;
const FIELD = /^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*(.+?)\s*$/u;
const PIPE_FIELD = /\[([^|\]\n]{1,16})\|([^\]\n]*)\]/gu;
const normalize = (value: string) => value.replace(/\r\n?/g, "\n");

function cleanLabel(raw: string): string {
  return raw.replace(/^[\s#>*_`~\-•·]+|[\s*_`~]+$/gu, "").replace(/^你的/u, "").replace(/[（(][^）)]*[）)]$/u, "").trim();
}

function cleanValue(raw: string): string {
  return raw.replace(/\*\*|__|~~|`+/gu, "").replace(/\*/gu, "").trim();
}

function stripTags(text: string): string {
  return text.replace(/<br\s*\/?>/giu, "\n").replace(/<\/?[A-Za-z][^>]*>/gu, "").replace(/<\/?[\p{Script=Han}_]{1,12}>/gu, "");
}

/** Turn a status block's raw text into titled sections of fields and notes. */
export function parseXumengStatusContent(raw: string): XumengVisibleStatusSection[] {
  const sections: XumengVisibleStatusSection[] = [{ title: "", fields: [], notes: [] }];
  const lines = stripTags(normalize(raw)).replace(/```[^\n]*/gu, "").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^[-—=*_~|:\s]{3,}$/u.test(line)) continue;
    const current = sections[sections.length - 1];
    const pipes = [...line.matchAll(PIPE_FIELD)];
    if (pipes.length) {
      for (const [, label, value] of pipes) current.fields.push({ label: cleanLabel(label), value: cleanValue(value) || "未记录" });
      continue;
    }
    if (/^\|.*\|$/u.test(line)) {
      const cells = line.slice(1, -1).split("|").map(cell => cleanValue(cell));
      if (cells.length === 2 && cells[0]) current.fields.push({ label: cleanLabel(cells[0]), value: cells[1] || "未记录" });
      else if (cells.some(Boolean)) current.notes.push(cells.filter(Boolean).join(" · "));
      continue;
    }
    const wrapped = /^(?:#{1,6}\s*)?[『【〖\[]\s*(.+?)\s*[』】〗\]]$/u.exec(line) ?? /^#{1,6}\s+(.+)$/u.exec(line);
    if (wrapped) {
      const inner = cleanValue(wrapped[1]);
      if (inner.length <= 16 && !/[：:]/u.test(inner)) {
        sections.push({ title: inner, fields: [], notes: [] });
        continue;
      }
      current.notes.push(inner);
      continue;
    }
    const field = FIELD.exec(line);
    const label = field ? cleanLabel(field[1]) : "";
    if (field && label) { current.fields.push({ label, value: cleanValue(field[2]) || "未记录" }); continue; }
    const note = cleanValue(line.replace(/^[-*•·>]\s*/u, ""));
    if (note) current.notes.push(note);
  }
  return sections.filter(section => section.fields.length || section.notes.length).slice(0, 12)
    .map(section => ({ ...section, fields: section.fields.slice(0, 40), notes: section.notes.slice(0, 12) }));
}

function fieldCount(sections: readonly XumengVisibleStatusSection[]): number {
  return sections.reduce((sum, section) => sum + section.fields.length, 0);
}

type StatusTailLine = {
  index: number;
  role: "field" | "partial" | "blank" | "marker";
  label: string;
  value: string;
  bracket: boolean;
  known: boolean;
};

const BRACKET_FIELD = /^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*\[\[([\s\S]*?)\]\]\s*$/u;
const BRACKET_PARTIAL = /^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*\[{1,2}[^\]\n]*$/u;
const KNOWN_PARTIAL = /^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*$/u;

function classifyStatusLine(line: string, known: ReadonlySet<string>): Omit<StatusTailLine, "index"> | null {
  if (STATUS_MARKER.test(line)) return { role: "marker", label: "", value: "", bracket: false, known: false };
  const bracket = BRACKET_FIELD.exec(line);
  if (bracket) {
    const label = cleanLabel(bracket[1]);
    if (!label) return null;
    return { role: "field", label, value: cleanValue(bracket[2]) || "未记录", bracket: true, known: known.has(label) };
  }
  const partialBracket = BRACKET_PARTIAL.exec(line);
  if (partialBracket && !line.includes("]]")) {
    const label = cleanLabel(partialBracket[1]);
    if (!label) return null;
    return { role: "partial", label, value: "", bracket: true, known: known.has(label) };
  }
  const field = FIELD.exec(line);
  const label = field ? cleanLabel(field[1]) : "";
  if (field && label && known.has(label)) return { role: "field", label, value: cleanValue(field[2]) || "未记录", bracket: false, known: true };
  const partial = KNOWN_PARTIAL.exec(line);
  const partialLabel = partial ? cleanLabel(partial[1]) : "";
  if (partial && partialLabel && known.has(partialLabel)) return { role: "partial", label: partialLabel, value: "", bracket: false, known: true };
  return null;
}

function statusTail(text: string, labels: readonly string[]): { lines: string[]; taken: StatusTailLine[] } {
  const known = new Set(labels.map(cleanLabel).filter(Boolean));
  const lines = normalize(text).split("\n");
  let cursor = lines.length;
  while (cursor > 0 && !lines[cursor - 1].trim()) cursor--;
  const taken: StatusTailLine[] = [];
  while (cursor > 0) {
    const line = lines[cursor - 1].trim();
    if (!line) {
      if (!taken.length) break;
      taken.push({ index: cursor - 1, role: "blank", label: "", value: "", bracket: false, known: false });
      cursor--;
      continue;
    }
    const kind = classifyStatusLine(line, known);
    if (!kind) break;
    if (kind.role === "partial" && taken.some(item => item.role !== "blank")) break;
    if (kind.role === "marker" && !taken.some(item => item.role === "field" || item.role === "partial")) {
      taken.push({ index: cursor - 1, ...kind });
      break;
    }
    taken.push({ index: cursor - 1, ...kind });
    cursor--;
    if (kind.role === "marker") break;
  }
  return { lines, taken };
}

/**
 * A status bar updates as a block of its own fields at the end of a reply.
 * A suffix of the card's labels, or of `字段：[[值]]` lines, is lifted out.
 * A colon inside the story stays in the story. Pass `streaming` while the
 * reply is still arriving: an unfinished tail leaves the story immediately
 * and does not become fields until the block is complete.
 */
export function peelXumengLabeledStatusTail(text: string, labels: readonly string[], options?: { streaming?: boolean }): { body: string; fields: XumengVisibleStatusField[] } {
  const streaming = options?.streaming === true;
  const { lines, taken } = statusTail(text, labels);
  const fields = taken.filter(item => item.role === "field").reverse().map(item => ({ label: item.label, value: item.value }));
  const knownCount = taken.filter(item => item.role === "field" && item.known).length;
  const bracketCount = taken.filter(item => item.role === "field" && item.bracket).length;
  const bracketPartial = taken.some(item => item.role === "partial" && item.bracket);
  const knownPartial = taken.some(item => item.role === "partial" && item.known);
  const marker = taken.some(item => item.role === "marker");
  const commit = knownCount >= 2 || bracketCount >= 2 || (!streaming && (bracketPartial || knownPartial) && knownCount + bracketCount >= 1);
  const hold = !commit && (streaming
    ? bracketPartial || bracketCount > 0 || knownPartial || knownCount > 0 || marker
    : bracketPartial);
  if (!commit && !hold) return { body: text, fields: [] };
  const drop = new Set(taken.map(item => item.index));
  const body = lines.filter((_, index) => !drop.has(index)).join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  return { body, fields: commit ? fields : [] };
}

/** Fields worth a status card, after hidden tails are removed. Empty when the reply has no status block. */
export function xumengReplyStatus(text: string, labels: readonly string[] = []): XumengMessagePresentation["status"] {
  const presentation = splitXumengMessagePresentation(text);
  if (presentation.status?.fields.length) return presentation.status;
  const peeled = peelXumengLabeledStatusTail(presentation.body, labels);
  if (!peeled.fields.length) return null;
  return { title: "状态栏", fields: peeled.fields };
}

/** Split a visible assistant message without rewriting its source content. */
export function splitXumengMessagePresentation(text: string): XumengMessagePresentation {
  const blocks: string[] = [];
  let body = normalize(text).replace(HIDDEN_TAG, "");
  body = body.replace(STATUS_DETAILS, (_all, _summary: string, inner: string) => { blocks.push(inner); return "\n"; });
  body = body.replace(STATUS_TAG, (_all, _tag: string, inner: string) => { blocks.push(inner); return "\n"; });
  body = body.replace(FENCE, (all, inner: string) => {
    const sections = parseXumengStatusContent(inner);
    if (fieldCount(sections) >= 2) { blocks.push(inner); return "\n"; }
    return all;
  });

  const lines = body.split("\n");
  const markerIndex = lines.findIndex(line => STATUS_MARKER.test(line));
  if (markerIndex >= 0) {
    let cursor = markerIndex + 1;
    const taken: string[] = [];
    let fields = 0;
    for (; cursor < lines.length; cursor++) {
      const line = lines[cursor].trim();
      if (!line) { taken.push(""); continue; }
      const isField = FIELD.test(line) || PIPE_FIELD.test(line) || /^[『【].{1,16}[』】]$/u.test(line);
      PIPE_FIELD.lastIndex = 0;
      if (!isField) break;
      if (!/^[『【]/u.test(line)) fields++;
      taken.push(line);
    }
    if (fields >= 2) {
      blocks.unshift(taken.join("\n"));
      const before = lines.slice(0, markerIndex).join("\n").trimEnd();
      const after = lines.slice(cursor).join("\n").trim();
      body = [before, after].filter(Boolean).join("\n\n");
    }
  }

  if (!blocks.length) {
    const cleaned = body === normalize(text) ? text : body.replace(/\n{3,}/gu, "\n\n").trim();
    return { body: cleaned, status: null };
  }
  const sections = blocks.flatMap(block => parseXumengStatusContent(block));
  const fields = sections.flatMap(section => section.fields);
  if (!fields.length && !sections.some(section => section.notes.length)) return { body: body.replace(/\n{3,}/gu, "\n\n").trim(), status: null };
  return { body: body.replace(/\n{3,}/gu, "\n\n").trim(), status: { title: "状态栏", fields, sections } };
}

/** Readers see plain prose: Markdown marks and leftover inert tags are dropped. */
export function plainXumengStoryText(text: string): string {
  return stripTags(normalize(text))
    .split("\n")
    .filter(line => !/^\s*([-*_=—])(?:\s*\1){2,}\s*$/u.test(line) && !/^\s*```/u.test(line))
    .map(line => line
      .replace(/^\s*#{1,6}\s+/u, "")
      .replace(/^\s*>\s?/u, "")
      .replace(/^(\s*)[-*+•]\s+/u, "$1")
      .replace(/\*\*|__|~~|`+/gu, "")
      .replace(/\*/gu, ""))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export type XumengStorySegment = { text: string; speech: boolean };

const SPEECH = /“[^“”"″\n]*(?:[”"″]|$)|"[^"\n“”]*(?:"|$)|「[^」\n]*(?:」|$)|『[^』\n]*(?:』|$)/gu;

/** Mark spoken lines (quoted text) so they can be colored apart from narration. */
export function splitXumengSpeech(line: string): XumengStorySegment[] {
  const segments: XumengStorySegment[] = [];
  let last = 0;
  for (const match of line.matchAll(SPEECH)) {
    const index = match.index ?? 0;
    if (!match[0]) continue;
    if (index > last) segments.push({ text: line.slice(last, index), speech: false });
    segments.push({ text: match[0], speech: true });
    last = index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), speech: false });
  return segments;
}

/** Short preview for the collapsed status card: time and place first. */
export function xumengStatusPreview(fields: readonly XumengVisibleStatusField[]): string {
  const preferred = fields.filter(field => /时间|日期|地点|位置|场景|处境/u.test(field.label));
  return (preferred.length ? preferred : fields).slice(0, 2).map(field => field.value).join(" · ").slice(0, 60);
}

const EMBEDDED_MARKUP = /<style\b[^>]*>[\s\S]*?(?:<\/style>|$)|<script\b[^>]*>[\s\S]*?(?:<\/script>|$)/giu;

/** One line for a conversation list: story text, never raw HTML, CSS, or status markup. */
export function xumengConversationPreview(content: string, limit = 80): string {
  const source = content.replace(EMBEDDED_MARKUP, " ");
  const presented = splitXumengMessagePresentation(source);
  const plain = plainXumengStoryText(peelXumengLabeledStatusTail(presented.body, []).body)
    .replace(/\[状态:[^\]]{0,48}\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!plain || /<\/?[a-z!]|@keyframes|\bstyle\s*=/iu.test(plain)) return "";
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

const xumengMessagePresentation = { splitXumengMessagePresentation, peelXumengLabeledStatusTail, xumengReplyStatus, parseXumengStatusContent, plainXumengStoryText, splitXumengSpeech, xumengStatusPreview, xumengConversationPreview };
export default xumengMessagePresentation;
