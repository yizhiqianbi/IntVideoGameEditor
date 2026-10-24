import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";
const origin = "https://xumengchat.top";
function environment(fetchAssets: () => Promise<Response>): Env {
  return { GENERATION_ENABLED: "false", ASSETS: { fetch: fetchAssets },
    BACKEND: { fetch: async () => { throw new Error("must not call backend"); } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    KREA2_ACTIONS_URL: "https://unreachable.invalid" };
}
test("paused Krea2 rejects requests before parsing or contacting the image provider", async () => {
  const response = await fetchRequest(new Request(origin + "/api/krea2/generate", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "invalid-json"
  }), environment(async () => { throw new Error("must not fetch assets"); }));
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, "generation_paused");
});
test("paused H3 and Krea2 reject GET probes and POSTs before account or provider access", async () => {
  const env = environment(async () => { throw new Error("must not fetch assets"); });
  for (const path of ["/api/h3/r2v", "/api/krea2/generate"]) {
    for (const method of ["GET", "POST"]) {
      const response = await fetchRequest(new Request(origin + path, {
        method, headers: { Origin: origin }, ...(method === "POST" ? { body: "invalid-json" } : {})
      }), env);
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.equal((await response.json() as { code: string }).code, "generation_paused");
    }
  }
});
test("paused template previews cannot bypass the worker through legacy or encoded URLs", async () => {
  let calls = 0;
  const env = environment(async () => { calls++; return new Response("must not serve template"); });
  for (const folder of ["generation-templates", "action-templates", "h3-actions", "krea2-actions"]) {
    for (const path of [`/assets/xumeng/${folder}/manifest.json`, `/dzmm/${folder}/manifest.json`,
      `/assets/%78umeng/${folder}/manifest.json`, `/%61ssets/xumeng/${folder}/manifest.json`,
      `/assets//xumeng/${folder}/manifest.json`]) {
      for (const method of ["GET", "HEAD"]) assert.equal((await fetchRequest(new Request(origin + path, { method }), env)).status, 404, path);
    }
  }
  assert.equal(calls, 0);
});
test("paused creation keeps ordinary character covers readable", async () => {
  let calls = 0;
  const env = environment(async () => { calls++; return new Response(new Uint8Array([1,2]), { headers: { "Content-Type": "image/webp" } }); });
  const response = await fetchRequest(new Request(origin + "/assets/xumeng/covers/2999180.webp"), env);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
