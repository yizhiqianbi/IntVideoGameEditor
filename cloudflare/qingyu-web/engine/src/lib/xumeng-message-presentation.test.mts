import test from "node:test";
import assert from "node:assert/strict";
import presentationModule from "./xumeng-message-presentation";

const { splitXumengMessagePresentation } = presentationModule;

test("explicit status marker separates narrative from a collapsible snapshot", () => {
  const result = splitXumengMessagePresentation(`天空一道惊雷闪过。\n\n点击查看状态栏\n\n姓名：待定\n\n当前地点：未知之地\n\n你的精力值：85／100\n\n你的健康值：200／300`);
  assert.equal(result.body, "天空一道惊雷闪过。");
  assert.deepEqual(result.status?.fields, [
    { label: "姓名", value: "待定" },
    { label: "当前地点", value: "未知之地" },
    { label: "精力值", value: "85／100" },
    { label: "健康值", value: "200／300" },
  ]);
});

test("unmarked prose and an incomplete marker remain unchanged", () => {
  const prose = "当前地点：书店\n她翻开地图。";
  assert.deepEqual(splitXumengMessagePresentation(prose), { body: prose, status: null });
  const incomplete = "点击查看状态栏\n\n这仍是一句故事正文。";
  assert.deepEqual(splitXumengMessagePresentation(incomplete), { body: incomplete, status: null });
});

test("status labels with a parenthetical stay out of the story", () => {
  const result = splitXumengMessagePresentation("开场。\n\n点击查看状态栏\n\n姓名：待定\n\n当前地点：未知之地\n\n内心描述（最近一名异性NPC）：暂无\n\n道具装备（最近一名异性NPC）：暂无");
  assert.equal(result.body, "开场。");
  assert.equal(result.status?.fields.at(-1)?.label, "道具装备");
});

test("trailing prose after a status block is preserved", () => {
  const result = splitXumengMessagePresentation("开场。\n\n【状态栏】\n\n当前场景：村口\n\n健康值：200/300\n\n雷声再次响起。");
  assert.equal(result.body, "开场。\n\n雷声再次响起。");
  assert.equal(result.status?.fields.length, 2);
});
