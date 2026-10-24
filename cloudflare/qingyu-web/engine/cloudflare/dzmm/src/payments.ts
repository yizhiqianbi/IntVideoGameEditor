import { rateLimit, requireUser } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";
import { handleGuaguaPayments, GUAGUA_ORDER_ID } from "./guagua";
import { handleZpayPayments, ZPAY_ORDER_ID } from "./zpay";
import { liveWallet } from "./payment-wallet";
import { creditBillingConfig } from "./credit-usage";
import { PAYMENT_PAUSED_NOTE, paymentCollectionEnabled, requirePaymentCollection } from "./payment-availability";

export type PaymentEnvironment = Env & {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_TEST_SECRET_KEY?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string;
  STRIPE_LIVE_SECRET_KEY?: string;
  STRIPE_LIVE_WEBHOOK_SECRET?: string;
  STRIPE_LIVE_ACCOUNT_ID?: string;
  STRIPE_PAYMENT_MODE?: string;
  PAYMENTS_RETURN_ORIGIN?: string;
};
export type PaymentOptions = {
  stripeFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  zpayFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  guaguaFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};
const PACKAGES = [
  { id: "usd_1", amountMinor: 100, currency: "usd", credits: 100 },
  { id: "usd_5", amountMinor: 500, currency: "usd", credits: 500 },
  { id: "usd_10", amountMinor: 1000, currency: "usd", credits: 1000 },
] as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORDER_ID = /^pay_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES = 256 * 1024;
const SESSION_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"]);
const REFUND_EVENTS = new Set(["charge.refunded", "refund.created", "refund.updated", "refund.failed"]);
type Row = {
  id: string; user_id: string; request_id: string; package_id: string; amount_minor: number; currency: "usd";
  credits: number; mode: PaymentMode; status: string; stripe_session_id: string | null; stripe_payment_intent_id: string | null;
  checkout_url: string | null; refunded_amount_minor: number; refunded_credits: number; created_at: number; updated_at: number; paid_at: number | null;
};
type ObjectValue = Record<string, unknown>;
type PaymentMode = "test" | "live";
type StripeCredentials = { mode: PaymentMode; key: string; webhookSecret: string };
type RefundFact = { id: string; amount: number; succeeded: number; failed: number };
function record(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "支付服务返回了无效的数据。");
  return value as ObjectValue;
}
function stripeId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}[A-Za-z0-9]{1,180}$`).test(value)) throw new ApiError(502, "支付服务返回了无效的编号。");
  return value;
}
function objectId(value: unknown, prefix: string): string {
  return stripeId(typeof value === "object" && value ? record(value).id : value, prefix);
}
function integer(value: unknown, maximum = 1000000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new ApiError(502, "支付服务返回了无效的金额。");
  return value;
}
function paymentMode(env: PaymentEnvironment): PaymentMode {
  const mode = env.STRIPE_PAYMENT_MODE ?? "test";
  if (mode !== "test" && mode !== "live") throw new ApiError(503, "充值支付模式尚未配置正确。");
  return mode;
}
function credentialsForMode(env: PaymentEnvironment, mode: PaymentMode): StripeCredentials | null {
  const prefix = `sk_${mode}_`;
  // Generic credentials remain compatible with existing test deployments. A
  // credential from another mode must never be paired with its webhook secret.
  const primaryMatches = env.STRIPE_SECRET_KEY?.startsWith(prefix);
  const key = (mode === "live" ? env.STRIPE_LIVE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY)
    ?? (primaryMatches ? env.STRIPE_SECRET_KEY : undefined);
  const webhookSecret = (mode === "live" ? env.STRIPE_LIVE_WEBHOOK_SECRET : env.STRIPE_TEST_WEBHOOK_SECRET)
    ?? (primaryMatches ? env.STRIPE_WEBHOOK_SECRET : undefined);
  if (!key?.startsWith(prefix) || key.length <= prefix.length || !webhookSecret?.startsWith("whsec_") || webhookSecret.length <= 6) return null;
  return { mode, key, webhookSecret };
}
function configured(env: PaymentEnvironment): boolean {
  try {
    const mode = paymentMode(env);
    return Boolean(credentialsForMode(env, mode))
      && (mode === "test" || /^acct_[A-Za-z0-9]{1,180}$/.test(env.STRIPE_LIVE_ACCOUNT_ID ?? ""));
  } catch { return false; }
}
function requireConfiguration(env: PaymentEnvironment): PaymentMode {
  requirePaymentCollection(env);
  const mode = paymentMode(env);
  if (!configured(env)) throw new ApiError(503, mode === "live" ? "Stripe 正式充值尚未配置完成，请稍后再试。" : "Stripe 测试充值尚未配置完成，请稍后再试。");
  return mode;
}
function toOrder(row: Row) {
  return { id: row.id, accountId: row.user_id, packageId: row.package_id, amountMinor: row.amount_minor,
    currency: row.currency, credits: row.credits, refundedCredits: row.refunded_credits, refundedAmountMinor: row.refunded_amount_minor,
    status: row.status, mode: row.mode, provider: "stripe", createdAt: row.created_at, updatedAt: row.updated_at, paidAt: row.paid_at, checkoutUrl: row.checkout_url };
}
function returnOrigin(env: PaymentEnvironment): string {
  const input = env.PAYMENTS_RETURN_ORIGIN ?? "https://qingyu.invalid";
  let url: URL;
  try { url = new URL(input); } catch { throw new ApiError(503, "充值返回地址尚未配置正确。"); }
  const allowed = url.origin === "https://qingyu.invalid"
    || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  if (!allowed || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new ApiError(503, "充值返回地址尚未配置正确。");
  return url.origin;
}
function checkoutUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new ApiError(502, "支付服务未提供有效的收银台地址。");
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(502, "支付服务未提供有效的收银台地址。"); }
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port) throw new ApiError(502, "支付服务未提供有效的收银台地址。");
  return value;
}
async function limitedBytes(value: Request | Response): Promise<Uint8Array> {
  if (Number(value.headers.get("Content-Length")) > MAX_BYTES) throw new ApiError(413, "支付请求过大。");
  if (!value.body) throw new ApiError(400, "支付请求体不能为空。");
  const reader = value.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new ApiError(413, "支付请求过大。"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}
async function stripeApi(env: PaymentEnvironment, options: PaymentOptions, mode: PaymentMode, path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<ObjectValue> {
  const credentials = credentialsForMode(env, mode);
  if (!credentials) throw new ApiError(503, "该支付模式的 Stripe 凭据尚未配置完成。");
  const headers = new Headers({ Authorization: `Bearer ${credentials.key}`, Accept: "application/json" });
  if (body) headers.set("Content-Type", "application/x-www-form-urlencoded");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  let response: Response;
  try {
    response = await (options.stripeFetch ?? fetch)(`https://api.stripe.com/v1${path}`, {
      method: body ? "POST" : "GET", body: body?.toString(), headers, redirect: "manual", signal: AbortSignal.timeout(8000),
    });
  } catch { throw new ApiError(503, "支付服务暂时不可用，请使用同一充值请求重试。"); }
  if (!response.ok) { await response.body?.cancel(); throw new ApiError(503, "支付服务暂时不可用，请使用同一充值请求重试。"); }
  const bytes = await limitedBytes(response);
  try { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, "支付服务返回了无效的数据。"); }
}
function verifySession(session: ObjectValue, order: Row): string {
  const id = stripeId(session.id, `cs_${order.mode}_`);
  const metadata = record(session.metadata);
  if (session.object !== "checkout.session" || session.livemode !== (order.mode === "live") || session.mode !== "payment"
    || session.currency !== order.currency || session.amount_total !== order.amount_minor
    || session.client_reference_id !== order.id || metadata.app !== "xumeng" || metadata.order_id !== order.id
    || metadata.user_id !== order.user_id || metadata.package_id !== order.package_id || metadata.credits !== String(order.credits)
    || (order.stripe_session_id && order.stripe_session_id !== id)) throw new ApiError(400, "Stripe 订单与本站充值记录不一致，未发放充值点数。");
  return id;
}
async function createCheckout(request: Request, env: PaymentEnvironment, user: UserRecord, options: PaymentOptions): Promise<Response> {
  const body = await readJson(request, 2048);
  if (body.accountId !== user.id) throw new ApiError(401, "账户已切换，请刷新充值页面后重试。");
  if (Object.keys(body).some(key => !["packageId", "accountId", "requestId", "mode", "provider"].includes(key))) throw new ApiError(400, "充值金额和充值点数只能由服务端确定。");
  if (body.provider !== undefined && body.provider !== "stripe") throw new ApiError(409, "支付通道已切换，请刷新充值页面后重试。");
  const pack = PACKAGES.find(item => item.id === body.packageId);
  if (!pack || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ApiError(400, "请选择有效套餐并提供充值请求编号。");
  const mode = requireConfiguration(env);
  if (body.mode !== mode) throw new ApiError(409, "充值支付模式已切换，请刷新充值页面后重试。");
  const origin = returnOrigin(env);
  await rateLimit(request, env, "payment-checkout-account", 60, user.id);
  await rateLimit(request, env, "payment-checkout-ip", 300);
  const now = (options.now ?? Date.now)();
  const requestId = body.requestId.toLowerCase();
  const inserted = await env.DB.prepare(`INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,created_at,updated_at)
    SELECT ?,id,?,?,?,?,?,?,? FROM users WHERE id=? AND is_guest=0 ON CONFLICT(user_id,mode,request_id) DO NOTHING`)
    .bind(`pay_${crypto.randomUUID()}`, requestId, pack.id, pack.amountMinor, pack.credits, mode, now, now, user.id).run();
  let order = await env.DB.prepare("SELECT * FROM payment_orders WHERE user_id=? AND mode=? AND request_id=?").bind(user.id, mode, requestId).first<Row>();
  if (!order) throw new ApiError(403, "请使用正式账户充值。");
  if (order.package_id !== pack.id) throw new ApiError(409, "该请求编号已用于其他充值套餐。");
  if (!order.stripe_session_id) {
    // Stripe may prune idempotency keys after 24h. An uncertain old creation is
    // deliberately held for reconciliation rather than risking a second session.
    if (now - order.created_at > 23 * 60 * 60 * 1000) throw new ApiError(409, "该充值请求需要核对支付状态，请联系管理员，不要重复支付。");
    if (mode === "live") {
      const account = await stripeApi(env, options, mode, "/account");
      if (account.object !== "account" || account.id !== env.STRIPE_LIVE_ACCOUNT_ID || account.charges_enabled !== true || account.details_submitted !== true)
        throw new ApiError(503, "Stripe 正式账户尚未开通收款，请稍后再试。");
    }
    const parameters = new URLSearchParams({ mode: "payment", client_reference_id: order.id, allow_promotion_codes: "false", "managed_payments[enabled]": "false",
      "automatic_tax[enabled]": "false", "adaptive_pricing[enabled]": "false", "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": order.currency, "line_items[0][price_data][unit_amount]": String(order.amount_minor),
      "line_items[0][price_data][product_data][name]": `晴屿${mode === "test" ? "测试" : ""}充值 · ${order.credits} 充值点数`, "line_items[0][quantity]": "1",
      success_url: `${origin}/?payment_order=${order.id}&payment=success#recharge`, cancel_url: `${origin}/?payment_order=${order.id}&payment=cancel#recharge` });
    for (const [key, value] of Object.entries({ app: "xumeng", order_id: order.id, user_id: order.user_id, package_id: order.package_id, credits: String(order.credits) })) {
      parameters.set(`metadata[${key}]`, value);
      parameters.set(`payment_intent_data[metadata][${key}]`, value);
    }
    if (user.email) parameters.set("customer_email", user.email);
    const session = await stripeApi(env, options, mode, "/checkout/sessions", parameters, `qingyu-checkout-${order.id}`);
    const sessionId = verifySession(session, order);
    const url = checkoutUrl(session.url);
    await env.DB.prepare(`UPDATE payment_orders SET stripe_session_id=?,checkout_url=?,updated_at=MAX(updated_at,?)
      WHERE id=? AND (stripe_session_id IS NULL OR stripe_session_id=?)`).bind(sessionId, url, now, order.id, sessionId).run();
    order = await env.DB.prepare("SELECT * FROM payment_orders WHERE id=? AND user_id=?").bind(order.id, user.id).first<Row>();
    if (!order || order.stripe_session_id !== sessionId || !order.checkout_url) throw new ApiError(503, "充值记录正在恢复，请使用同一请求重试。");
  }
  return json({ accountId: user.id, provider: "stripe", mode, testMode: mode === "test", order: toOrder(order), checkoutUrl: order.checkout_url }, inserted.meta.changes === 1 ? 201 : 200);
}

export async function verifyStripeWebhook(request: Request, secret: string, now = Date.now()): Promise<ObjectValue> {
  return verifyStripeWebhookBytes(await limitedBytes(request), request.headers.get("Stripe-Signature") ?? "", secret, now);
}

async function verifyStripeWebhookBytes(bytes: Uint8Array, signature: string, secret: string, now: number): Promise<ObjectValue> {
  if (signature.length > 4096) throw new ApiError(400, "Stripe 签名无效。");
  const parts = signature.split(",").map(part => part.trim());
  const timestamps = parts.filter(part => part.startsWith("t="));
  const signatures = parts.filter(part => /^v1=[a-f0-9]{64}$/i.test(part)).map(part => part.slice(3));
  const timestamp = timestamps.length === 1 ? timestamps[0].slice(2) : "";
  if (!/^\d{1,16}$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > 300
    || !signatures.length || signatures.length > 20) throw new ApiError(400, "Stripe 签名无效或已过期。");
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + bytes.length);
  payload.set(prefix); payload.set(bytes, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  for (const hex of signatures) {
    const signatureBytes = Uint8Array.from(hex.match(/../g)!, value => parseInt(value, 16));
    // WebCrypto verifies HMAC with a constant-time comparison.
    valid = await crypto.subtle.verify("HMAC", key, signatureBytes, payload) || valid;
  }
  if (!valid) throw new ApiError(400, "Stripe 签名无效。");
  try { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))); }
  catch { throw new ApiError(400, "Stripe 请求格式无效。"); }
}

