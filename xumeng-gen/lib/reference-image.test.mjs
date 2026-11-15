import assert from "node:assert/strict";
import { test } from "node:test";
import { fitVideoFrame, normalizeImage, videoFramePlan } from "./reference-image.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BMP = Buffer.from([
  0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00,
  0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x18, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00,
]);

test("png stays png", async () => {
  const image = await normalizeImage(PNG);
  assert.equal(image.ok, true);
  assert.equal(image.type, "image/png");
});

test("video frames stay inside the model limits", () => {
  assert.deepEqual(videoFramePlan(1280, 720), { cropWidth: 1280, cropHeight: 720, width: 1280, height: 720 });
  assert.deepEqual(videoFramePlan(100, 1000), { cropWidth: 100, cropHeight: 250, width: 300, height: 750 });
  assert.deepEqual(videoFramePlan(8000, 4000), { cropWidth: 8000, cropHeight: 4000, width: 6000, height: 3000 });
});

test("a tiny frame is enlarged before video registration", async () => {
  const image = await normalizeImage(PNG);
  const fitted = await fitVideoFrame(image.bytes);
  assert.equal(fitted.type, "image/jpeg");
  assert.equal(fitted.bytes[0], 0xff);
  assert.ok(fitted.bytes.length > image.bytes.length);
});

test("bmp is converted to jpeg", async () => {
  const image = await normalizeImage(`data:image/bmp;base64,${BMP.toString("base64")}`);
  assert.equal(image.ok, true);
  assert.equal(image.type, "image/jpeg");
  assert.equal(image.bytes[0], 0xff);
  assert.equal(image.bytes[1], 0xd8);
});
