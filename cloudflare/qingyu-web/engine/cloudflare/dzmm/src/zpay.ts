import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { rateLimit, requireUser } from "./auth";
import { ApiError, json, readJson } from "./http";
import { liveOrder, liveWallet } from "./payment-wallet";
import { bindZpayTrade, zpayBindingGate } from "./zpay-bindings";
import type { Env, UserRecord } from "./types";
import { creditBillingConfig } from "./credit-usage";
import { PAYMENT_PAUSED_NOTE, paymentCollectionEnabled, requirePaymentCollection } from "./payment-availability";

export type ZpayOptions = { zpayFetch?: (url: string, init?: RequestInit) => Promise<Response>; now?: () => number };
export const ZPAY_ORDER_ID = /^zp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORIGIN = "https://qingyu.invalid";
const PACKAGES = [
  { id: "cny_28", amountMinor: 2800, currency: "cny", credits: 2800 },
  { id: "cny_88", amountMinor: 8800, currency: "cny", credits: 8800 },
  { id: "cny_188", amountMinor: 18800, currency: "cny", credits: 18800 },
] as const;
type Method = "alipay" | "wxpay";
type Order = { id: string; user_id: string; request_id: string; package_id: string; amount_minor: number; currency: "cny"; credits: number;
  method: Method; out_trade_no: string; merchant_pid: string; channel_id: string; payment_name: string; provider_trade_no: string | null;
  checkout_url: string; status: string; refunded_amount_minor: number; refunded_credits: number; created_at: number; updated_at: number; paid_at: number | null };
type Fact = { pid: string; outTradeNo: string; tradeNo: string; method: Method; name: string; amountMinor: number; param: string };
export type ZpayIdentity = Pick<Order, "id" | "merchant_pid" | "out_trade_no" | "method" | "payment_name" | "amount_minor" | "provider_trade_no">;

