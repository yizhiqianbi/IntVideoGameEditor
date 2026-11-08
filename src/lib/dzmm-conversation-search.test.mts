import test from "node:test";
import assert from "node:assert/strict";
import searchModule from "./dzmm-conversation-search";
import type { Character } from "./dzmm-characters";
import type { DzmmSavedConversation } from "./dzmm-storage";

const { filterDzmmConversations, filterDzmmSearchRows } = searchModule as typeof import("./dzmm-conversation-search");
function character(id: string, name: string): Character {
  return { id, name, author: "原创测试", heat: "0", likes: "0", cover: "", tags: [],
    description: "PERSONA_ONLY", personality: "PERSONALITY_ONLY", scenario: "FUTURE_SCENE_ONLY", firstMessage: "UNUSED_OPENING_ONLY",
    creatorNotes: "CREATOR_NOTES_ONLY", sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-08T00:00:00.000Z" };
}
function conversation(id: string, characterId: string, title: string, content: string[]): DzmmSavedConversation {
  return { id, characterId, title, updatedAt: 1, messages: content.map((text, index) => ({ id: `${id}-${index}`,
    role: index % 2 ? "assistant" : "user", content: text })) };
}
const characters = [character("keeper", "龙漓 地图保管员"), character("repairer", "林音 Clock Keeper")];
const conversations = [
  conversation("harbour", "keeper", "海港的夜班", ["请核对北门地图。", "南门仍然关着，我们可以先问问值班员。"]),
  conversation("clock", "repairer", "Clock Workshop", ["I can check the window", "ＡＢＣ１２３ café", "靠窗\n\t  等候"]),
  conversation("missing", "deleted-character", "雨天散步", ["先找把伞，然后去旧桥。"]),
];

test("Chinese titles, associated character names and ordinary saved messages are searchable", () => {
  assert.deepEqual(filterDzmmConversations(conversations, characters, "海港"), [conversations[0]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "龙漓"), [conversations[0]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "林音"), [conversations[1]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "值班员"), [conversations[0]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "旧桥"), [conversations[2]]);
});

test("NFKC, lowercase and collapsed whitespace apply to both queries and visible fields", () => {
  assert.deepEqual(filterDzmmConversations(conversations, characters, "ｃｌｏｃｋ"), [conversations[1]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "abc123"), [conversations[1]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "CAFÉ"), [conversations[1]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "  靠窗\t\n等候  "), [conversations[1]]);
});

test("empty and Unicode whitespace-only queries return the exact input array", () => {
  for (const query of ["", " ", "\t\n", "\u3000\u00a0"]) {
    assert.equal(filterDzmmConversations(conversations, characters, query), conversations);
  }
  const empty: DzmmSavedConversation[] = [];
  assert.equal(filterDzmmConversations(empty, characters, "\t"), empty);
});

test("all words must match but may come from separate titles, names and messages", () => {
  assert.deepEqual(filterDzmmConversations(conversations, characters, "海港 龙漓 北门 值班员"), [conversations[0]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "clock WINDOW café 林音"), [conversations[1]]);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "龙漓 WINDOW"), []);
  assert.deepEqual(filterDzmmConversations(conversations, characters, "不存在"), []);
});

test("a term cannot be assembled across messages or field boundaries", () => {
  const split = [conversation("split", "split-role", "星", ["南", "海", "地图保", "管员"])];
  const splitCharacters = [character("split-role", "空")];
  for (const query of ["南海", "地图保管员", "星空"]) {
    assert.deepEqual(filterDzmmConversations(split, splitCharacters, query), []);
  }
  assert.deepEqual(filterDzmmConversations(split, splitCharacters, "南 海"), split);
});

