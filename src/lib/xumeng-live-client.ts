export type XumengLiveMode = "rehearsal" | "real";
export type XumengLiveSession = {
  id: string; mode: XumengLiveMode; control: "performance";
  status: "connecting" | "ready" | "ended"; startedAt: number; reason?: string;
};
export type XumengLiveTask = {
  id: string; kind: "image" | "video"; state: string; createdAt: number;
  prompt?: string; error?: string; creations: { url: string }[];
};
export type XumengLiveEvent = { id: string; type: string; time: number; data: unknown; sessionId?: string; revision?: number };
export type XumengLiveStatus = {
  accountId: string; configured: boolean; region: "cn" | "global";
  session: XumengLiveSession | null; events: XumengLiveEvent[]; tasks: XumengLiveTask[];
  lastStartError: { message: string; time: number } | null;
};
export type XumengLiveAvailability = { accountId: string; available: boolean; configured: boolean; realAllowed: boolean };
export type XumengLiveLease = { leaseId: string; cleanupToken: string };
export type XumengLiveReference = { url: string; kind: "object" | "garment" | "background"; description: string };
export type XumengLiveRtc = { token: string; user_id: string };
export const XUMENG_LIVE_IMAGE_BYTES = 5 * 1024 * 1024;
export class XumengLiveRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message); this.name = "XumengLiveRequestError";
  }
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max = 1000) => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const timestamp = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
function invalid(): never { throw new Error("实时影像服务返回格式异常，请刷新状态后重试。"); }
export function xumengLiveHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 12000) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function parseXumengLiveSession(value: unknown): XumengLiveSession | null {
  if (value === null) return null;
  if (!record(value) || !text(value.id, 300) || !["rehearsal", "real"].includes(String(value.mode))
    || value.control !== "performance" || !["connecting", "ready", "ended"].includes(String(value.status)) || timestamp(value.startedAt) === null) invalid();
  return { id: value.id as string, mode: value.mode as XumengLiveMode, control: "performance", status: value.status as XumengLiveSession["status"],
    startedAt: value.startedAt as number, ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 1000) } : {}) };
}
export function parseXumengLiveTask(value: unknown): XumengLiveTask {
  if (!record(value) || !text(value.id, 300) || !["image", "video"].includes(String(value.kind)) || !text(value.state, 64) || timestamp(value.createdAt) === null) invalid();
  if (value.creations !== undefined && (!Array.isArray(value.creations) || value.creations.length > 20)) invalid();
  const creations = ((value.creations ?? []) as unknown[]).flatMap(item => record(item) && xumengLiveHttpsUrl(item.url) ? [{ url: xumengLiveHttpsUrl(item.url)! }] : []);
  return { id: value.id as string, kind: value.kind as "image" | "video", state: value.state as string, createdAt: value.createdAt as number, creations,
    ...(typeof value.prompt === "string" ? { prompt: value.prompt.slice(0, 2000) } : {}), ...(typeof value.error === "string" ? { error: value.error.slice(0, 1000) } : {}) };
}
export function parseXumengLiveStatus(value: unknown, accountId: string): XumengLiveStatus {
  if (!record(value) || value.accountId !== accountId || typeof value.configured !== "boolean" || !["cn", "global"].includes(String(value.region))
    || !Array.isArray(value.events) || value.events.length > 150 || !Array.isArray(value.tasks) || value.tasks.length > 100) invalid();
  const events: XumengLiveEvent[] = value.events.map(event => {
    if (!record(event) || !text(event.id, 300) || !text(event.type, 100) || timestamp(event.time) === null) invalid();
    if (event.sessionId !== undefined && !text(event.sessionId, 300) || event.revision !== undefined && (!Number.isSafeInteger(event.revision) || (event.revision as number) < 0)) invalid();
    return { id: event.id as string, type: event.type as string, time: event.time as number, data: event.data,
      ...(event.sessionId !== undefined ? { sessionId: event.sessionId as string } : {}), ...(event.revision !== undefined ? { revision: event.revision as number } : {}) };
  });
  let lastStartError: XumengLiveStatus["lastStartError"] = null;
  if (value.lastStartError != null) {
    if (!record(value.lastStartError) || !text(value.lastStartError.message, 2000) || timestamp(value.lastStartError.time) === null) invalid();
    lastStartError = { message: value.lastStartError.message as string, time: value.lastStartError.time as number };
  }
  return { accountId, configured: value.configured, region: value.region as "cn" | "global", session: parseXumengLiveSession(value.session), events,
    tasks: value.tasks.map(parseXumengLiveTask), lastStartError };
}
export async function requestXumengLive(path: string, options: { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<Record<string, unknown>> {
  if (!/^\/api\/live(?:\/|$)/.test(path)) throw new Error("实时影像请求地址无效。");
  const method = options.method ?? "GET";
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", signal: options.signal, keepalive: options.keepalive,
    ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body ?? {}) } : {}) });
  const raw = await response.text();
  if (raw.length > 2_000_000) invalid();
  let result: unknown;
  try { result = JSON.parse(raw); } catch { throw new Error(`服务响应无法确认（HTTP ${response.status}），请先刷新状态，避免重复开播或提交。`); }
  if (!record(result)) invalid();
  if (!response.ok) {
    const message = text(result.error, 2000);
    if (!message?.trim()) invalid();
    throw new XumengLiveRequestError(response.status, message.slice(0, 1000));
  }
  return result;
}
export async function fetchXumengLiveAvailability(accountId: string): Promise<XumengLiveAvailability> {
  const value = await requestXumengLive("/api/live/status");
  if (value.accountId !== accountId || typeof value.available !== "boolean" || typeof value.configured !== "boolean" || typeof value.realAllowed !== "boolean") invalid();
  return { accountId, available: value.available, configured: value.configured, realAllowed: value.realAllowed };
}
export async function createXumengLiveLease(accountId: string): Promise<XumengLiveLease> {
  const value = await requestXumengLive("/api/live/leases", { method: "POST" });
  if (value.accountId !== accountId || !text(value.leaseId, 300) || typeof value.cleanupToken !== "string" || !/^[0-9a-f]{64}$/.test(value.cleanupToken)) invalid();
  return { leaseId: value.leaseId as string, cleanupToken: value.cleanupToken };
}
export async function releaseXumengLiveLease(lease: XumengLiveLease, keepalive = false): Promise<void> {
  if (!text(lease.leaseId, 300) || !/^[0-9a-f]{64}$/.test(lease.cleanupToken)) invalid();
  const value = await requestXumengLive(xumengLiveLeasePath(lease.leaseId), { method: "DELETE", body: { cleanupToken: lease.cleanupToken }, keepalive });
  if (value.ended !== true) throw new Error("结束操作尚未确认，请刷新状态后重试。");
}
export function xumengLiveLeasePath(leaseId: string, action?: string) {
  return `/api/live/leases/${encodeURIComponent(leaseId)}${action ? `/${action}` : ""}`;
}
export async function readXumengLiveImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  if (!file.size || file.size > XUMENG_LIVE_IMAGE_BYTES) throw new Error("单张图片须在 5 MB 以内。");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败。"));
    reader.onerror = () => reject(new Error("图片读取失败。")); reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = url;
  try { await image.decode(); } catch { throw new Error("图片无法解码，请重新选择。"); }
  if (image.width < 128 || image.height < 128 || image.width / image.height >= 4 || image.height / image.width >= 4) throw new Error("图片至少 128 × 128，长宽比需介于 1:4 与 4:1。");
  return url;
}

