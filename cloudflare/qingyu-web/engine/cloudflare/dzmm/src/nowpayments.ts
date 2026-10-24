import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { digest, rateLimit, requireUser, tokenFrom } from "./auth";
import { ApiError, json, readJson } from "./http";
import { readSubscriptions } from "./subscriptions";
import type { Env, UserRecord } from "./types";

export type NowpaymentsOptions = { now?: () => number; nowpaymentsFetch?: typeof fetch };
const ORIGIN = "https://qingyu.invalid", API = "https://api.nowpayments.io/v1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORDER_ID = /^sp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const NETWORKS = new Set(["usdttrc20"]);
const STATUSES = new Set(["waiting", "confirming", "confirmed", "sending", "partially_paid", "finished", "failed", "refunded", "expired"]);
export const NOWPAYMENTS_PLAN = Object.freeze({ id: "vip_quarterly", label: "晴屿 VIP 季卡", revision: 1, amountAtomic: 15_000_000,
  currency: "usdt", decimals: 6, durationDays: 90, dailyCredits: 500, maxClaims: 90, timezone: "Asia/Shanghai" });
const context = { provider: "nowpayments", mode: "live", renewal: "manual", autoRenew: false } as const;
type Row = { id: string; user_id: string; request_id: string; plan_id: string; plan_revision: number; label: string;
  amount_minor: number; amount_scale: number; currency: string; duration_days: number; daily_credits: number; max_claims: number; timezone: string;
  status: string; checkout_url: string; created_at: number; updated_at: number; paid_at: number | null; subscription_id: string | null;
  invoice_id: string | null; payment_id: string | null; pay_currency: string; pay_address: string | null; pay_amount: string | null; creation_state: string; provider_status: string | null };
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const now = (options: NowpaymentsOptions) => (options.now ?? Date.now)();
const secret = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{16,512}$/.test(value);
function credentials(env: Env) { return secret(env.NOWPAYMENTS_API_KEY) && secret(env.NOWPAYMENTS_IPN_SECRET); }
function configuration(env: Env) {
  const network = NETWORKS.has(env.NOWPAYMENTS_PAY_CURRENCY ?? "") ? env.NOWPAYMENTS_PAY_CURRENCY! : null;
  const enabled = env.NOWPAYMENTS_ENABLED === "true" && credentials(env) && !!network;
  return { ...context, enabled, payCurrency: network, network: network ? "TRON (TRC20)" : null, plans: [NOWPAYMENTS_PLAN],
    note: enabled ? "每次手动支付 15 USDT 开通或续期 90 天；北京时间每日领取 500 Credit，每期最多 90 次，漏领不补。下单前核对实时最低收款额；网络手续费以钱包为准，不会自动扣款。"
      : "USDT 收款尚未完成商户配置，暂未开放支付；已有会员权益仍保留。" };
}
function requireConfiguration(env: Env) {
  const config = configuration(env);
  if (!config.enabled) throw new ApiError(503, config.note);
  return config;
}
function id(value: unknown): string {
  const result = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^[1-9]\d{0,29}$/.test(result)) throw new ApiError(502, "收款服务返回的编号无效。");
  return result;
}
function decimal(value: unknown): bigint {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,18})?$/.test(text)) throw new ApiError(502, "收款服务返回的金额无效。");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}
/** Decimal text from trusted order atoms; no float rounding or active-plan repricing. */
function orderAmount(row: Pick<Row, "currency" | "amount_minor" | "amount_scale">): string {
  if (row.currency !== "usdt" || row.amount_scale !== 6 || !Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0)
    throw new ApiError(400, "原会员订单金额无效，未开通会员。");
  const atoms = BigInt(row.amount_minor), scale = 10n ** BigInt(row.amount_scale);
  return `${atoms / scale}.${String(atoms % scale).padStart(row.amount_scale, "0")}`.replace(/\.?0+$/, "");
}
async function requireMinimum(env: Env, options: NowpaymentsOptions, payCurrency: string, amount: string) {
  let minimum: bigint, minimumAmount: string;
  try {
    const params = new URLSearchParams({ currency_from: payCurrency, currency_to: payCurrency,
      is_fixed_rate: "false", is_fee_paid_by_user: "false" });
    const response = await api(env, options, `/min-amount?${params}`);
    for (const field of ["currency_from", "currency_to"])
      if (Object.prototype.hasOwnProperty.call(response, field) && response[field] !== payCurrency) throw new Error();
    minimum = decimal(response.min_amount);
    if (minimum <= 0n) throw new Error();
    minimumAmount = String(response.min_amount);
  } catch {
    throw new ApiError(503, "暂时无法核对 USDT 最低收款额，尚未创建订单，请稍后再试。", { code: "nowpayments_minimum_unavailable" });
  }
  if (minimum > decimal(amount)) throw new ApiError(503, "当前 USDT 最低收款额超过套餐金额，尚未创建订单，请稍后再试。",
    { code: "nowpayments_minimum_exceeds_plan", minimumAmount, payCurrency });
}
function address(value: unknown, currency: string): string {
  if (typeof value !== "string" || (currency === "usdttrc20" ? !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)
    : currency === "usdtsol" ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) : !/^0x[a-fA-F0-9]{40}$/.test(value)))
    throw new ApiError(502, "收款服务返回的网络地址无效。");
  return value;
}
function toOrder(row: Row) {
  return { ...context, id: row.id, accountId: row.user_id, requestId: row.request_id, planId: row.plan_id, planRevision: row.plan_revision, label: row.label,
    amountAtomic: row.amount_minor, decimals: row.amount_scale, currency: row.currency,
    durationDays: row.duration_days, dailyCredits: row.daily_credits, maxClaims: row.max_claims, timezone: row.timezone,
    payCurrency: row.pay_currency, network: "TRON (TRC20)", payAddress: row.pay_address, payAmount: row.pay_amount, quoteExpiresAt: null, invoiceId: row.invoice_id, paymentId: row.payment_id,
    status: row.paid_at !== null ? row.status : row.creation_state === "creating" || row.creation_state === "unknown" ? row.creation_state : row.status,
    providerStatus: row.provider_status, checkoutUrl: row.checkout_url || null, createdAt: row.created_at, updatedAt: row.updated_at, paidAt: row.paid_at,
    subscriptionId: row.subscription_id, membershipActivated: row.paid_at !== null && row.subscription_id !== null };
}
function getOrder(env: Env, owner: string | null, orderId?: string, requestId?: string) {
  return env.DB.prepare(`SELECT o.*,i.invoice_id,i.payment_id,i.pay_currency,i.creation_state,i.provider_status,i.pay_address,i.pay_amount,p.id AS subscription_id
    FROM subscription_orders o JOIN nowpayments_invoices i ON i.order_id=o.id LEFT JOIN subscription_periods p ON p.order_id=o.id
    WHERE o.provider='nowpayments' AND ${orderId ? "o.id=?" : "o.request_id=?"}${owner ? " AND o.user_id=?" : ""}`)
    .bind(orderId ?? requestId!, ...(owner ? [owner] : [])).first<Row>();
}
async function api(env: Env, options: NowpaymentsOptions, path: string, body?: Obj, timeoutMs = 8000): Promise<Obj> {
  if (!secret(env.NOWPAYMENTS_API_KEY)) throw new ApiError(503, "收款账户尚未配置完成。");
  let response: Response;
  try { response = await (options.nowpaymentsFetch ?? fetch)(`${API}${path}`, { method: body ? "POST" : "GET",
    headers: { "x-api-key": env.NOWPAYMENTS_API_KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual", signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new ApiError(503, "收款结果暂未确认，请恢复原订单核对，不要重复付款。", { outcome: "unknown" }); }
  if (!response.ok) { await response.body?.cancel(); throw new ApiError(503, "收款服务暂时不可用，请恢复原订单核对。",
    { outcome: body && [400, 401, 403, 422].includes(response.status) ? "rejected" : "unknown" }); }
  const bytes = await limitedBody(response);
  try { const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); if (!object(parsed)) throw new Error(); return parsed; }
  catch { throw new ApiError(502, "收款服务返回了无效数据，请恢复原订单核对。", { outcome: "unknown" }); }
}
async function limitedBody(value: Request | Response) {
  if (Number(value.headers.get("Content-Length")) > 256 * 1024 || !value.body) throw new ApiError(413, "收款请求体无效。");
  const reader = value.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new ApiError(413, "收款请求过大。"); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
/** Provider protocol: recursively sort object keys, preserve array order, then JSON.stringify. */
export function canonicalNowpayments(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new ApiError(400, "付款通知层级无效。");
  if (Array.isArray(value)) return value.map(item => canonicalNowpayments(item, depth + 1));
  if (object(value)) { const sorted: Obj = Object.create(null); for (const key of Object.keys(value).sort()) sorted[key] = canonicalNowpayments(value[key], depth + 1); return sorted; }
  return value;
}
export async function verifyNowpaymentsIpn(request: Request, env: Env): Promise<Obj> {
  if (!secret(env.NOWPAYMENTS_IPN_SECRET)) throw new ApiError(503, "付款通知尚未配置完成。");
  const signature = request.headers.get("x-nowpayments-sig") ?? "";
  if (!/^[a-f0-9]{128}$/i.test(signature)) throw new ApiError(400, "付款通知签名无效。");
  const bytes = await limitedBody(request); let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { throw new ApiError(400, "付款通知格式无效。"); }
  if (!object(body)) throw new ApiError(400, "付款通知格式无效。");
  const expected = createHmac("sha512", env.NOWPAYMENTS_IPN_SECRET).update(JSON.stringify(canonicalNowpayments(body))).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new ApiError(400, "付款通知签名无效。");
  return body;
}
function verifyFact(value: Obj, row: Row, expectedPaymentId?: string): { paymentId: string; status: string } {
  const paymentId = id(value.payment_id), status = String(value.payment_status);
  // Verify the immutable order snapshot, including historical 5 USDT / 30 day
  // receipts. price_currency=usd is the provider's auxiliary estimate only.
  const amount = orderAmount(row);
  if (value.order_id !== row.id || value.price_currency !== "usd" || decimal(value.price_amount) !== decimal(amount)
    || value.pay_currency !== row.pay_currency || decimal(value.pay_amount) !== decimal(amount)
    || address(value.pay_address, row.pay_currency) !== value.pay_address
    || (row.pay_address !== null && row.pay_address !== value.pay_address) || (row.payment_id !== null && row.payment_id !== paymentId)
    || (expectedPaymentId !== undefined && expectedPaymentId !== paymentId) || !STATUSES.has(status)) throw new ApiError(400, "付款记录与原会员订单不一致，未开通会员。");
  if (status === "finished" && decimal(value.actually_paid) < decimal(amount))
    throw new ApiError(400, "付款金额尚未完整确认，未开通会员。");
  return { paymentId, status };
}
async function settle(env: Env, row: Row, value: Obj, options: NowpaymentsOptions, source: "notify" | "query") {
  const fact = verifyFact(value, row), timestamp = now(options), nonce = crypto.randomUUID();
  const eventId = `np_evt_${createHash("sha256").update(JSON.stringify([row.id, fact.paymentId, "finished"])).digest("hex")}`;
  const gate = "EXISTS(SELECT 1 FROM subscription_events WHERE event_id=? AND processing_token=?)";
  const bound = "EXISTS(SELECT 1 FROM nowpayments_payment_bindings b WHERE b.payment_id=? AND b.order_id=?)";
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO nowpayments_payment_bindings(payment_id,order_id,verified_at)
      VALUES(?,?,?) ON CONFLICT DO NOTHING`).bind(fact.paymentId, row.id, timestamp),
    env.DB.prepare(`UPDATE nowpayments_invoices SET payment_id=COALESCE(payment_id,?),
      creation_state='ready',provider_status=CASE WHEN provider_status='finished' THEN provider_status ELSE ? END,pay_address=?,pay_amount=?,
      actually_paid=CASE WHEN provider_status='finished' AND ?<>'finished' THEN actually_paid ELSE ? END,
      outcome_amount=CASE WHEN provider_status='finished' AND ?<>'finished' THEN outcome_amount ELSE COALESCE(?,outcome_amount) END,
      outcome_currency=CASE WHEN provider_status='finished' AND ?<>'finished' THEN outcome_currency ELSE COALESCE(?,outcome_currency) END,updated_at=MAX(updated_at,?)
      WHERE order_id=? AND (payment_id IS NULL OR payment_id=?) AND ${bound}`)
      .bind(fact.paymentId, fact.status, value.pay_address, String(value.pay_amount), fact.status, value.actually_paid === undefined ? null : String(value.actually_paid),
        fact.status, value.outcome_amount == null ? null : String(value.outcome_amount), fact.status, value.outcome_currency == null ? null : String(value.outcome_currency), timestamp, row.id,
        fact.paymentId, fact.paymentId, row.id),
    env.DB.prepare(`INSERT INTO subscription_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
      SELECT ?,?,o.id,?,?,? FROM subscription_orders o JOIN nowpayments_invoices i ON i.order_id=o.id
      WHERE o.id=? AND o.provider='nowpayments' AND ?='finished' AND i.payment_id=? AND ${bound}
      ON CONFLICT(event_id) DO NOTHING`).bind(eventId, source, `np_${fact.paymentId}`, nonce, timestamp, row.id, fact.status, fact.paymentId, fact.paymentId, row.id),
    env.DB.prepare(`UPDATE subscription_orders SET status=CASE WHEN paid_at IS NOT NULL THEN status WHEN ${gate} THEN 'paid' WHEN ? IN ('failed','expired') THEN ? ELSE status END,
      paid_at=CASE WHEN ${gate} THEN COALESCE(paid_at,?) ELSE paid_at END,updated_at=MAX(updated_at,?) WHERE id=? AND ${bound}`)
      .bind(eventId, nonce, fact.status, fact.status, eventId, nonce, timestamp, timestamp, row.id, fact.paymentId, row.id),
    env.DB.prepare(`INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at)
      SELECT ?,o.user_id,o.id,?,MAX(?,COALESCE((SELECT MAX(expires_at) FROM subscription_periods WHERE user_id=o.user_id AND revoked_at IS NULL),?)),
        MAX(?,COALESCE((SELECT MAX(expires_at) FROM subscription_periods WHERE user_id=o.user_id AND revoked_at IS NULL),?))+o.duration_days*86400000,?
      FROM subscription_orders o WHERE o.id=? AND o.provider='nowpayments' AND o.paid_at IS NOT NULL AND ${gate} ON CONFLICT(order_id) DO NOTHING`)
      .bind(`sub_${crypto.randomUUID()}`, eventId, timestamp, timestamp, timestamp, timestamp, timestamp, row.id, eventId, nonce),
  ]);
  if (result[1].meta.changes !== 1) throw new ApiError(400, "付款编号已用于其他订单，未重复开通会员。");
}
async function checkout(request: Request, env: Env, user: UserRecord, options: NowpaymentsOptions) {
  const config = requireConfiguration(env), body = await readJson(request, 2048);
  if (Object.keys(body).some(key => !["accountId", "planId", "planRevision", "requestId", "provider", "mode", "payCurrency"].includes(key))
    || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ApiError(400, "请提供有效会员购买请求；价格与权益由服务器确定。");
  if (body.accountId !== user.id) throw new ApiError(409, "账户已切换，请重新打开会员页面。");
  if (body.provider !== "nowpayments" || body.mode !== "live" || body.payCurrency !== config.payCurrency)
    throw new ApiError(409, "会员方案或支付网络已改变，请重新确认。");
  const token = tokenFrom(request); if (!token) throw new ApiError(401, "请重新登录。");
  const hash = await digest(token), requestId = body.requestId.toLowerCase();
  await rateLimit(request, env, "nowpayments-checkout-account", 30, user.id); await rateLimit(request, env, "nowpayments-checkout-ip", 120);
  const valid = await env.DB.prepare("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND s.token_hash=? AND s.expires_at>? AND u.is_guest=0 AND COALESCE(u.is_demo,0)=0")
    .bind(user.id, hash, now(options)).first();
  if (!valid) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const existing = await getOrder(env, user.id, undefined, requestId);
  if (existing) {
    if (existing.plan_id !== body.planId || existing.plan_revision !== body.planRevision || existing.pay_currency !== body.payCurrency)
      throw new ApiError(409, "原请求已用于其他方案或网络，请恢复原订单。");
    return json({ ...context, accountId: user.id, requestId, order: toOrder(existing), checkoutUrl: existing.checkout_url || null });
  }
  if (body.planId !== NOWPAYMENTS_PLAN.id || body.planRevision !== NOWPAYMENTS_PLAN.revision)
    throw new ApiError(409, "会员方案已改变，请重新确认。");
  const unresolved = await env.DB.prepare("SELECT 1 FROM subscription_orders o JOIN nowpayments_invoices i ON i.order_id=o.id WHERE o.user_id=? AND i.creation_state IN ('creating','unknown')")
    .bind(user.id).first();
  if (unresolved) throw new ApiError(409, "已有收款创建结果尚未确认，请先恢复原订单，不要重复开单。");
  // Check before persisting either order or invoice. A provider outage, malformed
  // minimum or threshold above this plan must not leave a payable local order.
  await requireMinimum(env, options, config.payCurrency!, orderAmount({ currency: NOWPAYMENTS_PLAN.currency,
    amount_minor: NOWPAYMENTS_PLAN.amountAtomic, amount_scale: NOWPAYMENTS_PLAN.decimals }));
  const timestamp = now(options), orderId = `sp_${crypto.randomUUID()}`, claim = crypto.randomUUID();
  const outTrade = String(randomInt(1, 10)) + Array.from({ length: 31 }, () => String(randomInt(0, 10))).join("");
  const inserted = await env.DB.batch([
    env.DB.prepare(`INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,currency,duration_days,daily_credits,max_claims,timezone,
      method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,created_at,updated_at,provider,amount_scale)
      SELECT ?,u.id,?,?,?,?,?,?,?,?,?,?,'usdt',?,NULL,NULL,?,'',?,?,'nowpayments',?
      FROM users u WHERE u.id=? AND u.is_guest=0 AND COALESCE(u.is_demo,0)=0
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=u.id AND expires_at>${options.now ? '?' : "MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))"})
      AND NOT EXISTS(SELECT 1 FROM subscription_orders x JOIN nowpayments_invoices i ON i.order_id=x.id WHERE x.user_id=u.id AND i.creation_state IN ('creating','unknown'))
      ON CONFLICT(user_id,request_id) DO NOTHING`).bind(orderId, requestId, NOWPAYMENTS_PLAN.id, NOWPAYMENTS_PLAN.revision, NOWPAYMENTS_PLAN.label, NOWPAYMENTS_PLAN.amountAtomic,
        NOWPAYMENTS_PLAN.currency, NOWPAYMENTS_PLAN.durationDays, NOWPAYMENTS_PLAN.dailyCredits, NOWPAYMENTS_PLAN.maxClaims, NOWPAYMENTS_PLAN.timezone,
        outTrade, "晴屿 VIP · 15 USDT / 90 天", timestamp, timestamp, NOWPAYMENTS_PLAN.decimals, user.id, hash, timestamp),
    env.DB.prepare(`INSERT INTO nowpayments_invoices(order_id,pay_currency,creation_state,creation_token,created_at,updated_at)
      SELECT id,?,'creating',?,?,? FROM subscription_orders WHERE id=? AND provider='nowpayments' ON CONFLICT(order_id) DO NOTHING`)
      .bind(config.payCurrency, claim, timestamp, timestamp, orderId),
  ]);
  let row = await getOrder(env, user.id, undefined, requestId);
  if (!row) {
    const valid = await env.DB.prepare("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND s.token_hash=? AND s.expires_at>? AND u.is_guest=0 AND u.is_demo=0").bind(user.id, hash, now(options)).first();
    if (!valid) throw new ApiError(401, "登录状态已失效，请重新登录。");
    throw new ApiError(409, "已有收款创建结果尚未确认，请先恢复原订单，不要重复开单。");
  }
  if (row.plan_id !== body.planId || row.plan_revision !== body.planRevision || row.pay_currency !== config.payCurrency) throw new ApiError(409, "原请求已用于其他方案或网络，请恢复原订单。");
  if (inserted[0].meta.changes === 1 && inserted[1].meta.changes === 1) {
    try {
      const amount = orderAmount(row);
      const response = await api(env, options, "/payment", { price_amount: Number(amount), price_currency: "usd", pay_amount: Number(amount), pay_currency: row.pay_currency, order_id: row.id,
        is_fixed_rate: false, is_fee_paid_by_user: false,
        order_description: `晴屿 VIP · ${amount} USDT / ${row.duration_days} 天`, ipn_callback_url: `${ORIGIN}/api/payments/nowpayments/ipn` });
      const fact = verifyFact(response, row);
      const checkoutUrl = `${ORIGIN}/?np_order=${row.id}#recharge`;
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO nowpayments_payment_bindings(payment_id,order_id,verified_at) VALUES(?,?,?) ON CONFLICT DO NOTHING`).bind(fact.paymentId, row.id, timestamp),
        env.DB.prepare(`UPDATE nowpayments_invoices SET payment_id=?,pay_address=?,pay_amount=?,provider_status=?,creation_state='ready',updated_at=MAX(updated_at,?)
          WHERE order_id=? AND creation_token=? AND creation_state='creating' AND (payment_id IS NULL OR payment_id=?)
          AND EXISTS(SELECT 1 FROM nowpayments_payment_bindings WHERE payment_id=? AND order_id=?)`)
          .bind(fact.paymentId, response.pay_address, amount, fact.status, timestamp, row.id, claim, fact.paymentId, fact.paymentId, row.id),
        env.DB.prepare(`UPDATE subscription_orders SET checkout_url=?,updated_at=MAX(updated_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM nowpayments_invoices WHERE order_id=? AND payment_id=? AND creation_state='ready')`)
          .bind(checkoutUrl, timestamp, row.id, row.id, fact.paymentId),
      ]);
    } catch (failure) {
      const rejected = failure instanceof ApiError && failure.details?.outcome === "rejected";
      await env.DB.batch([
        env.DB.prepare(`UPDATE nowpayments_invoices SET creation_state=?,updated_at=MAX(updated_at,?) WHERE order_id=? AND creation_token=? AND creation_state='creating'`).bind(rejected ? "rejected" : "unknown", now(options), row.id, claim),
        env.DB.prepare(`UPDATE subscription_orders SET status=CASE WHEN ?=1 THEN 'failed' ELSE status END,updated_at=MAX(updated_at,?) WHERE id=? AND paid_at IS NULL`).bind(Number(rejected), now(options), row.id),
      ]);
      // If D1's successful invoice commit lost its acknowledgement, its stored
      // ready receipt wins. Never erase it or repeat provider creation.
    }
    row = (await getOrder(env, user.id, row.id))!;
  }
  return json({ ...context, accountId: user.id, requestId, order: toOrder(row), checkoutUrl: row.checkout_url || null }, inserted[0].meta.changes === 1 ? 201 : 200);
}
async function notification(request: Request, env: Env, options: NowpaymentsOptions) {
  const supplied = await verifyNowpaymentsIpn(request, env), orderId = supplied.order_id;
  if (typeof orderId !== "string" || !ORDER_ID.test(orderId)) throw new ApiError(400, "付款通知订单无效。");
  const row = await getOrder(env, null, orderId); if (!row) throw new ApiError(400, "付款通知订单不存在。");
  const suppliedFact = verifyFact(supplied, row);
  // Already bound, fully signed facts do not wait on another provider HTTP
  // call. An unknown creation is recovered only by an authenticated short GET.
  const current = row.payment_id !== null ? supplied : await api(env, options, `/payment/${suppliedFact.paymentId}`, undefined, 1500);
  verifyFact(current, row, suppliedFact.paymentId);
  if (suppliedFact.status !== "finished" && current.payment_status === "finished") return json({ received: true, processed: false });
  await settle(env, row, current, options, "notify");
  return json({ received: true, processed: current.payment_status === "finished" });
}
export async function handleNowpayments(request: Request, env: Env, suppliedUser?: UserRecord | null, options: NowpaymentsOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/payments/nowpayments/ipn") { if (request.method !== "POST") throw new ApiError(405, "付款通知仅支持 POST。"); return notification(request, env, options); }
  if (!path.startsWith("/v1/nowpayments/")) return null;
  if (path === "/v1/nowpayments/config") { if (request.method !== "GET") throw new ApiError(405, "收款配置仅支持 GET。"); return json(configuration(env)); }
  const user = suppliedUser ?? await requireUser(request, env); if (user.isGuest) throw new ApiError(403, "请先注册并登录正式账户。");
  if (path === "/v1/nowpayments/checkout") { if (request.method !== "POST") throw new ApiError(405, "会员购买仅支持 POST。"); return checkout(request, env, user, options); }
  const receipt = /^\/v1\/nowpayments\/requests\/([^/]+)$/.exec(path);
  if (receipt) { if (request.method !== "GET") throw new ApiError(405, "订单恢复仅支持 GET。"); if (!UUID.test(receipt[1])) throw new ApiError(400, "请求编号无效。");
    const requestId = receipt[1].toLowerCase(), row = await getOrder(env, user.id, undefined, requestId);
    return json({ ...context, accountId: user.id, requestId, order: row ? toOrder(row) : null }); }
  const detail = /^\/v1\/nowpayments\/orders\/([^/]+)$/.exec(path);
  if (detail) { if (request.method !== "GET") throw new ApiError(405, "订单核对仅支持 GET。"); if (!ORDER_ID.test(detail[1])) throw new ApiError(404, "订单不存在。");
    let row = await getOrder(env, user.id, detail[1]); if (!row) throw new ApiError(404, "订单不存在。");
    if (row.payment_id && row.paid_at === null && secret(env.NOWPAYMENTS_API_KEY)) {
      await rateLimit(request, env, "nowpayments-query-account", 60, user.id);
      await settle(env, row, await api(env, options, `/payment/${row.payment_id}`), options, "query");
      row = (await getOrder(env, user.id, row.id))!;
    }
    return json({ ...context, accountId: user.id, order: toOrder(row) }); }
  if (path === "/v1/nowpayments/membership") { if (request.method !== "GET") throw new ApiError(405, "会员状态仅支持 GET。"); return json(await readSubscriptions(env, user, now(options))); }
  throw new ApiError(404, "USDT 会员接口不存在。");
}
