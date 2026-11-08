import test from "node:test";
import assert from "node:assert/strict";
import mediaModule from "./dzmm-chat-media";
const { fetchDzmmChatMedia, generateDzmmChatMedia, parseDzmmChatMediaOverview, resolveDzmmChatMediaResult } = mediaModule as typeof import("./dzmm-chat-media");
const accountId = "directory-account", conversationId = "directory-conversation", hash = "ab".repeat(32);
const item = (index: number) => ({ id: `cm_${String(index).padStart(5, "0")}`, conversationId, messageId: `message-${index}`,
  kind: "image" as const, url: `/api/backend/v1/chat-media/assets/cm_${String(index).padStart(5, "0")}`,
  sourceHash: hash, createdAt: 1_000, mimeType: "image/png" });
const point = (index: number) => ({ id: item(index).id, createdAt: 1_000 });
const cursor = (after: number, upper = 501, owner = accountId, conversation = conversationId) =>
  Buffer.from(JSON.stringify([1, owner, conversation, 500, 1_000, item(after).id, 1_000, item(upper).id])).toString("base64url");
const page = (assets: ReturnType<typeof item>[], scannedRows: number, after: number | null, next: number | null, upper = 501) => ({
  accountId, conversationId, vip: { active: false, expiresAt: null, adminPreview: false }, features: { audio: true, image: true },
  limits: { audio: 20, image: 5, maxVoiceChars: 800 }, usage: { audio: 2, image: 3 }, assets, pending: [] as unknown[],
  directory: { version: 1, limit: 500, scannedRows, after: after === null ? null : point(after), upper: point(upper),
    nextCursor: next === null ? null : cursor(next, upper) },
});
const first = () => page(Array.from({ length: 500 }, (_, index) => item(index + 1)), 500, null, 500);
const last = () => page([item(501)], 1, 500, null);
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function mockFetch(handler: (url: URL, init: RequestInit, index: number) => Promise<Response> | Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    const url = new URL(String(input), "https://xumengchat.top");
    assert.equal(url.pathname, "/api/backend/v1/chat-media");
    assert.equal(url.searchParams.get("conversationId"), conversationId);
    assert.equal(url.searchParams.get("pagination"), "1");
    assert.equal(url.searchParams.get("limit"), "500");
    assert.equal(Object.hasOwn(init, "body"), false);
    return handler(url, init, calls++);
  };
  try { await run(); } finally { globalThis.fetch = original; }
  return calls;
}

test("501 equal-timestamp assets are fully restored through bounded pages without changing the single-page guard", async () => {
  assert.throws(() => parseDzmmChatMediaOverview({ ...first(), assets: Array.from({ length: 501 }, (_, i) => item(i + 1)) }, accountId, conversationId));
  const calls = await mockFetch((url, _init, index) => {
    assert.equal(url.searchParams.get("cursor"), index === 0 ? null : cursor(500));
    return response(index === 0 ? first() : { ...last(), usage: { audio: 4, image: 5 } });
  }, async () => {
    const restored = await fetchDzmmChatMedia(accountId, conversationId);
    assert.equal(restored.assets.length, 501);
    assert.deepEqual(restored.assets.map(asset => asset.id), Array.from({ length: 501 }, (_, i) => item(i + 1).id));
    assert.deepEqual(restored.usage, { audio: 4, image: 5 });
    assert.equal(restored.vip.active, false);
    assert.deepEqual(restored.pending, []);
  });
  assert.equal(calls, 2);
});

test("a page containing only stale sources still advances to later current media", async () => {
  assert.equal(await mockFetch((_url, _init, index) => response(index === 0 ? page([], 500, null, 500) : last()), async () => {
    assert.deepEqual((await fetchDzmmChatMedia(accountId, conversationId)).assets, [item(501)]);
  }), 2);
});

test("mixed pending pages preserve server leases and only complete known directories confirm absence", async () => {
  const reservation = { id: item(500).id, messageId: "message-500", kind: "audio", sourceHash: hash, expiresAt: 1 };
  await mockFetch((_url, _init, index) => response(index === 0
    ? { ...page(Array.from({ length: 499 }, (_, i) => item(i + 1)), 500, null, 500), pending: [reservation] } : last()), async () => {
    const restored = await fetchDzmmChatMedia(accountId, conversationId);
    assert.equal(restored.assets.length, 500);
    assert.deepEqual(restored.pending, [reservation]);
    assert.equal(resolveDzmmChatMediaResult(restored, { messageId: reservation.messageId, kind: "audio", sourceHash: hash }).state, "pending");
    assert.deepEqual(restored.usage, { audio: 2, image: 3 });
  });
  await mockFetch((_url, _init, index) => {
    if (index !== 0) return response(last());
    const { pending: _ignored, ...unknown } = page([], 500, null, 500);
    return response(unknown);
  }, async () => {
    const restored = await fetchDzmmChatMedia(accountId, conversationId);
    assert.equal(Object.hasOwn(restored, "pending"), false);
    assert.equal(resolveDzmmChatMediaResult(restored, { messageId: "uncertain-message", kind: "audio", sourceHash: hash }).state, "unknown");
  });
});

