import { requireUser } from "./auth";
import { ApiError, json, readJson } from "./http";
import { paymentCollectionEnabled } from "./payment-availability";
import type { Env, UserRecord } from "./types";

/**
 * Waffo Pancake adapter boundary.
 *
 * The adapter is intentionally closed by default. Its API calls and webhook
 * verifier are implemented here so enabling it is a configuration and
 * acceptance decision, rather than a frontend-only redirect. No Waffo secret
 * is ever returned by these handlers.
 */
export const WAFFO_PROVIDER = "waffo" as const;
export const WAFFO_DEFAULT_ENVIRONMENT = "sandbox" as const;
// The adapter implementation is complete. Opening it still requires the
// explicit sandbox acceptance gate below, or the independent production gate.
export const WAFFO_ADAPTER_READY = true as const;

// Waffo currently uses the Pancake host in API documentation and the
// cashier-sandbox host for test sessions. Keep an explicit allow-list rather
// than accepting arbitrary provider-looking URLs from a response.
const CHECKOUT_HOSTS = new Set(["pancake.waffo.ai", "pancake-sandbox.waffo.ai", "cashier.waffo.com", "cashier-sandbox.waffo.com"]);
const MAX_WEBHOOK_BYTES = 256 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PRODUCT_ID = /^PROD_[A-Za-z0-9]{22}$/;
const STORE_ID = /^STO_[A-Za-z0-9]{22}$/;

type WaffoEnvironment = Pick<Env,
  "PAYMENT_PROVIDER" | "PAYMENTS_ACCEPTING_ENABLED" | "WAFFO_ENABLED" | "WAFFO_ENVIRONMENT"
  | "WAFFO_API_BASE_URL" | "WAFFO_MERCHANT_ID" | "WAFFO_PRIVATE_KEY" | "WAFFO_API_KEY" | "WAFFO_PUBLIC_KEY" | "WAFFO_SANDBOX_ACCEPTANCE_ENABLED" | "WAFFO_SANDBOX_ACCOUNT_ID"
  | "WAFFO_STORE_ID" | "WAFFO_PRODUCT_ID" | "WAFFO_WEBHOOK_TEST_PUBLIC_KEY" | "WAFFO_WEBHOOK_PROD_PUBLIC_KEY">;

type WaffoOptions = { waffoFetch?: typeof fetch; now?: () => number };
type Obj = Record<string, unknown>;
type WaffoOrder = { id: string; user_id: string; request_id: string; plan_id: string; plan_revision: number; label: string; amount_minor: number; currency: string; duration_days: number; daily_credits: number; max_claims: number; timezone: string; method: string; status: string; checkout_url: string; created_at: number; updated_at: number; paid_at: number | null; provider_trade_no: string | null; subscription_id: string | null };
const object = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const printableSecret = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e\s]{16,8192}$/.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const plan = Object.freeze({ id: "vip_monthly_cny", revision: 1, label: "晴屿 VIP 人民币月卡", amountMinor: 2800, currency: "cny", durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: "Asia/Shanghai" });

function validApiBaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  } catch { return false; }
}

function environment(value: unknown): "sandbox" | "live" { return value === "live" || value === "prod" ? "live" : WAFFO_DEFAULT_ENVIRONMENT; }
function apiEnvironment(value: unknown): "test" | "prod" { return environment(value) === "live" ? "prod" : "test"; }

export function waffoCredentialsConfigured(env: WaffoEnvironment): boolean {
  return printableSecret(env.WAFFO_MERCHANT_ID) && printableSecret(env.WAFFO_PRIVATE_KEY)
    && validApiBaseUrl(env.WAFFO_API_BASE_URL) && PRODUCT_ID.test(env.WAFFO_PRODUCT_ID ?? "") && STORE_ID.test(env.WAFFO_STORE_ID ?? "");
}

