/**
 * Base HTTP client for all API calls.
 * Wraps fetch with unified error handling and JSON parsing.
 */

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
  ok: boolean;
}

export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const message = (body["error"] as string | undefined) ?? `请求失败 (HTTP ${res.status})`;
      return { data: null, error: message, ok: false };
    }

    const data = (await res.json()) as T;
    return { data, error: null, ok: true };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "网络请求失败，请稍后重试",
      ok: false,
    };
  }
}
