import test from "node:test";
import assert from "node:assert/strict";
import backupModule from "./dzmm-unavailable-conversation-backup";
import normalBackupModule from "./dzmm-conversation-backup";
import memoryModule from "./dzmm-story-memory";
import worldModule from "./dzmm-world-state";
import storageModule from "./dzmm-storage";
import type { DzmmSavedConversation } from "./dzmm-storage";

const { createDzmmUnavailableConversationBackup, parseDzmmUnavailableConversationBackup } = backupModule as typeof import("./dzmm-unavailable-conversation-backup");
const { DZMM_CONVERSATION_BACKUP_MAX_BYTES, parseDzmmConversationBackup } = normalBackupModule as typeof import("./dzmm-conversation-backup");
const { createDzmmStoryMemory, matchesDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");
const { appendDzmmWorldSnapshot, createDzmmWorldState, pruneDzmmWorldJournal } = worldModule as typeof import("./dzmm-world-state");
const { hydrateDzmmState, DZMM_INITIAL_STATE } = storageModule as typeof import("./dzmm-storage");
const characterId = "published-27272727-2727-4272-8272-272727272727";

function fixture(count = 601): DzmmSavedConversation {
  const messages: DzmmSavedConversation["messages"] = [
    { id: "opening-0", role: "assistant", content: "温室的露台，先核对植物观察时间。\n\n保留原来的空行。" },
    ...Array.from({ length: count - 1 }, (_, index) => ({ id: `history-${index}`,
      role: index % 2 ? "assistant" as const : "user" as const, content: `核对第 ${index + 1} 盆植物。\n原始标点和行文保持。` })),
  ];
  const storyMemory = createDzmmStoryMemory({ summary: "已核对观察卡。", scene: "露台", completed: ["核对观察卡"],
    pending: ["检查新的时间标记"], relationships: [], items: [] }, messages.slice(0, Math.min(30, messages.length)));
  const state = createDzmmWorldState(); state.location = "温室露台"; state.clock.elapsedMinutes = 60;
  const worldState = appendDzmmWorldSnapshot(undefined, messages, state, 1700000000000, "realtime");
  worldState.modeChanges = [{ recordedAt: 1700000000001, clockMode: "story" }, { recordedAt: 1700000000002, clockMode: "realtime" }];
  return { id: "original-own-conversation", characterId, title: "  缺卡的植物观察记录🌱  ", messages, updatedAt: 1700000000000,
    opening: { version: 1, kind: "opening", source: "template", messages: [{ role: "assistant", content: messages[0].content }] },
    storyMemory, worldState, worldClockMode: "realtime" };
}
const contents = (conversation: DzmmSavedConversation) => conversation.messages.map(({ role, content }) => ({ role, content }));

test("raw export clones every original field and leaves the supplied conversation untouched", () => {
  const source = fixture(), before = structuredClone(source), archived = createDzmmUnavailableConversationBackup(source);
  assert.deepEqual(archived, { spec: "xumeng_conversation_archive_v1", character: null, conversation: source });
  assert.notEqual(archived.conversation, source); assert.notEqual(archived.conversation.messages, source.messages);
  assert.notEqual(archived.conversation.messages[0], source.messages[0]);
  assert.notEqual(archived.conversation.worldState, source.worldState); assert.notEqual(archived.conversation.opening, source.opening);
  archived.conversation.messages[0].content = "只改克隆件";
  archived.conversation.worldState!.snapshots[0].state.location = "只改克隆件的位置";
  assert.deepEqual(source, before);
});

test("601 original messages restore completely under new IDs while the public reference and title stay literal", () => {
  const source = fixture(), archive = createDzmmUnavailableConversationBackup(source), raw = JSON.stringify(archive);
  let allocated = 0;
  const restored = parseDzmmUnavailableConversationBackup(raw, { createId: () => `import-${++allocated}`, now: 1234 })!;
  assert.equal(restored.characterId, characterId); assert.equal(restored.title, source.title);
  assert.equal(restored.updatedAt, 1234); assert.equal(restored.id, "import-1"); assert.equal(restored.messages.length, 601);
  assert.deepEqual(contents(restored), contents(source)); assert.equal(allocated, 602);
  assert.ok(restored.messages.every((message, index) => message.id !== source.messages[index].id));
  assert.equal(new Set([restored.id, ...restored.messages.map(message => message.id)]).size, 602);
  assert.deepEqual(restored.opening, source.opening); assert.equal(restored.worldClockMode, "realtime");
  assert.equal(matchesDzmmStoryMemory(restored.storyMemory, restored.messages), true);
  assert.notEqual(restored.storyMemory!.sourceFingerprint, source.storyMemory!.sourceFingerprint);
  const world = pruneDzmmWorldJournal(restored.worldState, restored.messages)!;
  assert.equal(world.snapshots.length, 1); assert.deepEqual(world.snapshots[0].state, source.worldState!.snapshots[0].state);
  assert.equal(world.snapshots[0].recordedAt, source.worldState!.snapshots[0].recordedAt);
  assert.deepEqual(world.modeChanges, source.worldState!.modeChanges);
  assert.notEqual(world.snapshots[0].sourceFingerprint, source.worldState!.snapshots[0].sourceFingerprint);
  assert.equal(JSON.stringify(archive), raw);
  const hydrated = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, conversations: [restored] }));
  assert.deepEqual(hydrated.warnings, []); assert.deepEqual(hydrated.state.conversations, [restored]);
  assert.deepEqual(hydrated.state.custom, [], "Import never creates a playable placeholder card");
});

