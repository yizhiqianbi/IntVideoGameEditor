// Node-only: this module is imported by the Next backend route, never a client.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CREDENTIALS_FILE = join(homedir(), ".codex/private/qingyu-super-credentials.json");
const TRUSTED_BACKEND = "https://qingyu-backend.internal";
const SESSION_NAME = "qingyu_session";
const OPTOUT_NAME = "dzmm_local_super_optout";
const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60;
const RETRY_DELAY_MS = 60_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

type Credentials = { email: string; password: string; userId: string };
type Options = {
  environment?: () => string | undefined;
  autoLoginEnabled?: () => boolean;
  credentialsFile?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

function loopbackHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function loopbackAddress(address: string) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function cookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "").split(";")
    .find(part => part.trim().startsWith(`${name}=`))?.trim().slice(name.length + 1);
}

function optedOut(request: Request) {
  return (request.headers.get("cookie") ?? "").split(";").some(part => part.trim() === `${OPTOUT_NAME}=1`);
}

/** The dev server must also bind 127.0.0.1; NextRequest has no peer socket. */
export function isDzmmLocalSuperRequest(request: Request, environment: string | undefined = process.env.NODE_ENV,
  autoLoginEnabled = process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN === "1") {
  if (!autoLoginEnabled || environment !== "development") return false;
  try {
    const url = new URL(request.url);
    if (!loopbackHostname(url.hostname) || !["http:", "https:"].includes(url.protocol)) return false;
    const host = request.headers.get("host");
    if (!host) return false;
    const authority = new URL(`${url.protocol}//${host}`);
    if (!loopbackHostname(authority.hostname) || authority.port !== url.port
      || authority.username || authority.password || authority.pathname !== "/" || authority.search || authority.hash) return false;
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if (forwardedHost && forwardedHost !== host) return false;
    if (forwardedProto && forwardedProto !== url.protocol.slice(0, -1)) return false;
    // Next adds the incoming socket address when there is no forwarded header.
    // Missing or non-loopback addresses cannot bootstrap a privileged session.
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (!forwardedFor || !forwardedFor.split(",").every(value => loopbackAddress(value.trim()))) return false;
    const origin = request.headers.get("origin");
    if (origin && origin !== authority.origin) return false;
    const site = request.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  } catch { return false; }
}

function trustedBackend(backend: URL) {
  if (backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) return false;
  return backend.origin === TRUSTED_BACKEND || (loopbackHostname(backend.hostname)
    && ["http:", "https:"].includes(backend.protocol));
}

async function readCredentials(path: string): Promise<Credentials | null> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || !process.getuid
      || stat.uid !== process.getuid() || stat.size === 0 || stat.size > 16 * 1024) return null;
    const value: unknown = JSON.parse(await file.readFile("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fields = value as Record<string, unknown>;
    if (fields.email !== "super@qingyu.invalid" || fields.role !== "super"
      || typeof fields.userId !== "string" || !UUID.test(fields.userId)
      || typeof fields.password !== "string" || fields.password.length < 12
      || fields.password.length > 256 || fields.password.includes("\0")) return null;
    return { email: fields.email, password: fields.password, userId: fields.userId };
  } catch { return null; }
  finally { await file?.close().catch(() => undefined); }
}

