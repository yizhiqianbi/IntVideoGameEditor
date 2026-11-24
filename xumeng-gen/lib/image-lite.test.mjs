import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IMAGE_LITE_SIZES,
  imageLiteBody,
  imageLiteCredentials,
  imageLitePrompt,
  imageLiteRead,
  imageLiteSize,
  imageLiteSizeForPixels,
  imageLiteTaskId,
  imageResultUrlAllowed,
} from "./image-lite.mjs";

const ENV = {
  TOKENHUB_BASE_URL: "https://tokenhub-intl.tencentcloudmaas.com",
  TOKENHUB_IMAGE_LITE_API_KEY: "lite-test-key",
  TOKENHUB_IMAGE_LITE_MODEL: "wand-vega-image-lite",
};

test("image lite credentials only accept the tokenhub intl host", () => {
  assert.deepEqual(imageLiteCredentials(ENV), {
    key: "lite-test-key",
    base: "https://tokenhub-intl.tencentcloudmaas.com",
    model: "wand-vega-image-lite",
  });
  assert.equal(imageLiteCredentials({ ...ENV, TOKENHUB_IMAGE_LITE_API_KEY: "" }), null);
  assert.equal(imageLiteCredentials({ ...ENV, TOKENHUB_BASE_URL: "https://evil.example.com" }), null);
  assert.equal(imageLiteCredentials({ ...ENV, TOKENHUB_BASE_URL: "https://tokenhub-intl.tencentcloudmaas.com/v1" }), null);
});

test("image lite task ids look like provider ids", () => {
  assert.equal(imageLiteTaskId("1532281309-wand_vega_image_1_0_lite-db42d95582bc4f5b971fd6c29c50254fc9"), true);
  assert.equal(imageLiteTaskId("1532281309-wand_vega_image_1_0_lite-e85bb4592aa74d9fa06e8e0753d3168dtg"), true);
  assert.equal(imageLiteTaskId("fl2val4b1-s8-9f0a4413-60a7-44dd-8d5e-8875fedce196"), false);
  assert.equal(imageLiteTaskId(""), false);
});

test("image sizes map ratios to the tested 1K presets", () => {
  assert.equal(imageLiteSize("portrait"), "1024x1536");
  assert.equal(imageLiteSize("landscape"), "1536x1024");
  assert.equal(imageLiteSize("square"), "1024x1024");
  assert.equal(imageLiteSize("unknown"), IMAGE_LITE_SIZES.square);
  assert.equal(imageLiteSizeForPixels(720, 1280), "1024x1536");
  assert.equal(imageLiteSizeForPixels(1280, 720), "1536x1024");
  assert.equal(imageLiteSizeForPixels(1024, 1024), "1024x1024");
  assert.equal(imageLiteSizeForPixels(0, 0), "1024x1024");
});

test("image lite prompt turns angle-bracket placeholders into words", () => {
  const prompt = imageLitePrompt("把 <image2> 的脸换到 <image1> 里的人物脸上。");
  assert.equal(prompt, "把 第二张参考图 的脸换到 第一张参考图 里的人物脸上。");
});

test("text body has no input while reference body lists each image", () => {
  const text = imageLiteBody({ prompt: "海边的灯塔。", size: "square" });
  assert.equal(text.model, "wand-vega-image-lite");
  assert.equal(text.size, "1024x1024");
  assert.equal(text.input, undefined);
  const reference = imageLiteBody({
    prompt: "把第二张的脸换到第一张。",
    imageUrls: ["https://cdn.test/scene.jpg", "https://cdn.test/face.jpg"],
    size: "portrait",
  });
  assert.deepEqual(reference.input, [
    { content: [{ type: "input_image", image_url: "https://cdn.test/scene.jpg" }] },
    { content: [{ type: "input_image", image_url: "https://cdn.test/face.jpg" }] },
  ]);
  assert.equal(reference.size, "1024x1536");
});

test("image lite read maps provider states", () => {
  assert.deepEqual(imageLiteRead({ status: "in_progress" }), { phase: "pending", url: "", error: "" });
  assert.deepEqual(imageLiteRead({ status: "completed", data: [{ url: "https://cos.test/a.png" }] }), {
    phase: "done",
    url: "https://cos.test/a.png",
    error: "",
  });
  assert.equal(imageLiteRead({ status: "failed", error: "policy" }).phase, "failed");
  assert.equal(imageLiteRead({ status: "failed", error: "policy" }).error, "policy");
  assert.equal(imageLiteRead({ status: "completed", data: [] }).phase, "failed");
});

test("only tencent cos urls count as image lite results", () => {
  assert.equal(imageResultUrlAllowed("https://data-singapore-1378942524.cos.ap-singapore.myqcloud.com/a.png?q=1"), true);
  assert.equal(imageResultUrlAllowed("https://evil.example.com/a.png"), false);
  assert.equal(imageResultUrlAllowed("http://data-singapore-1378942524.cos.ap-singapore.myqcloud.com/a.png"), false);
  assert.equal(imageResultUrlAllowed("nope"), false);
});
