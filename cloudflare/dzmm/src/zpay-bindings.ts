import type { Env } from "./types";

/** These statements run in the same D1 transaction as fulfillment. Each source
 * graph also keeps its own uniqueness rules for historical compatibility. */
export function bindZpayTrade(env: Env, kind: "recharge" | "subscription", orderId: string, outTradeNo: string, merchantPid: string, tradeNo: string) {
  const column = kind === "recharge" ? "recharge_order_id" : "subscription_order_id";
  return env.DB.prepare(`UPDATE zpay_payment_bindings SET provider_trade_no=COALESCE(provider_trade_no,?)
    WHERE out_trade_no=? AND ${column}=? AND merchant_pid=? AND (provider_trade_no IS NULL OR provider_trade_no=?)
    AND NOT EXISTS(SELECT 1 FROM zpay_payment_bindings WHERE provider_trade_no=? AND out_trade_no<>?)`)
    .bind(tradeNo, outTradeNo, orderId, merchantPid, tradeNo, tradeNo, outTradeNo);
}
export function zpayBindingGate(kind: "recharge" | "subscription") {
  const column = kind === "recharge" ? "recharge_order_id" : "subscription_order_id";
  const table = kind === "recharge" ? "zpay_orders" : "subscription_orders";
  return `EXISTS(SELECT 1 FROM zpay_payment_bindings b WHERE b.out_trade_no=${table}.out_trade_no AND b.${column}=${table}.id AND b.provider_trade_no=?)`;
}