test("unplayed character material, notes, memories, future world state and other accounts stay outside the search", () => {
  const own = [conversation("own", "keeper", "自有测试", ["已在海港。"] )];
  own[0].storyMemory = { version: 1, sourceCount: 1, sourceFingerprint: "dzmm-v1-" + "0".repeat(32),
    state: { summary: "SUMMARY_ONLY", scene: "MEMORY_SCENE_ONLY", completed: [], pending: [], relationships: [], items: [] } };
  own[0].worldState = { version: 1, snapshots: [{ sourceCount: 1, sourceFingerprint: "dzmm-v1-" + "0".repeat(32),
    recordedAt: 1, clockMode: "story", state: { location: "FUTURE_WORLD_ONLY",
      clock: { elapsedMinutes: 0, day: 1, minuteOfDay: null, calendarLabel: "", remainderMs: 0 }, relationships: [], threads: [], facts: [] } }] };
  const otherAccount = [conversation("other", "repairer", "OTHER_ACCOUNT_ONLY", ["不在调用方的账户列表中。"] )];
  for (const query of ["PERSONA_ONLY", "PERSONALITY_ONLY", "FUTURE_SCENE_ONLY", "UNUSED_OPENING_ONLY",
    "CREATOR_NOTES_ONLY", "SUMMARY_ONLY", "MEMORY_SCENE_ONLY", "FUTURE_WORLD_ONLY", "OTHER_ACCOUNT_ONLY", "林音"]) {
    assert.deepEqual(filterDzmmConversations(own, characters, query), []);
  }
  assert.equal(otherAccount.length, 1);
});

test("filtering preserves original ordering, item references and all inputs without mutation", () => {
  const list = [conversations[1], conversations[0], conversation("second", "keeper", "海港新线索", ["地图已确认。"])];
  const beforeList = structuredClone(list), beforeCharacters = structuredClone(characters);
  Object.freeze(list);
  const result = filterDzmmConversations(list, characters, "地图");
  assert.deepEqual(result.map(value => value.id), ["harbour", "second"]);
  assert.equal(result[0], list[1]); assert.equal(result[1], list[2]); assert.notEqual(result, list);
  assert.deepEqual(list, beforeList); assert.deepEqual(characters, beforeCharacters);
});

const games = [
  { id: "original-route", title: "ＡＢＣ航线 · 雾港地图", note: "私人游戏 · 最近打开", source: "<p>HTML_SOURCE_ONLY</p>" },
  { id: "original-clock", title: "时钟\n\t  工房", note: "私人游戏 · 最近打开", source: "<p>OTHER_HTML_SOURCE_ONLY</p>" },
];
const gameFields = (game: typeof games[number]) => [game.title, game.note];

test("visible game fields support the same fullwidth, case and whitespace normalization as conversations", () => {
  for (const query of ["ABC", "ａｂｃ", "  abc\t\n雾港  "])
    assert.deepEqual(filterDzmmSearchRows(games, query, gameFields), [games[0]]);
  assert.deepEqual(filterDzmmSearchRows(games, "时钟\t工房", gameFields), [games[1]]);
});

test("game keywords may match separate visible fields but never HTML source or different rows", () => {
  assert.deepEqual(filterDzmmSearchRows(games, "雾港 最近", gameFields), [games[0]]);
  assert.deepEqual(filterDzmmSearchRows(games, "航线 地图", gameFields), [games[0]]);
  for (const query of ["HTML_SOURCE_ONLY", "OTHER_HTML_SOURCE_ONLY", "航线 工房"])
    assert.deepEqual(filterDzmmSearchRows(games, query, gameFields), []);
});

test("generic row filtering preserves field boundaries, input order and references without mutation", () => {
  const split = { id: "split", title: "南", note: "海", source: "<p>南海</p>" };
  const rows = Object.freeze([games[1], split, games[0]]), before = structuredClone(rows);
  assert.deepEqual(filterDzmmSearchRows(rows, "南海", gameFields), []);
  assert.deepEqual(filterDzmmSearchRows(rows, "南 海", gameFields), [split]);
  const matches = filterDzmmSearchRows(rows, "私人 最近", gameFields);
  assert.deepEqual(matches, [games[1], games[0]]);
  assert.equal(matches[0], rows[0]); assert.equal(matches[1], rows[2]);
  for (const query of ["", "\t\n", "\u3000\u00a0"])
    assert.equal(filterDzmmSearchRows(rows, query, () => { throw new Error("Empty search must not inspect row fields."); }), rows);
  assert.deepEqual(rows, before);
});
