import test from "node:test";
import assert from "node:assert/strict";
import backupModule from "./dzmm-conversation-backup";
import characterModule from "./dzmm-characters";
import contextModule from "./dzmm-conversation-context";
import memoryModule from "./dzmm-story-memory";
import worldModule from "./dzmm-world-state";

const { parseDzmmConversationBackup, DZMM_CONVERSATION_BACKUP_MAX_BYTES } = backupModule as typeof import("./dzmm-conversation-backup");
const { parseCharacterImport } = characterModule as typeof import("./dzmm-characters");
const { captureDzmmConversationOpening } = contextModule as typeof import("./dzmm-conversation-context");
const { createDzmmStoryMemory, matchesDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");
const { appendDzmmWorldSnapshot, createDzmmWorldState, pruneDzmmWorldJournal } = worldModule as typeof import("./dzmm-world-state");

function fixture(count = 201) {
  const character = parseCharacterImport({ name: "原创测试·温室管理员", description: "沈芷，34岁。核对植物观察卡。",
    firstMessage: "温室里见。", alternateGreetings: ["三日后的露台，先核对植物观察时间。"] }, "local-original-backup");
  const opening = captureDzmmConversationOpening(character, 1);
  const messages = [...opening.messages.map((message, index) => ({ ...message, id: `opening-${index}` })),
    ...Array.from({ length: count - 1 }, (_, index) => ({ id: `history-${index}`, role: index % 2 ? "assistant" as const : "user" as const,
      content: `核对第 ${index + 1} 盆植物的记录。\n保留空行和标点。` }))];
  const storyMemory = createDzmmStoryMemory({ summary: "已核对观察卡。", scene: "露台", completed: ["核对观察卡"],
    pending: [], relationships: [], items: [] }, messages.slice(0, 30));
  const state = createDzmmWorldState();
  state.clock.elapsedMinutes = 60; state.location = "露台";
  const worldState = appendDzmmWorldSnapshot(undefined, messages, state, 1700000000000, "realtime");
  return { version: 1, character, opening, messages, storyMemory, worldState, worldClockMode: "realtime" };
}

for (const count of [200, 201, 601]) test(`restores ${count} messages without truncation and rebinds all continuity metadata`, () => {
  const original = fixture(count), raw = JSON.stringify(original);
  let id = 0;
  const { character, conversation } = parseDzmmConversationBackup(raw, { createId: () => `copy-${++id}`, now: 1234 });
  assert.equal(conversation.updatedAt, 1234);
  assert.equal(conversation.messages.length, count);
  assert.deepEqual(conversation.messages.map(({ role, content }) => ({ role, content })), original.messages.map(({ role, content }) => ({ role, content })));
  assert.ok(conversation.messages.every((message, index) => message.id !== original.messages[index].id));
  assert.equal(new Set(conversation.messages.map(message => message.id)).size, count);
  assert.notEqual(character.id, original.character.id);
  assert.equal(conversation.characterId, character.id);
  assert.deepEqual(conversation.opening, original.opening);
  assert.equal(conversation.worldClockMode, "realtime");
  assert.equal(matchesDzmmStoryMemory(conversation.storyMemory, conversation.messages), true);
  const world = pruneDzmmWorldJournal(conversation.worldState, conversation.messages)!;
  assert.equal(world.snapshots.length, 1);
  assert.equal(world.snapshots[0].recordedAt, original.worldState.snapshots[0].recordedAt);
  assert.deepEqual(world.snapshots[0].state, original.worldState.snapshots[0].state);
  assert.equal(JSON.stringify(original), raw, "Import must leave the supplied original intact");
});

test("damaged optional metadata preserves full valid history; wrong messages still fail", () => {
  const value = fixture();
  const damaged = { ...value, opening: { version: 99 }, storyMemory: { version: 99 }, worldState: { version: 99 } };
  const result = parseDzmmConversationBackup(JSON.stringify(damaged));
  assert.equal(result.conversation.messages.length, 201);
  assert.equal(result.conversation.storyMemory, undefined);
  assert.equal(result.conversation.worldState, undefined);
  assert.deepEqual(result.conversation.opening.messages, value.opening.messages);
  for (const content of ["", " ", "a\0b", "字".repeat(12001)]) {
    assert.throws(() => parseDzmmConversationBackup(JSON.stringify({ ...value, messages: [{ role: "user", content }] })), /非空文本/);
  }
  assert.throws(() => parseDzmmConversationBackup(JSON.stringify({ ...value, messages: [{ role: "system", content: "invalid" }] })), /会话格式无效/);
});

test("file limit counts UTF-8 bytes and rejects oversize before allocating message IDs", () => {
  const raw = JSON.stringify(fixture());
  const exact = raw + " ".repeat(DZMM_CONVERSATION_BACKUP_MAX_BYTES - new TextEncoder().encode(raw).byteLength);
  assert.equal(parseDzmmConversationBackup(exact).conversation.messages.length, 201);
  let ids = 0;
  assert.throws(() => parseDzmmConversationBackup(exact + " ", { createId: () => `${++ids}` }), /不能超过 2 MB/);
  assert.equal(ids, 0);
  assert.throws(() => parseDzmmConversationBackup(raw + " ".repeat(700000) + "字".repeat(500000)), /不能超过 2 MB/);
});
