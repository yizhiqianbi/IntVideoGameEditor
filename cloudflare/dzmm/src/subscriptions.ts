import { createHash, randomInt } from "node:crypto";
import { digest, rateLimit, requireUser, tokenFrom } from "./auth";
import { ApiError, json, readJson } from "./http";
import { liveBalanceStatement } from "./payment-wallet";
import { bindZpayTrade, zpayBindingGate } from "./zpay-bindings";
import { renderZpayForm, verifyZpayFact, zpayCallbackFact, zpayCallbackParameters, zpayChannel, zpayConfigured,
  zpayCredentialsConfigured, zpayMethods, queryZpayOrder, type ZpayOptions } from "./zpay";
import type { Env, UserRecord } from "./types";
import { creditBillingConfig } from "./credit-usage";
import { PAYMENT_PAUSED_NOTE, paymentCollectionEnabled } from "./payment-availability";
import { queryGuaguaPayment, type GuaguaOptions } from "./guagua";
import { fulfillGuaguaVip, numericTradeNo, readGuaguaVipByOrder, vipCheckoutUrl, vipMerOrderTid } from "./guagua-vip";
import {
  computeAllUpgradeQuotes,
  computeSubscriptionUpgradeQuote,
  periodActivationStatements,
  resolveSubscriptionTier,
  type ActiveSubscriptionForUpgrade,
} from "./subscription-upgrade";

const DAY = 86400000, OFFSET = 8 * 3600000;
const SQL_NOW_MS = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const ORIGIN = "https://xumengchat.top", CALLBACK = "/api/payments/zpay/subscription";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const SUBSCRIPTION_ORDER_ID = /^sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PERIOD_ID = /^sub_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Plan = { id: string; label: string; tier?: number; revision: number; amountMinor: number; currency: "cny"; durationDays: 7 | 30;
  dailyCredits: number; maxClaims: 7 | 30; timezone: "Asia/Shanghai"; dailyAudioLimit?: number; dailyImageLimit?: number };
type Order = { id: string; user_id: string; request_id: string; plan_id: string; plan_revision: number; label: string; amount_minor: number;
  list_amount_minor?: number | null; trade_in_minor?: number | null; upgrade_from_subscription_id?: string | null;
  currency: "cny"; duration_days: 7 | 30; daily_credits: number; max_claims: 7 | 30; timezone: "Asia/Shanghai"; method: "alipay" | "wxpay";
  out_trade_no: string; merchant_pid: string; channel_id: string; payment_name: string; provider_trade_no: string | null;
  checkout_url: string; status: string; created_at: number; updated_at: number; paid_at: number | null; subscription_id?: string | null };
type Period = { id: string; order_id: string; plan_id: string; plan_revision: number; label: string; starts_at: number; expires_at: number;
  revoked_at: number | null; upgraded_to_order_id?: string | null; currency: string; amount_minor: number; list_amount_minor?: number | null;
  duration_days: number; daily_credits: number; max_claims: number; claims_count: number };
