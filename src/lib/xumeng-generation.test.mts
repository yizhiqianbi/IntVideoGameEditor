import assert from "node:assert/strict";
import test from "node:test";
import * as generationExports from "./xumeng-generation.ts";
import * as templateExports from "./xumeng-generation-templates.ts";
const generationModule = (generationExports as typeof generationExports & { default?: typeof generationExports }).default ?? generationExports;
const templatesModule = (templateExports as typeof templateExports & { default?: typeof templateExports }).default ?? templateExports;
const { fetchGenerationJobs, GenerationError, parseGenerationJob, quoteGeneration, recoverGeneration, parseGenerationReference, uploadGenerationReference, fetchGenerationReference, deleteGenerationReference } = generationModule;
const { fillGenerationTemplate, GENERATION_TEMPLATES } = templatesModule;
const id = "98989898-9898-4898-8898-989898989898";
const job = { id, kind: "image", modelId: "x-ai/grok-imagine-image-2.0", prompt: "普通原创海港", aspectRatio: "1:1", status: "ready",
  createdAt: 1, updatedAt: 2, reservedCredits: 0, chargedCredits: 81, assetUrl: `/api/backend/v1/generation/assets/${id}`, mimeType: "image/png", expiresAt: 10000, finalizedAt: 2, exceedsReservation: false, costBasis: "provider_usage" };
test("private generation assets cannot point at another task, provider URL or executable URL", () => {
  assert.equal(parseGenerationJob(job).chargedCredits, 81);
  for (const assetUrl of ["https://provider.invalid/a.png", "javascript:alert(1)", "/api/backend/v1/generation/assets/other"]) assert.throws(() => parseGenerationJob({ ...job, assetUrl }));
  assert.throws(() => parseGenerationJob({ ...job, assetUrl: undefined }));
});
test("cross-account media response never enters another account's history", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ accountId: "other", jobs: [job] });
  try { await assert.rejects(fetchGenerationJobs("owner"), /数据无效/); } finally { globalThis.fetch = old; }
});
test("bad quotes cannot authorize a lower hold or negative charge", async () => {
  const old = globalThis.fetch;
  try {
    for (const quote of [{ estimatedCredits: 81, maxCredits: 1 }, { estimatedCredits: -1, maxCredits: 100 }]) {
      globalThis.fetch = async () => Response.json({ accountId: "owner", quote });
      await assert.rejects(quoteGeneration({ accountId: "owner", kind: "image", modelId: job.modelId, prompt: job.prompt, aspectRatio: "1:1" }), /数据无效/);
    }
  } finally { globalThis.fetch = old; }
});
test("quote policy changes carry a stable error code for reviewed-budget recovery", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "报价已变化", code: "generation_quote_changed" }, { status: 409 });
  try {
    await assert.rejects(quoteGeneration({ accountId: "owner", kind: "image", modelId: job.modelId, prompt: job.prompt, aspectRatio: "1:1" }),
      error => error instanceof GenerationError && error.status === 409 && error.code === "generation_quote_changed");
  } finally { globalThis.fetch = old; }
});
test("template fill preserves user literals and rejects missing fields without a model call", () => {
  const template = GENERATION_TEMPLATES.find(item => item.id === "character-portrait")!;
  const result = fillGenerationTemplate(template, { subject: "$& 海港旅人 {{style}}", style: "水彩" });
  assert.match(result, /\$& 海港旅人 \{\{style\}\}/);
  assert.match(result, /画面风格：水彩/);
  assert.throws(() => fillGenerationTemplate(template, { subject: "旅人" }), /每个字段/);
});
test("lost-response recovery only reads the original request and validates account ownership", async () => {
  const old = globalThis.fetch;
  const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      return Response.json({ accountId: "owner", job });
    };
    assert.equal((await recoverGeneration("owner", id)).id, id);
    assert.deepEqual(calls, [{ url: `/api/backend/v1/generation/requests/${id}`, method: "GET", body: undefined }]);
    await assert.rejects(recoverGeneration("other", id), /数据无效/);
    for (const invalid of ["../jobs", "0".repeat(36), `${id}?credits=0`]) await assert.rejects(recoverGeneration("owner", invalid), /数据无效/);
    assert.equal(calls.length, 2);
    globalThis.fetch = async () => Response.json({ error: "missing", code: "generation_request_missing" }, { status: 404 });
    await assert.rejects(recoverGeneration("owner", id), error => error instanceof GenerationError && error.code === "generation_request_missing");
    globalThis.fetch = async () => Response.json({ error: "已清理" }, { status: 410 });
    await assert.rejects(recoverGeneration("owner", id), error => error instanceof GenerationError && error.status === 410 && !error.code);
  } finally { globalThis.fetch = old; }
});
test("private reference metadata cannot redirect previews to executable, public or another reference URL", () => {
  const reference = { id, name: "原创森林.png", mimeType: "image/png", byteLength: 68, width: 1, height: 1, assetUrl: `/api/backend/v1/generation/reference-assets/${id}` };
  assert.deepEqual(parseGenerationReference(reference), reference);
  assert.deepEqual(parseGenerationJob({ ...job, referenceImage: reference }).referenceImage, reference);
  assert.deepEqual(parseGenerationReference({ ...reference, byteLength: 12 * 1024 * 1024 }), { ...reference, byteLength: 12 * 1024 * 1024 });
  for (const patch of [{ assetUrl: "javascript:alert(1)" }, { assetUrl: "https://external.example/a.png" }, { name: "../path.png" }, { width: 8193 }, { mimeType: "image/svg+xml" }, { byteLength: 0 }]) {
    assert.throws(() => parseGenerationReference({ ...reference, ...patch }));
    assert.throws(() => parseGenerationJob({ ...job, referenceImage: { ...reference, ...patch } }));
  }
});
test("reference client sends one bounded upload and rejects cross-account or invalid reference responses", async () => {
  const old = globalThis.fetch;
  const reference = { id, name: "原创森林.png", mimeType: "image/png", byteLength: 3, width: 1, height: 1, assetUrl: `/api/backend/v1/generation/reference-assets/${id}` };
  const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method, body: init?.body }); return Response.json({ accountId: "owner", reference, deleted: true }); };
    assert.deepEqual(await uploadGenerationReference("owner", new File([new Uint8Array([1, 2, 3])], reference.name, { type: "image/png" })), reference);
    assert.deepEqual(JSON.parse(String(calls[0].body)), { accountId: "owner", name: reference.name, dataUrl: "data:image/png;base64,AQID" });
    assert.deepEqual(await fetchGenerationReference("owner", id), reference);
    await deleteGenerationReference("owner", id);
    assert.deepEqual(calls.map(call => call.method), ["POST", "GET", "DELETE"]);
    for (const invalid of ["../jobs", `${id}?credits=0`]) { await assert.rejects(fetchGenerationReference("owner", invalid), /数据无效/); await assert.rejects(deleteGenerationReference("owner", invalid), /数据无效/); }
    assert.equal(calls.length, 3);
    await assert.rejects(uploadGenerationReference("owner", new File(["x"], "x.svg", { type: "image/svg+xml" })), /PNG/);
    globalThis.fetch = async () => Response.json({ accountId: "other", reference });
    await assert.rejects(fetchGenerationReference("owner", id), /数据无效/);
    globalThis.fetch = async () => Response.json({ accountId: "owner", reference: { ...reference, id: "89898989-8989-4898-8989-898989898989" } });
    await assert.rejects(fetchGenerationReference("owner", id), /数据无效/);
  } finally { globalThis.fetch = old; }
});