async function refundFacts(env: PaymentEnvironment, options: PaymentOptions, chargeId: string, intentId: string, order: Row): Promise<RefundFact[]> {
  const facts: RefundFact[] = [];
  const seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ charge: chargeId, limit: "100" });
    if (cursor) params.set("starting_after", cursor);
    const result = await stripeApi(env, options, order.mode, `/refunds?${params}`);
    if (result.object !== "list" || !Array.isArray(result.data) || result.data.length > 100 || typeof result.has_more !== "boolean") throw new ApiError(502, "Stripe 退款分页无效。");
    for (const value of result.data) {
      const refund = record(value);
      const id = stripeId(refund.id, "re_");
      const amount = integer(refund.amount, order.amount_minor);
      if (!amount || seen.has(id) || refund.object !== "refund" || objectId(refund.charge, "ch_") !== chargeId
        || objectId(refund.payment_intent, "pi_") !== intentId || refund.currency !== order.currency
        || (refund.livemode !== undefined && refund.livemode !== (order.mode === "live"))
        || !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(String(refund.status))) throw new ApiError(502, "Stripe 退款与充值记录不一致。");
      seen.add(id);
      facts.push({ id, amount, succeeded: refund.status === "succeeded" ? 1 : 0, failed: ["failed", "canceled"].includes(String(refund.status)) ? 1 : 0 });
    }
    if (facts.filter(fact => fact.succeeded).reduce((sum, fact) => sum + fact.amount, 0) > order.amount_minor) throw new ApiError(502, "Stripe 退款总额无效。");
    if (!result.has_more) {
      if (facts.length) {
        const existing = await env.DB.prepare(`SELECT refund_id,order_id,amount_minor FROM payment_refunds WHERE refund_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`)
          .bind(JSON.stringify(facts)).all<{ refund_id: string; order_id: string; amount_minor: number }>();
        for (const row of existing.results) {
          const fact = facts.find(item => item.id === row.refund_id)!;
          if (row.order_id !== order.id || row.amount_minor !== fact.amount) throw new ApiError(400, "Stripe 退款记录的归属或金额发生冲突。");
        }
      }
      return facts;
    }
    if (!result.data.length) throw new ApiError(502, "Stripe 退款分页无效。");
    cursor = facts.at(-1)!.id;
  }
  throw new ApiError(503, "退款记录过多，需要管理员核对。");
}

