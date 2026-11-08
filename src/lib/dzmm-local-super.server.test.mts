import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import localSuperModule from "./dzmm-local-super.server";

const { createDzmmLocalSuperBootstrap, isDzmmLocalSuperRequest, dzmmLocalSuperLogoutCookie } = localSuperModule as typeof import("./dzmm-local-super.server");
const accountId = "11111111-1111-4111-8111-111111111111";
const secret = "fake-test-password-never-production";
const token = "a".repeat(64);
const credentials = { email: "super@xumengchat.top", password: secret, userId: accountId, role: "super" };
const user = { id: accountId, email: credentials.email, nickname: "本地测试管理员", isGuest: false, role: "super", version: 0 };
const productionBackend = new URL("https://dzmm-backend.850587960.workers.dev");
const validCookie = `dzmm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`;

function request(options: { method?: string; path?: string; url?: string; headers?: Record<string, string | null> } = {}) {
  const headers = new Headers({ host: "127.0.0.1:3010", "x-forwarded-host": "127.0.0.1:3010", "x-forwarded-proto": "http",
    "x-forwarded-for": "127.0.0.1", "sec-fetch-site": "same-origin" });
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(name); else headers.set(name, value);
  }
  return new Request(options.url ?? `http://127.0.0.1:3010${options.path ?? "/api/backend/v1/session"}`, { method: options.method ?? "GET", headers });
}
const anonymous = () => Response.json({ user: null, authenticated: false });
const loginResponse = (body: unknown = { user, authenticated: true }, cookie = validCookie, status = 200) =>
  Response.json(body, { status, headers: { "Set-Cookie": cookie } });

async function fixture(t: TestContext, value: unknown = credentials) {
  const directory = await mkdtemp(join(tmpdir(), "xumeng-local-super-test-"));
  const credentialsFile = join(directory, "credentials.json");
  await writeFile(credentialsFile, JSON.stringify(value), { mode: 0o600 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, credentialsFile };
}

test("ordinary development stays disabled unless the server-only automatic login flag is exactly 1", async t => {
  const previous = process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN;
  t.after(() => {
    if (previous === undefined) delete process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN;
    else process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN = previous;
  });
  const { credentialsFile } = await fixture(t);
  let calls = 0;
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", credentialsFile,
    fetcher: async () => { calls++; return loginResponse(); } });
  delete process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN;
  assert.equal(isDzmmLocalSuperRequest(request(), "development"), false);
  assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  for (const value of ["0", "true", "yes", "1 ", ""]) {
    process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN = value;
    assert.equal(isDzmmLocalSuperRequest(request(), "development"), false);
    assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  }
  assert.equal(calls, 0);
  process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN = "1";
  assert.equal(isDzmmLocalSuperRequest(request(), "development"), true);
  assert.equal(isDzmmLocalSuperRequest(request(), "production"), false);
  assert.ok(await bootstrap(request(), productionBackend, anonymous()));
  assert.equal(calls, 1);
  const explicitlyDisabled = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => false,
    credentialsFile, fetcher: async () => { calls++; return loginResponse(); } });
  assert.equal(await explicitlyDisabled(request(), productionBackend, anonymous()), null);
  assert.equal(calls, 1);
});

