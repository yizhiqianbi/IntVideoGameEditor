export type ShanghaiParts = { year: number; month: number; day: number; hour: number; minute: number };

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const raw = parts.find(part => part.type === type)?.value ?? "";
  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}

export function shanghaiParts(value: number): ShanghaiParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));
  const hour = readPart(parts, "hour");
  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
    hour: hour === 24 ? 0 : hour,
    minute: readPart(parts, "minute"),
  };
}

export function shanghaiDayKey(value: number): string {
  const parts = shanghaiParts(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function shanghaiDayStart(value: number): number {
  return Date.parse(`${shanghaiDayKey(value)}T00:00:00+08:00`);
}
