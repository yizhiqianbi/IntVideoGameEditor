import test from "node:test";
import assert from "node:assert/strict";
import actionsModule from "./dzmm-message-actions";
import openingModule from "./dzmm-conversation-context";
import memoryModule from "./dzmm-story-memory";
import worldModule from "./dzmm-world-state";
import type { DzmmSavedConversation, DzmmSavedMessage } from "./dzmm-storage";

const { editDzmmConversationMessage, createDzmmRegenerationBranch, canRegenerateDzmmMessage,
  captureDzmmReplySuggestionContext, createDzmmReplySuggestionBranch,
  DZMM_MESSAGE_EDIT_MAX_CHARS } = actionsModule as typeof import("./dzmm-message-actions");
const { parseDzmmConversationOpening } = openingModule as typeof import("./dzmm-conversation-context");
const { createDzmmStoryMemory, matchesDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");
const { appendDzmmWorldSnapshot, createDzmmWorldState, pruneDzmmWorldJournal } = worldModule as typeof import("./dzmm-world-state");

function fixture(): DzmmSavedConversation {
  const messages: DzmmSavedMessage[] = [
    { id: "message-0", role: "assistant", content: "旧书店开门了，地图柜还没有整理。" },
    { id: "message-1", role: "user", content: "请帮我找港湾地图。" },
    { id: "message-2", role: "assistant", content: "我从抽屉取出一张港湾地图。" },
    { id: "message-3", role: "user", content: "我抄下地图图例。" },
    { id: "message-4", role: "assistant", content: "图例抄好了，窗外雨也停了。" },
    { id: "message-5", role: "user", content: "把柜门关上吧。" },
    { id: "message-6", role: "assistant", content: "柜门关好了，我们去门边看看天气。" },
  ];
  const conversation: DzmmSavedConversation = { id: "original-conversation", characterId: "original-mapkeeper",
    title: "原创测试·港湾地图", updatedAt: 10, messages, worldClockMode: "realtime",
    opening: parseDzmmConversationOpening({ version: 1, kind: "opening", source: "template",
      messages: [{ role: "assistant", content: messages[0].content }] }),
    storyMemory: createDzmmStoryMemory({ summary: "已经找到港湾地图。", scene: "旧书店", completed: ["找到地图"],
      pending: ["核对图例"], relationships: ["店主愿意帮忙查资料。"], items: ["港湾地图"] }, messages.slice(0, 3)) };
  for (const sourceCount of [1, 3, 5, 7]) {
    const state = createDzmmWorldState();
    state.location = "旧书店"; state.clock.elapsedMinutes = sourceCount * 5;
    state.facts = [`已经整理第 ${sourceCount} 条记录。`];
    state.relationships = [{ name: "地图员", affinity: 0, trust: sourceCount, tension: 0, note: "共同核对地图。" }];
    conversation.worldState = appendDzmmWorldSnapshot(conversation.worldState, messages.slice(0, sourceCount), state,
      1700000000000 + sourceCount * 1000, "realtime");
  }
  return conversation;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test("editing a covered user turn preserves raw text and IDs, removes memory, and retains only earlier world snapshots", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  const raw = "  我改查**灯塔地图**。\n\n 保留这些空白。  ";
  const edited = editDzmmConversationMessage(original, "message-1", raw, { now: 100 });
  assert.equal(edited.messages[1].content, raw);
  assert.equal(edited.messages[1].id, "message-1");
  assert.equal(edited.messages[1].role, "user");
  assert.deepEqual(edited.messages.filter((_message, index) => index !== 1), original.messages.filter((_message, index) => index !== 1));
  assert.equal(edited.messages.length, original.messages.length);
  assert.equal(edited.updatedAt, 100);
  assert.equal(edited.id, original.id);
  assert.equal(edited.worldClockMode, "realtime");
  assert.equal(edited.storyMemory, undefined);
  assert.deepEqual(edited.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1]);
  assert.deepEqual(edited.opening, original.opening);
  assert.equal(JSON.stringify(original), before);
});

