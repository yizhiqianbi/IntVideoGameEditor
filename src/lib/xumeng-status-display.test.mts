import test from "node:test";
import assert from "node:assert/strict";
import displayModule from "./xumeng-status-display";
import statusModule from "./xumeng-character-status";

const { cleanStatusText, readStatusChips, readStatusMeter } = displayModule as typeof import("./xumeng-status-display");
const { xumengStatusBarFields, xumengStatusBarSections } = statusModule as typeof import("./xumeng-character-status");

test("status text drops the bracket wrappers used by card templates", () => {
  assert.equal(cleanStatusText("[[公寓沙发上]]"), "公寓沙发上");
  assert.equal(cleanStatusText("【家中客厅】"), "家中客厅");
});

test("a slash value becomes a meter and keeps the remark", () => {
  const meter = readStatusMeter("[[5/100，几乎没有变化]]", { label: "性欲值" });
  assert.equal(meter?.percent, 5);
  assert.equal(meter?.caption, "5%");
  assert.equal(meter?.note, "几乎没有变化");
});

test("a percent can keep the remark written in parentheses", () => {
  const meter = readStatusMeter("99%（天塌了，满脑子都是画面）", { label: "社死崩溃度" });
  assert.equal(meter?.percent, 99);
  assert.equal(meter?.caption, "99%");
  assert.equal(meter?.note, "天塌了，满脑子都是画面");
  assert.equal(readStatusMeter("隔壁母女家（水浸金山）", { label: "地点" }), null);
});

test("affection percent and a stage number use different captions", () => {
  assert.equal(readStatusMeter("[[8％]]", { label: "好感度" })?.caption, "8%");
  assert.equal(readStatusMeter("8%", { label: "好感度" })?.caption, "8%");
  assert.equal(readStatusMeter("57% ↑", { label: "好感度" })?.trend, "up");
  assert.equal(readStatusMeter("18", { label: "对质阶段" })?.caption, "18");
  assert.equal(readStatusMeter("18", { label: "对质阶段" })?.percent, 18);
});

test("panel meters and current-status words become bars and chips", () => {
  assert.equal(readStatusMeter("20", { type: "meter", label: "好感度" })?.caption, "20%");
  assert.deepEqual(readStatusChips("冷静、计算、被夺权、隐忍", { label: "当前状态" }), ["冷静", "计算", "被夺权", "隐忍"]);
  assert.equal(readStatusChips("宽松上衣和短裤", { label: "服装状态" }), null);
});

test("status sections keep the author's titles and the latest values", () => {
  const bar = {
    template: "",
    initialState: "【林音】\n好感度：8%\n当前状态：冷静、计算\n【关系】\n对质阶段：18",
    updateRules: "",
  };
  const sections = xumengStatusBarSections(bar, [
    { role: "assistant", content: "好感度：12%\n当前状态：冷静、计算\n对质阶段：18" },
  ]);
  assert.deepEqual(sections.map(section => section.title), ["林音", "关系"]);
  assert.equal(sections[0]?.fields.find(field => field.label === "好感度")?.value, "12%");
  assert.equal(xumengStatusBarFields(bar)[0]?.label, "好感度");
});
