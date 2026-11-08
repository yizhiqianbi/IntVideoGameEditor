import test from "node:test";
import assert from "node:assert/strict";
import worldModule from "./dzmm-world-state";
import chatModule from "./dzmm-chat";
import type { DzmmWorldState, DzmmWorldJournal } from "./dzmm-world-state";
import type { DzmmStoryMessage } from "./dzmm-story-memory";

const {
  createDzmmWorldState, parseDzmmWorldState, parseDzmmWorldJournal,
  pruneDzmmWorldJournal, latestDzmmWorldSnapshot, appendDzmmWorldSnapshot,
  applyDzmmWorldPatch, advanceDzmmWorldClock, buildDzmmWorldInstruction,
  readDzmmExplicitTimeJump, applyDzmmExplicitTimeJump,
  DZMM_WORLD_STATE_LIMIT_CHARS, DZMM_WORLD_JOURNAL_LIMIT_CHARS, DZMM_WORLD_MAX_WALL_GAP_MS,
  DZMM_WORLD_MAX_EXPLICIT_JUMP_MINUTES,
  recordDzmmWorldModeChange, resolveDzmmWorldRuntime, DZMM_WORLD_MAX_MODE_CHANGES,
} = worldModule as typeof import("./dzmm-world-state");
const { currentDzmmWorldState } = chatModule as typeof import("./dzmm-chat");

const evidence = { user: "我们等到明天下午。她是我的妻子。", assistant: "她递来一杯热茶。两人走进书店。她已经归还钥匙。" };
const source = { from: "assistant", quote: "两人走进书店。" };
const patch = (...changes: unknown[]) => ({ version: 1, changes });
const change = (value: Record<string, unknown>) => ({ ...source, ...value });

function history(length: number): DzmmStoryMessage[] {
  return Array.from({ length }, (_, index) => ({
    id: `turn-${index}`, role: index % 2 ? "user" : "assistant", content: `第 ${index} 条原始消息。`,
  }));
}

function populatedState(): DzmmWorldState {
  return {
    clock: { elapsedMinutes: 120, day: 2, minuteOfDay: 1_435, calendarLabel: "冬至", remainderMs: 42_000 },
    location: "  城南书店 🌱\n",
    relationships: [{ name: "店员", affinity: 5, trust: -2, tension: 10, note: "愿意帮忙。" }],
    threads: [{ id: "return_key", kind: "promise", text: "归还钥匙。", status: "open", dueAtMinute: 180 }],
    facts: ["钥匙由店员保管。"],
  };
}

test("unknown initial time never invents an hour, date, relationship, or task", () => {
  assert.deepEqual(createDzmmWorldState(), {
    clock: { elapsedMinutes: 0, day: 1, minuteOfDay: null, calendarLabel: "", remainderMs: 0 },
    location: "", relationships: [], threads: [], facts: [],
  });
  const first = createDzmmWorldState();
  first.facts.push("一条事实。");
  assert.deepEqual(createDzmmWorldState().facts, []);
});

test("strict state parser preserves exact data while detaching all mutable references", () => {
  const original = populatedState();
  const parsed = parseDzmmWorldState(original);
  assert.deepEqual(parsed, original);
  parsed.clock.day++;
  parsed.relationships[0].note = "修改后。";
  parsed.threads[0].status = "done";
  parsed.facts.push("另一条事实。");
  assert.equal(original.clock.day, 2);
  assert.equal(original.relationships[0].note, "愿意帮忙。");
  assert.equal(original.threads[0].status, "open");
  assert.equal(original.facts.length, 1);
});

test("state bounds reject unknown fields, unsupported modes, malformed lists, and nonfinite or fractional numbers", () => {
  const base = populatedState();
  for (const value of [
    null, [], "not parsed JSON", { ...base, extra: true }, { ...base, facts: undefined },
    { ...base, clock: { ...base.clock, extra: 1 } },
    ...[-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1].map(elapsedMinutes => ({ ...base, clock: { ...base.clock, elapsedMinutes } })),
    ...[0, -1, NaN, 1.5].map(day => ({ ...base, clock: { ...base.clock, day } })),
    ...[-1, 1_440, 10.5, "09:00"].map(minuteOfDay => ({ ...base, clock: { ...base.clock, minuteOfDay } })),
    ...[-1, 60_000, 10.5].map(remainderMs => ({ ...base, clock: { ...base.clock, remainderMs } })),
    { ...base, clock: { ...base.clock, calendarLabel: "日".repeat(81) } },
    { ...base, location: "地".repeat(161) }, { ...base, location: "坏\0地址" },
    ...[{}, Array(1), [""], ["  "], ["坏\0事实"], ["事".repeat(241)], Array.from({ length: 7 }, (_, i) => `事实${i}`)].map(facts => ({ ...base, facts })),
    { ...base, relationships: [{ ...base.relationships[0], affinity: 101 }] },
    { ...base, relationships: [{ ...base.relationships[0], trust: -101 }] },
    { ...base, relationships: [{ ...base.relationships[0], tension: -1 }] },
    { ...base, relationships: [{ ...base.relationships[0], affinity: 1.5 }] },
    { ...base, relationships: [{ ...base.relationships[0], consent: true }] },
    { ...base, relationships: [{ ...base.relationships[0], name: "名".repeat(41) }] },
    { ...base, relationships: [{ ...base.relationships[0], note: "注".repeat(161) }] },
    { ...base, relationships: Array.from({ length: 5 }, (_, i) => ({ ...base.relationships[0], name: `人物${i}` })) },
    { ...base, threads: [{ ...base.threads[0], kind: "quest" }] },
    { ...base, threads: [{ ...base.threads[0], status: "expired" }] },
    { ...base, threads: [{ ...base.threads[0], dueAtMinute: -1 }] },
    { ...base, threads: [{ ...base.threads[0], dueAtMinute: 1.5 }] },
    { ...base, threads: [{ ...base.threads[0], id: "中文" }] },
    { ...base, threads: [{ ...base.threads[0], id: "a".repeat(49) }] },
    { ...base, threads: Array.from({ length: 7 }, (_, i) => ({ ...base.threads[0], id: `task${i}` })) },
    { ...base, threads: [{ ...base.threads[0], hiddenInstruction: "bad" }] },
    { ...base, facts: ["重复事实", "重复事实"] },
    { ...base, relationships: [base.relationships[0], base.relationships[0]] },
    { ...base, threads: [base.threads[0], base.threads[0]] },
  ]) assert.throws(() => parseDzmmWorldState(value));
});

