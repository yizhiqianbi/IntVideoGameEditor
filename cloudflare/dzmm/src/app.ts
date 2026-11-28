import { handleAdmin } from "./admin";
import { listPublicHomeBanners } from "./home-banners";
import { listPublicStudioCovers, publicStudioCover } from "./studio-covers";
import { listPublicGenerationTemplates, publicGenerationTemplateMedia } from "./generation-templates";
import { handleProductEvent, publicCatalogFilters, publicScenePrices } from "./ops-console";
import { handleTelegramFeedback } from "./telegram-feedback";
import { handleAuth, requireUser } from "./auth";
import { handleSocialAuth } from "./social-auth";
import { handleVideoWatch } from "./video-watch";
import { handleApi } from "./data";
import { handleCanvasUserMedia } from "./canvas-user-media";
import { handleGeneration } from "./generation";
import { handleMedia } from "./media";
import { handleCallBilling } from "./call-billing";
import { handleChatMedia } from "./chat-media";
import { handlePublicRelationshipAlbum, handleRelationshipAlbum } from "./relationship-album";
import { handleCharacterVoice } from "./character-voice";
import { handleAigen, publicAigenRef } from "./aigen";
import { handleShares, publicShare } from "./shares";
import { handleVideoCharacters, publicVideoCharacter } from "./video-characters";
import { handleSpeechInput } from "./speech-input";
import { handleForum } from "./forum";
import { handleShelfTagWrite, listShelfTags } from "./shelf-tags";
import { handlePublishingApi } from "./publishing";
import type { BackgroundExecutionContext } from "./character-translations";
import { handleRecommendations } from "./recommendations";
import { handleTasks } from "./tasks";
import { handleDreamCoin } from "./dream-coin";
import { handleReferral } from "./referrals";
import { handleAcquisition } from "./acquisition";
import { handleTaskMarket } from "./task-market";
import { handlePaymentsApi } from "./payments";
import { handleSubscriptions } from "./subscriptions";
import { handleNowpayments } from "./nowpayments";
import { handleBillingApi } from "./billing-api";
import { handleGames } from "./games";
import { handleScenarios } from "./scenarios";
import { handleNovels } from "./novels";
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

export async function fetchRequest(request: Request, env: Env, ctx?: BackgroundExecutionContext): Promise<Response> {
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
      } else if (request.method === "GET" && path === "/v1/shelf-tags") {
        response = await listShelfTags(env);
      } else if (request.method === "GET" && path === "/v1/home/banners") {
        response = await listPublicHomeBanners(request, env);
      } else if (request.method === "GET" && path === "/v1/studio/covers") {
        response = await listPublicStudioCovers(env);
      } else if (request.method === "GET" && /^\/v1\/studio\/covers\/[a-z]+$/.test(path)) {
        response = await publicStudioCover(env, path.slice("/v1/studio/covers/".length)) ?? new Response("not found", { status: 404 });
      } else if (request.method === "GET" && path === "/v1/generation-templates") {
        response = await listPublicGenerationTemplates(env);
      } else if (request.method === "GET" && /^\/v1\/generation-templates\/tpl_[a-z0-9]{6,24}\/(poster|video)$/.test(path)) {
        const parts = path.split("/");
        response = await publicGenerationTemplateMedia(request, env, parts[3], parts[4] as "poster" | "video") ?? new Response("not found", { status: 404 });
      } else if (request.method === "GET" && path === "/v1/billing/scene-prices") {
        response = await publicScenePrices(env);
      } else if (request.method === "GET" && path === "/v1/catalog/filters") {
        response = await publicCatalogFilters(env);
      } else if (request.method === "GET" && /^\/v1\/video-characters\/[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(path)) {
        response = await publicVideoCharacter(request, env, path.slice("/v1/video-characters/".length));
      } else if (request.method === "GET" && /^\/v1\/shares\/[a-z0-9]{8,16}$/.test(path)) {
        response = await publicShare(request, env, path.slice("/v1/shares/".length));
      } else if (request.method === "GET" && /^\/v1\/aigen\/ref\//.test(path)) {
        response = await publicAigenRef(env, path) ?? new Response("not found", { status: 404 });
      } else {
        const billingResponse = await handleTelegramFeedback(request, env) ?? await handleAdmin(request, env) ?? await handleBillingApi(request, env);
        const subscriptionsResponse = billingResponse ?? await handleNowpayments(request, env) ?? await handleSubscriptions(request, env);
        const paymentsResponse = subscriptionsResponse ?? await handlePaymentsApi(request, env);
        const publishingResponse = paymentsResponse ? null : await handlePublishingApi(request, env, undefined, ctx);
        const authResponse = paymentsResponse || publishingResponse ? null : await handleSocialAuth(request, env) ?? await handleAuth(request, env);
        if (paymentsResponse) response = paymentsResponse;
        else if (publishingResponse) response = publishingResponse;
        else if (authResponse) response = authResponse;
        else {
          const user = await requireUser(request, env);
          // The signed-in album must win over the public album; the public
          // handler is only a fallback for viewers without their own images.
          response = await handleRelationshipAlbum(request, env, user) ?? await handleVideoWatch(request, env, user) ?? await handleCallBilling(request, env, user) ?? await handleProductEvent(request, env, user) ?? await handleCanvasUserMedia(request, env, user) ?? await handleRecommendations(request, env, user) ?? await handleShelfTagWrite(request, env, user) ?? await handleVideoCharacters(request, env, user) ?? await handleShares(request, env, user) ?? await handleAigen(request, env, user) ?? await handleGeneration(request, env, user) ?? await handleNovels(request, env, user) ?? await handleGames(request, env, user) ?? await handleScenarios(request, env, user) ?? await handleTaskMarket(request, env, user) ?? await handleDreamCoin(request, env, user) ?? await handleAcquisition(request, env, user) ?? await handleReferral(request, env, user) ?? await handleTasks(request, env, user) ?? await handleSpeechInput(request, env, user) ?? await handleCharacterVoice(request, env, user) ?? await handleChatMedia(request, env, user) ?? await handleMedia(request, env, user) ?? await handleForum(request, env, user) ?? await handlePublicRelationshipAlbum(request, env) ?? await handleApi(request, env, user);
        }
      }
    }
  } catch (error) {
    // Unexpected failures are otherwise indistinguishable at the edge; log the
    // route, the error name and the top stack frames only.
    if (!(error instanceof ApiError)) console.error("request_failed", {
      path: new URL(request.url).pathname,
      error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : typeof error,
      frame: error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 3).join(" | ").slice(0, 300) : "",
    });
    response = error instanceof ApiError
      ? json({ error: error.message, ...error.details }, error.status)
      : json({ error: "服务暂时不可用，请稍后重试。" }, 500);
  }
  return cors(response, request, env);
}

const worker = { fetch: fetchRequest };
export default worker;
