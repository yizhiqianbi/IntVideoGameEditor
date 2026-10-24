/**
 * Authenticated WebSocket relay for the MiniCPM-o realtime phone.
 *
 * The browser never receives the ModelBest/self-hosted API key.  The worker
 * authenticates the existing XUMENG session and opens the upstream realtime
 * socket with the server-side key, then forwards protocol frames unchanged.
 */
type ServiceFetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

export interface MiniCpmPhoneEnvironment {
  BACKEND: ServiceFetcher;
  MINICPM_REALTIME_URL?: string;
  MINICPM_API_KEY?: string;
  MINICPM_PHONE_ENABLED?: string;
}

const DEFAULT_REALTIME_URL = "wss://minicpmo45.modelbest.cn/v1/realtime?mode=audio";
const PHONE_POLICY = "你正在进行中文实时电话。只说自然简短的对白，不输出旁白、动作括号、角色名标签或系统说明；保持角色身份，回应用户情绪，允许主动发起轻量话题。";

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function sessionCookie(request: Request): string | null {
  const value = request.headers.get("Cookie") || "";
  return value.split(";").map(part => part.trim()).find(part => /^qingyu_session=[^;\s]+$/.test(part)) ?? null;
}

async function account(request: Request, env: MiniCpmPhoneEnvironment): Promise<{ id: string; role: "user" | "super" } | null> {
  const cookie = sessionCookie(request);
  if (!cookie) return null;
  try {
    const response = await env.BACKEND.fetch(new Request("https://qingyu-backend.internal/v1/session", {
      headers: { Cookie: cookie }, redirect: "manual", signal: request.signal,
    }));
    if (!response.ok) { await response.body?.cancel(); return null; }
    const value = await response.json() as { user?: { id?: unknown; isGuest?: unknown; role?: unknown } };
    if (!value.user || typeof value.user.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value.user.id) || value.user.isGuest !== false) return null;
    return { id: value.user.id, role: value.user.role === "super" ? "super" : "user" };
  } catch { return null; }
}

function configured(env: MiniCpmPhoneEnvironment): boolean {
  return env.MINICPM_PHONE_ENABLED !== "false" && Boolean(env.MINICPM_API_KEY && (env.MINICPM_REALTIME_URL || DEFAULT_REALTIME_URL));
}

