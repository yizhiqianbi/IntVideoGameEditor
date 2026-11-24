import { parseShelfProviderCostUsd } from "./shelf-credit-pricing";
import { findShelfProviderModel } from "./shelf-models";

/** Provider metadata is trusted only after it has been read on the server. */
export type ShelfGenerationUsage = { promptTokens: number; completionTokens: number; providerCostUsd?: number };
export type ShelfBillingPreflight = {
  operation: "chat" | "memory";
  model: string;
  inputTokenUpperBound: number;
  maxOutputTokens: number;
  requestFingerprint: string;
};
export type ShelfBillingCompletion = {
  outcome: "completed" | "failed" | "cancelled";
  hasValidOutput: boolean;
  usage?: ShelfGenerationUsage;
  generationId?: string;
};
export type ShelfBillingLease = { finalize(completion: ShelfBillingCompletion): Promise<void> };
export type ShelfBillingLifecycle = {
  /** Read-only affordability quote; the subsequent reservation remains authoritative. */
  limitOutputTokens?(preflight: ShelfBillingPreflight): Promise<number>;
  reserve(preflight: ShelfBillingPreflight): Promise<ShelfBillingLease | undefined>;
};
export type ShelfBillingReserveRpcInput = ShelfBillingPreflight & {
  sessionToken: string; accountId: string; requestId: string;
};
export type ShelfBillingFinalizeRpcInput = ShelfBillingCompletion & {
  reservationId: string; accountId: string; claimToken: string;
};
export type ShelfBillingRpcBinding = {
  quote?(input: ShelfBillingReserveRpcInput): Promise<unknown>;
  reserve(input: ShelfBillingReserveRpcInput): Promise<unknown>;
  finalize(input: ShelfBillingFinalizeRpcInput): Promise<unknown>;
  getPending?(limit: number): Promise<unknown>;
  releaseExpired?(): Promise<unknown>;
  companionReserve?(input: { sessionToken: string; accountId: string; requestId: string; sessionId: string; requestFingerprint: string }): Promise<unknown>;
  companionFinalize?(input: { accountId: string; reservationId: string; claimToken: string; outcome: "completed" | "failed" }): Promise<unknown>;
  companionGet?(input: { accountId: string; reservationId: string; claimToken: string }): Promise<unknown>;
  companionOverview?(request: Request): Promise<unknown>;
};

export class ShelfBillingError extends Error {
  constructor(readonly status: number, message: string, readonly code = "BILLING_UNAVAILABLE") {
    super(message);
    this.name = "ShelfBillingError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readShelfGenerationUsage(value: unknown): ShelfGenerationUsage | undefined {
  if (!object(value)) return undefined;
  const promptTokens = value.prompt_tokens;
  const completionTokens = value.completion_tokens;
  if (typeof promptTokens !== "number" || !Number.isSafeInteger(promptTokens) || promptTokens < 0 || promptTokens > 10_000_000
    || typeof completionTokens !== "number" || !Number.isSafeInteger(completionTokens) || completionTokens < 0 || completionTokens > 10_000_000) return undefined;
  // completion_tokens already includes reasoning_tokens. Token details are not
  // added again; a missing or malformed cost never invalidates legacy tokens.
  const providerCostUsd = parseShelfProviderCostUsd(value.cost);
  return { promptTokens, completionTokens, ...(providerCostUsd !== undefined ? { providerCostUsd } : {}) };
}

export function isShelfOpenRouterBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://openrouter.ai" && url.pathname.replace(/\/$/, "") === "/api/v1"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** Only OpenRouter's documented USD cost may determine this cost tariff. */
export function trustedShelfGenerationUsage(usage: ShelfGenerationUsage | undefined, baseUrl: string): ShelfGenerationUsage | undefined {
  if (!usage || isShelfOpenRouterBaseUrl(baseUrl)) return usage;
  return { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
}

export type ShelfProviderMaxPrice = { prompt: number; completion: number; request?: 0 };

/** USD per million tokens, as defined by OpenRouter provider.max_price. */
export function readShelfProviderMaxPrice(env: Record<string, string | undefined>, baseUrl: string, model?: string): ShelfProviderMaxPrice | undefined {
  const rawPrompt = env.SHELF_PROVIDER_MAX_INPUT_USD_PER_MILLION;
  const rawCompletion = env.SHELF_PROVIDER_MAX_OUTPUT_USD_PER_MILLION;
  const option = model === undefined ? undefined : findShelfProviderModel(model);
  const registeredCap = option && isShelfOpenRouterBaseUrl(baseUrl)
    ? { prompt: option.providerMaxPromptUsdPerMillion, completion: option.maxOutputUsdPerMillion, request: 0 as const } : undefined;
  if (rawPrompt === undefined && rawCompletion === undefined) return registeredCap;
  const prompt = typeof rawPrompt === "string" && rawPrompt.trim() ? parseShelfProviderCostUsd(Number(rawPrompt)) : undefined;
  const completion = typeof rawCompletion === "string" && rawCompletion.trim() ? parseShelfProviderCostUsd(Number(rawCompletion)) : undefined;
  if (prompt === undefined || completion === undefined || prompt <= 0 || completion <= 0 || !isShelfOpenRouterBaseUrl(baseUrl)) {
    throw new ShelfBillingError(503, "模型成本上限配置无效，请联系站主检查服务配置。", "BILLING_UNAVAILABLE");
  }
  // Invalid legacy configuration still fails closed. A registered model uses
  // its server-owned cap, never another model's global tariff or client input.
  return registeredCap ?? { prompt, completion };
}

export function readShelfGenerationId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) ? value : undefined;
}

