import { shelfModelReasoning, shelfModelTemperature, findShelfProviderModel } from "./shelf-models";
import { readShelfJsonBody, type ShelfChatEnvironment, type ShelfChatHandlerOptions } from "./shelf-chat-handler";
import { ShelfValidationError, shelfUpstreamHeaders, readShelfProviderConfig, resolveShelfChatUpstream, sanitizeShelfProviderError } from "./shelf-chat";
import { prepareShelfBillingRequest, ShelfBillingError, shelfProviderRouting, readShelfGenerationId, readShelfGenerationUsage,
  readShelfProviderMaxPrice, trustedShelfGenerationUsage, type ShelfBillingCompletion, type ShelfBillingLease, type ShelfGenerationUsage } from "./shelf-generation-billing";
import { parseShelfIllustrationShots, prepareShelfIllustrations, SHELF_ILLUSTRATION_PROMPT_VERSION, SHELF_ILLUSTRATION_RESPONSE_FORMAT } from "./shelf-illustration";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: string, status: number, code?: string): Response {
  return Response.json({ error, ...(code ? { code } : {}) }, { status, headers: HEADERS });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One bounded call. A complete set of three shot sizes is the only delivered output. */
export async function handleShelfIllustrationsPost(request: Request, env: ShelfChatEnvironment,
  options: ShelfChatHandlerOptions = {}): Promise<Response> {
  let preparedInput: ReturnType<typeof prepareShelfIllustrations>;
  try { preparedInput = prepareShelfIllustrations(await readShelfJsonBody(request)); }
  catch (error) { return failure(error instanceof ShelfValidationError ? error.message : "无法读取画面构思请求。", 400); }
  const { input, messages } = preparedInput;
  const config = readShelfProviderConfig(env);
  if (!config.configured) return failure("模型服务未配置，无法构思画面。", 503);
  const upstream = resolveShelfChatUpstream(env, input.model, config);
  if (!upstream.configured) return failure("这个模型还没配好，请稍后再试。", 503);
  let maxPrice: ReturnType<typeof readShelfProviderMaxPrice>;
  try { maxPrice = upstream.direct ? undefined : readShelfProviderMaxPrice(env, config.baseUrl, upstream.model); }
  catch (error) { return failure(error instanceof ShelfBillingError ? error.message : "模型成本上限配置无效，请联系站主。", 503, "BILLING_UNAVAILABLE"); }
  const model = upstream.model;
  const plainJson = findShelfProviderModel(model)?.id === "venice" || findShelfProviderModel(model)?.route === "sealion";
  const buildBody = (maxOutputTokens: number) => JSON.stringify({ model, stream: false,
    ...shelfModelTemperature(model, 0.7), ...shelfModelReasoning(model), max_tokens: maxOutputTokens, messages,
    response_format: plainJson ? { type: "json_object" } : SHELF_ILLUSTRATION_RESPONSE_FORMAT,
    ...(maxPrice ? { provider: shelfProviderRouting(model, maxPrice) } : {}) });
  let lease: ShelfBillingLease | undefined, completion: Promise<void> | undefined;
  let usage: ShelfGenerationUsage | undefined, generationId: string | undefined, hasValidOutput = false;
  function finishBilling(outcome: ShelfBillingCompletion["outcome"]): Promise<void> {
    if (!lease) return Promise.resolve();
    if (!completion) {
      completion = Promise.resolve().then(() => lease!.finalize({ outcome, hasValidOutput,
        ...(usage ? { usage } : {}), ...(generationId ? { generationId } : {}) })).catch(() => {
        throw new ShelfBillingError(503, "余额结算暂未完成，请稍后刷新查看。");
      });
      options.waitUntil?.(completion.catch(() => {}));
    }
    return completion;
  }
  const abort = new AbortController();
  let timedOut = false, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  function stopUpstream() { abort.abort(); void reader?.cancel().catch(() => {}); }
  const onAbort = () => { stopUpstream(); void finishBilling("cancelled").catch(() => {}); };
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) stopUpstream();
  const timer = setTimeout(() => { timedOut = true; stopUpstream(); }, 45_000);
  try {
    if (abort.signal.aborted) throw new Error("Cancelled before request");
    const prepared = await prepareShelfBillingRequest("chat", model, messages, input.maxTokens, buildBody, options.billing);
    if (abort.signal.aborted) throw new Error("Cancelled before reservation");
    if (options.billing) lease = await options.billing.reserve(prepared.preflight);
    if (abort.signal.aborted) throw new Error("Cancelled before provider");
    const response = await (options.providerFetch ?? fetch)(upstream.endpoint, {
      method: "POST", headers: shelfUpstreamHeaders(upstream.apiKey, upstream.direct, "内容台 Illustration"),
      body: prepared.providerBody, signal: abort.signal,
    });
    if (abort.signal.aborted) { await response.body?.cancel(); throw new Error("Cancelled provider response"); }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      await finishBilling("failed");
      return failure(sanitizeShelfProviderError(response.status, detail), response.status === 429 ? 429 : 502);
    }
    generationId = readShelfGenerationId(response.headers.get("X-Generation-Id"));
    if (!response.body) throw new Error("Empty response");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let raw = "", bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (abort.signal.aborted) throw new Error("Cancelled response");
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 64_000) { await reader.cancel(); throw new Error("Oversized response"); }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); reader = undefined; }
    const payload: unknown = JSON.parse(raw);
    if (!record(payload) || !Array.isArray(payload.choices) || payload.choices.length !== 1 || !record(payload.choices[0])) {
      throw new Error("Invalid response");
    }
    usage = trustedShelfGenerationUsage(readShelfGenerationUsage(payload.usage), upstream.baseUrl);
    generationId = readShelfGenerationId(payload.id) ?? generationId;
    const choice = payload.choices[0];
    if (choice.finish_reason !== "stop" || !record(choice.message) || typeof choice.message.content !== "string"
      || choice.message.content.length > 8_000) throw new Error("Incomplete illustration");
    const shots = parseShelfIllustrationShots(JSON.parse(choice.message.content));
    if (abort.signal.aborted) throw new Error("Cancelled validated response");
    hasValidOutput = true;
    await finishBilling("completed");
    return Response.json({ shots }, { headers: { ...HEADERS, "X-内容台-Prompt-Version": SHELF_ILLUSTRATION_PROMPT_VERSION,
      "X-内容台-Max-Output-Tokens": String(prepared.maxOutputTokens) } });
  } catch (error) {
    await finishBilling(request.signal.aborted ? "cancelled" : "failed").catch(() => {});
    if (error instanceof ShelfBillingError) return failure(error.message, error.status, error.code);
    return failure(timedOut ? "构思画面超时，请稍后重试。" : request.signal.aborted ? "已停止构思画面。"
      : "没构思出画面，请重试。", timedOut ? 504 : request.signal.aborted ? 499 : 502);
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", onAbort); }
}
