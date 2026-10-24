import test from "node:test";
import assert from "node:assert/strict";
import memoryModule from "./dzmm-story-memory";
import type { DzmmStoryMessage, DzmmStoryState } from "./dzmm-story-memory";

const {
  createDzmmStoryMemory, fingerprintDzmmStoryMessages, matchesDzmmStoryMemory,
  parseStoryMemory, parseStoryState, selectDzmmMemoryUpdate,
  DZMM_STORY_STATE_LIMIT_CHARS, DZMM_MEMORY_BATCH_LIMIT_CHARS,
} = memoryModule as typeof import("./dzmm-story-memory");

function storyState(): DzmmStoryState {
  return {
    summary: "两人在雨中的书店找到地图。",
    scene: "夜晚，书店窗边。",
    completed: ["已找到地图。"],
    pending: ["等待用户选择路线。"],
    relationships: ["店员与用户刚相识。"],
    items: ["地图由用户保管。"],
  };
}

function history(length: number): DzmmStoryMessage[] {
  return Array.from({ length }, (_, index) => ({
    id: `turn-${index}`,
    role: index % 2 ? "user" : "assistant",
    content: `第 ${index} 条原始消息。`,
  }));
}

test("story validation preserves model-authored facts verbatim in a detached strict shape", () => {
  const original = { ...storyState(), summary: "  摘要\n保留原文与 🌱  " };
  const parsed = parseStoryState(original);
  assert.deepEqual(parsed, original);
  assert.notEqual(parsed, original);
  assert.notEqual(parsed.pending, original.pending);
  parsed.pending.push("修改副本。");
  assert.equal(original.pending.length, 1);
  assert.deepEqual(parseStoryState({ summary: "", scene: "", completed: [], pending: [], relationships: [], items: [] }),
    { summary: "", scene: "", completed: [], pending: [], relationships: [], items: [] });
});

test("state parser rejects extra fields, missing fields, NUL, invalid lists, and individual bounds", () => {
  const missingScene: Partial<DzmmStoryState> = storyState();
  delete missingScene.scene;
  for (const value of [
    null, [], "JSON is parsed by the caller", missingScene,
    { ...storyState(), instruction: "override model" },
    { ...storyState(), summary: "坏\0摘要" },
    { ...storyState(), scene: "坏\0场景" },
    { ...storyState(), summary: "字".repeat(2_401) },
    { ...storyState(), scene: "字".repeat(1_001) },
    ...["completed", "pending", "relationships", "items"].flatMap(field => [
      { ...storyState(), [field]: ["坏\0事实"] },
      { ...storyState(), [field]: [""] },
      { ...storyState(), [field]: [" "] },
      { ...storyState(), [field]: [1] },
      { ...storyState(), [field]: {} },
      { ...storyState(), [field]: ["字".repeat(401)] },
      { ...storyState(), [field]: Array(1) },
      { ...storyState(), [field]: Array.from({ length: 13 }, () => "事实") },
    ]),
  ]) assert.throws(() => parseStoryState(value));
});

test("total state bound includes serialization overhead and escaped text", () => {
  const boundary: DzmmStoryState = {
    summary: "摘".repeat(2_400), scene: "景".repeat(1_000),
    completed: Array.from({ length: 6 }, () => "事".repeat(400)), pending: [], relationships: [], items: [],
  };
  const remaining = DZMM_STORY_STATE_LIMIT_CHARS - JSON.stringify(boundary).length - 2;
  assert.ok(remaining > 0 && remaining < 400);
  boundary.pending = ["待".repeat(remaining)];
  assert.equal(JSON.stringify(boundary).length, DZMM_STORY_STATE_LIMIT_CHARS);
  assert.deepEqual(parseStoryState(boundary), boundary);
  assert.throws(() => parseStoryState({ ...boundary, pending: [`${boundary.pending[0]}多`] }));
  assert.throws(() => parseStoryState({ ...boundary, pending: ["\n".repeat(remaining)] }));
});