// Waffo is an additional provider. Do not overload the legacy global
// PAYMENT_PROVIDER selector: NOWPayments/Stripe and Waffo may coexist.
function configured(env: WaffoEnvironment): boolean { return env.WAFFO_ENABLED === "true" && waffoCredentialsConfigured(env); }
function sandboxAccountConfigured(env: WaffoEnvironment): boolean { return UUID.test(env.WAFFO_SANDBOX_ACCOUNT_ID ?? ""); }

export function waffoConfiguration(env: WaffoEnvironment) {
  const collectionEnabled = paymentCollectionEnabled(env);
  const mode = environment(env.WAFFO_ENVIRONMENT);
  const sandboxAcceptanceEnabled = env.WAFFO_SANDBOX_ACCEPTANCE_ENABLED === "true" && mode === "sandbox";
  const readyForOrders = configured(env) && WAFFO_ADAPTER_READY && (collectionEnabled || (sandboxAcceptanceEnabled && sandboxAccountConfigured(env)));
  return {
    provider: WAFFO_PROVIDER,
    mode,
    enabled: readyForOrders,
    collectionEnabled,
    sandboxAcceptanceEnabled,
    renewal: "manual" as const,
    autoRenew: false,
    // Pancake's CNY product is one-time; the user manually renews monthly.
    plan,
    note: readyForOrders ? (mode === "live" ? "Waffo 生产收款已开放；CNY ¥28 一次性购买，付款后手动续订。" : "Waffo 沙盒验收通道已临时开放；请仅使用隔离账户测试。") : "Waffo 收款尚未开放；生产收款开关保持关闭。",
  };
}

function base64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function decodeBase64(value: string): Uint8Array { const binary = atob(value.replace(/\s+/g, "")); const output = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index); return output; }

function pemBytes(value: string, kind: "private" | "public"): Uint8Array {
  const label = kind === "private" ? "(?:RSA )?PRIVATE KEY" : "(?:RSA )?PUBLIC KEY";
  const body = value.replace(new RegExp(`-----BEGIN ${label}-----`, "g"), "").replace(new RegExp(`-----END ${label}-----`, "g"), "").replace(/\\n/g, "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) throw new ApiError(503, "Waffo 密钥格式尚未配置完成。", { code: "waffo_key_invalid" });
  try { return decodeBase64(body); } catch { throw new ApiError(503, "Waffo 密钥格式尚未配置完成。", { code: "waffo_key_invalid" }); }
}

async function signRequest(method: string, path: string, timestamp: string, body: string, privateKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const bodyHash = base64(new Uint8Array(digest));
  const canonical = new TextEncoder().encode(`${method}\n${path}\n${timestamp}\n${bodyHash}`);
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey("pkcs8", pemBytes(privateKey, "private"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); }
  catch { throw new ApiError(503, "Waffo 私钥格式尚未配置完成。", { code: "waffo_key_invalid" }); }
  return base64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, canonical)));
}

function publicKeys(env: WaffoEnvironment): string[] {
  const key = environment(env.WAFFO_ENVIRONMENT) === "live" ? env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY : env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
  return [key, env.WAFFO_PUBLIC_KEY].filter((item): item is string => nonEmpty(item));
}

function parseSignature(value: string | null): { timestamp: number; signature: Uint8Array } {
  const match = /^\s*t=(\d+),\s*v1=([A-Za-z0-9+/=_-]+)\s*$/.exec(value ?? "");
  if (!match) throw new ApiError(401, "Waffo 付款通知签名无效。", { code: "waffo_webhook_signature_invalid" });
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new ApiError(401, "Waffo 付款通知签名无效。", { code: "waffo_webhook_signature_invalid" });
  try { return { timestamp, signature: decodeBase64(match[2].replace(/-/g, "+").replace(/_/g, "/")) }; }
  catch { throw new ApiError(401, "Waffo 付款通知签名无效。", { code: "waffo_webhook_signature_invalid" }); }
}

