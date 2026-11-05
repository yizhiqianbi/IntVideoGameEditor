/** Which offline sessions the desk should hand back to the native companion. */

export type ReviveLane = {
  accountId: string;
  profile: string;
  sessionId: string;
  lastUserAt: number;
  lastUserText: string;
  lastSeenAt: number;
  lastRevivedAt: number;
  lastAttemptAt: number;
  quiet: boolean;
};

export const REVIVE_INTENT = "用户在上一轮之后停住了。请查看最近聊天和关系状态，判断这次是否值得自然主动开口；如果没有新鲜且合适的内容就保持安静。若主动，只发一条带新信息的分享、想念、轻撒娇或对上一句的自然延续，不要质问，不要使用‘你怎么不理我’，不要重复上一轮，也要尊重用户刚说过的忙、晚安或需要空间。";
export const INTIMATE_REVIVE_INTENT = "用户在上一轮之后停住了。请查看最近聊天，判断这次是否值得自然主动开口；没有新鲜内容就保持安静。若主动，只发一条符合当前恋人私聊和已发生关系的消息，可以想他、接上一句，或轻轻把话题往亲近处带，但不要突然开始未发生的性行为，不要质问，不要重复上一轮。对方刚说过停、忙、晚安或不想，就保持安静。";

export function clipOutreach(text: string, max: number) {
  return text.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function reviveIntent(profile: string) {
  return profile === "intimate" ? INTIMATE_REVIVE_INTENT : REVIVE_INTENT;
}

/** Every known session stays in the revival queue. Order only rotates who is started next. */
export function reviveDue(lanes: readonly ReviveLane[]): ReviveLane[] {
  return [...lanes].sort((left, right) => left.lastAttemptAt - right.lastAttemptAt || left.lastUserAt - right.lastUserAt || left.sessionId.localeCompare(right.sessionId));
}
