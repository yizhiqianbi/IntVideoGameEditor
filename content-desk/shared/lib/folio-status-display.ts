/** Turn author status text into the pieces a status card can draw. */

export type StatusTrend = "up" | "down";

export type StatusMeterReading = {
  percent: number;
  caption: string;
  note: string;
  trend: StatusTrend | null;
};

const WRAPPERS: readonly RegExp[] = [
  /^\[\[([\s\S]+)\]\]$/u,
  /^【([\s\S]+)】$/u,
  /^\[([\s\S]+)\]$/u,
];

export function cleanStatusText(value: string): string {
  let text = value.replace(/\*\*|__|~~|`+/gu, "").replace(/\s+/gu, " ").trim();
  for (let pass = 0; pass < 3; pass++) {
    const next = WRAPPERS.reduce((current, pattern) => current.replace(pattern, "$1"), text).trim();
    if (next === text) break;
    text = next;
  }
  return text.replace(/\[\[|\]\]/gu, "").trim();
}

function splitTrend(value: string): { text: string; trend: StatusTrend | null } {
  const up = /(?:↑|▲|↗)\s*$/u;
  const down = /(?:↓|▼|↘)\s*$/u;
  if (up.test(value)) return { text: value.replace(up, "").trim(), trend: "up" };
  if (down.test(value)) return { text: value.replace(down, "").trim(), trend: "down" };
  return { text: value, trend: null };
}

function clampPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

function unwrapNote(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s*[）)]$/u, "").trim();
}

const NUMBER_TAIL = "(?:\\s*(?:[，,]\\s*|[（(])([\\s\\S]+))?";

function captionFor(number: number, max: number, label: string, explicitPercent: boolean, typedMeter: boolean): string {
  const stage = /阶段/u.test(label) && !/度|刻度|值/u.test(label);
  if (stage && !explicitPercent) return String(number);
  if (explicitPercent || typedMeter || max === 100 || /度|刻度|值/u.test(label)) return `${clampPercent(number, max)}%`;
  return `${number}/${max}`;
}

export function readStatusMeter(value: string, hint?: { type?: string; label?: string }): StatusMeterReading | null {
  const label = hint?.label ?? "";
  const typedMeter = hint?.type === "meter";
  const split = splitTrend(cleanStatusText(value).replace(/／/gu, "/").replace(/％/gu, "%"));
  const text = split.text;
  const slash = new RegExp(`^(\\d{1,3})\\s*/\\s*(\\d{1,3})${NUMBER_TAIL}$`, "u").exec(text);
  const percent = new RegExp(`^(\\d{1,3})\\s*%${NUMBER_TAIL}$`, "u").exec(text);
  const bare = new RegExp(`^(\\d{1,3})${NUMBER_TAIL}$`, "u").exec(text);
  const stageOrScale = /度|刻度|进度|值|阶段/u.test(label);
  if (!slash && !percent && !(bare && (typedMeter || stageOrScale))) return null;
  const number = Number((slash ?? percent ?? bare)?.[1]);
  const max = slash ? Number(slash[2]) : 100;
  if (!Number.isFinite(number) || number < 0 || number > 999) return null;
  const note = unwrapNote(slash?.[3] ?? percent?.[2] ?? bare?.[2]);
  return {
    percent: clampPercent(number, max),
    caption: captionFor(number, percent ? 100 : max, label, Boolean(percent), typedMeter),
    note,
    trend: split.trend,
  };
}

export function readStatusChips(value: string, hint?: { type?: string; label?: string }): string[] | null {
  const label = hint?.label ?? "";
  const listed = hint?.type === "list" || /^(?:当前状态|状态|标签)$/u.test(label);
  if (!listed) return null;
  const text = cleanStatusText(value);
  if (!text || text === "—" || text === "未记录") return null;
  const parts = text.split(/[、,，|/]|\s+/u).map(item => item.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  if (parts.some(item => [...item].length > 8)) return null;
  return parts.slice(0, 8);
}
