import test from "node:test";
import assert from "node:assert/strict";
import presentationModule from "./xumeng-message-presentation";

const { splitXumengMessagePresentation, peelXumengLabeledStatusTail, plainXumengStoryText, splitXumengSpeech, xumengConversationPreview } = presentationModule;

test("status tags with sections and pipe fields become a status card", () => {
  const card = splitXumengMessagePresentation("“跪下。”\n</theatre>\n<Status_block>\n<HR color=#987cb9>\n『日期 某月某日 时间：晚上 - 位置：酒店』\n<details>\n```\n『凛的状态』\n    当前行动:审视猎物\n    当前穿搭:黑色衬衫\n```\n</details>\n</Status_block>");
  assert.equal(card.body, "“跪下。”\n</theatre>");
  assert.equal(card.status?.sections?.[0].notes[0], "日期 某月某日 时间：晚上 - 位置：酒店");
  assert.equal(card.status?.sections?.[1].title, "凛的状态");
  assert.deepEqual(card.status?.sections?.[1].fields, [{ label: "当前行动", value: "审视猎物" }, { label: "当前穿搭", value: "黑色衬衫" }]);
  const pipes = splitXumengMessagePresentation("她歪头。\n<Status_block>\n[位置|二区·12号牢房]\n[时间|下午]\n</Status_block>");
  assert.deepEqual(pipes.status?.fields, [{ label: "位置", value: "二区·12号牢房" }, { label: "时间", value: "下午" }]);
  const hidden = splitXumengMessagePresentation("<think>计划</think>正文。<UpdateVariable>x=1</UpdateVariable>");
  assert.equal(hidden.body, "正文。");
});

test("markdown marks are dropped and quoted speech is split out", () => {
  assert.equal(plainXumengStoryText("## 标题\n*她笑了。*\n---\n- **“好。”**\n</theatre>"), "标题\n她笑了。\n“好。”");
  assert.deepEqual(splitXumengSpeech("她说“胆子大了，沈砚。″然后笑"), [
    { text: "她说", speech: false }, { text: "“胆子大了，沈砚。″", speech: true }, { text: "然后笑", speech: false }]);
});

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

test("a trailing block of the card's own fields leaves the story and updates the card", () => {
  const labels = ["场景", "瞳孔", "呼吸", "渴望刻度", "此刻姿态"];
  const result = peelXumengLabeledStatusTail("“赵医生……求您。”\n\n场景：空气几乎凝固\n瞳孔：极度放大\n呼吸：沉重地娇喘\n渴望刻度：95/100\n此刻姿态：双膝跪在你面前", labels);
  assert.equal(result.body, "“赵医生……求您。”");
  assert.equal(result.fields.find(field => field.label === "渴望刻度")?.value, "95/100");
  assert.equal(peelXumengLabeledStatusTail("当前地点：书店\n她翻开地图。", ["当前地点", "场景"]).fields.length, 0);
  assert.equal(peelXumengLabeledStatusTail("她停下。\n场景：包厢", labels).fields.length, 0);
});

test("conversation previews keep story text and drop embedded markup", () => {
  assert.equal(xumengConversationPreview('<div style="border-radius:16px;background:#111">她靠过来，没说话。</div>'), "她靠过来，没说话。");
  assert.equal(xumengConversationPreview("<style> @keyframes wgLantern { from { opacity: 0 } } </style>灯笼亮了。"), "灯笼亮了。");
  assert.equal(xumengConversationPreview("<style>@keyframes only {}</style>"), "");
  assert.equal(xumengConversationPreview("开场。\n\n点击查看状态栏\n\n当前场景：村口\n\n健康值：200/300\n\n[状态:执行委託]"), "开场。");
  assert.equal(xumengConversationPreview(""), "");
});

test("trailing prose after a status block is preserved", () => {
  const result = splitXumengMessagePresentation("开场。\n\n【状态栏】\n\n当前场景：村口\n\n健康值：200/300\n\n雷声再次响起。");
  assert.equal(result.body, "开场。\n\n雷声再次响起。");
  assert.equal(result.status?.fields.length, 2);
});