test("an ordinary character-backed backup returns null and stays available to the normal importer", () => {
  const normal = JSON.stringify({ version: 1, character: { name: "原创温室管理员", firstMessage: "温室里见。" },
    messages: [{ id: "own-message", role: "assistant", content: "温室里见。" }] });
  assert.equal(parseDzmmUnavailableConversationBackup(normal), null);
  assert.equal(parseDzmmConversationBackup(normal).conversation.messages.length, 1);
  for (const value of [null, [], {}, { spec: "another_archive_v1" }]) assert.equal(parseDzmmUnavailableConversationBackup(JSON.stringify(value)), null);
});

test("missing private references, fabricated cards and malformed mandatory fields reject before allocating IDs", () => {
  const archive = createDzmmUnavailableConversationBackup(fixture(2));
  const cases = [
    { ...archive, character: { name: "假的占位卡" } }, { ...archive, character: undefined }, { ...archive, replacementCharacter: { name: "假的占位卡" } },
    { ...archive, conversation: { ...archive.conversation, characterId: "missing-private-card" } },
    { ...archive, conversation: { ...archive.conversation, characterId: "published-forged" } },
    { ...archive, conversation: { ...archive.conversation, title: " " } },
    { ...archive, conversation: { ...archive.conversation, title: "字".repeat(12001) } },
    { ...archive, conversation: { ...archive.conversation, id: "id\0bad" } },
    { ...archive, conversation: { ...archive.conversation, id: "i".repeat(121) } },
    { ...archive, conversation: { ...archive.conversation, updatedAt: -1 } },
    ...[{ id: "", role: "user", content: "有效正文" }, { id: "i".repeat(121), role: "user", content: "有效正文" },
      { id: "valid", role: "system", content: "不是会话角色" }, { id: "valid", role: "user", content: " " },
      { id: "valid", role: "user", content: "bad\0text" }, { id: "valid", role: "user", content: "字".repeat(12001) }]
      .map(message => ({ ...archive, conversation: { ...archive.conversation, messages: [archive.conversation.messages[0], message] } })),
  ];
  let allocated = 0;
  for (const value of cases) assert.throws(() => parseDzmmUnavailableConversationBackup(JSON.stringify(value), {
    createId: () => `unexpected-${++allocated}`,
  }));
  assert.equal(allocated, 0);
  assert.throws(() => createDzmmUnavailableConversationBackup({ ...archive.conversation, characterId: "missing-private-card" }));
});