/** Resolve an owned/local cover in the browser so Vidu never needs an account cookie. */
export async function readXumengCharacterLiveImage(path: string, signal?: AbortSignal): Promise<string> {
  const url = new URL(path, window.location.origin);
  if (url.username || url.password || (url.origin !== window.location.origin && url.protocol !== "https:")) throw new Error("人物形象需为本站图片或 HTTPS 图片地址。");
  const abort = new AbortController();
  const stop = () => abort.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, 15000);
  try {
    const response = await fetch(url.href, { credentials: url.origin === window.location.origin ? "same-origin" : "omit", redirect: "error", signal: abort.signal });
    if (!response.ok || !response.body) throw new Error("人物形象无法读取，请上传一张人物图片。");
    const mime = response.headers.get("Content-Type")?.split(";")[0].trim();
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime ?? "")) throw new Error("这张封面不适合直播，请上传 PNG、JPEG 或 WebP 人物图片。");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > XUMENG_LIVE_IMAGE_BYTES) { await reader.cancel(); throw new Error("人物形象超过 5 MB，请换一张图片。"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    if (abort.signal.aborted) throw new Error("人物形象读取已取消。");
    const decoding = readXumengLiveImage(new File(chunks as BlobPart[], "character-image", { type: mime }));
    let cancelDecode: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancelDecode = () => reject(new Error("人物形象读取超时或已取消，请重新选择。"));
      if (abort.signal.aborted) cancelDecode(); else abort.signal.addEventListener("abort", cancelDecode, { once: true });
    });
    try { return await Promise.race([decoding, cancelled]); }
    finally { abort.signal.removeEventListener("abort", cancelDecode); }
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", stop); }
}