export async function handleMiniCpmPhone(request: Request, env: MiniCpmPhoneEnvironment, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/phone/status") {
    if (request.method !== "GET") return json({ error: "请求方法不支持。" }, 405);
    const user = await account(request, env);
    if (!user) return json({ available: false, configured: configured(env), accountId: null }, 401);
    return json({ available: configured(env), configured: configured(env), accountId: user.id, provider: "MiniCPM-o 4.5" });
  }
  if (url.pathname !== "/api/phone/ws") return json({ error: "电话接口不存在。" }, 404);
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "需要 WebSocket 连接。" }, 426);
  if (request.headers.get("Origin") !== url.origin) return json({ error: "当前来源不允许使用电话。" }, 403);
  const user = await account(request, env);
  if (!user) return json({ error: "请先登录正式账号，再使用电话。" }, 401);
  if (!configured(env)) return json({ error: "MiniCPM 电话服务尚未配置。" }, 503);

  const upstreamUrl = env.MINICPM_REALTIME_URL || DEFAULT_REALTIME_URL;
  // Do not attach the page request signal. In workerd that signal aborts the
  // upgraded socket as soon as this handler returns.
  const connectUpstream = async (): Promise<WebSocket> => {
    const target = new URL(upstreamUrl);
    if (target.protocol !== "wss:" && target.protocol !== "ws:") throw new Error("invalid realtime URL");
    if (target.username || target.password || target.hash) throw new Error("invalid realtime URL");
    const headers: Record<string, string> = { Upgrade: "websocket" };
    // The public ModelBest demo authenticates the socket itself. A stored key is
    // only attached for a self-hosted relay that expects Bearer auth.
    if (env.MINICPM_API_KEY && target.hostname !== "minicpmo45.modelbest.cn") headers.Authorization = `Bearer ${env.MINICPM_API_KEY}`;
    // workerd rejects a wss:// fetch with TypeError. The upgrade header selects
    // the socket, and the deadline must not stay attached after status 101.
    if (target.protocol === "wss:") target.protocol = "https:";
    else if (target.protocol === "ws:") target.protocol = "http:";
    const upstream = await fetchImpl(target, { headers, redirect: "manual" }) as Response & { webSocket?: WebSocket | null };
    const socket = upstream.webSocket;
    if (upstream.status !== 101 || !socket) {
      console.log(JSON.stringify({ phone: "upstream", status: upstream.status }));
      await upstream.body?.cancel();
      throw new Error(`upstream ${upstream.status}`);
    }
    return socket;
  };
  let socket: WebSocket;
  try { socket = await connectUpstream(); }
  catch (error) {
    console.log(JSON.stringify({ phone: "handshake", error: error instanceof Error ? `${error.name}:${error.message}`.slice(0, 180) : "failed" }));
    return json({ error: error instanceof Error && error.message.startsWith("upstream ") ? "MiniCPM 实时服务未接受连接。" : "MiniCPM 实时服务暂时无法连接。" }, 503);
  }

  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();
  // The public audio workers intermittently accept the socket and then close
  // with backend_error before session.created. Retry that assignment without
  // dropping the browser call.
  const maxAttempts = 3;
  let attempt = 1;
  let generation = 0;
  let created = false;
  let finished = false;
  let initFrame: string | null = null;
  let initSentFor = 0;
  let upstream: WebSocket = socket;
  let failoverTask: Promise<void> | null = null;
  const closeBoth = (code = 1000, reason = "") => {
    finished = true;
    try { server.close(code, reason); } catch {}
    try { upstream.close(code, reason); } catch {}
  };
  const workerFailed = (value: Record<string, unknown>) => {
    if (value.type === "session.closed" && value.session_id == null && value.reason === "backend_error") return true;
    const error = value.error;
    return value.type === "error" && !!error && typeof error === "object" && (error as { code?: unknown }).code === "session_failed";
  };
  const failCall = () => {
    if (finished) return;
    try { server.send(JSON.stringify({ type: "error", error: { code: "session_failed", message: "MiniCPM 语音工人暂时无法建立会话，请再拨一次。", type: "server_error" } })); } catch {}
    closeBoth(1011, "backend unavailable");
  };
  const attach = (next: WebSocket) => {
    const token = ++generation;
    let replayed = false;
    next.accept();
    next.addEventListener("message", event => {
      if (token !== generation || finished) return;
      if (typeof event.data === "string") {
        try {
          const value = JSON.parse(event.data) as Record<string, unknown>;
          if (value.type === "session.created") created = true;
          if (value.type === "session.queue_done" && initFrame && !replayed && initSentFor !== token) {
            replayed = true;
            initSentFor = token;
            next.send(initFrame);
            return;
          }
          if (!created && workerFailed(value)) { void failover(); return; }
        } catch { /* Forward non-JSON frames unchanged. */ }
      }
      try { server.send(typeof event.data === "string" ? event.data : event.data); } catch { closeBoth(1011, "client unavailable"); }
    });
    next.addEventListener("close", () => {
      if (token !== generation || finished) return;
      if (!created) void failover(); else closeBoth();
    });
    next.addEventListener("error", () => {
      if (token !== generation || finished) return;
      if (!created) void failover(); else closeBoth(1011, "upstream error");
    });
  };
  const failover = () => {
    if (created || finished || failoverTask) return failoverTask ?? Promise.resolve();
    failoverTask = (async () => {
      while (!created && !finished && attempt < maxAttempts) {
        attempt += 1;
        let next: WebSocket;
        try { next = await connectUpstream(); }
        catch { continue; }
        const previous = upstream;
        upstream = next;
        attach(next);
        try { previous.close(); } catch {}
        return;
      }
      failCall();
    })().finally(() => { failoverTask = null; });
    return failoverTask;
  };
  attach(socket);
  server.addEventListener("message", event => {
    try {
      let data = typeof event.data === "string" ? event.data : event.data;
      if (typeof data === "string") {
        try {
          const value = JSON.parse(data) as Record<string, unknown>;
          if (value && value.type === "session.init" && value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)) {
            const payload = value.payload as Record<string, unknown>;
            const supplied = typeof payload.system_prompt === "string" ? payload.system_prompt.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 5000) : "";
            value.payload = { ...payload, system_prompt: `${PHONE_POLICY}\n\n${supplied}`.slice(0, 6000) };
            data = JSON.stringify(value);
            initFrame = data;
            if (initSentFor === generation) return;
            initSentFor = generation;
          }
        } catch { /* Forward protocol errors to the upstream for its normal response. */ }
      }
      upstream.send(data);
    } catch { closeBoth(1011, "upstream unavailable"); }
  });
  server.addEventListener("close", () => closeBoth());
  server.addEventListener("error", () => closeBoth(1011, "client error"));
  return new Response(null, { status: 101, webSocket: client });
}
