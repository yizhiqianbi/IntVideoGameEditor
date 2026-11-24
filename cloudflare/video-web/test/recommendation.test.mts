import assert from "node:assert/strict";
import test from "node:test";
import { diversifyVideoItems, type VideoRecommendationItem } from "../src/recommendation";

function item(dramaId: string, episode: number, category = "AI短剧"): VideoRecommendationItem {
  const numeric = dramaId.replace("hg-", "");
  return {
    id: `${dramaId}-${episode}`,
    dramaId,
    title: `剧集 ${numeric}`,
    episode: `第${String(episode).padStart(2, "0")}集`,
    file: `${dramaId}-${episode}.mp4`,
    mediaKey: `video/huangguo/${numeric}/ep-${String(episode).padStart(3, "0")}.mp4`,
    posterKey: `posters/huangguo/${numeric}.jpg`,
    category,
    badge: "已导入",
    source: "test",
  };
}

test("interleaves episodes so one series does not monopolize the first shelf", () => {
  const ranked = diversifyVideoItems([
    item("hg-10001", 3), item("hg-10001", 2), item("hg-10001", 1),
    item("hg-10002", 2), item("hg-10002", 1),
    item("hg-10003", 1),
  ], "2026-11-12T00:00:00.000Z");
  const firstThree = ranked.slice(0, 3).map(entry => entry.dramaId);
  assert.equal(new Set(firstThree).size, 3);
  const firstSeriesEpisodes = ranked.filter(entry => entry.dramaId === "hg-10001").map(entry => entry.episode);
  assert.equal(firstSeriesEpisodes[0], "第03集");
});

test("keeps the same daily order stable while allowing a new daily exploration order", () => {
  const source = Array.from({ length: 8 }, (_, index) => item(`hg-${10001 + index}`, 1, index % 2 ? "漫剧" : "AI短剧"));
  const today = diversifyVideoItems(source, "2026-11-12T00:00:00.000Z").map(entry => entry.dramaId);
  const todayAgain = diversifyVideoItems(source, "2026-11-12T19:00:00.000Z").map(entry => entry.dramaId);
  const tomorrow = diversifyVideoItems(source, "2026-11-13T00:00:00.000Z").map(entry => entry.dramaId);
  assert.deepEqual(todayAgain, today);
  assert.notDeepEqual(tomorrow, today);
});
