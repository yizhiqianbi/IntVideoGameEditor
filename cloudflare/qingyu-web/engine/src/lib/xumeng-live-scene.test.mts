import test from "node:test";
import assert from "node:assert/strict";
import sceneModule from "./xumeng-live-scene.ts";
import worldModule from "./dzmm-world-state.ts";
const { appendXumengLiveDialogue, buildXumengLiveInteractionPrompt, buildXumengLiveSceneFromConversation, buildXumengLiveStartPersona, createXumengLiveScene, parseXumengLiveScene, XumengLiveDialogueHistory } = sceneModule as typeof import("./xumeng-live-scene.ts");
const { createDzmmWorldState } = worldModule as typeof import("./dzmm-world-state.ts");

test("conversation handoff preserves observed relationship causes and completed tasks, filters pending/example notes", () => {
  const state = createDzmmWorldState(); state.location = "次日的地图室";
  state.relationships = [{ name: "玩家", affinity: 40, trust: 10, tension: 20, note: "玩家核对过坐标，愿意合作但暂不交出原件" }];
  state.threads = [{ id: "oil", kind: "goal", text: "寻找灯油", status: "done", dueAtMinute: null }, { id: "route", kind: "goal", text: "核实航线", status: "open", dueAtMinute: null }];
  state.facts = ["暴雨已停，湿外套已经晾干"];
  const scene = buildXumengLiveSceneFromConversation([
    { role: "system", content: "不是对白" }, { role: "user", content: "昨天答应你的记录，我带来了。" },
    { role: "assistant", content: "我们先核对第三页。\n\nPS：作者说明：这是隔离测试" },
    { role: "assistant", content: "等待中的占位句", pending: true },
  ], state);
  assert.match(scene.situation, /次日的地图室/); assert.equal(scene.goal, "核实航线"); assert.match(scene.ended, /已完成：寻找灯油/);
  assert.equal(scene.relationship, "玩家：玩家核对过坐标，愿意合作但暂不交出原件");
  assert.equal(scene.recentDialogue.length, 2); assert.doesNotMatch(JSON.stringify(scene), /占位句|作者说明|隔离测试|affinity/);
  assert.equal(scene.recentDialogue[1].role, "character");
});

test("current scene, ended conditions and unknown facts reach an interaction without claiming an action was completed", () => {
  const scene = { ...createXumengLiveScene("原创隔离剧情"), situation: "三年后，玩家在旅店写信", ended: "已离开旧码头", relationship: "分别后是否保持联系未知" };
  const prompt = buildXumengLiveInteractionPrompt({ kind: "action", name: "玩家", text: "我想去她的新店看看。", scene });
  assert.match(prompt, /三年后/); assert.match(prompt, /已离开旧码头/); assert.match(prompt, /是否保持联系未知/);
  assert.match(prompt, /描述的行动或意向/); assert.match(prompt, /区分想做和已经做/); assert.doesNotMatch(prompt, /已经走进新店/);
  assert.match(prompt, /关系变化需要发生过的原因/); assert.match(prompt, /不要朗读资料标题/);
});

test("strict server scene contract rejects unexpected fields, malformed history and excess lengths", () => {
  const scene = createXumengLiveScene();
  assert.deepEqual(parseXumengLiveScene(scene), scene);
  for (const invalid of [{ ...scene, hiddenSecret: "future branch" }, { ...scene, situation: "字".repeat(1501) }, { ...scene, recentDialogue: [{ role: "assistant", text: "wrong role" }] }, { ...scene, recentDialogue: Array.from({ length: 9 }, () => ({ role: "user", text: "hello" })) }, { ...scene, goal: "\0" }]) assert.throws(() => parseXumengLiveScene(invalid));
});

test("creation persona reserves current facts and latest dialogue under S2 bound; references remain separate", () => {
  const scene = { ...createXumengLiveScene(), situation: "当前已在山顶" + "场".repeat(1490), goal: "还未核实航线" + "目标".repeat(290), relationship: "有依据的戒备" + "关".repeat(790), established: "潮水已退" + "实".repeat(1190), ended: "暴雨结束" + "旧".repeat(590), recentDialogue: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "character" as const : "user" as const, text: "话".repeat(570) + `最近实际对白${index}` })) };
  const prompt = buildXumengLiveStartPersona("稳定人物设定".repeat(1000), scene, "这是作品概要，未选结局只是可能性");
  assert.ok(prompt.length <= 5000); assert.match(prompt, /当前已在山顶/); assert.match(prompt, /暴雨结束/); assert.match(prompt, /最近实际对白7/); assert.match(prompt, /作品或章节参考（不代表本场已发生事实/);
});

test("only observed incoming dialogue is retained within a bounded history without changing objective facts", () => {
  let scene = { ...createXumengLiveScene(), established: "原件仍在人物手中" };
  for (let index = 0; index < 12; index++) scene = appendXumengLiveDialogue(scene, { role: "character", text: `收到的人物字幕${index}` });
  assert.equal(scene.recentDialogue.length, 8); assert.equal(scene.recentDialogue[0].text, "收到的人物字幕4"); assert.equal(scene.established, "原件仍在人物手中");
});
test("revisions address event identity even for identical text and cannot resurrect trimmed old dialogue", () => {
  const history = new XumengLiveDialogueHistory(); history.reset([]);
  history.observe("m1", "character", "等等。"); history.observe("m2", "character", "等等。");
  assert.deepEqual(history.observe("m1", "character", "我再想一想。"), [{ role: "character", text: "我再想一想。" }, { role: "character", text: "等等。" }]);
  history.reset([]); for (let index = 0; index < 10; index++) history.observe(`m${index}`, "character", `台词${index}`);
  const revised = history.observe("m0", "character", "旧台词修订");
  assert.equal(revised.length, 8); assert.equal(revised[0].text, "台词2"); assert.equal(revised.at(-1)?.text, "台词9"); assert.doesNotMatch(JSON.stringify(revised), /旧台词修订|eventId/);
});
