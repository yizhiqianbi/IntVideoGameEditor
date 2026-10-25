import { handleAdmin } from "./admin";
import { handleTelegramFeedback } from "./telegram-feedback";
import { handleAuth, requireUser } from "./auth";
import { handleApi } from "./data";
import { handleGeneration } from "./generation";
import { handleMedia } from "./media";
import { handleChatMedia } from "./chat-media";
import { handleCharacterVoice } from "./character-voice";
import { handleForum } from "./forum";
import { handlePublishingApi } from "./publishing";
import { handleTasks } from "./tasks";
import { handleDreamCoin } from "./dream-coin";
import { handleReferral } from "./referrals";
import { handleTaskMarket } from "./task-market";
import { handlePaymentsApi } from "./payments";
import { handleSubscriptions } from "./subscriptions";
import { handleNowpayments } from "./nowpayments";
import { handleBillingApi } from "./billing-api";
import { handleGames } from "./games";
import { handleScenarios } from "./scenarios";
import { handleNovels } from "./novels";
import { handleCreatorCommunity } from "./creator-community";
import { ApiError, json } from "./http";
import type { Env } from "./types";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function allowedOrigins(request: Request, env: Env): Set<string> {
  return new Set([new URL(request.url).origin, ...(env.APP_ORIGINS || "").split(/[\s,]+/).filter(Boolean)]);
}

export function checkMutationOrigin(request: Request, env: Env): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin ? !allowedOrigins(request, env).has(origin) : request.headers.has("Sec-Fetch-Site")) {
    throw new ApiError(403, "当前来源不允许修改账户数据。");
  }
}

function cors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(request, env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, If-Match");
  }
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function fetchRequest(request: Request, env: Env): Promise<Response> {
  let response: Response;
  try {
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (!origin || !allowedOrigins(request, env).has(origin)) throw new ApiError(403, "当前来源不允许访问此接口。");
      response = new Response(null, { status: 204 });
    } else {
      const path = new URL(request.url).pathname;
      // Stripe authenticates its exact raw-body endpoint with a signature;
      // Telegram uses a separately configured constant-time secret check.
      // All browser mutations retain the existing origin checks.
      if (path !== "/v1/payments/webhook" && path !== "/v1/telegram/feedback/webhook" && path !== "/v1/payments/nowpayments/ipn" && path !== "/v1/payments/guagua/notify") checkMutationOrigin(request, env);
      if (request.method === "GET" && (path === "/health" || path === "/v1/health")) {
        await env.DB.prepare("SELECT 1 AS ok").first();
        response = json({ ok: true, service: "dzmm", storage: "d1" });
      } else {
        const billingResponse = await handleTelegramFeedback(request, env) ?? await handleAdmin(request, env) ?? await handleBillingApi(request, env);
        const subscriptionsResponse = billingResponse ?? await handleNowpayments(request, env) ?? await handleSubscriptions(request, env);
        const paymentsResponse = subscriptionsResponse ?? await handlePaymentsApi(request, env);
        const publishingResponse = paymentsResponse ? null : await handlePublishingApi(request, env);
        const authResponse = paymentsResponse || publishingResponse ? null : await handleAuth(request, env);
        const communityResponse = paymentsResponse || publishingResponse || authResponse ? null : await handleCreatorCommunity(request, env);
        if (paymentsResponse) response = paymentsResponse;
        else if (publishingResponse) response = publishingResponse;
        else if (authResponse) response = authResponse;
        else if (communityResponse) response = communityResponse;
        else {
          const user = await requireUser(request, env);
          response = await handleGeneration(request, env, user) ?? await handleNovels(request, env, user) ?? await handleGames(request, env, user) ?? await handleScenarios(request, env, user) ?? await handleTaskMarket(request, env, user) ?? await handleDreamCoin(request, env, user) ?? await handleReferral(request, env, user) ?? await handleTasks(request, env, user) ?? await handleCharacterVoice(request, env, user) ?? await handleChatMedia(request, env, user) ?? await handleMedia(request, env, user) ?? await handleForum(request, env, user) ?? await handleApi(request, env, user);
        }
      }
    }
  } catch (error) {
    response = error instanceof ApiError
      ? json({ error: error.message, ...error.details }, error.status)
      : json({ error: "服务暂时不可用，请稍后重试。" }, 500);
  }
  return cors(response, request, env);
}

const worker = { fetch: fetchRequest };
export default worker;
