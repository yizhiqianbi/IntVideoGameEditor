import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://xumengchat.top";
const ORDER = "zp_8c43d1a7-a6e3-47c2-928b-22d1660f2d24";
const SUBSCRIPTION_ORDER = "sp_8c43d1a7-a6e3-47c2-928b-22d1660f2d24";
function environment(backend: Env["BACKEND"]["fetch"]): Env {
  return {
    ASSETS: { fetch: async () => { throw new Error("Unexpected page shell"); } },
    BACKEND: { fetch: backend },
    CHAT_RATE_LIMITER: { limit: async () => { throw new Error("Unexpected model request"); } },
  };
}

test("Z-Pay GET callbacks preserve signed query bytes and exclude browser credentials", async () => {
  const query = "?name=%E5%8F%99%E6%A2%A6+%E9%A2%9D%E5%BA%A6&money=1.00&sign=a&pid=demo&name=duplicate";
  const env = environment(async (input) => {
    const request = input as Request;
    assert.equal(request.url, `https://dzmm-backend.850587960.workers.dev/v1/payments/zpay/notify${query}`);
    assert.equal(request.method, "GET");
    for (const header of ["Cookie", "Authorization", "Origin", "X-Forwarded-Host"]) assert.equal(request.headers.get(header), null);
    // The backend rejects duplicate keys; the gateway must not silently remove
    // one copy before signature verification.
    assert.equal(new URL(request.url).searchParams.getAll("name").length, 2);
    return new Response("success", { headers: { "Set-Cookie": "never=forward" } });
  });
  const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/notify${query}`, {
    headers: { Cookie: "dzmm_session=private", Authorization: "Bearer private", Origin: "https://zpayz.cn" },
  }), env);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "success");
  assert.equal(result.headers.get("Set-Cookie"), null);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(result.headers.get("Referrer-Policy"), "no-referrer");
});

test("only a Z-Pay return may redirect, and only to a clean canonical recharge URL", async () => {
  const location = `${ORIGIN}/?payment_order=${ORDER}&payment=success#recharge`;
  const good = environment(async () => new Response(null, { status: 303, headers: { Location: location, "Set-Cookie": "never=forward" } }));
  const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/return?sign=private`), good);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("Location"), location);
  assert.equal(result.headers.get("Set-Cookie"), null);
  assert.equal(result.headers.get("Referrer-Policy"), "no-referrer");
  for (const invalid of [
    "https://example.invalid/#recharge", `${ORIGIN}/other#recharge`,
    `${ORIGIN}/?key=private#recharge`, `${ORIGIN}/?payment_order=invalid#recharge`,
    `${ORIGIN}/?payment_order=${ORDER}&payment_order=${ORDER}#recharge`,
    `${ORIGIN}/?payment=success&payment=success#recharge`, `${ORIGIN}/?payment=paid#recharge`,
  ]) {
    const env = environment(async () => new Response(null, { status: 303, headers: { Location: invalid } }));
    const rejected = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/return`), env);
    assert.equal(rejected.status, 502, invalid);
    assert.equal(rejected.headers.get("Location"), null);
  }
  assert.equal((await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/notify`), good)).status, 502);
  const paidCheckout = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/checkout/${ORDER}`), good);
  assert.equal(paidCheckout.status, 303);
  assert.equal(paidCheckout.headers.get("Location"), location);
  for (const invalid of [`${ORIGIN}/#recharge`, `${ORIGIN}/?payment_order=zp_11111111-1111-4111-8111-111111111111&payment=success#recharge`]) {
    const env = environment(async () => new Response(null, { status: 303, headers: { Location: invalid } }));
    assert.equal((await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/checkout/${ORDER}`), env)).status, 502);
  }
});

test("Z-Pay checkout preserves only the owning session and security headers", async () => {
  const env = environment(async (input) => {
    const request = input as Request;
    assert.equal(request.url, `https://dzmm-backend.850587960.workers.dev/v1/payments/zpay/checkout/${ORDER}`);
    assert.equal(request.headers.get("Cookie"), "dzmm_session=owner-session");
    assert.equal(request.headers.get("Authorization"), null);
    assert.equal(request.headers.get("Origin"), "https://dzmm-backend.850587960.workers.dev");
    return new Response("<form>checkout</form>", { headers: {
      "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action https://zpayz.cn",
      "Set-Cookie": "never=forward", "Access-Control-Allow-Origin": "https://example.invalid",
    } });
  });
  const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/checkout/${ORDER}`, {
    headers: { Cookie: "other=private; dzmm_session=owner-session", Authorization: "Bearer private" },
  }), env);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "<form>checkout</form>");
  assert.match(result.headers.get("Content-Security-Policy") || "", /form-action https:\/\/zpayz.cn/);
  assert.equal(result.headers.get("Set-Cookie"), null);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), null);
});

test("Z-Pay special routes are GET-only and bound query sizes before forwarding", async () => {
  const env = environment(async () => { throw new Error("Rejected request reached backend"); });
  for (const path of ["notify", "return", `checkout/${ORDER}`]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/${path}`, { method }), env);
      assert.equal(result.status, 405);
      assert.equal(result.headers.get("Allow"), "GET");
    }
    const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/${path}?x=${"x".repeat(8192)}`), env);
    assert.equal(result.status, 413);
  }
});

test("Z-Pay does not weaken origin checks for account mutations or accept near-match routes", async () => {
  const env = environment(async () => { throw new Error("Invalid request reached backend"); });
  for (const path of [
    "/api/backend/v1/payments/checkout", "/api/payments/zpay/notify/",
    "/api/payments/zpay/return/", `/api/payments/zpay/checkout/${ORDER}/`,
  ]) {
    const request = new Request(`${ORIGIN}${path}`, { method: "POST", body: "{}", headers: {
      "Content-Type": "application/json", Origin: "https://zpayz.cn",
    } });
    assert.equal((await fetchRequest(request, env)).status, 403);
  }
  for (const path of ["notify/", "return/", "checkout/invalid"]) {
    assert.equal((await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/${path}`), env)).status, 404);
  }
});

