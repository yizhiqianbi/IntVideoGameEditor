import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as openingModule from "./dzmm-conversation-opening";
import * as charactersModule from "./dzmm-characters";
import * as memoryModule from "./dzmm-story-memory";
import * as presentationModule from "./dzmm-character-presentation";
import type { DzmmSavedConversation } from "./dzmm-storage";
import type { DzmmConversationOpeningCharacter } from "./dzmm-conversation-opening";

const { getDzmmConversationOpening, restoreDzmmEmptyConversations } = ("default" in openingModule ? openingModule.default : openingModule) as typeof import("./dzmm-conversation-opening");
const { DZMM_CHARACTERS } = ("default" in charactersModule ? charactersModule.default : charactersModule) as typeof import("./dzmm-characters");
const { createDzmmStoryMemory } = ("default" in memoryModule ? memoryModule.default : memoryModule) as typeof import("./dzmm-story-memory");
const { splitDzmmCharacterPresentation } = ("default" in presentationModule ? presentationModule.default : presentationModule) as typeof import("./dzmm-character-presentation");
const character = { id: "archive", name: "档案员", description: "角色保存着海港的旧地图。" };
const memoryState = { summary: "已经取得地图。", scene: "海港", completed: [], pending: [], relationships: [], items: [] };
const conversation = (id: string, characterId = character.id): DzmmSavedConversation => ({
  id, characterId, title: "已有标题", messages: [], updatedAt: 100,
});

test("authored messages, primary greeting and alternate selection preserve precedence and raw macros", () => {
  const card = {
    ...character,
    scenario: "不应替换作者开场。",
    firstMessage: " 你好，{{user}}。 ",
    openingMessages: [{ role: "user" as const, content: " 我来到港城。 " }, { role: "assistant" as const, content: " 欢迎，{{USER}}。 " }],
    alternateGreetings: [" 另一幕，{{char}}。 "],
  };
  const before = JSON.stringify(card);
  assert.deepEqual(getDzmmConversationOpening(card), { kind: "opening", messages: [
    { role: "user", content: "我来到港城。" }, { role: "assistant", content: "欢迎，{{USER}}。" },
  ] });
  assert.deepEqual(getDzmmConversationOpening({ ...card, openingMessages: [] }), {
    kind: "opening", messages: [{ role: "assistant", content: "你好，{{user}}。" }],
  });
  assert.deepEqual(getDzmmConversationOpening(card, 1), {
    kind: "opening", messages: [{ role: "assistant", content: "另一幕，{{char}}。" }],
  });
  for (const index of [-1, 0.5, 2, Number.NaN]) assert.throws(() => getDzmmConversationOpening(card, index));
  assert.throws(() => getDzmmConversationOpening(character, 1), /备选开场/);
  assert.equal(JSON.stringify(card), before);
});

test("missing authored openings use the existing scenario and then description without inventing card fields", () => {
  const card = Object.freeze({ ...character, scenario: "  雾港的书库\n保存着旧图。  ", firstMessage: " \n " });
  assert.deepEqual(getDzmmConversationOpening(card), { kind: "background", messages: [
    { role: "assistant", content: "雾港的书库\n保存着旧图。" },
  ] });
  assert.deepEqual(getDzmmConversationOpening({ ...character, scenario: "\n", description: "  现有背景。  " }), {
    kind: "background", messages: [{ role: "assistant", content: "现有背景。" }],
  });
  assert.equal(card.firstMessage, " \n ");
  assert.equal(character.description, "角色保存着海港的旧地图。");
});

test("blank private cards receive a neutral welcome while display introduction and creator notes stay excluded", () => {
  const card = { id: "blank", name: "  林音  ", introduction: "DISPLAY_ONLY", creator_notes: "AUTHOR_NOTES", scenario: " ", description: "\n" };
  const result = getDzmmConversationOpening(card);
  assert.equal(result.kind, "welcome");
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "assistant");
  assert.ok(result.messages[0].content.includes("林音"));
  assert.ok(result.messages[0].content.includes("什么场景"));
  assert.ok(!JSON.stringify(result).includes("DISPLAY_ONLY"));
  assert.ok(!JSON.stringify(result).includes("AUTHOR_NOTES"));
});

test("all opening kinds respect saved-message limits without splitting Unicode pairs", () => {
  const long = `${"a".repeat(11_999)}🌱z`;
  const cases: DzmmConversationOpeningCharacter[] = [
    { ...character, firstMessage: long }, { ...character, scenario: long }, { ...character, description: long },
    { ...character, name: long, description: "" },
  ];
  for (const card of cases) {
    const content = getDzmmConversationOpening(card).messages[0].content;
    assert.ok(content.length <= 12_000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(content));
  }
  assert.equal(getDzmmConversationOpening({ ...character, description: `${"a".repeat(11_998)}🌱` }).messages[0].content.length, 12_000);
});

