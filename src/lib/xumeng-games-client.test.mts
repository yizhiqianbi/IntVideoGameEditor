import assert from "node:assert/strict";
import { test } from "node:test";
import clientModule from "./xumeng-games-client";
import gamesModule from "./xumeng-games";
import type { XumengGameDraft, XumengGameDetail } from "./xumeng-games";
const { fetchXumengGame, fetchXumengGames, saveXumengGame, deleteXumengGame, XumengGameClientError } = clientModule as typeof import("./xumeng-games-client");
const { createXumengGameDraft } = gamesModule as typeof import("./xumeng-games");
const game = () => createXumengGameDraft("blank", () => "original-game");
const detail = (draft: XumengGameDraft, accountId = "author", version = 1): XumengGameDetail => ({ accountId, game: { ...draft, version, createdAt: 1, updatedAt: 2 } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function mockedFetch(run: typeof fetch, action: () => Promise<void>) { const original = globalThis.fetch; globalThis.fetch = run; try { await action(); } finally { globalThis.fetch = original; } }

test("client sends authenticated, uncached versioned drafts and verifies identifiers in replies", async () => {
  const draft = game(); let called = 0;
  await mockedFetch(async (input, init) => {
    called++; assert.equal(input, "/api/backend/v1/games"); assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(init!.body as string), { accountId: "author", game: draft });
    return response(detail(draft), 201);
  }, async () => { assert.deepEqual(await saveXumengGame("author", draft, null), detail(draft)); });
  assert.equal(called, 1);
  await mockedFetch(async () => response(detail({ ...draft, id: "other-game" })), async () => { await assert.rejects(fetchXumengGame("author", draft.id), /编号/); });
});
test("matching lost-save acknowledgement adopts exact current snapshot; changed source stays a conflict", async () => {
  const draft = game(), current = detail(draft, "author", 2);
  await mockedFetch(async () => response({ accountId: "author", error: "conflict", current }, 409), async () => {
    assert.deepEqual(await saveXumengGame("author", draft, 1), current);
    assert.deepEqual(await saveXumengGame("author", draft, null), current);
    await assert.rejects(saveXumengGame("author", { ...draft, source: "<h1>修改后的源码</h1>" }, 1), error => error instanceof XumengGameClientError && error.status === 409 && error.current?.game.source === draft.source);
  });
  await mockedFetch(async () => response({ accountId: "author", error: "conflict", current: detail(draft, "author", 1) }, 409), async () => {
    await assert.rejects(saveXumengGame("author", draft, 1), error => error instanceof XumengGameClientError && error.status === 409);
  });
});
test("mismatched account or receipt content never acknowledges or exposes another author's recovery", async () => {
  const draft = game();
  for (const status of [200, 409]) await mockedFetch(async () => response(status === 200 ? detail(draft, "other") : { accountId: "other", error: "conflict", current: detail(draft, "other") }, status), async () => {
    await assert.rejects(saveXumengGame("author", draft, 1), error => error instanceof XumengGameClientError && error.status === 401 && error.current === undefined);
  });
  await mockedFetch(async () => response(detail({ ...draft, source: "<h1>旧源码</h1>" })), async () => {
    await assert.rejects(saveXumengGame("author", draft, 1), /不一致/);
  });
  await mockedFetch(async () => response({ accountId: "author", games: [] }), async () => {
    await assert.rejects(fetchXumengGames("other"), error => error instanceof XumengGameClientError && error.status === 401);
  });
});
test("offline, malformed JSON and explicit cancellation retain draft instead of retrying a mutation", async () => {
  const draft = game(); let calls = 0;
  await mockedFetch(async () => { calls++; throw new TypeError("offline"); }, async () => {
    await assert.rejects(saveXumengGame("author", draft, null), error => error instanceof XumengGameClientError && error.status === 503);
  }); assert.equal(calls, 1);
  await mockedFetch(async () => new Response("incomplete JSON"), async () => { await assert.rejects(saveXumengGame("author", draft, null), /源码已保留/); });
  const controller = new AbortController(); controller.abort();
  await mockedFetch(async (_input, init) => { assert.equal(init?.signal?.aborted, true); throw new DOMException("aborted", "AbortError"); }, async () => {
    await assert.rejects(saveXumengGame("author", draft, null, controller.signal), error => error instanceof DOMException && error.name === "AbortError");
  });
  assert.equal(draft.source, game().source);
});
test("delete requires a verified deletion acknowledgement and local version validation avoids network writes", async () => {
  const draft = game(); let calls = 0;
  await mockedFetch(async () => { calls++; return response({ accountId: "author", deleted: false }); }, async () => {
    await assert.rejects(deleteXumengGame("author", draft.id, 1), /未确认/);
    await assert.rejects(saveXumengGame("author", draft, 0), /版本/);
    await assert.rejects(saveXumengGame("author", draft, Number.MAX_SAFE_INTEGER), /版本/);
  }); assert.equal(calls, 1);
});
