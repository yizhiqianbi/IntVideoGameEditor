import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/worker";
import { require as tsxRequire } from "tsx/cjs/api";
import { fileURLToPath } from "node:url";
const { fetchRequest } = tsxRequire(fileURLToPath(new URL("../src/worker.ts", import.meta.url)), import.meta.url) as typeof import("../src/worker");

const ORIGIN = "https://xumengchat.top";
const WEBHOOK = `${ORIGIN}/api/payments/nowpayments/ipn`;
const SIGNATURE = "ab".repeat(64);
function environment(backend: Env["BACKEND"]["fetch"]): Env {
  return { ASSETS: { fetch: async () => { throw new Error("Unexpected page shell"); } }, BACKEND: { fetch: backend },
    CHAT_RATE_LIMITER: { limit: async () => { throw new Error("Unexpected model request"); } } };
}
test("NOWPayments gateway forwards exact signed bytes without browser credentials or upstream cookies", async () => {
  const bytes = new TextEncoder().encode('{ "order_id": "np_fixture", "payment_status": "waiting", "label": "叙梦" }\n');
  let calls = 0;
  const response = await fetchRequest(new Request(WEBHOOK, { method: "POST", body: bytes, headers: {
    "Content-Type": "application/json; charset=utf-8", "X-Nowpayments-Sig": SIGNATURE, Cookie: "dzmm_session=isolated",
    Authorization: "Bearer never-forward", Origin: "https://nowpayments.io",
  } }), environment(async input => {
    calls++;
    const request = input as Request;
    assert.equal(request.url, "https://dzmm-backend.850587960.workers.dev/v1/payments/nowpayments/ipn");
    assert.equal(request.headers.get("X-Nowpayments-Sig"), SIGNATURE);
    assert.equal(request.headers.get("Cookie"), null); assert.equal(request.headers.get("Authorization"), null);
    assert.equal(request.headers.get("Origin"), null); assert.equal(request.redirect, "manual");
    assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
    return Response.json({ received: true }, { headers: { "Set-Cookie": "ignored=private", "Access-Control-Allow-Origin": "*" } });
  }));
  assert.equal(calls, 1); assert.equal(response.status, 200); assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null); assert.equal(response.headers.get("Cache-Control"), "no-store");
});
test("NOWPayments gateway validates method, signature, content type and bounded streamed body before backend", async () => {
  const env = environment(async () => { throw new Error("Invalid callback reached backend"); });
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
    const response = await fetchRequest(new Request(WEBHOOK, { method }), env);
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), "POST");
  }
  for (const signature of ["", "xy".repeat(64), "a".repeat(127), "a".repeat(129)]) {
    assert.equal((await fetchRequest(new Request(WEBHOOK, { method: "POST", body: "{}", headers: {
      "Content-Type": "application/json", "X-Nowpayments-Sig": signature,
    } }), env)).status, 400);
  }
  assert.equal((await fetchRequest(new Request(WEBHOOK, { method: "POST", body: "{}", headers: {
    "Content-Type": "text/plain", "X-Nowpayments-Sig": SIGNATURE,
  } }), env)).status, 415);
  for (const declared of [false, true]) {
    assert.equal((await fetchRequest(new Request(WEBHOOK, { method: "POST", body: new Uint8Array(256 * 1024 + 1), headers: {
      "Content-Type": "application/json", "X-Nowpayments-Sig": SIGNATURE,
      ...(declared ? { "Content-Length": String(256 * 1024 + 1) } : {}),
    } }), env)).status, 413);
  }
});
test("only exact NOWPayments IPN bypasses browser origin and upstream redirect cannot become a cashier", async () => {
  const env = environment(async () => new Response(null, { status: 302, headers: { Location: "https://evil.invalid/" } }));
  const result = await fetchRequest(new Request(WEBHOOK, { method: "POST", body: "{}", headers: {
    "Content-Type": "application/json", "X-Nowpayments-Sig": SIGNATURE,
  } }), env);
  assert.equal(result.status, 502); assert.equal(result.headers.get("Location"), null);
  for (const path of ["/api/payments/nowpayments/ipn/", "/api/payments/nowpayments/ipn/checkout", "/api/backend/v1/payments/nowpayments/ipn", "/api/backend/v1/subscriptions/nowpayments/checkout"]) {
    assert.equal((await fetchRequest(new Request(`${ORIGIN}${path}`, { method: "POST", body: "{}", headers: {
      Origin: "https://nowpayments.io", "Content-Type": "application/json", "X-Nowpayments-Sig": SIGNATURE,
    } }), env)).status, 403);
  }
});