test("serialized state total includes escaped characters and structural overhead", () => {
  const base = populatedState();
  base.location = "地".repeat(160);
  base.clock.calendarLabel = "日".repeat(80);
  base.relationships = Array.from({ length: 4 }, (_, i) => ({ name: `人物${i}`, affinity: 0, trust: 0, tension: 0, note: "注".repeat(160) }));
  base.threads = Array.from({ length: 6 }, (_, i) => ({ id: `task${i}`, kind: "goal", text: "事".repeat(240), status: "open", dueAtMinute: null }));
  base.facts = Array.from({ length: 5 }, (_, i) => `${i}${"实".repeat(239)}`);
  const remaining = DZMM_WORLD_STATE_LIMIT_CHARS - JSON.stringify(base).length - 3;
  assert.ok(remaining > 0 && remaining < 240, `remaining=${remaining}`);
  base.facts.push("界".repeat(remaining));
  assert.equal(JSON.stringify(base).length, DZMM_WORLD_STATE_LIMIT_CHARS);
  assert.deepEqual(parseDzmmWorldState(base), base);
  base.facts[5] += "多";
  assert.throws(() => parseDzmmWorldState(base));
  base.facts[5] = "\n".repeat(remaining);
  assert.throws(() => parseDzmmWorldState(base));
});

test("grounded changes update only requested facts and preserve existing narrative relationship notes", () => {
  const before = populatedState();
  const after = applyDzmmWorldPatch(before, patch(
    change({ type: "location", value: "书店" }),
    change({ type: "relationship", name: "店员", affinityDelta: 2, trustDelta: 3, tensionDelta: -3 }),
    change({ type: "fact", action: "add", text: "两人已在书店。" }),
  ), evidence);
  assert.equal(after.location, "书店");
  assert.deepEqual(after.relationships[0], { ...before.relationships[0], affinity: 7, trust: 1, tension: 7 });
  assert.deepEqual(after.clock, before.clock);
  assert.deepEqual(before, populatedState());
  const initial = applyDzmmWorldPatch(undefined, patch({
    type: "relationship", name: "妻子", note: "用户已明确两人是夫妻。", from: "user", quote: "她是我的妻子。",
  }), evidence);
  assert.deepEqual(initial.relationships[0], { name: "妻子", affinity: 0, trust: 0, tension: 0, note: "用户已明确两人是夫妻。" });
});

test("quote provenance must exactly match the declared CURRENT source", () => {
  for (const invalidSource of [
    { from: "user", quote: "两人走进书店。" },
    { from: "assistant", quote: "她是我的妻子。" },
    { from: "system", quote: "两人走进书店。" },
    { from: "assistant", quote: "两人走进书店".replace("走进", "进入") },
    { from: "assistant", quote: "她已经归还钥匙。\n" },
    { from: "assistant", quote: "她递来" },
    { from: "assistant", quote: "" },
    { from: "assistant", quote: "两人走进书店。".repeat(100) },
    { quote: "两人走进书店。" }, { from: "assistant" },
  ]) assert.throws(() => applyDzmmWorldPatch(undefined, patch({ type: "location", value: "书店", ...invalidSource }), evidence));
  assert.throws(() => applyDzmmWorldPatch(undefined, patch(change({ type: "location", value: "书店" })), {
    user: "新的当前用户消息。", assistant: "本回合另一个回复。",
  }));
  assert.throws(() => applyDzmmWorldPatch(undefined, patch(change({ type: "location", value: "书店", quote: "🌱🌱" })), {
    user: "", assistant: "🌱🌱",
  }));
});

test("invalid proposal is atomic, including late schema/evidence errors and overflow", () => {
  const before = populatedState();
  for (const proposal of [
    null, [], { version: 2, changes: [] }, { version: 1, changes: [], instruction: "bad" },
    { changes: [] }, { version: 1 }, patch({ ...change({ type: "location", value: "书店" }), instructions: "bad" }),
    patch(change({ type: "clock", day: 1, advanceMinutes: undefined })),
    patch(change({ type: "clock", explicitUserTimeJump: true })),
    patch(change({ type: "relationship", name: "店员", significant: true })),
    patch(change({ type: "relationship", name: "店员", note: undefined })),
    patch(change({ type: "unknown" })),
    patch(change({ type: "location", value: "书店" }), change({ type: "fact", action: "add", text: "伪造", quote: "没有出现的证据。" })),
    patch(change({ type: "location", value: "书店" }), change({ type: "clock", advanceMinutes: 181 })),
    patch(...Array.from({ length: 21 }, (_, i) => change({ type: "fact", action: "add", text: `事实${i}` }))),
    { version: 1, changes: Array(1) },
  ]) {
    assert.throws(() => applyDzmmWorldPatch(before, proposal, evidence));
    assert.deepEqual(before, populatedState());
  }
  const full = { ...before, facts: Array.from({ length: 6 }, (_, i) => `事实${i}`) };
  assert.throws(() => applyDzmmWorldPatch(full, patch(
    change({ type: "location", value: "新地点" }), change({ type: "fact", action: "add", text: "第七条事实" }),
  ), evidence));
  assert.equal(full.location, before.location);
});

