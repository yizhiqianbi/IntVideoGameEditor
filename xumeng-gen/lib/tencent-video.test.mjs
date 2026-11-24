import assert from "node:assert/strict";
import { test } from "node:test";
import {
  h3Body,
  h3Credentials,
  h3Duration,
  h3Read,
  h3TaskId,
  resultUrlAllowed,
} from "./tencent-video.mjs";

const ENV = { H3_BASE_URL: "https://gateway-bd8c6097a942.edgeone-aigateway-intl.com", H3_API_KEY: "h3-test-key" };

test("h3 credentials only accept the configured edgeone gateway", () => {
  assert.deepEqual(h3Credentials(ENV), { key: "h3-test-key", base: "https://gateway-bd8c6097a942.edgeone-aigateway-intl.com" });
  assert.equal(h3Credentials({ ...ENV, H3_API_KEY: "" }), null);
  assert.equal(h3Credentials({ ...ENV, H3_BASE_URL: "https://evil.example.com" }), null);
  assert.equal(h3Credentials({ ...ENV, H3_BASE_URL: "http://gateway-bd8c6097a942.edgeone-aigateway-intl.com" }), null);
});

test("h3 task ids look like provider ids", () => {
  assert.equal(h3TaskId("fl2val4b1-s8-9f0a4413-60a7-44dd-8d5e-8875fedce196"), true);
  assert.equal(h3TaskId("ref2val4b1-s8-66d146d5-2537-4ebf-8852-87dceab9dd04"), true);
  assert.equal(h3TaskId("1532281309-wand_vega_image_1_0_lite-db42d95582bc4f5b971fd6c29c50254fc9"), false);
  assert.equal(h3TaskId(""), false);
});

test("h3 duration is clamped to the documented 4-15 seconds", () => {
  assert.equal(h3Duration(2), 4);
  assert.equal(h3Duration(5), 5);
  assert.equal(h3Duration(11.6), 12);
  assert.equal(h3Duration(30), 15);
  assert.equal(h3Duration("bad"), 5);
});

test("text to video body carries text, duration, resolution and ratio", () => {
  const body = h3Body({ prompt: "海边的灯塔。", duration: 5, resolution: "480P", ratio: "16:9" });
  assert.deepEqual(body.content, [{ type: "text", text: "海边的灯塔。" }]);
  assert.equal(body.duration, 5);
  assert.equal(body.resolution, "480P");
  assert.equal(body.ratio, "16:9");
  assert.equal(body.remove_audio, false);
});

test("first frame body omits ratio so the picture decides the frame", () => {
  const body = h3Body({ prompt: "镜头缓缓推近。", firstFrame: "https://cdn.test/frame.jpg", duration: 5, resolution: "720P" });
  assert.deepEqual(body.content, [
    { type: "text", text: "镜头缓缓推近。" },
    { type: "image_url", image_url: { url: "https://cdn.test/frame.jpg" }, role: "first_frame" },
  ]);
  assert.equal(body.ratio, undefined);
  assert.equal(body.duration, 5);
});

test("reference body wraps the face image and reference video with roles", () => {
  const body = h3Body({
    prompt: "按参考视频的动作生成。",
    imageUrls: ["https://cdn.test/face.jpg"],
    videoUrls: ["https://cdn.test/source.mp4"],
    duration: 8,
    resolution: "720P",
    ratio: "adaptive",
  });
  assert.deepEqual(body.content.slice(1), [
    { type: "image_url", image_url: { url: "https://cdn.test/face.jpg" }, role: "reference_image" },
    { type: "video_url", video_url: { url: "https://cdn.test/source.mp4" }, role: "reference_video" },
  ]);
  assert.equal(body.ratio, "adaptive");
  assert.equal(body.duration, 8);
});

test("h3 read maps provider states", () => {
  assert.deepEqual(h3Read({ task: { status: "running" } }), { phase: "pending", url: "", error: "" });
  assert.deepEqual(h3Read({ task: { status: "succeeded", content: { url: "https://a.edgeone-ai.com/x.mp4" } } }), {
    phase: "done",
    url: "https://a.edgeone-ai.com/x.mp4",
    error: "",
  });
  assert.equal(h3Read({ task: { status: "failed", fail_reason: "bad input" } }).phase, "failed");
  assert.equal(h3Read({ task: { status: "failed", fail_reason: "bad input" } }).error, "bad input");
});

test("only edgeone artifact urls count as h3 results", () => {
  assert.equal(resultUrlAllowed("https://predictor-artifacts.edgeone-ai.com/predictors/x.mp4?sign=1"), true);
  assert.equal(resultUrlAllowed("https://evil.example.com/x.mp4"), false);
  assert.equal(resultUrlAllowed("http://predictor-artifacts.edgeone-ai.com/x.mp4"), false);
  assert.equal(resultUrlAllowed("not a url"), false);
});
