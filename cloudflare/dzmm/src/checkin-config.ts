import type { D1Database } from "@cloudflare/workers-types";

export const DEFAULT_DAILY_CHECKIN_CREDITS = 5;
const KEY = "daily_checkin_credits";

export function validCheckinCredits(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100_000;
}

/** Missing or unreadable configuration stays at the historical default of 5. */
export async function readDailyCheckinCredits(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM platform_settings WHERE key=?").bind(KEY).first<{ value: string }>();
  const parsed = Number(row?.value);
  return validCheckinCredits(parsed) ? parsed : DEFAULT_DAILY_CHECKIN_CREDITS;
}

/** Future claims read this value. Rows already in task_claims are left alone. */
export async function writeDailyCheckinCredits(db: D1Database, credits: number, now: number): Promise<void> {
  if (!validCheckinCredits(credits)) throw new Error("签到奖励须为 1 到 100000 之间的整数。");
  await db.prepare(`INSERT INTO platform_settings(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(KEY, String(credits), now).run();
}
