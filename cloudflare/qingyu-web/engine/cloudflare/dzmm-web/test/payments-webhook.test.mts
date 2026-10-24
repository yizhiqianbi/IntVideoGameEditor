import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://xumengchat.top";
const WEBHOOK = `${ORIGIN}/api/payments/stripe/webhook`;
function environment(backend: Env["BACKEND"]["fetch"]): Env {
  return {
    ASSETS: { fetch: async () => { throw new Error("Unexpected page shell"); } },
    BACKEND: { fetch: backend },
    CHAT_RATE_LIMITER: { limit: async () => { throw new Error("Unexpected model request"); } },
  };
}

test("Stripe callback preserves signature and raw UTF-8 bytes without forwarding browser credentials", async () => {
  const raw = new TextEncoder().encode('{ "id": "evt_test", "message": "叙梦", "paid": true }\n');
  let calls = 0;
  const env = environment(async (input) => {
    calls++;
    const upstream = input as Request;
    assert.equal(upstream.url, "https://dzmm-backend.850587960.workers.dev/v1/payments/webhook");
    assert.equal(upstream.headers.get("Stripe-Signature"), "t=123,v1=test-signature");
    assert.equal(upstream.headers.get("Content-Type"), "application/json");
    assert.equal(upstream.headers.get("Cookie"), null);
    assert.equal(upstream.headers.get("Origin"), null);
    assert.equal(upstream.headers.get("Authorization"), null);
    assert.deepEqual(new Uint8Array(await upstream.arrayBuffer()), raw);
    return Response.json({ received: true }, { headers: { "Set-Cookie": "private=ignored" } });
  });
  const result = await fetchRequest(new Request(WEBHOOK, {
    method: "POST", body: raw,
    headers: { "Content-Type": "application/json; charset=utf-8", "Stripe-Signature": "t=123,v1=test-signature",
      Cookie: "dzmm_session=browser-secret", Authorization: "Bearer never-forward", Origin: "https://stripe.com" },
  }), env);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { received: true });
  assert.equal(result.headers.get("Set-Cookie"), null);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 1);
});

test("callback method, signature, content type and payload limits fail before invoking the backend", async () => {
  const env = environment(async () => { throw new Error("Invalid callback reached backend"); });
  const goodHeaders = { "Content-Type": "application/json", "Stripe-Signature": "t=123,v1=signature" };
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
    const result = await fetchRequest(new Request(WEBHOOK, { method }), env);
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("Allow"), "POST");
  }
  const unsigned = await fetchRequest(new Request(WEBHOOK, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }), env);
  assert.equal(unsigned.status, 400);
  const badType = await fetchRequest(new Request(WEBHOOK, { method: "POST", body: "{}", headers: { ...goodHeaders, "Content-Type": "text/plain" } }), env);
  assert.equal(badType.status, 415);
  for (const declared of [false, true]) {
    const result = await fetchRequest(new Request(WEBHOOK, { method: "POST", body: new Uint8Array(256 * 1024 + 1),
      headers: { ...goodHeaders, ...(declared ? { "Content-Length": String(256 * 1024 + 1) } : {}) },
    }), env);
    assert.equal(result.status, 413);
  }
});

test("only the exact callback route bypasses browser-origin checks and upstream redirects are rejected", async () => {
  const env = environment(async () => new Response(null, { status: 302, headers: { Location: "https://example.invalid/" } }));
  const callback = await fetchRequest(new Request(WEBHOOK, { method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", "Stripe-Signature": "t=123,v1=signature" },
  }), env);
  assert.equal(callback.status, 502);
  assert.equal(callback.headers.get("Location"), null);
  for (const path of ["/api/backend/v1/payments/checkout", "/api/backend/v1/payments/webhook", "/api/payments/stripe/webhook/", "/api/payments/stripe/webhook/checkout"]) {
    const result = await fetchRequest(new Request(`${ORIGIN}${path}`, { method: "POST", body: "{}", headers: {
      Origin: "https://stripe.com", "Content-Type": "application/json", "Stripe-Signature": "t=123,v1=signature",
    } }), env);
    assert.equal(result.status, 403);
  }
});
