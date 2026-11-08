import test from "node:test";
import assert from "node:assert/strict";
import * as shelfModule from "./dzmm-public-shelf";
import type { Character } from "./dzmm-characters";

const { appendDzmmCatalogPage, isDzmmListPreview, orderDzmmShelfByTime, parseDzmmCatalogQuery, readDzmmShelfFeed, toDzmmCatalogCard, writeDzmmShelfFeed, xumengPlayCatalogSort, xumengPlaySortSelection } =
  ("default" in shelfModule ? shelfModule.default : shelfModule) as typeof import("./dzmm-public-shelf");

function card(extra: Partial<Character> = {}): Character {
  return {
    id: "published-a16f0000-0000-4000-8000-000000000001",
    name: "凌霜",
    author: "原作者",
    heat: "0",
    likes: "0",
    cover: "/dzmm/brand/xumeng-character-placeholder.svg",
    tags: ["女性向", "古风"],
    description: "长简介".repeat(80),
    personality: "完整性格",
    scenario: "完整场景",
    firstMessage: "完整开场",
    sourceUrl: "",
    sourceKind: "original",
    promptOrigin: "original",
    createdAt: "2026-10-28T00:00:00.000Z",
    systemPrompt: "完整规则",
    ...extra,
  };
}

test("catalog query accepts a shelf page and rejects an oversized page", () => {
  const query = parseDzmmCatalogQuery(new URLSearchParams("limit=24&offset=48&q=凌霜&tags=女性向,古风&sort=hot&view=card"));
  assert.equal(query.limit, 24);
  assert.equal(query.offset, 48);
  assert.equal(query.q, "凌霜");
  assert.deepEqual(query.tags, ["女性向", "古风"]);
  assert.equal(query.sort, "hot");
  assert.equal(query.view, "card");
  assert.equal(query.look, null);
  assert.equal(parseDzmmCatalogQuery(new URLSearchParams("look=anime")).look, "anime");
  assert.throws(() => parseDzmmCatalogQuery(new URLSearchParams("look=other")), /画面类型无效/);
  assert.throws(() => parseDzmmCatalogQuery(new URLSearchParams("limit=100")), /分页参数无效/);
});

test("shelf cards keep the cover fields and drop the playable prompt", () => {
  const preview = toDzmmCatalogCard(card());
  assert.equal(isDzmmListPreview(preview), true);
  assert.equal(preview.name, "凌霜");
  assert.equal(preview.tags.join(","), "女性向,古风");
  assert.equal(preview.personality, "");
  assert.equal(preview.firstMessage, "");
  assert.equal(preview.systemPrompt, undefined);
  assert.ok(preview.description.length <= 180);
  const page = appendDzmmCatalogPage([preview], [preview, card({ id: "published-a16f0000-0000-4000-8000-000000000002", name: "下一张" })]);
  assert.deepEqual(page.map((item) => item.name), ["凌霜", "下一张"]);
});

test("the play page latest tab asks for publish time and keeps that order", () => {
  assert.equal(xumengPlayCatalogSort("最新", "recommended"), "new");
  assert.equal(xumengPlaySortSelection("最新", "recommended"), "updated");
  assert.equal(xumengPlayCatalogSort("最新", "heat"), "hot");
  assert.equal(xumengPlayCatalogSort("新手", "recommended"), "hot");
  assert.deepEqual(orderDzmmShelfByTime([
    card({ id: "older", name: "旧卡", createdAt: "2026-09-21T14:13:20.000Z" }),
    card({ id: "newer", name: "新卡", createdAt: "2026-10-27T14:24:30.048Z" }),
  ]).map((item) => item.name), ["新卡", "旧卡"]);
});

test("a feed keeps the next page for a few minutes and forgets feeds past the limit", () => {
  const store = new Map();
  const page = (name: string) => ({ characters: [card({ id: name, name })], total: 3, nextOffset: 1, hasMore: true, serverFiltered: true });
  writeDzmmShelfFeed(store, "latest", { shown: { ...page("第一页"), storedAt: 0 }, ahead: { ...page("第二页"), offset: 1, storedAt: 0 } }, 1_000, { feeds: 2, pages: 1, pageSize: 1 });
  assert.deepEqual(readDzmmShelfFeed(store, "latest", 1_000)?.ahead?.characters.map((item) => item.name), ["第二页"]);
  assert.equal(readDzmmShelfFeed(store, "latest", 1_000 + 5 * 60 * 1000 + 1), null);
  writeDzmmShelfFeed(store, "one", { shown: { ...page("1"), storedAt: 0 }, ahead: null }, 2_000, { feeds: 2, pages: 1, pageSize: 1 });
  writeDzmmShelfFeed(store, "two", { shown: { ...page("2"), storedAt: 0 }, ahead: null }, 3_000, { feeds: 2, pages: 1, pageSize: 1 });
  writeDzmmShelfFeed(store, "three", { shown: { ...page("3"), storedAt: 0 }, ahead: null }, 4_000, { feeds: 2, pages: 1, pageSize: 1 });
  assert.equal(readDzmmShelfFeed(store, "one", 4_000), null);
  assert.equal(readDzmmShelfFeed(store, "three", 4_000)?.shown.characters[0]?.name, "3");
  writeDzmmShelfFeed(store, "three", { shown: { ...page("3"), characters: [card({ id: "a" }), card({ id: "b" })], storedAt: 0 }, ahead: null }, 5_000, { feeds: 2, pages: 1, pageSize: 1 });
  assert.equal(readDzmmShelfFeed(store, "three", 5_000)?.shown.characters.length, 1);
});
