import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildComfyGraph } from "../src/lib/drama-comfy";
test("self hosted graph uses 480P aligned frames and eight step accelerator", () => {
  const g = buildComfyGraph("t2v", "A cat", "9:16");
  assert.equal(g["7"].inputs.width, 480);
  assert.equal(g["7"].inputs.height, 864);
  assert.equal(g["7"].inputs.length, 362);
  assert.equal(g["10"].inputs.steps, 8);
  assert.equal(g["15"].inputs.fps, 24);
  assert.equal(
    g["1"].inputs.unet_name,
    "10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors",
  );
  assert.ok(!g["5"]);
  assert.deepEqual(g["6"].inputs.model, ["1", 0]);
  assert.ok(!g["7"].inputs.first_frame);
  for (const n of Object.values(g)) {
    for (const v of Object.values(n.inputs)) {
      if (Array.isArray(v)) assert.ok(g[v[0]], "all graph links resolve");
    }
  }
});
test("I2V and reference mode route images to real ComfyUI conditioning inputs", () => {
  const i = buildComfyGraph("i2v", "test", "16:9", ["first.png", "last.png"]);
  assert.deepEqual(i["7"].inputs.first_frame, ["20", 0]);
  assert.deepEqual(i["7"].inputs.last_frame, ["21", 0]);
  const r = buildComfyGraph("ri2v", "Image 1 is the actor", "1:1", ["ref.png"]);
  assert.equal(r["7"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.deepEqual(r["7"].inputs["ref_images.ref_image_0"], ["20", 0]);
  assert.equal(r["7"].inputs.prompt, "<Picture 1> is the actor");
  assert.equal(r["7"].inputs.ref_image_size, "match");
});
test("8 seconds uses a single bounded H3 window", () => {
  const g = buildComfyGraph("t2v", "A cat", "9:16", [], 7, 8);
  assert.equal(g["7"].inputs.length, 194);
  assert.ok(!g["107"]);
  assert.ok(!g["50"]);
});
test("legacy INT8 H3 still loads the converted turbo LoRA", () => {
  const g = buildComfyGraph(
    "t2v",
    "A cat",
    "9:16",
    [],
    1,
    15,
    [],
    "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  );
  assert.equal(g["5"].class_type, "LoraLoaderModelOnly");
  assert.deepEqual(g["6"].inputs.model, ["5", 0]);
});
