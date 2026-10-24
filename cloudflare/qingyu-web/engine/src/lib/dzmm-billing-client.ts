import { parseDzmmCreditCostPolicy, parseDzmmCreditRate, parseDzmmProviderCostUsd, type DzmmCreditCostPolicy } from "./dzmm-credit-pricing";

export type DzmmBillingConfig = {
  enabled: boolean; priceRevision: number | null; inputCreditsPer1000: number | null;
  outputCreditsPer1000: number | null; memoryBilled: boolean; tokenUnit: 1000;
  rounding: "ceil_combined"; outputIncludesReasoning: true;
  failureRule: "no_valid_output_refund"; cancellationRule: "valid_output_bill_usage";
  missingUsageRule: "pending_then_refund"; reservationTtlMs: 600000;
  costPolicy?: DzmmCreditCostPolicy;
};
export type DzmmBillingUsageItem = {
  id: string; accountId: string; requestId: string; operation: "chat" | "memory"; model: string;
  priceRevision: number; inputCreditsPer1000: number; outputCreditsPer1000: number;
  status: "reserved" | "pending" | "settled" | "released";
  reservedCredits: number; chargedCredits: number; returnedCredits: number; hasValidOutput: boolean;
  promptTokens: number | null; completionTokens: number | null; usageExceedsReservation: boolean;
  outcome: "completed" | "failed" | "cancelled" | "expired" | null;
  releaseReason: "no_valid_output" | "usage_timeout" | "request_timeout" | null;
  createdAt: number; expiresAt: number; finalizedAt: number | null;
  costPolicy?: DzmmCreditCostPolicy; providerCostUsd?: number;
  billingExempt?: boolean;
};
export type DzmmBillingUsage = {
  accountId: string; availableBalance: number; reservedCredits: number; totalSpent: number; debtCredits: number;
  items: DzmmBillingUsageItem[]; nextCursor: string | null;
  creditUnlimited?: boolean; billingExempt?: boolean;
};
export class DzmmBillingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmBillingError"; }
}

const API = "/api/backend/v1/billing";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
const amount = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const positive = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => amount(value, max) && value > 0;
const timestamp = (value: unknown): value is number => amount(value, 8_640_000_000_000_000);
const malformed = () => new DzmmBillingError(502, "消费服务返回的数据无效，请刷新后重试。");
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw malformed();
}

export function parseDzmmBillingConfig(value: unknown): DzmmBillingConfig {
  if (!record(value)) throw malformed();
  keys(value, ["enabled", "priceRevision", "inputCreditsPer1000", "outputCreditsPer1000", "memoryBilled", "tokenUnit", "rounding",
    "outputIncludesReasoning", "failureRule", "cancellationRule", "missingUsageRule", "reservationTtlMs"], ["costPolicy"]);
  const costPolicy = Object.hasOwn(value, "costPolicy") ? parseDzmmCreditCostPolicy(value.costPolicy) : undefined;
  if (Object.hasOwn(value, "costPolicy") && (!costPolicy || value.enabled !== true)) throw malformed();
  if (typeof value.enabled !== "boolean" || typeof value.memoryBilled !== "boolean" || value.tokenUnit !== 1000
    || value.rounding !== "ceil_combined" || value.outputIncludesReasoning !== true || value.failureRule !== "no_valid_output_refund"
    || value.cancellationRule !== "valid_output_bill_usage" || value.missingUsageRule !== "pending_then_refund"
    || value.reservationTtlMs !== 600000) throw malformed();
  if (value.enabled ? !positive(value.priceRevision, 1_000_000) || parseDzmmCreditRate(value.inputCreditsPer1000) === undefined
    || parseDzmmCreditRate(value.outputCreditsPer1000) === undefined
    : value.priceRevision !== null || value.inputCreditsPer1000 !== null || value.outputCreditsPer1000 !== null || value.memoryBilled) throw malformed();
  return {
    enabled: value.enabled, priceRevision: value.priceRevision as number | null,
    inputCreditsPer1000: value.inputCreditsPer1000 as number | null, outputCreditsPer1000: value.outputCreditsPer1000 as number | null,
    memoryBilled: value.memoryBilled, tokenUnit: 1000, rounding: "ceil_combined", outputIncludesReasoning: true,
    failureRule: "no_valid_output_refund", cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000,
    ...(costPolicy ? { costPolicy } : {}),
  };
}

