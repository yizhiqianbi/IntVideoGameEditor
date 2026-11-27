import { DzmmValidationError, readDzmmProviderConfig } from "../../../../src/lib/dzmm-chat";
import {
  handleDzmmChatGet,
  handleDzmmChatPost,
  readDzmmJsonBody,
  type DzmmChatEnvironment,
  type DzmmChatHandlerOptions,
} from "../../../../src/lib/dzmm-chat-handler";
import { handleCoverCaptionPost } from "../../../../src/lib/dzmm-cover-caption-handler";
import { parseDzmmCreditCostPolicy } from "../../../../src/lib/dzmm-credit-pricing";
import { DzmmBillingError, readDzmmProviderMaxPrice, type DzmmBillingLifecycle } from "../../../../src/lib/dzmm-generation-billing";
import { handleDzmmIllustrationsPost } from "../../../../src/lib/dzmm-illustration-handler";
import { handleDzmmMemoryPost } from "../../../../src/lib/dzmm-memory-handler";
import { dzmmModelCostPolicy, findDzmmProviderModel, isDzmmDirectTariffModel } from "../../../../src/lib/dzmm-models";
import { handleDzmmNovelPost } from "../../../../src/lib/dzmm-novel-handler";
import { handleDzmmReplySuggestionsPost } from "../../../../src/lib/dzmm-reply-suggestions-handler";
import { parseScenarioGenerationRequest, scenarioGenerationPreparation } from "../../../../src/lib/xumeng-scenario-handler";
import type { XumengScenarioRoom } from "../../../../src/lib/xumeng-scenarios";
import { recoverBillingGenerationSoon } from "../billing-maintenance";
import { BACKEND_ORIGIN, GatewayError, authenticatedUser, backendHeaders, json, sessionCookie, type Env } from "./shared";