test("editing an assistant after the memory prefix keeps valid memory and removes only affected world coverage", () => {
  const original = freeze(fixture());
  const edited = editDzmmConversationMessage(original, "message-4", "图例核对完毕，雨还没有停。", { now: 101 });
  assert.equal(edited.messages[4].role, "assistant");
  assert.equal(edited.messages[4].id, original.messages[4].id);
  assert.equal(matchesDzmmStoryMemory(edited.storyMemory, edited.messages), true);
  assert.deepEqual(edited.storyMemory, original.storyMemory);
  assert.notEqual(edited.storyMemory, original.storyMemory);
  assert.notEqual(edited.storyMemory?.state.items, original.storyMemory?.state.items);
  assert.deepEqual(edited.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1, 3]);
  assert.equal(pruneDzmmWorldJournal(edited.worldState, edited.messages)?.snapshots.length, 2);
});

test("editing an authored opening makes edited history authoritative and clears all stale covered state", () => {
  const original = freeze(fixture());
  const edited = editDzmmConversationMessage(original, "message-0", "傍晚我们改在灯塔见面。");
  assert.deepEqual(edited.opening, { version: 1, kind: "opening", source: "history", messages: [] });
  assert.equal(edited.storyMemory, undefined);
  assert.equal(edited.worldState, undefined);
  assert.equal(original.opening?.source, "template");
  assert.equal(edited.messages[0].content, "傍晚我们改在灯塔见面。");
});

test("invalid edits fail before changing data; the limit accepts exact raw text and unchanged edits are no-ops", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  for (const content of ["", " \n\t ", "地\0图", "字".repeat(DZMM_MESSAGE_EDIT_MAX_CHARS + 1)]) {
    assert.throws(() => editDzmmConversationMessage(original, "message-1", content), /非空文本/);
  }
  assert.throws(() => editDzmmConversationMessage(original, "missing-message", "新的文字。"), /已不存在/);
  const exact = "字".repeat(DZMM_MESSAGE_EDIT_MAX_CHARS);
  assert.equal(editDzmmConversationMessage(original, "message-1", exact).messages[1].content, exact);
  assert.equal(editDzmmConversationMessage(original, "message-1", original.messages[1].content, { now: 999 }), original);
  assert.equal(JSON.stringify(original), before);
});

test("historical regeneration creates a detached user-ending branch with rebound valid memory and world", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  let counter = 0;
  const branch = createDzmmRegenerationBranch(original, "message-4", { now: 102, createId: () => `branch-${++counter}` });
  assert.equal(branch.updatedAt, 102);
  assert.equal(branch.characterId, original.characterId);
  assert.equal(branch.worldClockMode, "realtime");
  assert.notEqual(branch.id, original.id);
  assert.equal(branch.messages.length, 4);
  assert.equal(branch.messages.at(-1)?.role, "user");
  assert.deepEqual(branch.messages.map(({ role, content }) => ({ role, content })),
    original.messages.slice(0, 4).map(({ role, content }) => ({ role, content })));
  assert.ok(branch.messages.every(message => !original.messages.some(previous => previous.id === message.id)));
  assert.equal(matchesDzmmStoryMemory(branch.storyMemory, branch.messages), true);
  assert.notEqual(branch.storyMemory?.sourceFingerprint, original.storyMemory?.sourceFingerprint);
  assert.deepEqual(branch.storyMemory?.state, original.storyMemory?.state);
  assert.deepEqual(branch.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1, 3]);
  assert.equal(pruneDzmmWorldJournal(branch.worldState, branch.messages)?.snapshots.length, 2);
  for (const snapshot of branch.worldState!.snapshots) {
    const source = original.worldState!.snapshots.find(candidate => candidate.sourceCount === snapshot.sourceCount)!;
    assert.deepEqual(snapshot.state, source.state);
    assert.equal(snapshot.recordedAt, source.recordedAt);
    assert.equal(snapshot.clockMode, source.clockMode);
    assert.notEqual(snapshot.sourceFingerprint, source.sourceFingerprint);
  }
  assert.deepEqual(branch.opening, original.opening);
  branch.messages[0].content = "分支独立修改。";
  branch.storyMemory!.state.items.push("分支物件");
  branch.worldState!.snapshots[0].state.facts.push("分支事实");
  branch.worldState!.snapshots[0].state.relationships[0].trust = 80;
  branch.opening!.messages[0].content = "分支开场。";
  assert.equal(JSON.stringify(original), before, "No branch mutation may change the original history or nested metadata");
});