test("per-turn relationship limits cannot be bypassed by duplicate patches", () => {
  for (const deltaField of ["affinityDelta", "trustDelta", "tensionDelta"]) {
    for (const amount of [-4, 4, 1.5, NaN, Infinity]) {
      assert.throws(() => applyDzmmWorldPatch(undefined, patch(change({ type: "relationship", name: "店员", [deltaField]: amount })), evidence));
    }
    for (const amount of [-9, 9]) {
      assert.throws(() => applyDzmmWorldPatch(undefined, patch(change({ type: "relationship", name: "店员", [deltaField]: amount, significant: true })), evidence));
    }
  }
  assert.throws(() => applyDzmmWorldPatch(undefined, patch(
    change({ type: "relationship", name: "店员", affinityDelta: 3 }),
    change({ type: "relationship", name: "店员", affinityDelta: 3 }),
  ), evidence));
  assert.throws(() => applyDzmmWorldPatch(undefined, patch(change({ type: "relationship", name: "店员", affinityDelta: 8, significant: "true" })), evidence));
  const significant = applyDzmmWorldPatch(undefined, patch(change({ type: "relationship", name: "店员", affinityDelta: 8, trustDelta: -8, tensionDelta: 8, significant: true })), evidence);
  assert.deepEqual(significant.relationships[0], { name: "店员", affinity: 8, trust: -8, tension: 8, note: "" });
  const extremes = populatedState();
  extremes.relationships[0] = { name: "店员", affinity: 99, trust: -99, tension: 1, note: "仍是同一角色。" };
  const clamped = applyDzmmWorldPatch(extremes, patch(change({ type: "relationship", name: "店员", affinityDelta: 3, trustDelta: -3, tensionDelta: -3 })), evidence);
  assert.deepEqual(clamped.relationships[0], { ...extremes.relationships[0], affinity: 100, trust: -100, tension: 0 });
});

test("story time rolls over known midnight but keeps unknown time unknown", () => {
  const before = populatedState();
  const next = applyDzmmWorldPatch(before, patch(change({ type: "clock", advanceMinutes: 10 })), evidence);
  assert.deepEqual(next.clock, { ...before.clock, elapsedMinutes: 130, minuteOfDay: 5, day: 3 });
  const unknown = applyDzmmWorldPatch(undefined, patch(change({ type: "clock", advanceMinutes: 180 })), evidence);
  assert.equal(unknown.clock.minuteOfDay, null);
  assert.equal(unknown.clock.day, 1);
  assert.equal(unknown.clock.elapsedMinutes, 180);
});

test("large story jumps require an explicit user source and bounded integer duration", () => {
  const userClock = { type: "clock", from: "user", quote: "我们等到明天下午。", explicitUserTimeJump: true };
  const next = applyDzmmWorldPatch(undefined, patch({ ...userClock, advanceMinutes: 10_080 }), evidence);
  assert.equal(next.clock.elapsedMinutes, 10_080);
  assert.equal(next.clock.day, 8);
  assert.equal(next.clock.minuteOfDay, null);
  for (const invalid of [
    { ...userClock, advanceMinutes: 10_081 }, { ...userClock, advanceMinutes: -1 },
    { ...userClock, advanceMinutes: 181, explicitUserTimeJump: false },
    { ...userClock, advanceMinutes: 181, explicitUserTimeJump: 1 },
    change({ type: "clock", advanceMinutes: 181, explicitUserTimeJump: true }),
    { ...userClock, advanceMinutes: 181, quote: "没有说过的跳时。" },
  ]) assert.throws(() => applyDzmmWorldPatch(undefined, patch(invalid), evidence));
});

test("clear narrative time cues support years, months and weeks without interpreting quoted speech or plans", () => {
  for (const [input, minutes, quote] of [
    ["三年后再次相遇", 3 * 365 * 1_440, "三年后再次相遇"],
    ["不跟了，3年后再次相遇", 3 * 365 * 1_440, "3年后再次相遇"],
    ["两周后我们在书店见面", 14 * 1_440, "两周后我们在书店见面"],
    ["一个星期后，再次相遇", 7 * 1_440, "一个星期后"],
    ["把时间快进半个月", 15 * 1_440, "把时间快进半个月"],
    ["0.5小时后她醒过来", 30, "0.5小时后她醒过来"],
    ["一百年后再次相遇", DZMM_WORLD_MAX_EXPLICIT_JUMP_MINUTES, "一百年后再次相遇"],
  ] as const) assert.deepEqual(readDzmmExplicitTimeJump(input), { advanceMinutes: minutes, quote });
  for (const input of [
    '她说：“三年后再次相遇。”', '"三年后再次相遇"', "「三年后再次相遇」", "`三年后再次相遇`",
    "> 三年后再次相遇", "她说，三年后再次相遇", "如果，三年后再次相遇", "我计划，三年后再次相遇",
    "想象三年后再次相遇", "我想，三年后再次相遇", "回忆三年前再次相遇", "三年前再次相遇", "三年后她会联系我", "三年后，我希望再见到她",
    "三年后，还能见到她吗？", "三年后，我还能认识她吗？", "三年后，还能见到她吗",
    "三年后再次相遇？", "每天陪她聊天", "等她回来", "继续", "101年后再次相遇", "一二年后再次相遇",
    "0.01分钟后再次相遇", "三年后\0再次相遇",
  ]) assert.equal(readDzmmExplicitTimeJump(input), undefined, input);
});

