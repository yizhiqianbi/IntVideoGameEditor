/** SillyTavern display regex. Scripts change what a message looks like, or what
 * history is sent back to the model. They never run as JavaScript. */

export type FolioFrontendScript = {
  id: string;
  name: string;
  find: string;
  replace: string;
  trim: string[];
  /** 1 = user message, 2 = character message. */
  placement: Array<1 | 2>;
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  minDepth: number | null;
  maxDepth: number | null;
};

export type FolioFrontendPass = "display" | "prompt";

const SCRIPT_LIMIT = 40;
const FIND_LIMIT = 4_000;
const REPLACE_LIMIT = 100_000;
const OUTPUT_LIMIT = 120_000;
const MATCH_LIMIT = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function depthLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 200 ? value : null;
}

function placementOf(value: unknown): Array<1 | 2> {
  const source = Array.isArray(value) ? value : [];
  const placement = source.flatMap((item): Array<1 | 2> => item === 1 || item === 2 ? [item] : []);
  return placement.length ? [...new Set(placement)] : [1, 2];
}

function scriptList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.frontendScripts)) return value.frontendScripts;
  const extensions = isRecord(value.extensions) ? value.extensions : undefined;
  return Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : undefined;
}

/** Keep a card when a script is malformed. A bad beautifier must not reject the character. */
export function parseFolioFrontendScripts(value: unknown): FolioFrontendScript[] | undefined {
  const list = scriptList(value);
  if (!list) return undefined;
  const scripts: FolioFrontendScript[] = [];
  for (const candidate of list) {
    if (scripts.length >= SCRIPT_LIMIT || !isRecord(candidate)) continue;
    const find = typeof candidate.findRegex === "string" ? candidate.findRegex : typeof candidate.find === "string" ? candidate.find : "";
    const replace = typeof candidate.replaceString === "string" ? candidate.replaceString : typeof candidate.replace === "string" ? candidate.replace : "";
    if (!find.trim() || find.length > FIND_LIMIT || replace.length > REPLACE_LIMIT) continue;
    const trim = Array.isArray(candidate.trimStrings)
      ? candidate.trimStrings.flatMap(item => typeof item === "string" && item.length <= 200 ? [item] : []).slice(0, 20)
      : [];
    scripts.push({
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim().slice(0, 80) : `frontend-${scripts.length + 1}`,
      name: (typeof candidate.scriptName === "string" ? candidate.scriptName : typeof candidate.name === "string" ? candidate.name : "正则").trim().slice(0, 120) || "正则",
      find, replace, trim,
      placement: placementOf(candidate.placement),
      disabled: candidate.disabled === true,
      markdownOnly: candidate.markdownOnly === true,
      promptOnly: candidate.promptOnly === true,
      minDepth: depthLimit(candidate.minDepth),
      maxDepth: depthLimit(candidate.maxDepth),
    });
  }
  return scripts.length ? scripts : undefined;
}

function compileRegex(source: string): RegExp | null {
  let pattern = source;
  let flags = "";
  if (source.startsWith("/")) {
    const end = source.lastIndexOf("/");
    if (end > 0) {
      pattern = source.slice(1, end);
      flags = source.slice(end + 1);
    }
  }
  if (!/^[gimsuy]*$/u.test(flags)) return null;
  try { return new RegExp(pattern, flags); } catch { return null; }
}

function trimValue(value: string, trim: readonly string[]): string {
  return trim.reduce((current, token) => token ? current.split(token).join("") : current, value);
}

function applyReplace(input: string, regex: RegExp, replacement: string, trim: readonly string[]): string {
  let count = 0;
  const next = input.replace(regex, (...args: unknown[]) => {
    if (++count > MATCH_LIMIT) return String(args[0] ?? "");
    const match = String(args[0] ?? "");
    const named = typeof args.at(-1) === "object" && args.at(-1) !== null;
    const groups = args.slice(1, named ? -3 : -2).filter((item): item is string => typeof item === "string");
    let result = replacement.replace(/\{\{match\}\}/giu, () => trimValue(match, trim));
    result = result.replaceAll("$$", "\u0000");
    result = result.replaceAll("$&", () => trimValue(match, trim));
    result = result.replace(/\$(\d{1,2})/gu, (_all, index: string) => {
      const position = Number(index);
      return trimValue(position === 0 ? match : groups[position - 1] ?? "", trim);
    });
    return result.replaceAll("\u0000", "$");
  });
  return next.length > OUTPUT_LIMIT ? input : next;
}

function runsOn(script: FolioFrontendScript, pass: FolioFrontendPass): boolean {
  const display = script.markdownOnly || (!script.markdownOnly && !script.promptOnly);
  const prompt = script.promptOnly || (!script.markdownOnly && !script.promptOnly);
  return pass === "display" ? display : prompt;
}

/** Render pass or prompt pass. Stored messages stay untouched. */
export function applyFolioFrontendScripts(text: string, scripts: readonly FolioFrontendScript[] | undefined, options: {
  role: "user" | "assistant"; depth: number; pass: FolioFrontendPass;
}): string {
  if (!scripts?.length || !text) return text;
  const placement = options.role === "user" ? 1 : 2;
  let current = text;
  for (const script of scripts) {
    if (script.disabled || !script.placement.includes(placement) || !runsOn(script, options.pass)) continue;
    if (script.minDepth !== null && options.depth < script.minDepth) continue;
    if (script.maxDepth !== null && options.depth > script.maxDepth) continue;
    const regex = compileRegex(script.find);
    if (!regex) continue;
    current = applyReplace(current, regex, script.replace, script.trim);
  }
  return current;
}

const folioFrontendCard = { parseFolioFrontendScripts, applyFolioFrontendScripts };
export default folioFrontendCard;
