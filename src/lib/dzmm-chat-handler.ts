import { dzmmModelReasoning, dzmmModelTemperature, findDzmmProviderModel } from "./dzmm-models";
import { mergeTavernSampler, resolveTavernSampler } from "./tavern/sampler";
import { buildTavernGroupPrompt, type TavernGroupMember } from "./tavern/group";
import { readTavernFlags } from "./tavern/flags";
import { countDzmmContextText } from "./dzmm-character-context";
import {
  applyDzmmPromptCaching,
  buildDzmmPromptPlan,
  createDzmmSseParser,
  DZMM_CONTEXT_LIMIT_CHARS,
  DZMM_REQUEST_LIMIT_BYTES,
  DZMM_MAX_MESSAGE_CHARS,
  DzmmProviderStreamError,
  DzmmValidationError,
  dzmmUpstreamHeaders,
  readDzmmProviderConfig,
  resolveDzmmChatUpstream,
  sanitizeDzmmProviderError,
  validateDzmmChatInput,
  currentDzmmWorldState,
  xumengAdultWritingPrompt,
} from "./dzmm-chat";
import { fetchDzmmUpstreamWithRetry } from "./dzmm-upstream-resilience";
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
  const whatstokenConfigured = Boolean(env.WHATSTOKEN_API_KEY?.trim())
    && env.DZMM_WHATSTOKEN_CHAT_ENABLED?.trim().toLowerCase() !== "false";
  return Response.json({
    configured: config.configured || whatstokenConfigured,
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
    else {
      input = validateDzmmChatInput(body);
      const flags = readTavernFlags(env);
      if (!flags.group && input.group) return failure("群聊功能暂未开放。", 403, "TAVERN_GROUP_DISABLED");
      if (!flags.engine && input.promptStyle === "tavern") { input.promptStyle = undefined; delete input.group; }
      if (!flags.sampler) delete input.sampler;
      if (!flags.memory) delete input.memoryConfig;
      plan = input.group ? { messages: [], diagnostics: { version: "tavern-group-v1", historyMessages: input.messages.length, exampleMessages: 0, loreEntries: 0, hasMemory: Boolean(input.storyMemory), segments: [] } } : buildDzmmPromptPlan(input, requestTime);
    }
  } catch (error) {
    return failure(error instanceof DzmmValidationError ? error.message : "无法读取聊天请求，请重试。", 400);
  }
  // Group chat: assemble a multi-character prompt and remember who speaks so the
  // client can label the assistant turn.
  let groupSpeaker: { name: string; characterId: string } | undefined;
  if (input.group) {
    try {
      const group = buildTavernGroupPrompt({
        members: input.group.members as TavernGroupMember[],
        messages: input.messages,
        userName: input.userName || "用户",
        locale: input.locale,
        preset: input.preset,
        persona: input.userPersona,
        memory: input.storyMemory ? JSON.stringify(input.storyMemory) : undefined,
        jailbreak: xumengAdultWritingPrompt(),
        speaker: input.group.speaker,
      });
      if (countDzmmContextText(group.plan.messages) > DZMM_CONTEXT_LIMIT_CHARS
        || new TextEncoder().encode(JSON.stringify(group.plan.messages)).byteLength > DZMM_REQUEST_LIMIT_BYTES) {
        throw new DzmmValidationError("群聊上下文过长，请减少群成员设定或较早消息。");
      }
      groupSpeaker = { name: group.speaker.name, characterId: group.speaker.characterId };
      plan = {
        messages: group.plan.messages,
        diagnostics: {
          version: "tavern-group-v1",
          historyMessages: input.messages.length,
          exampleMessages: 0,
          loreEntries: group.plan.sections.filter(section => section.id === "worldInfoBefore" || section.id === "worldInfoAfter").length,
          hasMemory: Boolean(input.storyMemory),
          segments: group.plan.sections.map(section => ({ source: section.id, role: section.role, chars: section.chars })),
        },
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "群聊请求无效。", 400);
    }
  }
  const config = readDzmmProviderConfig(env);
  const upstream = resolveDzmmChatUpstream(env, input.model, config);
  if (!upstream.configured) {
    return failure(
      upstream.direct
        ? "这个模型还没配好，请稍后再试。"
        : "模型服务未配置。请在服务端设置 DZMM_API_KEY 或 OPENROUTER_API_KEY，并检查模型服务地址。",
      503,
    );
  }

  let maxPrice: ReturnType<typeof readDzmmProviderMaxPrice>;
  try { maxPrice = upstream.direct ? undefined : readDzmmProviderMaxPrice(env, config.baseUrl, upstream.model); }
  catch (error) {
    return failure(error instanceof DzmmBillingError ? error.message : "模型成本上限配置无效，请联系站主。", 503, "BILLING_UNAVAILABLE");
  }
  // SillyTavern sampler settings are optional; absent keeps the legacy defaults byte-for-byte.
  const samplerParams = input.sampler ? (() => {
    const capability = findDzmmProviderModel(upstream.model);
    const resolved = resolveTavernSampler(mergeTavernSampler(input.sampler).settings, {
      supportsTemperature: capability?.supportsTemperature !== false,
      contextLength: capability?.contextLength ?? 32_000,
    });
    const { max_tokens: ignoredMaxTokens, ...rest } = resolved.providerParams;
    void ignoredMaxTokens;
    return rest;
  })() : undefined;
  const wireMessages = applyDzmmPromptCaching(plan.messages, upstream.model, upstream.direct);
  const buildProviderBody = (maxOutputTokens: number) => JSON.stringify({
    model: upstream.model, stream: true, ...(upstream.direct ? { stream_options: { include_usage: true } } : {}), messages: wireMessages,
    ...dzmmModelReasoning(upstream.model),
    ...(maxPrice ? { provider: dzmmProviderRouting(upstream.model, maxPrice) } : {}),
    ...(samplerParams ?? dzmmModelTemperature(upstream.model, input.model === "story" || input.model === "heretic" ? 0.9 : 0.75)), max_tokens: maxOutputTokens,
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
      const usage = trustedDzmmGenerationUsage(parser?.usage, upstream.baseUrl);
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
  const triggerTimeout = () => {
    timedOut = true;
    abortController.abort();
  };
  const timeout = setTimeout(triggerTimeout, 120_000);
  let ttfbTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(triggerTimeout, 40_000);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function clearTtfbTimer() {
    if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = undefined; }
  }
  function touchIdleTimer() {
    clearTtfbTimer();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(triggerTimeout, 25_000);
  }
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timeout);
    clearTtfbTimer();
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    request.signal.removeEventListener("abort", abortOnDisconnect);
  }
  async function stopUpstream() {
    abortController.abort();
    try { await upstreamReader?.cancel(); } catch { /* Stream may already be closed. */ }
    cleanup();
  }
  function streamError(error: unknown): Error {
    if (error instanceof DzmmBillingError) return error;
    if (timedOut) return new Error("模型回复超时，请稍后重试。");
    if (request.signal.aborted) return new Error("已停止生成。");
    if (error instanceof DzmmProviderStreamError) return new Error(error.message);
    return new Error("模型连接中断，请稍后重试。");
  }

  try {
    if (request.signal.aborted) throw new Error("Cancelled before provider request");
    const prepared = await prepareDzmmBillingRequest("chat", upstream.model, plan.messages,
      input.maxTokens, buildProviderBody, options.billing);
    effectiveMaxTokens = prepared.maxOutputTokens;
    if (request.signal.aborted || abortController.signal.aborted) throw new Error("Cancelled before billing reservation");
    if (options.billing) lease = await options.billing.reserve(prepared.preflight);
    if (request.signal.aborted || abortController.signal.aborted) throw new Error("Cancelled before provider request");
    const upstreamResponse = await fetchDzmmUpstreamWithRetry(options.providerFetch ?? fetch, upstream.endpoint, {
      method: "POST",
      headers: dzmmUpstreamHeaders(upstream.apiKey, upstream.direct, "Local Roleplay Prototype"),
      body: prepared.providerBody,
      signal: abortController.signal,
    }, { retryDelayMs: options.providerFetch ? 0 : 350 });
    if (abortController.signal.aborted) {
      await upstreamResponse.body?.cancel();
      throw new Error("Cancelled provider request");
    }
    if (!upstreamResponse.ok) {
      const detail = await upstreamResponse.text().catch(() => "");
      await finishBilling("failed");
      cleanup();
      return failure(sanitizeDzmmProviderError(upstreamResponse.status, detail), upstreamResponse.status === 429 ? 429 : 502);
    }
    if (!upstreamResponse.body || !upstreamResponse.headers.get("content-type")?.includes("text/event-stream")) {
      await upstreamResponse.body?.cancel();
      await finishBilling("failed");
      cleanup();
      return failure("模型服务没有返回流式回复，请检查模型服务配置。", 502);
    }

    upstreamReader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    parser = createDzmmSseParser();
    generationId = readDzmmGenerationId(upstreamResponse.headers.get("X-Generation-Id"));
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
        if (!result.done) touchIdleTimer();
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
        return failure("模型没有回复，请重试或换个模型。", 502);
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
        ...(groupSpeaker ? {
          "X-Xumeng-Speaker": encodeURIComponent(groupSpeaker.name),
          "X-Xumeng-Speaker-Id": encodeURIComponent(groupSpeaker.characterId),
        } : {}),
      },
    });
  } catch (error) {
    const safeError = streamError(error);
    const settlement = finishBilling(request.signal.aborted ? "cancelled" : "failed").catch(() => {});
    await stopUpstream();
    await settlement;
    return failure(safeError.message, error instanceof DzmmBillingError ? error.status : timedOut ? 504 : request.signal.aborted ? 499 : 502,
      error instanceof DzmmBillingError ? error.code : undefined);
  }
}