test("a three-year jump advances a detached story clock and retires obsolete date precision without resolving promises or feelings", () => {
  const previous = populatedState(), before = structuredClone(previous);
  const result = applyDzmmExplicitTimeJump(previous, "三年后再次相遇");
  assert.equal(result.state.clock.elapsedMinutes, before.clock.elapsedMinutes + 3 * 365 * 1_440);
  assert.equal(result.state.clock.day, before.clock.day + 3 * 365);
  assert.equal(result.state.clock.minuteOfDay, null);
  assert.equal(result.state.clock.calendarLabel, "");
  assert.equal(result.state.clock.remainderMs, 0);
  assert.deepEqual(result.state.relationships, before.relationships);
  assert.deepEqual(result.state.threads, before.threads);
  assert.deepEqual(result.state.facts, before.facts);
  assert.deepEqual(previous, before);
  const noJump = applyDzmmExplicitTimeJump(previous, "我计划三年后再来");
  assert.deepEqual(noJump.state, previous);
  assert.equal(noJump.timeJump, undefined);
  assert.notEqual(noJump.state, previous);
  const shortAnchor = { ...before, clock: { ...before.clock, minuteOfDay: 600 } };
  const short = applyDzmmExplicitTimeJump(shortAnchor, "半小时后再次相遇");
  assert.equal(short.state.clock.minuteOfDay, 630);
  assert.equal(short.state.clock.calendarLabel, before.clock.calendarLabel);
  const midnight = applyDzmmExplicitTimeJump(before, "半小时后再次相遇");
  assert.equal(midnight.state.clock.minuteOfDay, 25);
  assert.equal(midnight.state.clock.day, before.clock.day + 1);
  assert.equal(midnight.state.clock.calendarLabel, "");
});

test("model year jumps match the current explicit duration and cannot hide behind arbitrary user quotes", () => {
  const userText = "三年后再次相遇，我走进书店。";
  const jump = readDzmmExplicitTimeJump(userText)!;
  const clock = { type: "clock", from: "user", quote: jump.quote, explicitUserTimeJump: true, advanceMinutes: jump.advanceMinutes };
  for (const clockMode of ["story", "realtime"] as const) {
    const next = applyDzmmWorldPatch(undefined, patch(clock), { user: userText, assistant: "", clockMode });
    assert.equal(next.clock.elapsedMinutes, jump.advanceMinutes);
    assert.equal(next.clock.day, 1 + 3 * 365);
  }
  for (const [user, proposal] of [
    [userText, { ...clock, advanceMinutes: jump.advanceMinutes + 1 }],
    [userText, { ...clock, advanceMinutes: DZMM_WORLD_MAX_EXPLICIT_JUMP_MINUTES + 1 }],
    [userText, { ...clock, quote: "我走进书店。" }],
    ["我走进书店。", { ...clock, quote: "我走进书店。" }],
    ['她说：“三年后再次相遇。”', { ...clock, quote: "三年后再次相遇" }],
    [userText, { ...clock, from: "assistant" }],
  ] as const) assert.throws(() => applyDzmmWorldPatch(undefined, patch(proposal), { user, assistant: jump.quote }));
});

test("pre-applied time anchors cannot be advanced or reset twice by model metadata in either mode", () => {
  const previous = populatedState(), userText = "三年后再次相遇";
  const { state, timeJump } = applyDzmmExplicitTimeJump(previous, userText);
  const proposal = patch({ type: "clock", from: "user", quote: userText, explicitUserTimeJump: true,
    advanceMinutes: timeJump!.advanceMinutes, day: 1 }, change({ type: "location", value: "书店" }));
  for (const clockMode of ["story", "realtime"] as const) {
    const next = applyDzmmWorldPatch(state, proposal, { user: userText, assistant: evidence.assistant, clockMode, appliedTimeJump: timeJump });
    assert.deepEqual(next.clock, state.clock);
    assert.equal(next.location, "书店");
  }
  assert.throws(() => applyDzmmWorldPatch(state, patch(), { user: "我计划三年后再来", assistant: "", appliedTimeJump: timeJump }));
  assert.throws(() => applyDzmmWorldPatch(state, patch(), { user: userText, assistant: "",
    appliedTimeJump: { advanceMinutes: timeJump!.advanceMinutes + 1, quote: userText } }));
});

test("clock corrections require evidence, permit unknown time, and realtime never double-counts model duration", () => {
  const next = applyDzmmWorldPatch(populatedState(), patch(change({ type: "clock", advanceMinutes: 30, day: 8, minuteOfDay: 1_200, calendarLabel: "深秋" })), { ...evidence, clockMode: "realtime" });
  assert.deepEqual(next.clock, { elapsedMinutes: 120, day: 8, minuteOfDay: 1_200, calendarLabel: "深秋", remainderMs: 42_000 });
  const unknown = applyDzmmWorldPatch(next, patch(change({ type: "clock", minuteOfDay: null })), evidence);
  assert.equal(unknown.clock.minuteOfDay, null);
  assert.throws(() => applyDzmmWorldPatch(next, patch(change({ type: "clock", minuteOfDay: 1_440 })), evidence));
  assert.throws(() => applyDzmmWorldPatch(next, patch(change({ type: "clock", day: 0 })), evidence));
  assert.throws(() => applyDzmmWorldPatch(next, patch(change({ type: "clock", advanceMinutes: 999 })), { ...evidence, clockMode: "realtime" }));
});

