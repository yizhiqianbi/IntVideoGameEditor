import assert from "node:assert/strict";
import test from "node:test";
import { XUMENG_SHORT_DRAMA_CARDS, xumengShortDramaColumn } from "./xumeng-short-drama-cards.ts";

test("short drama column keeps the four episode-one cards", () => {
  assert.deepEqual(xumengShortDramaColumn([]).map((item) => item.character.name), ["苏沛真", "小飞的岳母", "金发短发", "餐车伙计"]);
  assert.equal(new Set(XUMENG_SHORT_DRAMA_CARDS.map((card) => card.id)).size, 4);
  for (const card of XUMENG_SHORT_DRAMA_CARDS) {
    assert.equal(card.author, "叙梦短剧");
    assert.ok(card.firstMessage.includes("\n"));
    assert.ok(card.characterBook?.entries.length);
    assert.ok(card.tags.includes("短剧"));
  }
});

test("short drama column follows the selected shelf tag", () => {
  assert.equal(xumengShortDramaColumn(["男性向"]).length, 3);
  assert.deepEqual(xumengShortDramaColumn(["男同"]).map((item) => item.dramaTitle), ["天宫"]);
  assert.equal(xumengShortDramaColumn(["纯爱"]).length, 0);
  assert.equal(xumengShortDramaColumn(["短剧"]).length, 4);
});
