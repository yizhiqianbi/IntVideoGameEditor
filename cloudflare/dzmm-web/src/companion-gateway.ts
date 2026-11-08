import { GIRLFRIEND_CAST_IDS } from "../../../src/app/xumeng/girlfriend/cast";

export type CompanionServiceFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

export interface CompanionGatewayEnvironment {
  BACKEND: CompanionServiceFetcher;
  /** Private Cloudflare service binding; never a browser-provided URL. */
  COMPANION?: CompanionServiceFetcher;
  BILLING?: { companionOverview?(request: Request): Promise<unknown> };
}

/** Public message media contract shared by the native bridge and the UI.
 *
 * MaiBot's WebUI uses rich `segments` whose binary data is represented as a
 * data URL. The private bridge normalizes those segments to this shape and
 * this gateway deliberately passes them through unchanged. Keeping the
 * contract here prevents the edge layer from accidentally reducing a rich
 * reply back to text when photo, emoji or voice actions are enabled.
 */
export type CompanionMediaKind = "emoji" | "image" | "voice";
export interface CompanionMediaSegment {
  kind: CompanionMediaKind;
  url: string;
  mimeType: string;
  alt?: string;
  durationMs?: number;
}

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  requestId?: string;
  media?: CompanionMediaSegment[];
}

function messageOpening(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const line = item.trim();
    if (!line || line.length > 160) return null;
    lines.push(line);
  }
  return lines;
}

const CLASSIC_PREFIX = "/api/xumeng/companion/api";
const INTIMATE_PREFIX = "/api/xumeng/companion-intimate/api";
const SALES_PREFIX = "/api/xumeng/companion-sales/api";
const CAST_PREFIX = "/api/xumeng/companion-cast/";
const CAST_IDS = new Set<string>(GIRLFRIEND_CAST_IDS);
const UUID_SOURCE = "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "i");
const SESSION = new RegExp(`^/sessions/(${UUID_SOURCE})(/messages|/proactive|/style|/receipts/(${UUID_SOURCE}))?$`, "i");
const BODY_LIMIT = 24 * 1024;
const STYLE_FIELDS = ["personality", "speakingStyle", "relationshipStyle"] as const;