test("subscription callbacks isolate browser credentials while its owned checkout forwards only the session", async () => {
  const base = "/api/payments/zpay/subscription";
  for (const path of [`${base}/notify`, `${base}/return`, `${base}/checkout/${SUBSCRIPTION_ORDER}`]) {
    const checkout = path.includes("/checkout/");
    const env = environment(async input => {
      const request = input as Request;
      assert.equal(request.url, `https://dzmm-backend.850587960.workers.dev${path.replace("/api/", "/v1/")}?name=a+b&sign=not-valid`);
      assert.equal(request.headers.get("Cookie"), checkout ? "dzmm_session=owner" : null);
      assert.equal(request.headers.get("Authorization"), null);
      assert.equal(request.headers.get("Origin"), checkout ? "https://dzmm-backend.850587960.workers.dev" : null);
      return new Response(checkout ? "<form>payment</form>" : "success", { headers: {
        "Set-Cookie": "not=forwarded", "Content-Security-Policy": "default-src 'none'; form-action https://zpayz.cn",
      } });
    });
    const response = await fetchRequest(new Request(`${ORIGIN}${path}?name=a+b&sign=not-valid`, {
      headers: { Cookie: "other=private; dzmm_session=owner", Authorization: "Bearer private", Origin: "https://zpayz.cn" },
    }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(response.headers.has("Content-Security-Policy"), checkout);
  }
});

test("subscription receipts cannot redirect to top-up orders or another subscription checkout", async () => {
  const base = "/api/payments/zpay/subscription";
  const receipt = `${ORIGIN}/?payment_order=${SUBSCRIPTION_ORDER}&payment=success#recharge`;
  const responseFor = (location: string) => environment(async () => new Response(null, { status: 303, headers: { Location: location } }));
  assert.equal((await fetchRequest(new Request(`${ORIGIN}${base}/return`), responseFor(receipt))).status, 303);
  assert.equal((await fetchRequest(new Request(`${ORIGIN}${base}/checkout/${SUBSCRIPTION_ORDER}`), responseFor(receipt))).status, 303);
  assert.equal((await fetchRequest(new Request(`${ORIGIN}${base}/return`), responseFor(`${ORIGIN}/#recharge`))).status, 303);
  for (const invalid of [`${ORIGIN}/?payment_order=${ORDER}&payment=success#recharge`,
    `${ORIGIN}/?payment_order=${SUBSCRIPTION_ORDER}&payment_order=${SUBSCRIPTION_ORDER}&payment=success#recharge`,
    `https://foreign.example/?payment_order=${SUBSCRIPTION_ORDER}&payment=success#recharge`]) {
    assert.equal((await fetchRequest(new Request(`${ORIGIN}${base}/return`), responseFor(invalid))).status, 502);
  }
  const another = `${ORIGIN}/?payment_order=sp_11111111-1111-4111-8111-111111111111&payment=success#recharge`;
  assert.equal((await fetchRequest(new Request(`${ORIGIN}${base}/checkout/${SUBSCRIPTION_ORDER}`), responseFor(another))).status, 502);
  assert.equal((await fetchRequest(new Request(`${ORIGIN}/api/payments/zpay/return`), responseFor(receipt))).status, 502);
  assert.equal((await fetchRequest(new Request(`${ORIGIN}${base}/notify`), responseFor(receipt))).status, 502);
});

test("subscription payment routes remain exact and GET-only while claims retain browser origin checks", async () => {
  const base = "/api/payments/zpay/subscription";
  const env = environment(async () => { throw new Error("Rejected request reached backend"); });
  for (const path of [`${base}/notify`, `${base}/return`, `${base}/checkout/${SUBSCRIPTION_ORDER}`]) {
    assert.equal((await fetchRequest(new Request(`${ORIGIN}${path}`, { method: "POST" }), env)).status, 405);
    assert.equal((await fetchRequest(new Request(`${ORIGIN}${path}?x=${"x".repeat(8192)}`), env)).status, 413);
  }
  for (const path of [`${base}/notify/`, `${base}/return/`, `${base}/checkout/${ORDER}`, `${base}/checkout/${SUBSCRIPTION_ORDER}/`]) {
    assert.equal((await fetchRequest(new Request(`${ORIGIN}${path}`), env)).status, 404);
  }
  for (const path of ["/api/backend/v1/subscriptions/checkout", "/api/backend/v1/subscriptions/claim"]) {
    assert.equal((await fetchRequest(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { Origin: "https://foreign.example" }, body: "{}" }), env)).status, 403);
  }
});
