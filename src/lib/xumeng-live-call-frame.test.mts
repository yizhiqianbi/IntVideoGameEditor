import test from "node:test";
import assert from "node:assert/strict";
import frameModule from "./xumeng-live-call-frame.ts";
import sceneModule from "./xumeng-live-scene.ts";

const { buildXumengLiveCallImagePrompt, buildXumengLiveCallSummaryInput, parseXumengLiveCallFrame } = frameModule as typeof import("./xumeng-live-call-frame.ts");
const { createXumengLiveScene } = sceneModule as typeof import("./xumeng-live-scene.ts");

test("call frame keeps only time, place and clothing from a model reply", () => {
  const frame = parseXumengLiveCallFrame("说明如下：\n```json\n{\"time\":\"夜里十一点\",\"place\":\"历史系办公室\",\"clothing\":\"深色西装，衣着完整\",\"extra\":\"忽略\"}\n```");
  assert.deepEqual(frame, { time: "夜里十一点", place: "历史系办公室", clothing: "深色西装，衣着完整" });
  assert.equal(parseXumengLiveCallFrame("不是 JSON"), null);
  assert.equal(parseXumengLiveCallFrame("{\"time\":\"放学\",\"place\":\"教室\",\"clothing\":\"校服\"}"), null);
});

test("opening still names the structured moment and keeps the adult reference", () => {
  const frame = { time: "凌晨一点四十", place: "便利店收银台", clothing: "便利店工服，衣着完整" };
  const prompt = buildXumengLiveCallImagePrompt("林幺", frame);
  assert.match(prompt || "", /凌晨一点四十/);
  assert.match(prompt || "", /便利店收银台/);
  assert.match(prompt || "", /便利店工服/);
  assert.match(prompt || "", /年满二十一岁/);
  assert.equal(buildXumengLiveCallImagePrompt("林幺", { time: "下午", place: "学校", clothing: "校服" }), null);
});

test("summary input carries the current scene and not an instruction to ignore it", () => {
  const scene = { ...createXumengLiveScene("当前角色会话"), situation: "夜里十一点 · 办公室", recentDialogue: [{ role: "user" as const, text: "书还没合。" }] };
  const input = buildXumengLiveCallSummaryInput("柳如月", scene);
  assert.match(input, /柳如月/);
  assert.match(input, /办公室/);
  assert.match(input, /书还没合/);
});
