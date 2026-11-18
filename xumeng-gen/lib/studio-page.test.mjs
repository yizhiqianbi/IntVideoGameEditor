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

test("text image with a reference keeps the sentence and the image", () => {
  const built = buildTextImage({ prompt: "换成夜景，人不要动。", style: "anime", clarity: "hd", image: PNG });
  assert.equal(built.ok, true);
  assert.match(built.prompt, /换成夜景/);
  assert.match(built.prompt, /动漫/);
  assert.equal(built.image, PNG);
  assert.equal(buildTextImage({ prompt: "换成夜景，人不要动。", ratio: "landscape" }).ratio, "landscape");
  assert.equal(buildTextImage({ prompt: "换成夜景。", images: [PNG, PNG] }).ok, true);
  assert.equal(buildTextImage({ prompt: "换成夜景。", images: [PNG, PNG, PNG] }).error, "参考图最多两张。");
});

test("text image rejects an empty sentence and extra fields", () => {
  assert.equal(buildTextImage({ prompt: "  " }).error, "先写下要画的画面。");
  assert.equal(buildTextImage({ prompt: "一个成年旅人。", path: "/api/public/generate/undress" }).code, "field-forbidden");
});

test("image video accepts 5, 10 or 15 seconds", () => {
  const short = buildImageVideo({ image: PNG, action: "转过身，看向镜头。", seconds: "5" });
  assert.equal(short.ok, true);
  assert.equal(short.seconds, 5);
  assert.equal(short.values.duration, "5");
  assert.equal(short.files.img_url.type, "image/png");
  const chosen = buildImageVideo({ image: PNG, action: "镜头缓缓向前。", seconds: 15 });
  assert.equal(chosen.seconds, 15);
  assert.equal(chosen.values.duration, "15");
  assert.equal(chosen.values.positive_prompt, "镜头缓缓向前。");
  assert.equal(short.mode, "first");
});

test("reference video keeps every uploaded image", () => {
  const built = buildImageVideo({ images: [PNG, PNG], mode: "reference", action: "两个人走进房间。", seconds: "10" });
  assert.equal(built.ok, true);
  assert.equal(built.mode, "reference");
  assert.equal(built.images.length, 2);
  assert.equal(buildImageVideo({ images: Array(10).fill(PNG), mode: "reference", action: "两个人走进房间。", seconds: 10 }).images.length, 10);
  assert.equal(buildImageVideo({ images: Array(11).fill(PNG), mode: "reference", action: "两个人走进房间。", seconds: 10 }).error, "参考图最多十张。");
});

test("image video rejects durations outside 5, 10 and 15 seconds", () => {
  const built = buildImageVideo({ image: PNG, action: "转过身看向镜头。", seconds: "8" });
  assert.equal(built.ok, false);
  assert.equal(built.error, "时长只能是 5、10 或 15 秒。");
  assert.equal(buildImageVideo({ image: PNG, action: "转过身看向镜头。", seconds: "30" }).ok, false);
});

test("handlers forward only the built job", async () => {
  const seen = [];
  const image = await handleTextImage(request("http://127.0.0.1:3488/api/text-image", {
    prompt: "一个三十岁的旅人站在月台。",
  }), {
    forwardImage(body) {
      seen.push(body.prompt);
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
