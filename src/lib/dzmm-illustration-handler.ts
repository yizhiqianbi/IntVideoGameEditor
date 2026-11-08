import { dzmmModelReasoning, dzmmModelTemperature, findDzmmProviderModel } from "./dzmm-models";
import { readDzmmJsonBody, type DzmmChatEnvironment, type DzmmChatHandlerOptions } from "./dzmm-chat-handler";
import { DzmmValidationError, dzmmUpstreamHeaders, readDzmmProviderConfig, resolveDzmmChatUpstream, sanitizeDzmmProviderError } from "./dzmm-chat";
import { prepareDzmmBillingRequest, DzmmBillingError, dzmmProviderRouting, readDzmmGenerationId, readDzmmGenerationUsage,
  readDzmmProviderMaxPrice, trustedDzmmGenerationUsage, type DzmmBillingCompletion, type DzmmBillingLease, type DzmmGenerationUsage } from "./dzmm-generation-billing";
import { parseDzmmIllustrationShots, prepareDzmmIllustrations, DZMM_ILLUSTRATION_PROMPT_VERSION, DZMM_ILLUSTRATION_RESPONSE_FORMAT } from "./dzmm-illustration";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: string, status: number, code?: string): Response {
  return Response.json({ error, ...(code ? { code } : {}) }, { status, headers: HEADERS });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One bounded call. A complete set of three shot sizes is the only delivered output. */
export async function handleDzmmIllustrationsPost(request: Request, env: DzmmChatEnvironment,
  options: DzmmChatHandlerOptions = {}): Promise<Response> {
  let preparedInput: ReturnType<typeof prepareDzmmIllustrations>;
  try { preparedInput = prepareDzmmIllustrations(await readDzmmJsonBody(request)); }
  catch (error) { return failure(error instanceof DzmmValidationError ? error.message : "无法读取画面构思请求。", 400); }
  const { input, messages } = preparedInput;
  const config = readDzmmProviderConfig(env);
  if (!config.configured) return failure("模型服务未配置，无法构思画面。", 503);
  const upstream = resolveDzmmChatUpstream(env, input.model, config);
  if (!upstream.configured) return failure("这个模型还没配好，请稍后再试。", 503);
  let maxPrice: ReturnType<typeof readDzmmProviderMaxPrice>;
  try { maxPrice = upstream.direct ? undefined : readDzmmProviderMaxPrice(env, config.baseUrl, upstream.model); }
  catch (error) { return failure(error instanceof DzmmBillingError ? error.message : "模型成本上限配置无效，请联系站主。", 503, "BILLING_UNAVAILABLE"); }
  const model = upstream.model;
  const plainJson = findDzmmProviderModel(model)?.id === "venice" || findDzmmProviderModel(model)?.route === "sealion";
  const buildBody = (maxOutputTokens: number) => JSON.stringify({ model, stream: false,
    ...dzmmModelTemperature(model, 0.7), ...dzmmModelReasoning(model), max_tokens: maxOutputTokens, messages,
    response_format: plainJson ? { type: "json_object" } : DZMM_ILLUSTRATION_RESPONSE_FORMAT,
    ...(maxPrice ? { provider: dzmmProviderRouting(model, maxPrice) } : {}) });
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
  const timer = setTimeout(() => { timedOut = true; stopUpstream(); }, 45_000);
  try {
    if (abort.signal.aborted) throw new Error("Cancelled before request");
    const prepared = await prepareDzmmBillingRequest("chat", model, messages, input.maxTokens, buildBody, options.billing);
    if (abort.signal.aborted) throw new Error("Cancelled before reservation");
    if (options.billing) lease = await options.billing.reserve(prepared.preflight);
    if (abort.signal.aborted) throw new Error("Cancelled before provider");
    const response = await (options.providerFetch ?? fetch)(upstream.endpoint, {
      method: "POST", headers: dzmmUpstreamHeaders(upstream.apiKey, upstream.direct, "Xumeng Illustration"),
      body: prepared.providerBody, signal: abort.signal,
    });
    if (abort.signal.aborted) { await response.body?.cancel(); throw new Error("Cancelled provider response"); }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      await finishBilling("failed");
      return failure(sanitizeDzmmProviderError(response.status, detail), response.status === 429 ? 429 : 502);
    }
    generationId = readDzmmGenerationId(response.headers.get("X-Generation-Id"));
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
    usage = trustedDzmmGenerationUsage(readDzmmGenerationUsage(payload.usage), upstream.baseUrl);
    generationId = readDzmmGenerationId(payload.id) ?? generationId;
    const choice = payload.choices[0];
    if (choice.finish_reason !== "stop" || !record(choice.message) || typeof choice.message.content !== "string"
      || choice.message.content.length > 8_000) throw new Error("Incomplete illustration");
    const shots = parseDzmmIllustrationShots(JSON.parse(choice.message.content));
    if (abort.signal.aborted) throw new Error("Cancelled validated response");
    hasValidOutput = true;
    await finishBilling("completed");
    return Response.json({ shots }, { headers: { ...HEADERS, "X-Xumeng-Prompt-Version": DZMM_ILLUSTRATION_PROMPT_VERSION,
      "X-Xumeng-Max-Output-Tokens": String(prepared.maxOutputTokens) } });
  } catch (error) {
    await finishBilling(request.signal.aborted ? "cancelled" : "failed").catch(() => {});
    if (error instanceof DzmmBillingError) return failure(error.message, error.status, error.code);
    return failure(timedOut ? "构思画面超时，请稍后重试。" : request.signal.aborted ? "已停止构思画面。"
      : "没构思出画面，请重试。", timedOut ? 504 : request.signal.aborted ? 499 : 502);
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", onAbort); }
}