async function retrieveSession(env: PaymentEnvironment, options: PaymentOptions, mode: PaymentMode, id: string): Promise<ObjectValue> {
  const session = await stripeApi(env, options, mode, `/checkout/sessions/${id}?expand[]=payment_intent.latest_charge`);
  if (stripeId(session.id, `cs_${mode}_`) !== id || session.livemode !== (mode === "live")) throw new ApiError(400, "Stripe 返回的订单编号或支付模式不一致。");
  return session;
}
async function findRefundSession(event: ObjectValue, env: PaymentEnvironment, options: PaymentOptions, mode: PaymentMode): Promise<{ session: ObjectValue; intentId: string; chargeId: string } | null> {
  const object = record(record(event.data).object);
  let chargeId: string;
  if (event.type === "charge.refunded") chargeId = stripeId(object.id, "ch_");
  else {
    const refundId = stripeId(object.id, "re_");
    const refund = await stripeApi(env, options, mode, `/refunds/${refundId}`);
    if (refund.object !== "refund" || stripeId(refund.id, "re_") !== refundId
      || (refund.livemode !== undefined && refund.livemode !== (mode === "live"))) throw new ApiError(502, "Stripe 退款记录或支付模式无效。");
    chargeId = objectId(refund.charge, "ch_");
  }
  const charge = await stripeApi(env, options, mode, `/charges/${chargeId}`);
  if (stripeId(charge.id, "ch_") !== chargeId) throw new ApiError(400, "Stripe 返回的收款编号不一致。");
  if (charge.object !== "charge" || charge.livemode !== (mode === "live")) throw new ApiError(400, "Stripe 收款模式与回调不一致。");
  const intentId = objectId(charge.payment_intent, "pi_");
  const bound = await env.DB.prepare("SELECT stripe_session_id FROM payment_orders WHERE mode=? AND stripe_payment_intent_id=?").bind(mode, intentId).first<{ stripe_session_id: string | null }>();
  if (bound?.stripe_session_id) return { session: await retrieveSession(env, options, mode, bound.stripe_session_id), intentId, chargeId };
  // Refund delivery can arrive before completed: recover the session through Stripe,
  // then verify its metadata against an existing server-created order.
  const list = await stripeApi(env, options, mode, `/checkout/sessions?${new URLSearchParams({ payment_intent: intentId, limit: "100" })}`);
  if (list.object !== "list" || !Array.isArray(list.data) || list.has_more !== false) throw new ApiError(502, "Stripe 订单分页无效。");
  for (const item of list.data) {
    const session = record(item);
    if (session.metadata && record(session.metadata).app === "xumeng") return { session: await retrieveSession(env, options, mode, stripeId(session.id, `cs_${mode}_`)), intentId, chargeId };
  }
  return null;
}

