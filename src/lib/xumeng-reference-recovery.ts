import { fetchGenerationReference, GenerationError, type GenerationReference } from "./xumeng-generation";

export const GENERATION_REFERENCE_RECOVERY_TIMEOUT_MS = 12_000;

/** Bound metadata fetch and body decoding even if a transport ignores cancellation. */
export function recoverGenerationReferenceWithDeadline(accountId: string, referenceId: string, signal: AbortSignal,
  timeoutMs = GENERATION_REFERENCE_RECOVERY_TIMEOUT_MS): Promise<GenerationReference> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const fail = (failure: unknown) => {
      if (settled) return;
      settled = true; cleanup(); reject(failure); controller.abort(failure);
    };
    const abort = () => fail(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => fail(new GenerationError(408, "参考图验证超时，请重试恢复。", "generation_reference_timeout")), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    void fetchGenerationReference(accountId, referenceId, controller.signal).then(reference => {
      if (settled) return;
      settled = true; cleanup(); resolve(reference);
    }, fail);
  });
}
