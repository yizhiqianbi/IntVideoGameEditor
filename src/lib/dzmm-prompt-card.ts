export type DzmmPromptMacroContext = {
  characterName: string;
  userName: string;
  original?: string;
};

export type DzmmDialogueExampleMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DzmmDialogueExampleOptions = DzmmPromptMacroContext & {
  /** Maximum complete conversations, separated by <START>. Defaults to 8. */
  maxExamples?: number;
  /** Maximum total message content characters, after expansion. Defaults to 6000. */
  maxChars?: number;
};

export type DzmmDialogueExamples = {
  messages: DzmmDialogueExampleMessage[];
  /** Unsupported input remains plain reference text, bounded by maxChars. */
  fallbackText: string;
};

export const DZMM_PROMPT_EXPANSION_LIMIT_CHARS = 80_000;

export class DzmmPromptExpansionError extends Error {
  constructor() {
    super("角色提示词展开后过长，请缩短设定或示例。");
    this.name = "DzmmPromptExpansionError";
  }
}

function expansionLimit(maxChars: number | undefined): number {
  return Math.min(DZMM_PROMPT_EXPANSION_LIMIT_CHARS, boundedInteger(maxChars, DZMM_PROMPT_EXPANSION_LIMIT_CHARS));
}

function expandBoundedMacros(text: string, context: DzmmPromptMacroContext, maximum: number, truncate: boolean): string {
  const parts: string[] = [];
  let chars = 0;
  function append(value: string, start = 0, end = value.length): boolean {
    const length = end - start;
    const remaining = maximum - chars;
    // Check lengths before making a copy or joining segments. In particular,
    // repeated {{original}} cannot first materialize a huge expanded string.
    if (length > remaining) {
      if (!truncate) throw new DzmmPromptExpansionError();
      let stop = start + remaining;
      const last = value.charCodeAt(stop - 1);
      if (stop > start && last >= 0xD800 && last <= 0xDBFF) stop--;
      if (stop > start) parts.push(value.slice(start, stop));
      return false;
    }
    if (length) parts.push(value.slice(start, end));
    chars += length;
    return true;
  }

  const macros = /\{\{\s*(char|user|original)\s*\}\}/gi;
  let cursor = 0;
  for (let match = macros.exec(text); match; match = macros.exec(text)) {
    if (!append(text, cursor, match.index)) return parts.join("");
    const macro = match[1].toLowerCase();
    const replacement = macro === "char" ? context.characterName
      : macro === "user" ? context.userName : context.original ?? "";
    if (!append(replacement)) return parts.join("");
    cursor = match.index + match[0].length;
  }
  append(text, cursor);
  return parts.join("");
}

/**
 * Expand only the three literal card macros. Replacement strings are never
 * interpreted or expanded again; unsupported macros remain available as text.
 * A missing original instruction expands to an empty string. Expansion fails
 * before exceeding maxChars (at most 80000), without creating the oversized text.
 */
export function expandDzmmPromptMacros(text: string, context: DzmmPromptMacroContext, maxChars?: number): string {
  return expandBoundedMacros(text, context, expansionLimit(maxChars), false);
}

function boundedInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
}

type SpeakerLine = { role: DzmmDialogueExampleMessage["role"]; content: string };

