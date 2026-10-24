import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import bridgeModule from "./bridge";
const { companionRoute, createCompanionBridge } = bridgeModule as typeof import("./bridge");

const first = "b2c5887c-4b50-4c52-8204-1fca94aff749";
const second = "c4c8e6ba-9b46-47d2-916b-3592eb6cafb5";
const request = (path: string, method = "GET", cookie = "", body?: unknown) => new Request(`http://127.0.0.1:3000/api/xumeng/companion/${path}`, {
  method, headers: { host: "127.0.0.1:3000", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
});

test("only explicit companion routes are forwarded", () => {
  assert.equal(companionRoute(["api", "sessions", first, "messages"], "POST")?.kind, "session");
  assert.equal(companionRoute(["api", "sessions", first, "style"], "PUT")?.kind, "session");
  assert.equal(companionRoute(["api", "sessions", first, "style"], "POST"), null);
  assert.equal(companionRoute(["api", "sessions", first, "receipts", second], "GET")?.kind, "receipt");
  assert.equal(companionRoute(["api", "sessions", first, "receipts", "bad"], "GET"), null);
  assert.equal(companionRoute(["api", "sessions", first, "presence"], "POST"), null);
  assert.equal(companionRoute(["api", "sessions", first, "initiative"], "POST"), null);
  assert.equal(companionRoute(["api", "sessions", "..", "secrets"], "GET"), null);
  assert.equal(companionRoute([".env.local"], "GET"), null);
  assert.equal(companionRoute(["api", "sessions", first], "DELETE"), null);
});

test("one native instance has one owner; history stays scoped and messages forward", async () => {
  const directory = await mkdtemp(join(tmpdir(), "companion-bridge-"));
  const calls: string[] = [];
  let createCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method || "GET"} ${path}`);
    assert.equal(new Headers(init?.headers).has("cookie"), false);
    if (path === "/api/health") return Response.json({ runtime: "maibot-native", ready: true, provider: { configured: true } });
    if (path === "/api/sessions" && init?.method === "POST") return Response.json({ session: { id: createCount++ ? second : first } }, { status: 201 });
    if (path === "/api/sessions") return Response.json({ sessions: [{ id: first }, { id: second }] });
    if (path.endsWith("/messages")) {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"message","text":"你好"}\n')); } });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
    }
    return Response.json({ session: { id: first } });
  };
  const bridge = createCompanionBridge({ env: { NODE_ENV: "development", XUMENG_COMPANION_DATA_DIR: directory }, fetcher });
  try {
    const boot = await bridge(request("api/health"), ["api", "health"]);
    const owner = boot.headers.get("set-cookie")!.split(";")[0];
    assert.match(owner, /^xumeng_companion_device=[a-f0-9]{64}$/);
    assert.match(boot.headers.get("set-cookie")!, /HttpOnly/);
    const created = await bridge(request("api/sessions", "POST", owner, { characterId: "nari" }), ["api", "sessions"]);
    assert.equal(created.status, 201);
    const otherBoot = await bridge(request("api/health"), ["api", "health"]);
    const otherOwner = otherBoot.headers.get("set-cookie")!.split(";")[0];
    const otherCreated = await bridge(request("api/sessions", "POST", otherOwner, { characterId: "yume" }), ["api", "sessions"]);
    assert.equal(otherCreated.status, 403);
    const list = await bridge(request("api/sessions", "GET", owner), ["api", "sessions"]);
    assert.deepEqual(await list.json(), { sessions: [{ id: first }] });
    const callsBefore = calls.length;
    assert.equal((await bridge(request(`api/sessions/${first}`, "GET", otherOwner), ["api", "sessions", first])).status, 403);
    assert.equal(calls.length, callsBefore);
    const streamed = await bridge(request(`api/sessions/${first}/messages`, "POST", owner, { text: "你好" }), ["api", "sessions", first, "messages"]);
    assert.match(streamed.headers.get("content-type")!, /ndjson/);
    const reader = streamed.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), '{"type":"message","text":"你好"}\n');
    await reader.cancel();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("public production and cross-site requests fail closed", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
  const production = createCompanionBridge({ env: { NODE_ENV: "production" }, fetcher });
  assert.equal((await production(request("api/health"), ["api", "health"])).status, 503);
  const crossSite = new Request("http://127.0.0.1:3000/api/xumeng/companion/api/health", { headers: { origin: "https://elsewhere.example", host: "127.0.0.1:3000" } });
  assert.equal((await production(crossSite, ["api", "health"])).status, 403);
  const enabled = createCompanionBridge({ env: { NODE_ENV: "production", XUMENG_COMPANION_URL: "http://127.0.0.1:3227", XUMENG_COMPANION_DATA_DIR: "/tmp/unused" }, fetcher });
  assert.equal((await enabled(request("api/health"), ["api", "health"])).status, 401);
  assert.equal(calls, 0);
});

test("account identity is verified server-side and not sent upstream", async () => {
  const calls: string[] = [];
  const bridge = createCompanionBridge({ env: { NODE_ENV: "production", XUMENG_COMPANION_URL: "http://127.0.0.1:3227", XUMENG_COMPANION_DATA_DIR: "/tmp/unused", DZMM_BACKEND_URL: "https://accounts.example" }, fetcher: async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.hostname === "accounts.example") {
      assert.equal(new Headers(init?.headers).get("cookie"), `dzmm_session=${"a".repeat(64)}`);
      return Response.json({ authenticated: true, user: { id: first, isGuest: false } });
    }
    assert.equal(new Headers(init?.headers).has("cookie"), false);
    return Response.json({ runtime: "maibot-native", ready: true, provider: { configured: true } });
  } });
  const response = await bridge(request("api/health", "GET", `dzmm_session=${"a".repeat(64)}`), ["api", "health"]);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/v1/session", "/api/health"]);
});