async function verifyWithKey(payload: string, signature: Uint8Array, publicKey: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", pemBytes(publicKey, "public"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(payload));
  } catch { return false; }
}

/** Verify an untouched Waffo raw body. Waffo signs `${timestamp}.${rawBody}`. */
export async function verifyWaffoWebhook(rawBody: string, signatureHeader: string | null, env: WaffoEnvironment, now = Date.now()): Promise<Obj> {
  if (rawBody.length > MAX_WEBHOOK_BYTES) throw new ApiError(413, "Waffo 付款通知请求过大。", { code: "waffo_webhook_too_large" });
  const parsed = parseSignature(signatureHeader);
  // Pancake SDK v0.26 uses epoch milliseconds; accept older second-based test
  // deliveries as well so retries from either Sandbox contract remain safe.
  const timestampMs = parsed.timestamp < 1_000_000_000_000 ? parsed.timestamp * 1000 : parsed.timestamp;
  if (Math.abs(now - timestampMs) > 45 * 60 * 1000) throw new ApiError(401, "Waffo 付款通知已过期。", { code: "waffo_webhook_expired" });
  const payload = `${parsed.timestamp}.${rawBody}`; let valid = false;
  for (const key of publicKeys(env)) if (await verifyWithKey(payload, parsed.signature, key)) { valid = true; break; }
  if (!valid) throw new ApiError(401, "Waffo 付款通知签名无效。", { code: "waffo_webhook_signature_invalid" });
  let value: unknown; try { value = JSON.parse(rawBody); } catch { throw new ApiError(400, "Waffo 付款通知格式无效。", { code: "waffo_webhook_invalid_json" }); }
  if (!object(value)) throw new ApiError(400, "Waffo 付款通知格式无效。", { code: "waffo_webhook_invalid_json" });
  return value;
}

async function readRaw(request: Request): Promise<string> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) throw new ApiError(413, "Waffo 付款通知请求过大。", { code: "waffo_webhook_too_large" });
  if (!request.body) throw new ApiError(400, "Waffo 付款通知请求体为空。", { code: "waffo_webhook_invalid_body" });
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_WEBHOOK_BYTES) { await reader.cancel(); throw new ApiError(413, "Waffo 付款通知请求过大。", { code: "waffo_webhook_too_large" }); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new ApiError(400, "Waffo 付款通知编码无效。", { code: "waffo_webhook_invalid_body" }); }
}

// Provider notices can contain buyer data, tokens or signed URLs. Return only
// a fixed stage/status reference and documented layer, never free-form text.
const PROVIDER_LAYERS = new Set(["gateway", "user", "store", "product", "order", "ticket", "graphql", "resource"]);
function providerLayer(value: Obj): string | null {
  if (!Array.isArray(value.errors)) return null;
  for (const entry of value.errors) {
    if (object(entry) && typeof entry.layer === "string" && PROVIDER_LAYERS.has(entry.layer)) return entry.layer;
  }
  return null;
}

