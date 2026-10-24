import { dzmmModelCostPolicy, findDzmmProviderModel } from "../../../src/lib/dzmm-models";
import { digest, tokenFrom } from "./auth";
import { ApiError } from "./http";
import type { Env, UserRecord } from "./types";
import { chargeDzmmCreditTokens, chargeDzmmProviderCostUsd, parseDzmmCreditCostPolicy, parseDzmmCreditRate,
  parseDzmmProviderCostUsd, reserveDzmmCreditCost, type DzmmCreditCostPolicy } from "../../../src/lib/dzmm-credit-pricing";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/;
// Use the same clock as the spendable-balance view inside mutation statements.
// A timestamp captured before an await must never charge an already freed hold.
const SQL_NOW_MS = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export const CREDIT_RESERVATION_TTL_MS = 600000;
export type CreditOperation = "chat" | "memory";
export type CreditBillingConfig = { enabled: boolean; revision: number | null; inputCreditsPer1000: number | null;
  outputCreditsPer1000: number | null; costPolicy?: DzmmCreditCostPolicy };
export type CreditUsageRequest = {
  requestId: string; operation: CreditOperation; model: string; requestFingerprint: string;
  inputTokenUpperBound: number; maxOutputTokens: number;
};
export type CreditUsageReceipt = {
  id: string; accountId: string; requestId: string; operation: CreditOperation; model: string; priceRevision: number;
  inputCreditsPer1000: number; outputCreditsPer1000: number;
  status: "reserved" | "pending" | "settled" | "released"; reservedCredits: number; chargedCredits: number; returnedCredits: number;
  hasValidOutput: boolean; promptTokens: number | null; completionTokens: number | null; usageExceedsReservation: boolean;
  outcome: "completed" | "failed" | "cancelled" | "expired" | null;
  releaseReason: "no_valid_output" | "usage_timeout" | "request_timeout" | null;
  createdAt: number; expiresAt: number; finalizedAt: number | null;
  costPolicy?: DzmmCreditCostPolicy; providerCostUsd?: number; billingExempt?: boolean;
};
export type CreditUsageFinalization = {
  reservationId: string; accountId: string; claimToken: string; outcome: "completed" | "failed" | "cancelled";
  hasValidOutput: boolean; usage?: { promptTokens: number; completionTokens: number; providerCostUsd?: number }; generationId?: string;
};
export type CreditPendingRequest = {
  reservationId: string; accountId: string; claimToken: string; generationId: string; model: string;
  outcome: "completed" | "failed" | "cancelled"; createdAt: number; expiresAt: number;
  costPolicy?: DzmmCreditCostPolicy;
};
type Options = { now?: () => number };
export type UsageRow = {
  id: string; user_id: string; request_id: string; operation: CreditOperation; model: string; request_fingerprint: string;
  price_revision: number; input_rate: number; output_rate: number; input_token_upper_bound: number; max_output_tokens: number;
  reserved_credits: number; status: CreditUsageReceipt["status"]; charged_credits: number; has_valid_output: number;
  prompt_tokens: number | null; completion_tokens: number | null; usage_exceeds_reservation: number;
  outcome: CreditUsageReceipt["outcome"]; release_reason: CreditUsageReceipt["releaseReason"];
  generation_id: string | null; reconciliation_token: string | null;
  created_at: number; expires_at: number; finalized_at: number | null;
  cost_policy_json?: string | null; provider_cost_usd?: number | null;
};
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new ApiError(400, "计费请求格式无效，金额只能由服务端确定。");
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
export function creditBillingConfig(env: Env): CreditBillingConfig {
  const closed = { enabled: false, revision: null, inputCreditsPer1000: null, outputCreditsPer1000: null };
  const source = env.CREDIT_BILLING_RATES_JSON;
  if (env.CREDIT_BILLING_ENABLED !== "true" || !source || source.length > 2048) return closed;
  try {
    const parsed = record(JSON.parse(source), ["revision", "inputCreditsPer1000", "outputCreditsPer1000"]);
    const inputRate = parseDzmmCreditRate(parsed.inputCreditsPer1000), outputRate = parseDzmmCreditRate(parsed.outputCreditsPer1000);
    if (!integer(parsed.revision, 1, 1000000) || inputRate === undefined || outputRate === undefined) return closed;
    let costPolicy: DzmmCreditCostPolicy | undefined;
    if (env.CREDIT_BILLING_COST_POLICY_JSON !== undefined) {
      const policySource = env.CREDIT_BILLING_COST_POLICY_JSON;
      if (!policySource || policySource.length > 2048) return closed;
      costPolicy = parseDzmmCreditCostPolicy(JSON.parse(policySource));
      if (!costPolicy) return closed;
    }
    return { enabled: true, revision: parsed.revision, inputCreditsPer1000: inputRate, outputCreditsPer1000: outputRate,
      ...(costPolicy ? { costPolicy } : {}) };
  } catch { return closed; }
}
export function publicCreditBillingConfig(env: Env) {
  const config = creditBillingConfig(env);
  return { enabled: config.enabled, priceRevision: config.revision, inputCreditsPer1000: config.inputCreditsPer1000,
    outputCreditsPer1000: config.outputCreditsPer1000, memoryBilled: config.enabled, tokenUnit: 1000,
    rounding: "ceil_combined" as const, outputIncludesReasoning: true, failureRule: "no_valid_output_refund" as const,
    cancellationRule: "valid_output_bill_usage" as const, missingUsageRule: "pending_then_refund" as const,
    reservationTtlMs: CREDIT_RESERVATION_TTL_MS, ...(config.costPolicy ? { costPolicy: config.costPolicy } : {}) };
}
function requestValue(value: unknown): CreditUsageRequest {
  const input = record(value, ["requestId", "operation", "model", "requestFingerprint", "inputTokenUpperBound", "maxOutputTokens"]);
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId) || (input.operation !== "chat" && input.operation !== "memory")
    || typeof input.model !== "string" || !MODEL.test(input.model) || typeof input.requestFingerprint !== "string" || !SHA256.test(input.requestFingerprint)
    || !integer(input.inputTokenUpperBound, 0, 1000000) || !integer(input.maxOutputTokens, 1, 1000000)) throw new ApiError(400, "计费请求编号、模型、Token 上界或指纹无效。");
  return { requestId: input.requestId.toLowerCase(), operation: input.operation, model: input.model,
    requestFingerprint: input.requestFingerprint, inputTokenUpperBound: input.inputTokenUpperBound, maxOutputTokens: input.maxOutputTokens };
}
function requestCostPolicy(config: CreditBillingConfig, model: string): DzmmCreditCostPolicy | undefined {
  const option = findDzmmProviderModel(model);
  if (!config.costPolicy && option && option.id !== "grok") {
    throw new ApiError(503, "当前模型的实际成本计费尚未配置，请选择默认模型或联系管理员。");
  }
  return config.costPolicy ? dzmmModelCostPolicy(config.costPolicy, model) : undefined;
}
function nowValue(options: Options): number {
  const now = (options.now ?? Date.now)();
  if (!integer(now, 0, Number.MAX_SAFE_INTEGER - CREDIT_RESERVATION_TTL_MS)) throw new Error("Invalid billing clock");
  return now;
}
function frozenCostPolicy(row: UsageRow): DzmmCreditCostPolicy | undefined {
  if (row.cost_policy_json === null || row.cost_policy_json === undefined) return undefined;
  try {
    const policy = parseDzmmCreditCostPolicy(JSON.parse(row.cost_policy_json));
    if (policy) return policy;
  } catch { /* Invalid frozen pricing must never fall back to a token tariff. */ }
  throw new ApiError(503, "这条请求的冻结费率需要核对，请联系管理员。");
}
export function creditUsageReceipt(row: UsageRow): CreditUsageReceipt {
  const costPolicy = frozenCostPolicy(row);
  const providerCostUsd = row.provider_cost_usd === null || row.provider_cost_usd === undefined ? undefined : parseDzmmProviderCostUsd(row.provider_cost_usd);
  if (row.provider_cost_usd !== null && row.provider_cost_usd !== undefined && providerCostUsd === undefined)
    throw new ApiError(503, "这条请求的模型成本需要核对，请联系管理员。");
  return { id: row.id, accountId: row.user_id, requestId: row.request_id, operation: row.operation, model: row.model,
    priceRevision: row.price_revision, inputCreditsPer1000: row.input_rate, outputCreditsPer1000: row.output_rate,
    status: row.status, reservedCredits: row.reserved_credits, chargedCredits: row.charged_credits,
    returnedCredits: row.status === "reserved" || row.status === "pending" ? 0 : row.reserved_credits - row.charged_credits,
    hasValidOutput: row.has_valid_output === 1, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens,
    usageExceedsReservation: row.usage_exceeds_reservation === 1, outcome: row.outcome, releaseReason: row.release_reason,
    createdAt: row.created_at, expiresAt: row.expires_at, finalizedAt: row.finalized_at,
    ...(costPolicy ? { costPolicy } : {}), ...(providerCostUsd !== undefined ? { providerCostUsd } : {}) };
}
export function superUsageReceipt(row: UsageRow): CreditUsageReceipt {
  return { ...creditUsageReceipt({ ...row, reserved_credits: 0, charged_credits: 0, usage_exceeds_reservation: 0 }), billingExempt: true };
}
async function currentBillingAccount(request: Request, env: Env, userId: string, now: number) {
  const token=tokenFrom(request);if(!token)throw new ApiError(401,"登录状态已失效，请重新登录。");
  const account=await env.DB.prepare(`SELECT u.is_guest FROM users u WHERE u.id=? AND EXISTS(
    SELECT 1 FROM sessions WHERE user_id=u.id AND token_hash=? AND expires_at>MAX(?,${SQL_NOW_MS}))`)
    .bind(userId,digest(token),now).first<{is_guest:number}>();
  if(!account)throw new ApiError(401,"账户或登录状态已失效，请重新登录。");return account;
}
async function finalizeSuperUsage(env:Env,input:Record<string,unknown>,usage:{promptTokens:number;completionTokens:number;providerCostUsd?:number}|null,now:number) {
  const authorization=digest(input.claimToken as string),gate="(authorization_hash=? OR reconciliation_token=?)";
  const previous=await env.DB.prepare(`SELECT * FROM super_generation_usage WHERE id=? AND user_id=? AND ${gate}`)
    .bind(input.reservationId,input.accountId,authorization,input.claimToken).first<UsageRow>();
  if(!previous)throw new ApiError(404,"计费请求不存在或结算授权无效。");
  const policy=frozenCostPolicy(previous),valid=input.hasValidOutput?1:0;
  const pending=valid===1&&(!usage||(policy!==undefined&&usage.providerCostUsd===undefined));
  const persisted=pending?null:usage,status=pending?'pending':valid?'settled':'released',generation=input.generationId??null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE super_generation_usage SET status='released',outcome='expired',release_reason=CASE WHEN has_valid_output=1 THEN 'usage_timeout' ELSE 'request_timeout' END,
      finalized_at=MAX(?,${SQL_NOW_MS}) WHERE id=? AND status IN ('reserved','pending') AND expires_at<=MAX(?,${SQL_NOW_MS})`).bind(now,input.reservationId,now),
    env.DB.prepare(`UPDATE super_generation_usage SET status=?,has_valid_output=?,prompt_tokens=?,completion_tokens=?,provider_cost_usd=?,outcome=?,release_reason=?,
      generation_id=COALESCE(generation_id,?),reconciliation_token=CASE WHEN ?=1 THEN COALESCE(reconciliation_token,?) ELSE reconciliation_token END,
      finalized_at=CASE WHEN ?=1 THEN NULL ELSE MAX(?,${SQL_NOW_MS}) END WHERE id=? AND user_id=? AND ${gate} AND expires_at>MAX(?,${SQL_NOW_MS}) AND
      (status='reserved' OR (status='pending' AND has_valid_output=? AND outcome=? AND (generation_id IS NULL OR ? IS NULL OR generation_id=?)))`)
      .bind(status,valid,persisted?.promptTokens??null,persisted?.completionTokens??null,persisted?.providerCostUsd??null,input.outcome,valid?null:'no_valid_output',generation,
        pending?1:0,crypto.randomUUID(),pending?1:0,now,input.reservationId,input.accountId,authorization,input.claimToken,now,valid,input.outcome,generation,generation),
  ]);
  const row=await env.DB.prepare(`SELECT * FROM super_generation_usage WHERE id=? AND user_id=? AND ${gate}`)
    .bind(input.reservationId,input.accountId,authorization,input.claimToken).first<UsageRow>();
  if(!row||row.status!==status||row.outcome!==input.outcome||row.has_valid_output!==valid||row.prompt_tokens!==(persisted?.promptTokens??null)
    ||row.completion_tokens!==(persisted?.completionTokens??null)||(row.provider_cost_usd??null)!==(persisted?.providerCostUsd??null)
    ||(generation!==null&&row.generation_id!==generation))throw new ApiError(409,"该生成请求已有其他结算事实，不能更改。",row?{receipt:superUsageReceipt(row)}:undefined);
  return superUsageReceipt(row);
}
function expiryStatements(env: Env, userId: string | null, now: number, limit = 50) {
  const nonce = crypto.randomUUID();
  return [
    env.DB.prepare(`UPDATE credit_usage_requests SET status='released',outcome='expired',
      release_reason=CASE WHEN has_valid_output=1 THEN 'usage_timeout' ELSE 'request_timeout' END,finalized_at=MAX(?,${SQL_NOW_MS}),processing_token=?
      WHERE id IN (SELECT id FROM credit_usage_requests WHERE (? IS NULL OR user_id=?) AND status IN ('reserved','pending') AND expires_at<=MAX(?,${SQL_NOW_MS}) ORDER BY expires_at,id LIMIT ?)`)
      .bind(now, nonce, userId, userId, now, limit),
    env.DB.prepare(`INSERT INTO credit_usage_ledger(usage_id,user_id,kind,credits,outcome,created_at)
      SELECT id,user_id,'release',0,outcome,finalized_at FROM credit_usage_requests WHERE processing_token=? AND status='released'`).bind(nonce),
  ];
}
/** Internal maintenance; late results never reverse an expired release. */
export async function releaseExpiredCreditUsage(env: Env, userId: string | null = null, options: Options = {}, limit = 50): Promise<number> {
  if (!integer(limit, 1, 50)) throw new ApiError(400, "清理数量无效。");
  const results = await env.DB.batch(expiryStatements(env, userId, nowValue(options), limit));
  const remaining=limit-results[0].meta.changes;
  if(remaining<=0)return results[0].meta.changes;
  const exempt=await env.DB.prepare(`UPDATE super_generation_usage SET status='released',outcome='expired',
    release_reason=CASE WHEN has_valid_output=1 THEN 'usage_timeout' ELSE 'request_timeout' END,finalized_at=MAX(?,${SQL_NOW_MS})
    WHERE id IN (SELECT id FROM super_generation_usage WHERE (? IS NULL OR user_id=?) AND status IN ('reserved','pending')
      AND expires_at<=MAX(?,${SQL_NOW_MS}) ORDER BY expires_at,id LIMIT ?)`).bind(nowValue(options),userId,userId,nowValue(options),remaining).run();
  return results[0].meta.changes+exempt.meta.changes;
}
function sameRequest(row: UsageRow, input: CreditUsageRequest): boolean {
  return row.operation === input.operation && row.model === input.model && row.request_fingerprint === input.requestFingerprint
    && row.input_token_upper_bound === input.inputTokenUpperBound && row.max_output_tokens === input.maxOutputTokens;
}
/** A read-only affordability quote. This does not grant execution or freeze
 * funds: reserveCreditUsage still checks the exact, rebuilt provider request
 * against the current balance in its atomic mutation. */
export async function quoteCreditUsage(request: Request, env: Env, user: UserRecord, value: unknown, options: Options = {}) {
  const input = requestValue(value), now = nowValue(options), token = tokenFrom(request);
  if (!token) throw new ApiError(401, "登录状态已失效，请重新登录。");
  // The balance view excludes expired holds without updating billing facts.
  // Check the session again in this read so an unrelated account/session can
  // never use a caller-supplied UserRecord to quote another wallet.
  const available = await env.DB.prepare(`SELECT b.balance,b.reserved_credits,u.is_guest,u.role FROM users u
    JOIN credit_usage_balances b ON b.user_id=u.id WHERE u.id=?
    AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=u.id AND expires_at>MAX(?,${SQL_NOW_MS}))`)
    .bind(user.id, digest(token), now).first<{ balance: number; reserved_credits: number; is_guest: number; role: string }>();
  if (!available) throw new ApiError(401, "账户或登录状态已失效，请重新登录。");
  const config = creditBillingConfig(env);
  if (!config.enabled) {
    if (env.CREDIT_BILLING_ENABLED === "true") throw new ApiError(503, "模型 Credit 费率配置无效，请稍后重试。");
    return { enabled: false as const };
  }
  if (user.isGuest || available.is_guest === 1) throw new ApiError(403, "请登录正式账户使用充值 Credit。");
  if (!config.revision || !config.inputCreditsPer1000 || !config.outputCreditsPer1000)
    throw new ApiError(503, "模型 Credit 费率配置无效，请稍后重试。");
  if (!integer(available.balance, 0, Number.MAX_SAFE_INTEGER) || !integer(available.reserved_credits, 0, Number.MAX_SAFE_INTEGER))
    throw new ApiError(503, "账户 Credit 余额需要核对，请联系管理员。");
  const costPolicy = requestCostPolicy(config, input.model);
  const required = (maxOutputTokens: number) => costPolicy
    ? reserveDzmmCreditCost(input.inputTokenUpperBound, maxOutputTokens, costPolicy)
    : chargeDzmmCreditTokens(input.inputTokenUpperBound, maxOutputTokens, config.inputCreditsPer1000!, config.outputCreditsPer1000!);
  const minimumOutput = Math.min(input.maxOutputTokens, input.operation === "memory" ? 512 : 128);
  const minimumCredits = required(minimumOutput);
  if (!integer(minimumCredits, 1, 1000000000)) throw new ApiError(400, "单次模型预留费用超过限制。");
  if (minimumCredits > available.balance) {
    const held = available.reserved_credits ? `；其中 ${available.reserved_credits} Credit 正被其他请求预留，结算后会返还未使用部分` : "";
    throw new ApiError(402, `当前可用 ${available.balance} Credit，本次上下文和最短回复至少需要 ${minimumCredits} Credit${held}。请缩短上下文或充值后重试。`,
      { code: "insufficient_credits", availableCredits: available.balance, requiredCredits: minimumCredits, reservedCredits: available.reserved_credits });
  }
  // Billing charges are monotone but rounded together. Binary search the exact
  // pricing helper rather than divide by a floating per-token approximation.
  let low = minimumOutput, high = input.maxOutputTokens;
  while (low < high) {
    const candidate = low + Math.ceil((high - low) / 2);
    const credits = required(candidate);
    if (integer(credits, 1, 1000000000) && credits <= available.balance) low = candidate;
    else high = candidate - 1;
  }
  return { enabled: true as const, maxOutputTokens: low, requiredCredits: required(low), availableCredits: available.balance };
}
/** Only a trusted gateway can estimate upper bounds. Never contact a provider
 * on created=false, never disclose claimToken to a browser, never accept money. */
export async function reserveCreditUsage(request: Request, env: Env, user: UserRecord, value: unknown, options: Options = {}) {
  const input = requestValue(value), now = nowValue(options), token = tokenFrom(request);
  if (!token) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const account = await currentBillingAccount(request,env,user.id,now);
  if (account.is_guest===1) throw new ApiError(403, "请登录正式账户使用充值 Credit。");
  const exemptPrevious=await env.DB.prepare('SELECT * FROM super_generation_usage WHERE user_id=? AND request_id=?').bind(user.id,input.requestId).first<UsageRow>();
  if(exemptPrevious) {
    if(!sameRequest(exemptPrevious,input))throw new ApiError(409,"该请求编号已用于另一条模型请求。");
    return {receipt:superUsageReceipt(exemptPrevious),created:false};
  }
  const sessionHash = digest(token), sessionGate = `EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>MAX(?,${SQL_NOW_MS}))`;
  const previous = await env.DB.prepare(`SELECT r.* FROM credit_usage_requests r JOIN users u ON u.id=r.user_id
    WHERE r.user_id=? AND r.request_id=? AND u.is_guest=0 AND ${sessionGate}`)
    .bind(user.id, input.requestId, sessionHash, user.id, now).first<UsageRow>();
  if (previous) {
    if (!sameRequest(previous, input)) throw new ApiError(409, "该请求编号已用于另一条模型请求。");
    await releaseExpiredCreditUsage(env, user.id, { now: () => now });
    const current = await env.DB.prepare("SELECT * FROM credit_usage_requests WHERE id=?").bind(previous.id).first<UsageRow>();
    if (!current) throw new ApiError(404, "计费请求不存在。");
    return { receipt: creditUsageReceipt(current), created: false };
  }
  const config = creditBillingConfig(env);
  if (!config.enabled || !config.revision || !config.inputCreditsPer1000 || !config.outputCreditsPer1000)
    throw new ApiError(503, "模型 Credit 计费尚未启用。");
  const costPolicy = requestCostPolicy(config, input.model);
  const reserved = costPolicy ? reserveDzmmCreditCost(input.inputTokenUpperBound, input.maxOutputTokens, costPolicy)
    : chargeDzmmCreditTokens(input.inputTokenUpperBound, input.maxOutputTokens, config.inputCreditsPer1000, config.outputCreditsPer1000);
  if (!integer(reserved, 1, 1000000000)) throw new ApiError(400, "单次模型预留费用超过限制。");
  const id = `usage_${crypto.randomUUID()}`, claimToken = crypto.randomUUID(), nonce = crypto.randomUUID();
  const results = await env.DB.batch([
    ...expiryStatements(env, user.id, now),
    env.DB.prepare(`INSERT INTO credit_usage_requests(id,user_id,request_id,operation,model,request_fingerprint,price_revision,input_rate,output_rate,
      input_token_upper_bound,max_output_tokens,reserved_credits,authorization_hash,processing_token,created_at,expires_at,cost_policy_json)
      SELECT ?,u.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM users u JOIN credit_usage_balances b ON b.user_id=u.id
      WHERE u.id=? AND u.is_guest=0 AND ${sessionGate} AND NOT EXISTS(SELECT 1 FROM super_generation_usage WHERE user_id=u.id AND request_id=?) AND b.balance>=? AND ?>${SQL_NOW_MS} ON CONFLICT(user_id,request_id) DO NOTHING`)
      .bind(id, input.requestId, input.operation, input.model, input.requestFingerprint, config.revision, config.inputCreditsPer1000,
        config.outputCreditsPer1000, input.inputTokenUpperBound, input.maxOutputTokens, reserved, digest(claimToken), nonce,
        now, now + CREDIT_RESERVATION_TTL_MS, costPolicy ? JSON.stringify(costPolicy) : null,
        user.id, sessionHash, user.id, now, input.requestId, reserved, now + CREDIT_RESERVATION_TTL_MS),
    env.DB.prepare(`SELECT r.* FROM credit_usage_requests r JOIN users u ON u.id=r.user_id
      WHERE r.user_id=? AND r.request_id=? AND u.is_guest=0 AND ${sessionGate}`).bind(user.id, input.requestId, sessionHash, user.id, now),
    env.DB.prepare(`SELECT id FROM users WHERE id=? AND is_guest=0 AND ${sessionGate}`).bind(user.id, sessionHash, user.id, now),
  ]);
  const row = results[3].results[0] as unknown as UsageRow | undefined;
  if (!results[4].results.length) throw new ApiError(401, "账户或登录状态已失效，请重新登录。");
  if (!row) throw new ApiError(402, "可用 Credit 不足，请充值后重试。", { code: "insufficient_credits" });
  if (!sameRequest(row, input)) throw new ApiError(409, "该请求编号已用于另一条模型请求。");
  const created = results[2].meta.changes === 1;
  return { receipt: creditUsageReceipt(row), created, ...(created ? { claimToken } : {}) };
}

/** Trusted generation facts only. completionTokens already includes reasoning:
 * the backend never adds a second reasoning total. Missing usage holds funds. */
export async function finalizeCreditUsage(env: Env, value: unknown, options: Options = {}): Promise<CreditUsageReceipt> {
  const input = record(value, ["reservationId", "accountId", "claimToken", "outcome", "hasValidOutput", "usage", "generationId"]), now = nowValue(options);
  if (typeof input.reservationId !== "string" || !/^usage_[a-f0-9-]{36}$/.test(input.reservationId)
    || typeof input.accountId !== "string" || !input.accountId || input.accountId.length > 128
    || typeof input.claimToken !== "string" || !UUID.test(input.claimToken)
    || !["completed", "failed", "cancelled"].includes(String(input.outcome)) || typeof input.hasValidOutput !== "boolean"
    || (input.generationId !== undefined && (typeof input.generationId !== "string" || !input.generationId || input.generationId.length > 200 || /[\x00-\x1f\x7f]/.test(input.generationId))))
    throw new ApiError(400, "计费结算事实无效。");
  let usage: { promptTokens: number; completionTokens: number; providerCostUsd?: number } | null = null;
  if (input.usage !== undefined) {
    const parsed = record(input.usage, ["promptTokens", "completionTokens", "providerCostUsd"]);
    if (!integer(parsed.promptTokens, 0, 1000000000) || !integer(parsed.completionTokens, 0, 1000000000)) throw new ApiError(400, "模型 Token 用量无效。");
    const providerCostUsd = parsed.providerCostUsd === undefined ? undefined : parseDzmmProviderCostUsd(parsed.providerCostUsd);
    if (parsed.providerCostUsd !== undefined && providerCostUsd === undefined) throw new ApiError(400, "模型美元成本无效。");
    usage = { promptTokens: parsed.promptTokens, completionTokens: parsed.completionTokens,
      ...(providerCostUsd !== undefined ? { providerCostUsd } : {}) };
  }
  const authorization = digest(input.claimToken), authGate = "(authorization_hash=? OR reconciliation_token=?)";
  // Read rates only from this account's immutable reservation, never arguments.
  const previous = await env.DB.prepare(`SELECT * FROM credit_usage_requests WHERE id=? AND user_id=? AND ${authGate}`)
    .bind(input.reservationId, input.accountId, authorization, input.claimToken).first<UsageRow>();
  if (!previous) return finalizeSuperUsage(env,input,usage,now);
  const costPolicy = frozenCostPolicy(previous);
  const valid = input.hasValidOutput ? 1 : 0, pending = valid === 1 && (!usage || (costPolicy !== undefined && usage.providerCostUsd === undefined));
  // The existing pending schema deliberately keeps tokens unknown. In cost
  // mode, tokens without a trusted dollar cost must never trigger estimation.
  const persistedUsage = pending ? null : usage;
  const providerCostUsd = persistedUsage?.providerCostUsd ?? null;
  const requestedCharge = valid && persistedUsage ? costPolicy
    ? chargeDzmmProviderCostUsd(persistedUsage.providerCostUsd!, costPolicy)
    : chargeDzmmCreditTokens(persistedUsage.promptTokens, persistedUsage.completionTokens, previous.input_rate, previous.output_rate) : 0;
  const charged = Math.min(previous.reserved_credits, requestedCharge), nonce = crypto.randomUUID();
  const status = pending ? "pending" : valid ? "settled" : "released";
  const generation = input.generationId ?? null, reconciliationToken = crypto.randomUUID();
  const results = await env.DB.batch([
    ...expiryStatements(env, input.accountId, now),
    env.DB.prepare(`UPDATE credit_usage_requests SET status=?,charged_credits=?,has_valid_output=?,prompt_tokens=?,completion_tokens=?,
      usage_exceeds_reservation=?,outcome=?,release_reason=?,generation_id=COALESCE(generation_id,?),
      reconciliation_token=CASE WHEN ?=1 THEN COALESCE(reconciliation_token,?) ELSE reconciliation_token END,
      pending_at=CASE WHEN ?=1 THEN COALESCE(pending_at,MAX(?,${SQL_NOW_MS})) ELSE pending_at END,
      finalized_at=CASE WHEN ? IS NULL THEN NULL ELSE MAX(?,${SQL_NOW_MS}) END,processing_token=?,provider_cost_usd=?
      WHERE id=? AND user_id=? AND ${authGate} AND expires_at>MAX(?,${SQL_NOW_MS}) AND
      (status='reserved' OR (status='pending' AND has_valid_output=? AND outcome=? AND (generation_id IS NULL OR ? IS NULL OR generation_id=?)))`)
      .bind(status, charged, valid, persistedUsage?.promptTokens ?? null, persistedUsage?.completionTokens ?? null, requestedCharge > previous.reserved_credits ? 1 : 0,
        input.outcome, valid ? null : "no_valid_output", generation, pending ? 1 : 0, reconciliationToken, pending ? 1 : 0, now,
        pending ? null : now, now, nonce, providerCostUsd, input.reservationId, input.accountId, authorization, input.claimToken, now,
        valid, input.outcome, generation, generation),
    env.DB.prepare(`INSERT INTO credit_usage_ledger(usage_id,user_id,kind,credits,outcome,created_at)
      SELECT id,user_id,CASE WHEN status='settled' THEN 'charge' ELSE 'release' END,-charged_credits,outcome,finalized_at
      FROM credit_usage_requests WHERE id=? AND processing_token=? AND status IN ('settled','released')`).bind(input.reservationId, nonce),
    env.DB.prepare(`SELECT * FROM credit_usage_requests WHERE id=? AND user_id=? AND ${authGate}`)
      .bind(input.reservationId, input.accountId, authorization, input.claimToken),
  ]);
  const row = results[4].results[0] as unknown as UsageRow | undefined;
  if (!row) throw new ApiError(404, "计费请求不存在。");
  if (row.outcome !== input.outcome || row.has_valid_output !== valid || row.status !== status
    || row.prompt_tokens !== (persistedUsage?.promptTokens ?? null) || row.completion_tokens !== (persistedUsage?.completionTokens ?? null)
    || (row.provider_cost_usd ?? null) !== providerCostUsd
    || (generation !== null && row.generation_id !== generation))
    throw new ApiError(409, "该计费请求已有其他结算事实，不能更改或重复返还。", { receipt: creditUsageReceipt(row) });
  return creditUsageReceipt(row);
}

export async function getPendingCreditUsage(env: Env, limit = 20, options: Options = {}): Promise<CreditPendingRequest[]> {
  if (!integer(limit, 1, 50)) throw new ApiError(400, "核对数量无效。");
  const now=nowValue(options),nonce=crypto.randomUUID();
  // Select one fair bounded schedule across paid and exempt executions. An
  // ambiguous paid generation cannot consume every reconciliation slot forever.
  const candidates=await env.DB.prepare(`SELECT id,exempt FROM (
    SELECT id,0 AS exempt,last_reconciled_at,created_at FROM credit_usage_requests WHERE status='pending' AND generation_id IS NOT NULL AND expires_at>MAX(?1,${SQL_NOW_MS})
    UNION ALL SELECT id,1,last_reconciled_at,created_at FROM super_generation_usage WHERE status='pending' AND generation_id IS NOT NULL AND expires_at>MAX(?1,${SQL_NOW_MS}))
    ORDER BY last_reconciled_at,created_at,id LIMIT ?2`).bind(now,limit).all<{id:string;exempt:number}>();
  const rows:UsageRow[]=[];
  const statements=[];
  for(const [table,flag] of [['credit_usage_requests',0],['super_generation_usage',1]] as const) {
    const ids=candidates.results.filter(row=>row.exempt===flag).map(row=>row.id);if(!ids.length)continue;
    statements.push(env.DB.prepare(`UPDATE ${table} SET last_reconciled_at=MAX(?,${SQL_NOW_MS},last_reconciled_at+1),processing_token=?
      WHERE id IN (${ids.map(()=>'?').join(',')}) AND status='pending' AND expires_at>MAX(?,${SQL_NOW_MS})`).bind(now,nonce,...ids,now),
      env.DB.prepare(`SELECT * FROM ${table} WHERE status='pending' AND processing_token=? ORDER BY created_at,id`).bind(nonce));
  }
  if(statements.length) {
    const results=await env.DB.batch(statements);
    for(let index=1;index<results.length;index+=2)rows.push(...results[index].results as unknown as UsageRow[]);
  }
  return rows.map(row=>{
    const costPolicy=frozenCostPolicy(row);
    return {reservationId:row.id,accountId:row.user_id,claimToken:row.reconciliation_token!,generationId:row.generation_id!,model:row.model,
      outcome:row.outcome as CreditPendingRequest["outcome"],createdAt:row.created_at,expiresAt:row.expires_at,...(costPolicy?{costPolicy}:{})};
  });
}
export function creditUsageBalanceStatement(env: Env, userId: string) {
  return env.DB.prepare("SELECT balance,granted_credits,total_spent,reserved_credits,debt_credits FROM credit_usage_balances WHERE user_id=?").bind(userId);
}