type Claim = { id: string; subscription_id: string; day_key: string; credits: number; claimed_at: number };
type CheckoutPricing = {
  amountMinor: number;
  listAmountMinor: number;
  tradeInMinor: number;
  upgradeFromSubscriptionId: string | null;
};
const context = { provider: "zpay" as const, mode: "live" as const, testMode: false };
const nowFrom = (options: ZpayOptions) => (options.now ?? Date.now)();
const dayKey = (now: number) => new Date(now + OFFSET).toISOString().slice(0, 10);
const resetAt = (now: number) => (Math.floor((now + OFFSET) / DAY) + 1) * DAY - OFFSET;
const positive = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** No implicit price/entitlement defaults: an unconfirmed catalogue cannot be sold. */
export function readSubscriptionPlans(env: Env): Plan[] {
  if (env.SUBSCRIPTION_PLANS_JSON === undefined) return [];
  if (env.SUBSCRIPTION_PLANS_JSON.length > 16384) throw new ApiError(503, "订阅套餐配置无效，暂未开放购买。");
  let parsed: unknown; try { parsed = JSON.parse(env.SUBSCRIPTION_PLANS_JSON); } catch { throw new ApiError(503, "订阅套餐配置无效，暂未开放购买。"); }
  if (!Array.isArray(parsed) || parsed.length > 10) throw new ApiError(503, "订阅套餐配置无效，暂未开放购买。");
  const fields = ["id", "label", "tier", "revision", "amountMinor", "currency", "durationDays", "dailyCredits", "maxClaims", "timezone", "dailyAudioLimit", "dailyImageLimit"];
  const plans: Plan[] = [];
  for (const plan of parsed) {
    if (!record(plan) || Object.keys(plan).some(key => !fields.includes(key)) || typeof plan.id !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(plan.id)
      || typeof plan.label !== "string" || plan.label.trim() !== plan.label || !plan.label || plan.label.length > 60 || /[\0\r\n]/.test(plan.label)
      || (plan.tier !== undefined && !positive(plan.tier, 99))
      || (plan.dailyAudioLimit !== undefined && !positive(plan.dailyAudioLimit, 1000))
      || (plan.dailyImageLimit !== undefined && !positive(plan.dailyImageLimit, 500))
      || !positive(plan.revision, 1000000) || !positive(plan.amountMinor, 1000000) || !positive(plan.dailyCredits, 1000000)
      || plan.currency !== "cny" || (plan.durationDays !== 7 && plan.durationDays !== 30) || plan.maxClaims !== plan.durationDays || plan.timezone !== "Asia/Shanghai"
      || plans.some(existing => existing.id === plan.id)) throw new ApiError(503, "订阅套餐配置无效，暂未开放购买。");
    plans.push(plan as Plan);
  }
  return plans;
}
function guaguaVipReady(env: Env): boolean {
  return env.PAYMENT_PROVIDER === "guagua" && env.GUAGUA_ENABLED === "true"
    && typeof env.GUAGUA_MID === "string" && /^M\d{4,12}$/.test(env.GUAGUA_MID)
    && typeof env.GUAGUA_SECRET === "string" && /^[a-f0-9]{32}$/i.test(env.GUAGUA_SECRET)
    && typeof env.GUAGUA_CHANNEL_CODE === "string" && /^[A-Za-z0-9]{1,32}$/.test(env.GUAGUA_CHANNEL_CODE);
}
function configuration(env: Env) {
  let plans: Plan[] = []; try { plans = readSubscriptionPlans(env); } catch { /* Public config fails closed without raw configuration data. */ }
  const wechat = env.PAYMENT_PROVIDER === "guagua";
  const enabled = paymentCollectionEnabled(env) && env.SUBSCRIPTION_ENABLED === "true" && plans.length > 0
    && (wechat ? guaguaVipReady(env) : env.PAYMENT_PROVIDER === "zpay" && zpayConfigured(env));
  const singleNote = plans.length === 1
    ? `会员卡需手动购买续期；北京时间每日领取一次，每天 ${plans[0].dailyCredits} 金币，每期最多 ${plans[0].maxClaims} 次，漏签不补；会员期内短剧免费看。已领取金币不随会员到期失效。退款需管理员人工处理并核对。`
    : "会员卡需手动购买续期；北京时间每日按当前等级领取一次金币，漏签不补；有效期内升级更高等级月卡支持按旧卡剩余未领比例自动补差价并立即开启完整新周期；会员期内短剧免费看。已领取金币不随会员到期失效。退款需管理员人工处理并核对。";
  return { ...context, modelBillingLinked: creditBillingConfig(env).enabled, enabled, currency: "cny", timezone: "Asia/Shanghai", renewal: "manual", autoRenew: false, plans,
    methods: wechat ? (guaguaVipReady(env) ? [{ id: "wxpay" as const, label: "微信支付" }] : []) : zpayMethods(env),
    note: !paymentCollectionEnabled(env) ? PAYMENT_PAUSED_NOTE
      : enabled ? singleNote
        : "订阅购买暂未开放，套餐和权益正在确认。已购买的有效权益仍可领取；不会自动扣费。退款需管理员人工处理并核对。" };
}
function requireConfiguration(env: Env) { const config = configuration(env); if (!config.enabled) throw new ApiError(503, "订阅套餐尚未开放购买，请稍后再试。"); return config; }
function account(body: Record<string, unknown>, user: UserRecord, env: Env) {
  if (typeof body.accountId !== "string" || !UUID.test(body.accountId)) throw new ApiError(400, "请提供当前账户编号。");
  if (body.accountId !== user.id) throw new ApiError(409, "账户已切换，请刷新订阅页面后重试。");
  const allowedProviders = env.PAYMENT_PROVIDER === "guagua" ? ["zpay", "guagua"] : ["zpay"];
  if (!allowedProviders.includes(body.provider as string) || body.mode !== "live") throw new ApiError(409, "订阅支付环境已改变，请刷新后重试。");
}
function sessionHash(request: Request) { const token = tokenFrom(request); if (!token) throw new ApiError(401, "登录状态已失效，请重新登录。"); return digest(token); }
function orderValue(order: Order, env: Env) {
  return { ...context, modelBillingLinked: creditBillingConfig(env).enabled, id: order.id, accountId: order.user_id, planId: order.plan_id, planRevision: order.plan_revision, label: order.label,
    amountMinor: order.amount_minor,
    ...(order.list_amount_minor != null ? { listAmountMinor: Number(order.list_amount_minor) } : {}),
    ...(Number(order.trade_in_minor ?? 0) > 0 ? { tradeInMinor: Number(order.trade_in_minor) } : {}),
    ...(order.upgrade_from_subscription_id ? { upgradeFromSubscriptionId: order.upgrade_from_subscription_id } : {}),
    currency: order.currency, durationDays: order.duration_days, dailyCredits: order.daily_credits,
    maxClaims: order.max_claims, timezone: order.timezone, method: order.method, status: order.status, createdAt: order.created_at,
    updatedAt: order.updated_at, paidAt: order.paid_at, checkoutUrl: order.checkout_url, subscriptionId: order.subscription_id ?? null };
}
function claimValue(claim: Claim) { return { id: claim.id, subscriptionId: claim.subscription_id, dayKey: claim.day_key, credits: claim.credits, claimedAt: claim.claimed_at }; }

