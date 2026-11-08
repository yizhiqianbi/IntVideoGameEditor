import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://xumengchat.top";
const ORDER = "gg_8c43d1a7-a6e3-47c2-928b-22d1660f2d24";
const PAY = "https://alipay.dthzf001.cn/pay/submit/2026101611165122908/";
function environment(backend: Env["BACKEND"]["fetch"]): Env {
  return {
    ASSETS: { fetch: async () => { throw new Error("Unexpected page shell"); } },
    BACKEND: { fetch: backend },
    CHAT_RATE_LIMITER: { limit: async () => { throw new Error("Unexpected model request"); } },
  };
}

test("Guagua notify forwards only the pinned callback IP and JSON body", async () => {
  const payload = JSON.stringify({ merOrderTid: "gg0123456789abcdef0122", tid: "BB0123", money: "28.00", status: 1, sign: "ab".repeat(16) });
  const env = environment(async input => {
    const request = input as Request;
    assert.equal(request.url, "https://dzmm-backend.850587960.workers.dev/v1/payments/guagua/notify");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("CF-Connecting-IP"), "136.110.35.126");
    assert.equal(request.headers.get("Cookie"), null);
    assert.equal(await request.text(), payload);
    return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": "never=forward" } });
  });
  const denied = await fetchRequest(new Request(`${ORIGIN}/api/payments/guagua/notify`, {
    method: "POST", body: payload, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
  }), environment(async () => { throw new Error("Rejected callback reached backend"); }));
  assert.equal(denied.status, 403);
  const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/guagua/notify`, {
    method: "POST", body: payload, headers: {
      "Content-Type": "application/json", "CF-Connecting-IP": "136.110.35.126", Cookie: "dzmm_session=private",
    },
  }), env);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "success");
  assert.equal(result.headers.get("Set-Cookie"), null);
});

test("Guagua checkout redirects only to the allowlisted cashier", async () => {
  const good = environment(async () => new Response(null, { status: 302, headers: { Location: PAY } }));
  const result = await fetchRequest(new Request(`${ORIGIN}/api/payments/guagua/checkout/${ORDER}`, {
    headers: { Cookie: "dzmm_session=owner-session" },
  }), good);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get("Location"), PAY);
  const bad = environment(async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/pay/submit/1/" } }));
  assert.equal((await fetchRequest(new Request(`${ORIGIN}/api/payments/guagua/checkout/${ORDER}`), bad)).status, 502);
});
