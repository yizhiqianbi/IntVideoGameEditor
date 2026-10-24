import assert from "node:assert/strict";
import test from "node:test";
import * as recoveryExports from "./xumeng-reference-recovery.ts";
import * as generationExports from "./xumeng-generation.ts";
const recovery = (recoveryExports as typeof recoveryExports & { default?: typeof recoveryExports }).default ?? recoveryExports;
const generation = (generationExports as typeof generationExports & { default?: typeof generationExports }).default ?? generationExports;
const id = "98989898-9898-4898-8898-989898989898";
const reference = { id, name: "Original.png", mimeType: "image/png", byteLength: 68, width: 1, height: 1, assetUrl: `/api/backend/v1/generation/reference-assets/${id}` };

test("reference metadata retains existing ownership and exact identity validation", async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ accountId: "owner", reference });
    assert.deepEqual(await recovery.recoverGenerationReferenceWithDeadline("owner", id, new AbortController().signal, 100), reference);
    await assert.rejects(recovery.recoverGenerationReferenceWithDeadline("other", id, new AbortController().signal, 100), error => error instanceof generation.GenerationError && error.status === 502);
  } finally { globalThis.fetch = old; }
});

test("hung transport is bounded and cancelled without relying on abort support", async () => {
  const old = globalThis.fetch;
  let transportSignal: AbortSignal | undefined;
  const calls: Array<{ url: string; method: string | undefined }> = [];
  try {
    globalThis.fetch = (url, init) => { calls.push({ url: String(url), method: init?.method }); transportSignal = init?.signal ?? undefined; return new Promise(() => {}); };
    await assert.rejects(recovery.recoverGenerationReferenceWithDeadline("owner", id, new AbortController().signal, 20), error => error instanceof generation.GenerationError && error.status === 408 && error.code === "generation_reference_timeout");
    assert.equal(transportSignal?.aborted, true);
    assert.deepEqual(calls, [{ url: `/api/backend/v1/generation/references/${id}`, method: "GET" }]);
  } finally { globalThis.fetch = old; }
});

test("deadline also covers stalled response body and ignores its late success", async () => {
  const old = globalThis.fetch;
  let completeBody!: (value: unknown) => void;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { completeBody = resolve; }) }) as Response;
    const pending = recovery.recoverGenerationReferenceWithDeadline("owner", id, new AbortController().signal, 20);
    await assert.rejects(pending, error => error instanceof generation.GenerationError && error.code === "generation_reference_timeout");
    completeBody({ accountId: "owner", reference });
    await assert.rejects(pending, error => error instanceof generation.GenerationError && error.code === "generation_reference_timeout");
  } finally { globalThis.fetch = old; }
});

test("unmount or request replacement cancels its own lookup and never starts an already cancelled scope", async () => {
  const old = globalThis.fetch;
  let calls = 0, transportSignal: AbortSignal | undefined;
  try {
    globalThis.fetch = (_url, init) => { calls++; transportSignal = init?.signal ?? undefined; return new Promise(() => {}); };
    const owner = new AbortController();
    const pending = recovery.recoverGenerationReferenceWithDeadline("owner", id, owner.signal, 100);
    owner.abort(new DOMException("Scope replaced", "AbortError"));
    await assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
    assert.equal(transportSignal?.aborted, true);
    await assert.rejects(recovery.recoverGenerationReferenceWithDeadline("owner", id, owner.signal, 100));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});

test("an obsolete lookup's late missing response cannot replace a successful retry", async () => {
  const old = globalThis.fetch;
  let completeBody!: (value: unknown) => void;
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1
      ? ({ ok: false, status: 404, json: () => new Promise(resolve => { completeBody = resolve; }) }) as Response
      : Response.json({ accountId: "owner", reference });
    const obsolete = recovery.recoverGenerationReferenceWithDeadline("owner", id, new AbortController().signal, 20);
    await assert.rejects(obsolete, error => error instanceof generation.GenerationError && error.code === "generation_reference_timeout");
    const restored = await recovery.recoverGenerationReferenceWithDeadline("owner", id, new AbortController().signal, 100);
    completeBody({ error: "Missing", code: "generation_reference_missing" });
    await assert.rejects(obsolete, error => error instanceof generation.GenerationError && error.code === "generation_reference_timeout");
    assert.deepEqual(restored, reference);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = old; }
});

test("original task can be read while metadata is pending with no new quote or submission", async () => {
  const old = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (url, init) => {
      calls.push(`${init?.method} ${url}`);
      if (String(url).includes("/references/")) return new Promise(() => {});
      return Promise.resolve(Response.json({ accountId: "owner", job: { id, kind: "image", modelId: "original", prompt: "Original harbor", aspectRatio: "1:1", status: "failed", createdAt: 1, updatedAt: 2, reservedCredits: 0, chargedCredits: 0, expiresAt: 1000, finalizedAt: 2, exceedsReservation: false, costBasis: "released" } }));
    };
    const scope = new AbortController();
    const metadata = recovery.recoverGenerationReferenceWithDeadline("owner", id, scope.signal, 100).catch(() => null);
    assert.equal((await generation.recoverGeneration("owner", id)).id, id);
    scope.abort(); await metadata;
    assert.deepEqual(calls, [`GET /api/backend/v1/generation/references/${id}`, `GET /api/backend/v1/generation/requests/${id}`]);
  } finally { globalThis.fetch = old; }
});
