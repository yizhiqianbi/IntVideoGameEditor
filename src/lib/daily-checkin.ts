/**
 * Seven-day daily login reward cycle (Tipsy-style).
 *
 * Day weights scale the admin-configured base reward; the default base of 50
 * Credit yields 50 / 80 / 80 / 50 / 50 / 50 / 130 (490 Credit per full cycle).
 */
export const CHECKIN_CYCLE_DAYS = 7;
export const DEFAULT_CHECKIN_BASE = 50;
export const CHECKIN_WEIGHTS = [1, 1.6, 1.6, 1, 1, 1, 2.6] as const;

export type CheckinStatus = {
  /** Consecutive claimed days, including today when claimed today. */
  streak: number;
  /** Current cycle day 1–7: the day being claimed today, or the next claimable day. */
  day: number;
  claimedToday: boolean;
  rewards: number[];
  /** Reward for the current day (today's amount once claimed). */
  todayReward: number;
};

export function checkinRewards(base: number = DEFAULT_CHECKIN_BASE): number[] {
  const safe = Number.isFinite(base) && base > 0 ? Math.floor(base) : DEFAULT_CHECKIN_BASE;
  return CHECKIN_WEIGHTS.map(weight => Math.max(1, Math.round(safe * weight)));
}

/** Day index (1–7) for a streak. */
export function checkinDay(streak: number, claimedToday: boolean): number {
  const safe = Math.max(0, Math.floor(streak));
  return claimedToday ? ((Math.max(1, safe) - 1) % CHECKIN_CYCLE_DAYS) + 1 : (safe % CHECKIN_CYCLE_DAYS) + 1;
}

/** Previous YYYY-MM-DD day key (UTC math is safe on day-only strings). */
export function previousCheckinDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Build the check-in state from claimed day keys (any order).
 * Missed days break the streak; after day 7 the cycle restarts at day 1.
 */
export function checkinStatus(claimedDays: readonly string[], today: string, base: number = DEFAULT_CHECKIN_BASE): CheckinStatus {
  const rewards = checkinRewards(base);
  const claimed = new Set(claimedDays.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)));
  const claimedToday = claimed.has(today);
  let streak = 0;
  let cursor = claimedToday ? today : previousCheckinDay(today);
  while (claimed.has(cursor)) {
    streak += 1;
    cursor = previousCheckinDay(cursor);
  }
  const day = checkinDay(streak, claimedToday);
  return { streak, day, claimedToday, rewards, todayReward: rewards[day - 1] };
}