test("an existing hydrated title at 12000 characters exports and imports without narrowing or trimming", () => {
  const source = { ...fixture(3), title: "  " + "题".repeat(11994) + "🌱  " };
  assert.equal(source.title.length, 12000);
  const original = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, conversations: [source] }));
  assert.deepEqual(original.warnings, []); assert.equal(original.state.conversations[0].title, source.title);
  const archive = createDzmmUnavailableConversationBackup(source);
  assert.equal(archive.conversation.title, source.title);
  const restored = parseDzmmUnavailableConversationBackup(JSON.stringify(archive))!;
  assert.equal(restored.title, source.title);
  assert.deepEqual(contents(restored), contents(source));
  const hydrated = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, conversations: [restored] }));
  assert.deepEqual(hydrated.warnings, []); assert.equal(hydrated.state.conversations[0].title, source.title);
});

test("damaged optional continuity metadata preserves original history and does not invent an opening", () => {
  const source = fixture(3), archive = createDzmmUnavailableConversationBackup(source);
  const damaged = { ...archive, conversation: { ...archive.conversation, opening: { version: 99 }, storyMemory: { version: 99 },
    worldState: { version: 99 }, worldClockMode: "future-mode" } };
  const restored = parseDzmmUnavailableConversationBackup(JSON.stringify(damaged))!;
  assert.deepEqual(contents(restored), contents(source));
  for (const key of ["opening", "storyMemory", "worldState", "worldClockMode"]) assert.ok(!Object.hasOwn(restored, key));
  const stale = { ...archive, conversation: { ...archive.conversation, messages: archive.conversation.messages.map((message, index) =>
    index === 1 ? { ...message, content: "修改后的原始正文" } : message) } };
  const withoutStale = parseDzmmUnavailableConversationBackup(JSON.stringify(stale))!;
  assert.equal(withoutStale.storyMemory, undefined);
  assert.equal(withoutStale.worldState!.snapshots.length, 0);
  assert.deepEqual(withoutStale.worldState!.modeChanges, source.worldState!.modeChanges);
  assert.deepEqual(withoutStale.opening, source.opening);
});

test("empty histories remain empty and duplicate allocation candidates cannot reuse any source ID", () => {
  const empty = { id: "old", characterId, title: "仅有标题的存档", messages: [], updatedAt: 1.5 };
  const restoredEmpty = parseDzmmUnavailableConversationBackup(JSON.stringify(createDzmmUnavailableConversationBackup(empty)), { now: 2.5 })!;
  assert.deepEqual(restoredEmpty.messages, []); assert.equal(restoredEmpty.opening, undefined); assert.equal(restoredEmpty.updatedAt, 2.5);
  const source = fixture(3);
  const restored = parseDzmmUnavailableConversationBackup(JSON.stringify(createDzmmUnavailableConversationBackup(source)), {
    createId: () => ` ${source.messages[0].id} `,
  })!;
  const originalIds = new Set([source.id, ...source.messages.map(message => message.id)]);
  assert.ok([restored.id, ...restored.messages.map(message => message.id)].every(id => !originalIds.has(id)));
  assert.equal(new Set([restored.id, ...restored.messages.map(message => message.id)]).size, 4);
});

test("UTF-8 import ceiling is checked first while raw export preserves files over the import limit", () => {
  const archive = createDzmmUnavailableConversationBackup(fixture(3)), raw = JSON.stringify(archive);
  const exact = raw + " ".repeat(DZMM_CONVERSATION_BACKUP_MAX_BYTES - new TextEncoder().encode(raw).byteLength);
  assert.equal(parseDzmmUnavailableConversationBackup(exact)!.messages.length, 3);
  let allocated = 0;
  const options = { createId: () => `unexpected-${++allocated}` };
  assert.throws(() => parseDzmmUnavailableConversationBackup(exact + " ", options), /不能超过 2 MB/);
  assert.throws(() => parseDzmmUnavailableConversationBackup(raw + "字".repeat(700000), options), /不能超过 2 MB/);
  assert.equal(allocated, 0);
  const larger = { ...fixture(3), retainedFutureMetadata: "字".repeat(700000) };
  const exported = createDzmmUnavailableConversationBackup(larger);
  assert.deepEqual(exported.conversation, larger);
  assert.throws(() => parseDzmmUnavailableConversationBackup(JSON.stringify(exported), options), /不能超过 2 MB/);
  assert.equal(allocated, 0);
});