async function applyEvent(event: ObjectValue, session: ObjectValue, env: PaymentEnvironment, options: PaymentOptions, mode: PaymentMode, refundOrigin?: { intentId: string; chargeId: string }): Promise<Response> {
  const metadata = record(session.metadata);
  if (metadata.app !== "xumeng") return json({ received: true, processed: false });
  if (typeof metadata.order_id !== "string" || !ORDER_ID.test(metadata.order_id)) throw new ApiError(400, "Stripe 充值记录无效。");
  const order = await env.DB.prepare("SELECT * FROM payment_orders WHERE id=?").bind(metadata.order_id).first<Row>();
  if (!order) throw new ApiError(400, "Stripe 充值记录不存在。");
  if (order.mode !== mode || event.livemode !== (order.mode === "live")) throw new ApiError(400, "Stripe 回调模式与充值记录不一致。");
  const sessionId = verifySession(session, order);
  if (!["open", "complete", "expired"].includes(String(session.status)) || !["unpaid", "paid", "no_payment_required"].includes(String(session.payment_status))) throw new ApiError(502, "Stripe 支付状态无效。");
  let intent: ObjectValue | null = null;
  let intentId: string | null = null;
  if (session.payment_intent) {
    intentId = objectId(session.payment_intent, "pi_");
    intent = typeof session.payment_intent === "object" ? record(session.payment_intent) : await stripeApi(env, options, mode, `/payment_intents/${intentId}?expand[]=latest_charge`);
    if (stripeId(intent.id, "pi_") !== intentId || intent.object !== "payment_intent" || intent.livemode !== (order.mode === "live") || intent.currency !== order.currency || intent.amount !== order.amount_minor
      || (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== intentId)) throw new ApiError(400, "Stripe 付款与充值记录不一致。");
  }
  const paid = session.status === "complete" && session.payment_status === "paid";
  if (refundOrigin && (!paid || intentId !== refundOrigin.intentId)) throw new ApiError(400, "Stripe 退款与订单付款记录不一致。");
  let facts: RefundFact[] = [];
  if (paid) {
    if (!intent || !intentId || intent.status !== "succeeded" || intent.amount_received !== order.amount_minor) throw new ApiError(400, "Stripe 尚未确认收款，未发放充值点数。");
    const chargeId = objectId(intent.latest_charge, "ch_");
    const charge = typeof intent.latest_charge === "object" ? record(intent.latest_charge) : await stripeApi(env, options, mode, `/charges/${chargeId}`);
    if (stripeId(charge.id, "ch_") !== chargeId || (refundOrigin && chargeId !== refundOrigin.chargeId)
      || charge.object !== "charge" || charge.livemode !== (order.mode === "live") || charge.paid !== true || charge.captured !== true
      || charge.amount !== order.amount_minor || charge.currency !== order.currency || objectId(charge.payment_intent, "pi_") !== intentId) throw new ApiError(400, "Stripe 收款记录无效，未发放充值点数。");
    facts = await refundFacts(env, options, chargeId, intentId, order);
  }
  const pendingStatus = session.status === "expired" ? "expired"
    : intent && ["requires_payment_method", "canceled"].includes(String(intent.status)) && session.status === "complete" ? "failed" : "pending";
  const now = (options.now ?? Date.now)();
  const token = crypto.randomUUID();
  const gate = "EXISTS(SELECT 1 FROM payment_events WHERE event_id=? AND processing_token=?)";
  const totals = "COALESCE((SELECT SUM(r.amount_minor) FROM payment_refunds r WHERE r.order_id=payment_orders.id AND r.succeeded_seen=1 AND r.failed_seen=0),0)";
  const statements = [
    env.DB.prepare(`INSERT INTO payment_events(event_id,event_type,order_id,processing_token,processed_at)
      SELECT ?,?,id,?,? FROM payment_orders WHERE id=? AND (stripe_session_id IS NULL OR stripe_session_id=?) ON CONFLICT(event_id) DO NOTHING`)
      .bind(event.id, event.type, token, now, order.id, sessionId),
    env.DB.prepare(`UPDATE payment_orders SET stripe_session_id=COALESCE(stripe_session_id,?),stripe_payment_intent_id=COALESCE(stripe_payment_intent_id,?),
      paid_at=CASE WHEN ? THEN COALESCE(paid_at,?) ELSE paid_at END,
      status=CASE WHEN paid_at IS NOT NULL OR ? THEN status ELSE ? END,updated_at=MAX(updated_at,?) WHERE id=? AND ${gate}`)
      .bind(sessionId, intentId, paid ? 1 : 0, now, paid ? 1 : 0, pendingStatus, now, order.id, event.id, token),
    env.DB.prepare(`INSERT INTO payment_refunds(refund_id,order_id,amount_minor,currency,succeeded_seen,failed_seen,updated_at)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.amount'),'usd',json_extract(value,'$.succeeded'),json_extract(value,'$.failed'),?
      FROM json_each(?) WHERE ${gate}
      ON CONFLICT(refund_id) DO UPDATE SET succeeded_seen=MAX(succeeded_seen,excluded.succeeded_seen),failed_seen=MAX(failed_seen,excluded.failed_seen),updated_at=MAX(updated_at,excluded.updated_at)
      WHERE payment_refunds.order_id=excluded.order_id AND payment_refunds.amount_minor=excluded.amount_minor`)
      .bind(order.id, now, JSON.stringify(facts), event.id, token),
    env.DB.prepare(`UPDATE payment_orders SET refunded_amount_minor=${totals},refunded_credits=CAST((${totals})*credits/amount_minor AS INTEGER)
      WHERE id=? AND paid_at IS NOT NULL AND ${gate}`).bind(order.id, event.id, token),
    env.DB.prepare(`UPDATE payment_orders SET status=CASE WHEN refunded_credits=credits THEN 'refunded' WHEN refunded_credits>0 THEN 'partially_refunded' ELSE 'paid' END
      WHERE id=? AND paid_at IS NOT NULL AND ${gate}`).bind(order.id, event.id, token),
    env.DB.prepare(`INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at)
      SELECT id,user_id,?,'purchase',credits,? FROM payment_orders WHERE id=? AND paid_at IS NOT NULL AND ${gate}
      ON CONFLICT DO NOTHING`).bind(event.id, now, order.id, event.id, token),
    env.DB.prepare(`INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at)
      SELECT id,user_id,?,'refund_adjustment',-refunded_credits-COALESCE((SELECT SUM(l.credits) FROM payment_credit_ledger l WHERE l.order_id=o.id AND l.kind='refund_adjustment'),0),?
      FROM payment_orders o WHERE id=? AND paid_at IS NOT NULL AND ${gate}
      AND -refunded_credits-COALESCE((SELECT SUM(l.credits) FROM payment_credit_ledger l WHERE l.order_id=o.id AND l.kind='refund_adjustment'),0)<>0
      ON CONFLICT DO NOTHING`).bind(event.id, now, order.id, event.id, token),
  ];
  const results = await env.DB.batch(statements);
  return json({ received: true, processed: results[0].meta.changes === 1 });
}