test("rewinding before the remembered prefix drops future memory and world while preserving story mode", () => {
  const original = freeze({ ...fixture(), worldClockMode: "story" as const });
  let id = 0;
  const branch = createDzmmRegenerationBranch(original, "message-2", { createId: () => `rewind-${++id}` });
  assert.equal(branch.messages.length, 2);
  assert.equal(branch.storyMemory, undefined);
  assert.deepEqual(branch.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1]);
  assert.equal(branch.worldClockMode, "story");
  assert.equal(branch.worldState?.snapshots[0].clockMode, "realtime", "Historical snapshot provenance is not rewritten by copying");
});

test("adjacent assistant chunks rewind through the nearest earlier user rather than ending the request on an assistant", () => {
  const original = fixture();
  original.messages.splice(4, 0, { id: "assistant-chunk", role: "assistant", content: "我先把图例铺平。" });
  const branch = createDzmmRegenerationBranch(freeze(original), "message-4");
  assert.equal(branch.messages.length, 4);
  assert.equal(branch.messages.at(-1)?.content, original.messages[3].content);
  assert.equal(branch.messages.some(message => message.content === "我先把图例铺平。"), false);
  assert.equal(branch.messages.some(message => message.content === original.messages[5].content), false);
});

test("assistant-only openings, user targets and missing messages cannot start regeneration", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  for (const target of ["message-0", "message-1", "missing-message"]) {
    assert.equal(canRegenerateDzmmMessage(original, target), false);
    assert.throws(() => createDzmmRegenerationBranch(original, target), /前置用户消息/);
  }
  assert.equal(canRegenerateDzmmMessage(original, "message-4"), true);
  assert.equal(JSON.stringify(original), before);
});

test("regenerating an authored assistant after an opening user excludes the authored answer from the new prompt", () => {
  const messages: DzmmSavedMessage[] = [
    { id: "opening-user", role: "user", content: "我在灯塔门前敲门。" },
    { id: "opening-assistant", role: "assistant", content: "管理员打开门，请你进来。" },
  ];
  const original: DzmmSavedConversation = { id: "opening-conversation", characterId: "lighthouse", title: "灯塔",
    updatedAt: 1, messages, opening: parseDzmmConversationOpening({ version: 1, kind: "opening", source: "template", messages }) };
  const branch = createDzmmRegenerationBranch(freeze(original), "opening-assistant");
  assert.equal(branch.messages.length, 1);
  assert.equal(branch.messages[0].role, "user");
  assert.deepEqual(branch.opening, { version: 1, kind: "opening", source: "history", messages: [] });
  assert.equal(original.messages.length, 2);
  assert.equal(original.opening?.source, "template");
});

test("injected ID collisions still create distinct branch IDs and invalid IDs fail without changing the source", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  const branch = createDzmmRegenerationBranch(original, "message-4", { createId: () => "message-0" });
  const ids = [branch.id, ...branch.messages.map(message => message.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => ![original.id, ...original.messages.map(message => message.id)].includes(id)));
  for (const invalid of ["", " ", "bad\0id", "x".repeat(121)]) {
    assert.throws(() => createDzmmRegenerationBranch(original, "message-4", { createId: () => invalid }), /标识无效/);
  }
  assert.equal(JSON.stringify(original), before);
});

