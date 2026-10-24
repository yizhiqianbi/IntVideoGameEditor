import { ContentError } from "./qingyu-content-error";
import { dzmmModelReasoning, dzmmModelTemperature } from "./dzmm-models";
import {
  buildDzmmPromptPlan,
  createDzmmSseParser,
  DZMM_REQUEST_LIMIT_BYTES,
  DZMM_MAX_MESSAGE_CHARS,
  DzmmProviderStreamError,
  DzmmValidationError,
  readDzmmProviderConfig,
  sanitizeDzmmProviderError,
  validateDzmmChatInput,
  currentDzmmWorldState,
} from "./dzmm-chat";
import { applyDzmmWorldPatch, readDzmmExplicitTimeJump } from "./dzmm-world-state";
import { createDzmmWorldTailFilter, encodeDzmmWorldEvent } from "./dzmm-world-stream";
import { prepareDzmmBillingRequest, DzmmBillingError, dzmmProviderRouting, readDzmmGenerationId, readDzmmProviderMaxPrice, trustedDzmmGenerationUsage,
  type DzmmBillingCompletion, type DzmmBillingLease, type DzmmBillingLifecycle } from "./dzmm-generation-billing";

export type DzmmChatEnvironment = Record<string, string | undefined>;

export type DzmmChatHandlerOptions = {
  providerFetch?: typeof fetch;
  billingMetadataFetch?: typeof fetch;
  billing?: DzmmBillingLifecycle;
  waitUntil?: (promise: Promise<unknown>) => void;
  now?: () => number;
  /** Server-owned preparation for another writing workflow; never selected by request fields. */
  prepareInput?: (body: unknown, now: number) => {
    input: ReturnType<typeof validateDzmmChatInput>;
    plan: ReturnType<typeof buildDzmmPromptPlan>;
  };
};

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function failure(message: string, status: number, code?: string) {
  return Response.json({ error: message, ...(code ? { code } : {}) }, { status, headers: RESPONSE_HEADERS });
}

export async function readDzmmJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > DZMM_REQUEST_LIMIT_BYTES) {
    throw new DzmmValidationError("聊天请求过大，请减少聊天记录或角色设定。");
  }
  if (!request.body) throw new DzmmValidationError("聊天请求不能为空。");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > DZMM_REQUEST_LIMIT_BYTES) {
        await reader.cancel();
        throw new DzmmValidationError("聊天请求过大，请减少聊天记录或角色设定。");
      }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DzmmValidationError("聊天请求应为有效的 JSON。");
  }
}

export async function handleDzmmChatGet(env: DzmmChatEnvironment): Promise<Response> {
  const config = readDzmmProviderConfig(env);
  return Response.json({
    configured: config.configured,
    model: config.models.balanced,
    models: config.models,
  }, { headers: RESPONSE_HEADERS });
}

