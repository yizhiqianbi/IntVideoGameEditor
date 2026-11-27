import type { D1PreparedStatement } from "@cloudflare/workers-types";
import type { Env } from "./types";

const DAY_MS = 86_400_000;
const MIN_PAYABLE_MINOR = 100;

export type SubscriptionPlanLike = {
  id: string;
  label: string;
  tier?: number;
  amountMinor: number;
  durationDays: 7 | 30;
  dailyCredits: number;
  maxClaims: 7 | 30;
  dailyAudioLimit?: number;
  dailyImageLimit?: number;
};

export type SubscriptionMediaLimits = {
  audio: number;
  image: number;
  maxVoiceChars: number;
};

/** Resolve daily voice & illustration quotas for a VIP tier (defaults preserve legacy 20/5). */
export function resolveSubscriptionMediaLimits(
  input: { planId?: string | null; tier?: number | null; durationDays?: number | null; dailyCredits?: number | null; dailyAudioLimit?: number | null; dailyImageLimit?: number | null },
  plans: readonly SubscriptionPlanLike[] = [],
): SubscriptionMediaLimits {
  const matched = input.planId ? plans.find((p) => p.id === input.planId) : undefined;
  const audioConfigured = input.dailyAudioLimit ?? matched?.dailyAudioLimit;
  const imageConfigured = input.dailyImageLimit ?? matched?.dailyImageLimit;
  if (Number.isSafeInteger(audioConfigured) && Number(audioConfigured) > 0 && Number.isSafeInteger(imageConfigured) && Number(imageConfigured) > 0) {
    return { audio: Number(audioConfigured), image: Number(imageConfigured), maxVoiceChars: 800 };
  }
  const tier = resolveSubscriptionTier(
    { planId: input.planId ?? undefined, tier: input.tier ?? undefined, durationDays: input.durationDays ?? undefined, dailyCredits: input.dailyCredits ?? undefined },
    plans,
  );
  if (tier >= 4) return { audio: 80, image: 20, maxVoiceChars: 800 };
  if (tier === 3) return { audio: 40, image: 10, maxVoiceChars: 800 };
  if (tier === 2) return { audio: 20, image: 5, maxVoiceChars: 800 };
  if (tier === 1 && (input.planId === "vip_weekly" || input.durationDays === 7)) return { audio: 10, image: 3, maxVoiceChars: 800 };
  return { audio: 20, image: 5, maxVoiceChars: 800 };
}