async function signedPost(env: WaffoEnvironment, path: string, body: Obj, options: WaffoOptions = {}, idempotencyKey?: string): Promise<Obj> {
  if (!env.WAFFO_API_BASE_URL || !env.WAFFO_MERCHANT_ID || !env.WAFFO_PRIVATE_KEY) throw new ApiError(503, "Waffo 商户密钥尚未配置完成。", { code: "waffo_credentials_missing" });
  const stage = path === "/v1/actions/auth/issue-session-token" ? "auth-token" : "checkout-session";
  const reference = stage === "auth-token" ? "WF-AUTH" : "WF-CHECKOUT";
  const bodyText = JSON.stringify(body); const timestamp = Math.floor((options.now ?? Date.now)() / 1000).toString(); const signature = await signRequest("POST", path, timestamp, bodyText, env.WAFFO_PRIVATE_KEY);
  let response: Response;
  try { response = await (options.waffoFetch ?? fetch)(`${env.WAFFO_API_BASE_URL.replace(/\/$/, "")}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Merchant-Id": env.WAFFO_MERCHANT_ID, "X-Timestamp": timestamp, "X-Signature": signature, "X-Environment": apiEnvironment(env.WAFFO_ENVIRONMENT), ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}) }, body: bodyText }); }
  catch { throw new ApiError(503, "Waffo 收款服务暂时不可用，请稍后重试。", { code: "waffo_provider_unavailable", stage, outcome: "unknown" }); }
  let value: unknown; try { value = await response.json(); } catch { throw new ApiError(502, "Waffo 收款服务返回了无效数据。", { code: "waffo_provider_invalid_response", outcome: "unknown" }); }
  if (!object(value)) throw new ApiError(502, "Waffo 收款服务返回了无效数据。", { code: "waffo_provider_invalid_response", outcome: "unknown" });
  if (!response.ok || (Array.isArray(value.errors) && value.errors.length > 0)) {
    const layer = providerLayer(value);
    const referenceId = `${reference}-${response.status}${layer ? `-${layer}` : ""}`;
    const approvalRequired = Array.isArray(value.errors) && value.errors.some(entry => object(entry)
      && entry.layer === "order" && entry.message === "Store is not approved for production payments");
    const message = approvalRequired ? "商户尚未通过 Waffo 正式收款审核，暂时无法付款"
      : stage === "auth-token" ? "收款服务暂时无法验证商户身份" : "收款服务暂时无法创建支付页面";
    throw new ApiError(503, `${message}，请联系站点管理员。参考编号：${referenceId}`, {
      code: "waffo_provider_rejected", stage,
      ...(approvalRequired ? { reason: "store_not_approved" } : {}),
      outcome: [400, 401, 403, 422].includes(response.status) ? "rejected" : "unknown",
      providerStatus: response.status,
      ...(layer ? { providerLayer: layer } : {}),
    });
  }
  return value;
}

function data(value: Obj): Obj { return object(value.data) ? value.data : value; }
function checkoutUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new ApiError(502, "Waffo 未返回有效收银台地址。", { code: "waffo_provider_invalid_response" });
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || !CHECKOUT_HOSTS.has(url.hostname)) throw new Error(); return value; }
  catch { throw new ApiError(502, "Waffo 未返回有效收银台地址。", { code: "waffo_provider_invalid_response" }); }
}

// Pancake returns an ISO 8601 string; the browser contract uses epoch ms.
// Validate before persisting the order so a malformed response stays retryable.
function checkoutExpiry(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const milliseconds = typeof value === "number" ? value
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 8640000000000000) {
    throw new ApiError(502, "Waffo 未返回有效收银台到期时间。", { code: "waffo_provider_invalid_response", stage: "checkout-session", outcome: "unknown" });
  }
  return milliseconds;
}

function numericTradeNo(): string {
  return BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`).toString().padStart(32, "0").slice(-32);
}

function orderValue(order: WaffoOrder, mode: "sandbox" | "live") {
  return { provider: WAFFO_PROVIDER, mode, renewal: "manual", id: order.id, accountId: order.user_id, requestId: order.request_id,
    planId: order.plan_id, planRevision: order.plan_revision, label: order.label, amountMinor: order.amount_minor, currency: order.currency,
    durationDays: order.duration_days, dailyCredits: order.daily_credits, maxClaims: order.max_claims, timezone: order.timezone, method: order.method,
    status: order.status, checkoutUrl: order.checkout_url, createdAt: order.created_at, updatedAt: order.updated_at, paidAt: order.paid_at,
    autoRenew: false,
    subscriptionId: order.subscription_id, membershipActivated: order.paid_at !== null && order.subscription_id !== null };
}

function decimalMinor(value: unknown): number {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) throw new ApiError(400, "Waffo 付款通知金额无效。", { code: "waffo_webhook_amount_invalid" });
  const [whole, fraction = ""] = text.split("."); const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new ApiError(400, "Waffo 付款通知金额无效。", { code: "waffo_webhook_amount_invalid" });
  return minor;
}