function parseUsageItem(value: unknown, accountId: string): DzmmBillingUsageItem {
  if (!record(value)) throw malformed();
  keys(value, ["id", "accountId", "requestId", "operation", "model", "priceRevision", "inputCreditsPer1000", "outputCreditsPer1000", "status",
    "reservedCredits", "chargedCredits", "returnedCredits", "hasValidOutput", "promptTokens", "completionTokens", "usageExceedsReservation",
    "outcome", "releaseReason", "createdAt", "expiresAt", "finalizedAt"], ["costPolicy", "providerCostUsd", "billingExempt"]);
  if (value.billingExempt !== undefined && typeof value.billingExempt !== "boolean") throw malformed();
  if (value.billingExempt === true && (value.reservedCredits !== 0 || value.chargedCredits !== 0 || value.returnedCredits !== 0)) throw malformed();
  const inputRate = parseDzmmCreditRate(value.inputCreditsPer1000);
  const outputRate = parseDzmmCreditRate(value.outputCreditsPer1000);
  const costPolicy = Object.hasOwn(value, "costPolicy") ? parseDzmmCreditCostPolicy(value.costPolicy) : undefined;
  const providerCostUsd = Object.hasOwn(value, "providerCostUsd") ? parseDzmmProviderCostUsd(value.providerCostUsd) : undefined;
  if ((Object.hasOwn(value, "costPolicy") && !costPolicy) || (Object.hasOwn(value, "providerCostUsd") && providerCostUsd === undefined)) throw malformed();
  if (!text(value.id, 42) || !value.id.startsWith("usage_") || !UUID.test(value.id.slice(6))
    || value.accountId !== accountId || !text(value.requestId, 36) || !UUID.test(value.requestId) || !["chat", "memory"].includes(value.operation as string)
    || !text(value.model, 100) || !MODEL.test(value.model) || !positive(value.priceRevision, 1_000_000)
    || inputRate === undefined || outputRate === undefined
    || !["reserved", "pending", "settled", "released"].includes(value.status as string)
    || !amount(value.reservedCredits, 1_000_000_000) || !amount(value.chargedCredits, 1_000_000_000)
    || !amount(value.returnedCredits, 1_000_000_000) || typeof value.hasValidOutput !== "boolean"
    || typeof value.usageExceedsReservation !== "boolean"
    || (value.promptTokens === null ? value.completionTokens !== null
      : !amount(value.promptTokens, 1_000_000_000) || !amount(value.completionTokens, 1_000_000_000))
    || (value.outcome !== null && !["completed", "failed", "cancelled", "expired"].includes(value.outcome as string))
    || (value.releaseReason !== null && !["no_valid_output", "usage_timeout", "request_timeout"].includes(value.releaseReason as string))
    || !timestamp(value.createdAt) || !timestamp(value.expiresAt) || value.expiresAt <= value.createdAt
    || (value.finalizedAt !== null && (!timestamp(value.finalizedAt) || value.finalizedAt < value.createdAt))) throw malformed();
  const final = value.status === "settled" || value.status === "released";
  if (final ? value.finalizedAt === null || value.chargedCredits + value.returnedCredits !== value.reservedCredits
    : value.finalizedAt !== null || value.chargedCredits !== 0 || value.returnedCredits !== 0) throw malformed();
  if (value.status === "released" && value.chargedCredits !== 0) throw malformed();
  return {
    id: value.id, accountId, requestId: value.requestId, operation: value.operation as DzmmBillingUsageItem["operation"], model: value.model,
    priceRevision: value.priceRevision, inputCreditsPer1000: inputRate, outputCreditsPer1000: outputRate,
    status: value.status as DzmmBillingUsageItem["status"], reservedCredits: value.reservedCredits, chargedCredits: value.chargedCredits,
    returnedCredits: value.returnedCredits, hasValidOutput: value.hasValidOutput,
    promptTokens: value.promptTokens as number | null, completionTokens: value.completionTokens as number | null,
    usageExceedsReservation: value.usageExceedsReservation, outcome: value.outcome as DzmmBillingUsageItem["outcome"],
    releaseReason: value.releaseReason as DzmmBillingUsageItem["releaseReason"], createdAt: value.createdAt,
    expiresAt: value.expiresAt, finalizedAt: value.finalizedAt as number | null,
    ...(costPolicy ? { costPolicy } : {}), ...(providerCostUsd !== undefined ? { providerCostUsd } : {}),
    ...(value.billingExempt !== undefined ? { billingExempt: value.billingExempt } : {}),
  };
}

