import test from "node:test";
import assert from "node:assert/strict";
import directorModule from "./dzmm-turn-director";
import chatModule from "./dzmm-chat";
import type { DzmmStoryMessage } from "./dzmm-story-memory";

const { findDzmmRecurringPhrases, readDzmmTurnDirection } = directorModule as typeof import("./dzmm-turn-director");
const { buildDzmmPromptPlan, validateDzmmChatInput, currentDzmmWorldState } = chatModule as typeof import("./dzmm-chat");
const turn = (content: string): DzmmStoryMessage[] => [{ role: "user", content }];

test("daily companionship is montage, clear skips retain their duration, immediate actions stay in scene", () => {
  for (const content of ["每天陪她聊天，听她诉苦", "慢慢的后面陪她在微信聊天", "接下来的几天每天一起练习吉他"]) {
    assert.equal(readDzmmTurnDirection(turn(content)).tempo, "montage");
    assert.equal(readDzmmTurnDirection(turn(content)).explicitMinutes, undefined);
  }
  assert.equal(readDzmmTurnDirection(turn("不跟了，3年后再次相遇")).explicitMinutes, 3 * 365 * 1440);
  assert.equal(readDzmmTurnDirection(turn("不跟了，3年后再次相遇")).tempo, "time-jump");
  for (const content of ["你叫什么名字", "继续聊", "她在看硬座票，我问她是什么车次", "我安慰她这次加班辛苦了"]) {
    assert.equal(readDzmmTurnDirection(turn(content)).tempo, "scene");
  }
  assert.equal(readDzmmTurnDirection(turn("先暂停，我想一下")).tempo, "pause");
});

test("quotes, hypothetical plans, questions, negative and retrospective routines do not become montage", () => {
  for (const content of ["她说：‘每天陪她聊天，听她诉苦’", "她说：\"每天陪她聊天，听她诉苦\"", "如果每天陪她聊天会怎么样？",
    "我打算每天陪她聊天", "每天陪她聊天合适吗？", "不要每天陪她聊天", "我以前每天陪她聊天", "她不喜欢我每天陪她聊天"]) {
    assert.equal(readDzmmTurnDirection(turn(content)).tempo, "scene", content);
  }
});

test("recurring wording needs separate assistant turns and current requests protect related details", () => {
  const history: DzmmStoryMessage[] = [
    { role: "assistant", content: "她捏着硬座票，把帆布包抱回怀里。没有问你在哪。" },
    { role: "user", content: "谢谢你" },
    { role: "assistant", content: "许安安摸了摸硬座票，把帆布包抱回怀里。没有问你在哪。" },
    { role: "assistant", content: "她把硬座票塞进口袋，把帆布包抱回怀里。没有问你在哪。" },
  ];
  const before = structuredClone(history);
  const phrases = findDzmmRecurringPhrases(history, "高情商安慰她");
  assert.ok(phrases.some(phrase => phrase.includes("硬座票")));
  assert.ok(phrases.some(phrase => phrase.includes("没有问你在哪")));
  assert.ok(phrases.length <= 6);
  assert.deepEqual(history, before, "Style detection must never remove original story facts.");
  assert.ok(!findDzmmRecurringPhrases(history, "请告诉我硬座票的车次").some(phrase => phrase === "硬座票"));
  assert.deepEqual(findDzmmRecurringPhrases([{ role: "assistant", content: "硬座票硬座票硬座票" }], "你好"), []);
  assert.deepEqual(findDzmmRecurringPhrases([...turn("硬座票"), ...turn("硬座票"), ...turn("硬座票")], "你好"), []);
});

test("final direction wins over old opening, stale state and author tail while preserving all raw history", () => {
  const history: DzmmStoryMessage[] = [
    { role: "assistant", content: "列车仍在行驶，她攥着硬座票。" },
    { role: "user", content: "火车到站" },
    { role: "assistant", content: "她到家了，晚上在微信里聊厂里的加班。" },
    { role: "user", content: "两周后，每天陪她聊天，听她诉苦，今晚视频聊一会儿。" },
  ];
  const input = validateDzmmChatInput({ character: { name: "成年工人", firstMessage: history[0].content,
    scenario: "最初在列车上", postHistoryInstructions: "作者风格提醒" }, messages: history,
    world: { clockMode: "story", state: { clock: { elapsedMinutes: 20, day: 1, minuteOfDay: null, calendarLabel: "", remainderMs: 0 },
      location: "旧列车车厢", relationships: [], threads: [], facts: ["旧站票"] } } });
  const plan = buildDzmmPromptPlan(input, 0);
  const recent = plan.messages.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source));
  assert.deepEqual(recent, history);
  assert.equal(plan.diagnostics.segments.at(-1)?.source, "round-reminder");
  const world = plan.messages.find((_message, index) => plan.diagnostics.segments[index].source === "living-world")!.content;
  const serialized = world.slice(world.indexOf("当前世界状态：") + "当前世界状态：".length).split("\n")[0];
  assert.equal(JSON.parse(serialized).clock.elapsedMinutes, 20180);
  assert.equal(currentDzmmWorldState(input.world!, 0, history.at(-1)!.content).clock.elapsedMinutes, 20180);
  assert.match(plan.messages.at(-1)!.content, /过程概述/);
  assert.match(plan.messages.at(-1)!.content, /旧道具/);
  assert.match(plan.messages.at(-1)!.content, /隐藏世界状态协议/);
  assert.equal(input.world!.state!.clock.elapsedMinutes, 20, "Prompt preparation must not mutate a stored snapshot or accrue a jump on retry.");
});