async function webhook(request: Request, env: PaymentEnvironment, options: PaymentOptions): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "Stripe 回调仅支持 POST。");
  // Existing test orders can finish or refund after the public checkout mode is
  // switched. Authenticate each endpoint secret against untouched raw bytes,
  // then use only that mode's Stripe credentials for canonical retrieval.
  const candidates = (["test", "live"] as const).map(mode => credentialsForMode(env, mode)).filter((value): value is StripeCredentials => value !== null);
  if (!candidates.length) throw new ApiError(503, "Stripe 回调尚未配置完成。");
  let event: ObjectValue | undefined;
  let mode: PaymentMode | undefined;
  const bytes = await limitedBytes(request);
  const signature = request.headers.get("Stripe-Signature") ?? "";
  const now = (options.now ?? Date.now)();
  for (const candidate of candidates) {
    try {
      event = await verifyStripeWebhookBytes(bytes, signature, candidate.webhookSecret, now);
      mode = candidate.mode;
      break;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 400 || error.message !== "Stripe 签名无效。") throw error;
    }
  }
  if (!event || !mode) throw new ApiError(400, "Stripe 签名无效。");
  stripeId(event.id, "evt_");
  if (event.object !== "event" || event.livemode !== (mode === "live") || event.account) throw new ApiError(400, "Stripe 事件与已验证的支付模式不一致。");
  if (!SESSION_EVENTS.has(String(event.type)) && !REFUND_EVENTS.has(String(event.type))) return json({ received: true, processed: false });
  const previous = await env.DB.prepare("SELECT o.mode FROM payment_events e JOIN payment_orders o ON o.id=e.order_id WHERE e.event_id=?").bind(event.id).first<{ mode: PaymentMode }>();
  if (previous) {
    if (previous.mode !== mode) throw new ApiError(400, "Stripe 事件编号与支付模式发生冲突。");
    return json({ received: true, processed: false });
  }
  const object = record(record(event.data).object);
  if (object.livemode !== undefined && object.livemode !== (mode === "live")) throw new ApiError(400, "Stripe 对象模式与回调不一致。");
  if (SESSION_EVENTS.has(String(event.type))) return applyEvent(event, await retrieveSession(env, options, mode, stripeId(object.id, `cs_${mode}_`)), env, options, mode);
  const refund = await findRefundSession(event, env, options, mode);
  if (!refund) return json({ received: true, processed: false });
  return applyEvent(event, refund.session, env, options, mode, refund);
}

