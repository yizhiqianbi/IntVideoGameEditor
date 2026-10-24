import test from "node:test";
import assert from "node:assert/strict";
import streamModule from "./dzmm-world-stream";
import clientModule from "./dzmm-world-client";
import stateModule from "./dzmm-world-state";
import type { DzmmStoryMessage } from "./dzmm-story-memory";

const { createDzmmWorldTailFilter, readDzmmWorldResponse, encodeDzmmWorldEvent, WORLD_OPEN, WORLD_CLOSE } =
  streamModule as typeof import("./dzmm-world-stream");
const { rebindDzmmWorldJournal } = clientModule as typeof import("./dzmm-world-client");
const { createDzmmWorldState, appendDzmmWorldSnapshot, latestDzmmWorldSnapshot } =
  stateModule as typeof import("./dzmm-world-state");
const encoder = new TextEncoder();

function responseFromBytes(chunks: Uint8Array[], framed = true, onCancel = () => {}) {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel: onCancel,
  }), { headers: { "Content-Type": framed ? "text/event-stream; charset=utf-8" : "text/plain; charset=utf-8" } });
}

function framedResponse(events: unknown[]) {
  return responseFromBytes([encoder.encode(events.map(encodeDzmmWorldEvent).join(""))]);
}

test("metadata remains hidden at every string split, including inside markers and Unicode prose", () => {
  const visible = "店员收起雨伞🌧️，走进书店。\n";
  const proposal = { version: 1, changes: [{ type: "location", value: "书店", from: "assistant", quote: "走进书店。" }] };
  const source = visible + WORLD_OPEN + JSON.stringify(proposal) + WORLD_CLOSE;
  for (let split = 0; split <= source.length; split++) {
    const filter = createDzmmWorldTailFilter();
    const answer = filter.push(source.slice(0, split)) + filter.push(source.slice(split)) + filter.finish();
    assert.equal(answer, visible, `split at UTF-16 position ${split}`);
    assert.deepEqual(filter.proposal(), proposal);
  }
  const filter = createDzmmWorldTailFilter();
  const answer = source.split("").map(char => filter.push(char)).join("") + filter.finish();
  assert.equal(answer, visible);
  assert.deepEqual(filter.proposal(), proposal);
});

test("unfinished, invalid, oversized and trailing metadata never leaks or becomes a proposal", () => {
  const visible = "她把旧地图展开。";
  const invalidTails = [
    WORLD_OPEN + '{"version":1,',
    WORLD_OPEN + "{broken}" + WORLD_CLOSE,
    WORLD_OPEN + "x".repeat(16_001) + WORLD_CLOSE,
    WORLD_OPEN + '{"version":1,"changes":[]}' + WORLD_CLOSE + "unexpected after metadata",
  ];
  for (let size = 1; size < WORLD_OPEN.length; size++) invalidTails.push(WORLD_OPEN.slice(0, size));
  for (const tail of invalidTails) {
    const filter = createDzmmWorldTailFilter();
    const output = filter.push(visible) + filter.push(tail) + filter.finish();
    assert.equal(output, visible);
    assert.equal(filter.proposal(), undefined);
  }
  const filter = createDzmmWorldTailFilter();
  assert.equal(filter.push(visible + WORLD_OPEN + '{"version":1,"changes":[]}' + WORLD_CLOSE), visible);
  assert.equal(filter.push("unexpected in another chunk"), "");
  filter.finish();
  assert.equal(filter.proposal(), undefined);
});

test("ordinary legacy prose and non-marker less-than text survive the tail filter", () => {
  const source = "她说：🌧️还没停，3 < 5；先看 <地图>。";
  for (let split = 0; split <= source.length; split++) {
    const filter = createDzmmWorldTailFilter();
    assert.equal(filter.push(source.slice(0, split)) + filter.push(source.slice(split)) + filter.finish(), source);
    assert.equal(filter.proposal(), undefined);
  }
});

test("client decodes every UTF-8 byte boundary and publishes only prose callbacks", async () => {
  const answer = "雨停了🌦️，她递来地图。";
  const state = { ...createDzmmWorldState(), location: "书店" };
  const world = { type: "world", state, recordedAt: 123_456, updated: true };
  const wire = encoder.encode([
    { type: "text", text: answer }, world, { type: "done" },
  ].map(encodeDzmmWorldEvent).join(""));
  for (let split = 0; split <= wire.byteLength; split++) {
    const visible: string[] = [];
    const result = await readDzmmWorldResponse(responseFromBytes([wire.slice(0, split), wire.slice(split)]), text => visible.push(text));
    assert.deepEqual(result, { answer, world: { state, recordedAt: 123_456, updated: true } });
    assert.deepEqual(visible, [answer], `split at UTF-8 byte ${split}`);
  }
});

test("legacy text streams remain compatible across Unicode byte fragments", async () => {
  const answer = "老会话继续🌙，没有状态尾部。";
  const wire = encoder.encode(answer);
  const result = await readDzmmWorldResponse(responseFromBytes(Array.from(wire, byte => Uint8Array.of(byte)), false), () => {});
  assert.deepEqual(result, { answer });
});

