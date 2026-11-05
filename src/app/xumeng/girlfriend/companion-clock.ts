import { shanghaiDayStart, shanghaiParts } from "../../../lib/shanghai-time.ts";

const TEN_MINUTES = 10 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Clock chip used between girlfriend messages, e.g. 昨天 上午9:21. Times use Beijing. */
export function companionClockLabel(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const current = shanghaiParts(time);
  const hours = current.hour;
  const period = hours < 5 ? "凌晨" : hours < 12 ? "上午" : hours < 13 ? "中午" : hours < 18 ? "下午" : "晚上";
  const hour = hours % 12 || 12;
  const clock = `${period}${hour}:${pad(current.minute)}`;
  const diff = Math.round((shanghaiDayStart(now) - shanghaiDayStart(time)) / 86_400_000);
  if (diff <= 0) return clock;
  if (diff === 1) return `昨天 ${clock}`;
  if (diff === 2) return `前天 ${clock}`;
  const today = shanghaiParts(now);
  const dateText = current.year === today.year
    ? `${current.month}月${current.day}日`
    : `${current.year}年${current.month}月${current.day}日`;
  return `${dateText} ${clock}`;
}

/** First message, a Beijing day change, or at least ten minutes since the previous message. */
export function companionClockVisible(current: string, previous?: string): boolean {
  const currentTime = Date.parse(current);
  if (!Number.isFinite(currentTime)) return false;
  if (!previous) return true;
  const previousTime = Date.parse(previous);
  if (!Number.isFinite(previousTime)) return true;
  if (shanghaiDayStart(currentTime) !== shanghaiDayStart(previousTime)) return true;
  return currentTime - previousTime >= TEN_MINUTES;
}
