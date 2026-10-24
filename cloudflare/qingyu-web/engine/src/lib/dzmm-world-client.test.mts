import test from "node:test";
import assert from "node:assert/strict";
import clientModule from "./dzmm-world-client";
import worldModule from "./dzmm-world-state";
import type { DzmmStoryMessage } from "./dzmm-story-memory";

const { rebindDzmmWorldJournal } = clientModule as typeof import("./dzmm-world-client");
const { appendDzmmWorldSnapshot, createDzmmWorldState, recordDzmmWorldModeChange, resolveDzmmWorldRuntime,
  latestDzmmWorldSnapshot } = worldModule as typeof import("./dzmm-world-state");

function fixture() {
  const messages: DzmmStoryMessage[] = [
    { id: "opening", role: "assistant", content: "原创地图员在书店整理地图。" },
    { id: "question", role: "user", content: "我想核对图例。" },
    { id: "answer", role: "assistant", content: "图例已经铺在桌上。" },
  ];
  const early = createDzmmWorldState(); early.location = "原创书店";
  let journal = appendDzmmWorldSnapshot(undefined, messages.slice(0, 1), early, 0, "realtime");
  const later = createDzmmWorldState(); later.clock.elapsedMinutes = 10; later.location = "后来才去的露台";
  later.facts = ["已经借出地图。"];
  journal = appendDzmmWorldSnapshot(journal, messages, later, 600000, "realtime");
  journal = recordDzmmWorldModeChange(journal, messages, 600000, "story");
  journal = appendDzmmWorldSnapshot(journal, messages, later, 600000, "story");
  journal = recordDzmmWorldModeChange(journal, messages, 87000000, "realtime");
  journal = appendDzmmWorldSnapshot(journal, messages, later, 87000000, "realtime");
  return { messages, journal };
}

test("copied and historical branches rebind narrative IDs but preserve detached pause scheduling", () => {
  const { messages, journal } = fixture(), before = JSON.stringify(journal);
  const prefix = messages.slice(0, -1), copied = prefix.map(message => ({ ...message, id: `copied-${message.id}` }));
  const rebound = rebindDzmmWorldJournal(journal, prefix, copied)!;
  assert.deepEqual(rebound.modeChanges, journal.modeChanges);
  assert.notEqual(rebound.modeChanges, journal.modeChanges);
  assert.notEqual(rebound.modeChanges?.[0], journal.modeChanges?.[0]);
  assert.equal(rebound.snapshots.length, 1);
  assert.notEqual(rebound.snapshots[0].sourceFingerprint, journal.snapshots[0].sourceFingerprint);
  const runtime = resolveDzmmWorldRuntime(rebound, copied, 87060000, "realtime")!;
  assert.equal(runtime.state.clock.elapsedMinutes, 11);
  assert.equal(runtime.state.location, "原创书店");
  assert.deepEqual(runtime.state.facts, []);
  rebound.modeChanges![0].recordedAt++;
  rebound.snapshots[0].state.location = "分支自己的修改";
  assert.equal(JSON.stringify(journal), before);
});

test("timeline-only copies contain no fictional state and mismatched raw copies are rejected", () => {
  const { messages, journal } = fixture();
  const changed = messages.map((message, index) => index === 0 ? { ...message, content: "新的原创开场。" } : message);
  const copied = changed.map(message => ({ ...message, id: `new-${message.id}` }));
  const rebound = rebindDzmmWorldJournal(journal, changed, copied)!;
  assert.deepEqual(rebound.snapshots, []);
  assert.deepEqual(rebound.modeChanges, journal.modeChanges);
  assert.equal(latestDzmmWorldSnapshot(rebound, copied), undefined);
  assert.deepEqual(resolveDzmmWorldRuntime(rebound, copied, 87060000, "realtime")?.state, createDzmmWorldState());
  assert.equal(rebindDzmmWorldJournal(journal, messages, copied), undefined);
  assert.equal(rebindDzmmWorldJournal(journal, messages, copied.slice(0, -1)), undefined);
});

test("legacy journals remain legacy after rebinding rather than inventing past mode changes", () => {
  const { messages } = fixture();
  const legacy = appendDzmmWorldSnapshot(undefined, messages, createDzmmWorldState(), 1000, "story");
  const copied = messages.map(message => ({ ...message, id: `legacy-copy-${message.id}` }));
  assert.equal(rebindDzmmWorldJournal(legacy, messages, copied)?.modeChanges, undefined);
});