test("dedicated CLI dry run fixes loopback binding and enables only the server child environment", () => {
  const script = join(process.cwd(), "scripts/xumeng-dev.mjs");
  const env = { ...process.env, NODE_ENV: "production", DZMM_LOCAL_SUPER_AUTO_LOGIN: "0", DZMM_BACKEND_URL: "" };
  const plan = JSON.parse(execFileSync(process.execPath, [script, "--dry-run"], { env, encoding: "utf8" }));
  assert.deepEqual(plan.args.slice(1), ["dev", "--hostname", "127.0.0.1", "--port", "3010"]);
  assert.ok(plan.args[0].endsWith("/node_modules/next/dist/bin/next"));
  assert.equal(plan.cwd, process.cwd());
  assert.deepEqual(plan.environment, { NODE_ENV: "development", DZMM_LOCAL_SUPER_AUTO_LOGIN: "1", DZMM_BACKEND_URL: productionBackend.origin });
  assert.equal(env.NODE_ENV, "production"); assert.equal(env.DZMM_LOCAL_SUPER_AUTO_LOGIN, "0");
  for (const backend of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
    const localPlan = JSON.parse(execFileSync(process.execPath, [script, "--dry-run"], { env: { ...env, DZMM_BACKEND_URL: backend }, encoding: "utf8" }));
    assert.equal(localPlan.environment.DZMM_BACKEND_URL, backend);
    assert.deepEqual(localPlan.args.slice(1), plan.args.slice(1));
  }
  for (const backend of ["https://evil.example", `https://person:${secret}@dzmm-backend.850587960.workers.dev`, "https://dzmm-backend.850587960.workers.dev/another"]) {
    assert.throws(() => execFileSync(process.execPath, [script, "--dry-run"], {
      env: { ...env, DZMM_BACKEND_URL: backend }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  assert.throws(() => execFileSync(process.execPath, [script, "--hostname", "0.0.0.0"], { env, stdio: ["ignore", "pipe", "pipe"] }));
});

test("development is required and URL, Host, peer forwarding and origin must all be loopback", () => {
  assert.equal(isDzmmLocalSuperRequest(request(), "development", true), true);
  for (const environment of ["production", "test", "", undefined]) assert.equal(isDzmmLocalSuperRequest(request(), environment, true), false);
  for (const options of [
    { url: "https://xumengchat.top/api/backend/v1/session" },
    { headers: { host: "xumengchat.top", "x-forwarded-host": "xumengchat.top" } },
    { headers: { host: "127.0.0.1:9999", "x-forwarded-host": "127.0.0.1:9999" } },
    { headers: { host: "user@127.0.0.1:3010", "x-forwarded-host": "user@127.0.0.1:3010" } },
    { headers: { host: "127.0.0.1:3010/elsewhere", "x-forwarded-host": "127.0.0.1:3010/elsewhere" } },
    { headers: { host: null } }, { headers: { "x-forwarded-for": null } },
    { headers: { "x-forwarded-for": "203.0.113.1" } }, { headers: { "x-forwarded-for": "127.0.0.1, 203.0.113.1" } },
    { headers: { "x-forwarded-host": "evil.example" } }, { headers: { "x-forwarded-proto": "https" } },
    { headers: { origin: "https://evil.example" } }, { headers: { origin: "http://localhost:3010" } },
    { headers: { "sec-fetch-site": "cross-site" } }, { headers: { "sec-fetch-site": "same-site" } },
  ]) assert.equal(isDzmmLocalSuperRequest(request(options), "development", true), false, JSON.stringify(options));
  assert.equal(isDzmmLocalSuperRequest(request({ url: "http://localhost:3010/api/backend/v1/session", headers: { host: "localhost:3010", "x-forwarded-host": "localhost:3010", origin: "http://localhost:3010" } }), "development", true), true);
  assert.equal(isDzmmLocalSuperRequest(request({ url: "http://[::1]:3010/api/backend/v1/session", headers: { host: "[::1]:3010", "x-forwarded-host": "[::1]:3010", "x-forwarded-for": "::1" } }), "development", true), true);
  assert.equal(isDzmmLocalSuperRequest(request({ headers: { "x-forwarded-for": "::ffff:127.0.0.1" } }), "development", true), true);
  // Next can normalize its URL to localhost while preserving browser authority.
  assert.equal(isDzmmLocalSuperRequest(request({ url: "http://localhost:3010/api/dzmm/backend/v1/session" }), "development", true), true);
});

test("only the explicit development backend and our exact HTTPS Worker can receive credentials", async t => {
  const { credentialsFile } = await fixture(t);
  const calls: string[] = [];
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile,
    fetcher: async input => { calls.push(String(input)); return loginResponse(); } });
  for (const url of ["https://evil.example", "https://dzmm-backend.850587960.workers.dev.evil.example",
    "http://dzmm-backend.850587960.workers.dev", "https://dzmm-backend.850587960.workers.dev:444",
    "https://dzmm-backend.850587960.workers.dev/another", "https://user:pass@dzmm-backend.850587960.workers.dev",
    "https://dzmm-backend.850587960.workers.dev/?target=evil", "https://dzmm-backend.850587960.workers.dev/#evil"]) {
    assert.equal(await bootstrap(request(), new URL(url), anonymous()), null);
  }
  assert.deepEqual(calls, []);
  for (const url of [productionBackend.href, "http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
    assert.ok(await bootstrap(request(), new URL(url), anonymous()));
  }
  assert.equal(calls.length, 4);
});

test("bootstrap calls real login protocol and returns only a verified safe Super session and local HttpOnly cookie", async t => {
  const { credentialsFile } = await fixture(t);
  const calls: Array<[string, RequestInit | undefined]> = [];
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile,
    fetcher: async (input, init) => { calls.push([String(input), init]); return loginResponse({ user: { ...user, password: secret, token_hash: "should-not-return" }, authenticated: true, credentials }); } });
  const upstream = anonymous();
  const response = await bootstrap(request(), productionBackend, upstream);
  assert.ok(response);
  assert.deepEqual(await response.json(), { user, authenticated: true });
  assert.deepEqual(await upstream.json(), { user: null, authenticated: false }, "upstream body remains readable");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `${productionBackend.origin}/v1/auth/login`);
  const init = calls[0][1]!;
  assert.equal(init.method, "POST"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "manual");
  assert.deepEqual(JSON.parse(init.body as string), { email: credentials.email, password: secret });
  assert.equal(new Headers(init.headers).get("origin"), "http://127.0.0.1:3010");
  assert.ok(init.signal instanceof AbortSignal);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0], validCookie.replace("; Secure", ""));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-xumeng-local-auth"), "super");
});

