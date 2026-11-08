import assert from "node:assert/strict";
import test from "node:test";
import panelModule from "./xumeng-interaction-panels";

const { XUMENG_PANEL_PRESETS, buildXumengPanelInstruction, currentXumengPanelState, parseXumengInteractionTemplate, splitXumengPanelTail, stripXumengPanelTails } = panelModule as typeof import("./xumeng-interaction-panels");
const template = parseXumengInteractionTemplate({ panels: XUMENG_PANEL_PRESETS.slice(0, 3).map(preset => preset.panel), choices: { count: 3 } });

test("presets validate and invalid templates are rejected", () => {
  assert.equal(template.panels.length, 3);
  assert.deepEqual(XUMENG_PANEL_PRESETS.map(preset => preset.name), ["状态栏", "关系面板", "背包", "角色信息", "穿着", "心理", "内心独白", "体位"]);
  for (const preset of XUMENG_PANEL_PRESETS) assert.equal(parseXumengInteractionTemplate({ panels: [preset.panel] }).panels[0].title, preset.panel.title);
  assert.throws(() => parseXumengInteractionTemplate({ panels: [] }), /至少/);
  assert.throws(() => parseXumengInteractionTemplate({ panels: [{ id: "a", title: "关系", fields: [{ name: "好感", type: "meter", initial: "abc" }] }] }), /0–100/);
  assert.throws(() => parseXumengInteractionTemplate({ panels: [{ id: "a", title: "<b>", fields: [{ name: "x", type: "text", initial: "" }] }] }), /标签/);
});

test("reply tails are hidden while streaming and read once closed", () => {
  assert.equal(splitXumengPanelTail("她笑了。\n<xumeng-pa").body, "她笑了。");
  assert.equal(splitXumengPanelTail("她笑了。\n<xumeng-panel>{\"panels\"").body, "她笑了。");
  const reply = "她笑了。\n<xumeng-panel>{\"panels\":{\"关系\":{\"好感度\":135,\"关系阶段\":\"熟人\"},\"背包\":{\"物品\":[\"钥匙\",\"雨伞\"]}},\"choices\":[\"牵她的手\",\"转身离开\"]}</xumeng-panel>";
  const { body, snapshot } = splitXumengPanelTail(reply, template);
  assert.equal(body, "她笑了。");
  assert.deepEqual(snapshot?.panels["关系"], { 好感度: "100", 关系阶段: "熟人" });
  assert.equal(snapshot?.panels["背包"]?.["物品"], "钥匙、雨伞");
  assert.equal("choices" in (snapshot ?? {}), false);
  assert.equal(stripXumengPanelTails(reply), "她笑了。");
});

test("current state merges reported values over initial values", () => {
  const messages = [
    { role: "assistant", content: "开场" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "嗯。<xumeng-panel>{\"panels\":{\"状态\":{\"地点\":\"咖啡店\"}},\"choices\":[\"坐下\"]}</xumeng-panel>" },
  ];
  const state = currentXumengPanelState(template, messages);
  assert.equal(state.panels["状态"]["地点"], "咖啡店");
  assert.equal(state.panels["状态"]["心情"], "平静");
  assert.equal(state.panels["关系"]["好感度"], "20");
  assert.equal("choices" in template, false);
  const instruction = buildXumengPanelInstruction(template, state.panels);
  assert.match(instruction, /<xumeng-panel>/);
  assert.match(instruction, /当前："咖啡店"/);
  assert.doesNotMatch(instruction, /choices/);
});