test("second-page HTTP failure rejects the whole read and leaves the caller's previous complete cache intact", async () => {
  const prior = parseDzmmChatMediaOverview({ ...last(), assets: [item(501)] }, accountId, conversationId);
  let visible = prior, published = 0;
  assert.equal(await mockFetch((_url, _init, index) => response(index === 0 ? first() : { error: "目录暂时不可用" }, index === 0 ? 200 : 503), async () => {
    await assert.rejects(async () => { visible = await fetchDzmmChatMedia(accountId, conversationId); published++; }, { status: 503 });
    assert.equal(visible, prior);
    assert.equal(published, 0);
  }), 2);
});

test("malformed, scope-changing and non-progressing pages fail without partial results or generation", async () => {
  const cases = [
    { ...last(), accountId: "another-account" },
    { ...last(), conversationId: "another-conversation" },
    { ...last(), assets: [item(1)] },
    { ...last(), pending: [{ id: item(1).id, messageId: "message-1", kind: "image", sourceHash: hash, expiresAt: 9_000 }] },
    { ...last(), directory: { ...last().directory, after: point(499) } },
    { ...last(), directory: { ...last().directory, upper: point(502) } },
    { ...last(), directory: { ...last().directory, scannedRows: 500, nextCursor: cursor(500) } },
    { ...last(), directory: { ...last().directory, scannedRows: 500, nextCursor: cursor(501, 501, "another-account") } },
    { ...last(), directory: { ...last().directory, scannedRows: 500, nextCursor: "bad-json" } },
    { ...last(), directory: { ...last().directory, scannedRows: 0 } },
    { ...last(), directory: undefined },
  ];
  for (const broken of cases) {
    assert.equal(await mockFetch((_url, _init, index) => response(index === 0 ? first() : broken), async () => {
      await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { status: 502 });
    }), 2);
  }
});

test("an empty authorized directory is complete, while missing pagination markers fail", async () => {
  const empty = { ...page([], 0, null, null), directory: { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null } };
  await mockFetch(() => response(empty), async () => assert.deepEqual((await fetchDzmmChatMedia(accountId, conversationId)).assets, []));
  await mockFetch(() => response({ ...empty, directory: undefined }), async () => {
    await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { status: 502 });
  });
});

test("abort before, during and after a response cannot publish a late complete or partial directory", async () => {
  const early = new AbortController(); early.abort();
  assert.equal(await mockFetch(() => { throw new Error("must not fetch"); }, async () => {
    await assert.rejects(fetchDzmmChatMedia(accountId, conversationId, early.signal), { name: "AbortError" });
  }), 0);
  const late = new AbortController();
  assert.equal(await mockFetch((_url, _init, index) => {
    if (index === 1) late.abort();
    return response(index === 0 ? first() : last());
  }, async () => {
    await assert.rejects(fetchDzmmChatMedia(accountId, conversationId, late.signal), { name: "AbortError" });
  }), 2);
  const streaming = new AbortController();
  await mockFetch(() => new Response(new ReadableStream({ pull(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify(last()))); streaming.abort(); controller.close();
  } })), async () => {
    await assert.rejects(fetchDzmmChatMedia(accountId, conversationId, streaming.signal), { name: "AbortError" });
  });
});

test("response byte budgets count actual chunks and fail visibly without a falsely complete cutoff", async () => {
  let headerCancelled = false;
  await mockFetch(() => new Response(new ReadableStream({ cancel() { headerCancelled = true; } }), {
    headers: { "Content-Length": String(2 * 1024 * 1024 + 1) },
  }), async () => { await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { status: 502 }); });
  assert.equal(headerCancelled, true);
  let cancelled = false;
  await mockFetch(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
  }, cancel() { cancelled = true; } })), async () => {
    await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { status: 502 });
  });
  assert.equal(cancelled, true);
  let sent = 0;
  await mockFetch((_url, _init, index) => {
    sent++;
    return response({ ...page([], 500, index === 0 ? null : index, index + 1, 999), padding: "x".repeat(1024 * 1024) });
  }, async () => { await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { status: 502 }); });
  assert.equal(sent, 16);
});

test("the deadline cancels a stalled body even if stream transport ignores the fetch signal", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let expire: (() => void) | undefined, cancelled = false;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    if (delay === 30_000) expire = callback;
    return originalSetTimeout(callback, delay);
  }) as typeof setTimeout;
  try {
    await mockFetch(() => new Response(new ReadableStream({ pull() { queueMicrotask(() => expire?.()); },
      cancel() { cancelled = true; return new Promise(() => undefined); } }, { highWaterMark: 0 })), async () => {
      await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { name: "AbortError" });
    });
    assert.equal(cancelled, true);
  } finally { globalThis.setTimeout = originalSetTimeout; }
});

test("the whole scan deadline bounds repeated pages, while generation retains its exact request contract", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    if (delay === 30_000) expire = callback;
    return originalSetTimeout(callback, delay);
  }) as typeof setTimeout;
  try {
    assert.equal(await mockFetch((_url, _init, index) => { assert.equal(index, 0); expire?.(); return response(first()); }, async () => {
      await assert.rejects(fetchDzmmChatMedia(accountId, conversationId), { name: "AbortError" });
    }), 1);
  } finally { globalThis.setTimeout = originalSetTimeout; }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(String(input), "/api/backend/v1/chat-media/generate");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { accountId, conversationId, messageId: item(1).messageId, kind: "image" });
    return response({ accountId, asset: item(1) });
  };
  try { assert.deepEqual(await generateDzmmChatMedia(accountId, conversationId, item(1).messageId, "image"), item(1)); }
  finally { globalThis.fetch = originalFetch; }
});