function chatEnvironment(env: Env): DzmmChatEnvironment {
  // Only the explicitly bound Worker values are passed; local process.env is
  // not consulted and provider secrets are never exposed by the status route.
  return {
    DZMM_API_KEY: env.DZMM_API_KEY,
    SEALION_API_KEY: env.SEALION_API_KEY,
    SEALION_BASE_URL: env.SEALION_BASE_URL,
    WHATSTOKEN_API_KEY: env.WHATSTOKEN_API_KEY,
    WHATSTOKEN_BASE_URL: env.WHATSTOKEN_BASE_URL,
    DZMM_WHATSTOKEN_CHAT_ENABLED: env.DZMM_WHATSTOKEN_CHAT_ENABLED,
    DZMM_BASE_URL: env.DZMM_BASE_URL,
    DZMM_MODEL: env.DZMM_MODEL,
    DZMM_FAST_MODEL: env.DZMM_FAST_MODEL,
    DZMM_BALANCED_MODEL: env.DZMM_BALANCED_MODEL,
    DZMM_STORY_MODEL: env.DZMM_STORY_MODEL,
    DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: env.DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION,
    DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: env.DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION,
    TAVERN_ENGINE: env.TAVERN_ENGINE,
    TAVERN_GROUP: env.TAVERN_GROUP,
    TAVERN_SAMPLER: env.TAVERN_SAMPLER,
    TAVERN_IMAGE_PRESETS: env.TAVERN_IMAGE_PRESETS,
    TAVERN_MEMORY: env.TAVERN_MEMORY,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function billingRpcError(value: unknown): void {
  if (!object(value) || !object(value.error)) return;
  const status = value.error.status;
  const message = value.error.message;
  const code = value.error.code;
  if (typeof status === "number" && [400, 401, 402, 403, 409, 503].includes(status)
    && typeof message === "string" && message.length <= 300 && !message.includes("\0")) {
    throw new DzmmBillingError(status, message,
      typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code
        : ({ 400: "INVALID_BILLING_REQUEST", 401: "AUTH_REQUIRED", 402: "CREDIT_INSUFFICIENT", 403: "BILLING_ACCOUNT_REQUIRED",
          409: "BILLING_REQUEST_USED", 503: "BILLING_UNAVAILABLE" } as Record<number, string>)[status]);
  }
  throw new DzmmBillingError(503, "账户计费服务暂时不可用，请稍后重试。");
}

function billingLifecycle(request: Request, env: Env, accountId: string, requestId: string, options: DzmmChatHandlerOptions): DzmmBillingLifecycle {
  if (!env.BILLING) return { async reserve() {
    throw new DzmmBillingError(503, "账户计费服务未连接，请稍后重试。");
  } };
  const binding = env.BILLING;
  const sessionToken = sessionCookie(request)?.slice("dzmm_session=".length) ?? "";
  return { async limitOutputTokens(preflight) {
    // Legacy bindings still reserve the full requested ceiling; they cannot
    // grant an underfunded generation. Current production exposes quote.
    if (!binding.quote) return preflight.maxOutputTokens;
    let value: unknown;
    try { value = await binding.quote({ ...preflight, sessionToken, accountId, requestId }); }
    catch { throw new DzmmBillingError(503, "账户回复预算暂时不可用，请稍后重试。"); }
    billingRpcError(value);
    if (object(value) && value.enabled === false) return preflight.maxOutputTokens;
    const minimum = Math.min(preflight.maxOutputTokens, preflight.operation === "memory" ? 512 : 128);
    if (!object(value) || value.enabled !== true || !Number.isSafeInteger(value.maxOutputTokens)
      || (value.maxOutputTokens as number) < minimum || (value.maxOutputTokens as number) > preflight.maxOutputTokens) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效的回复预算，请稍后重试。");
    }
    return value.maxOutputTokens as number;
  }, async reserve(preflight) {
    let value: unknown;
    try { value = await binding.reserve({ ...preflight, sessionToken, accountId, requestId }); }
    catch { throw new DzmmBillingError(503, "账户计费服务暂时不可用，请稍后重试。"); }
    billingRpcError(value);
    if (object(value) && value.enabled === false) return undefined;
    if (!object(value) || value.enabled !== true || !object(value.receipt)) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效记录，请稍后重试。");
    }
    if (value.created !== true) throw new DzmmBillingError(409, "该生成请求已经处理，请刷新后重新发送。", "BILLING_REQUEST_USED");
    const reservationId = value.receipt.id;
    const claimToken = value.claimToken;
    const costPolicy = Object.hasOwn(value.receipt, "costPolicy") ? parseDzmmCreditCostPolicy(value.receipt.costPolicy) : undefined;
    if (Object.hasOwn(value.receipt, "costPolicy") && !costPolicy) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效费率，请稍后重试。");
    }
    if (typeof reservationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(reservationId)
      || typeof claimToken !== "string" || !/^[A-Za-z0-9_-]{16,200}$/.test(claimToken)) {
      throw new DzmmBillingError(503, "账户计费服务返回了无效记录，请稍后重试。");
    }
    const registeredModel = findDzmmProviderModel(preflight.model);
    if (costPolicy || (registeredModel && registeredModel.id !== "grok")) {
      try {
        if (registeredModel) {
          const expectedPolicy = costPolicy
            ? dzmmModelCostPolicy(costPolicy, preflight.model, { applyMinCredits: preflight.operation === "chat" })
            : undefined;
          if (!costPolicy || value.receipt.model !== preflight.model || !expectedPolicy
            || ["inputUsdPerMillion", "outputUsdPerMillion", "maxInputUsdPerMillion", "maxOutputUsdPerMillion", "minCredits"]
              .some(field => costPolicy[field as keyof typeof costPolicy] !== expectedPolicy[field as keyof typeof expectedPolicy])) {
            throw new DzmmBillingError(503, "当前模型与冻结计费记录不一致，请联系站主检查服务配置。");
          }
        }
        if (!isDzmmDirectTariffModel(preflight.model)) {
          const caps = readDzmmProviderMaxPrice(chatEnvironment(env), readDzmmProviderConfig(chatEnvironment(env)).baseUrl, preflight.model);
          if (!costPolicy || !caps || caps.prompt > costPolicy.maxInputUsdPerMillion || caps.completion > costPolicy.maxOutputUsdPerMillion) {
            throw new DzmmBillingError(503, "模型成本上限与计费配置不一致，请联系站主检查服务配置。");
          }
        }
      } catch (failure) {
        // A grant already holds funds. Configuration rejection must release it
        // before returning, without starting a provider generation.
        try { billingRpcError(await binding.finalize({ reservationId, accountId, claimToken, outcome: "failed", hasValidOutput: false })); }
        catch { throw new DzmmBillingError(503, "配置核对失败，余额预留待恢复，请稍后刷新查看。"); }
        throw failure;
      }
    }
    return { async finalize(completion) {
      let result: unknown;
      try { result = await binding.finalize({ ...completion, reservationId, accountId, claimToken }); }
      catch { throw new DzmmBillingError(503, "余额结算暂未完成，请稍后刷新查看。"); }
      billingRpcError(result);
      if (completion.hasValidOutput && (!completion.usage || (costPolicy && completion.usage.providerCostUsd === undefined))
        && completion.generationId && options.waitUntil && object(result) && object(result.receipt) && result.receipt.status === "pending") {
        const recovery = recoverBillingGenerationSoon(env, { reservationId, accountId, claimToken,
          generationId: completion.generationId, model: preflight.model, outcome: completion.outcome, ...(costPolicy ? { costPolicy } : {}) },
        { metadataFetch: options.billingMetadataFetch });
        options.waitUntil(recovery);
      }
    } };
  } };
}

