import assert from "node:assert/strict";
import { test } from "node:test";
import { HUANLIAN_PROMPT, huanlianCredentials, huanlianRead, huanlianTaskId } from "./huanlian.mjs";

const ENV = { AIAPI_BASE_URL: "https://p0-api.inaiai.com", AIAPI_APIKEY: "key", AIAPI_SECRETKEY: "secret" };

test("huanlian credentials require https base and both keys", () => {
  assert.deepEqual(huanlianCredentials(ENV), { base: "https://p0-api.inaiai.com", apiKey: "key", secretKey: "secret" });
  assert.equal(huanlianCredentials({ ...ENV, AIAPI_APIKEY: "" }), null);
  assert.equal(huanlianCredentials({ ...ENV, AIAPI_BASE_URL: "http://p0-api.inaiai.com" }), null);
  assert.equal(huanlianCredentials({}), null);
});

test("huanlian task ids are the ones we generate for polling", () => {
  assert.equal(huanlianTaskId("face-video-0feae679-cd7f-4fc0-90fb-6f8d8d9bacf2"), true);
  assert.equal(huanlianTaskId("fl2val4b1-s8-9f0a4413-60a7-44dd-8d5e-8875fedce196"), false);
  assert.equal(huanlianTaskId("face-video-oops"), false);
});

test("huanlian read maps provider task states", () => {
  assert.deepEqual(huanlianRead({ status: 0 }), { phase: "pending", url: "", error: "" });
  assert.deepEqual(huanlianRead({ status: 2, out_data: ["https://images.aiaipic.win/x/video/a.mp4"] }), {
    phase: "done",
    url: "https://images.aiaipic.win/x/video/a.mp4",
    error: "",
  });
  const wrapped = huanlianRead({ data: { status: 2, out_data: ["https://images.aiaipic.win/x/video/b.mp4"] } });
  assert.equal(wrapped.phase, "done");
  assert.equal(wrapped.url, "https://images.aiaipic.win/x/video/b.mp4");
  assert.equal(huanlianRead({ status: 3, error: "face not found" }).phase, "failed");
  assert.equal(huanlianRead({ status: 3, error: "face not found" }).error, "face not found");
  assert.equal(huanlianRead({ status: 2, out_data: [] }).phase, "failed");
  assert.equal(huanlianRead({ status: 2, out_data: ["http://insecure.example/a.mp4"] }).phase, "failed");
});

test("default huanlian prompt keeps the source video and only swaps the face", () => {
  assert.match(HUANLIAN_PROMPT, /换到视频里的人物脸上/);
  assert.match(HUANLIAN_PROMPT, /保留视频原有的动作/);
  assert.match(HUANLIAN_PROMPT, /只改五官/);
  assert.match(HUANLIAN_PROMPT, /二十一岁/);
});
