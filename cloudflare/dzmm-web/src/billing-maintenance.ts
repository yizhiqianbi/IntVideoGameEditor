import { matchesDzmmFrozenProviderModel } from "../../../src/lib/dzmm-models";
import { readDzmmProviderConfig } from "../../../src/lib/dzmm-chat";
import { readDzmmGenerationId, readDzmmGenerationUsage, type DzmmBillingCompletion } from "../../../src/lib/dzmm-generation-billing";
import { parseDzmmCreditCostPolicy, parseDzmmProviderCostUsd, type DzmmCreditCostPolicy } from "../../../src/lib/dzmm-credit-pricing";
import type { Env } from "./worker";

export type PendingBillingGeneration = {
  reservationId: string; accountId: string; claimToken: string; generationId: string; model: string;
  outcome: DzmmBillingCompletion["outcome"];
  costPolicy?: DzmmCreditCostPolicy;
};
type MaintenanceOptions = { metadataFetch?: typeof fetch; now?: number };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function pendingGeneration(value: unknown): PendingBillingGeneration | undefined {
  if (!object(value) || !boundedToken(value.reservationId) || !boundedToken(value.accountId)
    || typeof value.claimToken !== "string" || !/^[A-Za-z0-9_-]{16,200}$/.test(value.claimToken)
    || !readDzmmGenerationId(value.generationId) || typeof value.model !== "string" || !value.model || value.model.length > 200
    || (value.outcome !== "completed" && value.outcome !== "failed" && value.outcome !== "cancelled")) return undefined;
  const costPolicy = value.costPolicy === undefined ? undefined : parseDzmmCreditCostPolicy(value.costPolicy);
  if (value.costPolicy !== undefined && !costPolicy) return undefined;
  return { reservationId: value.reservationId, accountId: value.accountId, claimToken: value.claimToken,
    generationId: value.generationId as string, model: value.model, outcome: value.outcome,
    ...(costPolicy ? { costPolicy } : {}) };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing metadata");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 64_000) { await reader.cancel(); throw new Error("Oversized metadata"); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return JSON.parse(text);
}

/** Lookup-only recovery: this endpoint cannot start or continue a generation.
 * Actual-cost policies use verified total_cost, which already covers thinking
 * and cache pricing. Legacy token policies retain their explicit zero-reasoning
 * requirement because metadata completion semantics are otherwise ambiguous. */
export async function reconcileBillingGeneration(
  env: Env, input: PendingBillingGeneration, options: MaintenanceOptions = {},
): Promise<"reconciled" | "unverified" | "unavailable"> {
  const pending = pendingGeneration(input);
  if (!pending || !env.BILLING) return "unavailable";
  const config = readDzmmProviderConfig({ DZMM_API_KEY: env.DZMM_API_KEY, DZMM_BASE_URL: env.DZMM_BASE_URL, DZMM_MODEL: env.DZMM_MODEL });
  if (!config.configured) return "unavailable";
  const base = new URL(config.baseUrl);
  if (base.origin !== "https://openrouter.ai" || base.pathname.replace(/\/$/, "") !== "/api/v1") return "unavailable";
  const endpoint = new URL("https://openrouter.ai/api/v1/generation");
  endpoint.searchParams.set("id", pending.generationId);
  try {
    const response = await (options.metadataFetch ?? fetch)(endpoint, {
      method: "GET", headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(4000), redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); return "unavailable"; }
    const payload = await boundedJson(response);
    const data = object(payload) && object(payload.data) ? payload.data : undefined;
    if (!data || data.id !== pending.generationId || !matchesDzmmFrozenProviderModel(data.model, pending.model)) return "unverified";
    const providerCostUsd = parseDzmmProviderCostUsd(data.total_cost);
    if (pending.costPolicy ? providerCostUsd === undefined : data.native_tokens_reasoning !== 0) return "unverified";
    const usage = readDzmmGenerationUsage({ prompt_tokens: data.native_tokens_prompt, completion_tokens: data.native_tokens_completion,
      ...(providerCostUsd !== undefined ? { cost: providerCostUsd } : {}) });
    if (!usage) return "unverified";
    const result = await env.BILLING.finalize({ reservationId: pending.reservationId, accountId: pending.accountId,
      claimToken: pending.claimToken, generationId: pending.generationId, outcome: pending.outcome, hasValidOutput: true, usage });
    return object(result) && object(result.receipt) && !result.error ? "reconciled" : "unavailable";
  } catch { return "unavailable"; }
}

export async function recoverBillingGenerationSoon(env: Env, input: PendingBillingGeneration, options: MaintenanceOptions = {}) {
  const first = await reconcileBillingGeneration(env, input, options);
  if (first !== "unavailable") return first;
  // Generation metadata can appear slightly after a cancelled or completed
  // stream. One short retry fits within the HTTP waitUntil extension.
  await new Promise(resolve => setTimeout(resolve, 500));
  return reconcileBillingGeneration(env, input, options);
}

/** Expiry is independent of provider availability and runs before recovery.
 * Five bounded expiry batches and ten lookups keep a cron invocation short. */
export async function runBillingMaintenance(env: Env, options: MaintenanceOptions = {}) {
  const result = { released: 0, reconciled: 0, unverified: 0, unavailable: 0 };
  if (!env.BILLING?.releaseExpired) { result.unavailable++; return result; }
  for (let batch = 0; batch < 5; batch++) {
    try {
      const response = await env.BILLING.releaseExpired();
      if (!object(response) || !Number.isSafeInteger(response.released) || typeof response.released !== "number"
        || response.released < 0 || response.released > 50 || response.error) { result.unavailable++; break; }
      result.released += response.released;
      if (response.released < 50) break;
    } catch { result.unavailable++; break; }
  }
  if (!env.BILLING.getPending) { result.unavailable++; return result; }
  let items: unknown[];
  try {
    const response = await env.BILLING.getPending(10);
    if (!object(response) || !Array.isArray(response.items) || response.items.length > 10 || response.error) {
      result.unavailable++; return result;
    }
    items = response.items;
  } catch { result.unavailable++; return result; }
  const now = options.now ?? Date.now();
  // Three lookups at a time bound latency while retaining a strict total cap.
  for (let offset = 0; offset < items.length; offset += 3) {
    const outcomes = await Promise.all(items.slice(offset, offset + 3).map(async item => {
      const pending = pendingGeneration(item);
      if (!pending || !object(item) || typeof item.expiresAt !== "number" || !Number.isSafeInteger(item.expiresAt)
        || item.expiresAt <= now) return "unverified" as const;
      return reconcileBillingGeneration(env, pending, options);
    }));
    for (const outcome of outcomes) result[outcome]++;
  }
  return result;
}
