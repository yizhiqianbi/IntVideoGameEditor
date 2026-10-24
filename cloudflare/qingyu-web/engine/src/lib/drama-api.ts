export function isDramaTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return true;
  const text = `${error.name} ${error.message}`;
  if (error.name === "AbortError" && /timed out|timeout/i.test(text)) return true;
  return /signal timed out|operation was aborted due to timeout|timed out/i.test(
    error.message,
  );
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" && !isDramaTimeoutError(error)) return false;
  if (isDramaTimeoutError(error)) return true;
  return /failed to fetch|fetch failed|networkerror|load failed|network request failed|econnreset|epipe|socket/i.test(
    `${error.name} ${error.message}`,
  );
}

export function translateDramaNetworkError(
  error: unknown,
  via: "video" | "input-image" | "status" | "reference-media" = "video",
): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error || "");
  if (name === "AbortError" && !isDramaTimeoutError(error))
    return message || "已终止生成";
  if (isDramaTimeoutError(error) || /timeout/i.test(name)) {
    return via === "input-image"
      ? "参考图上传超时，请再试一次"
      : via === "reference-media"
        ? "参考视频上传超时，请再试一次"
        : "提交超时，请稍后重试。";
  }
  if (isRetryableNetworkError(error) || /failed to fetch|fetch failed|load failed/i.test(message)) {
    if (via === "input-image") return "参考图上传中断。请再点一次生成。";
    if (via === "reference-media") return "参考视频上传中断。请再试一次。";
    if (via === "status") return "状态查询中断，稍后会自动重试。";
    return "生成请求没送到服务器。请再点一次生成。";
  }
  return message.trim().slice(0, 240) || "请求失败";
}

export function translateDramaApiError(raw: unknown, status?: number): string {
  const text =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? JSON.stringify(raw)
        : "";
  const blob = `${status || ""} ${text}`;
  if (/FUNCTION_INVOCATION_TIMEOUT|invocation_timeout/i.test(blob))
    return "提交超时，云函数已被掐断。请再点一次生成；若 GPU 已在跑，先点终止再重试。";
  if (status === 504 || /gateway timeout|aborted|timeouterror|signal timed out|timed out/i.test(blob))
    return "提交超时，请稍后重试。";
  if (/failed to fetch|fetch failed|networkerror when attempting to fetch|load failed|network request failed/i.test(blob))
    return "网络中断，请求没送到服务器。请再试一次。";
  if (typeof raw === "string" && raw.trim()) {
    if (status === 413 || /entity too large/i.test(`${status || ""} ${raw}`))
      return "参考图太大，无法整包提交。请等图片先上传到 GPU 后再生成。";
    return raw.trim().slice(0, 240);
  }
  if (raw && typeof raw === "object" && "error" in raw) {
    const error = (raw as { error?: unknown }).error;
    if (typeof error === "string" && error.trim())
      return translateDramaApiError(error, status) || error.trim().slice(0, 240);
    if (error && typeof error === "object" && "message" in error)
      return translateDramaApiError(
        (error as { message?: unknown }).message,
        status,
      );
  }
  if (status === 413 || /entity too large/i.test(blob))
    return "参考图太大，无法整包提交。请等图片先上传到 GPU 后再生成。";
  return "";
}

const EMBEDDED_MEDIA = /data:image\/[a-zA-Z0-9.+-]+;base64,|"blob:/;

export function assertDramaSubmitPayload(body: unknown) {
  const json = JSON.stringify(body);
  if (EMBEDDED_MEDIA.test(json))
    throw new Error("参考图还没传到 GPU，不能整包提交。请再点一次生成。");
  if (json.length > 1_200_000)
    throw new Error("提交内容仍然过大。请减少导演台参考图后再试。");
}

export async function readApiJson(response: Response) {
  const text = await response.text();
  try {
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(
        translateDramaApiError(data, response.status) ||
          (typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "请求失败"),
      );
    }
    return data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        translateDramaApiError(text, response.status) ||
          text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) ||
          "请求失败",
      );
    }
    throw error;
  }
}
