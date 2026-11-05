import assert from "node:assert/strict";
import test from "node:test";
import threadItems from "./companion-thread-items.ts";

const { applyCompanionSession, buildCompanionThreadRows, mergeCompanionMessages, openingPreface, pickCompanionSession } = threadItems as typeof import("./companion-thread-items.ts");

const first = "2026-11-04T04:00:00+08:00";
const soon = "2026-11-04T04:01:00+08:00";
const later = "2026-11-04T04:20:00+08:00";

test("an empty girlfriend chat has no scripted bubbles", () => {
  assert.deepEqual(buildCompanionThreadRows([], { typing: false, stalled: false }), [
    { kind: "empty", id: "empty" },
  ]);
});

test("messages keep order, share a clock inside ten minutes, and drop blank turns", () => {
  const rows = buildCompanionThreadRows([
    { id: "a", createdAt: first, kind: "message" },
    { id: "b", createdAt: soon, kind: "photo" },
    { id: "c", createdAt: later, kind: "message" },
  ], { typing: true, stalled: true });
  assert.deepEqual(rows.map(row => row.kind), ["time", "message", "photo", "time", "message", "typing", "stalled"]);
  assert.equal(rows.filter(row => row.kind === "time").length, 2);
});

test("an empty saved chat does not hide the session that still has history", () => {
  const older = { id: "older", messages: [{ id: "m1" }, { id: "m2" }] };
  const blank = { id: "blank", messages: [] as { id: string }[] };
  assert.equal(pickCompanionSession([blank, older], "blank")?.id, "older");
  assert.equal(pickCompanionSession([blank, older], "older")?.id, "older");
  assert.equal(pickCompanionSession([{ id: "short", messages: [{ id: "hi" }] }, older], "short")?.id, "older");
  assert.equal(pickCompanionSession([blank], null)?.id, "blank");
});

test("one character keeps the session that holds the memory", () => {
  const memory = { id: "memory", messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] };
  const stray = { id: "stray", messages: [{ id: "new" }] };
  assert.equal(pickCompanionSession([memory, stray], "stray")?.id, "memory");
  assert.equal(pickCompanionSession([stray], "stray")?.id, "stray");
});

test("a local send and its cloud copy stay one line, and a short cloud read keeps the local line", () => {
  const local = { id: "req", role: "user", text: "你咋又不理我", createdAt: later, requestId: "req" };
  const cloud = { id: "native", role: "user", text: "你咋又不理我", createdAt: later, requestId: "req" };
  const replaced = mergeCompanionMessages([local], [cloud]);
  assert.deepEqual(replaced.map(item => item.id), ["native"]);
  const kept = applyCompanionSession(
    { id: "chat", status: "idle", messages: [local] },
    { id: "chat", status: "idle", messages: [] },
  );
  assert.deepEqual(kept.messages?.map(item => item.id), ["req"]);
});

test("an empty chat shows her default lines, and an older transcript does not", () => {
  const lines = ["还留吗？这杯我给你续上。", "场子还没散，你要走我送到门口。"];
  const visible = (message: { text?: string }) => Boolean(message.text?.trim());
  const now = Date.parse("2026-11-04T22:50:00+08:00");
  assert.deepEqual(openingPreface(lines, null, null, false, null, now, visible).lines, []);
  const waiting = openingPreface(lines, null, null, true, null, now, visible);
  assert.deepEqual(waiting.lines, lines);
  const empty = openingPreface(lines, "chat", { id: "chat", messages: [] }, true, null, now, visible);
  assert.deepEqual(empty.lines, lines);
  assert.equal(empty.latch?.show, true);
  const sent = openingPreface(
    lines,
    "chat",
    { id: "chat", messages: [{ text: "再留一会儿", createdAt: new Date(now + 60_000).toISOString() }] },
    true,
    empty.latch,
    now + 60_000,
    visible,
  );
  assert.deepEqual(sent.lines, lines);
  const older = openingPreface(
    lines,
    "chat",
    { id: "chat", messages: [{ text: "不聊这个，停", createdAt: "2026-11-04T18:16:00+08:00" }] },
    true,
    null,
    now,
    visible,
  );
  assert.deepEqual(older.lines, []);
  const arrived = openingPreface(
    lines,
    "chat",
    { id: "chat", messages: [{ text: "不聊这个，停", createdAt: "2026-11-04T18:16:00+08:00" }] },
    true,
    empty.latch,
    now + 5_000,
    visible,
  );
  assert.deepEqual(arrived.lines, []);
});

