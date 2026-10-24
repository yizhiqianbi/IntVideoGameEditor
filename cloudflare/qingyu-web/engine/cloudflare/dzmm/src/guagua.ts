import { createHash, timingSafeEqual } from "node:crypto";
import { rateLimit, requireUser } from "./auth";
import { ApiError, json, readJson } from "./http";
import { liveOrder, liveWallet } from "./payment-wallet";
import type { Env, UserRecord } from "./types";
import { creditBillingConfig } from "./credit-usage";
import { PAYMENT_PAUSED_NOTE, paymentCollectionEnabled, requirePaymentCollection } from "./payment-availability";
import { inviteRebateStatement } from "./dream-coin";
import { closeGuaguaVip, fulfillGuaguaVip, readGuaguaVipByOrder, readGuaguaVipByTid, vipPaidLocation, vipReturnUrl, VIP_ORDER_ID, type GuaguaVipPayment } from "./guagua-vip";

export type GuaguaOptions = { guaguaFetch?: (url: string, init?: RequestInit) => Promise<Response>; now?: () => number };
export const GUAGUA_ORDER_ID = /^gg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORIGIN = "https://qingyu.invalid";
const API_ORIGIN = "http://RfBseViEKZlMAmu7ArWO.itxt002.xyz";
const CALLBACK_IP = "136.110.35.126";
const PAY_HOST = "alipay.dthzf001.cn";
const PACKAGES = [
  { id: "cny_28", amountMinor: 2800, currency: "cny", credits: 2800 },
  { id: "cny_88", amountMinor: 8800, currency: "cny", credits: 8800 },
  { id: "cny_188", amountMinor: 18800, currency: "cny", credits: 18800 },
] as const;
type Order = {
  id: string; user_id: string; request_id: string; package_id: string; amount_minor: number; currency: "cny"; credits: number;
  method: "wxpay"; mer_order_tid: string; merchant_mid: string; channel_code: string; provider_trade_no: string | null;
  pay_url: string | null; checkout_url: string; status: string; refunded_amount_minor: number; refunded_credits: number;
  created_at: number; updated_at: number; paid_at: number | null;
};
type CallbackFact = { merOrderTid: string; tid: string; amountMinor: number; status: number };