test("HTTPS local preview preserves Secure and never obtains a domain-scoped cookie", async t => {
  const { credentialsFile } = await fixture(t);
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => loginResponse() });
  const response = await bootstrap(request({ url: "https://127.0.0.1:3010/api/backend/v1/session", headers: { "x-forwarded-proto": "https" } }), productionBackend, anonymous());
  assert.equal(response?.headers.getSetCookie()[0], validCookie);
});

test("all existing sessions, cookies and explicit logout optout are preserved without login", async t => {
  const { credentialsFile } = await fixture(t);
  let calls = 0;
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => { calls++; return loginResponse(); } });
  for (const body of [{ user, authenticated: true }, { user: { id: "guest", isGuest: true, role: "user" }, authenticated: false },
    { user: { ...user, role: "user" }, authenticated: true }, { user: null, authenticated: true }, { authenticated: false }]) {
    const upstream = Response.json(body);
    assert.equal(await bootstrap(request(), productionBackend, upstream), null);
    assert.deepEqual(await upstream.json(), body);
  }
  for (const value of [`dzmm_session=${token}`, "dzmm_session=expired-cookie", "dzmm_local_super_optout=1", `another=x; dzmm_local_super_optout=1`, "dzmm_local_super_optout=0; dzmm_local_super_optout=1"]) {
    assert.equal(await bootstrap(request({ headers: { cookie: value } }), productionBackend, anonymous()), null);
  }
  assert.equal(calls, 0);
});

test("only anonymous successful GET session responses can bootstrap; no state or other endpoints are read", async t => {
  const { credentialsFile } = await fixture(t);
  let calls = 0;
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => { calls++; return loginResponse(); } });
  for (const path of ["/api/backend/v1/state", "/api/backend/v1/auth/guest", "/api/backend/v1/session/more", "/api/elsewhere/v1/session"]) {
    assert.equal(await bootstrap(request({ path }), productionBackend, anonymous()), null);
  }
  assert.equal(await bootstrap(request({ method: "POST" }), productionBackend, anonymous()), null);
  assert.equal(await bootstrap(request(), productionBackend, Response.json({ user: null, authenticated: false }, { status: 503 })), null);
  assert.equal(await bootstrap(request(), productionBackend, new Response("broken json")), null);
  assert.equal(calls, 0);
  assert.ok(await bootstrap(request({ path: "/api/dzmm/backend/v1/session" }), productionBackend, anonymous()));
  assert.equal(calls, 1);
});

test("unsafe file permissions, malformed identity, missing files and symlinks never release credentials", async t => {
  const { directory, credentialsFile } = await fixture(t);
  let calls = 0;
  const create = (path = credentialsFile) => createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile: path,
    fetcher: async () => { calls++; return loginResponse(); } });
  for (const mode of [0o644, 0o400, 0o666, 0o1600]) {
    await chmod(credentialsFile, mode);
    assert.equal(await create()(request(), productionBackend, anonymous()), null);
  }
  await chmod(credentialsFile, 0o600);
  const alias = join(directory, "alias.json");
  await symlink(credentialsFile, alias);
  assert.equal(await create(alias)(request(), productionBackend, anonymous()), null);
  assert.equal(await create(join(directory, "missing.json"))(request(), productionBackend, anonymous()), null);
  for (const value of [null, [], { ...credentials, email: "another@example.com" }, { ...credentials, role: "user" },
    { ...credentials, userId: "bad-id" }, { ...credentials, password: "short" }, { ...credentials, password: `valid-password\0bad` },
    { ...credentials, password: "x".repeat(257) }, { ...credentials, nickname: "x".repeat(17_000) }]) {
    await writeFile(credentialsFile, JSON.stringify(value));
    assert.equal(await create()(request(), productionBackend, anonymous()), null);
  }
  await writeFile(credentialsFile, "invalid json");
  assert.equal(await create()(request(), productionBackend, anonymous()), null);
  assert.equal(calls, 0);
});

