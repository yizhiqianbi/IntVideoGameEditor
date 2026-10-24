import { viduStudioLeasePrefix, viduStudioOwnerPrefix, type LiveStudiosBinding } from "./vidu-live-studio";
type ServiceFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type ServiceRateLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
/** Authenticate every operation before delegating to a private studio. */
export interface LiveGatewayEnvironment {
  BACKEND: ServiceFetcher;
  LIVE_BRIDGE_URL?: string;
  XUMENG_LIVE_BRIDGE_SECRET?: string;
  LIVE_RATE_LIMITER?: ServiceRateLimiter;
  LIVE_STUDIOS?: LiveStudiosBinding;
  VIDU_API_KEY?: string;
  VIDU_REGION?: string;
  GENERATION_ENABLED?: string;
}
type Options = { fetch?: typeof fetch; now?: () => number; nonce?: () => string };
const PREFIX = "/api/live";
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const ACTIONS = "start|stop|heartbeat|interaction|execute|danmaku|interrupt|references|generate|task|recording";
const PRIVATE = new RegExp(`^/leases/(${UUID})(?:/(status|${ACTIONS}))?$`);
const LIMIT = 20 * 1024 * 1024;
function reply(status: number, value: unknown): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
function hex(value: ArrayBuffer) { return Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, "0")).join(""); }
async function boundedBody(request: Request, limit = LIMIT): Promise<Uint8Array> {
  if (Number(request.headers.get("Content-Length")) > limit) throw new Error("SIZE");
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  try { for (;;) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error("SIZE"); }
    chunks.push(part.value);
  } } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let at = 0;
  for (const chunk of chunks) { body.set(chunk, at); at += chunk.byteLength; }
  return body;
}
export async function handleLiveGateway(request: Request, env: LiveGatewayEnvironment, options: Options = {}): Promise<Response> {
  const url = new URL(request.url), tail = url.pathname.slice(PREFIX.length), route = PRIVATE.exec(tail);
  if (url.search || !(tail === "/status" || tail === "/leases" || route)) return reply(404, { error: "影像接口不存在。" });
  const expected = tail === "/status" || route?.[2] === "status" ? "GET" : tail === "/leases" ? "POST" : route && !route[2] ? "DELETE" : "POST";
  if (request.method !== expected) return reply(405, { error: "请求方法不支持。" });
  if (request.method !== "GET" && (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site")) return reply(403, { error: "当前来源不允许操作实时影像。" });
  let body: Uint8Array = new Uint8Array();
  let input: Record<string, unknown> = {};
  async function readPayload(limit = LIMIT): Promise<Response | null> {
    try { body = await boundedBody(request, limit); }
    catch { return reply(413, { error: limit === LIMIT ? "请求超过 20 MB，请减少图片。" : "清理请求过大。" }); }
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply(415, { error: "请发送 JSON 请求。" });
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(body) || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
      input = value as Record<string, unknown>;
    } catch { return reply(400, { error: "请求内容无效。" }); }
    return null;
  }
  // Only the tiny cleanup payload is parsed without an account session.
  if (request.method === "DELETE") { const invalid = await readPayload(1024); if (invalid) return invalid; }
  // A per-lease cleanup capability can only end that lease. It remains valid
  // after logout/account switching; all other routes still require D1 auth.
  const cleanupOnly = request.method === "DELETE" && typeof input.cleanupToken === "string" && /^[a-f0-9]{64}$/.test(input.cleanupToken);
  const cookie = (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => /^qingyu_session=[^;\s]+$/.test(v));
  let user: { id: string; role: "user" | "super" };
  if (cleanupOnly) user = { id: "lease_cleanup", role: "user" };
  else {
  if (!cookie) return reply(401, { error: "请先登录，再使用实时影像。" });
  try {
    const response = await env.BACKEND.fetch(new Request("https://qingyu-backend.internal/v1/session", {
      headers: { Cookie: cookie }, redirect: "manual", signal: request.signal,
    }));
    if (!response.ok) { await response.body?.cancel(); return reply(response.status === 401 ? 401 : 503, { error: "账户会话暂不可用，请重新登录或重试。" }); }
    const value = await response.json() as { user?: { id?: unknown; isGuest?: unknown; role?: unknown } };
    if (!value.user || typeof value.user.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value.user.id) || value.user.isGuest !== false) return reply(401, { error: "请先登录正式账号，再使用实时影像。" });
    user = { id: value.user.id, role: value.user.role === "super" ? "super" : "user" };
  } catch { return reply(503, { error: "账户服务暂不可用，请稍后重试。" }); }
  }
  const isStatus = tail === "/status";
  const unavailable = { available: false, configured: false, realAllowed: true, accountId: user.id, message: "实时影像服务尚未连接，请稍后重试。" };
  if (request.method === "POST") { const invalid = await readPayload(); if (invalid) return invalid; }
  const action = route?.[2];
  // Pause new material creation before either private studio or bridge delegation.
  // Existing tasks and telephone controls remain available under their usual auth.
  if (action === "generate" && env.GENERATION_ENABLED === "false") return reply(503, { error: "生图和生视频已暂停，请稍后再试。" });
  if (action === "start" && input.mode !== "real") return reply(400, { error: "仅支持 Vidu S2 实时直播，请刷新页面后开播。" });
  if (user.role !== "super" && (action === "generate" || action === "task")) return reply(403, { error: "素材生成暂未向当前账号开放。" });
  if ((tail === "/leases" || action === "start" || action === "generate") && env.LIVE_RATE_LIMITER) {
    if (!(await env.LIVE_RATE_LIMITER.limit({ key: `live:${user.id}` })).success) return reply(429, { error: "操作较频繁，请稍后重试。" });
  }
  // Caller-controlled headers never cross the binding trust boundary. The
  // namespace has no public endpoint and receives only the D1 identity above.
  if (env.LIVE_STUDIOS && env.VIDU_API_KEY) {
    try {
      const prefix = route ? viduStudioLeasePrefix(route[1]) : await viduStudioOwnerPrefix(user.id);
      if (route && !cleanupOnly && prefix !== await viduStudioOwnerPrefix(user.id)) return reply(404, { error: "当前账号没有这个工作台。" });
      const studio = env.LIVE_STUDIOS.get(env.LIVE_STUDIOS.idFromName(`account:${prefix}`));
      const headers = new Headers({ "X-Xumeng-Live-User": user.id, "X-Xumeng-Live-Role": user.role, "Accept": "application/json" });
      if (request.method !== "GET") headers.set("Content-Type", "application/json");
      const upstream = await studio.fetch(new Request("https://live-studio.internal" + tail, {
        method: request.method, headers, body: request.method === "GET" ? undefined : body as BodyInit, signal: request.signal,
      }));
      const value: unknown = await upstream.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid studio response");
      return reply(upstream.status, { ...value, accountId: user.id, ...(isStatus ? { realAllowed: true } : {}) });
    } catch { return isStatus ? reply(200, unavailable) : reply(503, { error: "实时影像结果尚未确认，请刷新状态后核对，避免重复开播。" }); }
  }
  let base: URL;
  try {
    base = new URL(env.LIVE_BRIDGE_URL || "");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/qingyu-api") throw new Error("Invalid bridge");
    if (!env.XUMENG_LIVE_BRIDGE_SECRET || env.XUMENG_LIVE_BRIDGE_SECRET.length < 32) throw new Error("Missing bridge");
  } catch { return isStatus ? reply(200, unavailable) : reply(503, { error: unavailable.message }); }
  const timestamp = String(Math.floor((options.now?.() ?? Date.now()) / 1000)), nonce = options.nonce?.() ?? crypto.randomUUID();
  const destination = new URL(base.href + tail);
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", body as BufferSource));
  const canonical = [request.method, destination.pathname, user.id, user.role, timestamp, nonce, bodyHash].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.XUMENG_LIVE_BRIDGE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)));
  const headers = new Headers({ "Accept": "application/json", "X-Xumeng-Live-User": user.id, "X-Xumeng-Live-Role": user.role, "X-Xumeng-Live-Timestamp": timestamp, "X-Xumeng-Live-Nonce": nonce, "X-Xumeng-Live-Signature": signature });
  if (request.method !== "GET") headers.set("Content-Type", "application/json");
  try {
    const upstream = await (options.fetch ?? fetch)(destination, { method: request.method, headers, body: request.method === "GET" ? undefined : body as BodyInit, redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(65000)]) });
    if (upstream.status >= 300 && upstream.status < 400 || !upstream.headers.get("Content-Type")?.toLowerCase().includes("application/json")) { await upstream.body?.cancel(); throw new Error("Invalid bridge response"); }
    const value = await upstream.json() as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid bridge JSON");
    delete value.csrf;
    return reply(upstream.status, { ...value, accountId: user.id, ...(isStatus ? { realAllowed: true } : {}) });
  } catch { return isStatus ? reply(200, unavailable) : reply(503, { error: "实时影像服务连接失败；请核对状态后重试，避免重复创建。" }); }
}
