type Turn = { role: "user" | "assistant" };
type Conversation = { id: string; characterId: string; messages: readonly Turn[] };

/** A round is one user message answered by the following assistant message. */
export function completedRounds(messages: readonly Turn[]): number {
  let rounds = 0;
  let waiting = false;
  for (const message of messages) {
    if (message.role === "user") waiting = true;
    else if (waiting) { rounds += 1; waiting = false; }
  }
  return rounds;
}

/**
 * Counts rounds that appeared on a conversation the account already had.
 * A conversation seen for the first time is a baseline, so old history is
 * not written into today's heat.
 */
export function successfulRoundDeltas(previous: readonly Conversation[], next: readonly Conversation[]): Array<{ characterId: string; rounds: number }> {
  const before = new Map(previous.map((item) => [item.id, item]));
  const totals = new Map<string, number>();
  for (const conversation of next) {
    const prior = before.get(conversation.id);
    if (!prior) continue;
    if (!conversation.characterId || conversation.characterId.length > 120) continue;
    const delta = completedRounds(conversation.messages) - completedRounds(prior.messages);
    if (delta <= 0) continue;
    totals.set(conversation.characterId, (totals.get(conversation.characterId) ?? 0) + delta);
  }
  return [...totals].map(([characterId, rounds]) => ({ characterId, rounds }));
}

/** Referral days count a completed round even on the first sync of a new chat.
 * Heat still ignores that first sighting so an imported history does not
 * become today's ranking. One successful round is enough for the daily grant.
 */
export function hasReferralRound(previous: readonly Conversation[], next: readonly Conversation[]): boolean {
  const before = new Map(previous.map((item) => [item.id, item]));
  for (const conversation of next) {
    if (!conversation.characterId || conversation.characterId.length > 120) continue;
    const prior = before.get(conversation.id);
    const current = completedRounds(conversation.messages);
    const earlier = prior ? completedRounds(prior.messages) : 0;
    if (current > earlier) return true;
  }
  return false;
}