function channel(env: Env, method: Method): string | null {
  const value = method === "alipay" ? env.ZPAY_ALIPAY_CHANNEL_ID : env.ZPAY_WXPAY_CHANNEL_ID;
  return typeof value === "string" && /^[1-9]\d{0,29}$/.test(value) ? value : null;
}
function methods(env: Env) {
  return ([{ id: "alipay", label: "支付宝" }, { id: "wxpay", label: "微信支付" }] as const).filter(item => channel(env, item.id));
}
function credentialsConfigured(env: Env): boolean {
  return typeof env.ZPAY_PID === "string" && /^[A-Za-z0-9]{1,120}$/.test(env.ZPAY_PID)
    && typeof env.ZPAY_KEY === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(env.ZPAY_KEY);
}
function configured(env: Env): boolean { return env.ZPAY_ENABLED === "true" && credentialsConfigured(env) && methods(env).length > 0; }
function requireCredentials(env: Env): void { if (!credentialsConfigured(env)) throw new ApiError(503, "支付通道凭据尚未配置完成。"); }
function requireConfiguration(env: Env): void {
  requirePaymentCollection(env);
  if (!configured(env)) throw new ApiError(503, "支付宝 / 微信充值尚未开通，请稍后再试。");
}
function orderValue(order: Order) { return liveOrder({ ...order, provider: "zpay" }); }
function money(amount: number): string { return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`; }
function amount(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) throw new ApiError(400, "支付金额格式无效。");
  const [major, minor = ""] = value.split(".");
  return Number(major) * 100 + Number(minor.padEnd(2, "0"));
}
function tradeNo(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(value)) throw new ApiError(400, "支付通道交易编号无效。");
  return value;
}

/** Z-Pay's documented EPay signature uses decoded, unencoded values, ASCII key
 * ordering and a directly appended merchant key (not an HMAC). */
export function zpaySignature(parameters: Record<string, string>, key: string): string {
  const canonical = Object.keys(parameters).filter(name => name !== "sign" && name !== "sign_type" && parameters[name] !== "")
    .sort().map(name => `${name}=${parameters[name]}`).join("&");
  return createHash("md5").update(canonical + key, "utf8").digest("hex");
}
function callbackParameters(request: Request, env: Env): Record<string, string> {
  requireCredentials(env);
  const url = new URL(request.url);
  if (url.search.length > 8192 || /%(?![a-f0-9]{2})/i.test(url.search)) throw new ApiError(400, "支付回调参数无效。");
  const parameters: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!/^[A-Za-z0-9_]{1,60}$/.test(key) || Object.hasOwn(parameters, key) || value.length > 1024 || /[\0\r\n]/.test(value)) throw new ApiError(400, "支付回调参数无效。");
    parameters[key] = value;
  }
  if (parameters.sign_type !== "MD5" || !/^[a-f0-9]{32}$/.test(parameters.sign ?? "")) throw new ApiError(400, "支付回调签名无效。");
  const expected = zpaySignature(parameters, env.ZPAY_KEY!);
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, value => parseInt(value, 16));
  if (!timingSafeEqual(bytes(expected), bytes(parameters.sign))) throw new ApiError(400, "支付回调签名无效。");
  return parameters;
}
function callbackFact(parameters: Record<string, string>, idPattern = ZPAY_ORDER_ID): Fact {
  if (!/^\d{32}$/.test(parameters.out_trade_no ?? "") || !idPattern.test(parameters.param ?? "")
    || !["alipay", "wxpay"].includes(parameters.type) || typeof parameters.name !== "string" || parameters.name.length > 100
    || typeof parameters.trade_status !== "string" || !parameters.trade_status) throw new ApiError(400, "支付回调订单无效。");
  return { pid: parameters.pid, outTradeNo: parameters.out_trade_no, tradeNo: tradeNo(parameters.trade_no), method: parameters.type as Method,
    name: parameters.name, amountMinor: amount(parameters.money), param: parameters.param };
}
async function verifyFact(env: Env, order: ZpayIdentity, fact: Fact): Promise<void> {
  if (fact.pid !== env.ZPAY_PID || fact.pid !== order.merchant_pid || fact.outTradeNo !== order.out_trade_no
    || fact.param !== order.id || fact.method !== order.method || fact.name !== order.payment_name || fact.amountMinor !== order.amount_minor
    || (order.provider_trade_no && order.provider_trade_no !== fact.tradeNo)) throw new ApiError(400, "支付通道订单与本站充值记录不一致，未发放充值点数。");
  const bound = await env.DB.prepare("SELECT recharge_order_id,subscription_order_id FROM zpay_payment_bindings WHERE provider_trade_no=?")
    .bind(fact.tradeNo).first<{ recharge_order_id: string | null; subscription_order_id: string | null }>();
  if (bound && (bound.recharge_order_id ?? bound.subscription_order_id) !== order.id) throw new ApiError(400, "支付通道交易编号已用于其他订单。");
}
async function applyPaid(env: Env, order: Order, fact: Fact, source: "notify" | "query", options: ZpayOptions): Promise<void> {
  await verifyFact(env, order, fact);
  const eventId = `zp_evt_${createHash("sha256").update(JSON.stringify([source, order.id, fact.tradeNo, fact.pid, fact.amountMinor])).digest("hex")}`;
  const nonce = crypto.randomUUID(), now = (options.now ?? Date.now)();
  const gate = "EXISTS(SELECT 1 FROM zpay_events WHERE event_id=? AND processing_token=?)";
  const results = await env.DB.batch([
    bindZpayTrade(env, "recharge", order.id, order.out_trade_no, order.merchant_pid, fact.tradeNo),
    env.DB.prepare(`INSERT INTO zpay_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
      SELECT ?,?,id,?,?,? FROM zpay_orders WHERE id=? AND (provider_trade_no IS NULL OR provider_trade_no=?)
      AND ${zpayBindingGate("recharge")} ON CONFLICT(event_id) DO NOTHING`)
      .bind(eventId, source, fact.tradeNo, nonce, now, order.id, fact.tradeNo, fact.tradeNo),
    env.DB.prepare(`UPDATE zpay_orders SET provider_trade_no=COALESCE(provider_trade_no,?),status=CASE WHEN paid_at IS NULL THEN 'paid' ELSE status END,
      paid_at=COALESCE(paid_at,?),updated_at=MAX(updated_at,?) WHERE id=? AND ${gate}`)
      .bind(fact.tradeNo, now, now, order.id, eventId, nonce),
    env.DB.prepare(`INSERT INTO zpay_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at)
      SELECT id,user_id,?,'purchase',credits,? FROM zpay_orders WHERE id=? AND paid_at IS NOT NULL AND ${gate}
      ON CONFLICT DO NOTHING`).bind(eventId, now, order.id, eventId, nonce),
  ]);
  if (!results[1].meta.changes) {
    const current = await env.DB.prepare("SELECT provider_trade_no FROM zpay_orders WHERE id=?").bind(order.id).first<{ provider_trade_no: string | null }>();
    if (current?.provider_trade_no !== fact.tradeNo) throw new ApiError(400, "支付通道交易编号与订单发生冲突。");
  }
}

async function notify(request: Request, env: Env, options: ZpayOptions): Promise<Response> {
  const parameters = callbackParameters(request, env), fact = callbackFact(parameters);
  const order = await env.DB.prepare("SELECT * FROM zpay_orders WHERE out_trade_no=?").bind(fact.outTradeNo).first<Order>();
  if (!order) throw new ApiError(400, "支付回调订单不存在。");
  await verifyFact(env, order, fact);
  // A verified notification is the provider's payment fact. Avoid an outbound
  // lookup here: Z-Pay treats replies taking longer than five seconds as failed.
  if (parameters.trade_status === "TRADE_SUCCESS") await applyPaid(env, order, fact, "notify", options);
  return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
async function browserReturn(request: Request, env: Env): Promise<Response> {
  try {
    const parameters = callbackParameters(request, env), fact = callbackFact(parameters);
    const order = await env.DB.prepare("SELECT * FROM zpay_orders WHERE out_trade_no=?").bind(fact.outTradeNo).first<Order>();
    if (!order || parameters.trade_status !== "TRADE_SUCCESS") return redirect(`${ORIGIN}/#recharge`);
    await verifyFact(env, order, fact);
    // Browser navigation never posts a payment fact or grants credits.
    return redirect(`${ORIGIN}/?payment_order=${order.id}&payment=success#recharge`);
  } catch { return redirect(`${ORIGIN}/#recharge`); }
}

