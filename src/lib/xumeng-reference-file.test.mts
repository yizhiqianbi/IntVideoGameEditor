import test from "node:test";
import assert from "node:assert/strict";
import referenceFileModule from "./xumeng-reference-file";

const { referenceFileType } = referenceFileModule as typeof import("./xumeng-reference-file");

test("phone photos keep a usable image type when the picker omits one", () => {
  assert.equal(referenceFileType({ type: "", name: "IMG_2048.JPG" }), "image/jpeg");
  assert.equal(referenceFileType({ type: "image/jpg", name: "photo" }), "image/jpeg");
  assert.equal(referenceFileType({ type: "", name: "shot.HEIC" }), "");
  assert.equal(referenceFileType({ type: "image/png", name: "card.webp" }), "image/png");
});
