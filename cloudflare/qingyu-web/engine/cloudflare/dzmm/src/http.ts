export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readBodyJson(request: Request, limitBytes: number, optional: boolean): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("Content-Length")) > limitBytes) {
    throw new ApiError(413, "请求过大，请减少单次同步的数据量。");
  }
  if (!request.body) {
    if (optional) return {};
    throw new ApiError(400, "请求体不能为空。");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limitBytes) {
        await reader.cancel();
        throw new ApiError(413, "请求过大，请减少单次同步的数据量。");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (optional && !text.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiError(400, "请求体应为有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "请求体应为 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

export function readJson(request: Request, limitBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  return readBodyJson(request, limitBytes, false);
}

export function readOptionalJson(request: Request, limitBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  return readBodyJson(request, limitBytes, true);
}