test("suggestions capture the chosen historical reply including its full prefix, without future facts or clock advancement", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  const context = captureDzmmReplySuggestionContext(original, "message-2");
  assert.equal(context.id, original.id);
  assert.equal(context.updatedAt, original.updatedAt);
  assert.equal(context.characterId, original.characterId);
  assert.equal(context.worldClockMode, "realtime");
  assert.deepEqual(context.messages, original.messages.slice(0, 3));
  assert.equal(context.messages.at(-1)?.content, original.messages[2].content);
  assert.notEqual(context.messages[0], original.messages[0]);
  assert.equal(matchesDzmmStoryMemory(context.storyMemory, context.messages), true);
  assert.deepEqual(context.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1, 3]);
  assert.equal(context.worldState?.snapshots.at(-1)?.state.clock.elapsedMinutes, 15);
  assert.equal(context.worldState?.snapshots.at(-1)?.recordedAt, original.worldState?.snapshots[1].recordedAt);
  assert.equal(JSON.stringify(context).includes(original.messages[4].content), false);
  assert.equal(JSON.stringify(original), before);
});

test("suggestions for the latest reply capture detached messages and valid metadata without changing history", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  const context = captureDzmmReplySuggestionContext(original, "message-6");
  assert.deepEqual(context, original);
  assert.notEqual(context, original);
  context.messages[0].content = "独立修改建议来源。";
  context.storyMemory!.state.items.push("上下文独立物件");
  context.worldState!.snapshots[0].state.facts.push("上下文独立事实");
  context.worldState!.snapshots[0].state.relationships[0].trust = 60;
  context.opening!.messages[0].content = "上下文独立开场。";
  assert.equal(JSON.stringify(original), before);
});

test("assistant-only opening suggestions are allowed, drop future memory, and create an assistant-ending action branch", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  const context = captureDzmmReplySuggestionContext(original, "message-0");
  assert.equal(context.messages.length, 1);
  assert.equal(context.storyMemory, undefined);
  assert.deepEqual(context.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1]);
  assert.deepEqual(context.opening, original.opening);
  let counter = 0;
  const branch = createDzmmReplySuggestionBranch(original, "message-0", { now: 200, createId: () => `action-${++counter}` });
  assert.equal(branch.messages.length, 1);
  assert.equal(branch.messages.at(-1)?.role, "assistant");
  assert.equal(branch.messages[0].content, original.messages[0].content);
  assert.equal(branch.storyMemory, undefined);
  assert.equal(branch.updatedAt, 200);
  assert.equal(branch.title, `${original.title} · 行动分支`);
  assert.deepEqual(branch.opening, original.opening);
  assert.notEqual(branch.opening, original.opening);
  assert.deepEqual(branch.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1]);
  assert.equal(pruneDzmmWorldJournal(branch.worldState, branch.messages)?.snapshots.length, 1);
  assert.equal(JSON.stringify(original), before);
});

test("a historical suggestion branch keeps the chosen assistant, rebinds valid facts, and never adds an unsent user turn", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  let counter = 0;
  const branch = createDzmmReplySuggestionBranch(original, "message-4", { now: 201, createId: () => `historical-${++counter}` });
  assert.notEqual(branch.id, original.id);
  assert.equal(branch.messages.length, 5);
  assert.equal(branch.messages.at(-1)?.role, "assistant");
  assert.deepEqual(branch.messages.map(({ role, content }) => ({ role, content })),
    original.messages.slice(0, 5).map(({ role, content }) => ({ role, content })));
  assert.equal(matchesDzmmStoryMemory(branch.storyMemory, branch.messages), true);
  assert.notEqual(branch.storyMemory?.sourceFingerprint, original.storyMemory?.sourceFingerprint);
  assert.deepEqual(branch.storyMemory?.state, original.storyMemory?.state);
  assert.deepEqual(branch.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1, 3, 5]);
  assert.equal(pruneDzmmWorldJournal(branch.worldState, branch.messages)?.snapshots.length, 3);
  for (const snapshot of branch.worldState!.snapshots) {
    const source = original.worldState!.snapshots.find(candidate => candidate.sourceCount === snapshot.sourceCount)!;
    assert.deepEqual(snapshot.state, source.state);
    assert.equal(snapshot.recordedAt, source.recordedAt);
    assert.equal(snapshot.clockMode, source.clockMode);
    assert.notEqual(snapshot.sourceFingerprint, source.sourceFingerprint);
  }
  branch.messages[0].content = "分支消息。";
  branch.storyMemory!.state.items.push("分支物件");
  branch.worldState!.snapshots[0].state.facts.push("分支事实");
  branch.opening!.messages[0].content = "分支开场。";
  assert.equal(JSON.stringify(original), before);
});