async function reconcileEvent(env: Env, event: Obj, now: number) {
  const eventId = typeof event.id === "string" && /^[\x20-\x7e]{1,200}$/.test(event.id) ? event.id : null;
  const eventType = typeof event.eventType === "string" ? event.eventType : "";
  const expectedMode = environment(env.WAFFO_ENVIRONMENT) === "sandbox" ? "test" : "prod";
  if (event.mode !== undefined && event.mode !== expectedMode) return { received: true, processed: false, eventId, reason: "waffo_event_mode_mismatch" };
  if (event.storeId !== undefined && event.storeId !== env.WAFFO_STORE_ID) return { received: true, processed: false, eventId, reason: "waffo_event_store_mismatch" };
  const value = object(event.data) ? event.data : null;
  if (!eventId || !value) throw new ApiError(400, "Waffo 付款通知缺少订单信息。", { code: "waffo_webhook_invalid_event" });
  const requestId = typeof value.orderMerchantExternalId === "string" ? value.orderMerchantExternalId.toLowerCase() : "";
  if (!UUID.test(requestId)) return { received: true, processed: false, eventId, reason: "waffo_order_reference_missing" };
  const order = await env.DB.prepare(`SELECT o.*,p.id AS subscription_id FROM subscription_orders o LEFT JOIN subscription_periods p ON p.order_id=o.id WHERE o.provider='waffo' AND o.request_id=?`).bind(requestId).first<WaffoOrder>();
  if (!order) return { received: true, processed: false, eventId, reason: "waffo_order_not_found" };
  if (environment(env.WAFFO_ENVIRONMENT) === "sandbox" && order.user_id !== env.WAFFO_SANDBOX_ACCOUNT_ID) return { received: true, processed: false, eventId, reason: "waffo_sandbox_account_mismatch" };
  const providerTradeNo = typeof value.orderId === "string" ? value.orderId : eventId;
  if (!/^[\x20-\x7e]{1,200}$/.test(providerTradeNo)) throw new ApiError(400, "Waffo 付款通知交易编号无效。", { code: "waffo_webhook_trade_invalid" });
  const completed = eventType === "order.completed" || eventType === "onetime_order.completed";
  const failed = eventType === "order.failed" || eventType === "order.canceled" || eventType === "onetime_order.canceled";
  if (!completed && !failed) return { received: true, processed: false, eventId, reason: "waffo_event_ignored" };
  if (completed) {
    if (value.currency !== undefined && value.currency !== "CNY") throw new ApiError(400, "Waffo 付款通知币种不一致。", { code: "waffo_webhook_currency_mismatch" });
    const amount = value.chargedAmount ?? value.amount ?? value.total;
    if (decimalMinor(amount) !== plan.amountMinor) throw new ApiError(400, "Waffo 付款通知金额不一致。", { code: "waffo_webhook_amount_mismatch" });
    if (value.productId !== undefined && value.productId !== env.WAFFO_PRODUCT_ID) throw new ApiError(400, "Waffo 付款通知商品不一致。", { code: "waffo_webhook_product_mismatch" });
  }
  const processingToken = crypto.randomUUID();
  const eventGate = "EXISTS(SELECT 1 FROM subscription_events WHERE event_id=? AND processing_token=?)";
  const eligible = completed ? "status IN ('pending','paid','failed')" : "status='pending'";
  const statements = [
    env.DB.prepare(`INSERT INTO subscription_events(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
      SELECT ?,'notify',id,?,?,? FROM subscription_orders WHERE id=? AND provider='waffo' AND ${eligible}
      AND (provider_trade_no IS NULL OR provider_trade_no=?) ON CONFLICT(event_id) DO NOTHING`).bind(eventId, providerTradeNo, processingToken, now, order.id, providerTradeNo),
    env.DB.prepare(`UPDATE subscription_orders SET provider_trade_no=COALESCE(provider_trade_no,?),status=CASE WHEN ?='paid' THEN 'paid' WHEN status='pending' THEN 'failed' ELSE status END,paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END,updated_at=MAX(updated_at,?) WHERE id=? AND provider='waffo' AND ${eventGate}`).bind(providerTradeNo, completed ? "paid" : "failed", completed ? "paid" : "failed", now, now, order.id, eventId, processingToken),
  ];
  if (completed) statements.push(env.DB.prepare(`INSERT INTO subscription_periods(id,user_id,order_id,source_event_id,starts_at,expires_at,created_at)
      SELECT ?,user_id,id,?,MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?)),
      MAX(?,COALESCE((SELECT MAX(p.expires_at) FROM subscription_periods p WHERE p.user_id=subscription_orders.user_id AND p.revoked_at IS NULL),?))+duration_days*86400000,?
      FROM subscription_orders WHERE id=? AND provider='waffo' AND paid_at IS NOT NULL AND ${eventGate} ON CONFLICT(order_id) DO NOTHING`).bind(`sub_${crypto.randomUUID()}`, eventId, now, now, now, now, now, order.id, eventId, processingToken));
  const results = await env.DB.batch(statements);
  return { received: true, processed: results[0].meta.changes === 1, eventId, reason: completed ? "waffo_order_reconciled" : "waffo_order_failed" };
}