export async function handleDzmmChatPost(
  request: Request,
  env: DzmmChatEnvironment,
  options: DzmmChatHandlerOptions = {},
): Promise<Response> {
  let input: ReturnType<typeof validateDzmmChatInput>;
  let plan: ReturnType<typeof buildDzmmPromptPlan>;
  const requestTime = (options.now ?? Date.now)();
  try {
    const body = await readDzmmJsonBody(request);
    if (options.prepareInput) ({ input, plan } = options.prepareInput(body, requestTime));
    else { input = validateDzmmChatInput(body); plan = buildDzmmPromptPlan(input, requestTime); }
  } catch (error) {
    return failure(error instanceof DzmmValidationError ? error.message : "无法读取聊天请求，请重试。", 400);
  }
  const config = readDzmmProviderConfig(env);
  if (!config.configured) {
    return failure("模型服务未配置。请在服务端设置 DZMM_API_KEY 或 OPENROUTER_API_KEY，并检查模型服务地址。", 503);
  }

  let maxPrice: ReturnType<typeof readDzmmProviderMaxPrice>;
  try { maxPrice = readDzmmProviderMaxPrice(env, config.baseUrl, config.models[input.model]); }
  catch (error) {
    return failure(error instanceof DzmmBillingError ? error.message : "模型成本上限配置无效，请联系站主。", 503, "BILLING_UNAVAILABLE");
  }
  const buildProviderBody = (maxOutputTokens: number) => JSON.stringify({
    model: config.models[input.model], stream: true, messages: plan.messages,
    ...dzmmModelReasoning(config.models[input.model]),
    ...(maxPrice ? { provider: dzmmProviderRouting(config.models[input.model], maxPrice) } : {}),
    ...dzmmModelTemperature(config.models[input.model], input.model === "story" ? 0.9 : 0.75), max_tokens: maxOutputTokens,
  });
  let effectiveMaxTokens = input.maxTokens;
  let lease: DzmmBillingLease | undefined;
  let billingCompletion: Promise<void> | undefined;
  let parser: ReturnType<typeof createDzmmSseParser> | undefined;
  let generationId: string | undefined;
  let outputChars = 0;
  function finishBilling(outcome: DzmmBillingCompletion["outcome"]): Promise<void> {
    if (!lease) return Promise.resolve();
    if (!billingCompletion) {
      const usage = trustedDzmmGenerationUsage(parser?.usage, config.baseUrl);
      const completion: DzmmBillingCompletion = { outcome, hasValidOutput: outputChars > 0,
        ...(usage ? { usage } : {}),
        ...(parser?.generationId || generationId ? { generationId: parser?.generationId || generationId } : {}) };
      billingCompletion = Promise.resolve().then(() => lease!.finalize(completion)).catch(() => {
        throw new DzmmBillingError(503, "余额结算暂未完成，请稍后刷新查看。");
      });
      // A cancelled browser response must not cancel the server's refund or
      // settlement. The backend also expires abandoned reservations safely.
      options.waitUntil?.(billingCompletion.catch(() => {}));
    }
    return billingCompletion;
  }

  const abortController = new AbortController();
  let timedOut = false;
  const abortOnDisconnect = () => {
    abortController.abort();
    void finishBilling("cancelled").catch(() => {});
  };
  request.signal.addEventListener("abort", abortOnDisconnect, { once: true });
  if (request.signal.aborted) abortController.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, 90_000);
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortOnDisconnect);
  }
  async function stopUpstream() {
    abortController.abort();
    try { await upstreamReader?.cancel(); } catch { /* Stream may already be closed. */ }
    cleanup();
  }
  function streamError(error: unknown): Error {
    if (error instanceof DzmmBillingError || error instanceof ContentError) return error;
    if (timedOut) return new Error("模型回复超时，请稍后重试。");
    if (request.signal.aborted) return new Error("已停止生成。");
    if (error instanceof DzmmProviderStreamError) return new Error(error.message);
    return new Error("模型连接中断，请稍后重试。");
  }

  try {
    if (request.signal.aborted) throw new Error("Cancelled before provider request");
    const prepared = await prepareDzmmBillingRequest("chat", config.models[input.model], plan.messages,
      input.maxTokens, buildProviderBody, options.billing);
    effectiveMaxTokens = prepared.maxOutputTokens;
    if (request.signal.aborted || abortController.signal.aborted) throw new Error("Cancelled before billing reservation");
    if (options.billing) lease = await options.billing.reserve(prepared.preflight);
    if (request.signal.aborted || abortController.signal.aborted) throw new Error("Cancelled before provider request");
    const upstream = await (options.providerFetch ?? fetch)(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "X-Title": "Local Roleplay Prototype",
      },
      body: prepared.providerBody,
      signal: abortController.signal,
    });
    if (abortController.signal.aborted) {
      await upstream.body?.cancel();
      throw new Error("Cancelled provider request");
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      await finishBilling("failed");
      cleanup();
      return failure(sanitizeDzmmProviderError(upstream.status, detail), upstream.status === 429 ? 429 : 502);
    }
    if (!upstream.body || !upstream.headers.get("content-type")?.includes("text/event-stream")) {
      await upstream.body?.cancel();
      await finishBilling("failed");
      cleanup();
      return failure("模型服务没有返回流式回复，请检查模型服务配置。", 502);
    }

    upstreamReader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    parser = createDzmmSseParser();
    generationId = readDzmmGenerationId(upstream.headers.get("X-Generation-Id"));
    const pending: string[] = [];
    let finished = false;
    const worldFilter = input.world ? createDzmmWorldTailFilter() : undefined;
    let visibleAnswer = "";
    function queue(parts: string[]) {
      for (const part of parts) {
        const text = worldFilter ? worldFilter.push(part) : part;
        if (text) pending.push(text);
      }
    }

    async function nextText(): Promise<string | null> {
      while (!pending.length && !finished) {
        const result = await upstreamReader!.read();
        if (result.done) {
          queue([...parser!.push(decoder.decode()), ...parser!.finish()]);
          worldFilter?.finish();
          finished = true;
        } else {
          queue(parser!.push(decoder.decode(result.value, { stream: true })));
          if (parser!.done) {
            worldFilter?.finish();
            finished = true;
            await upstreamReader!.cancel();
          }
        }
      }
      return pending.shift() ?? null;
    }

    // Read the first content delta before sending headers, so provider failures
    // and empty completions can still produce a useful JSON error response.
    let firstText = "";
    while (!firstText.trim()) {
      const text = await nextText();
      if (text === null || firstText.length > DZMM_MAX_MESSAGE_CHARS) {
        await stopUpstream();
        await finishBilling("failed");
        return failure("模型没有返回回复，请重试或切换模型档位。", 502);
      }
      firstText += text;
    }
    // A whitespace-only completion must fail before headers are sent. Removing
    // its leading whitespace also keeps a capped first chunk nonempty.
    firstText = firstText.trimStart();
    if (abortController.signal.aborted) throw new Error("Cancelled before stream response");
    let first = firstText;
    let outputLimitReached = false;
    let clientCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (abortController.signal.aborted) throw new Error("Cancelled stream response");
          if (outputLimitReached) {
            throw new DzmmProviderStreamError("回复达到长度上限，已保留内容，请继续对话。");
          }
          let text = first || await nextText();
          first = "";
          if (abortController.signal.aborted) throw new Error("Cancelled stream response");
          if (text === null) {
            await finishBilling("completed");
            if (input.world) {
              const userText = input.messages.at(-1)!.content;
              let state = currentDzmmWorldState(input.world, requestTime, userText), updated = false;
              const proposal = worldFilter?.proposal();
              if (proposal !== undefined) {
                try {
                  state = applyDzmmWorldPatch(state, proposal, { user: userText,
                    assistant: visibleAnswer, clockMode: input.world.clockMode,
                    appliedTimeJump: readDzmmExplicitTimeJump(userText) });
                  updated = true;
                } catch { /* Unverified proposals never change the accepted fictional facts. */ }
              }
              controller.enqueue(encoder.encode(encodeDzmmWorldEvent({ type: "world", state, recordedAt: requestTime, updated })
                + encodeDzmmWorldEvent({ type: "done" })));
            }
            cleanup();
            controller.close();
          } else {
            const remaining = DZMM_MAX_MESSAGE_CHARS - outputChars;
            if (text.length > remaining) {
              text = text.slice(0, remaining);
              // Avoid ending the retained reply in the middle of an emoji.
              if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
              outputLimitReached = true;
            }
            if (!text) throw new DzmmProviderStreamError("回复达到长度上限，已保留内容，请继续对话。");
            outputChars += text.length;
            visibleAnswer += text;
            controller.enqueue(encoder.encode(input.world ? encodeDzmmWorldEvent({ type: "text", text }) : text));
          }
        } catch (error) {
          const safeError = streamError(error);
          const settlement = finishBilling(request.signal.aborted ? "cancelled" : "failed").catch(() => {});
          await stopUpstream();
          await settlement;
          if (input.world && !clientCancelled) {
            controller.enqueue(encoder.encode(encodeDzmmWorldEvent({ type: "error", message: safeError.message })));
            controller.close();
          } else if (!clientCancelled) controller.error(safeError);
        }
      },
      async cancel() {
        clientCancelled = true;
        const settlement = finishBilling("cancelled").catch(() => {});
        await stopUpstream();
        await settlement;
      },
    });
    return new Response(stream, {
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Type": input.world ? "text/event-stream; charset=utf-8" : "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
        "X-Xumeng-Prompt-Version": plan.diagnostics.version,
        "X-Xumeng-Max-Output-Tokens": String(effectiveMaxTokens),
        "X-Xumeng-Context": JSON.stringify({ historyMessages: plan.diagnostics.historyMessages,
          exampleMessages: plan.diagnostics.exampleMessages, loreEntries: plan.diagnostics.loreEntries, hasMemory: plan.diagnostics.hasMemory }),
      },
    });
  } catch (error) {
    const safeError = streamError(error);
    const settlement = finishBilling(request.signal.aborted ? "cancelled" : "failed").catch(() => {});
    await stopUpstream();
    await settlement;
    return failure(safeError.message, error instanceof DzmmBillingError || error instanceof ContentError ? error.status : timedOut ? 504 : request.signal.aborted ? 499 : 502,
      error instanceof DzmmBillingError ? error.code : undefined);
  }
}