async function wallet(env: PaymentEnvironment, user: UserRecord, orderId?: string) {
  const mode = paymentMode(env);
  if (mode === "live") return liveWallet(env, user, "stripe", orderId);
  const statements = [
    env.DB.prepare(`SELECT COALESCE(SUM(credits),0) AS balance,COALESCE(SUM(CASE WHEN kind='purchase' THEN credits ELSE 0 END),0) AS total_purchased,
      -COALESCE(SUM(CASE WHEN kind='refund_adjustment' THEN credits ELSE 0 END),0) AS total_refunded FROM payment_credit_ledger
      WHERE user_id=? AND order_id IN (SELECT id FROM payment_orders WHERE mode=?)`).bind(user.id, mode),
    env.DB.prepare("SELECT * FROM payment_orders WHERE user_id=? AND mode=? ORDER BY created_at DESC,id LIMIT 20").bind(user.id, mode),
  ];
  if (orderId) statements.push(env.DB.prepare("SELECT * FROM payment_orders WHERE id=? AND user_id=? AND mode=?").bind(orderId, user.id, mode));
  const result = await env.DB.batch(statements);
  const order = orderId ? result[2].results[0] as unknown as Row | undefined : undefined;
  if (orderId && !order) throw new ApiError(404, "充值订单不存在。");
  const total = result[0].results[0] as unknown as { balance: number; total_purchased: number; total_refunded: number };
  return { accountId: user.id, provider: "stripe", mode, testMode: mode === "test", modelBillingLinked: false, balance: Number(total.balance), totalPurchased: Number(total.total_purchased),
    totalRefunded: Number(total.total_refunded), orders: (result[1].results as unknown as Row[]).map(toOrder), ...(order ? { order: toOrder(order) } : {}) };
}