/** A deliberately conservative preflight ceiling, not a tokenizer or bill.
 * Text tokens cannot exceed the UTF-8 bytes of the serialized text payload;
 * additional room covers chat framing and model-specific control tokens. */
export async function createShelfBillingPreflight(
  operation: "chat" | "memory", model: string,
  messages: readonly { role: string; content: string }[], maxOutputTokens: number,
  providerBody: string,
): Promise<ShelfBillingPreflight> {
  const encoder = new TextEncoder();
  const inputTokenUpperBound = encoder.encode(JSON.stringify(messages)).byteLength + 1024 + messages.length * 64;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(providerBody)));
  const requestFingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  return { operation, model, inputTokenUpperBound, maxOutputTokens, requestFingerprint };
}

/** Keep the provider cap, exact body fingerprint and reservation in agreement.
 * A quote neither holds money nor authorizes generation; reserve must still win. */
export async function prepareShelfBillingRequest(
  operation: "chat" | "memory", model: string,
  messages: readonly { role: string; content: string }[], requestedOutputTokens: number,
  buildBody: (maxOutputTokens: number) => string, billing?: ShelfBillingLifecycle,
): Promise<{ providerBody: string; preflight: ShelfBillingPreflight; maxOutputTokens: number }> {
  let maxOutputTokens = requestedOutputTokens;
  let providerBody = buildBody(maxOutputTokens);
  let preflight = await createShelfBillingPreflight(operation, model, messages, maxOutputTokens, providerBody);
  if (billing?.limitOutputTokens) {
    maxOutputTokens = await billing.limitOutputTokens(preflight);
    const minimum = Math.min(requestedOutputTokens, operation === "memory" ? 512 : 128);
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < minimum || maxOutputTokens > requestedOutputTokens) {
      throw new ShelfBillingError(503, "账户计费服务返回了无效的回复预算，请稍后重试。");
    }
    if (maxOutputTokens !== requestedOutputTokens) {
      providerBody = buildBody(maxOutputTokens);
      preflight = await createShelfBillingPreflight(operation, model, messages, maxOutputTokens, providerBody);
    }
  }
  return { providerBody, preflight, maxOutputTokens };
}

/** Do not silently ignore low reasoning or schema requirements at a fallback provider. */
export function shelfProviderRouting(model: string, maxPrice: ShelfProviderMaxPrice | undefined) {
  return maxPrice ? { max_price: maxPrice, ...(findShelfProviderModel(model) ? { require_parameters: true } : {}) } : undefined;
}
