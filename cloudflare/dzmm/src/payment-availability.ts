import { ApiError } from "./http";

/**
 * Central switch for accepting new money. It is deliberately opt-in: an
 * omitted value keeps all checkout entry points closed until the operator
 * explicitly enables collection. Historical orders, callbacks and read-only
 * balance APIs do not use this gate.
 */
export const PAYMENT_PAUSED_NOTE = "收款暂时关闭，已有订单和会员权益不受影响。";

export function paymentCollectionEnabled(env: { PAYMENTS_ACCEPTING_ENABLED?: string }): boolean {
  return env.PAYMENTS_ACCEPTING_ENABLED === "true";
}

export function requirePaymentCollection(env: { PAYMENTS_ACCEPTING_ENABLED?: string }): void {
  if (!paymentCollectionEnabled(env)) throw new ApiError(503, PAYMENT_PAUSED_NOTE);
}