test("tasks remain open without explicit grounded completion even when their deadline passes", () => {
  const before = populatedState();
  const timed = applyDzmmWorldPatch(before, patch(change({ type: "clock", advanceMinutes: 180 })), evidence);
  assert.equal(timed.threads[0].status, "open");
  const done = applyDzmmWorldPatch(before, patch({
    type: "thread", ...before.threads[0], status: "done", from: "assistant", quote: "她已经归还钥匙。",
  }), evidence);
  assert.equal(done.threads[0].status, "done");
  assert.equal(done.threads.length, 1);
  assert.throws(() => applyDzmmWorldPatch(before, patch({
    type: "thread", ...before.threads[0], status: "done", from: "user", quote: "她已经归还钥匙。",
  }), evidence));
  assert.deepEqual(applyDzmmWorldPatch(before, patch(), evidence), before);
});

test("fact additions deduplicate; grounded deletion frees bounded capacity; duplicate targets reject", () => {
  const before = populatedState();
  const added = applyDzmmWorldPatch(before, patch(change({ type: "fact", action: "add", text: before.facts[0] })), evidence);
  assert.deepEqual(added, before);
  const removed = applyDzmmWorldPatch(before, patch(
    change({ type: "fact", action: "remove", text: before.facts[0] }),
    change({ type: "removeThread", id: "return_key" }),
  ), evidence);
  assert.deepEqual(removed.facts, []);
  assert.deepEqual(removed.threads, []);
  for (const changes of [
    [change({ type: "clock", day: 2 }), change({ type: "clock", day: 3 })],
    [change({ type: "location", value: "书店" }), change({ type: "location", value: "别处" })],
    [change({ type: "removeThread", id: "return_key" }), change({ type: "thread", ...before.threads[0] })],
    [change({ type: "fact", action: "remove", text: before.facts[0] }), change({ type: "fact", action: "add", text: before.facts[0] })],
  ]) assert.throws(() => applyDzmmWorldPatch(before, patch(...changes), evidence));
});

test("real elapsed seconds carry across turns and roll over midnight without changing story facts", () => {
  const before = populatedState();
  const one = advanceDzmmWorldClock(before, 1_000, 20_000, "realtime");
  assert.equal(one.clock.elapsedMinutes, 121);
  assert.equal(one.clock.remainderMs, 1_000);
  const two = advanceDzmmWorldClock(one, 20_000, 320_000, "realtime");
  assert.equal(two.clock.elapsedMinutes, 126);
  assert.equal(two.clock.minuteOfDay, 1);
  assert.equal(two.clock.day, 3);
  assert.equal(two.clock.remainderMs, 1_000);
  assert.deepEqual(two.relationships, before.relationships);
  assert.deepEqual(two.threads, before.threads);
  assert.deepEqual(two.facts, before.facts);
  assert.equal(two.location, before.location);
  assert.deepEqual(before, populatedState());
});

test("story mode ignores offline time; realtime caps huge gaps and clamps future anchors", () => {
  const before = populatedState();
  assert.deepEqual(advanceDzmmWorldClock(before, 0, 100_000_000, "story"), before);
  assert.deepEqual(advanceDzmmWorldClock(before, undefined, 100_000_000, "realtime"), before);
  assert.deepEqual(advanceDzmmWorldClock(before, 10_000, 0, "realtime"), before);
  const huge = advanceDzmmWorldClock(before, 0, 8_000_000_000_000_000, "realtime");
  assert.equal(huge.clock.elapsedMinutes, before.clock.elapsedMinutes + DZMM_WORLD_MAX_WALL_GAP_MS / 60_000);
  assert.deepEqual(huge.relationships, before.relationships);
  assert.equal(huge.threads[0].status, "open");
  const unknown = advanceDzmmWorldClock(createDzmmWorldState(), 0, 90_000_000, "realtime");
  assert.equal(unknown.clock.minuteOfDay, null);
  assert.equal(unknown.clock.day, 2);
  assert.equal(unknown.clock.elapsedMinutes, 1_500);
  for (const invalid of [-1, Infinity, NaN, 1.5, 8_640_000_000_000_001]) {
    assert.throws(() => advanceDzmmWorldClock(before, 0, invalid, "realtime"));
    assert.throws(() => advanceDzmmWorldClock(before, invalid, 0, "realtime"));
  }
  const overflow = createDzmmWorldState();
  overflow.clock.elapsedMinutes = Number.MAX_SAFE_INTEGER;
  assert.throws(() => advanceDzmmWorldClock(overflow, 0, 60_000, "realtime"));
  assert.equal(overflow.clock.elapsedMinutes, Number.MAX_SAFE_INTEGER);
});

test("unknown hour still tracks relative days across multiple partial real intervals", () => {
  const initial = createDzmmWorldState();
  const first = advanceDzmmWorldClock(initial, 0, 23 * 60 * 60_000, "realtime");
  assert.equal(first.clock.day, 1);
  const second = advanceDzmmWorldClock(first, 23 * 60 * 60_000, 48 * 60 * 60_000, "realtime");
  assert.equal(second.clock.day, 3);
  assert.equal(second.clock.minuteOfDay, null);
  assert.equal(second.clock.elapsedMinutes, 2_880);
});

