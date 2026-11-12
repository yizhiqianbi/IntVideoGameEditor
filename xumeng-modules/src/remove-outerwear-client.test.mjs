import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADULT_HEADER,
  OUTERWEAR_COPY,
  buildRemoveOuterwearRequest,
  parseRemoveOuterwearResponse,
  submitRemoveOuterwear,
} from "./remove-outerwear-client.js";

const IMAGE = "data:image/png;base64,aaa";

test("frontend copy stays on outerwear removal, not undress", () => {
  // assert.match(OUTERWEAR_COPY.title, /去外套/);
  // assert.doesNotMatch(OUTERWEAR_COPY.title, /脱衣/);
  // assert.equal(OUTERWEAR_COPY.detail, "上传一张人物图。");
  // assert.doesNotMatch(`${OUTERWEAR_COPY.detail} ${OUTERWEAR_COPY.hint}`, /脱衣|裸露|性化|不能填写/);
});

test("request builder never sends a user prompt", () => {
  const request = buildRemoveOuterwearRequest(IMAGE, { adultConfirmed: true });
  assert.equal(request.url, "/api/remove-outerwear");
  assert.equal(request.headers[ADULT_HEADER], "1");
  assert.deepEqual(JSON.parse(request.body), { image: IMAGE });
});

test("client blocks submit before the age gate", async () => {
  const result = await submitRemoveOuterwear(IMAGE, {
    adultConfirmed: false,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "adult-required");
});

test("client surfaces unconfigured and validation errors", () => {
  const unconfigured = parseRemoveOuterwearResponse(503, "application/json", {
    error: "去外套还没有配置可验证的安全编辑能力，因此不会调用任何去衣或通用改图接口。",
    code: "unconfigured",
  });
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.code, "unconfigured");
  const rejected = parseRemoveOuterwearResponse(422, "application/json", {
    error: "生成结果未通过安全校验，已丢弃。",
    code: "output-rejected",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "output-rejected");
});

test("client only treats image responses as success", () => {
  const failed = parseRemoveOuterwearResponse(200, "application/json", { error: "nope" });
  assert.equal(failed.ok, false);
  const ok = parseRemoveOuterwearResponse(200, "image/png", new Blob());
  assert.equal(ok.ok, true);
});
