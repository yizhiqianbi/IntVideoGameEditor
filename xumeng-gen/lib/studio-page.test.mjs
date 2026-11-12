import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImageVideo, buildTextImage, handleImageVideo, handleTextImage } from "./studio-page.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function request(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-adult-confirmed": "1", ...headers },
    body: JSON.stringify(body),
  });
}

test("text image keeps the sentence and chosen style", () => {
  const built = buildTextImage({ prompt: "雨夜的月台，一个穿深色外套的女人回头。", style: "photo", clarity: "uhd" });
  assert.equal(built.ok, true);
  assert.match(built.prompt, /雨夜的月台/);
  assert.match(built.prompt, /写实/);
  assert.match(built.prompt, /超清/);
});

test("text image rejects an empty sentence and extra fields", () => {
  assert.equal(buildTextImage({ prompt: "  " }).error, "先写下要画的画面。");
  assert.equal(buildTextImage({ prompt: "一个成年旅人。", path: "/api/public/generate/undress" }).code, "field-forbidden");
});

test("image video maps 8 and 20 seconds onto the existing modules", () => {
  const short = buildImageVideo({ image: PNG, action: "转过身，看向镜头。", seconds: "8" });
  assert.equal(short.ok, true);
  assert.equal(short.id, "ai_chuangzuo_tushengshipin_8s");
  assert.equal(short.values.duration, undefined);
  assert.equal(short.files.img_url.type, "image/png");
  const long = buildImageVideo({ image: PNG, seconds: "20" });
  assert.equal(long.id, "i2v_10eros");
  assert.equal(long.values.duration, "20");
  assert.equal(long.values.positive_prompt, "按画面自然动起来");
});

test("image video rejects other durations", () => {
  const built = buildImageVideo({ image: PNG, action: "转过身。", seconds: "5" });
  assert.equal(built.ok, false);
  assert.equal(built.error, "时长只能是 8 秒或 20 秒。");
});

test("handlers forward only the built job", async () => {
  const seen = [];
  const image = await handleTextImage(request("http://127.0.0.1:3488/api/text-image", {
    prompt: "一个三十岁的旅人站在月台。",
  }), {
    forwardImage(prompt) {
      seen.push(prompt);
      return new Response("png", { headers: { "content-type": "image/png" } });
    },
  });
  assert.equal(image.status, 200);
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0], /undress|face-swap/);

  const video = await handleImageVideo(request("http://127.0.0.1:3488/api/image-video", {
    image: PNG,
    action: "转过身。",
    seconds: "8",
    id: "generate-undress",
  }), {
    forwardVideo(payload) {
      seen.push(payload.id);
      return new Response("mp4", { headers: { "content-type": "video/mp4" } });
    },
  });
  assert.equal(video.status, 400);
  assert.deepEqual(seen.slice(1), []);
});