export function parseDzmmBillingUsage(value: unknown, expectedAccountId: string, limit = 20): DzmmBillingUsage {
  if (!text(expectedAccountId) || !positive(limit, 50)) throw new DzmmBillingError(400, "消费记录请求无效。");
  if (!record(value)) throw malformed();
  keys(value, ["accountId", "availableBalance", "reservedCredits", "totalSpent", "debtCredits", "items", "nextCursor"], ["creditUnlimited", "billingExempt"]);
  if ((value.creditUnlimited !== undefined && typeof value.creditUnlimited !== "boolean")
    || (value.billingExempt !== undefined && typeof value.billingExempt !== "boolean")
    || (value.creditUnlimited === true && value.billingExempt !== true)) throw malformed();
  if (!text(value.accountId) || !amount(value.availableBalance) || !amount(value.reservedCredits)
    || !amount(value.totalSpent) || !amount(value.debtCredits) || !Array.isArray(value.items) || value.items.length > limit
    || (value.nextCursor !== null && !text(value.nextCursor, 1000))) throw malformed();
  if (value.accountId !== expectedAccountId) throw new DzmmBillingError(409, "账户已切换，请刷新后查看本人的消费记录。");
  const items = value.items.map(item => parseUsageItem(item, expectedAccountId));
  if (new Set(items.map(item => item.id)).size !== items.length) throw malformed();
  return { accountId: value.accountId, availableBalance: value.availableBalance, reservedCredits: value.reservedCredits,
    totalSpent: value.totalSpent, debtCredits: value.debtCredits, items, nextCursor: value.nextCursor as string | null,
    ...(value.creditUnlimited !== undefined ? { creditUnlimited: value.creditUnlimited } : {}),
    ...(value.billingExempt !== undefined ? { billingExempt: value.billingExempt } : {}) };
}

async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(`${API}${path}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: controller.signal, headers: { Accept: "application/json" } });
    const value: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) throw new DzmmBillingError(response.status,
      response.status === 401 || response.status === 403 ? "请登录正式账户后查看本人的消费记录。" : "消费服务暂时无法读取，请稍后刷新。");
    return value;
  } catch (failure) {
    if (signal?.aborted || failure instanceof DzmmBillingError) throw failure;
    throw new DzmmBillingError(503, "消费服务暂时无法连接，请稍后刷新。");
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export async function fetchDzmmBillingConfig(signal?: AbortSignal): Promise<DzmmBillingConfig> {
  return parseDzmmBillingConfig(await request("/config", signal));
}
export async function fetchDzmmBillingUsage(expectedAccountId: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<DzmmBillingUsage> {
  const limit = options.limit ?? 20;
  if (!text(expectedAccountId) || !positive(limit, 50) || (options.cursor !== undefined && !text(options.cursor, 1000))) {
    throw new DzmmBillingError(400, "消费记录请求无效。");
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  return parseDzmmBillingUsage(await request(`/usage?${query}`, options.signal), expectedAccountId, limit);
}
