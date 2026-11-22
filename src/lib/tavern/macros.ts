/**
 * SillyTavern-compatible macro expansion for card and prompt text.
 *
 * Supported: {{char}}, {{user}}, {{description}}, {{personality}}, {{scenario}},
 * {{persona}}, {{time}}, {{date}}, {{weekday}}, {{isotime}}, {{isodate}},
 * {{random::a::b}}, {{pick::a::b}}, {{roll:1d6}}, {{newline}}, {{trim}},
 * {{// comment}}. Unknown macros are preserved verbatim and reported so an
 * import can surface them instead of silently corrupting a card.
 */

export type TavernMacroContext = {
  characterName: string;
  userName: string;
  description?: string;
  personality?: string;
  scenario?: string;
  persona?: string;
  /** Injectable clock so tests and cached prompts stay deterministic. */
  now?: Date;
  /** Deterministic seed; the same seed always expands to the same values. */
  seed?: number;
};

export type TavernMacroResult = { text: string; unknown: string[] };

const UNKNOWN_LIMIT = 50;

function hashSeed(seed: number, salt: string): number {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < salt.length; index++) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickIndex(seed: number, salt: string, count: number): number {
  return count <= 0 ? 0 : hashSeed(seed, salt) % count;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(date: Date) {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()] ?? "",
    iso: date.toISOString(),
  };
}

function rollDice(expression: string, seed: number, salt: string): string {
  const match = /^\s*(\d{1,2})d(\d{1,3})\s*$/i.exec(expression);
  if (!match) return expression;
  const count = Math.min(20, Math.max(1, Number(match[1])));
  const sides = Math.min(1000, Math.max(2, Number(match[2])));
  const rolls: number[] = [];
  for (let index = 0; index < count; index++) rolls.push((hashSeed(seed, `${salt}:${index}`) % sides) + 1);
  return `${rolls.reduce((sum, value) => sum + value, 0)} (${rolls.join(", ")})`;
}

/** Expand all supported macros in one pass; nested results are not re-scanned. */
export function expandTavernMacros(input: string, context: TavernMacroContext): TavernMacroResult {
  if (!input) return { text: "", unknown: [] };
  const unknown: string[] = [];
  const seed = context.seed ?? 0;
  const date = formatDate(context.now ?? new Date());
  const values: Array<{ token: string; replace: () => string }> = [];
  const pattern = /\{\{([^{}]*)\}\}/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const inner = match[1];
    values.push({ token: match[0], replace: () => expandOne(inner, context, date, seed, unknown) });
  }
  let text = "";
  let offset = 0;
  for (const value of values) {
    const index = input.indexOf(value.token, offset);
    if (index < 0) continue;
    text += input.slice(offset, index) + value.replace();
    offset = index + value.token.length;
  }
  text += input.slice(offset);
  // Trim and newline helpers apply to the whole result, matching ST behaviour.
  if (values.some(value => /^\{\{\s*trim\s*\}\}$/u.test(value.token))) text = text.trim().replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n");
  return { text, unknown: [...new Set(unknown)].slice(0, UNKNOWN_LIMIT) };
}

function expandOne(name: string, context: TavernMacroContext, date: ReturnType<typeof formatDate>, seed: number, unknown: string[]): string {
  const trimmed = name.trim();
  const [head, ...rest] = trimmed.split("::");
  const colonIndex = head.indexOf(":");
  const singleColonCommand = colonIndex > 0 ? head.slice(0, colonIndex).trim().toLowerCase() : "";
  const command = (singleColonCommand === "roll" ? singleColonCommand : head.trim().toLowerCase());
  const argumentsList = (singleColonCommand === "roll" ? [head.slice(colonIndex + 1), ...rest] : rest).map(item => item.trim());
  switch (command) {
    case "char":
      return context.characterName;
    case "user":
      return context.userName;
    case "description":
      return context.description ?? "";
    case "personality":
      return context.personality ?? "";
    case "scenario":
      return context.scenario ?? "";
    case "persona":
      return context.persona ?? "";
    case "time":
      return date.time;
    case "date":
      return date.date;
    case "weekday":
      return date.weekday;
    case "isotime":
      return date.iso;
    case "isodate":
      return date.date;
    case "newline":
      return "\n";
    case "trim":
      return "";
    case "":
      return "";
    case "random":
      return argumentsList[pickIndex(seed, `random:${argumentsList.join("|")}`, argumentsList.length)] ?? "";
    case "pick":
      return argumentsList[pickIndex(seed, `pick:${argumentsList.join("|")}`, argumentsList.length)] ?? "";
    case "roll":
      return rollDice(argumentsList[0] ?? "", seed, `roll:${argumentsList[0] ?? ""}`);
    default:
      if (head.startsWith("//")) return "";
      if (trimmed.startsWith("//")) return "";
      unknown.push(trimmed);
      return `{{${trimmed}}}`;
  }
}

/** Expand macros in every string of a card-like structure without mutating it. */
export function expandTavernMacrosDeep<T>(value: T, context: TavernMacroContext): { value: T; unknown: string[] } {
  const unknown = new Set<string>();
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      const result = expandTavernMacros(input, context);
      for (const item of result.unknown) unknown.add(item);
      return result.text;
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, walk(item)]));
    }
    return input;
  };
  return { value: walk(value) as T, unknown: [...unknown].slice(0, UNKNOWN_LIMIT) };
}
