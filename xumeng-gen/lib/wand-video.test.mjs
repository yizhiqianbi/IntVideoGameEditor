import assert from "node:assert/strict";
import { test } from "node:test";
import { materialProblem, videoTaskBody, wandCredentials } from "./wand-video.mjs";

test("image to video uses the first frame and the requested duration", () => {
  const body = videoTaskBody({ subAppId: 7, prompt: "转过身。", assetId: "asset-abc", seconds: 20 });
  assert.equal(body.ModelName, "wand-vega-video");
  assert.equal(body.ModelVersion, "1.5-pro");
  assert.equal(body.FileInfos[0].Usage, "FirstFrame");
  assert.equal(body.FileInfos[0].Url, "asset://asset-abc");
  assert.equal(body.OutputConfig.Duration, 20);
  assert.equal(body.OutputConfig.AspectRatio, "adaptive");
  assert.equal(body.OutputConfig.AudioGeneration, "Disabled");
  assert.match(body.ExtInfo, /Moderation_L1/);
});

test("reference mode sends every image as a reference frame", () => {
  const body = videoTaskBody({
    subAppId: 7,
    prompt: "两个人走进房间。",
    assets: ["asset-a", "asset-b"],
    seconds: 8,
    mode: "reference",
  });
  assert.deepEqual(body.FileInfos.map(file => file.Usage), ["Reference", "Reference"]);
  assert.deepEqual(body.FileInfos.map(file => file.Url), ["asset://asset-a", "asset://asset-b"]);
  assert.equal(body.OutputConfig.AspectRatio, "16:9");
  assert.match(body.ExtInfo, /omni_reference_task_type/);
});

test("missing video credentials stay closed", () => {
  assert.equal(wandCredentials({}), null);
});

test("a finished material without an asset keeps the provider reason", () => {
  assert.equal(
    materialProblem({ Status: "FINISH", ErrCode: 4000, Message: "image download failed", ErrCodeExt: "InvalidImage" }),
    "参考图没有登记成功。image download failed",
  );
  assert.equal(materialProblem({ Status: "FINISH", ErrCode: 0, Message: "", ErrCodeExt: "" }), "参考图没有登记成功。");
});
