import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

for (const prefix of ["/api/backend", "/api/dzmm/backend"]) test(`${prefix} preserves the opt-in media directory cursor and its private cache boundary`, async () => {
  const query = new URLSearchParams({ conversationId: "own-conversation", pagination: "1", limit: "500",
    cursor: Buffer.from(JSON.stringify([1, "own-user", "own-conversation", 500, 1000, "cm_0500", 1000, "cm_0501"])).toString("base64url") });
  const body = { accountId: "own-user", conversationId: "own-conversation", assets: [], pending: [],
    directory: { version: 1, limit: 500, scannedRows: 0, after: { createdAt: 1000, id: "cm_0500" },
      upper: { createdAt: 1000, id: "cm_0501" }, nextCursor: null } };
  let calls = 0;
  const env = { BACKEND: { fetch: async (input: Request) => {
    calls++;
    assert.equal(new URL(input.url).pathname, "/v1/chat-media");
    assert.equal(new URL(input.url).search, `?${query}`);
    assert.equal(input.method, "GET");
    assert.equal(input.headers.get("Cookie"), "dzmm_session=own-session");
    assert.equal(input.headers.get("Authorization"), null);
    assert.equal(input.headers.get("Range"), null);
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } } } as unknown as Env;
  const response = await fetchRequest(new Request(`https://xumengchat.top${prefix}/v1/chat-media?${query}`, {
    headers: { Cookie: "unrelated=ignored; dzmm_session=own-session", Authorization: "must-not-forward", Range: "bytes=0-9" },
  }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.deepEqual(await response.json(), body);
  assert.equal(calls, 1);
});

for (const prefix of ["/api/backend", "/api/dzmm/backend"]) test(`${prefix} forwards private audio ranges and preserves seek headers`, async () => {
  const env = { BACKEND: { fetch: async (input: Request) => {
    assert.equal(new URL(input.url).pathname, "/v1/chat-media/assets/clip-1");
    assert.equal(input.headers.get("Range"), "bytes=20-39");
    assert.equal(input.headers.get("Cookie"), "dzmm_session=valid-session");
    assert.equal(input.headers.get("Authorization"), null);
    return new Response(new Uint8Array(20), { status: 206, headers: {
      "Content-Type": "audio/mpeg", "Content-Range": "bytes 20-39/200", "Accept-Ranges": "bytes", "Content-Length": "20",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } } } as unknown as Env;
  const response = await fetchRequest(new Request(`https://xumengchat.top${prefix}/v1/chat-media/assets/clip-1`, {
    headers: { Range: "bytes=20-39", Cookie: "other=unrelated; dzmm_session=valid-session", Authorization: "must-not-forward" },
  }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 20-39/200");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Content-Length"), "20");
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal((await response.arrayBuffer()).byteLength, 20);
});

test("Range is not added to account or generation requests", async () => {
  const env = { BACKEND: { fetch: async (input: Request) => {
    assert.equal(input.headers.get("Range"), null);
    return Response.json({ accountId: "test" });
  } } } as unknown as Env;
  const response = await fetchRequest(new Request("https://xumengchat.top/api/backend/v1/state", { headers: { Range: "bytes=0-9" } }), env);
  assert.equal(response.status, 200);
});

const assetId = "da1b03ad-0fd8-447e-bbd3-7d5ba8e14209";
for (const prefix of ["/api/backend", "/api/dzmm/backend"]) test(`${prefix} forwards only private generation asset GET ranges with the own session and preserves video seek metadata`, async () => {
  const env = { BACKEND: { fetch: async (input: Request) => {
    assert.equal(new URL(input.url).pathname, `/v1/generation/assets/${assetId}`);
    assert.equal(input.method, "GET"); assert.equal(input.headers.get("Range"), "bytes=30-49");
    assert.equal(input.headers.get("Cookie"), "dzmm_session=own-video-session");
    assert.equal(input.headers.get("Authorization"), null);
    return new Response(new Uint8Array(20), { status: 206, headers: {
      "Content-Type": "video/mp4", "Content-Range": "bytes 30-49/200", "Accept-Ranges": "bytes", "Content-Length": "20",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } } } as unknown as Env;
  const response = await fetchRequest(new Request(`https://xumengchat.top${prefix}/v1/generation/assets/${assetId}`, {
    headers: { Range: "bytes=30-49", Cookie: "other=ignored; dzmm_session=own-video-session", Authorization: "must-not-forward" },
  }), env);
  assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Range"), "bytes 30-49/200");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes"); assert.equal(response.headers.get("Content-Length"), "20");
  assert.equal(response.headers.get("Content-Type"), "video/mp4"); assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal((await response.arrayBuffer()).byteLength, 20);
});

test("generation Range forwarding cannot expand to jobs, malformed IDs, nested routes or other methods", async () => {
  const env = { BACKEND: { fetch: async (input: Request) => {
    assert.equal(input.headers.get("Range"), null); return new Response(null);
  } } } as unknown as Env;
  for (const path of [`/v1/generation/jobs/${assetId}`, "/v1/generation/assets/not-a-uuid", `/v1/generation/assets/${assetId}/extra`, "/v1/state"]) {
    assert.equal((await fetchRequest(new Request(`https://xumengchat.top/api/backend${path}`, { headers: { Range: "bytes=0-9" } }), env)).status, 200);
  }
  for (const method of ["HEAD", "POST"]) {
    const response = await fetchRequest(new Request(`https://xumengchat.top/api/backend/v1/generation/assets/${assetId}`, {
      method, headers: { Origin: "https://xumengchat.top", Range: "bytes=0-9" },
    }), env);
    assert.equal(response.status, 200);
  }
});
