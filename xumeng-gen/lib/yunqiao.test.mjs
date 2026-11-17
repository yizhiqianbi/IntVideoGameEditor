import assert from "node:assert/strict";
import { test } from "node:test";
import { pollSeedream, seedreamBody, wanBody, yunqiaoCredentials } from "./yunqiao.mjs";

test("text jobs use Seedream text to image at 1K", () => {
  const body = seedreamBody({ prompt: "雨夜的月台。", clarity: "sd" });
  assert.equal(body.model, "seedream/5-pro-text-to-image");
  assert.equal(body.input.quality, "basic");
  assert.equal(body.input.aspect_ratio, "16:9");
  assert.equal(body.input.image_urls, undefined);
});

test("reference jobs use Seedream image to image and keep image order", () => {
  const body = seedreamBody({
    prompt: "换成夜景。",
    clarity: "hd",
    imageUrls: ["https://cdn.example/scene.png", "https://cdn.example/face.png"],
    width: 720,
    height: 1280,
  });
  assert.equal(body.model, "seedream/5-pro-image-to-image");
  assert.equal(body.input.quality, "high");
  assert.equal(body.input.aspect_ratio, "9:16");
  assert.deepEqual(body.input.image_urls, ["https://cdn.example/scene.png", "https://cdn.example/face.png"]);
});

test("first frame video sends one image and leaves references off", () => {
  const body = wanBody({
    prompt: "镜头向前。",
    seconds: 8,
    mode: "first",
    imageUrl: "https://cdn.example/frame.png",
    imageUrls: ["https://cdn.example/frame.png", "https://cdn.example/other.png"],
    width: 1280,
    height: 720,
  });
  assert.equal(body.model, "w3.0-video-prime-spicy");
  assert.equal(body.image_url, "https://cdn.example/frame.png");
  assert.equal(body.reference_images, undefined);
  assert.equal(body.duration, 8);
  assert.equal(body.enable_audio, true);
  assert.equal(body.metadata.resolution, "720p");
  assert.equal(body.metadata.ratio, "16:9");
  assert.equal(body.metadata.prompt_extend, true);
});

test("reference video sends only the reference list", () => {
  const body = wanBody({
    prompt: "参考 Image 1。",
    seconds: 6,
    mode: "reference",
    imageUrl: "https://cdn.example/should-not-be-first.png",
    imageUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
  });
  assert.deepEqual(body.reference_images, ["https://cdn.example/a.png", "https://cdn.example/b.png"]);
  assert.equal(body.image_url, undefined);
});

test("a slow image status check stays pending", async () => {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  const result = await pollSeedream("task_abcdefgh", {
    env: { YUNQIAO_API_KEY: "secret", YUNQIAO_API_BASE: "https://la-sealion.inaiai.com" },
    fetchImpl: async () => { throw error; },
  });
  assert.equal(result, null);
});

test("missing Yunqiao credentials stay closed", () => {
  assert.equal(yunqiaoCredentials({}), null);
  assert.equal(yunqiaoCredentials({ YUNQIAO_API_KEY: "secret", YUNQIAO_API_BASE: "http://la-sealion.inaiai.com" }), null);
});