function toActiveUpgradeInput(period: Period): ActiveSubscriptionForUpgrade {
  return {
    id: period.id,
    planId: period.plan_id,
    label: period.label,
    currency: period.currency,
    amountMinor: Number(period.amount_minor),
    listAmountMinor: period.list_amount_minor != null ? Number(period.list_amount_minor) : null,
    durationDays: Number(period.duration_days),
    dailyCredits: Number(period.daily_credits),
    maxClaims: Number(period.max_claims),
    claimsCount: Number(period.claims_count),
    startsAt: Number(period.starts_at),
    expiresAt: Number(period.expires_at),
    revokedAt: period.revoked_at !== null ? Number(period.revoked_at) : null,
  };
}

export async function readSubscriptions(env: Env, user: UserRecord, now = Date.now()) {
  let plans: Plan[] = [];
  try { plans = readSubscriptionPlans(env); } catch { /* ignore invalid plans when reading user history */ }
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT p.id,p.order_id,p.starts_at,p.expires_at,p.revoked_at,p.upgraded_to_order_id,
      o.plan_id,o.plan_revision,o.label,o.currency,o.amount_minor,o.list_amount_minor,o.duration_days,o.daily_credits,o.max_claims,
      (SELECT COUNT(*) FROM subscription_daily_claims c WHERE c.subscription_id=p.id) AS claims_count
      FROM subscription_periods p JOIN subscription_orders o ON o.id=p.order_id WHERE p.user_id=?
      ORDER BY CASE WHEN p.revoked_at IS NULL AND p.starts_at<=? AND p.expires_at>? THEN 0 WHEN p.revoked_at IS NULL AND p.starts_at>? THEN 1 ELSE 2 END,
        CASE WHEN p.revoked_at IS NULL AND p.expires_at>? THEN p.starts_at ELSE -p.starts_at END LIMIT 100`).bind(user.id, now, now, now, now),
    env.DB.prepare("SELECT id,subscription_id,day_key,credits,claimed_at FROM subscription_daily_claims WHERE user_id=? AND day_key=?").bind(user.id, dayKey(now)),
    liveBalanceStatement(env, user.id),
  ]);
  const periods = results[0].results as unknown as Period[], today = results[1].results[0] as unknown as Claim | undefined;
  const active = periods.find(period => period.revoked_at === null && period.starts_at <= now && period.expires_at > now);
  const total = results[2].results[0] as unknown as { balance: number; total_subscription_granted: number };
  const upgrades = active ? computeAllUpgradeQuotes(toActiveUpgradeInput(active), plans, now) : {};
  return { ...context, modelBillingLinked: creditBillingConfig(env).enabled, accountId: user.id, superAccess: !user.isGuest && user.role==="super", creditUnlimited: false, billingExempt: false, serverTime: now, timezone: "Asia/Shanghai", renewal: "manual", autoRenew: false,
    balance: Number(total.balance), totalSubscriptionGranted: Number(total.total_subscription_granted),
    subscriptions: periods.map(period => ({ id: period.id, orderId: period.order_id, planId: period.plan_id, planRevision: period.plan_revision,
      tier: resolveSubscriptionTier({ planId: period.plan_id, durationDays: Number(period.duration_days), dailyCredits: Number(period.daily_credits) }, plans),
      label: period.label,
      status: period.upgraded_to_order_id ? "upgraded" : period.revoked_at !== null ? "revoked" : period.starts_at > now ? "queued" : period.expires_at <= now ? "expired" : "active",
      startsAt: period.starts_at, expiresAt: period.expires_at, dailyCredits: period.daily_credits, claimsCount: period.claims_count, maxClaims: period.max_claims,
      ...(period.upgraded_to_order_id ? { upgradedToOrderId: period.upgraded_to_order_id } : {}) })),
    ...(Object.keys(upgrades).length ? { upgrades } : {}),
    checkin: { subscriptionId: today?.subscription_id ?? active?.id ?? null, dayKey: dayKey(now), timezone: "Asia/Shanghai", claimed: !!today,
      claimable: !!active && active.claims_count < active.max_claims && !today,
      rewardCredits: today?.credits ?? active?.daily_credits ?? 0, claimedAt: today?.claimed_at ?? null, resetAt: resetAt(now) } };
}

async function resolveCheckoutPricing(
  env: Env,
  user: UserRecord,
  plan: Plan,
  plans: readonly Plan[],
  body: Record<string, unknown>,
  now: number,
): Promise<CheckoutPricing> {
  const upgradeFrom = body.upgradeFromSubscriptionId;
  if (upgradeFrom === undefined || upgradeFrom === null || upgradeFrom === "") {
    if (body.expectedAmountMinor !== undefined && body.expectedAmountMinor !== plan.amountMinor) {
      throw new ApiError(409, "订阅价格已更新，请刷新并确认后购买。");
    }
    return { amountMinor: plan.amountMinor, listAmountMinor: plan.amountMinor, tradeInMinor: 0, upgradeFromSubscriptionId: null };
  }
  if (typeof upgradeFrom !== "string" || !PERIOD_ID.test(upgradeFrom)) {
    throw new ApiError(400, "升级来源会员编号无效，请刷新页面后重试。");
  }
  if (body.expectedAmountMinor !== undefined && !positive(body.expectedAmountMinor, 1_000_000)) {
    throw new ApiError(400, "预期补差价金额无效。");
  }
  const activeRow = await env.DB.prepare(`SELECT p.id,p.order_id,p.starts_at,p.expires_at,p.revoked_at,p.upgraded_to_order_id,
    o.plan_id,o.plan_revision,o.label,o.currency,o.amount_minor,o.list_amount_minor,o.duration_days,o.daily_credits,o.max_claims,
    (SELECT COUNT(*) FROM subscription_daily_claims c WHERE c.subscription_id=p.id) AS claims_count
    FROM subscription_periods p JOIN subscription_orders o ON o.id=p.order_id
    WHERE p.id=? AND p.user_id=?`).bind(upgradeFrom, user.id).first<Period>();
  const quote = activeRow ? computeSubscriptionUpgradeQuote(toActiveUpgradeInput(activeRow), plan, plans, now) : null;
  if (!quote) {
    throw new ApiError(409, "当前会员状态已变化，暂不支持按原折抵方案升级，请刷新页面查看最新价格。");
  }
  if (body.expectedAmountMinor !== undefined && body.expectedAmountMinor !== quote.payableAmountMinor) {
    throw new ApiError(409, "补差价金额已随签到或剩余天数更新，请刷新页面确认最新差价后再支付。");
  }
  return {
    amountMinor: quote.payableAmountMinor,
    listAmountMinor: quote.listAmountMinor,
    tradeInMinor: quote.tradeInMinor,
    upgradeFromSubscriptionId: quote.fromSubscriptionId,
  };
}

async function guaguaCheckout(request: Request, env: Env, user: UserRecord, plan: Plan, pricing: CheckoutPricing, method: "wxpay", requestId: string, options: ZpayOptions) {
  const hash = sessionHash(request), now = nowFrom(options), id = `sp_${crypto.randomUUID()}`;
  const tid = vipMerOrderTid(), outTradeNo = numericTradeNo();
  await rateLimit(request, env, "subscription-checkout-account", 60, user.id); await rateLimit(request, env, "subscription-checkout-ip", 300);
  const checkoutUrl = vipCheckoutUrl(id);
  const paymentName = pricing.upgradeFromSubscriptionId ? `叙梦 VIP 升级 · ${plan.label}` : `叙梦 VIP · ${plan.label}`;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,list_amount_minor,trade_in_minor,upgrade_from_subscription_id,duration_days,daily_credits,max_claims,timezone,
      method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,created_at,updated_at)
      SELECT ?,u.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM users u WHERE u.id=? AND u.is_guest=0
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=u.id AND expires_at>?) ON CONFLICT(user_id,request_id) DO NOTHING`)
      .bind(id, requestId, plan.id, plan.revision, plan.label, pricing.amountMinor, pricing.listAmountMinor, pricing.tradeInMinor, pricing.upgradeFromSubscriptionId, plan.durationDays, plan.dailyCredits, plan.maxClaims, plan.timezone,
        method, outTradeNo, env.GUAGUA_MID!, env.GUAGUA_CHANNEL_CODE!, paymentName, checkoutUrl, now, now, user.id, hash, now),
    env.DB.prepare(`INSERT INTO guagua_vip_orders(subscription_order_id,mer_order_tid,merchant_mid,channel_code)
      SELECT id,?,?,? FROM subscription_orders WHERE user_id=? AND request_id=? AND method='wxpay' AND merchant_pid=? AND channel_id=?
      ON CONFLICT(subscription_order_id) DO NOTHING`)
      .bind(tid, env.GUAGUA_MID!, env.GUAGUA_CHANNEL_CODE!, user.id, requestId, env.GUAGUA_MID!, env.GUAGUA_CHANNEL_CODE!),
  ]);
  const order = await getOrder(env, user.id, undefined, requestId);
  if (!order) throw new ApiError(401, "登录状态已失效，请重新登录。");
  if (order.plan_id !== plan.id || order.plan_revision !== plan.revision || order.method !== method || order.merchant_pid !== env.GUAGUA_MID
    || order.channel_id !== env.GUAGUA_CHANNEL_CODE || order.amount_minor !== pricing.amountMinor || order.daily_credits !== plan.dailyCredits
    || (order.upgrade_from_subscription_id ?? null) !== pricing.upgradeFromSubscriptionId) {
    throw new ApiError(409, "该请求编号已用于其他订阅方案，请重新确认。");
  }
  return json({ ...context, modelBillingLinked: creditBillingConfig(env).enabled, accountId: user.id, order: orderValue(order, env), checkoutUrl: order.checkout_url }, results[0].meta.changes === 1 ? 201 : 200);
}
async function checkout(request: Request, env: Env, user: UserRecord, options: ZpayOptions & GuaguaOptions) {
  const config = requireConfiguration(env), body = await readJson(request, 2048); account(body, user, env);
  if (Object.keys(body).some(key => !["accountId", "planId", "planRevision", "requestId", "provider", "mode", "method", "upgradeFromSubscriptionId", "expectedAmountMinor"].includes(key))) throw new ApiError(400, "订阅价格与权益只能由服务端确定。");
  const plan = config.plans.find(plan => plan.id === body.planId);
  if (!plan || typeof body.requestId !== "string" || !UUID.test(body.requestId) || (body.method !== "alipay" && body.method !== "wxpay")) throw new ApiError(400, "请选择有效的订阅套餐和支付方式。");
  if (body.planRevision !== plan.revision) throw new ApiError(409, "订阅价格或权益已更新，请刷新并确认后购买。");
  const now = nowFrom(options);
  const pricing = await resolveCheckoutPricing(env, user, plan, config.plans, body, now);
  if (env.PAYMENT_PROVIDER === "guagua") {
    if (body.method !== "wxpay") throw new ApiError(503, "所选支付方式尚未开通。");
    return guaguaCheckout(request, env, user, plan, pricing, "wxpay", body.requestId.toLowerCase(), options);
  }
  const channel = zpayChannel(env, body.method); if (!channel) throw new ApiError(503, "所选支付方式尚未开通。");
  const hash = sessionHash(request), requestId = body.requestId.toLowerCase(), id = `sp_${crypto.randomUUID()}`;
  await rateLimit(request, env, "subscription-checkout-account", 60, user.id); await rateLimit(request, env, "subscription-checkout-ip", 300);
  const outTradeNo = String(randomInt(1, 10)) + Array.from({ length: 31 }, () => String(randomInt(0, 10))).join("");
  const paymentName = pricing.upgradeFromSubscriptionId ? `叙梦 VIP 升级 · ${plan.label}` : `叙梦 AI 对话会员 · ${plan.label}`;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,list_amount_minor,trade_in_minor,upgrade_from_subscription_id,duration_days,daily_credits,max_claims,timezone,
      method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,created_at,updated_at)
      SELECT ?,u.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM users u WHERE u.id=? AND u.is_guest=0
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=u.id AND expires_at>?) ON CONFLICT(user_id,request_id) DO NOTHING`)
      .bind(id, requestId, plan.id, plan.revision, plan.label, pricing.amountMinor, pricing.listAmountMinor, pricing.tradeInMinor, pricing.upgradeFromSubscriptionId, plan.durationDays, plan.dailyCredits, plan.maxClaims, plan.timezone,
        body.method, outTradeNo, env.ZPAY_PID!, channel, paymentName, `${ORIGIN}${CALLBACK}/checkout/${id}`, now, now, user.id, hash, now),
    env.DB.prepare(`INSERT INTO zpay_payment_bindings(out_trade_no,merchant_pid,provider_trade_no,subscription_order_id)
      SELECT out_trade_no,merchant_pid,provider_trade_no,id FROM subscription_orders WHERE user_id=? AND request_id=? ON CONFLICT(out_trade_no) DO NOTHING`).bind(user.id, requestId),
  ]);
  const order = await getOrder(env, user.id, undefined, requestId);
  if (!order) throw new ApiError(401, "登录状态已失效，请重新登录。");
  if (order.plan_id !== plan.id || order.plan_revision !== plan.revision || order.method !== body.method || order.merchant_pid !== env.ZPAY_PID
    || order.channel_id !== channel || order.amount_minor !== pricing.amountMinor || order.daily_credits !== plan.dailyCredits
    || (order.upgrade_from_subscription_id ?? null) !== pricing.upgradeFromSubscriptionId) throw new ApiError(409, "该请求编号已用于其他订阅方案，请重新确认。");
  return json({ ...context, modelBillingLinked: creditBillingConfig(env).enabled, accountId: user.id, order: orderValue(order, env), checkoutUrl: order.checkout_url }, results[0].meta.changes === 1 ? 201 : 200);
}
function getOrder(env: Env, userId: string | null, id?: string, requestId?: string) {
  return env.DB.prepare(`SELECT o.*,p.id AS subscription_id FROM subscription_orders o LEFT JOIN subscription_periods p ON p.order_id=o.id
    WHERE ${id ? "o.id=?" : "o.request_id=?"}${userId ? " AND o.user_id=?" : ""} AND o.provider='zpay'`)
    .bind(id ?? requestId!, ...(userId ? [userId] : [])).first<Order>();
}
function redirect(id?: string) { return new Response(null, { status: 303, headers: { Location: id ? `${ORIGIN}/?payment_order=${id}&payment=success#recharge` : `${ORIGIN}/#recharge`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
async function form(env: Env, user: UserRecord, id: string) {
  requireConfiguration(env);
  const order = await getOrder(env, user.id, id); if (!order) throw new ApiError(404, "订阅订单不存在。");
  if (order.merchant_pid !== env.ZPAY_PID || order.channel_id !== zpayChannel(env, order.method)) throw new ApiError(503, "该订单的支付通道已变更，请返回订阅页面。");
  if (order.paid_at !== null) return redirect(order.id);
  if (order.status !== "pending") throw new ApiError(409, "该订阅订单已关闭，请重新购买。");
  return renderZpayForm({ pid: order.merchant_pid, cid: order.channel_id, type: order.method, name: order.payment_name,
    money: `${Math.floor(order.amount_minor / 100)}.${String(order.amount_minor % 100).padStart(2, "0")}`,
    out_trade_no: order.out_trade_no, notify_url: `${ORIGIN}${CALLBACK}/notify`, return_url: `${ORIGIN}${CALLBACK}/return`, param: order.id, sign_type: "MD5" }, env.ZPAY_KEY!, "叙梦月卡订阅");
}

