import { dzmmModelReasoning, dzmmModelTemperature, findDzmmProviderModel } from "./dzmm-models";
import { readDzmmJsonBody, type DzmmChatEnvironment, type DzmmChatHandlerOptions } from "./dzmm-chat-handler";
import { DzmmValidationError, readDzmmProviderConfig, sanitizeDzmmProviderError } from "./dzmm-chat";
import { prepareDzmmBillingRequest, DzmmBillingError, dzmmProviderRouting, readDzmmGenerationId, readDzmmGenerationUsage,
  readDzmmProviderMaxPrice, trustedDzmmGenerationUsage,
  type DzmmBillingCompletion, type DzmmBillingLease, type DzmmGenerationUsage } from "./dzmm-generation-billing";
import { parseDzmmReplySuggestions, prepareDzmmReplySuggestions,
  DZMM_REPLY_SUGGESTIONS_PROMPT_VERSION, DZMM_REPLY_SUGGESTIONS_RESPONSE_FORMAT } from "./dzmm-reply-suggestions";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: string, status: number, code?: string): Response {
  return Response.json({ error, ...(code ? { code } : {}) }, { status, headers: HEADERS });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One bounded call; only a complete set of distinct branches counts as delivered output. */
export async function handleDzmmReplySuggestionsPost(request: Request, env: DzmmChatEnvironment,
  options: DzmmChatHandlerOptions = {}): Promise<Response> {
  let preparedInput: ReturnType<typeof prepareDzmmReplySuggestions>;
  try { preparedInput = prepareDzmmReplySuggestions(await readDzmmJsonBody(request)); }
  catch (error) { return failure(error instanceof DzmmValidationError ? error.message : "无法读取建议请求。", 400); }
  const { input, messages } = preparedInput;
  const config = readDzmmProviderConfig(env);
  if (!config.configured) return failure("模型服务未配置，无法生成建议。", 503);
  let maxPrice: ReturnType<typeof readDzmmProviderMaxPrice>;
  try { maxPrice = readDzmmProviderMaxPrice(env, config.baseUrl, config.models[input.model]); }
  catch (error) { return failure(error instanceof DzmmBillingError ? error.message : "模型成本上限配置无效，请联系站主。", 503, "BILLING_UNAVAILABLE"); }
  const model = config.models[input.model];
  const buildBody = (maxOutputTokens: number) => JSON.stringify({ model, stream: false,
    ...dzmmModelTemperature(model, 0.6), ...dzmmModelReasoning(model), max_tokens: maxOutputTokens, messages,
    response_format: DZMM_REPLY_SUGGESTIONS_RESPONSE_FORMAT,
    ...(maxPrice ? { provider: dzmmProviderRouting(config.models[input.model], maxPrice) } : {}) });
  let lease: DzmmBillingLease | undefined, completion: Promise<void> | undefined;
  let usage: DzmmGenerationUsage | undefined, generationId: string | undefined, hasValidOutput = false;
  function finishBilling(outcome: DzmmBillingCompletion["outcome"]): Promise<void> {
    if (!lease) return Promise.resolve();
    if (!completion) {
      completion = Promise.resolve().then(() => lease!.finalize({ outcome, hasValidOutput,
        ...(usage ? { usage } : {}), ...(generationId ? { generationId } : {}) })).catch(() => {
        throw new DzmmBillingError(503, "余额结算暂未完成，请稍后刷新查看。");
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
  const timer = setTimeout(() => { timedOut = true; stopUpstream(); }, 45000);
  try {
    if (abort.signal.aborted) throw new Error("Cancelled before request");
    const prepared = await prepareDzmmBillingRequest("chat", model, messages, input.maxTokens, buildBody, options.billing);
    if (abort.signal.aborted) throw new Error("Cancelled before reservation");
    if (options.billing) lease = await options.billing.reserve(prepared.preflight);
    if (abort.signal.aborted) throw new Error("Cancelled before provider");
    const response = await (options.providerFetch ?? fetch)(`${config.baseUrl}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}`, "X-Title": "Xumeng Reply Suggestions" },
      body: prepared.providerBody, signal: abort.signal,
    });
    if (abort.signal.aborted) { await response.body?.cancel(); throw new Error("Cancelled provider response"); }
    if (!response.ok) {
      const detail = await response.text().catch(() => ""); await finishBilling("failed");
      return failure(sanitizeDzmmProviderError(response.status, detail), response.status === 429 ? 429 : 502);
    }
    generationId = readDzmmGenerationId(response.headers.get("X-Generation-Id"));
    if (!response.body) throw new Error("Empty response");
    reader = response.body.getReader();
    const decoder = new TextDecoder(); let raw = "", bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (abort.signal.aborted) throw new Error("Cancelled response");
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 64000) { await reader.cancel(); throw new Error("Oversized response"); }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); reader = undefined; }
    const payload: unknown = JSON.parse(raw);
    if (!record(payload) || !Array.isArray(payload.choices) || payload.choices.length !== 1 || !record(payload.choices[0])) {
      throw new Error("Invalid response");
    }
    usage = trustedDzmmGenerationUsage(readDzmmGenerationUsage(payload.usage), config.baseUrl);
    generationId = readDzmmGenerationId(payload.id) ?? generationId;
    const choice = payload.choices[0];
    if (choice.finish_reason !== "stop" || !record(choice.message) || typeof choice.message.content !== "string"
      || choice.message.content.length > 4096) throw new Error("Incomplete suggestions");
    const suggestions = parseDzmmReplySuggestions(JSON.parse(choice.message.content));
    if (abort.signal.aborted) throw new Error("Cancelled validated response");
    hasValidOutput = true; await finishBilling("completed");
    return Response.json({ options: suggestions }, { headers: { ...HEADERS,
      "X-Xumeng-Prompt-Version": DZMM_REPLY_SUGGESTIONS_PROMPT_VERSION,
      "X-Xumeng-Max-Output-Tokens": String(prepared.maxOutputTokens) } });
  } catch (error) {
    await finishBilling(request.signal.aborted ? "cancelled" : "failed").catch(() => {});
    if (error instanceof DzmmBillingError) return failure(error.message, error.status, error.code);
    return failure(timedOut ? "生成建议超时，请稍后重试。" : request.signal.aborted ? "已停止生成建议。"
      : "未能生成三个不同的建议，原始对话仍已保留，请重试。", timedOut ? 504 : request.signal.aborted ? 499 : 502);
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", onAbort); }
}
