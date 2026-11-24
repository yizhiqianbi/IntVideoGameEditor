import type { Env } from "./types";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const seenDayByIsolate = { day: "", users: new Map<string, 0 | 1>() };

export function shanghaiDay(now = Date.now()): string {
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function shanghaiDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00+08:00`);
}

function dayOf(column: string): string {
  return `strftime('%Y-%m-%d', ${column}/1000.0, 'unixepoch', '+8 hours')`;
}

/** Record the account once per Beijing day. A later registration the same day counts as a logged-in user. */
export async function rememberDailyVisit(env: Env, userId: string, isGuest: boolean, now = Date.now()): Promise<void> {
  const day = shanghaiDay(now);
  if (seenDayByIsolate.day !== day) {
    seenDayByIsolate.day = day;
    seenDayByIsolate.users.clear();
  }
  const cached = seenDayByIsolate.users.get(userId);
  const guestBit: 0 | 1 = isGuest ? 1 : 0;
  if (cached === 0 || (cached === 1 && guestBit === 1)) return;
  try {
    await env.DB.prepare(`INSERT INTO daily_visits(user_id,day_key,is_guest,first_seen_at,last_seen_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,day_key) DO UPDATE SET is_guest=MIN(daily_visits.is_guest, excluded.is_guest), last_seen_at=excluded.last_seen_at`)
      .bind(userId, day, guestBit, now, now).run();
    seenDayByIsolate.users.set(userId, guestBit);
  } catch {
    // Missing the visits table, or a brief write failure, must not block login.
  }
}

export type AdminTrafficDay = {
  day: string;
  visitors: number;
  guestVisitors: number;
  registeredVisitors: number;
  newGuests: number;
  newRegistered: number;
};

export type AdminTraffic = {
  timezone: "Asia/Shanghai";
  day: string;
  visitors: number;
  guestVisitors: number;
  registeredVisitors: number;
  newGuests: number;
  newRegistered: number;
  returningVisitors: number;
  conversations: number;
  chatRequests: number;
  chargedCredits: number;
  paidOrders: number;
  forumPosts: number;
  forumReplies: number;
  likes: number;
  openReports: number;
  listedCharacters: number;
  days: AdminTrafficDay[];
};

type VisitEvent = { user_id: string; day_key: string; is_guest: number };

function count(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function trafficWindow(now = Date.now()) {
  const day = shanghaiDay(now);
  const end = shanghaiDayStart(day) + DAY_MS;
  const start = end - 7 * DAY_MS;
  const days = Array.from({ length: 7 }, (_, index) => shanghaiDay(start + index * DAY_MS + 60 * 60 * 1000));
  return { day, start, end, firstDay: days[0], lastDay: days[6], days };
}

export async function adminTraffic(env: Env, now = Date.now()): Promise<AdminTraffic> {
  const window = trafficWindow(now);
  const range = [window.start, window.end];
  const createdDay = dayOf("created_at");
  const sources = [
    `SELECT v.user_id AS user_id, v.day_key AS day_key, v.is_guest AS is_guest FROM daily_visits v JOIN users u ON u.id=v.user_id WHERE u.is_demo=0 AND v.day_key>=? AND v.day_key<=?`,
    `SELECT id AS user_id, ${createdDay} AS day_key, is_guest AS is_guest FROM users WHERE is_demo=0 AND created_at>=? AND created_at<?`,
    `SELECT s.user_id AS user_id, ${dayOf("s.created_at")} AS day_key, u.is_guest AS is_guest FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.is_demo=0 AND s.created_at>=? AND s.created_at<?`,
    `SELECT r.user_id AS user_id, ${dayOf("r.created_at")} AS day_key, u.is_guest AS is_guest FROM credit_usage_requests r JOIN users u ON u.id=r.user_id WHERE u.is_demo=0 AND r.created_at>=? AND r.created_at<?`,
    `SELECT c.user_id AS user_id, ${dayOf("c.updated_at")} AS day_key, u.is_guest AS is_guest FROM conversations c JOIN users u ON u.id=c.user_id WHERE u.is_demo=0 AND c.updated_at>=? AND c.updated_at<?`,
    `SELECT p.user_id AS user_id, ${dayOf("p.created_at")} AS day_key, u.is_guest AS is_guest FROM forum_posts p JOIN users u ON u.id=p.user_id WHERE u.is_demo=0 AND p.created_at>=? AND p.created_at<?`,
    `SELECT r.user_id AS user_id, ${dayOf("r.created_at")} AS day_key, u.is_guest AS is_guest FROM forum_replies r JOIN users u ON u.id=r.user_id WHERE u.is_demo=0 AND r.created_at>=? AND r.created_at<?`,
    `SELECT l.user_id AS user_id, ${dayOf("l.created_at")} AS day_key, u.is_guest AS is_guest FROM character_likes l JOIN users u ON u.id=l.user_id WHERE u.is_demo=0 AND l.created_at>=? AND l.created_at<?`,
  ];
  const [recorded, ...activity] = await env.DB.batch<VisitEvent>([
    env.DB.prepare(sources[0]).bind(window.firstDay, window.lastDay),
    ...sources.slice(1).map(sql => env.DB.prepare(sql).bind(...range)),
  ]);
  const joined = new Map<string, string>();
  for (const row of activity[0].results) joined.set(row.user_id, row.day_key);
  const people = new Map<string, 0 | 1>();
  for (const batch of [recorded, ...activity]) {
    for (const row of batch.results) {
      const key = `${row.day_key}\u0000${row.user_id}`;
      const guestBit: 0 | 1 = row.is_guest ? 1 : 0;
      const previous = people.get(key);
      if (previous === undefined || guestBit < previous) people.set(key, guestBit);
    }
  }
  const byDay = new Map(window.days.map(day => [day, { day, visitors: 0, guestVisitors: 0, registeredVisitors: 0, newGuests: 0, newRegistered: 0 }]));
  for (const [key, guestBit] of people) {
    const separator = key.indexOf("\u0000");
    const day = key.slice(0, separator);
    const userId = key.slice(separator + 1);
    const bucket = byDay.get(day);
    if (!bucket) continue;
    bucket.visitors += 1;
    if (guestBit) bucket.guestVisitors += 1;
    else bucket.registeredVisitors += 1;
    if (joined.get(userId) === day) {
      if (guestBit) bucket.newGuests += 1;
      else bucket.newRegistered += 1;
    }
  }
  const today = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM conversations c JOIN users u ON u.id=c.user_id WHERE u.is_demo=0 AND c.updated_at>=? AND c.updated_at<?) AS conversations,
      (SELECT COUNT(*) FROM credit_usage_requests r JOIN users u ON u.id=r.user_id WHERE u.is_demo=0 AND r.created_at>=? AND r.created_at<?) AS chatRequests,
      (SELECT COALESCE(SUM(r.charged_credits),0) FROM credit_usage_requests r JOIN users u ON u.id=r.user_id WHERE u.is_demo=0 AND r.status='settled' AND r.created_at>=? AND r.created_at<?) AS chargedCredits,
      (SELECT COUNT(*) FROM payment_orders WHERE paid_at>=? AND paid_at<?)
        + (SELECT COUNT(*) FROM zpay_orders WHERE paid_at>=? AND paid_at<?)
        + (SELECT COUNT(*) FROM guagua_orders WHERE paid_at>=? AND paid_at<?)
        + (SELECT COUNT(*) FROM subscription_orders WHERE paid_at>=? AND paid_at<?) AS paidOrders,
      (SELECT COUNT(*) FROM forum_posts p JOIN users u ON u.id=p.user_id WHERE u.is_demo=0 AND p.created_at>=? AND p.created_at<?) AS forumPosts,
      (SELECT COUNT(*) FROM forum_replies r JOIN users u ON u.id=r.user_id WHERE u.is_demo=0 AND r.created_at>=? AND r.created_at<?) AS forumReplies,
      (SELECT COUNT(*) FROM character_likes l JOIN users u ON u.id=l.user_id WHERE u.is_demo=0 AND l.created_at>=? AND l.created_at<?) AS likes,
      (SELECT COUNT(*) FROM forum_reports WHERE status='pending') AS openReports,
      (SELECT COUNT(*) FROM character_publications WHERE is_listed=1) AS listedCharacters`)
    .bind(...range, ...range, ...range, ...range, ...range, ...range, ...range, ...range, ...range, ...range)
    .first<Record<string, number>>();
  const days = window.days.map(day => byDay.get(day)!);
  const current = days[6];
  return {
    timezone: "Asia/Shanghai",
    day: window.day,
    visitors: current.visitors,
    guestVisitors: current.guestVisitors,
    registeredVisitors: current.registeredVisitors,
    newGuests: current.newGuests,
    newRegistered: current.newRegistered,
    returningVisitors: current.visitors - current.newGuests - current.newRegistered,
    conversations: count(today?.conversations),
    chatRequests: count(today?.chatRequests),
    chargedCredits: count(today?.chargedCredits),
    paidOrders: count(today?.paidOrders),
    forumPosts: count(today?.forumPosts),
    forumReplies: count(today?.forumReplies),
    likes: count(today?.likes),
    openReports: count(today?.openReports),
    listedCharacters: count(today?.listedCharacters),
    days,
  };
}