async function checkout(request: Request, env: Env, user: UserRecord, options: ZpayOptions): Promise<Response> {
  requireConfiguration(env);
  const body = await readJson(request, 2048);
  if (Object.keys(body).some(key => !["provider", "method", "packageId", "accountId", "requestId", "mode"].includes(key))) throw new ApiError(400, "充值金额、点数和支付地址只能由服务端确定。");
  if (body.accountId !== user.id) throw new ApiError(401, "账户已切换，请刷新充值页面后重试。");
  if (body.provider !== "zpay" || body.mode !== "live") throw new ApiError(409, "支付通道已切换，请刷新充值页面后重试。");
  const pack = PACKAGES.find(item => item.id === body.packageId);
  if (!pack || typeof body.requestId !== "string" || !UUID.test(body.requestId) || typeof body.method !== "string"
    || !["alipay", "wxpay"].includes(body.method)) throw new ApiError(400, "请选择有效的充值套餐和支付方式。");
  const method = body.method as Method, cid = channel(env, method);
  if (!cid) throw new ApiError(503, "所选支付方式尚未开通。");
  await rateLimit(request, env, "zpay-checkout-account", 60, user.id);
  await rateLimit(request, env, "zpay-checkout-ip", 300);
  const id = `zp_${crypto.randomUUID()}`, now = (options.now ?? Date.now)();
  const outTradeNo = String(randomInt(1, 10)) + Array.from({ length: 31 }, () => String(randomInt(0, 10))).join("");
  const requestId = body.requestId.toLowerCase();
  const inserted = await env.DB.batch([env.DB.prepare(`INSERT INTO zpay_orders(id,user_id,request_id,package_id,amount_minor,credits,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,created_at,updated_at)
    SELECT ?,id,?,?,?,?,?,?,?,?,?,?,?,? FROM users WHERE id=? AND is_guest=0 ON CONFLICT(user_id,request_id) DO NOTHING`)
    .bind(id, requestId, pack.id, pack.amountMinor, pack.credits, method, outTradeNo, env.ZPAY_PID!, cid,
      `晴屿 AI 对话充值点数 · ${pack.credits} 点`, `${ORIGIN}/api/payments/zpay/checkout/${id}`, now, now, user.id),
    env.DB.prepare(`INSERT INTO zpay_payment_bindings(out_trade_no,merchant_pid,provider_trade_no,recharge_order_id)
      SELECT out_trade_no,merchant_pid,provider_trade_no,id FROM zpay_orders WHERE user_id=? AND request_id=? ON CONFLICT(out_trade_no) DO NOTHING`)
      .bind(user.id, requestId)]);
  const order = await env.DB.prepare("SELECT * FROM zpay_orders WHERE user_id=? AND request_id=?").bind(user.id, requestId).first<Order>();
  if (!order) throw new ApiError(403, "请使用正式账户充值。");
  if (order.package_id !== pack.id || order.method !== method || order.merchant_pid !== env.ZPAY_PID || order.channel_id !== cid) throw new ApiError(409, "该充值请求编号已用于其他套餐或支付方式。");
  return json({ accountId: user.id, provider: "zpay", mode: "live", testMode: false, order: orderValue(order), checkoutUrl: order.checkout_url }, inserted[0].meta.changes === 1 ? 201 : 200);
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
export function renderZpayForm(parameters: Record<string, string>, key: string, title = "晴屿充值"): Response {
  parameters.sign = zpaySignature(parameters, key);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const fields = Object.entries(parameters).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><p>正在前往${parameters.type === "alipay" ? "支付宝" : "微信支付"}收银台…</p><form id="payment" method="post" action="https://zpayz.cn/submit.php">${fields}<button type="submit">继续支付 ¥${escapeHtml(parameters.money)}</button></form><script nonce="${nonce}">document.getElementById("payment").submit();</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Content-Security-Policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action https://zpayz.cn https://api.z-pay.cn; script-src 'nonce-${nonce}'` } });
}
async function checkoutForm(env: Env, user: UserRecord, id: string): Promise<Response> {
  requireConfiguration(env);
  if (env.PAYMENT_PROVIDER !== "zpay") throw new ApiError(503, "支付通道已切换，请返回充值页面。");
  const order = await env.DB.prepare("SELECT * FROM zpay_orders WHERE id=? AND user_id=?").bind(id, user.id).first<Order>();
  if (!order) throw new ApiError(404, "充值订单不存在。");
  if (order.merchant_pid !== env.ZPAY_PID || order.channel_id !== channel(env, order.method)) throw new ApiError(503, "该订单的支付通道已变更，请返回充值页面。");
  if (order.paid_at !== null) return redirect(`${ORIGIN}/?payment_order=${order.id}&payment=success#recharge`);
  const parameters: Record<string, string> = { pid: order.merchant_pid, cid: order.channel_id, type: order.method, name: order.payment_name,
    money: money(order.amount_minor), out_trade_no: order.out_trade_no, notify_url: `${ORIGIN}/api/payments/zpay/notify`,
    return_url: `${ORIGIN}/api/payments/zpay/return`, param: order.id, sign_type: "MD5" };
  return renderZpayForm(parameters, env.ZPAY_KEY!);
}

async function queryOrder(env: Env, order: ZpayIdentity, options: ZpayOptions): Promise<{ fact: Fact; paid: boolean } | null> {
  requireCredentials(env);
  const url = `https://zpayz.cn/api.php?${new URLSearchParams({ act: "order", pid: env.ZPAY_PID!, key: env.ZPAY_KEY!, out_trade_no: order.out_trade_no })}`;
  let response: Response;
  // Z-Pay's gateway can return an undocumented envelope for JSON-only Accept.
  try { response = await (options.zpayFetch ?? fetch)(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(4000), headers: { Accept: "*/*" } }); }
  catch { throw new ApiError(503, "支付状态暂时无法核对，请稍后刷新订单。"); }
  if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > 65536) { await response.body?.cancel(); throw new ApiError(503, "支付状态暂时无法核对，请稍后刷新订单。"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new ApiError(502, "支付通道查询数据无效。"); }
      chunks.push(part.value);
    }
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, "支付状态暂时无法核对，请稍后刷新订单。"); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  let value: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); value = parsed as Record<string, unknown>;
  } catch { throw new ApiError(502, "支付通道查询数据无效。"); }
  if (value.code !== 1 && value.code !== "1") return null;
  const pid = typeof value.pid === "string" ? value.pid : typeof value.pid === "number" && Number.isSafeInteger(value.pid) ? String(value.pid) : "";
  if (![0, 1, "0", "1"].includes(value.status as number | string) || typeof value.type !== "string"
    || !["alipay", "wxpay"].includes(value.type)) throw new ApiError(502, "支付通道查询状态无效。");
  const fact: Fact = { pid, outTradeNo: typeof value.out_trade_no === "string" ? value.out_trade_no : "", tradeNo: tradeNo(value.trade_no),
    method: value.type as Method, name: typeof value.name === "string" ? value.name : "", amountMinor: amount(value.money), param: typeof value.param === "string" ? value.param : "" };
  await verifyFact(env, order, fact);
  return { fact, paid: value.status === 1 || value.status === "1" };
}