test("suggestions never carry future-covered or stale memory and world snapshots into the chosen prefix", () => {
  const original = fixture();
  original.storyMemory = createDzmmStoryMemory({ summary: "柜门已经关好。", scene: "门边", completed: ["关柜门"],
    pending: [], relationships: [], items: [] }, original.messages);
  const historical = captureDzmmReplySuggestionContext(freeze(original), "message-2");
  assert.equal(historical.storyMemory, undefined);
  assert.deepEqual(historical.worldState?.snapshots.map(snapshot => snapshot.sourceCount), [1, 3]);
  assert.equal(JSON.stringify(historical).includes("柜门已经关好"), false);
  const editedHistory = fixture();
  editedHistory.messages[0].content = "我们其实在灯塔，不在旧书店。";
  const stale = captureDzmmReplySuggestionContext(freeze(editedHistory), "message-6");
  assert.equal(stale.storyMemory, undefined);
  assert.equal(stale.worldState, undefined);
  assert.deepEqual(stale.opening, { version: 1, kind: "opening", source: "history", messages: [] });
});

test("a partially captured multi-turn opening is reconciled to history so future authored turns are not injected", () => {
  const original = fixture();
  original.opening = parseDzmmConversationOpening({ version: 1, kind: "opening", source: "template",
    messages: original.messages.slice(0, 3).map(({ role, content }) => ({ role, content })) });
  const context = captureDzmmReplySuggestionContext(freeze(original), "message-0");
  assert.deepEqual(context.opening, { version: 1, kind: "opening", source: "history", messages: [] });
  assert.equal(context.messages.length, 1);
  const complete = captureDzmmReplySuggestionContext(original, "message-2");
  assert.deepEqual(complete.opening, original.opening);
});

test("suggestion branches for the latest reply have new IDs throughout, including when generated IDs collide with future IDs", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  const branch = createDzmmReplySuggestionBranch(original, "message-6", { createId: () => "message-6" });
  assert.equal(branch.messages.length, original.messages.length);
  const ids = [branch.id, ...branch.messages.map(message => message.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => ![original.id, ...original.messages.map(message => message.id)].includes(id)));
  const past = createDzmmReplySuggestionBranch(original, "message-0", { createId: () => "message-6" });
  assert.notEqual(past.id, "message-6");
  assert.notEqual(past.messages[0].id, "message-6");
  assert.equal(JSON.stringify(original), before);
});

test("suggestion contexts reject missing and user targets; invalid branch IDs fail without source mutation", () => {
  const original = freeze(fixture()), before = JSON.stringify(original);
  for (const target of ["message-1", "missing-message"]) {
    assert.throws(() => captureDzmmReplySuggestionContext(original, target), /助手回复|已不存在/);
    assert.throws(() => createDzmmReplySuggestionBranch(original, target), /助手回复|已不存在/);
  }
  for (const invalid of ["", " ", "bad\0id", "x".repeat(121)]) {
    assert.throws(() => createDzmmReplySuggestionBranch(original, "message-0", { createId: () => invalid }), /标识无效/);
  }
  assert.equal(JSON.stringify(original), before);
});