export type ActiveSubscriptionForUpgrade = {
  id: string;
  planId: string;
  label: string;
  currency: string;
  amountMinor: number;
  listAmountMinor: number | null;
  durationDays: number;
  dailyCredits: number;
  maxClaims: number;
  claimsCount: number;
  startsAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

export type SubscriptionUpgradeQuote = {
  fromSubscriptionId: string;
  fromPlanId: string;
  fromLabel: string;
  remainingUnits: number;
  totalUnits: number;
  listAmountMinor: number;
  tradeInMinor: number;
  payableAmountMinor: number;
};

/** Resolve an integer tier for a plan or historical subscription period. */
export function resolveSubscriptionTier(
  item: { id?: string; planId?: string; tier?: number; durationDays: number; dailyCredits: number },
  plans: readonly SubscriptionPlanLike[] = [],
): number {
  if (typeof item.tier === "number" && Number.isSafeInteger(item.tier) && item.tier >= 1) return item.tier;
  const planId = item.planId ?? item.id;
  if (planId) {
    const matched = plans.find((entry) => entry.id === planId);
    if (matched && typeof matched.tier === "number" && Number.isSafeInteger(matched.tier) && matched.tier >= 1) {
      return matched.tier;
    }
  }
  if (item.durationDays >= 90) return 99;
  if (item.durationDays <= 7) return 1;
  if (item.dailyCredits <= 300) return 2;
  if (item.dailyCredits <= 600) return 3;
  return 4;
}

/**
 * Authoritative prorated trade-in quote:
 * Calculates remaining unused value of the current active CNY membership and deducts it
 * from a strictly higher-tier target plan to open a fresh full-duration period immediately.
 */
export function computeSubscriptionUpgradeQuote(
  active: ActiveSubscriptionForUpgrade | null | undefined,
  target: SubscriptionPlanLike,
  plans: readonly SubscriptionPlanLike[],
  now: number,
): SubscriptionUpgradeQuote | null {
  if (!active || active.revokedAt !== null || active.startsAt > now || active.expiresAt <= now) return null;
  if (active.currency !== "cny") return null;
  if (active.maxClaims <= 0 || target.amountMinor <= MIN_PAYABLE_MINOR) return null;

  const activeTier = resolveSubscriptionTier(active, plans);
  const targetTier = resolveSubscriptionTier(target, plans);
  if (targetTier <= activeTier) return null;
  if (target.durationDays < active.durationDays) return null;

  const baseValueMinor = active.listAmountMinor && active.listAmountMinor > 0 ? active.listAmountMinor : active.amountMinor;
  if (!Number.isSafeInteger(baseValueMinor) || baseValueMinor <= 0) return null;

  const remainingClaims = Math.max(0, active.maxClaims - active.claimsCount);
  const remainingDaysByTime = Math.max(0, Math.ceil((active.expiresAt - now) / DAY_MS));
  const remainingUnits = Math.min(remainingClaims, remainingDaysByTime, active.maxClaims);
  if (remainingUnits <= 0) return null;

  const rawTradeIn = Math.floor((baseValueMinor * remainingUnits) / active.maxClaims);
  const maxTradeIn = Math.max(0, target.amountMinor - MIN_PAYABLE_MINOR);
  const tradeInMinor = Math.max(0, Math.min(rawTradeIn, maxTradeIn));
  if (tradeInMinor <= 0) return null;

  const payableAmountMinor = target.amountMinor - tradeInMinor;
  return {
    fromSubscriptionId: active.id,
    fromPlanId: active.planId,
    fromLabel: active.label,
    remainingUnits,
    totalUnits: active.maxClaims,
    listAmountMinor: target.amountMinor,
    tradeInMinor,
    payableAmountMinor,
  };
}

/** Build the map of all eligible upgrade quotes for the current active subscription. */
export function computeAllUpgradeQuotes(
  active: ActiveSubscriptionForUpgrade | null | undefined,
  plans: readonly SubscriptionPlanLike[],
  now: number,
): Record<string, SubscriptionUpgradeQuote> {
  const quotes: Record<string, SubscriptionUpgradeQuote> = {};
  if (!active) return quotes;
  for (const plan of plans) {
    const quote = computeSubscriptionUpgradeQuote(active, plan, plans, now);
    if (quote) quotes[plan.id] = quote;
  }
  return quotes;
}

/**
 * Atomic SQL statements to activate a paid subscription order.
 * - Normal order: appends seamlessly after the user's latest non-revoked period (or starts now).
 * - Prorated upgrade order: atomically shifts any queued future periods, retires the old active period
 *   (`revoked_at = now, upgraded_to_order_id = orderId`), and starts the upgraded period immediately at `now`.
 *   If the old period already expired before late callback arrival, safely falls back to standard activation.
 */
export function periodActivationStatements(
  env: Pick<Env, "DB">,
  params: {
    userId: string;
    orderId: string;
    upgradeFromSubscriptionId: string | null | undefined;
    eventId: string;
    nonce: string;
    now: number;
  },
): D1PreparedStatement[] {
  const { userId, orderId, upgradeFromSubscriptionId, eventId, nonce, now } = params;
  const gate = "EXISTS(SELECT 1 FROM subscription_events WHERE event_id=? AND processing_token=?)";

  if (!upgradeFromSubscriptionId) {
    return [
      env.DB.prepare(`INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at)
        SELECT ?,user_id,id,?,MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?)),
          MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?))+duration_days*86400000,?
        FROM subscription_orders WHERE id=? AND paid_at IS NOT NULL AND ${gate} ON CONFLICT(order_id) DO NOTHING`)
        .bind(`sub_${crypto.randomUUID()}`, eventId, now, now, now, now, now, orderId, eventId, nonce),
    ];
  }

  return [
    // 1. Shift any already-queued future periods so they never overlap the newly started upgraded period.
    env.DB.prepare(`UPDATE subscription_periods
      SET starts_at = starts_at + MAX(0, (? + (SELECT duration_days FROM subscription_orders WHERE id=?) * 86400000) - (SELECT expires_at FROM subscription_periods WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at > ?)),
          expires_at = expires_at + MAX(0, (? + (SELECT duration_days FROM subscription_orders WHERE id=?) * 86400000) - (SELECT expires_at FROM subscription_periods WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at > ?))
      WHERE user_id = ? AND id <> ? AND revoked_at IS NULL AND starts_at > ?
        AND EXISTS(SELECT 1 FROM subscription_periods WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at > ?)
        AND NOT EXISTS(SELECT 1 FROM subscription_periods WHERE order_id=?)
        AND ${gate}`)
      .bind(
        now, orderId, upgradeFromSubscriptionId, userId, now,
        now, orderId, upgradeFromSubscriptionId, userId, now,
        userId, upgradeFromSubscriptionId, now,
        upgradeFromSubscriptionId, userId, now,
        orderId, eventId, nonce,
      ),
    // 2. Retire the traded-in active period with an audit link to the upgrading order.
    env.DB.prepare(`UPDATE subscription_periods
      SET revoked_at = ?, upgraded_to_order_id = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
        AND NOT EXISTS(SELECT 1 FROM subscription_periods WHERE order_id=?)
        AND ${gate}`)
      .bind(now, orderId, upgradeFromSubscriptionId, userId, now, orderId, eventId, nonce),
    // 3. Open the upgraded full-duration period starting immediately (with safe fallback if old period had already ended).
    env.DB.prepare(`INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at)
      SELECT ?,user_id,id,?,
        CASE WHEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.id=subscription_orders.upgrade_from_subscription_id AND p.upgraded_to_order_id=subscription_orders.id)
          THEN ?
          ELSE MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?))
        END,
        CASE WHEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.id=subscription_orders.upgrade_from_subscription_id AND p.upgraded_to_order_id=subscription_orders.id)
          THEN ? + duration_days * 86400000
          ELSE MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?)) + duration_days * 86400000
        END,
        ?
      FROM subscription_orders WHERE id=? AND paid_at IS NOT NULL AND ${gate} ON CONFLICT(order_id) DO NOTHING`)
      .bind(`sub_${crypto.randomUUID()}`, eventId, now, now, now, now, now, now, now, orderId, eventId, nonce),
  ];
}
