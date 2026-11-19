import assert from "node:assert/strict";
import { test } from "node:test";
import { upscaleCredentials, upscaleEnabled, upscaleRead, upscaleTaskId } from "./video-upscale.mjs";

const ENV = { AIAPI_BASE_URL: "https://api.aiapi.test", AIAPI_APIKEY: "key", AIAPI_SECRETKEY: "secret" };

test("upscale is on by default and can be disabled", () => {
  assert.equal(upscaleEnabled({}), true);
  assert.equal(upscaleEnabled({ FACE_VIDEO_UPSCALE: "off" }), false);
  assert.equal(upscaleEnabled({ FACE_VIDEO_UPSCALE: "ON" }), true);
});

test("upscale task ids match the generated format", () => {
  assert.equal(upscaleTaskId("up-123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(upscaleTaskId("huanlian-face-video"), false);
  assert.equal(upscaleTaskId("up-"), false);
});

test("upscale credentials require https and all three values", () => {
  assert.deepEqual(upscaleCredentials(ENV), { base: "https://api.aiapi.test", apiKey: "key", secretKey: "secret" });
  assert.equal(upscaleCredentials({ ...ENV, AIAPI_BASE_URL: "http://api.aiapi.test" }), null);
  assert.equal(upscaleCredentials({ ...ENV, AIAPI_APIKEY: "" }), null);
  assert.equal(upscaleCredentials({ ...ENV, AIAPI_SECRETKEY: "" }), null);
});

test("upscale read maps channel states", () => {
  assert.deepEqual(upscaleRead({ status: 0 }), { phase: "pending", url: "", error: "" });
  assert.deepEqual(upscaleRead({ status: 2, out_data: ["https://cdn.test/hd.mp4"] }), {
    phase: "done",
    url: "https://cdn.test/hd.mp4",
    error: "",
  });
  assert.equal(upscaleRead({ status: 2, out_data: [] }).phase, "failed");
  assert.match(upscaleRead({ status: 3, message: "bad input" }).error, /bad input/);
  assert.equal(upscaleRead({ data: { status: 2, out_data: ["https://cdn.test/nested.mp4"] } }).phase, "done");
});