async function activate(env: Env, order: Order, fact: Parameters<typeof verifyZpayFact>[2], source: "notify" | "query", options: ZpayOptions) {
  await verifyZpayFact(env, order, fact);
  const eventId = `sp_evt_${createHash("sha256").update(JSON.stringify([source, order.id, fact.tradeNo, fact.pid, fact.amountMinor])).digest("hex")}`;
  const nonce = crypto.randomUUID(), now = nowFrom(options), gate = "EXISTS(SELECT 1 FROM subscription_events WHERE event_id=? AND processing_token=?)";
  const results = await env.DB.batch([
    bindZpayTrade(env, "subscription", order.id, order.out_trade_no, order.merchant_pid, fact.tradeNo),
    env.DB.prepare(`INSERT INTO subscription_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
      SELECT ?,?,id,?,?,? FROM subscription_orders WHERE id=? AND status IN ('pending','paid') AND (provider_trade_no IS NULL OR provider_trade_no=?)
      AND ${zpayBindingGate("subscription")} ON CONFLICT(event_id) DO NOTHING`).bind(eventId, source, fact.tradeNo, nonce, now, order.id, fact.tradeNo, fact.tradeNo),
    env.DB.prepare(`UPDATE subscription_orders SET provider_trade_no=COALESCE(provider_trade_no,?),status='paid',paid_at=COALESCE(paid_at,?),updated_at=MAX(updated_at,?)
      WHERE id=? AND ${gate}`).bind(fact.tradeNo, now, now, order.id, eventId, nonce),
    ...periodActivationStatements(env, {
      userId: order.user_id,
      orderId: order.id,
      upgradeFromSubscriptionId: order.upgrade_from_subscription_id ?? null,
      eventId,
      nonce,
      now,
    }),
  ]);
  if (!results[1].meta.changes) {
    const current = await getOrder(env, null, order.id);
    if (current?.provider_trade_no !== fact.tradeNo) throw new ApiError(400, "支付通道交易编号与订阅订单发生冲突。");
  }
}
async function notification(request: Request, env: Env, options: ZpayOptions, returning: boolean) {
  try {
    const parameters = zpayCallbackParameters(request, env), fact = zpayCallbackFact(parameters, SUBSCRIPTION_ORDER_ID);
    const order = await getOrder(env, null, fact.param); if (!order) throw new ApiError(400, "订阅支付订单不存在。");
    await verifyZpayFact(env, order, fact);
    if (returning) return parameters.trade_status === "TRADE_SUCCESS" ? redirect(order.id) : redirect();
    if (parameters.trade_status === "TRADE_SUCCESS") await activate(env, order, fact, "notify", options);
    return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { if (returning) return redirect(); throw error; }
}

async function checkin(request: Request, env: Env, user: UserRecord, options: ZpayOptions) {
  const body = await readJson(request, 2048); account(body, user, env);
  if (Object.keys(body).some(key => !["accountId", "subscriptionId", "requestId", "provider", "mode"].includes(key))
    || typeof body.subscriptionId !== "string" || !PERIOD_ID.test(body.subscriptionId) || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ApiError(400, "领取日期和点数只能由服务端确定，请刷新订阅状态。");
  const hash = sessionHash(request), nonce = crypto.randomUUID(), claimId = `sc_${crypto.randomUUID()}`;
  await rateLimit(request, env, "subscription-checkin-account", 90, user.id); await rateLimit(request, env, "subscription-checkin-ip", 300);
  const now = nowFrom(options), date = dayKey(now);
  // Production eligibility is checked at D1 execution time as well as after
  // async rate limits. The internal clock override is only for isolated tests.
  const mutationClock = options.now ? "?" : `MAX(?,${SQL_NOW_MS})`;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO subscription_daily_claims(id,user_id,subscription_id,request_id,day_key,credits,claimed_at,processing_token)
      SELECT ?,p.user_id,p.id,?,?,o.daily_credits,?,? FROM subscription_periods p JOIN subscription_orders o ON o.id=p.order_id JOIN users u ON u.id=p.user_id
      CROSS JOIN (SELECT ${mutationClock} AS checked_at) clock
      WHERE p.id=? AND p.user_id=? AND u.is_guest=0 AND p.revoked_at IS NULL AND p.starts_at<=clock.checked_at AND p.expires_at>clock.checked_at
      AND o.status='paid' AND (SELECT COUNT(*) FROM subscription_daily_claims c WHERE c.subscription_id=p.id)<o.max_claims
      AND ?=strftime('%Y-%m-%d',clock.checked_at/1000,'unixepoch','+8 hours')
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=u.id AND expires_at>clock.checked_at) ON CONFLICT DO NOTHING`)
      .bind(claimId, body.requestId.toLowerCase(), date, now, nonce, now, body.subscriptionId, user.id, date, hash),
    env.DB.prepare(`INSERT INTO subscription_credit_ledger(user_id,claim_id,kind,credits,created_at)
      SELECT user_id,id,'daily_grant',credits,claimed_at FROM subscription_daily_claims WHERE id=? AND processing_token=? ON CONFLICT(claim_id) DO NOTHING`).bind(claimId, nonce),
    env.DB.prepare(`SELECT ${mutationClock} AS server_time`).bind(now),
  ]);
  const committedTime = Number((results[2].results[0] as { server_time: number }).server_time);
  const overview = await readSubscriptions(env, user, Math.max(nowFrom(options), committedTime));
  if (overview.checkin.dayKey !== date) throw new ApiError(409, "领取日期已更新，请刷新后领取今日 金币。", { overview });
  const claim = await env.DB.prepare("SELECT id,subscription_id,day_key,credits,claimed_at FROM subscription_daily_claims WHERE user_id=? AND day_key=?").bind(user.id, date).first<Claim>();
  if (!claim || claim.subscription_id !== body.subscriptionId) throw new ApiError(409, claim ? "今日订阅点数已领取，请明天再来。" : "订阅已到期、领取次数已用完或状态已改变，请刷新后重试。", { overview });
  return json({ ...overview, claim: claimValue(claim) }, results[0].meta.changes === 1 ? 201 : 200);
}

export async function handleSubscriptions(request: Request, env: Env, suppliedUser?: UserRecord | null, options: ZpayOptions & GuaguaOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const callback = /^\/v1\/payments\/zpay\/subscription\/(notify|return)$/.exec(path);
  if (callback) { if (request.method !== "GET") throw new ApiError(405, "支付回调仅支持 GET。"); return notification(request, env, options, callback[1] === "return"); }
  const checkoutForm = /^\/v1\/payments\/zpay\/subscription\/checkout\/([^/]+)$/.exec(path);
  if (!checkoutForm && path !== "/v1/subscriptions" && !path.startsWith("/v1/subscriptions/")) return null;
  if (path === "/v1/subscriptions/config") { if (request.method !== "GET") throw new ApiError(405, "订阅配置仅支持 GET。"); return json(configuration(env)); }
  const user = suppliedUser ?? await requireUser(request, env); if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用订阅功能。");
  if (checkoutForm) { if (request.method !== "GET") throw new ApiError(405, "支付页面仅支持 GET。"); if (!SUBSCRIPTION_ORDER_ID.test(checkoutForm[1])) throw new ApiError(404, "订阅订单不存在。"); return form(env, user, checkoutForm[1]); }
  if (path === "/v1/subscriptions") { if (request.method !== "GET") throw new ApiError(405, "订阅状态仅支持 GET。"); return json(await readSubscriptions(env, user, nowFrom(options))); }
  if (path === "/v1/subscriptions/checkout") { if (request.method !== "POST") throw new ApiError(405, "购买订阅仅支持 POST。"); return checkout(request, env, user, options); }
  if (path === "/v1/subscriptions/checkin") { if (request.method !== "POST") throw new ApiError(405, "领取点数仅支持 POST。"); return checkin(request, env, user, options); }
  const receipt = /^\/v1\/subscriptions\/requests\/([^/]+)$/.exec(path);
  if (receipt) {
    if (request.method !== "GET") throw new ApiError(405, "订阅请求核对仅支持 GET。");
    if (!UUID.test(receipt[1])) throw new ApiError(400, "请提供有效的订阅请求编号。");
    const requestId = receipt[1].toLowerCase(), order = await getOrder(env, user.id, undefined, requestId);
    return json({ ...context, accountId: user.id, requestId, order: order ? orderValue(order, env) : null });
  }
  const detail = /^\/v1\/subscriptions\/orders\/([^/]+)$/.exec(path);
  if (detail) {
    if (request.method !== "GET") throw new ApiError(405, "订单状态仅支持 GET。");
    if (!SUBSCRIPTION_ORDER_ID.test(detail[1])) throw new ApiError(404, "订阅订单不存在。");
    let order = await getOrder(env, user.id, detail[1]); if (!order) throw new ApiError(404, "订阅订单不存在。");
    const vip = await readGuaguaVipByOrder(env, order.id, user.id);
    if (vip && order.paid_at === null && order.status === "pending" && guaguaVipReady(env)) {
      await rateLimit(request, env, "subscription-query-account", 120, user.id);
      const fact = await queryGuaguaPayment(env, vip.mer_order_tid, options);
      if (fact?.status === 1) { await fulfillGuaguaVip(env, vip, fact, "query", nowFrom(options)); order = (await getOrder(env, user.id, order.id))!; }
    } else if (order.paid_at === null && order.status === "pending" && zpayCredentialsConfigured(env)) {
      await rateLimit(request, env, "subscription-query-account", 120, user.id); const result = await queryZpayOrder(env, order, options);
      if (result?.paid) { await activate(env, order, result.fact, "query", options); order = (await getOrder(env, user.id, order.id))!; }
    }
    return json({ ...await readSubscriptions(env, user, nowFrom(options)), order: orderValue(order, env) });
  }
  throw new ApiError(404, "订阅接口不存在。");
}
