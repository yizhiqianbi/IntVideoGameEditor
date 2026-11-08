import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://xumeng.example";
const PATH = "/api/backend/v1/telegram/feedback/webhook";
const SECRET = "synthetic_callback_secret_123456";
function env(fetch: (request: Request) => Promise<Response>): Env {
  return { ASSETS: { fetch: async () => { throw new Error("No SPA for API"); } },
    BACKEND: { fetch: async input => fetch(input as Request) },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
}
function callback(overrides: RequestInit = {}, path = PATH) {
  return new Request(`${ORIGIN}${path}`, { method: "POST", body: '{"update_id":1}', ...overrides,
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET,
      ...Object.fromEntries(new Headers(overrides.headers)) } });
}
test("Telegram callback bypasses only browser-origin check and forwards only its own secret", async () => {
  let calls = 0;
  const response = await fetchRequest(callback({ headers: { Origin: "https://foreign.example", Cookie: "dzmm_session=private", Authorization: "private", "Sec-Fetch-Site": "cross-site" } }), env(async request => {
    calls++;
    assert.equal(request.url, "https://dzmm-backend.850587960.workers.dev/v1/telegram/feedback/webhook");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), SECRET);
    assert.equal(request.headers.get("Cookie"), null);
    assert.equal(request.headers.get("Origin"), null);
    assert.equal(request.headers.get("Authorization"), null);
    assert.equal(await request.text(), '{"update_id":1}');
    return Response.json({ ok: true }, { headers: { "Set-Cookie": "private", "Access-Control-Allow-Origin": "*" } });
  }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
test("callback rejects wrong methods, missing secrets, non-JSON, declared and streamed oversized payloads", async () => {
  let calls = 0;
  const binding = env(async () => { calls++; return Response.json({ ok: true }); });
  const cases: [Request, number][] = [
    [new Request(`${ORIGIN}${PATH}`), 405],
    [callback({ headers: { "X-Telegram-Bot-Api-Secret-Token": "" } }), 401],
    [callback({ headers: { "X-Telegram-Bot-Api-Secret-Token": "a".repeat(257) } }), 401],
    [callback({ headers: { "Content-Type": "text/plain" } }), 415],
    [callback({ headers: { "Content-Length": "262145" } }), 413],
    [callback({ body: new Uint8Array(262145) }), 413],
  ];
  for (const [request, status] of cases) assert.equal((await fetchRequest(request, binding)).status, status);
  assert.equal(calls, 0);
});
test("non-exact paths retain origin protection and regular account proxies discard Telegram secrets", async () => {
  let calls = 0;
  const binding = env(async request => { calls++; assert.equal(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), null); return Response.json({}); });
  for (const path of [`${PATH}/`, "/api/dzmm/backend/v1/telegram/feedback/webhook", "/api/backend/v1/admin/feedback", "/api/backend/v1/auth/guest"]) {
    assert.equal((await fetchRequest(callback({}, path), binding)).status, 403);
  }
  assert.equal(calls, 0);
  assert.equal((await fetchRequest(callback({ headers: { Origin: ORIGIN } }, "/api/backend/v1/admin/feedback"), binding)).status, 200);
  assert.equal(calls, 1);
});
test("callback keeps retry errors and rejects redirects without leaking binding failures", async () => {
  for (const status of [401, 503]) assert.equal((await fetchRequest(callback(), env(async () => Response.json({ error: "test" }, { status })))).status, status);
  const redirected = await fetchRequest(callback(), env(async () => new Response(null, { status: 302, headers: { Location: "https://foreign.example" } })));
  assert.equal(redirected.status, 502); assert.equal(redirected.headers.get("Location"), null);
  const failed = await fetchRequest(callback(), env(async () => { throw new Error(SECRET); }));
  assert.equal(failed.status, 503); assert.equal((await failed.text()).includes(SECRET), false);
});