export { configured as zpayConfigured, credentialsConfigured as zpayCredentialsConfigured, methods as zpayMethods, channel as zpayChannel,
  callbackParameters as zpayCallbackParameters, callbackFact as zpayCallbackFact, verifyFact as verifyZpayFact, queryOrder as queryZpayOrder };

export async function handleZpayPayments(request: Request, env: Env, suppliedUser?: UserRecord | null, options: ZpayOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/payments/zpay/notify" || path === "/v1/payments/zpay/return") {
    if (request.method !== "GET") throw new ApiError(405, "支付回调仅支持 GET。");
    return path.endsWith("/notify") ? notify(request, env, options) : browserReturn(request, env);
  }
  const form = /^\/v1\/payments\/zpay\/checkout\/([^/]+)$/.exec(path);
  if (form) {
    if (request.method !== "GET") throw new ApiError(405, "支付页面仅支持 GET。");
    if (!ZPAY_ORDER_ID.test(form[1])) throw new ApiError(404, "充值订单不存在。");
    const user = suppliedUser ?? await requireUser(request, env);
    if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用充值功能。");
    return checkoutForm(env, user, form[1]);
  }
  if (env.PAYMENT_PROVIDER !== "zpay") return null;
  if (path === "/v1/payments/config") {
    if (request.method !== "GET") throw new ApiError(405, "充值配置仅支持 GET。");
    const enabled = paymentCollectionEnabled(env) && configured(env);
    const linked = creditBillingConfig(env).enabled;
    return json({ provider: "zpay", enabled, mode: "live", testMode: false, modelBillingLinked: linked, currency: "cny", packages: PACKAGES, methods: methods(env),
      note: !paymentCollectionEnabled(env) ? PAYMENT_PAUSED_NOTE
        : enabled ? `支付宝 / 微信正式支付，将以人民币真实扣款；充值 Credit 与任务、邀请奖励进入同一聊天余额，${linked ? "用于模型对话与剧情记忆的 Token 费用" : "目前不抵扣模型费用"}。退款需联系管理员人工处理并核对结果。`
          : "支付宝 / 微信充值尚未开通，正在等待支付通道配置完成。退款需联系管理员人工处理并核对结果。" });
  }
  const user = suppliedUser ?? await requireUser(request, env);
  if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用充值功能。");
  if (path === "/v1/payments/checkout") {
    if (request.method !== "POST") throw new ApiError(405, "创建收银台仅支持 POST。");
    return checkout(request, env, user, options);
  }
  if (path === "/v1/payments/wallet") {
    if (request.method !== "GET") throw new ApiError(405, "充值余额仅支持 GET。");
    return json(await liveWallet(env, user, "zpay"));
  }
  const detail = /^\/v1\/payments\/orders\/([^/]+)$/.exec(path);
  if (detail) {
    if (request.method !== "GET") throw new ApiError(405, "充值订单仅支持 GET。");
    if (ZPAY_ORDER_ID.test(detail[1])) {
      const order = await env.DB.prepare("SELECT * FROM zpay_orders WHERE id=? AND user_id=?").bind(detail[1], user.id).first<Order>();
      if (!order) throw new ApiError(404, "充值订单不存在。");
      if (order.paid_at === null && credentialsConfigured(env)) {
        await rateLimit(request, env, "zpay-order-query-account", 120, user.id);
        const result = await queryOrder(env, order, options);
        if (result?.paid) await applyPaid(env, order, result.fact, "query", options);
      }
    } else if (!/^pay_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(detail[1])) throw new ApiError(404, "充值订单不存在。");
    return json(await liveWallet(env, user, "zpay", detail[1]));
  }
  throw new ApiError(404, "充值接口不存在。");
}
