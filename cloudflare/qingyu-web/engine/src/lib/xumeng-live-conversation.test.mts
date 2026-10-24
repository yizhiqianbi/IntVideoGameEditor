import test from "node:test";
import assert from "node:assert/strict";
import handoffModule from "./xumeng-live-conversation.ts";
import worldModule from "./dzmm-world-state.ts";
const { buildXumengLiveConversationHandoff } = handoffModule as typeof import("./xumeng-live-conversation.ts");
const { appendDzmmWorldSnapshot, createDzmmWorldState } = worldModule as typeof import("./dzmm-world-state.ts");
const prefix = [{ id: "u1", role: "user" as const, content: "我们去码头寻找灯油。" }, { id: "a1", role: "assistant" as const, content: "我在码头等你。" }];
const messages = [...prefix, { id: "u2", role: "user" as const, content: "灯油已经找到了，我们来到山顶地图室。" }, { id: "a2", role: "assistant" as const, content: "这里视野清楚，现在核实航线。" }];

test("a valid old prefix snapshot cannot override the newer dialogue in a live handoff", () => {
  const state = createDzmmWorldState(); state.location = "旧码头";
  state.threads = [{ id: "oil", kind: "goal", text: "寻找灯油", status: "open", dueAtMinute: null }];
  const journal = appendDzmmWorldSnapshot(undefined, prefix, state, 1000, "story");
  const scene = buildXumengLiveConversationHandoff(messages, journal, 2000);
  assert.equal(scene.situation, ""); assert.equal(scene.goal, "");
  assert.match(scene.recentDialogue.at(-2)!.text, /山顶地图室/);
  assert.equal(scene.recentDialogue.length, 4);
});

test("only current fingerprint-matched facts are carried to live; edits invalidate them", () => {
  const state = createDzmmWorldState(); state.location = "山顶地图室";
  state.threads = [{ id: "oil", kind: "goal", text: "寻找灯油", status: "done", dueAtMinute: null }];
  const journal = appendDzmmWorldSnapshot(undefined, messages, state, 1000, "story");
  const scene = buildXumengLiveConversationHandoff(messages, journal, 2000);
  assert.match(scene.situation, /山顶地图室/); assert.match(scene.ended, /已完成：寻找灯油/);
  assert.equal(buildXumengLiveConversationHandoff(messages.map((row, index) => index === 3 ? { ...row, content: "仍然在码头。" } : row), journal, 2000).situation, "");
});