async function checkout(request: Request, env: Env, user: UserRecord, options: WaffoOptions) {
  const config = waffoConfiguration(env);
  if (!config.enabled) throw new ApiError(503, config.note, { code: "waffo_not_ready" });
  const body = await readJson(request, 4096);
  if (Object.keys(body).some(key => !["accountId", "requestId", "provider", "mode"].includes(key)) || body.accountId !== user.id || typeof body.requestId !== "string" || !UUID.test(body.requestId) || body.provider !== "waffo" || body.mode !== config.mode) throw new ApiError(409, "Waffo 会员方案或账户已改变，请刷新后重试。", { code: "waffo_checkout_mismatch" });
  if (user.isGuest) throw new ApiError(403, "请先注册或登录正式账户，再使用订阅功能。");
  if (config.mode === "sandbox" && user.id !== env.WAFFO_SANDBOX_ACCOUNT_ID) throw new ApiError(403, "当前 Sandbox 仅允许隔离验收账户使用。");
  const requestId = body.requestId.toLowerCase();
  const tokenResult = data(await signedPost(env, "/v1/actions/auth/issue-session-token", { productId: env.WAFFO_PRODUCT_ID, buyerIdentity: user.id }, options));
  const token = typeof tokenResult.token === "string" ? tokenResult.token : null;
  if (!token) throw new ApiError(502, "Waffo 未返回有效登录令牌。", { code: "waffo_provider_invalid_response" });
  const sessionResult = data(await signedPost(env, "/v1/actions/checkout/create-session", { productId: env.WAFFO_PRODUCT_ID, currency: "CNY", buyerEmail: user.email ?? undefined, successUrl: `https://qingyu.invalid/?waffo_request=${encodeURIComponent(requestId)}#recharge`, metadata: { xumengRequestId: requestId, xumengAccountId: user.id }, orderMerchantExternalId: requestId, language: "zh-Hans", includePaymentMethods: ["wechat"] }, options, requestId));
  const url = checkoutUrl(sessionResult.checkoutUrl);
  const expiresAt = checkoutExpiry(sessionResult.expiresAt);
  const now = (options.now ?? Date.now)(); const orderId = `sp_${crypto.randomUUID()}`;
  const result = await env.DB.prepare(`INSERT INTO subscription_orders(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,currency,duration_days,daily_credits,max_claims,timezone,
      method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,created_at,updated_at,provider,amount_scale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,'waffo',2)
      ON CONFLICT(user_id,request_id) DO UPDATE SET checkout_url=CASE WHEN subscription_orders.status='pending' THEN excluded.checkout_url ELSE subscription_orders.checkout_url END,updated_at=MAX(subscription_orders.updated_at,excluded.updated_at)`)
    .bind(orderId, user.id, requestId, plan.id, plan.revision, plan.label, plan.amountMinor, plan.currency, plan.durationDays, plan.dailyCredits, plan.maxClaims, plan.timezone, "wechat", numericTradeNo(), `晴屿 AI 对话月卡 · ${plan.label}`, url, now, now).run();
  const order = await env.DB.prepare(`SELECT o.*,p.id AS subscription_id FROM subscription_orders o LEFT JOIN subscription_periods p ON p.order_id=o.id WHERE o.provider='waffo' AND o.user_id=? AND o.request_id=?`).bind(user.id, requestId).first<WaffoOrder>();
  if (!order) throw new ApiError(503, "Waffo 订单保存失败，请恢复订单后重试。", { code: "waffo_order_persist_failed", outcome: "unknown" });
  return json({ provider: WAFFO_PROVIDER, mode: config.mode, renewal: "manual", autoRenew: false, accountId: user.id, requestId, order: orderValue(order, config.mode), checkoutUrl: `${url}#token=${encodeURIComponent(token)}`, expiresAt }, result.meta.changes === 1 ? 201 : 200, { "Referrer-Policy": "no-referrer" });
}

