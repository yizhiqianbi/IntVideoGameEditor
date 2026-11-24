import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATE_DEFAULT_COUNT,
  CONTINUE_DEFAULT_COUNT,
  NOVEL_COPY,
  buildNovelRequest,
  defaultCount,
  parseNovelResponse,
  submitNovel,
} from "./novel-client.js";

test("form defaults use 4000 for new writing and 2000 for continue", () => {
  assert.equal(defaultCount("new"), "4000");
  assert.equal(defaultCount("continue"), "2000");
  assert.equal(GENERATE_DEFAULT_COUNT, 4000);
  assert.equal(CONTINUE_DEFAULT_COUNT, 2000);
});

test("serializer sends every filled field and omits empty optionals", () => {
  const full = buildNovelRequest({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: "旅人沉稳少言。",
    location_scene: "多雾的港口。",
    details: "用纪实口吻写。",
    count: "4000",
  }, { adultConfirmed: true });
  assert.equal(full.url, "/api/novel");
  assert.deepEqual(JSON.parse(full.body), {
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: "旅人沉稳少言。",
    location_scene: "多雾的港口。",
    details: "用纪实口吻写。",
    count: "4000",
  });

  const sparse = JSON.parse(buildNovelRequest({
    mode: "new",
    description: "一个三十岁的旅人走进港口旧书店。",
    character_setting: " ",
    location_scene: "",
    details: "",
    count: "4000",
  }).body);
  assert.deepEqual(Object.keys(sparse).sort(), ["count", "description", "mode"]);
});

test("client does not fetch before the age gate", async () => {
  const result = await submitNovel({ mode: "new", description: "一个三十岁的旅人走进港口旧书店。" }, {
    adultConfirmed: false,
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "adult-required");
});

test("success text and failure states are distinguished", () => {
  const ok = parseNovelResponse(200, "text/plain; charset=utf-8", "港口的雾还没散。");
  assert.equal(ok.ok, true);
  assert.equal(ok.text, "港口的雾还没散。");
  const fail = parseNovelResponse(503, "application/json", { error: "渠道试接还没配上密钥。", code: "unconfigured" });
  assert.equal(fail.ok, false);
  assert.equal(fail.error, "渠道试接还没配上密钥。");
  const timeout = parseNovelResponse(504, "application/json", { error: "小说这次等太久了。请再试一次。", code: "timeout" });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, "timeout");
  assert.match(NOVEL_COPY.countHint, /4000/);
});
