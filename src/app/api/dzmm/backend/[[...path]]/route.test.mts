import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import routeModule from "./route";
const { GET, POST } = routeModule as typeof import("./route");
const context = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
test("local Next proxy forwards character audio ranges and safe seek metadata only on exact asset GET", async t => {
  const prior = process.env.DZMM_BACKEND_URL;
  process.env.DZMM_BACKEND_URL = "https://backend.example.invalid";
  t.after(() => { if (prior === undefined) delete process.env.DZMM_BACKEND_URL; else process.env.DZMM_BACKEND_URL = prior; });
  t.mock.method(globalThis, "fetch", async (_url: URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("range"), "bytes=10-19");
    assert.equal(new Headers(init?.headers).get("cookie"), `dzmm_session=${"ab".repeat(32)}`);
    return new Response(new Uint8Array(10), { status: 206, headers: { "Content-Type": "audio/wav", "Content-Range": "bytes 10-19/200", "Accept-Ranges": "bytes", "Content-Length": "10", "Content-Disposition": "inline; filename=reading.wav" } });
  });
  const response = await GET(new NextRequest("http://localhost/api/backend/v1/character-voice/assets/reading-1", { headers: { Range: "bytes=10-19", Cookie: `dzmm_session=${"ab".repeat(32)}` } }), context("v1/character-voice/assets/reading-1"));
  assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Range"), "bytes 10-19/200");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes"); assert.equal(response.headers.get("Content-Length"), "10");
  assert.equal(response.headers.get("Content-Type"), "audio/wav");
});
test("local Next preview permits long reading generation while ordinary account requests retain their deadline", async t => {
  const prior = process.env.DZMM_BACKEND_URL;
  process.env.DZMM_BACKEND_URL = "https://backend.example.invalid";
  t.after(() => { if (prior === undefined) delete process.env.DZMM_BACKEND_URL; else process.env.DZMM_BACKEND_URL = prior; });
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => { deadlines.push(ms); return new AbortController().signal; });
  t.mock.method(globalThis, "fetch", async (_url: URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("range"), null); return Response.json({ ok: true });
  });
  await POST(new NextRequest("http://localhost/api/backend/v1/character-voice/generate", { method: "POST", headers: { Origin: "http://localhost", Range: "bytes=0-9", "Content-Type": "application/json" }, body: "{}" }), context("v1/character-voice/generate"));
  await GET(new NextRequest("http://localhost/api/backend/v1/character-voice", { headers: { Range: "bytes=0-9" } }), context("v1/character-voice"));
  assert.deepEqual(deadlines, [120_000, 30_000]);
});
