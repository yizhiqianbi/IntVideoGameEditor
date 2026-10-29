function dayStart(value: number) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Clock chip used between girlfriend messages, e.g. 昨天 上午9:21. */
export function companionClockLabel(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "";
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours < 5 ? "凌晨" : hours < 12 ? "上午" : hours < 13 ? "中午" : hours < 18 ? "下午" : "晚上";
  const hour = hours % 12 || 12;
  const clock = `${period}${hour}:${minutes}`;
  const diff = Math.round((dayStart(now) - dayStart(time)) / 86_400_000);
  if (diff <= 0) return clock;
  if (diff === 1) return `昨天 ${clock}`;
  if (diff === 2) return `前天 ${clock}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const dateText = sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  return `${dateText} ${clock}`;
}

export function companionClockVisible(current: string, previous?: string, now = Date.now()): boolean {
  const label = companionClockLabel(current, now);
  if (!label) return false;
  if (!previous) return true;
  return label !== companionClockLabel(previous, now);
}