function speakerLine(line: string, context: DzmmPromptMacroContext): SpeakerLine | undefined {
  const text = line.trimStart();
  const macro = /^(?:\{\{\s*(char|user)\s*\}\}|<(bot|user)>)[\t ]*:[\t ]?(.*)$/i.exec(text);
  if (macro) {
    const label = (macro[1] ?? macro[2]).toLowerCase();
    return { role: label === "user" ? "user" : "assistant", content: macro[3] };
  }

  // Compare display names as literal strings instead of injecting them into a
  // regular expression. Names containing punctuation remain safe and usable.
  const names = [
    { name: context.characterName, role: "assistant" as const },
    { name: context.userName, role: "user" as const },
  ].sort((left, right) => right.name.length - left.name.length);
  const matches = names.flatMap(({ name, role }) => {
    if (!name || text.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return [];
    const rest = /^[\t ]*:[\t ]?(.*)$/.exec(text.slice(name.length));
    return rest ? [{ role, content: rest[1] }] : [];
  });
  if (matches.length !== 1) return undefined;
  return matches[0];
}

function resemblesUnsupportedSpeaker(line: string): boolean {
  // A short unknown speaker label is too ambiguous to silently fold into a
  // recognized speaker's turn. Preserve the entire source as reference text.
  return /^[\t ]*(?:\{\{[^}\n]+\}\}|<[^>\n]+>|[^\s:][^:\n]{0,79})[\t ]*:/.test(line);
}

function parseExampleBlock(lines: string[], context: DzmmPromptMacroContext): DzmmDialogueExampleMessage[] | undefined {
  const messages: DzmmDialogueExampleMessage[] = [];
  let current: { role: DzmmDialogueExampleMessage["role"]; lines: string[] } | undefined;

  function finishTurn(): boolean {
    if (!current) return true;
    const content = current.lines.join("\n").trim();
    if (!content) return false;
    messages.push({ role: current.role, content });
    return true;
  }

  for (const line of lines) {
    const speaker = speakerLine(line, context);
    if (speaker) {
      if (!finishTurn()) return undefined;
      current = { role: speaker.role, lines: [speaker.content] };
    } else {
      if (resemblesUnsupportedSpeaker(line) || (!current && line.trim())) return undefined;
      if (current) current.lines.push(line);
    }
  }
  return finishTurn() && messages.length ? messages : undefined;
}

/**
 * Read author example dialogue without assigning an inferred role to prose.
 * Labels are {{char}} / {{user}}, actual display names, or <bot> / <user>.
 * Parse labels before expanding content so macro-like replacement values cannot
 * introduce speaker lines. A malformed block makes the whole input fallback
 * text. Limits retain a prefix of complete blocks, never a partial exchange.
 */
export function parseDzmmDialogueExamples(text: string, options: DzmmDialogueExampleOptions): DzmmDialogueExamples {
  const maxExamples = boundedInteger(options.maxExamples, 8);
  const maxChars = expansionLimit(boundedInteger(options.maxChars, 6000));
  const fallback = (): DzmmDialogueExamples => ({
    messages: [],
    fallbackText: expandBoundedMacros(text.trim(), options, maxChars, true),
  });
  if (!text.trim()) return { messages: [], fallbackText: "" };

  const blocks: string[][] = [];
  let lines: string[] = [];
  let sawStart = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const start = /^[\t ]*<START>[\t ]*(.*)$/i.exec(line);
    if (!start) {
      lines.push(line);
      continue;
    }
    if (sawStart) blocks.push(lines);
    else if (lines.some(candidate => candidate.trim())) return fallback();
    sawStart = true;
    lines = start[1] ? [start[1]] : [];
  }
  blocks.push(lines);

  const parsed: DzmmDialogueExampleMessage[][] = [];
  for (const block of blocks) {
    const example = parseExampleBlock(block, options);
    if (!example) return fallback();
    parsed.push(example);
  }

  const messages: DzmmDialogueExampleMessage[] = [];
  let chars = 0;
  for (const example of parsed.slice(0, maxExamples)) {
    const expanded: DzmmDialogueExampleMessage[] = [];
    let exampleChars = 0;
    let fits = true;
    for (const message of example) {
      let content: string;
      try { content = expandDzmmPromptMacros(message.content, options, maxChars - chars - exampleChars); }
      catch (error) {
        if (!(error instanceof DzmmPromptExpansionError)) throw error;
        fits = false;
        break;
      }
      if (!content.trim()) return fallback();
      expanded.push({ role: message.role, content });
      exampleChars += content.length;
    }
    if (!fits) break;
    messages.push(...expanded);
    chars += exampleChars;
  }
  return { messages, fallbackText: "" };
}