function loginCookie(response: Response, request: Request) {
  const candidates = response.headers.getSetCookie().filter(value => value.startsWith(`${SESSION_NAME}=`));
  if (candidates.length !== 1) return null;
  const [pair, ...rawAttributes] = candidates[0].split(";").map(value => value.trim());
  const token = pair.slice(SESSION_NAME.length + 1);
  const attributes = new Map(rawAttributes.map(value => {
    const separator = value.indexOf("=");
    return separator < 0 ? [value.toLowerCase(), ""] : [value.slice(0, separator).toLowerCase(), value.slice(separator + 1)];
  }));
  const age = attributes.get("max-age") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token) || !attributes.has("httponly")
    || attributes.get("samesite")?.toLowerCase() !== "lax" || attributes.get("path") !== "/"
    || attributes.has("domain") || !/^\d+$/.test(age) || Number(age) < 1 || Number(age) > MAX_SESSION_SECONDS) return null;
  // Rebuild only the verified session attributes; credentials/tokens never enter JSON.
  return `${SESSION_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

function safeLoginPayload(value: unknown, credentials: Credentials) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (fields.authenticated !== true || !fields.user || typeof fields.user !== "object" || Array.isArray(fields.user)) return null;
  const user = fields.user as Record<string, unknown>;
  if (user.id !== credentials.userId || user.email !== credentials.email || user.role !== "super"
    || user.isGuest !== false || typeof user.nickname !== "string" || !user.nickname || user.nickname.length > 30) return null;
  const safe: Record<string, unknown> = { id: user.id, email: user.email, nickname: user.nickname, isGuest: false, role: "super" };
  for (const name of ["emailVerified", "hasPassword", "passwordSetupRequired"]) {
    if (user[name] !== undefined) {
      if (typeof user[name] !== "boolean") return null;
      safe[name] = user[name];
    }
  }
  if (user.version !== undefined) {
    if (!Number.isInteger(user.version) || Number(user.version) < 0) return null;
    safe.version = user.version;
  }
  return { user: safe, authenticated: true };
}

/** Only anonymous local GET /v1/session responses can cause a real login. */
export function createDzmmLocalSuperBootstrap(options: Options = {}) {
  const environment = options.environment ?? (() => process.env.NODE_ENV);
  const autoLoginEnabled = options.autoLoginEnabled ?? (() => process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN === "1");
  const credentialsFile = options.credentialsFile ?? CREDENTIALS_FILE;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let retryAt = 0;
  let pending: Promise<Response | null> | null = null;

  return async (request: Request, backend: URL, upstream: Response): Promise<Response | null> => {
    if (request.method !== "GET" || !isDzmmLocalSuperRequest(request, environment(), autoLoginEnabled())
      || !trustedBackend(backend) || cookie(request, SESSION_NAME) || optedOut(request)
      || !upstream.ok) return null;
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    if (!/^\/api\/(?:dzmm\/)?backend\/v1\/session$/.test(path)) return null;
    try {
      const session = await upstream.clone().json();
      if (session?.user !== null || session?.authenticated !== false) return null;
    } catch { return null; }
    if (pending) return (await pending)?.clone() ?? null;
    if (now() < retryAt) return null;
    pending = (async () => {
      retryAt = now() + RETRY_DELAY_MS;
      const credentials = await readCredentials(credentialsFile);
      if (!credentials) return null;
      try {
        const response = await fetcher(new URL("/v1/auth/login", backend), {
          method: "POST", cache: "no-store", redirect: "manual",
          headers: { "Content-Type": "application/json", Origin: `${new URL(request.url).protocol}//${request.headers.get("host")}`, "Sec-Fetch-Site": "same-origin" },
          body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) { await response.body?.cancel(); return null; }
        const setCookie = loginCookie(response, request);
        const payload = safeLoginPayload(await response.json(), credentials);
        if (!setCookie || !payload) return null;
        retryAt = 0;
        return Response.json(payload, { headers: {
          "Cache-Control": "private, no-store", "Set-Cookie": setCookie,
          "X-Content-Type-Options": "nosniff", "X-Xumeng-Local-Auth": "super",
        } });
      } catch { return null; }
    })();
    try { return (await pending)?.clone() ?? null; }
    finally { pending = null; }
  };
}

export function dzmmLocalSuperLogoutCookie(request: Request, environment = process.env.NODE_ENV,
  autoLoginEnabled = process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN === "1") {
  if (request.method !== "POST" || !/^\/api\/(?:dzmm\/)?backend\/v1\/auth\/logout\/?$/.test(new URL(request.url).pathname)
    || !isDzmmLocalSuperRequest(request, environment, autoLoginEnabled)) return null;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${OPTOUT_NAME}=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_SESSION_SECONDS}${secure}`;
}