export async function handlePaymentsApi(request: Request, env: PaymentEnvironment, suppliedUser?: UserRecord | null, options: PaymentOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/v1/payments" && !path.startsWith("/v1/payments/")) return null;
  if (path === "/v1/payments/webhook") return webhook(request, env, options);
  const guaguaResponse = await handleGuaguaPayments(request, env, suppliedUser, options);
  if (guaguaResponse) return guaguaResponse;
  const zpayResponse = await handleZpayPayments(request, env, suppliedUser, options);
  if (zpayResponse) return zpayResponse;
  if (path === "/v1/payments/config") {
    if (request.method !== "GET") throw new ApiError(405, "充值配置仅支持 GET。");
    const enabled = paymentCollectionEnabled(env) && configured(env);
    const mode = env.STRIPE_PAYMENT_MODE === "live" ? "live" : "test";
    const linked = mode === "live" && creditBillingConfig(env).enabled;
    return json({ provider: "stripe", enabled, testMode: mode === "test", mode, modelBillingLinked: linked, currency: "usd", packages: PACKAGES,
      note: !paymentCollectionEnabled(env) ? PAYMENT_PAUSED_NOTE
        : mode === "live"
          ? enabled ? `Stripe 正式支付，将以美元真实扣款；充值 Credit 与任务、邀请奖励进入同一聊天余额，${linked ? "用于模型对话与剧情记忆的 Token 费用" : "目前不抵扣模型费用"}。` : "Stripe 正式充值尚未开通，正在等待收款账户激活和支付配置完成。"
          : enabled ? "Stripe 测试模式，不会真实扣款；充值 Credit 与任务、邀请奖励进入同一聊天余额。" : "Stripe 测试充值尚未配置，请稍后再试。" });
  }
  const user = suppliedUser ?? await requireUser(request, env);
  if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用充值功能。");
  if (path === "/v1/payments/checkout") {
    if (request.method !== "POST") throw new ApiError(405, "创建收银台仅支持 POST。");
    return createCheckout(request, env, user, options);
  }
  if (path === "/v1/payments/wallet") {
    if (request.method !== "GET") throw new ApiError(405, "充值余额仅支持 GET。");
    return json(await wallet(env, user));
  }
  const match = /^\/v1\/payments\/orders\/([^/]+)$/.exec(path);
  if (match) {
    if (request.method !== "GET") throw new ApiError(405, "充值订单仅支持 GET。");
    if (!ORDER_ID.test(match[1]) && !ZPAY_ORDER_ID.test(match[1]) && !GUAGUA_ORDER_ID.test(match[1])) throw new ApiError(404, "充值订单不存在。");
    return json(await wallet(env, user, match[1]));
  }
  throw new ApiError(404, "充值接口不存在。");
}
