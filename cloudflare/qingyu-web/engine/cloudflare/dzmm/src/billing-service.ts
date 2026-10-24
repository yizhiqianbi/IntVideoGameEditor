import { WorkerEntrypoint } from "cloudflare:workers";
import type { DzmmBillingReserveRpcInput, DzmmBillingFinalizeRpcInput } from "../../../src/lib/dzmm-generation-billing";
import { requireUser } from "./auth";
import { creditBillingConfig, finalizeCreditUsage, getPendingCreditUsage, quoteCreditUsage, releaseExpiredCreditUsage, reserveCreditUsage } from "./credit-usage";
import { ApiError } from "./http";
import type { Env } from "./types";
import { companionFinalize, companionGet, companionOverview, companionReleaseExpired, companionReserve } from "./companion-billing";

/** Named service binding only; public fetch exposes no mutations. */
export class BillingService extends WorkerEntrypoint<Env> {
  async #guard<T>(action: () => Promise<T>) {
    try { return await action(); }
    catch (error) {
      return { error: error instanceof ApiError
        ? { status: error.status, message: error.message, ...(typeof error.details?.code === "string" ? { code: error.details.code } : {}) }
        : { status: 503, message: "计费服务暂时不可用，请稍后重试。" } };
    }
  }
  async #authenticatedPreflight(input: DzmmBillingReserveRpcInput, operation: "quote" | "reserve") {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["sessionToken", "accountId", "requestId", "operation", "model", "requestFingerprint", "inputTokenUpperBound", "maxOutputTokens"].includes(key)))
      throw new ApiError(400, "计费请求格式无效，金额只能由服务端确定。");
    if (typeof input.sessionToken !== "string" || !/^[a-f0-9]{64}$/.test(input.sessionToken))
      throw new ApiError(401, "登录状态已失效，请重新登录。");
    const request = new Request(`https://billing.internal/${operation}`, { headers: { Cookie: `qingyu_session=${input.sessionToken}` } });
    const user = await requireUser(request, this.env);
    if (input.accountId !== user.id) throw new ApiError(401, "账户已切换，请重新登录。");
    const { sessionToken: _token, accountId: _account, ...preflight } = input;
    return { request, user, preflight };
  }
  quote(input: DzmmBillingReserveRpcInput) {
    return this.#guard(async () => {
      const { request, user, preflight } = await this.#authenticatedPreflight(input, "quote");
      return quoteCreditUsage(request, this.env, user, preflight);
    });
  }
  reserve(input: DzmmBillingReserveRpcInput) {
    return this.#guard(async () => {
      const { request, user, preflight } = await this.#authenticatedPreflight(input, "reserve");
      if (!creditBillingConfig(this.env).enabled) {
        if (this.env.CREDIT_BILLING_ENABLED === "true") throw new ApiError(503, "模型 Credit 费率配置无效，请稍后重试。");
        return { enabled: false as const };
      }
      return { enabled: true as const, ...await reserveCreditUsage(request, this.env, user, preflight) };
    });
  }
  finalize(input: DzmmBillingFinalizeRpcInput) {
    return this.#guard(async () => ({ receipt: await finalizeCreditUsage(this.env, input) }));
  }
  getPending(limit = 20) {
    return this.#guard(async () => ({ items: await getPendingCreditUsage(this.env, limit) }));
  }
  releaseExpired(limit = 50) {
    return this.#guard(async () => ({ released: await releaseExpiredCreditUsage(this.env, null, {}, limit) }));
  }
  companionReserve(input: unknown) {
    return this.#guard(async () => companionReserve(this.env, input));
  }
  companionFinalize(input: unknown) {
    return this.#guard(async () => companionFinalize(this.env, input));
  }
  companionGet(input: unknown) {
    return this.#guard(async () => companionGet(this.env, input));
  }
  companionReleaseExpired(limit = 50) {
    return this.#guard(async () => companionReleaseExpired(this.env, limit));
  }
  async companionOverview(request: Request) {
    return this.#guard(async () => {
      const user = await requireUser(request, this.env);
      return companionOverview(this.env, request, user);
    });
  }
}