test("public source cards derive story background while retaining complete authored fields and source bytes", () => {
  const imported = DZMM_CHARACTERS.filter(card => card.promptOrigin === "public-verbatim");
  assert.ok(imported.length > 0);
  for (const card of imported) {
    const before = JSON.stringify(card);
    const result = getDzmmConversationOpening(card);
    assert.equal(result.kind, "background");
    assert.ok(result.messages.length === 1 && result.messages[0].role === "assistant");
    assert.equal(result.messages[0].content, splitDzmmCharacterPresentation(card.description).body);
    assert.equal(card.firstMessage, "");
    assert.ok(JSON.stringify(card) === before);
    assert.equal(createHash("sha256").update(card.description, "utf8").digest("hex"), card.publicIntroductionSha256);
  }
});

test("repair adds unique IDs only to empty known-character records and preserves all existing histories", () => {
  const existing = { ...conversation("existing"), messages: [{ id: "same-id", role: "user" as const, content: "已说过的话。" }] };
  existing.storyMemory = createDzmmStoryMemory(memoryState, existing.messages);
  const missing = conversation("missing", "missing-character");
  const empty = conversation("empty");
  empty.storyMemory = existing.storyMemory;
  const another = conversation("another");
  const original = [existing, empty, missing, another];
  const before = JSON.stringify(original);
  const repaired = restoreDzmmEmptyConversations(original, [character], { createId: () => "same-id", now: () => 987 });
  assert.notEqual(repaired, original);
  assert.equal(repaired[0], existing);
  assert.equal(repaired[2], missing);
  assert.equal(repaired[1].title, "已有标题");
  assert.equal(repaired[1].updatedAt, 987);
  assert.equal(repaired[3].updatedAt, 987);
  assert.deepEqual(repaired[1].messages, [{ id: "same-id-1", role: "assistant", content: character.description }]);
  assert.equal(repaired[3].messages[0].id, "same-id-2");
  assert.equal(Object.hasOwn(repaired[1], "storyMemory"), false);
  assert.equal(existing.storyMemory, repaired[0].storyMemory);
  assert.equal(JSON.stringify(original), before);
});

test("repair is idempotent and does not read the clock or generate IDs when no repair is needed", () => {
  const empty = conversation("empty");
  let generated = 0;
  let clockReads = 0;
  const options = { createId: () => `id-${++generated}`, now: () => { clockReads++; return 200; } };
  const repaired = restoreDzmmEmptyConversations([empty], [character], options);
  assert.equal(generated, 1);
  assert.equal(clockReads, 1);
  assert.equal(restoreDzmmEmptyConversations(repaired, [character], options), repaired);
  assert.equal(generated, 1);
  assert.equal(clockReads, 1);
  const unavailable = [conversation("unavailable", "missing-character")];
  assert.equal(restoreDzmmEmptyConversations(unavailable, [character], options), unavailable);
});

test("repair retains an optional memory only when it matches the resulting messages", () => {
  const seed = [{ id: "restored-id", role: "assistant" as const, content: character.description }];
  const empty = { ...conversation("empty"), storyMemory: createDzmmStoryMemory(memoryState, seed) };
  const repaired = restoreDzmmEmptyConversations([empty], [character], { createId: () => "restored-id", now: () => 300 });
  assert.equal(repaired[0].storyMemory, empty.storyMemory);
});

test("multi-turn authored openings restore once without sharing arrays or message objects", () => {
  const openingMessages = [{ role: "user" as const, content: "来到港城。" }, { role: "assistant" as const, content: "欢迎。" }];
  const card = { ...character, openingMessages };
  let serial = 0;
  const repaired = restoreDzmmEmptyConversations([conversation("first"), conversation("second")], [card], {
    createId: () => `seed-${++serial}`, now: () => 400,
  });
  assert.deepEqual(repaired[0].messages.map(({ role, content }) => ({ role, content })), openingMessages);
  assert.equal(serial, 4);
  assert.notEqual(repaired[0].messages, repaired[1].messages);
  assert.notEqual(repaired[0].messages[0], repaired[1].messages[0]);
  assert.notEqual(repaired[0].messages[0], openingMessages[0]);
  assert.equal(restoreDzmmEmptyConversations(repaired, [card]), repaired);
});