test("a new cloud session keeps the cached lines and lets the cloud copy replace the same line", () => {
  const cached = { id: "old", status: "idle", messages: [{ id: "a", role: "assistant", text: "今晚先坐近一点", createdAt: later }] };
  const blank = applyCompanionSession(cached, { id: "new", status: "idle", messages: [] });
  assert.equal(blank.id, "new");
  assert.deepEqual(blank.messages?.map(item => item.text), ["今晚先坐近一点"]);
  const covered = applyCompanionSession(cached, { id: "new", status: "idle", messages: [{ id: "a", role: "assistant", text: "今晚先坐近一点。", createdAt: later }] });
  assert.equal(covered.messages?.[0]?.text, "今晚先坐近一点。");
});

test("reopening the chat collapses a copied line and keeps the voice that arrived with it", () => {
  const at = later;
  const local = { id: "a", role: "assistant" as const, text: "坏老公，人家哪有没理你呀", createdAt: at };
  const copy = { id: "b", role: "assistant" as const, text: "坏老公，人家哪有没理你呀", createdAt: at };
  assert.deepEqual(mergeCompanionMessages([local, copy], []).map(item => item.id), ["a"]);
  const again = { id: "c", role: "assistant" as const, text: "坏老公，人家哪有没理你呀", createdAt: new Date(Date.parse(at) + 10 * 60_000).toISOString() };
  assert.deepEqual(mergeCompanionMessages([local], [again]).map(item => item.id), ["a", "c"]);
  const voice = { id: "v", role: "assistant" as const, text: "[语音]", createdAt: at, media: [{ kind: "audio", url: "https://cdn.example/voice.mp3", mimeType: "audio/mpeg" }] };
  const placeholder = { id: "p", role: "assistant" as const, text: "[语音]", createdAt: at };
  const folded = mergeCompanionMessages([placeholder], [voice]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0]?.media?.[0]?.url, "https://cdn.example/voice.mp3");
  const kept = applyCompanionSession(
    { id: "chat", status: "idle", messages: [voice] },
    { id: "chat", status: "idle", messages: [{ id: "v", role: "assistant", text: "", createdAt: at }] },
  );
  assert.equal(kept.messages?.[0]?.media?.[0]?.url, "https://cdn.example/voice.mp3");
  const first = { id: "r1", role: "user" as const, text: "嗯", createdAt: at, requestId: "r1" };
  const second = { id: "r2", role: "user" as const, text: "嗯", createdAt: new Date(Date.parse(at) + 2_000).toISOString(), requestId: "r2" };
  assert.deepEqual(mergeCompanionMessages([first], [second]).map(item => item.id), ["r1", "r2"]);
});

test("a shorter refresh keeps messages already on screen and skips an identical read", () => {
  const previous = { id: "chat", status: "idle", messages: [{ id: "a", role: "user", text: "嗯" }, { id: "b", role: "assistant", text: "在" }] };
  const identical = applyCompanionSession(previous, { ...previous, messages: [...previous.messages] });
  assert.equal(identical, previous);
  const shortened = applyCompanionSession(previous, { id: "chat", status: "idle", messages: [{ id: "b", role: "assistant", text: "在" }] });
  assert.deepEqual(shortened.messages?.map(item => item.id), ["a", "b"]);
});
