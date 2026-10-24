import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

for (const prefix of ["/api/backend", "/api/dzmm/backend"]) test(`${prefix} preserves private character reading audio seeks`, async () => {
  const env = { BACKEND: { fetch: async (input: Request) => {
    assert.equal(new URL(input.url).pathname, "/v1/character-voice/assets/reading-1");
    assert.equal(input.headers.get("Range"), "bytes=20-39");
    assert.equal(input.headers.get("Cookie"), "dzmm_session=valid-session");
    assert.equal(input.headers.get("Authorization"), null);
    return new Response(new Uint8Array(20), { status: 206, headers: { "Content-Type": "audio/wav", "Content-Range": "bytes 20-39/200",
      "Accept-Ranges": "bytes", "Content-Length": "20", "Cache-Control": "private, no-store" } });
  } } } as unknown as Env;
  const response = await fetchRequest(new Request(`https://xumengchat.top${prefix}/v1/character-voice/assets/reading-1`, {
    headers: { Range: "bytes=20-39", Cookie: "other=unrelated; dzmm_session=valid-session", Authorization: "must-not-forward" },
  }), env);
  assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Range"), "bytes 20-39/200");
  assert.equal(response.headers.get("Content-Type"), "audio/wav"); assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
});
test("reading ranges are only forwarded for asset GETs", async () => {
  const env = { BACKEND: { fetch: async (input: Request) => { assert.equal(input.headers.get("Range"), null); return new Response(null); } } } as unknown as Env;
  for (const path of ["/v1/character-voice", "/v1/character-voice/generate", "/v1/character-voice/assets/a/extra"]) {
    assert.equal((await fetchRequest(new Request(`https://xumengchat.top/api/backend${path}`, { headers: { Range: "bytes=0-9" } }), env)).status, 200);
  }
  assert.equal((await fetchRequest(new Request("https://xumengchat.top/api/backend/v1/character-voice/assets/a", { method: "HEAD", headers: { Range: "bytes=0-9" } }), env)).status, 200);
});
