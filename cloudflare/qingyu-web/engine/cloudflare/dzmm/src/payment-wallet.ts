import { ApiError } from "./http";
import type { Env, UserRecord } from "./types";
import { creditBillingConfig } from "./credit-usage";

type LiveOrder = {
  id: string; user_id: string; package_id: string; amount_minor: number; currency: "usd" | "cny";
  credits: number; refunded_credits: number; refunded_amount_minor: number; status: string;
  created_at: number; updated_at: number; paid_at: number | null; checkout_url: string | null;
  provider: "stripe" | "zpay" | "guagua"; method: "alipay" | "wxpay" | null;
};

export function liveOrder(row: LiveOrder) {
  return { id: row.id, accountId: row.user_id, packageId: row.package_id, amountMinor: row.amount_minor,
    currency: row.currency, credits: row.credits, refundedCredits: row.refunded_credits, refundedAmountMinor: row.refunded_amount_minor,
    status: row.status, mode: "live" as const, provider: row.provider, ...(row.provider === "zpay" || row.provider === "guagua" ? { method: row.method! } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at, paidAt: row.paid_at, checkoutUrl: row.checkout_url };
}

export function liveBalanceStatement(env: Env, userId: string) {
  return env.DB.prepare(`SELECT b.balance,b.reserved_credits,b.total_spent,b.debt_credits,g.total_purchased,g.total_refunded,g.total_subscription_granted FROM
    (SELECT COALESCE(SUM(credits),0) AS granted,COALESCE(SUM(CASE WHEN kind='purchase' THEN credits ELSE 0 END),0) AS total_purchased,
    -COALESCE(SUM(CASE WHEN kind='refund_adjustment' THEN credits ELSE 0 END),0) AS total_refunded,
    COALESCE(SUM(CASE WHEN kind='daily_grant' THEN credits ELSE 0 END),0) AS total_subscription_granted FROM (
      SELECT l.credits,l.kind FROM payment_credit_ledger l JOIN payment_orders o ON o.id=l.order_id WHERE l.user_id=? AND o.mode='live'
      UNION ALL SELECT l.credits,l.kind FROM zpay_credit_ledger l JOIN zpay_orders o ON o.id=l.order_id WHERE l.user_id=?
      UNION ALL SELECT l.credits,l.kind FROM guagua_credit_ledger l JOIN guagua_orders o ON o.id=l.order_id WHERE l.user_id=?
      UNION ALL SELECT credits,kind FROM subscription_credit_ledger WHERE user_id=?)) g
    JOIN credit_usage_balances b ON b.user_id=?`).bind(userId, userId, userId, userId, userId);
}

/** One D1 snapshot combines real purchased points across providers; sandbox
 * rows never enter this wallet, regardless of the Stripe checkout mode. */
export async function liveWallet(env: Env, user: UserRecord, provider: "stripe" | "zpay" | "guagua", orderId?: string) {
  const orders = `SELECT id,user_id,package_id,amount_minor,currency,credits,refunded_credits,refunded_amount_minor,status,
    created_at,updated_at,paid_at,checkout_url,'stripe' AS provider,NULL AS method FROM payment_orders WHERE user_id=? AND mode='live'
    UNION ALL SELECT id,user_id,package_id,amount_minor,currency,credits,refunded_credits,refunded_amount_minor,status,
    created_at,updated_at,paid_at,checkout_url,'zpay' AS provider,method FROM zpay_orders WHERE user_id=?
    UNION ALL SELECT id,user_id,package_id,amount_minor,currency,credits,refunded_credits,refunded_amount_minor,status,
    created_at,updated_at,paid_at,checkout_url,'guagua' AS provider,method FROM guagua_orders WHERE user_id=?`;
  const statements = [
    liveBalanceStatement(env, user.id),
    env.DB.prepare(`SELECT * FROM (${orders}) ORDER BY created_at DESC,id LIMIT 20`).bind(user.id, user.id, user.id),
  ];
  if (orderId) statements.push(env.DB.prepare(`SELECT * FROM (${orders}) WHERE id=?`).bind(user.id, user.id, user.id, orderId));
  const results = await env.DB.batch(statements);
  const order = orderId ? results[2].results[0] as unknown as LiveOrder | undefined : undefined;
  if (orderId && !order) throw new ApiError(404, "充值订单不存在。");
  const total = results[0].results[0] as unknown as { balance: number; total_purchased: number; total_refunded: number; total_subscription_granted: number;
    reserved_credits: number; total_spent: number; debt_credits: number };
  return { accountId: user.id, creditUnlimited: false, billingExempt: false, provider, mode: "live" as const, testMode: false, modelBillingLinked: creditBillingConfig(env).enabled,
    balance: Number(total.balance), totalPurchased: Number(total.total_purchased), totalRefunded: Number(total.total_refunded),
    totalSubscriptionGranted: Number(total.total_subscription_granted),
    reservedCredits: Number(total.reserved_credits), totalSpent: Number(total.total_spent), debtCredits: Number(total.debt_credits),
    orders: (results[1].results as unknown as LiveOrder[]).map(liveOrder), ...(order ? { order: liveOrder(order) } : {}) };
}