function reply(status: number, value: unknown): Response {
  return Response.json(value, { status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie",
  } });
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validStyle(value: unknown): value is { version: 1; personality: string; speakingStyle: string; relationshipStyle: string } {
  if (!record(value) || value.version !== 1 || Object.keys(value).some(key => !["version", ...STYLE_FIELDS].includes(key))) return false;
  return STYLE_FIELDS.every(key => typeof value[key] === "string" && value[key].trim().length >= 1 && value[key].length <= 600);
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const advertised = request.headers.get("Content-Length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) >= BODY_LIMIT)) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size >= BODY_LIMIT) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Validate the public namespace and D1 identity before crossing the private binding. */
export async function handleCompanionGateway(request: Request, env: CompanionGatewayEnvironment): Promise<Response> {
  const url = new URL(request.url);
  const castMatch = /^\/api\/xumeng\/companion-cast\/([a-z]{3,16})\/api(\/.*)?$/.exec(url.pathname);
  const castKnown = Boolean(castMatch && CAST_IDS.has(castMatch[1]));
  if (url.pathname.startsWith(CAST_PREFIX) && !castKnown) return reply(404, { error: "聊天接口不存在。", code: "NOT_FOUND" });
  const profile = castKnown ? `cast-${castMatch![1]}`
    : url.pathname.startsWith(INTIMATE_PREFIX + "/") ? "intimate" as const
    : url.pathname.startsWith(SALES_PREFIX + "/") ? "sales" as const
    : url.pathname.startsWith(CLASSIC_PREFIX + "/") ? "classic" as const : null;
  if (!profile || url.search || url.hash) return reply(404, { error: "聊天接口不存在。", code: "NOT_FOUND" });
  const path = castKnown ? (castMatch?.[2] ?? "") : url.pathname.slice((profile === "intimate" ? INTIMATE_PREFIX : profile === "sales" ? SALES_PREFIX : CLASSIC_PREFIX).length);
  const session = SESSION.exec(path);
  const desk = path === "/presence";
  if (!desk && path !== "/health" && path !== "/sessions" && path !== "/billing" && path !== "/reset" && !session) return reply(404, { error: "聊天接口不存在。", code: "NOT_FOUND" });
  const allowed = desk ? ["POST"] : path === "/sessions" ? ["GET", "POST"] : path === "/billing" ? ["GET"] : path === "/reset" ? ["POST"] : session?.[2] === "/messages" || session?.[2] === "/proactive" ? ["POST"] : session?.[2] === "/style" ? ["PUT"] : ["GET"];
  if (!allowed.includes(request.method)) return reply(405, { error: "请求方法不支持。", code: "METHOD_NOT_ALLOWED" });

  let payload: string | undefined;
  if (request.method === "POST" || request.method === "PUT") {
    if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
      return reply(403, { error: "请从叙梦页面发起聊天。", code: "ORIGIN_REJECTED" });
    }
    if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return reply(415, { error: "请发送 JSON 请求。", code: "JSON_REQUIRED" });
    }
    let bytes: Uint8Array | null;
    try { bytes = await readBody(request); }
    catch { return reply(400, { error: "请求内容未能完整读取，请重试。", code: "INVALID_BODY" }); }
    if (!bytes) return reply(413, { error: "请求内容需小于 24 KB。", code: "BODY_TOO_LARGE" });
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)); }
    catch { return reply(400, { error: "请求内容不是有效的 JSON。", code: "INVALID_BODY" }); }
    if (!record(body)) return reply(400, { error: "请求内容应为 JSON 对象。", code: "INVALID_BODY" });
    if (path === "/presence") {
      if (Object.keys(body).length !== 0) return reply(400, { error: "请求内容无效。", code: "INVALID_BODY" });
      payload = "{}";
    } else if (session?.[2] === "/proactive") {
      const intent = typeof body.intent === "string" ? body.intent.trim() : "";
      if (!intent || intent.length > 2000 || Object.keys(body).some(key => !["intent", "userMessageId", "reason", "priority", "metadata"].includes(key))) {
        return reply(400, { error: "主动触发需要一段有效的意图说明。", code: "INVALID_BODY" });
      }
      if (body.userMessageId !== undefined && (typeof body.userMessageId !== "string" || !body.userMessageId.trim() || body.userMessageId.length > 240)) {
        return reply(400, { error: "主动消息的上下文编号无效。", code: "INVALID_BODY" });
      }
      if ((body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 240))
        || (body.priority !== undefined && (typeof body.priority !== "string" || body.priority.length > 80))
        || (body.metadata !== undefined && (!record(body.metadata) || JSON.stringify(body.metadata).length > 1000))) {
        return reply(400, { error: "主动触发的附加说明无效。", code: "INVALID_BODY" });
      }
      payload = JSON.stringify({
        intent,
        ...(typeof body.userMessageId === "string" ? { userMessageId: body.userMessageId.trim() } : {}),
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
        ...(typeof body.priority === "string" ? { priority: body.priority } : {}),
        ...(record(body.metadata) ? { metadata: body.metadata } : {}),
      });
    } else if (session?.[2] === "/style") {
      if (Object.keys(body).some(key => key !== "style") || !validStyle(body.style)) {
        return reply(400, { error: "女友设定格式无效。", code: "INVALID_STYLE" });
      }
      payload = JSON.stringify({ style: body.style });
    } else if (path === "/reset") {
      if (Object.keys(body).length !== 1 || body.confirmation !== "discard-current-instance") {
        return reply(400, { error: "请确认放弃当前异常实例后再重建。", code: "RESET_CONFIRMATION_REQUIRED" });
      }
      payload = JSON.stringify({ confirmation: "discard-current-instance" });
    } else if (path === "/sessions") {
      if (Object.keys(body).some(key => !["characterId", "requestId", "style"].includes(key)) || body.characterId !== "yume"
        || (body.requestId !== undefined && (typeof body.requestId !== "string" || !UUID.test(body.requestId)))
        || (body.style !== undefined && !validStyle(body.style))) {
        return reply(400, { error: "聊天对象无效，请从聊天列表重新进入。", code: "INVALID_BODY" });
      }
      payload = JSON.stringify({ characterId: "yume", ...(body.requestId ? { requestId: body.requestId } : {}), ...(body.style ? { style: body.style } : {}) });
    } else {
      const opening = body.opening === undefined ? [] : messageOpening(body.opening);
      if (Object.keys(body).some(key => key !== "text" && key !== "requestId" && key !== "opening")
        || typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000
        || typeof body.requestId !== "string" || !UUID.test(body.requestId)
        || opening === null) {
        return reply(400, { error: "消息需为 1 至 4000 个字符，并包含有效的发送编号。", code: "INVALID_BODY" });
      }
      payload = JSON.stringify({ text: body.text, requestId: body.requestId, ...(opening.length ? { opening } : {}) });
    }
  }

  // Match the backend's actual session token format and discard unrelated cookies.
  const cookies = (request.headers.get("Cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith("dzmm_session="));
  if (cookies.length !== 1 || !/^dzmm_session=[a-f0-9]{64}$/.test(cookies[0])) {
    return reply(401, { error: "请先登录正式账号，再使用女友聊天。", code: "LOGIN_REQUIRED" });
  }
  let accountId: string;
  try {
    const auth = await env.BACKEND.fetch(new Request("https://dzmm-backend.850587960.workers.dev/v1/session", {
      headers: { Cookie: cookies[0], Accept: "application/json" }, redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    }));
    if (!auth.ok || !auth.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      await auth.body?.cancel();
      return reply(auth.status === 401 ? 401 : 503, { error: "登录状态暂时无法确认，请重新登录或稍后重试。", code: "ACCOUNT_UNAVAILABLE" });
    }
    const value: unknown = await auth.json();
    if (!record(value) || value.authenticated !== true || !record(value.user)
      || value.user.isGuest !== false || typeof value.user.id !== "string" || !UUID.test(value.user.id)) {
      return reply(401, { error: "请先登录正式账号，再使用女友聊天。", code: "LOGIN_REQUIRED" });
    }
    // auth.ts toUser exposes only user/super. Both real account roles are allowed.
    if (value.user.role !== "user" && value.user.role !== "super") return reply(403, { error: "当前账号身份无效，请重新登录后再试。", code: "COMPANION_NOT_ALLOWED" });
    accountId = value.user.id;
  } catch { return reply(503, { error: "账户服务暂时连接不上，请稍后重试。", code: "ACCOUNT_UNAVAILABLE" }); }

  if (desk) return deskRoute(env, accountId, profile);
  if (path === "/billing" && request.method === "GET") {
    if (!env.BILLING?.companionOverview) return reply(503, { error: "女友聊天计费服务尚未连接。", code: "BILLING_UNAVAILABLE" });
    try {
      const value: any = await env.BILLING.companionOverview(new Request("https://billing.internal/v1/companion", { headers: { Cookie: cookies[0] } }));
      if (value?.error) return reply(value.error.status || 503, value);
      return reply(200, value);
    } catch { return reply(503, { error: "女友聊天计费服务暂时不可用。", code: "BILLING_UNAVAILABLE" }); }
  }
  if (!env.COMPANION) return reply(503, { ready: false, error: "女友聊天服务尚未连接，请稍后再试。", code: "COMPANION_UNAVAILABLE" });
  const headers = new Headers({ Accept: "application/json", "X-Xumeng-Account-Id": accountId });
  if (profile !== "classic") headers.set("X-Xumeng-Companion-Profile", profile);
  if (path.endsWith("/messages")) headers.set("X-Xumeng-Session-Token", cookies[0].slice("dzmm_session=".length));
  if (payload !== undefined) headers.set("Content-Type", "application/json");
  const outboundText = path.endsWith("/messages") ? JSON.parse(payload || "{}").text as string : "";
  try {
    const upstream = await env.COMPANION.fetch(new Request("https://companion.internal/api" + path, {
      method: request.method, headers, body: payload, redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
    }));
    if (upstream.status >= 300 && upstream.status < 400 || !upstream.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      await upstream.body?.cancel();
      throw new Error("Invalid companion response");
    }
    const value: unknown = await upstream.json();
    if (!record(value)) throw new Error("Invalid companion JSON");
    if (upstream.status < 300 && session) {
      if (path.endsWith("/messages") && outboundText) {
        await callDesk(env, accountId, profile, "/api/desk/touch", "POST", { sessionId: session[1].toLowerCase(), text: outboundText.slice(0, 80) });
      } else if (session[2] === "/proactive") {
        await callDesk(env, accountId, profile, "/api/desk/revived", "POST", {});
      }
    }
    // Preserve real readiness and delivery status; no synthetic success or retry.
    return reply(upstream.status, value);
  } catch {
    return request.method === "POST"
      ? reply(503, { error: "送达结果尚未确认，请先刷新聊天记录再重试。", code: "DELIVERY_UNCERTAIN" })
      : reply(503, { ready: false, error: "女友聊天服务暂时连接不上，请稍后重试。", code: "COMPANION_UNAVAILABLE" });
  }
}

async function callDesk(env: CompanionGatewayEnvironment, accountId: string, profile: string, path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
  if (!env.COMPANION) return null;
  try {
    const headers = new Headers({ Accept: "application/json", "X-Xumeng-Account-Id": accountId });
    if (profile !== "classic") headers.set("X-Xumeng-Companion-Profile", profile);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await env.COMPANION.fetch(new Request(`https://companion.internal${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(1500),
    }));
    if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      await response.body?.cancel();
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function deskRoute(env: CompanionGatewayEnvironment, accountId: string, profile: string): Promise<Response> {
  await callDesk(env, accountId, profile, "/api/desk/seen", "POST", {});
  return reply(200, { ok: true });
}