test("journal uses detached strict versioned snapshots with valid finite timestamp and modes", () => {
  const journal = appendDzmmWorldSnapshot(undefined, history(2), populatedState(), 1_700_000_000_000);
  assert.deepEqual(parseDzmmWorldJournal(journal), journal);
  assert.deepEqual(parseDzmmWorldJournal({ version: 1, snapshots: [] }), { version: 1, snapshots: [] });
  const snapshot = journal.snapshots[0];
  for (const invalid of [
    null, [], { ...journal, version: 2 }, { ...journal, extra: true },
    { ...journal, snapshots: Array(1) }, { ...journal, snapshots: Array.from({ length: 9 }, (_, i) => ({ ...snapshot, sourceCount: i + 1 })) },
    { ...journal, snapshots: [snapshot, snapshot] },
    ...[-1, Infinity, NaN, 1.5, 8_640_000_000_000_001].map(recordedAt => ({ ...journal, snapshots: [{ ...snapshot, recordedAt }] })),
    ...[0, -1, 1.5, NaN].map(sourceCount => ({ ...journal, snapshots: [{ ...snapshot, sourceCount }] })),
    { ...journal, snapshots: [{ ...snapshot, sourceFingerprint: "fake" }] },
    { ...journal, snapshots: [{ ...snapshot, clockMode: "hybrid" }] },
    { ...journal, snapshots: [{ ...snapshot, clockMode: undefined }] },
    { ...journal, snapshots: [{ ...snapshot, state: { ...snapshot.state, extra: true } }] },
    { ...journal, snapshots: [{ ...snapshot, extra: true }] },
  ]) assert.throws(() => parseDzmmWorldJournal(invalid));
  const parsed = parseDzmmWorldJournal(journal);
  parsed.snapshots[0].state.clock.day++;
  assert.equal(snapshot.state.clock.day, 2);
  assert.throws(() => appendDzmmWorldSnapshot(undefined, [], populatedState(), 1));
});

