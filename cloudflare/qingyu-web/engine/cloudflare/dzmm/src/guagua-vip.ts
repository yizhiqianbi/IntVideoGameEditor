import { createHash, randomInt } from "node:crypto";
import { inviteRebateStatement } from "./dream-coin";
import { ApiError } from "./http";
import type { Env } from "./types";

export const VIP_ORDER_ID = /^sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ORIGIN = "https://qingyu.invalid";
const VIP_SQL = `SELECT v.subscription_order_id,v.mer_order_tid,v.merchant_mid,v.channel_code,v.pay_url,v.provider_trade_no,
  o.amount_minor,o.user_id,o.status,o.paid_at
  FROM guagua_vip_orders v JOIN subscription_orders o ON o.id=v.subscription_order_id`;

export type GuaguaVipPayment = {
  subscription_order_id: string; mer_order_tid: string; merchant_mid: string; channel_code: string;
  pay_url: string | null; provider_trade_no: string | null; amount_minor: number; user_id: string;
  status: string; paid_at: number | null;
};
export type GuaguaVipFact = { merOrderTid: string; tid: string; amountMinor: number; status: number };

export function vipMerOrderTid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `gv${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function numericTradeNo(): string {
  return String(randomInt(1, 10)) + Array.from({ length: 31 }, () => String(randomInt(0, 10))).join("");
}
export function vipCheckoutUrl(id: string): string { return `${ORIGIN}/api/payments/guagua/vip/checkout/${id}`; }
export function vipReturnUrl(id: string): string { return `${ORIGIN}/api/payments/guagua/vip/return/${id}`; }
export function vipPaidLocation(id: string): string { return `${ORIGIN}/?payment_order=${id}&payment=success#recharge`; }

export async function readGuaguaVipByTid(env: Env, merOrderTid: string): Promise<GuaguaVipPayment | null> {
  return env.DB.prepare(`${VIP_SQL} WHERE v.mer_order_tid=?`).bind(merOrderTid).first<GuaguaVipPayment>();
}
export async function readGuaguaVipByOrder(env: Env, orderId: string, userId?: string): Promise<GuaguaVipPayment | null> {
  return env.DB.prepare(`${VIP_SQL} WHERE v.subscription_order_id=?${userId ? " AND o.user_id=?" : ""}`)
    .bind(orderId, ...(userId ? [userId] : [])).first<GuaguaVipPayment>();
}

function sameChannel(env: Env, payment: GuaguaVipPayment): boolean {
  return payment.merchant_mid === env.GUAGUA_MID && payment.channel_code === env.GUAGUA_CHANNEL_CODE;
}

/** A verified WeChat payment opens one membership period and does not grant recharge Credit. */
export async function fulfillGuaguaVip(env: Env, payment: GuaguaVipPayment, fact: GuaguaVipFact, source: "notify" | "query", now: number): Promise<void> {
  if (!sameChannel(env, payment) || fact.merOrderTid !== payment.mer_order_tid || fact.amountMinor !== payment.amount_minor || fact.status !== 1
    || (payment.provider_trade_no && payment.provider_trade_no !== fact.tid)) {
    throw new ApiError(400, "支付通道订单与本站会员记录不一致，未开通会员。");
  }
  const eventId = `gv_evt_${createHash("sha256").update(JSON.stringify([payment.subscription_order_id, fact.tid, fact.amountMinor])).digest("hex")}`;
  const nonce = crypto.randomUUID();
  const gate = "EXISTS(SELECT 1 FROM subscription_events WHERE event_id=? AND processing_token=?)";
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO subscription_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
      SELECT ?,?,id,?,?,? FROM subscription_orders WHERE id=? AND status IN ('pending','paid') AND amount_minor=?
      AND merchant_pid=? AND channel_id=? AND (provider_trade_no IS NULL OR provider_trade_no=?) ON CONFLICT(event_id) DO NOTHING`)
      .bind(eventId, source, fact.tid, nonce, now, payment.subscription_order_id, payment.amount_minor, payment.merchant_mid, payment.channel_code, fact.tid),
    env.DB.prepare(`UPDATE subscription_orders SET provider_trade_no=COALESCE(provider_trade_no,?),status='paid',paid_at=COALESCE(paid_at,?),updated_at=MAX(updated_at,?)
      WHERE id=? AND ${gate}`).bind(fact.tid, now, now, payment.subscription_order_id, eventId, nonce),
    env.DB.prepare(`INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at)
      SELECT ?,user_id,id,?,MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?)),
        MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?))+duration_days*86400000,?
      FROM subscription_orders WHERE id=? AND paid_at IS NOT NULL AND ${gate} ON CONFLICT(order_id) DO NOTHING`)
      .bind(`sub_${crypto.randomUUID()}`, eventId, now, now, now, now, now, payment.subscription_order_id, eventId, nonce),
    env.DB.prepare(`UPDATE guagua_vip_orders SET provider_trade_no=COALESCE(provider_trade_no,?)
      WHERE subscription_order_id=? AND (provider_trade_no IS NULL OR provider_trade_no=?)`).bind(fact.tid, payment.subscription_order_id, fact.tid),
    inviteRebateStatement(env, payment.user_id, `sp:${payment.subscription_order_id}`, payment.amount_minor, now, "subscription_events", eventId, nonce),
  ]);
  if (!results[0].meta.changes) {
    const current = await readGuaguaVipByOrder(env, payment.subscription_order_id);
    if (current?.provider_trade_no !== fact.tid || current.paid_at === null) throw new ApiError(400, "支付通道交易编号与会员订单发生冲突。");
  }
}

export async function closeGuaguaVip(env: Env, payment: GuaguaVipPayment, fact: GuaguaVipFact, now: number): Promise<void> {
  if (fact.amountMinor !== payment.amount_minor) throw new ApiError(400, "支付通道订单与本站会员记录不一致，未开通会员。");
  if (payment.paid_at !== null || ![2, 3, 4].includes(fact.status)) return;
  const status = fact.status === 4 ? "expired" : "failed";
  await env.DB.prepare("UPDATE subscription_orders SET status=?,updated_at=? WHERE id=? AND paid_at IS NULL").bind(status, now, payment.subscription_order_id).run();
}