test("login identity mismatches and malformed session flags cannot replace the anonymous response", async t => {
  const { credentialsFile } = await fixture(t);
  for (const body of [{ user: null, authenticated: true }, { user, authenticated: false }, { user, authenticated: "true" },
    { user: { ...user, id: "22222222-2222-4222-8222-222222222222" }, authenticated: true },
    { user: { ...user, email: "another@example.com" }, authenticated: true },
    { user: { ...user, role: "user" }, authenticated: true }, { user: { ...user, isGuest: true }, authenticated: true },
    { user: { ...user, nickname: "" }, authenticated: true }, { user: { ...user, version: -1 }, authenticated: true },
    { user: { ...user, passwordSetupRequired: "false" }, authenticated: true }]) {
    const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => loginResponse(body) });
    assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  }
});

test("unverified, cross-domain, unbounded or duplicate session cookies cannot bootstrap", async t => {
  const { credentialsFile } = await fixture(t);
  for (const value of [validCookie.replace(token, "invalid"), validCookie.replace("; HttpOnly", ""), validCookie.replace("Lax", "None"),
    validCookie.replace("Path=/", "Path=/admin"), `${validCookie}; Domain=xumengchat.top`, validCookie.replace("2592000", "0"),
    validCookie.replace("2592000", "999999999"), validCookie.replace("2592000", "NaN"), validCookie.replace("dzmm_session=", "other=")]) {
    const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => loginResponse(undefined, value) });
    assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  }
  const response = loginResponse(); response.headers.append("Set-Cookie", validCookie);
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => response });
  assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
});

test("redirects, bad JSON and network failures fall back, without following or returning sensitive errors", async t => {
  const { credentialsFile } = await fixture(t);
  for (const result of [new Response(null, { status: 302, headers: { Location: "https://evil.example", "Set-Cookie": validCookie } }),
    Response.json({ error: `${secret}: rejected` }, { status: 401 }), new Response(secret)]) {
    let calls = 0;
    const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async (_input, init) => {
      calls++; assert.equal(init?.redirect, "manual"); return result;
    } });
    assert.equal(await bootstrap(request(), productionBackend, anonymous()), null); assert.equal(calls, 1);
  }
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile,
    fetcher: async () => { throw new Error(secret); } });
  assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
});

test("failed automatic login has a bounded cooldown rather than retrying on every refresh", async t => {
  const { credentialsFile } = await fixture(t);
  let now = 1_000, calls = 0;
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, now: () => now,
    fetcher: async () => { calls++; return loginResponse({ error: "bad password" }, validCookie, 401); } });
  assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  for (let i = 0; i < 5; i++) assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  assert.equal(calls, 1);
  now += 60_000;
  assert.equal(await bootstrap(request(), productionBackend, anonymous()), null);
  assert.equal(calls, 2);
});

test("parallel anonymous session checks reuse one in-flight login and both receive safe Super cookies", async t => {
  const { credentialsFile } = await fixture(t);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = Promise.withResolvers<void>();
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => {
    calls++; started.resolve(); await gate; return loginResponse();
  } });
  const first = bootstrap(request(), productionBackend, anonymous());
  await started.promise;
  const second = bootstrap(request(), productionBackend, anonymous());
  release();
  const responses = await Promise.all([first, second]);
  assert.equal(calls, 1);
  for (const response of responses) {
    assert.ok(response); assert.deepEqual(await response.json(), { user, authenticated: true });
    assert.equal(response.headers.getSetCookie()[0], validCookie.replace("; Secure", ""));
  }
});