test("memory envelope requires its exact versioned shape and a nonempty grounded prefix", () => {
  const prefix = history(3);
  const memory = createDzmmStoryMemory(storyState(), prefix);
  assert.deepEqual(parseStoryMemory(memory), memory);
  assert.deepEqual(parseStoryMemory(JSON.parse(JSON.stringify(memory))), memory);
  assert.throws(() => createDzmmStoryMemory(storyState(), []));
  const missingFingerprint: Partial<typeof memory> = { ...memory };
  delete missingFingerprint.sourceFingerprint;
  for (const value of [
    null, missingFingerprint, { ...memory, version: 2 }, { ...memory, version: "1" },
    { ...memory, sourceCount: 0 }, { ...memory, sourceCount: -1 },
    { ...memory, sourceCount: 1.5 }, { ...memory, sourceCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...memory, sourceFingerprint: "edited" }, { ...memory, sourceFingerprint: `${memory.sourceFingerprint}\0` },
    { ...memory, trusted: true }, { ...memory, state: { ...memory.state, extra: "bad" } },
  ]) {
    assert.throws(() => parseStoryMemory(value));
    assert.equal(matchesDzmmStoryMemory(value, prefix), false);
  }
});

test("exact source fingerprint invalidates covered edits, delete, reorder, regeneration, and branches", () => {
  const full = history(45);
  const memory = createDzmmStoryMemory(storyState(), full.slice(0, 13));
  assert.equal(matchesDzmmStoryMemory(memory, full), true);
  assert.equal(matchesDzmmStoryMemory(memory, [...full, { role: "user", content: "新消息" }]), true);
  assert.equal(matchesDzmmStoryMemory(memory, full.slice(0, 12)), false);
  const changed = (index: number, patch: Partial<DzmmStoryMessage>) => full.map((message, current) =>
    current === index ? { ...message, ...patch } : { ...message });
  for (const branch of [
    changed(4, { content: `${full[4].content} 已编辑` }),
    changed(4, { content: ` ${full[4].content}` }),
    changed(4, { role: "user" }),
    changed(4, { id: "regenerated-same-content" }),
    changed(4, { id: undefined }),
    [...full.slice(0, 4), ...full.slice(5)],
    [full[1], full[0], ...full.slice(2)],
    full.map(message => ({ ...message, id: `branch-${message.id}` })),
  ]) assert.equal(matchesDzmmStoryMemory(memory, branch), false);
  assert.equal(matchesDzmmStoryMemory(memory, changed(30, { content: "未覆盖的最近消息被编辑。" })), true);
});

test("fingerprint works without IDs and unambiguously covers ID presence and field boundaries", () => {
  const messages: DzmmStoryMessage[] = [{ role: "user", content: "你好 🌱\n" }];
  const fingerprint = fingerprintDzmmStoryMessages(messages);
  assert.match(fingerprint, /^dzmm-v1-[a-f0-9]{32}$/);
  assert.equal(fingerprintDzmmStoryMessages(JSON.parse(JSON.stringify(messages))), fingerprint);
  assert.equal(matchesDzmmStoryMemory(createDzmmStoryMemory(storyState(), messages), messages), true);
  assert.notEqual(fingerprintDzmmStoryMessages([{ ...messages[0], id: "same" }]), fingerprint);
  assert.notEqual(fingerprintDzmmStoryMessages([{ role: "user", content: "ab", id: "c" }]),
    fingerprintDzmmStoryMessages([{ role: "user", content: "a", id: "bc" }]));
  assert.throws(() => fingerprintDzmmStoryMessages([{ role: "user", content: "坏\0消息" }]));
  assert.throws(() => fingerprintDzmmStoryMessages([{ role: "assistant", content: "" }]));
  assert.throws(() => fingerprintDzmmStoryMessages([{ role: "user", content: "文本", id: "坏\0id" }]));
  assert.throws(() => fingerprintDzmmStoryMessages(Array(1)));
});