test("an uncompleted or errored transport never returns its pending world snapshot", async () => {
  const state = { ...createDzmmWorldState(), location: "不应提交的地点" };
  const prefix = [{ type: "text", text: "她展开地图。" }, { type: "world", state, recordedAt: 123_456, updated: true }];
  for (const ending of [[], [{ type: "error", message: "回复中断" }]]) {
    let committed = false;
    const visible: string[] = [];
    await assert.rejects(readDzmmWorldResponse(framedResponse([...prefix, ...ending]), text => visible.push(text))
      .then(result => { committed = Boolean(result.world); }));
    assert.equal(committed, false);
    assert.deepEqual(visible, ["她展开地图。"]);
  }
  let index = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index++ === 0) controller.enqueue(encoder.encode(prefix.map(encodeDzmmWorldEvent).join("")));
      else controller.error(new Error("network stopped"));
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
  await assert.rejects(readDzmmWorldResponse(response, () => {}), /network stopped/);
});

test("client rejects invalid state, duplicate/out-of-order events and malformed framing", async () => {
  const text = { type: "text", text: "她继续查看地图。" };
  const world = { type: "world", state: createDzmmWorldState(), recordedAt: 123_456, updated: false };
  for (const events of [
    [text, { ...world, state: { ...world.state, unknown: true } }, { type: "done" }],
    [text, { ...world, recordedAt: -1 }, { type: "done" }],
    [text, { ...world, recordedAt: 8_640_000_000_000_001 }, { type: "done" }],
    [text, { ...world, updated: "yes" }, { type: "done" }],
    [text, world, world, { type: "done" }],
    [text, world, text, { type: "done" }],
    [text, { type: "done" }, text],
    [text, { type: "unknown" }, { type: "done" }],
    [{ type: "done" }],
  ]) await assert.rejects(readDzmmWorldResponse(framedResponse(events), () => {}));
  for (const wire of ["data: {broken}\n\n", "event: message\ndata: {}\n\n",
    encodeDzmmWorldEvent(text) + encodeDzmmWorldEvent({ type: "done" }) + "dangling"]) {
    await assert.rejects(readDzmmWorldResponse(responseFromBytes([encoder.encode(wire)]), () => {}));
  }
});

test("client rejects oversized completed frames, unfinished frames and accumulated prose", async () => {
  const wires = [
    encodeDzmmWorldEvent({ type: "text", text: "字".repeat(24_001) }),
    "data: " + "x".repeat(24_001),
    encodeDzmmWorldEvent({ type: "text", text: "字".repeat(8_000) })
      + encodeDzmmWorldEvent({ type: "text", text: "字".repeat(4_001) }) + encodeDzmmWorldEvent({ type: "done" }),
  ];
  for (const wire of wires) await assert.rejects(readDzmmWorldResponse(responseFromBytes([encoder.encode(wire)]), () => {}), /过长|长度限制/);
  await assert.rejects(readDzmmWorldResponse(responseFromBytes([encoder.encode("字".repeat(12_001))], false), () => {}), /过长|长度限制/);
});

test("copied messages rebind snapshots to new IDs; edits discard only unsupported branch state", () => {
  const original: DzmmStoryMessage[] = [
    { id: "a1", role: "assistant", content: "她打开书店大门。" },
    { id: "u1", role: "user", content: "我想看看旧地图。" },
    { id: "a2", role: "assistant", content: "她找到地图，铺在桌上。" },
  ];
  const initial = { ...createDzmmWorldState(), location: "书店门口" };
  const current = { ...createDzmmWorldState(), location: "书店桌前", facts: ["旧地图已找到"] };
  const first = appendDzmmWorldSnapshot(undefined, original.slice(0, 1), initial, 1_000, "story");
  const journal = appendDzmmWorldSnapshot(first, original, current, 2_000, "story");
  const copy = original.map((message, index) => ({ ...message, id: `copied-${index}` }));
  const rebound = rebindDzmmWorldJournal(journal, original, copy);
  assert.ok(rebound);
  assert.deepEqual(latestDzmmWorldSnapshot(rebound, copy)?.state, current);
  assert.equal(latestDzmmWorldSnapshot(journal, copy), undefined, "Old IDs cannot silently validate in the new chat.");
  assert.notEqual(rebound.snapshots[1].sourceFingerprint, journal.snapshots[1].sourceFingerprint);
  assert.equal(rebound.snapshots[1].recordedAt, 2_000);
  const edited = original.map((message, index) => index === 2 ? { ...message, content: "她还没有找到地图。" } : message);
  const editedCopy = edited.map((message, index) => ({ ...message, id: `edited-${index}` }));
  const retained = rebindDzmmWorldJournal(journal, edited, editedCopy);
  assert.equal(retained?.snapshots.length, 1);
  assert.deepEqual(latestDzmmWorldSnapshot(retained, editedCopy)?.state, initial);
  assert.equal(rebindDzmmWorldJournal(journal, original, editedCopy), undefined);
  assert.equal(rebindDzmmWorldJournal(journal, original, copy.slice(1)), undefined);
  const changedOpening = original.map((message, index) => index === 0 ? { ...message, content: "她身在车站。" } : message);
  assert.equal(rebindDzmmWorldJournal(journal, changedOpening, changedOpening.map(message => ({ ...message, id: `new-${message.id}` }))), undefined);
});