test("successful local logout marks a persistent HttpOnly optout that suppresses default login", async t => {
  const logout = request({ path: "/api/backend/v1/auth/logout", method: "POST" });
  const value = dzmmLocalSuperLogoutCookie(logout, "development", true);
  assert.equal(value, "dzmm_local_super_optout=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000");
  assert.equal(dzmmLocalSuperLogoutCookie(logout, "production", true), null);
  assert.equal(dzmmLocalSuperLogoutCookie(request(), "development", true), null);
  assert.equal(dzmmLocalSuperLogoutCookie(request({ method: "POST", path: "/api/backend/v1/auth/login" }), "development", true), null);
  const { credentialsFile } = await fixture(t);
  let calls = 0;
  const bootstrap = createDzmmLocalSuperBootstrap({ environment: () => "development", autoLoginEnabled: () => true, credentialsFile, fetcher: async () => { calls++; return loginResponse(); } });
  assert.equal(await bootstrap(request({ headers: { cookie: value!.split(";")[0] } }), productionBackend, anonymous()), null);
  assert.equal(calls, 0);
});

test("Next proxy preserves existing sessions, adds optout only to successful local logout, and never bootstraps production or remote hosts", async t => {
  const priorEnvironment = process.env.NODE_ENV;
  const priorBackend = process.env.DZMM_BACKEND_URL;
  const priorAutoLogin = process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN;
  t.after(() => {
    if (priorEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorEnvironment;
    if (priorBackend === undefined) delete process.env.DZMM_BACKEND_URL; else process.env.DZMM_BACKEND_URL = priorBackend;
    if (priorAutoLogin === undefined) delete process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN; else process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN = priorAutoLogin;
  });
  process.env.DZMM_BACKEND_URL = productionBackend.origin;
  process.env.DZMM_LOCAL_SUPER_AUTO_LOGIN = "1";
  let upstream = loginResponse();
  const calls: Array<[string, RequestInit | undefined]> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init]); return upstream.clone();
  });
  const { NextRequest } = await import("next/server.js");
  const route = await import("../app/api/dzmm/backend/[[...path]]/route");
  const proxy = (route.default ?? route) as unknown as { GET: (r: InstanceType<typeof NextRequest>, c: { params: Promise<{ path: string[] }> }) => Promise<Response>; POST: (r: InstanceType<typeof NextRequest>, c: { params: Promise<{ path: string[] }> }) => Promise<Response> };
  const context = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

  process.env.NODE_ENV = "development";
  const existing = request({ path: "/api/dzmm/backend/v1/session", headers: { cookie: `dzmm_session=${token}` } });
  const existingResponse = await proxy.GET(new NextRequest(existing), context("v1/session"));
  assert.deepEqual(await existingResponse.json(), { user, authenticated: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `${productionBackend.origin}/v1/session`);
  assert.equal(new Headers(calls[0][1]?.headers).get("cookie"), `dzmm_session=${token}`);

  for (const environment of ["production", "test"]) {
    process.env.NODE_ENV = environment;
    upstream = anonymous();
    const response = await proxy.GET(new NextRequest(request()), context("v1/session"));
    assert.deepEqual(await response.json(), { user: null, authenticated: false });
    assert.equal(response.headers.get("x-xumeng-local-auth"), null);
  }
  process.env.NODE_ENV = "development";
  upstream = anonymous();
  const remote = request({ url: "https://xumengchat.top/api/backend/v1/session", headers: { host: "xumengchat.top", "x-forwarded-host": "xumengchat.top", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.1" } });
  assert.deepEqual(await (await proxy.GET(new NextRequest(remote), context("v1/session"))).json(), { user: null, authenticated: false });
  assert.ok(calls.every(([path]) => path.endsWith("/v1/session")), "no login or private state request occurred");

  upstream = Response.json({ user: null, authenticated: false }, { headers: { "Set-Cookie": "dzmm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure" } });
  const logout = request({ method: "POST", path: "/api/backend/v1/auth/logout" });
  const logoutResponse = await proxy.POST(new NextRequest(logout), context("v1/auth/logout"));
  assert.equal(logoutResponse.headers.getSetCookie().length, 2);
  assert.ok(logoutResponse.headers.getSetCookie().some(value => value.startsWith("dzmm_local_super_optout=1; HttpOnly")));
  upstream = Response.json({ error: "unavailable" }, { status: 503 });
  const failed = await proxy.POST(new NextRequest(logout), context("v1/auth/logout"));
  assert.equal(failed.headers.getSetCookie().length, 0);
  process.env.NODE_ENV = "production";
  upstream = Response.json({ user: null, authenticated: false });
  const productionLogout = await proxy.POST(new NextRequest(logout), context("v1/auth/logout"));
  assert.equal(productionLogout.headers.getSetCookie().length, 0);
});
