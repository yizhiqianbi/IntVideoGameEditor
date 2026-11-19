import assert from "node:assert/strict";
import { test } from "node:test";
import { wanArtifactUrl, wanBody, wanCredentials, wanDuration, wanRead, wanResultAllowed, wanTaskId } from "./wan-video.mjs";

const ENV = { YUNQIAO_API_BASE: "https://la-sealion.inaiai.com", YUNQIAO_API_KEY: "key" };

test("wan credentials require the yunqiao host and key", () => {
  assert.deepEqual(wanCredentials(ENV), { base: "https://la-sealion.inaiai.com", key: "key" });
  assert.equal(wanCredentials({ ...ENV, YUNQIAO_API_BASE: "https://evil.example.com" }), null);
  assert.equal(wanCredentials({ ...ENV, YUNQIAO_API_KEY: "" }), null);
});

test("wan task ids match the provider format", () => {
  assert.equal(wanTaskId("task_Vobe7N4xiEjxGRVEntDR2BgkSEBVr2YK"), true);
  assert.equal(wanTaskId("fl2val4b1-s8-deadbeef"), false);
});

test("wan duration is clamped to 2-30 seconds", () => {
  assert.equal(wanDuration(1), 2);
  assert.equal(wanDuration(5), 5);
  assert.equal(wanDuration(60), 30);
  assert.equal(wanDuration("bad"), 5);
});

test("wan body builds reference mode", () => {
  const body = wanBody({ prompt: "参考 Image 1 换脸。", imageUrls: ["https://cdn.test/face.jpg"], videoUrls: ["https://cdn.test/src.mp4"], duration: 5 });
  assert.equal(body.model, "w3.0-video-prime-spicy");
  assert.equal(body.duration, 5);
  assert.equal(body.enable_audio, true);
  assert.deepEqual(body.metadata, { resolution: "1080p", ratio: "9:16", prompt_extend: true });
  assert.deepEqual(body.reference_images, ["https://cdn.test/face.jpg"]);
  assert.deepEqual(body.reference_videos, ["https://cdn.test/src.mp4"]);
  assert.equal(body.image_url, undefined);
});

test("wan body first frame mode uses image_url", () => {
  const body = wanBody({ prompt: "镜头推近。", firstFrame: "https://cdn.test/first.jpg", duration: 5, resolution: "720p", ratio: "16:9" });
  assert.equal(body.image_url, "https://cdn.test/first.jpg");
  assert.equal(body.metadata.resolution, "720p");
  assert.equal(body.metadata.ratio, "16:9");
  assert.equal(body.reference_images, undefined);
});

test("wan query states normalize", () => {
  assert.deepEqual(wanRead({ status: "IN_PROGRESS" }), { phase: "pending", error: "" });
  assert.deepEqual(wanRead({ status: "SUCCESS" }), { phase: "done", error: "" });
  assert.equal(wanRead({ status: "FAILURE", fail_reason: "bad" }).phase, "failed");
  assert.match(wanRead({ status: "FAILURE", fail_reason: "bad" }).error, /bad/);
});

test("wan artifacts pick the video content_url", () => {
  assert.equal(wanArtifactUrl({ artifacts: [{ key: "video", type: "video", content_url: "https://cdn.test/v.mp4" }] }), "https://cdn.test/v.mp4");
  assert.equal(wanArtifactUrl({ data: { artifacts: [{ type: "video", url: "https://cdn.test/v2.mp4" }] } }), "https://cdn.test/v2.mp4");
  assert.equal(wanArtifactUrl({ artifacts: [] }), "");
  assert.equal(wanResultAllowed("https://cdn.test/v.mp4"), true);
  assert.equal(wanResultAllowed("http://cdn.test/v.mp4"), false);
});
