import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const COMPANION_BASE = "/api/qingyu/companion";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const COOKIE = "xumeng_companion_device";
const MUTATING = new Set(["POST", "PUT"]);
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
type Environment = Record<string, string | undefined>;
type Dependencies = { env?: Environment; fetcher?: typeof fetch };

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function configuredOrigin(value: string) {
  const url = new URL(value);
  if (!LOCAL.has(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Companion service must use a loopback HTTP origin");
  }
  return url;
}

function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function companionRoute(path: string[], method: string) {
  const value = path.join("/");
  if (value === "api/health") return method === "GET" ? { kind: "health" as const } : null;
  if (value === "api/sessions") return ["GET", "POST"].includes(method) ? { kind: "sessions" as const } : null;
  if (path[0] !== "api" || path[1] !== "sessions" || !UUID.test(path[2] || "")) return null;
  const action = path.slice(3).join("/");
  if (method === "GET" && path[3] === "receipts" && UUID.test(path[4] || "") && path.length === 5) {
    return { kind: "receipt" as const, sessionId: path[2], requestId: path[4] };
  }
  const valid = (method === "GET" && action === "") || (method === "POST" && action === "messages") || (method === "PUT" && action === "style");
  return valid ? { kind: "session" as const, sessionId: path[2] } : null;
}

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.match(/^application\/json(?:\s*;|$)/i)) throw new TypeError("Expected JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 24_000) { await reader.cancel(); throw new RangeError("Request too large"); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createCompanionBridge({ env = process.env, fetcher = fetch }: Dependencies = {}) {
  return async (request: Request, path: string[] = []) => {
    const route = companionRoute(path, request.method);
    if (!route || path.some(segment => !/^[a-zA-Z0-9_.-]+$/.test(segment) || segment === "." || segment === "..")) return failure("找不到这个操作。", 404);
    const url = new URL(request.url);
    const host = request.headers.get("host") || url.host;
    const origin = `${url.protocol}//${host}`;
    if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== origin)) return failure("请从晴屿页面打开这段对话。", 403);
    const production = env.NODE_ENV === "production";
    if (production && (!env.XUMENG_COMPANION_URL || !env.XUMENG_COMPANION_DATA_DIR)) return failure("AI 女友暂未开放，请稍后再来。", 503);
    if (!production && !LOCAL.has(new URL(origin).hostname)) return failure("本地预览请使用本机地址。", 403);

    let upstreamOrigin: URL;
    try { upstreamOrigin = configuredOrigin(env.XUMENG_COMPANION_URL || "http://127.0.0.1:3227"); }
    catch { return failure("AI 女友服务尚未准备好。", 503); }
    const dataDir = resolve(env.XUMENG_COMPANION_DATA_DIR || join(process.cwd(), "experiments/maibot-native/.data/bridge-owners"));
    let owner: string;
    let setCookie: string | undefined;
    const accountCookie = cookie(request, "qingyu_session");
    if (accountCookie) {
      // Resolve identity server-side. Never forward account cookies to the companion service.
      if (!/^[a-f0-9]{64}$/.test(accountCookie)) return failure("登录状态已过期，请重新登录。", 401);
      try {
        const backend = new URL(env.DZMM_BACKEND_URL || "http://127.0.0.1:8787");
        if (!(backend.protocol === "https:" || (backend.protocol === "http:" && LOCAL.has(backend.hostname))) || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) throw new Error("Invalid backend");
        const result = await fetcher(new URL("/v1/session", backend), { headers: { cookie: `qingyu_session=${accountCookie}` }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) });
        if (!result.ok) return failure("无法确认登录状态，请稍后重试。", 503);
        const session = await result.json();
        if (!UUID.test(session?.user?.id || "") || (production && (session.authenticated !== true || session.user.isGuest !== false))) return failure("请先登录晴屿，再来开启这段相处。", 401);
        owner = `account:${session.user.id}`;
      } catch { return failure("账户服务暂时无法连接，请稍后重试。", 503); }
    } else {
      if (production) return failure("请先登录晴屿，再来开启这段相处。", 401);
      let device = cookie(request, COOKIE);
      if (!device || !/^[a-f0-9]{64}$/.test(device)) {
        device = randomBytes(32).toString("hex");
        setCookie = `${COOKIE}=${device}; Path=${COMPANION_BASE}; HttpOnly; SameSite=Strict; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`;
      }
      owner = `device:${device}`;
    }
    const ownerHash = createHash("sha256").update(owner).digest("hex");
    // Native memory and learned style belong to an instance. Message ownership
    // alone cannot turn one MaiBot instance into multiple independent tenants.
    if (route.kind !== "health") {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const ownerFile = join(dataDir, "instance-owner.json");
      try {
        await writeFile(ownerFile, JSON.stringify({ owner: ownerHash }), { mode: 0o600, flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return failure("无法确认实例归属。", 503);
      }
      try {
        if (JSON.parse(await readFile(ownerFile, "utf8")).owner !== ownerHash) return failure("这个 MaiBot 实例属于另一位使用者，请使用原来的浏览器或账户。", 403);
      } catch { return failure("无法确认实例归属。", 503); }
    }
    const owns = async (id: string) => {
      if (!UUID.test(id)) return false;
      try { return JSON.parse(await readFile(join(dataDir, `${id}.json`), "utf8")).owner === ownerHash; }
      catch { return false; }
    };
    if ((route.kind === "session" || route.kind === "receipt") && !(await owns(route.sessionId))) return failure("找不到这段对话。", 404);

    try {
      const body = MUTATING.has(request.method) ? await readBody(request) : undefined;
      const upstream = await fetcher(new URL(`/${path.join("/")}`, upstreamOrigin), {
        method: request.method, headers: body ? { "Content-Type": "application/json" } : undefined,
        body, cache: "no-store", redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(route.kind === "health" ? 15_000 : 30_000)]),
      });
      if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return failure("聊天服务返回了意外跳转。", 502); }
      const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "same-origin" });
      for (const name of ["content-type", "content-disposition"]) {
        const value = upstream.headers.get(name); if (value) headers.set(name, value);
      }
      if (setCookie) headers.append("Set-Cookie", setCookie);
      if (route.kind === "health" && upstream.ok) {
        const data = await upstream.json();
        if (data.runtime !== "maibot-native") return failure("检测到旧版聊天服务，请先启动 MaiBot 原生实例。", 503);
        return Response.json({ ...data, clientScope: ownerHash.slice(0, 16) }, { headers });
      }
      if (route.kind === "sessions" && upstream.ok) {
        const data = await upstream.json();
        if (request.method === "GET") {
          const sessions = Array.isArray(data.sessions) ? data.sessions : [];
          const visibility = await Promise.all(sessions.map((session: { id: string }) => owns(session.id)));
          data.sessions = sessions.filter((_: unknown, index: number) => visibility[index]);
        } else {
          if (!UUID.test(data?.session?.id || "")) return failure("聊天服务返回的对话无效。", 502);
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          await writeFile(join(dataDir, `${data.session.id}.json`), JSON.stringify({ owner: ownerHash }), { mode: 0o600, flag: "wx" });
        }
        return Response.json(data, { status: upstream.status, headers });
      }
      // Transport only: decisions, message splitting and memory stay native.
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      if (error instanceof RangeError) return failure("这条消息太长了，请分段发送。", 413);
      if (error instanceof TypeError && error.message === "Expected JSON") return failure("请使用 JSON 提交请求。", 415);
      return failure("暂时连不上她，请稍后重试。", 503);
    }
  };
}
