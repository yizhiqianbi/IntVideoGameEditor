import assert from "node:assert/strict";
import { test } from "node:test";
import { frameSize, imageRequest, imageSize, ratioSize, wandImageTaskId } from "./wand-image.mjs";

test("text jobs use the WAND image model and the chosen size", () => {
  const body = imageRequest({ prompt: "雨夜的月台。", clarity: "sd" });
  assert.equal(body.model, "wand-vega-image-1.5-pro");
  assert.equal(body.size, "1280x720");
  assert.equal(body.input, undefined);
  assert.equal(imageSize("hd"), "2560x1440");
  assert.equal(imageSize("uhd"), "3840x2160");
  assert.equal(ratioSize("portrait"), "1440x2560");
  assert.equal(ratioSize("square"), "2048x2048");
  assert.equal(wandImageTaskId("251380669-VegaImage-f91e7435e1e34dfa9898a451946bb3d3"), true);
  assert.equal(wandImageTaskId("1500000000-wand_vega_image_1_5_pro-abcdef0123456789"), true);
  assert.equal(wandImageTaskId("not-a-task"), false);
  assert.equal(wandImageTaskId("1500000000-VegaImage-abc/def"), false);
});

test("reference jobs attach the hosted image", () => {
  const body = imageRequest({ prompt: "改成夜景。", imageUrl: "https://example.com/a.jpg", clarity: "hd" });
  assert.equal(body.input[0].content[0].type, "input_image");
  assert.equal(body.input[0].content[0].image_url, "https://example.com/a.jpg");
  assert.equal(body.size, "2560x1440");
});

test("face edits keep the scene first and the face second", () => {
  const body = imageRequest({
    prompt: "把 <image2> 换到 <image1>。",
    imageUrls: ["https://example.com/scene.jpg", "https://example.com/face.jpg"],
    size: frameSize(800, 1200),
  });
  assert.deepEqual(body.input[0].content.map(item => item.image_url), [
    "https://example.com/scene.jpg",
    "https://example.com/face.jpg",
  ]);
  assert.equal(body.size, "1440x2560");
});
