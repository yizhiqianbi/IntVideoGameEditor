import test from "node:test";
import assert from "node:assert/strict";
import routeModule from "./route";
import type { DzmmChatMessage } from "../../../../lib/dzmm-chat";

const { GET, POST } = routeModule as typeof import("./route");
const ENV_KEYS = ["DZMM_API_KEY", "DZMM_BASE_URL", "DZMM_MODEL", "DZMM_FAST_MODEL", "DZMM_BALANCED_MODEL", "DZMM_STORY_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MODEL"];
const encoder = new TextEncoder();

function request(messages: DzmmChatMessage[] = [{ role: "user", content: "你好" }]) {
  return new Request("http://localhost/api/dzmm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ character: { name: "林音", description: "书店店员" }, messages, model: "balanced" }),
  });
}

async function withMockProvider(fetchMock: typeof fetch, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.DZMM_API_KEY = "test-private-key";
  process.env.DZMM_MODEL = "test/model";
  process.env.DZMM_BASE_URL = "https://example.invalid/v1";
  globalThis.fetch = fetchMock;
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("status omits keys, invalid payloads never call a provider, and missing configuration fails clearly", async () => {
  let calls = 0;
  await withMockProvider(async () => { calls++; throw new Error("unexpected fetch"); }, async () => {
    const status = await (await GET()).json();
    assert.equal(status.configured, true);
    assert.equal(status.model, "test/model");
    assert.ok(!JSON.stringify(status).includes("test-private-key"));
    assert.equal((await POST(request([{ role: "user", content: "" }]))).status, 400);
    assert.equal((await POST(new Request("http://localhost/api/dzmm/chat", { method: "POST", body: "中".repeat(60001) }))).status, 400);
    delete process.env.DZMM_API_KEY;
    assert.equal((await POST(request())).status, 503);
    assert.equal(calls, 0);
  });
});

test("upstream authentication errors are sanitized before reading private provider data", async () => {
  await withMockProvider(async () => new Response('{"error":{"message":"test-private-key raw-private-body"}}', { status: 401 }), async () => {
    const response = await POST(request());
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.ok(text.includes("鉴权失败"));
    assert.ok(!text.includes("test-private-key") && !text.includes("raw-private-body"));
  });
});

test("a normal SSE reply streams byte-wise UTF-8 as plain text", async () => {
  const wire = 'data: {"choices":[{"delta":{"content":"你好 🌱"}}]}\n\ndata: [DONE]\n\n';
  await withMockProvider(async (_url, options) => {
    const sent = JSON.parse(options?.body as string);
    assert.equal(sent.model, "test/model");
    assert.equal(sent.messages[0].role, "system");
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of encoder.encode(wire)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
  }, async () => {
    const response = await POST(request());
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "你好 🌱");
  });
});

test("a whitespace-only completion fails before sending stream headers", async () => {
  const wire = 'data: {"choices":[{"delta":{"content":" \\n\\t "}}]}\n\ndata: [DONE]\n\n';
  await withMockProvider(async () => new Response(wire, { headers: { "Content-Type": "text/event-stream" } }), async () => {
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.ok(response.headers.get("content-type")?.includes("application/json"));
    assert.ok((await response.json()).error.includes("没有返回回复"));
  });
});

test("a truncated SSE reply retains its first text then signals a stream error", async () => {
  await withMockProvider(async () => new Response('data: {"choices":[{"delta":{"content":"未写完的正文"}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } }), async () => {
    const response = await POST(request());
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "未写完的正文");
    await assert.rejects(reader.read(), /提前中断/);
  });
});

test("reply length stays within the next request's message limit and does not split an emoji", async () => {
  const wire = `data: ${JSON.stringify({ choices: [{ delta: { content: "文".repeat(11999) + "🌱" + "多余正文" } }] })}\n\ndata: [DONE]\n\n`;
  await withMockProvider(async () => new Response(wire, { headers: { "Content-Type": "text/event-stream" } }), async () => {
    const response = await POST(request());
    const reader = response.body!.getReader();
    const retained = new TextDecoder().decode((await reader.read()).value);
    assert.equal(retained.length, 11999);
    assert.ok(!retained.includes("�"));
    await assert.rejects(reader.read(), /长度上限/);
  });
});

test("cancelling the client stream aborts and cancels the upstream stream", async () => {
  let signal: AbortSignal | null | undefined;
  let cancelled = false;
  await withMockProvider(async (_url, options) => {
    signal = options?.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"生成中"}}]}\n\n')); },
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "text/event-stream" } });
  }, async () => {
    const response = await POST(request());
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "生成中");
    await reader.cancel();
    assert.equal(signal?.aborted, true);
    assert.equal(cancelled, true);
  });
});