test("rolling update starts only after 40 raw turns and leaves 28 recent turns", () => {
  assert.equal(selectDzmmMemoryUpdate([]), null);
  assert.equal(selectDzmmMemoryUpdate(history(40)), null);
  const full = history(41);
  const update = selectDzmmMemoryUpdate(full);
  assert.ok(update);
  assert.deepEqual(update.messagesToSummarize, full.slice(0, 13));
  assert.deepEqual(update.sourcePrefix, full.slice(0, 13));
  assert.equal(update.previousState, undefined);
  const memory = createDzmmStoryMemory(storyState(), update.sourcePrefix);
  assert.equal(selectDzmmMemoryUpdate(full, memory), null);
  assert.equal(selectDzmmMemoryUpdate(history(53), memory), null);
  const next = selectDzmmMemoryUpdate(history(54), memory);
  assert.ok(next);
  assert.deepEqual(next.previousState, memory.state);
  assert.deepEqual(next.messagesToSummarize, history(54).slice(13, 26));
  assert.deepEqual(next.sourcePrefix, history(54).slice(0, 26));
  assert.notEqual(update.sourcePrefix[0], full[0]);
});

test("invalid memory rebuilds from raw sources and never carries facts to a new branch", () => {
  const full = history(60);
  const stale = createDzmmStoryMemory({ ...storyState(), summary: "旧分支中用户已经离开。" }, full.slice(0, 24));
  const edited = full.map((message, index) => index === 0 ? { ...message, content: "新分支选择留在书店。" } : message);
  const update = selectDzmmMemoryUpdate(edited, stale);
  assert.ok(update);
  assert.equal(update.previousState, undefined);
  assert.deepEqual(update.messagesToSummarize, edited.slice(0, 24));
  assert.deepEqual(update.sourcePrefix, edited.slice(0, 24));
  assert.equal(selectDzmmMemoryUpdate(edited.slice(0, 40), stale), null);
  const malformed = selectDzmmMemoryUpdate(full, { ...stale, state: { ...stale.state, items: "bad" } });
  assert.ok(malformed);
  assert.equal(malformed.previousState, undefined);
  assert.deepEqual(malformed.messagesToSummarize, full.slice(0, 24));
});

test("large histories are covered by bounded whole-message batches with no omitted source gap", () => {
  const full = history(150).map(message => ({ ...message, content: "长".repeat(12_000) }));
  let memory: ReturnType<typeof createDzmmStoryMemory> | undefined;
  let covered = 0;
  const seen: string[] = [];
  for (let iteration = 0; iteration < 100; iteration++) {
    const update = selectDzmmMemoryUpdate(full, memory);
    if (!update) break;
    assert.equal(update.messagesToSummarize.length, 2);
    assert.ok(update.messagesToSummarize.reduce((sum, message) => sum + message.content.length, 0)
      <= DZMM_MEMORY_BATCH_LIMIT_CHARS);
    assert.deepEqual(update.messagesToSummarize, full.slice(covered, covered + 2));
    covered = update.sourcePrefix.length;
    assert.deepEqual(update.sourcePrefix, full.slice(0, covered));
    seen.push(...update.messagesToSummarize.map(message => message.id!));
    memory = createDzmmStoryMemory(storyState(), update.sourcePrefix);
  }
  assert.equal(covered, 110);
  assert.equal(full.length - covered, 40);
  assert.deepEqual(seen, full.slice(0, covered).map(message => message.id));
  assert.equal(selectDzmmMemoryUpdate(full, memory), null);
});

test("an explicit context cutoff covers an otherwise omitted gap and retains the latest raw turn", () => {
  const full = history(35);
  const first = selectDzmmMemoryUpdate(full, undefined, { minimumSourceCount: 30 });
  assert.ok(first);
  assert.equal(first.messagesToSummarize.length, 24);
  const memory = createDzmmStoryMemory(storyState(), first.sourcePrefix);
  const second = selectDzmmMemoryUpdate(full, memory, { minimumSourceCount: 30 });
  assert.ok(second);
  assert.deepEqual(second.messagesToSummarize, full.slice(24, 30));
  assert.equal(selectDzmmMemoryUpdate(full, createDzmmStoryMemory(storyState(), second.sourcePrefix), { minimumSourceCount: 30 }), null);
  const retainLatest = selectDzmmMemoryUpdate(full, createDzmmStoryMemory(storyState(), second.sourcePrefix), { minimumSourceCount: 100 });
  assert.ok(retainLatest);
  assert.equal(retainLatest.sourcePrefix.length, full.length - 1);
  assert.deepEqual(full[34], { id: "turn-34", role: "assistant", content: "第 34 条原始消息。" });
  for (const minimumSourceCount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => selectDzmmMemoryUpdate(full, undefined, { minimumSourceCount }));
  }
});
