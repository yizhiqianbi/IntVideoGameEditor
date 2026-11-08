import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const origin = "https://xumengchat.top";
const owner = "4c7c7b4e-5c9b-451c-98f9-632dc4f65212";
const session = "a86b6c7b-31d7-45e5-9b62-956fbcb8a9d7";
const requestId = "ccbd840f-0130-46e0-a41a-2b488476f530";
const cookie = "dzmm_session=" + "a".repeat(64);
function environment(role = "super", isGuest = false) {
  const calls = { auth: 0, assets: 0 };
  const env = {
    ASSETS: { fetch: async () => { calls.assets++; throw new Error("Companion API must not return the SPA shell"); } },
    BACKEND: { fetch: async (input: RequestInfo | URL) => {
      calls.auth++;
      assert.equal((input as Request).url, "https://dzmm-backend.850587960.workers.dev/v1/session");
      return Response.json({ authenticated: !isGuest, user: { id: owner, role, isGuest } });
    } },
  } as Env;
  return { env, calls };
}

function request(path: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/xumeng/companion/api/${path}`, {
    method, headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(value) } : {}),
  });
}

test("formal companion entry requires authenticated account before checking service readiness", async () => {
  const { env, calls } = environment();
  const result = await fetchRequest(new Request(`${origin}/api/xumeng/companion/api/health`), env);
  assert.equal(result.status, 401);
  assert.equal((await result.json() as { code: string }).code, "LOGIN_REQUIRED");
  assert.equal(calls.auth, 0); assert.equal(calls.assets, 0);
  assert.equal((await fetchRequest(request("health"), environment("admin").env)).status, 403);
  assert.equal((await fetchRequest(request("health"), environment("super", true).env)).status, 401);
});

test("authenticated companion requests report missing binding without accepting or fabricating content", async () => {
  const { env, calls } = environment();
  for (const [path, method, value] of [["health", "GET"], ["sessions", "GET"], [`sessions/${session}`, "GET"],
    ["sessions", "POST", { characterId: "yume" }], [`sessions/${session}/messages`, "POST", { text: "原创问候", requestId }]] as const) {
    const result = await fetchRequest(request(path, method, value), env);
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await result.json(), { ready: false, error: "女友聊天服务尚未连接，请稍后再试。", code: "COMPANION_UNAVAILABLE" });
  }
  assert.equal(calls.auth, 5); assert.equal(calls.assets, 0);
});

test("companion mutations retain cross-origin protection", async () => {
  const { env, calls } = environment();
  const result = await fetchRequest(new Request(`${origin}/api/xumeng/companion/api/sessions`, {
    method: "POST", headers: { Origin: "https://other.example" },
  }), env);
  assert.equal(result.status, 403); assert.equal(calls.auth, 0); assert.equal(calls.assets, 0);
});

test("formal companion dispatch enforces gateway routing and passes actual private readiness", async () => {
  const { env, calls } = environment("user");
  let delegated = 0;
  env.COMPANION = { fetch: async input => {
    delegated++;
    const forwarded = input as Request;
    assert.equal(forwarded.url, "https://companion.internal/api/health");
    assert.equal(forwarded.headers.get("X-Xumeng-Account-Id"), owner);
    assert.equal(forwarded.headers.get("Cookie"), null);
    return Response.json({ ready: false, runtime: "isolated-test", reason: "starting" });
  } };
  const result = await fetchRequest(request("health", "GET", undefined, { "X-Xumeng-Account-Id": "forged" }), env);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ready: false, runtime: "isolated-test", reason: "starting" });
  for (const path of ["unknown", "sessions/not-a-uuid", "health?owner=other"]) {
    assert.equal((await fetchRequest(request(path), env)).status, 404);
  }
  assert.equal((await fetchRequest(request("health", "POST", {}), env)).status, 405);
  assert.equal(delegated, 1); assert.equal(calls.auth, 1); assert.equal(calls.assets, 0);
});

test("standalone girlfriend page opens the chat child route", async () => {
  const { env, calls } = environment();
  for (const method of ["GET", "HEAD"]) {
    const result = await fetchRequest(new Request(`${origin}/xumeng/girlfriend/?old=true`, { method }), env);
    assert.equal(result.status, 302);
    assert.equal(result.headers.get("Location"), `${origin}/#chat/girlfriend`);
    assert.equal(result.headers.get("Cache-Control"), "no-store"); assert.equal(await result.text(), "");
  }
  assert.equal((await fetchRequest(new Request(`${origin}/xumeng/girlfriend`, { method: "POST" }), env)).status, 405);
  assert.equal(calls.auth, 0); assert.equal(calls.assets, 0);
});
