/**
 * Shared resilience primitives for upstream AI model calls:
 * - Single bounded retry on pre-stream transient upstream errors (408/502/503/504 or network error)
 * - Resilient JSON extraction that tolerates Markdown code fences around model JSON output
 */

const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 502, 503, 504]);

function sleepWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchDzmmUpstreamWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  options: { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 350;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const response = await fetchFn(url, init);
      if (attempt < maxRetries && RETRYABLE_UPSTREAM_STATUSES.has(response.status) && !init.signal?.aborted) {
        await response.body?.cancel().catch(() => {});
        await sleepWithAbort(retryDelayMs * (attempt + 1), init.signal);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt >= maxRetries) throw error;
      await sleepWithAbort(retryDelayMs * (attempt + 1), init.signal);
    }
  }
  throw lastError;
}

/**
 * Parse a JSON object returned by an LLM, tolerating optional Markdown ```json fences
 * or brief leading/trailing whitespace/chatter around the outermost `{ ... }` payload.
 */
export function parseDzmmJsonResponseText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new SyntaxError("Empty JSON response");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip ```json ... ``` or ``` ... ``` fences
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // Fall through to outermost brace scan
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new SyntaxError("Invalid JSON response");
  }
}
