import { test } from "node:test";
import assert from "node:assert/strict";
import models from "../src/lib/drama-models";
import comfy from "../src/lib/drama-comfy";
test("old requests retain H3 and unknown models are rejected", () => {
  assert.equal(models.validateGpuModel(undefined), "h3");
  assert.equal(models.validateGpuModel("ltx-sulphur"), "ltx-sulphur");
  assert.equal(models.validateGpuModel("ltx-pinkcherry"), "ltx-pinkcherry25");
  assert.equal(models.isLtxFamily("ltx-pinkcherry"), false);
  assert.equal(models.ltxSupportsRi2v("ltx-pinkcherry"), false);
  assert.equal(models.ltxSupportsRi2v("ltx-10eros"), false);
  assert.equal(models.ltxCheckpoint("ltx-10eros"), "10eros");
  assert.equal(models.prefersPinkCherry({ ready: true }), false);
  assert.deepEqual(models.studioVideoDefaults(), { modelPick: "auto" });
  assert.deepEqual(models.STUDIO_VIDEO_MODELS.map(model=>model.id), ['h3']);
  assert.throws(() => models.validateGpuModel("unknown"));
});
test("shot duration clamps to 3–15 for H3 and LTX", () => {
  assert.equal(models.parseShotDuration(8), 8);
  assert.equal(models.parseShotDuration(3), 3);
  assert.equal(models.parseShotDuration(2), 15);
  assert.equal(models.parseShotDuration(30), 15);
  assert.equal(models.clampLtxDuration(8), 8);
  assert.equal(models.h3Duration(8), 8);
  assert.equal(models.h3Duration(30), 15);
  assert.equal(models.ltxFrameCount(8), 193);
  assert.equal(models.ltxFrameCount(15), 361);
  assert.equal(models.h3FrameCount(8), 194);
  assert.equal(models.h3FrameCount(15), 362);
});
test("LTX is never silently routed to H3 or submitted", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("Unexpected fetch");
  };
  try {
    await assert.rejects(
      comfy.comfyGenerate({ videoModel: "ltx-sulphur" }),
      /LTX/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