async function webhook(request: Request, env: Env, options: WaffoOptions) {
  const body = await readRaw(request); const event = await verifyWaffoWebhook(body, request.headers.get("x-waffo-signature"), env, (options.now ?? Date.now)());
  // Closed adapter: valid callbacks are acknowledged but cannot grant rights.
  if (!waffoConfiguration(env).enabled) return json({ received: true, processed: false, eventId: typeof event.id === "string" ? event.id : null, reason: "waffo_adapter_not_ready" });
  return json(await reconcileEvent(env, event, (options.now ?? Date.now)()));
}

async function requestReceipt(request: Request, env: Env, user: UserRecord) {
  const match = /^\/v1\/waffo\/requests\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match || !UUID.test(match[1])) throw new ApiError(400, "请提供有效的 Waffo 请求编号。", { code: "waffo_request_invalid" });
  const requestId = match[1].toLowerCase();
  const order = await env.DB.prepare(`SELECT o.*,p.id AS subscription_id FROM subscription_orders o LEFT JOIN subscription_periods p ON p.order_id=o.id
    WHERE o.provider='waffo' AND o.user_id=? AND o.request_id=?`).bind(user.id, requestId).first<WaffoOrder>();
  return json({ provider: WAFFO_PROVIDER, mode: environment(env.WAFFO_ENVIRONMENT), accountId: user.id, requestId, order: order ? orderValue(order, environment(env.WAFFO_ENVIRONMENT)) : null });
}

/** Read-only status, gated checkout, and signed callback entry points. */
export async function handleWaffo(request: Request, env: Env, options: WaffoOptions = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/waffo/config") { if (request.method !== "GET") throw new ApiError(405, "Waffo 配置仅支持 GET。"); return json(waffoConfiguration(env)); }
  if (path === "/v1/payments/waffo/webhook") { if (request.method !== "POST") throw new ApiError(405, "Waffo 回调仅支持 POST。"); return webhook(request, env, options); }
  if (path.startsWith("/v1/waffo/requests/")) { if (request.method !== "GET") throw new ApiError(405, "Waffo 订单查询仅支持 GET。"); return requestReceipt(request, env, await requireUser(request, env)); }
  if (path !== "/v1/waffo/checkout") return null;
  if (request.method !== "POST") throw new ApiError(405, "Waffo 购买仅支持 POST。");
  return checkout(request, env, await requireUser(request, env), options);
}
