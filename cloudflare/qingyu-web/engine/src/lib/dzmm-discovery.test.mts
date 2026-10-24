import assert from "node:assert/strict";
import test from "node:test";
import type { Character } from "./dzmm-characters.ts";
import discoveryModule from "./dzmm-discovery";
import type { DzmmAuthor } from "./dzmm-discovery";

const { dzmmDiscoveryCutoff, filterDzmmCharacters, findCharacterAuthor } = discoveryModule as typeof import("./dzmm-discovery");

function role(id: string, overrides: Partial<Character> = {}): Character {
  return { id, name: id, author: "同名作者", heat: "—", likes: "—", cover: "", tags: ["一般向"], description: "公开介绍", personality: "", scenario: "", firstMessage: "", sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: "2026-10-02T16:00:00.000Z", ...overrides };
}

test("time filters use Shanghai midnight and Monday across UTC and year boundaries", () => {
  const now = Date.parse("2026-10-03T01:00:00.000Z");
  assert.equal(dzmmDiscoveryCutoff("today", now), Date.parse("2026-10-02T16:00:00.000Z"));
  assert.equal(dzmmDiscoveryCutoff("week", now), Date.parse("2026-09-27T16:00:00.000Z"));
  assert.equal(dzmmDiscoveryCutoff("month", now), Date.parse("2026-09-30T16:00:00.000Z"));
  assert.equal(dzmmDiscoveryCutoff("quarter", Date.parse("2026-01-01T02:00:00.000Z")), Date.parse("2025-10-31T16:00:00.000Z"));
  const roles = [role("today"), role("yesterday", { createdAt: "2026-10-02T15:59:59.999Z" }), role("invalid", { createdAt: "invalid" })];
  assert.deepEqual(filterDzmmCharacters(roles, { time: "today", now }).map((item) => item.id), ["today"]);
});

test("identical author names never merge distinct source accounts", () => {
  const authors: DzmmAuthor[] = [{ id: "uuid-1", name: "同名作者", sourceUrl: "", characterIds: ["100"] }, { id: "uuid-2", name: "同名作者", sourceUrl: "", characterIds: ["200"] }];
  assert.equal(findCharacterAuthor(authors, "100")?.id, "uuid-1");
  assert.equal(findCharacterAuthor(authors, "200")?.id, "uuid-2");
  assert.equal(findCharacterAuthor(authors, "private-role"), undefined);
});

test("unknown metrics remain behind known zeroes, screening does not mutate the catalog", () => {
  const roles = [role("unknown"), role("zero", { heat: "0" }), role("popular", { heat: "1.2万" }), role("blocked", { heat: "2亿", tags: ["RPG"] })];
  const snapshot = JSON.stringify(roles);
  assert.deepEqual(filterDzmmCharacters(roles, { sort: "hot", blockedTags: [" rpg "] }).map((item) => item.id), ["popular", "zero", "unknown"]);
  assert.equal(JSON.stringify(roles), snapshot);
  assert.equal(filterDzmmCharacters(roles, { category: "emmmmm" }).length, 0);
});

test("visible introduction keywords find a role in both global and category search", () => {
  const card = role("lighthouse", { name: "灯塔馆长", introduction: "潮汐信笺 TideLetter：一起整理港口地图", description: "档案管理员" });
  assert.deepEqual(filterDzmmCharacters([card], { query: " 潮汐信笺 " }).map(item => item.id), [card.id]);
  assert.deepEqual(filterDzmmCharacters([card], { query: "TIDELETTER", category: "sfw" }).map(item => item.id), [card.id]);
  assert.equal(filterDzmmCharacters([card], { query: "潮汐信笺", category: "rpg" }).length, 0);
});

test("introduction matches still respect blocked tags and leave hidden instructions out of search", () => {
  const card = role("lighthouse", { introduction: "潮汐信笺", systemPrompt: "内部指令专用词", characterBook: { entries: [{ keys: ["世界书专用词"], content: "地图线索专用词" }] } });
  const before = JSON.stringify(card);
  assert.equal(filterDzmmCharacters([card], { query: "潮汐信笺", blockedTags: [" 一般向 "] }).length, 0);
  for (const query of ["内部指令专用词", "世界书专用词", "地图线索专用词"])
    assert.equal(filterDzmmCharacters([card], { query }).length, 0);
  assert.equal(JSON.stringify(card), before);
});

test("legacy description and existing name, author and tag searches remain available", () => {
  const card = role("legacy", { name: "旧灯塔", author: "绘图员", description: "海岸档案", tags: ["一般向", "地图修复"] });
  for (const query of ["旧灯塔", "绘图员", "海岸档案", "地图修复"])
    assert.deepEqual(filterDzmmCharacters([card], { query }).map(item => item.id), [card.id]);
});
