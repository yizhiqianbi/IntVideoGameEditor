/** Flat share of a friend's verified RMB payment. 100 fen = ¥1. */
export const INVITE_REBATE_PERCENT = 15;
export const INVITE_REBATE_CURRENCY = "CNY" as const;

export function inviteRebateFen(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return 0;
  return Math.floor(amountMinor * INVITE_REBATE_PERCENT / 100);
}