test("journal retention is bounded, retries idempotent, and modes re-anchor the same prefix", () => {
  let journal: DzmmWorldJournal | undefined;
  for (let i = 1; i <= 20; i++) journal = appendDzmmWorldSnapshot(journal, history(i), { ...createDzmmWorldState(), location: `地点${i}` }, i * 1_000);
  assert.ok(journal);
  assert.equal(journal.snapshots.length, 8);
  assert.deepEqual(journal.snapshots.map(item => item.sourceCount), [13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(JSON.stringify(journal).length <= DZMM_WORLD_JOURNAL_LIMIT_CHARS);
  const retry = appendDzmmWorldSnapshot(journal, history(20), populatedState(), 99_000);
  assert.deepEqual(retry, journal);
  const switched = appendDzmmWorldSnapshot(journal, history(20), populatedState(), 99_000, "realtime");
  assert.equal(switched.snapshots.length, 8);
  assert.equal(switched.snapshots[7].clockMode, "realtime");
  assert.equal(switched.snapshots[7].recordedAt, 99_000);
  assert.deepEqual(switched.snapshots[7].state, populatedState());
  assert.equal(journal.snapshots[7].clockMode, "story");
});

test("rewinds restore the latest matching state and edited or regenerated prefixes invalidate descendants", () => {
  const full = history(8);
  let journal: DzmmWorldJournal | undefined;
  for (const count of [2, 4, 6, 8]) journal = appendDzmmWorldSnapshot(journal, full.slice(0, count), { ...createDzmmWorldState(), location: `地点${count}` }, count * 1_000);
  assert.equal(latestDzmmWorldSnapshot(journal, full)?.state.location, "地点8");
  const rewind = pruneDzmmWorldJournal(journal, full.slice(0, 5));
  assert.deepEqual(rewind?.snapshots.map(item => item.sourceCount), [2, 4]);
  assert.equal(latestDzmmWorldSnapshot(rewind, full.slice(0, 5))?.state.location, "地点4");
  for (const replacement of [
    { ...full[4], content: "已编辑的第五条消息。" }, { ...full[4], id: "regenerated" },
    { ...full[4], role: "user" as const }, { ...full[4], id: undefined },
  ]) {
    const changed = full.map((message, i) => i === 4 ? replacement : message);
    assert.deepEqual(pruneDzmmWorldJournal(journal, changed)?.snapshots.map(item => item.sourceCount), [2, 4]);
  }
  assert.deepEqual(pruneDzmmWorldJournal(journal, [...full.slice(0, 4), ...full.slice(5)])?.snapshots.map(item => item.sourceCount), [2, 4]);
  assert.equal(pruneDzmmWorldJournal(journal, [{ ...full[0], content: "新分支开头。" }, ...full.slice(1)]), undefined);
  assert.equal(pruneDzmmWorldJournal(journal, []), undefined);
  assert.equal(pruneDzmmWorldJournal({ bad: "malformed" }, full), undefined);
  assert.equal(latestDzmmWorldSnapshot(undefined, full), undefined);
  const branch = appendDzmmWorldSnapshot(journal, full.slice(0, 5), { ...createDzmmWorldState(), location: "新分支" }, 30_000);
  assert.deepEqual(branch.snapshots.map(item => item.sourceCount), [2, 4, 5]);
});

test("regeneration excludes a paused day while rewinding fictional facts, relationships and location", () => {
  const minute = 60_000, full = history(5), early = populatedState();
  early.clock = { ...createDzmmWorldState().clock }; early.location = "原创旧书店";
  let journal = appendDzmmWorldSnapshot(undefined, full.slice(0, 3), early, 0, "realtime");
  const later = advanceDzmmWorldClock(early, 0, 10 * minute, "realtime");
  later.location = "原创露台"; later.facts = ["地图已经借出。"];
  later.relationships[0].trust = 40; later.threads[0].status = "done";
  journal = appendDzmmWorldSnapshot(journal, full, later, 10 * minute, "realtime");
  assert.equal(journal.modeChanges, undefined, "Legacy ordinary appends do not guess mode history");
  journal = recordDzmmWorldModeChange(journal, full, 10 * minute, "story");
  journal = appendDzmmWorldSnapshot(journal, full, later, 10 * minute, "story");
  const paused = resolveDzmmWorldRuntime(journal, full, 1450 * minute, "story")!;
  assert.equal(paused.state.clock.elapsedMinutes, 10);
  journal = recordDzmmWorldModeChange(journal, full, 1450 * minute, "realtime");
  journal = appendDzmmWorldSnapshot(journal, full, paused.state, 1450 * minute, "realtime");
  const before = JSON.stringify(journal);
  const complete = resolveDzmmWorldRuntime(journal, full, 1451 * minute, "realtime")!;
  const rewind = pruneDzmmWorldJournal(journal, full.slice(0, -1))!;
  const regenerated = resolveDzmmWorldRuntime(rewind, full.slice(0, -1), 1451 * minute, "realtime")!;
  assert.equal(complete.state.clock.elapsedMinutes, 11);
  assert.equal(regenerated.state.clock.elapsedMinutes, 11, "Paused 1440 minutes must not reappear as realtime");
  assert.equal(regenerated.recordedAt, 1451 * minute);
  assert.equal(regenerated.clockMode, "realtime");
  assert.equal(currentDzmmWorldState({ ...regenerated, previousClockMode: regenerated.clockMode }, 1451 * minute).clock.elapsedMinutes, 11);
  assert.equal(latestDzmmWorldSnapshot(rewind, full.slice(0, -1))?.sourceCount, 3);
  assert.equal(regenerated.state.location, early.location);
  assert.deepEqual(regenerated.state.relationships, early.relationships);
  assert.deepEqual(regenerated.state.facts, early.facts);
  assert.deepEqual(regenerated.state.threads, early.threads);
  assert.deepEqual(rewind.modeChanges, journal.modeChanges);
  assert.deepEqual(resolveDzmmWorldRuntime(parseDzmmWorldJournal(JSON.parse(before)), full.slice(0, -1), 1451 * minute, "realtime"), regenerated);
  assert.equal(JSON.stringify(journal), before);
});

test("regenerating explicit story jumps reuses the earlier fictional clock, never the completed answer's jump", () => {
  for (const [text, minutes] of [["0.5小时后她醒过来", 30], ["三年后再次相遇", 3 * 365 * 1440]] as const) {
    const full = history(5); full[3].content = text;
    const initial = createDzmmWorldState();
    let journal = appendDzmmWorldSnapshot(undefined, full.slice(0, 3), initial, 1000, "story");
    journal = recordDzmmWorldModeChange(journal, full.slice(0, 3), 1000, "story");
    const completed = applyDzmmExplicitTimeJump(initial, text).state;
    completed.location = "后来才到的灯塔";
    journal = appendDzmmWorldSnapshot(journal, full, completed, 2000, "story");
    const runtime = resolveDzmmWorldRuntime(journal, full.slice(0, -1), 3000, "story")!;
    assert.equal(runtime.state.clock.elapsedMinutes, 0);
    assert.equal(runtime.state.location, "");
    const regenerated = currentDzmmWorldState({ ...runtime, previousClockMode: runtime.clockMode }, 3000, text);
    assert.equal(regenerated.clock.elapsedMinutes, minutes, "The explicit user jump is applied exactly once");
    assert.notEqual(regenerated.clock.elapsedMinutes, minutes * 2);
  }
});

test("mode timeline parsing is strict, detached and compatible with old journals and explicit empty timelines", () => {
  const legacy = appendDzmmWorldSnapshot(undefined, history(3), populatedState(), 1000, "story");
  assert.equal(parseDzmmWorldJournal(legacy).modeChanges, undefined);
  assert.equal(pruneDzmmWorldJournal(legacy, history(3))?.modeChanges, undefined);
  assert.deepEqual(parseDzmmWorldJournal({ version: 1, snapshots: [], modeChanges: [] }), { version: 1, snapshots: [], modeChanges: [] });
  const journal = recordDzmmWorldModeChange(legacy, history(3), 2000, "realtime");
  const parsed = parseDzmmWorldJournal(journal);
  parsed.modeChanges![0].recordedAt = 3000;
  assert.equal(journal.modeChanges![0].recordedAt, 2000);
  for (const modeChanges of [null, undefined, Array(1), [{ recordedAt: 1, clockMode: "other" }],
    [{ recordedAt: 1, clockMode: "story", state: populatedState() }],
    [{ recordedAt: 2, clockMode: "story" }, { recordedAt: 2, clockMode: "realtime" }],
    [{ recordedAt: 2, clockMode: "story" }, { recordedAt: 1, clockMode: "realtime" }],
    ...[-1, Infinity, NaN, 1.5, 8_640_000_000_000_001].map(recordedAt => [{ recordedAt, clockMode: "story" }]),
    Array.from({ length: DZMM_WORLD_MAX_MODE_CHANGES + 1 }, (_, recordedAt) => ({ recordedAt, clockMode: "story" })),
  ]) assert.throws(() => parseDzmmWorldJournal({ ...legacy, modeChanges }));
});

test("switches at the same instant coalesce, useful pause capacity errors rather than truncating, and consumed history compacts", () => {
  let journal: DzmmWorldJournal | undefined;
  for (let recordedAt = 0; recordedAt < DZMM_WORLD_MAX_MODE_CHANGES; recordedAt++) {
    journal = recordDzmmWorldModeChange(journal, [], recordedAt, recordedAt % 2 ? "story" : "realtime");
  }
  const before = JSON.stringify(journal);
  assert.throws(() => recordDzmmWorldModeChange(journal, [], DZMM_WORLD_MAX_MODE_CHANGES, "realtime"), /记录已满/);
  assert.equal(JSON.stringify(journal), before);
  assert.throws(() => recordDzmmWorldModeChange(journal, [], 1, "realtime"), /不能早于/);
  const same = recordDzmmWorldModeChange(journal, [], DZMM_WORLD_MAX_MODE_CHANGES - 1, "realtime");
  assert.equal(same.modeChanges?.length, DZMM_WORLD_MAX_MODE_CHANGES);
  assert.equal(same.modeChanges?.at(-1)?.clockMode, "realtime");
  const consumed = appendDzmmWorldSnapshot(journal, history(1), createDzmmWorldState(), 200, "story");
  assert.deepEqual(consumed.modeChanges, [], "An existing snapshot owns all earlier time consumption");
  const next = recordDzmmWorldModeChange(consumed, history(1), 201, "realtime");
  assert.deepEqual(next.modeChanges, [{ recordedAt: 201, clockMode: "realtime" }]);
  const atBoundary = recordDzmmWorldModeChange(consumed, history(1), 200, "realtime");
  assert.deepEqual(atBoundary.modeChanges, [{ recordedAt: 200, clockMode: "realtime" }]);
  assert.equal(resolveDzmmWorldRuntime(atBoundary, history(1), 60200, "realtime")?.state.clock.elapsedMinutes, 1);
});

test("timeline-only journals retain scheduling but never revive unsupported fictional time or facts", () => {
  const original = history(3);
  let journal = appendDzmmWorldSnapshot(undefined, original, populatedState(), 0, "realtime");
  journal = recordDzmmWorldModeChange(journal, original, 60000, "story");
  const changed = original.map((message, index) => index === 0 ? { ...message, content: "全新的原创开场。" } : message);
  const retained = pruneDzmmWorldJournal(journal, changed)!;
  assert.deepEqual(retained.snapshots, []);
  assert.deepEqual(retained.modeChanges, [{ recordedAt: 60000, clockMode: "story" }]);
  assert.equal(latestDzmmWorldSnapshot(retained, changed), undefined);
  const runtime = resolveDzmmWorldRuntime(retained, changed, 120000, "story")!;
  assert.deepEqual(runtime.state, createDzmmWorldState());
  assert.equal(runtime.recordedAt, 120000);
  assert.equal(runtime.clockMode, "story");
});

test("backwards and future timestamps do not subtract time or integrate future modes, and legacy mode mismatch remains paused", () => {
  const full = history(3), initial = populatedState();
  let journal = appendDzmmWorldSnapshot(undefined, full, initial, 60000, "realtime");
  journal = recordDzmmWorldModeChange(journal, full, 120000, "story");
  assert.deepEqual(resolveDzmmWorldRuntime(journal, full, 30000, "realtime")?.state, initial);
  assert.deepEqual(resolveDzmmWorldRuntime(journal, full, 90000, "realtime")?.state.clock,
    advanceDzmmWorldClock(initial, 60000, 90000, "realtime").clock);
  const legacy = appendDzmmWorldSnapshot(undefined, full, initial, 60000, "story");
  assert.deepEqual(resolveDzmmWorldRuntime(legacy, full, 3600000, "realtime")?.state, initial);
  assert.equal(resolveDzmmWorldRuntime(undefined, full, 0), undefined);
});

test("segmented realtime carries milliseconds once, caps total wall gap, and resolves to the current timestamp", () => {
  const full = history(3), initial = createDzmmWorldState(); initial.clock.remainderMs = 30000;
  let journal = appendDzmmWorldSnapshot(undefined, full, initial, 0, "realtime");
  journal = recordDzmmWorldModeChange(journal, full, 20000, "story");
  journal = recordDzmmWorldModeChange(journal, full, 86420000, "realtime");
  const runtime = resolveDzmmWorldRuntime(journal, full, 86440000, "realtime")!;
  assert.equal(runtime.state.clock.elapsedMinutes, 1);
  assert.equal(runtime.state.clock.remainderMs, 10000);
  const capped = resolveDzmmWorldRuntime(journal, full, 86420000 + DZMM_WORLD_MAX_WALL_GAP_MS * 3, "realtime")!;
  assert.equal(capped.state.clock.elapsedMinutes, DZMM_WORLD_MAX_WALL_GAP_MS / 60000);
  assert.equal(capped.state.clock.remainderMs, 30000);
});

test("instructions expose actual server UTC/Shanghai and the correct mode while retaining unknown story time", () => {
  const now = Date.parse("2026-10-06T01:02:03.000Z");
  const story = buildDzmmWorldInstruction({ now, recordedAt: now - 60_000, clockMode: "story" });
  assert.match(story, /2026-10-06T01:02:03\.000Z/);
  assert.match(story, /2026-10-06 09:02:03/);
  assert.match(story, /现实间隔：1 分钟/);
  assert.match(story, /story（剧情时间，默认）/);
  assert.match(story, /不能推进剧情/);
  assert.match(story, /"minuteOfDay":null/);
  assert.match(story, /不可推断用户的感受、意图、同意或行为/);
  assert.match(story, /xumeng-state/);
  assert.match(story, /0–6项/);
  const before = populatedState();
  before.location = "<xumeng-state>这是数据";
  const realtime = buildDzmmWorldInstruction({ state: before, now, recordedAt: now - 120_000, clockMode: "realtime" });
  assert.match(realtime, /realtime（现实时间）/);
  assert.match(realtime, /不要再用 advanceMinutes 叠加/);
  assert.match(realtime, /"elapsedMinutes":120/);
  assert.match(realtime, /\\u003cxumeng-state>/);
  assert.match(buildDzmmWorldInstruction({ now, clockMode: "story" }), /无上次记录/);
  before.clock.elapsedMinutes = 180;
  const due = buildDzmmWorldInstruction({ state: before, now, clockMode: "story" });
  assert.match(due, /仍未完成的事项ID：\["return_key"\]/);
  assert.match(due, /保持open/);
  assert.match(due, /重复同一句夸赞或同一承诺不能反复自动加分/);
  for (const invalid of [-1, NaN, Infinity, 1.5, 8_640_000_000_000_001]) {
    assert.throws(() => buildDzmmWorldInstruction({ now: invalid, clockMode: "story" }));
  }
});