export async function chat(
  request: Request,
  env: Env,
  options: DzmmChatHandlerOptions,
  memory = false,
  novel = false,
  suggestions = false,
  illustrations = false,
  coverCaption = false,
): Promise<Response> {
  if (request.method === "GET" && !memory && !novel && !suggestions && !illustrations && !coverCaption) return handleDzmmChatGet(chatEnvironment(env));
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: memory || novel || suggestions || illustrations || coverCaption ? "POST" : "GET, POST" });
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "聊天请求应为 JSON。" }, 415);
  }
  const suppliedId = request.headers.get("X-Xumeng-Request-Id");
  if (suppliedId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(suppliedId)) {
    return json({ error: "生成请求编号无效，请刷新后重试。", code: "INVALID_REQUEST_ID" }, 400);
  }
  const requestId = suppliedId?.toLowerCase() ?? crypto.randomUUID();
  const userId = await authenticatedUser(request, env);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // IP limits survive guest-cookie rotation; user limits follow an account
  // across IPs. Cloudflare counters are per location and eventually consistent.
  const limiter = memory ? env.MEMORY_RATE_LIMITER ?? env.CHAT_RATE_LIMITER : env.CHAT_RATE_LIMITER;
  const kind = memory ? "memory" : coverCaption ? "cover-caption" : illustrations ? "illustration" : suggestions ? "reply-suggestions" : "chat";
  const ipLimit = await limiter.limit({ key: `${kind}:ip:${ip}` });
  const userLimit = ipLimit.success && await limiter.limit({ key: `${kind}:user:${userId}` });
  if (!ipLimit.success || !userLimit || !userLimit.success) {
    return json({ error: "对话请求过于频繁，请稍后重试。" }, 429, { "Retry-After": "60" });
  }
  const billing = billingLifecycle(request, env, userId, requestId, options);
  const handlerOptions = { ...options, billing };
  const response = await (memory ? handleDzmmMemoryPost(request, chatEnvironment(env), handlerOptions)
    : novel ? handleDzmmNovelPost(request, chatEnvironment(env), handlerOptions)
      : coverCaption ? handleCoverCaptionPost(request, chatEnvironment(env), handlerOptions)
      : illustrations ? handleDzmmIllustrationsPost(request, chatEnvironment(env), handlerOptions)
        : suggestions ? handleDzmmReplySuggestionsPost(request, chatEnvironment(env), handlerOptions) : handleDzmmChatPost(request, chatEnvironment(env), handlerOptions));
  const headers = new Headers(response.headers);
  headers.set("X-Xumeng-Request-Id", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function scenarioNarration(request: Request, env: Env, options: DzmmChatHandlerOptions): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ error: "团本生成请求应为 JSON。" }, 415);
  try {
    const input = parseScenarioGenerationRequest(await readDzmmJsonBody(request));
    const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/scenarios/rooms/${encodeURIComponent(input.scenarioRoomId)}`, { headers: backendHeaders(request), signal: request.signal, redirect: "manual" }));
    if (!upstream.ok) { await upstream.body?.cancel(); throw new GatewayError(upstream.status === 401 || upstream.status === 404 ? upstream.status : 503, "无法读取当前团本，请重新打开房间。"); }
    const value = await upstream.json() as { accountId?: string; room?: XumengScenarioRoom };
    if (!value.accountId || !value.room || value.room.id !== input.scenarioRoomId || !value.room.isHost || value.room.hostId !== value.accountId) throw new GatewayError(403, "只有当前房间主持人可以生成叙事。");
    if (value.room.status === "ended") throw new GatewayError(409, "房间已结束，不能继续生成叙事。");
    const prepareInput = scenarioGenerationPreparation(value.room);
    const headers = new Headers(request.headers); headers.set("X-Xumeng-Request-Id", input.requestId);
    const forwarded = new Request(request.url, { method: "POST", headers, body: JSON.stringify(input), signal: request.signal });
    return chat(forwarded, env, { ...options, prepareInput });
  } catch (error) { if (error instanceof DzmmValidationError) return json({ error: error.message }, 400); throw error; }
}