function credentialsConfigured(env: Env): boolean {
  return typeof env.GUAGUA_MID === "string" && /^M\d{4,12}$/.test(env.GUAGUA_MID)
    && typeof env.GUAGUA_SECRET === "string" && /^[a-f0-9]{32}$/i.test(env.GUAGUA_SECRET)
    && typeof env.GUAGUA_CHANNEL_CODE === "string" && /^[A-Za-z0-9]{1,32}$/.test(env.GUAGUA_CHANNEL_CODE);
}
function configured(env: Env): boolean { return env.GUAGUA_ENABLED === "true" && credentialsConfigured(env); }
function requireCredentials(env: Env): void { if (!credentialsConfigured(env)) throw new ApiError(503, "支付通道凭据尚未配置完成。"); }
function requireConfiguration(env: Env): void {
  requirePaymentCollection(env);
  if (!configured(env)) throw new ApiError(503, "微信充值尚未开通，请稍后再试。");
}
function orderValue(order: Order) { return liveOrder({ ...order, provider: "guagua", method: "wxpay", checkout_url: order.checkout_url }); }
function money(amount: number): string { return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`; }
function amountMinor(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const minor = Math.round(value * 100);
    if (minor < 0 || minor > 100_000_000 || Math.abs(value * 100 - minor) > 1e-6) throw new ApiError(400, "支付金额格式无效。");
    return minor;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) throw new ApiError(400, "支付金额格式无效。");
  const [major, minor = ""] = value.split(".");
  return Number(major) * 100 + Number(minor.padEnd(2, "0"));
}
function tradeNo(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{8,64}$/.test(value)) throw new ApiError(400, "支付通道交易编号无效。");
  return value;
}
function merOrderTid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `gg${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** ASCII-sorted non-empty key=value pairs, then `&` and the merchant secret, then MD5. */
export function guaguaSignature(parameters: Record<string, string>, secret: string): string {
  const canonical = Object.keys(parameters).filter(name => name !== "sign" && parameters[name] !== "")
    .sort().map(name => `${name}=${parameters[name]}`).join("&");
  return createHash("md5").update(`${canonical}&${secret}`, "utf8").digest("hex");
}
function payUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new ApiError(502, "支付服务未提供有效的收银台地址。");
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(502, "支付服务未提供有效的收银台地址。"); }
  if (url.protocol !== "https:" || url.hostname !== PAY_HOST || url.port || url.username || url.password || url.hash
    || !url.pathname.startsWith("/pay/")) throw new ApiError(502, "支付服务未提供有效的收银台地址。");
  return url.href;
}
async function providerPost(env: Env, path: string, parameters: Record<string, string>, options: GuaguaOptions): Promise<Record<string, unknown>> {
  requireCredentials(env);
  const payload = { ...parameters, sign: guaguaSignature(parameters, env.GUAGUA_SECRET!) };
  const endpoint = `${API_ORIGIN}${path}`;
  let response: Response;
  try {
    response = await (options.guaguaFetch ?? fetch)(endpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(payload),
    });
  } catch { throw new ApiError(503, "支付通道暂时无法连接，请稍后重试。"); }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new ApiError(502, "支付通道返回了无效跳转。"); }
  if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > 65536) {
    await response.body?.cancel();
    throw new ApiError(503, "支付通道暂时无法连接，请稍后重试。");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new ApiError(502, "支付通道返回了过大的响应。"); }
    chunks.push(part.value);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer())); }
  catch { throw new ApiError(502, "支付通道返回了无效的数据。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(502, "支付通道返回了无效的数据。");
  return parsed as Record<string, unknown>;
}
function providerError(body: Record<string, unknown>): string {
  const message = typeof body.errMsg === "string" ? body.errMsg.replace(/[\r\n]/g, " ").slice(0, 160) : "";
  return message || "支付通道拒绝了这笔订单。";
}

async function openCashier(env: Env, order: Order, clientIp: string | null, options: GuaguaOptions): Promise<Order> {
  if (order.pay_url) return order;
  const parameters: Record<string, string> = {
    mid: order.merchant_mid, merOrderTid: order.mer_order_tid, money: money(order.amount_minor), channelCode: order.channel_code,
    notifyUrl: `${ORIGIN}/api/payments/guagua/notify`, returnUrl: `${ORIGIN}/api/payments/guagua/return`,
  };
  if (clientIp && /^(?:\d{1,3}\.){3}\d{1,3}$|^[A-Fa-f0-9:.]{2,64}$/.test(clientIp)) parameters.clientIp = clientIp;
  const body = await providerPost(env, "/api/services/app/Api_PayOrder/CreateOrderPay", parameters, options);
  if (body.status !== 0 || !body.result || typeof body.result !== "object") throw new ApiError(502, providerError(body));
  const result = body.result as Record<string, unknown>;
  if (result.merOrderTid !== order.mer_order_tid || amountMinor(result.money) !== order.amount_minor) throw new ApiError(502, "支付通道返回的订单与本站记录不一致。");
  const tid = tradeNo(result.tid), url = payUrl(result.payUrl), now = (options.now ?? Date.now)();
  await env.DB.prepare(`UPDATE guagua_orders SET provider_trade_no=COALESCE(provider_trade_no,?),pay_url=COALESCE(pay_url,?),updated_at=?
    WHERE id=? AND paid_at IS NULL AND (provider_trade_no IS NULL OR provider_trade_no=?) AND (pay_url IS NULL OR pay_url=?)`)
    .bind(tid, url, now, order.id, tid, url).run();
  const saved = await env.DB.prepare("SELECT * FROM guagua_orders WHERE id=?").bind(order.id).first<Order>();
  if (!saved?.pay_url || saved.provider_trade_no !== tid) throw new ApiError(409, "支付通道交易编号与订单发生冲突。");
  return saved;
}

async function applyPaid(env: Env, order: Order, fact: CallbackFact, source: "notify" | "query", options: GuaguaOptions): Promise<void> {
  if (fact.merOrderTid !== order.mer_order_tid || fact.amountMinor !== order.amount_minor || fact.status !== 1
    || (order.provider_trade_no && order.provider_trade_no !== fact.tid)) throw new ApiError(400, "支付通道订单与本站充值记录不一致，未发放充值点数。");
  const eventId = `gg_evt_${createHash("sha256").update(JSON.stringify([order.id, fact.tid, fact.amountMinor])).digest("hex")}`;
  const nonce = crypto.randomUUID(), now = (options.now ?? Date.now)();
  const gate = "EXISTS(SELECT 1 FROM guagua_events WHERE event_id=? AND processing_token=?)";
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO guagua_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
      SELECT ?,?,id,?,?,? FROM guagua_orders WHERE id=? AND mer_order_tid=? AND amount_minor=? AND (provider_trade_no IS NULL OR provider_trade_no=?)
      ON CONFLICT(event_id) DO NOTHING`).bind(eventId, source, fact.tid, nonce, now, order.id, fact.merOrderTid, fact.amountMinor, fact.tid),
    env.DB.prepare(`UPDATE guagua_orders SET provider_trade_no=COALESCE(provider_trade_no,?),status='paid',paid_at=COALESCE(paid_at,?),updated_at=MAX(updated_at,?)
      WHERE id=? AND ${gate}`).bind(fact.tid, now, now, order.id, eventId, nonce),
    env.DB.prepare(`INSERT INTO guagua_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at)
      SELECT id,user_id,?,'purchase',credits,? FROM guagua_orders WHERE id=? AND paid_at IS NOT NULL AND ${gate}
      ON CONFLICT DO NOTHING`).bind(eventId, now, order.id, eventId, nonce),
    inviteRebateStatement(env, order.user_id, `gg:${order.id}`, order.amount_minor, now, "guagua_events", eventId, nonce),
  ]);
  if (!results[0].meta.changes) {
    const current = await env.DB.prepare("SELECT provider_trade_no,paid_at FROM guagua_orders WHERE id=?").bind(order.id).first<{ provider_trade_no: string | null; paid_at: number | null }>();
    if (current?.provider_trade_no !== fact.tid || current.paid_at === null) throw new ApiError(400, "支付通道交易编号与订单发生冲突。");
  }
}

function callbackFact(body: Record<string, unknown>, secret: string): CallbackFact {
  const parameters: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(body)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) || Object.hasOwn(parameters, key)) throw new ApiError(400, "支付回调参数无效。");
    if (typeof value === "number" && Number.isFinite(value)) parameters[key] = String(value);
    else if (typeof value === "string" && value.length <= 1024 && !/[\0\r\n]/.test(value)) parameters[key] = value;
    else throw new ApiError(400, "支付回调参数无效。");
  }
  if (!/^[a-f0-9]{32}$/i.test(parameters.sign ?? "")) throw new ApiError(400, "支付回调签名无效。");
  const expected = guaguaSignature(parameters, secret);
  const bytes = (hex: string) => Uint8Array.from(hex.toLowerCase().match(/../g)!, value => parseInt(value, 16));
  if (!timingSafeEqual(bytes(expected), bytes(parameters.sign))) throw new ApiError(400, "支付回调签名无效。");
  const status = Number(parameters.status);
  if (!Number.isInteger(status) || status < 0 || status > 4) throw new ApiError(400, "支付回调订单无效。");
  return { merOrderTid: parameters.merOrderTid, tid: tradeNo(parameters.tid), amountMinor: amountMinor(parameters.money), status };
}

async function notify(request: Request, env: Env, options: GuaguaOptions): Promise<Response> {
  requireCredentials(env);
  if (request.headers.get("CF-Connecting-IP") !== CALLBACK_IP) throw new ApiError(403, "支付回调来源无效。");
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ApiError(415, "支付回调应为 JSON。");
  const body = await readJson(request, 8192);
  const fact = callbackFact(body, env.GUAGUA_SECRET!);
  const order = await env.DB.prepare("SELECT * FROM guagua_orders WHERE mer_order_tid=?").bind(fact.merOrderTid).first<Order>();
  const now = (options.now ?? Date.now)();
  if (order) {
    if (order.merchant_mid !== env.GUAGUA_MID) throw new ApiError(400, "支付回调订单不存在。");
    if (fact.status === 1) await applyPaid(env, order, fact, "notify", options);
    else if (fact.amountMinor === order.amount_minor && order.paid_at === null && (fact.status === 2 || fact.status === 3 || fact.status === 4)) {
      const status = fact.status === 4 ? "expired" : "failed";
      await env.DB.prepare("UPDATE guagua_orders SET status=?,updated_at=? WHERE id=? AND paid_at IS NULL").bind(status, now, order.id).run();
    } else if (fact.amountMinor !== order.amount_minor) throw new ApiError(400, "支付通道订单与本站充值记录不一致，未发放充值点数。");
  } else {
    const vip = await readGuaguaVipByTid(env, fact.merOrderTid);
    if (!vip || vip.merchant_mid !== env.GUAGUA_MID) throw new ApiError(400, "支付回调订单不存在。");
    if (fact.status === 1) await fulfillGuaguaVip(env, vip, fact, "notify", now);
    else await closeGuaguaVip(env, vip, fact, now);
  }
  return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function browserReturn(): Response { return redirect(`${ORIGIN}/#recharge`); }

async function checkout(request: Request, env: Env, user: UserRecord, options: GuaguaOptions): Promise<Response> {
  requireConfiguration(env);
  const body = await readJson(request, 2048);
  if (Object.keys(body).some(key => !["provider", "method", "packageId", "accountId", "requestId", "mode"].includes(key))) throw new ApiError(400, "充值金额、点数和支付地址只能由服务端确定。");
  if (body.accountId !== user.id) throw new ApiError(401, "账户已切换，请刷新充值页面后重试。");
  if (body.provider !== "guagua" || body.mode !== "live" || body.method !== "wxpay") throw new ApiError(409, "支付通道已切换，请刷新充值页面后重试。");
  const pack = PACKAGES.find(item => item.id === body.packageId);
  if (!pack || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ApiError(400, "请选择有效的充值套餐和支付方式。");
  await rateLimit(request, env, "guagua-checkout-account", 60, user.id);
  await rateLimit(request, env, "guagua-checkout-ip", 300);
  const id = `gg_${crypto.randomUUID()}`, now = (options.now ?? Date.now)(), requestId = body.requestId.toLowerCase();
  const tid = merOrderTid();
  const inserted = await env.DB.prepare(`INSERT INTO guagua_orders(id,user_id,request_id,package_id,amount_minor,credits,method,mer_order_tid,merchant_mid,channel_code,checkout_url,created_at,updated_at)
    SELECT ?,id,?,?,?,?,?,?,?,?,?,?,? FROM users WHERE id=? AND is_guest=0 ON CONFLICT(user_id,request_id) DO NOTHING`)
    .bind(id, requestId, pack.id, pack.amountMinor, pack.credits, "wxpay", tid, env.GUAGUA_MID!, env.GUAGUA_CHANNEL_CODE!,
      `${ORIGIN}/api/payments/guagua/checkout/${id}`, now, now, user.id).run();
  let order = await env.DB.prepare("SELECT * FROM guagua_orders WHERE user_id=? AND request_id=?").bind(user.id, requestId).first<Order>();
  if (!order) throw new ApiError(403, "请使用正式账户充值。");
  if (order.package_id !== pack.id || order.method !== "wxpay" || order.merchant_mid !== env.GUAGUA_MID || order.channel_code !== env.GUAGUA_CHANNEL_CODE) {
    throw new ApiError(409, "该充值请求编号已用于其他套餐或支付方式。");
  }
  if (order.paid_at === null) order = await openCashier(env, order, request.headers.get("CF-Connecting-IP"), options);
  return json({ accountId: user.id, provider: "guagua", mode: "live", testMode: false, order: orderValue(order), checkoutUrl: order.checkout_url }, inserted.meta.changes === 1 ? 201 : 200);
}

async function openVipCashier(env: Env, payment: GuaguaVipPayment, clientIp: string | null, options: GuaguaOptions): Promise<string> {
  if (payment.pay_url) return payment.pay_url;
  const parameters: Record<string, string> = {
    mid: payment.merchant_mid, merOrderTid: payment.mer_order_tid, money: money(payment.amount_minor), channelCode: payment.channel_code,
    notifyUrl: `${ORIGIN}/api/payments/guagua/notify`, returnUrl: vipReturnUrl(payment.subscription_order_id),
  };
  if (clientIp && /^(?:\d{1,3}\.){3}\d{1,3}$|^[A-Fa-f0-9:.]{2,64}$/.test(clientIp)) parameters.clientIp = clientIp;
  const body = await providerPost(env, "/api/services/app/Api_PayOrder/CreateOrderPay", parameters, options);
  if (body.status !== 0 || !body.result || typeof body.result !== "object") throw new ApiError(502, providerError(body));
  const result = body.result as Record<string, unknown>;
  if (result.merOrderTid !== payment.mer_order_tid || amountMinor(result.money) !== payment.amount_minor) throw new ApiError(502, "支付通道返回的订单与本站记录不一致。");
  const tid = tradeNo(result.tid), url = payUrl(result.payUrl);
  await env.DB.prepare(`UPDATE guagua_vip_orders SET provider_trade_no=COALESCE(provider_trade_no,?),pay_url=COALESCE(pay_url,?)
    WHERE subscription_order_id=? AND (provider_trade_no IS NULL OR provider_trade_no=?) AND (pay_url IS NULL OR pay_url=?)`)
    .bind(tid, url, payment.subscription_order_id, tid, url).run();
  const saved = await readGuaguaVipByOrder(env, payment.subscription_order_id);
  if (!saved?.pay_url || saved.provider_trade_no !== tid) throw new ApiError(409, "支付通道交易编号与会员订单发生冲突。");
  return saved.pay_url;
}

async function vipCheckoutRedirect(env: Env, user: UserRecord, id: string, options: GuaguaOptions, request: Request): Promise<Response> {
  requireConfiguration(env);
  const payment = await readGuaguaVipByOrder(env, id, user.id);
  if (!payment) throw new ApiError(404, "订阅订单不存在。");
  if (payment.paid_at !== null) return redirect(vipPaidLocation(id));
  if (payment.merchant_mid !== env.GUAGUA_MID || payment.channel_code !== env.GUAGUA_CHANNEL_CODE || payment.status !== "pending") {
    throw new ApiError(503, "该订单的支付通道已变更，请返回会员页面。");
  }
  return redirect(payUrl(await openVipCashier(env, payment, request.headers.get("CF-Connecting-IP"), options)), 302);
}

async function checkoutRedirect(env: Env, user: UserRecord, id: string, options: GuaguaOptions, request: Request): Promise<Response> {
  requireConfiguration(env);
  const order = await env.DB.prepare("SELECT * FROM guagua_orders WHERE id=? AND user_id=?").bind(id, user.id).first<Order>();
  if (!order) throw new ApiError(404, "充值订单不存在。");
  if (order.paid_at !== null) return redirect(`${ORIGIN}/?payment_order=${order.id}&payment=success#recharge`);
  if (order.merchant_mid !== env.GUAGUA_MID || order.channel_code !== env.GUAGUA_CHANNEL_CODE) throw new ApiError(503, "该订单的支付通道已变更，请返回充值页面。");
  const ready = order.pay_url ? order : await openCashier(env, order, request.headers.get("CF-Connecting-IP"), options);
  return redirect(payUrl(ready.pay_url), 302);
}

export async function queryGuaguaPayment(env: Env, merOrderTid: string, options: GuaguaOptions): Promise<CallbackFact | null> {
  const body = await providerPost(env, "/api/services/app/Api_PayOrder/QueryPayOrder", { mid: env.GUAGUA_MID!, merOrderTid }, options);
  if (body.status !== 0 || !body.result || typeof body.result !== "object") return null;
  const result = body.result as Record<string, unknown>;
  const status = Number(result.payOrderStatus);
  if (!Number.isInteger(status)) return null;
  const fact = { merOrderTid: String(result.merOrderTid ?? ""), tid: tradeNo(result.tid), amountMinor: amountMinor(result.money), status };
  if (fact.merOrderTid !== merOrderTid) throw new ApiError(502, "支付通道返回的订单与本站记录不一致。");
  return fact;
}
async function queryOrder(env: Env, order: Order, options: GuaguaOptions): Promise<CallbackFact | null> {
  const fact = await queryGuaguaPayment(env, order.mer_order_tid, options);
  if (fact && fact.amountMinor !== order.amount_minor) throw new ApiError(502, "支付通道返回的订单与本站记录不一致。");
  return fact;
}

export async function handleGuaguaPayments(request: Request, env: Env, suppliedUser?: UserRecord | null, options: GuaguaOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/payments/guagua/notify") {
    if (request.method !== "POST") throw new ApiError(405, "支付回调仅支持 POST。");
    return notify(request, env, options);
  }
  if (path === "/v1/payments/guagua/return") {
    if (request.method !== "GET") throw new ApiError(405, "支付返回仅支持 GET。");
    return browserReturn();
  }
  const vipReturn = /^\/v1\/payments\/guagua\/vip\/return\/([^/]+)$/.exec(path);
  if (vipReturn) {
    if (request.method !== "GET") throw new ApiError(405, "支付返回仅支持 GET。");
    if (!VIP_ORDER_ID.test(vipReturn[1])) throw new ApiError(404, "订阅订单不存在。");
    return redirect(vipPaidLocation(vipReturn[1]));
  }
  const vipForm = /^\/v1\/payments\/guagua\/vip\/checkout\/([^/]+)$/.exec(path);
  if (vipForm) {
    if (request.method !== "GET") throw new ApiError(405, "支付页面仅支持 GET。");
    if (!VIP_ORDER_ID.test(vipForm[1])) throw new ApiError(404, "订阅订单不存在。");
    const user = suppliedUser ?? await requireUser(request, env);
    if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用订阅功能。");
    return vipCheckoutRedirect(env, user, vipForm[1], options, request);
  }
  const form = /^\/v1\/payments\/guagua\/checkout\/([^/]+)$/.exec(path);
  if (form) {
    if (request.method !== "GET") throw new ApiError(405, "支付页面仅支持 GET。");
    if (!GUAGUA_ORDER_ID.test(form[1])) throw new ApiError(404, "充值订单不存在。");
    const user = suppliedUser ?? await requireUser(request, env);
    if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用充值功能。");
    return checkoutRedirect(env, user, form[1], options, request);
  }
  if (env.PAYMENT_PROVIDER !== "guagua") return null;
  if (path === "/v1/payments/config") {
    if (request.method !== "GET") throw new ApiError(405, "充值配置仅支持 GET。");
    const enabled = paymentCollectionEnabled(env) && configured(env);
    const linked = creditBillingConfig(env).enabled;
    return json({ provider: "guagua", enabled, mode: "live", testMode: false, modelBillingLinked: linked, currency: "cny", packages: PACKAGES,
      methods: enabled ? [{ id: "wxpay", label: "微信支付" }] : [],
      note: !paymentCollectionEnabled(env) ? PAYMENT_PAUSED_NOTE
        : enabled ? `微信正式支付，将以人民币真实扣款；充值 Credit 与任务、邀请奖励进入同一聊天余额，${linked ? "用于模型对话与剧情记忆的 Token 费用" : "目前不抵扣模型费用"}。退款需联系管理员人工处理并核对结果。`
          : "微信充值尚未开通，正在等待支付通道配置完成。退款需联系管理员人工处理并核对结果。" });
  }
  const user = suppliedUser ?? await requireUser(request, env);
  if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用充值功能。");
  if (path === "/v1/payments/checkout") {
    if (request.method !== "POST") throw new ApiError(405, "创建收银台仅支持 POST。");
    return checkout(request, env, user, options);
  }
  if (path === "/v1/payments/wallet") {
    if (request.method !== "GET") throw new ApiError(405, "充值余额仅支持 GET。");
    return json(await liveWallet(env, user, "guagua"));
  }
  const detail = /^\/v1\/payments\/orders\/([^/]+)$/.exec(path);
  if (detail) {
    if (request.method !== "GET") throw new ApiError(405, "充值订单仅支持 GET。");
    if (GUAGUA_ORDER_ID.test(detail[1])) {
      const order = await env.DB.prepare("SELECT * FROM guagua_orders WHERE id=? AND user_id=?").bind(detail[1], user.id).first<Order>();
      if (!order) throw new ApiError(404, "充值订单不存在。");
      if (order.paid_at === null && credentialsConfigured(env)) {
        await rateLimit(request, env, "guagua-order-query-account", 120, user.id);
        const fact = await queryOrder(env, order, options);
        if (fact?.status === 1) await applyPaid(env, order, fact, "query", options);
      }
    } else if (!/^pay_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(detail[1])
      && !/^zp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(detail[1])) throw new ApiError(404, "充值订单不存在。");
    return json(await liveWallet(env, user, "guagua", detail[1]));
  }
  throw new ApiError(404, "充值接口不存在。");
}
