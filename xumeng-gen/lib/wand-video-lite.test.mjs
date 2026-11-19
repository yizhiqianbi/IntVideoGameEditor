import assert from "node:assert/strict";
import { test } from "node:test";
import {
  videoLiteBody,
  videoLiteCredentials,
  videoLiteDuration,
  videoLiteRead,
  videoLiteTaskId,
} from "./wand-video-lite.mjs";

const ENV = { TOKENHUB_BASE_URL: "https://tokenhub-intl.tencentcloudmaas.com", TOKENHUB_IMAGE_LITE_API_KEY: "lite-key" };

test("video lite credentials reuse the tokenhub key and allow a model override", () => {
  const base = videoLiteCredentials(ENV);
  assert.equal(base.base, "https://tokenhub-intl.tencentcloudmaas.com");
  assert.equal(base.key, "lite-key");
  assert.equal(base.model, "wand-vega-video-1.5-lite");
  assert.equal(videoLiteCredentials({ ...ENV, TOKENHUB_VIDEO_LITE_MODEL: "wand-vega-video-1.5-pro" }).model, "wand-vega-video-1.5-pro");
  assert.equal(videoLiteCredentials({ ...ENV, TOKENHUB_VIDEO_LITE_API_KEY: "video-key" }).key, "video-key");
  assert.equal(videoLiteCredentials({ ...ENV, TOKENHUB_IMAGE_LITE_API_KEY: "" }), null);
  assert.equal(videoLiteCredentials({ ...ENV, TOKENHUB_BASE_URL: "https://evil.example.com" }), null);
});

test("video lite task ids match the provider format", () => {
  assert.equal(videoLiteTaskId("1532281309-wand_vega_video_1_5_lite-77cb31e4759941de903d73d105963224-h0c"), true);
  assert.equal(videoLiteTaskId("1532281309-wand_vega_image_1_0_lite-db42d95582bc4f5b971fd6c29c50254fc9"), false);
  assert.equal(videoLiteTaskId("fl2val4b1-s8-9f0a4413-60a7-44dd-8d5e-8875fedce196"), false);
});

test("video lite duration is clamped to 4-15 seconds", () => {
  assert.equal(videoLiteDuration(2), 4);
  assert.equal(videoLiteDuration(5), 5);
  assert.equal(videoLiteDuration(20), 15);
  assert.equal(videoLiteDuration("bad"), 5);
});

test("text body carries text and params", () => {
  const body = videoLiteBody({ prompt: "海边的灯塔。", duration: 5, resolution: "768P", ratio: "16:9" });
  assert.deepEqual(body.content, [{ type: "text", text: "海边的灯塔。" }]);
  assert.equal(body.duration, 5);
  assert.equal(body.resolution, "720P");
  assert.equal(body.ratio, "16:9");
});

test("first frame body omits ratio and uses first_frame role", () => {
  const body = videoLiteBody({ prompt: "镜头缓缓推近。", firstFrame: "https://cdn.test/frame.jpg", duration: 5, resolution: "720P" });
  assert.deepEqual(body.content, [
    { type: "text", text: "镜头缓缓推近。" },
    { type: "image_url", image_url: { url: "https://cdn.test/frame.jpg" }, role: "first_frame" },
  ]);
  assert.equal(body.ratio, undefined);
});

test("reference body wraps image and video with roles", () => {
  const body = videoLiteBody({
    prompt: "按参考视频的动作生成。",
    imageUrls: ["https://cdn.test/face.jpg"],
    videoUrls: ["https://cdn.test/source.mp4"],
    duration: 8,
    resolution: "1080P",
    ratio: "adaptive",
  });
  assert.deepEqual(body.content.slice(1), [
    { type: "image_url", image_url: { url: "https://cdn.test/face.jpg" }, role: "reference_image" },
    { type: "video_url", video_url: { url: "https://cdn.test/source.mp4" }, role: "reference_video" },
  ]);
  assert.equal(body.ratio, "adaptive");
  assert.equal(body.duration, 8);
  assert.equal(body.resolution, "1080P");
});

test("video lite read maps provider states", () => {
  assert.deepEqual(videoLiteRead({ status: "queued" }), { phase: "pending", url: "", error: "" });
  assert.deepEqual(videoLiteRead({ status: "running" }), { phase: "pending", url: "", error: "" });
  assert.deepEqual(videoLiteRead({ status: "succeeded", content: { video_url: "https://cos.test/a.mp4" } }), {
    phase: "done",
    url: "https://cos.test/a.mp4",
    error: "",
  });
  assert.equal(videoLiteRead({ status: "failed", error: { message: "bad" } }).phase, "failed");
  assert.equal(videoLiteRead({ status: "succeeded", content: {} }).phase, "failed");
});
