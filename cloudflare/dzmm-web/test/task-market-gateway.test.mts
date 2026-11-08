import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const origin = "https://xumengchat.top";
function environment(fetch: (request: Request) => Promise<Response>): Env {
  return { ASSETS: { fetch: async () => new Response("unused") }, BACKEND: { fetch }, CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) } } as Env;
}

test("task marketplace mutations preserve account body and session through the same-origin backend gateway", async () => {
  const body = { accountId: "ordinary-fixture", version: 2, decision: "approved" };
  let calls = 0;
  const env = environment(async request => {
    calls++;
    const url = new URL(request.url);
    assert.equal(url.pathname, "/v1/task-market/11111111-1111-4111-8111-111111111111/review");
    assert.equal(request.headers.get("Origin"), url.origin);
    assert.equal(request.headers.get("Cookie"), "dzmm_session=fixture-session");
    assert.deepEqual(await request.json(), body);
    return Response.json({ accountId: body.accountId, task: { status: "open" } });
  });
  const response = await fetchRequest(new Request(`${origin}/api/backend/v1/task-market/11111111-1111-4111-8111-111111111111/review`, {
    method: "POST", headers: { Origin: origin, Cookie: "other=ignored; dzmm_session=fixture-session", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { accountId: body.accountId, task: { status: "open" } });
});

test("task marketplace refuses browser cross-origin mutations before any backend request", async () => {
  let calls = 0;
  const env = environment(async () => { calls++; return Response.json({}); });
  for (const supplied of [undefined, "null", "https://other.example"]) {
    const response = await fetchRequest(new Request(`${origin}/api/backend/v1/task-market`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(supplied ? { Origin: supplied } : {}) }, body: "{}",
    }), env);
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);
});
