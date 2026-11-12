import assert from "node:assert/strict";
import { test } from "node:test";
import catalog from "./xumeng-video-catalog.ts";

const { parseXumengVideoCatalog, rankXumengVideoDramas, matchXumengVideoCharacter, xumengVideoDramaIdFromRoute, xumengVideoMediaUrl, xumengVideoPosterUrl } = catalog as typeof import("./xumeng-video-catalog.ts");

test("huangguo catalog groups episodes and ignores the deleted full-video layout", () => {
  const dramas = parseXumengVideoCatalog({
    items: [
      { id: "hg-11138-2", dramaId: "hg-11138", title: "海浪与婚戒", episode: "第02集", mediaKey: "video/huangguo/11138/ep-002.mp4", posterKey: "posters/huangguo/11138.jpg", category: "AI成人短剧" },
      { id: "hg-11138-1", dramaId: "hg-11138", title: "海浪与婚戒", episode: "第01集", mediaKey: "video/huangguo/11138/ep-001.mp4", posterKey: "posters/huangguo/11138.jpg", category: "AI成人短剧" },
      { id: "hg-10999-1", dramaId: "hg-10999", title: "封面是 png", episode: "第01集", mediaKey: "video/huangguo/10999/ep-001.mp4", posterKey: "posters/huangguo/10999.png", category: "漫剧" },
      { id: "1018", dramaId: "1018", title: "旧片", episode: "第01集", mediaKey: "video/full/1018.mp4", posterKey: "posters/1018.jpg", category: "短剧" },
      { id: "hg-11138-9", dramaId: "hg-11138", title: "错封面", episode: "第09集", mediaKey: "video/huangguo/11138/ep-009.mp4", posterKey: "posters/huangguo/99999.jpg", category: "AI成人短剧" },
      { id: "hg-11138-3", dramaId: "hg-11138", title: "路径穿越", episode: "第03集", mediaKey: "video/huangguo/11138/../ep-003.mp4", posterKey: "posters/huangguo/11138.jpg", category: "AI成人短剧" },
    ],
  });
  assert.deepEqual(dramas.map(drama => drama.dramaId), ["hg-11138", "hg-10999"]);
  assert.deepEqual(dramas[0]?.episodes.map(episode => episode.episodeNumber), [1, 2]);
  assert.equal(xumengVideoMediaUrl(dramas[0]!.episodes[0]!.mediaKey), "https://video.xumengchat.top/media/video/huangguo/11138/ep-001.mp4?v=3");
  assert.equal(xumengVideoMediaUrl(dramas[0]!.episodes[0]!.posterKey), "https://video.xumengchat.top/media/posters/huangguo/11138.jpg");
  assert.equal(xumengVideoPosterUrl(dramas[0]!.episodes[0]!.posterKey), "https://video.xumengchat.top/covers/huangguo/11138.jpg?v=2");
  assert.equal(xumengVideoDramaIdFromRoute("#videos/hg-11138"), "hg-11138");
  assert.equal(xumengVideoDramaIdFromRoute("videos/1018"), "");
});

test("optional character link and synopsis stay with the drama", () => {
  const [drama] = parseXumengVideoCatalog({
    items: [
      { id: "hg-11138-1", dramaId: "hg-11138", title: "海浪与婚戒", episode: "第01集", mediaKey: "video/huangguo/11138/ep-001.mp4", posterKey: "posters/huangguo/11138.jpg", category: "AI成人短剧", characterId: "card-1", synopsis: "婚礼前夜，她把戒指放回你掌心。", tags: ["都市", "太长的标签不应该被收下因为超过十六字"] },
    ],
  });
  assert.equal(drama?.characterId, "card-1");
  assert.equal(drama?.synopsis, "婚礼前夜，她把戒指放回你掌心。");
  assert.deepEqual(drama?.tags, ["都市"]);
});

test("a drama opens the character with the same id or title", () => {
  const drama = { title: "八位王子，一顶王冠", characterId: "" };
  const cards = [
    { id: "other", name: "另一张卡" },
    { id: "crown", name: "八位王子，一顶王冠" },
    { id: "longer", name: "八位王子，一顶王冠 番外" },
  ];
  assert.equal(matchXumengVideoCharacter(drama, cards)?.id, "crown");
  assert.equal(matchXumengVideoCharacter({ title: "没有这张卡", characterId: "crown" }, cards)?.id, "crown");
  assert.equal(matchXumengVideoCharacter({ title: "海", characterId: "" }, [{ id: "sea", name: "海浪与婚戒" }]), null);
});

test("a catalog without an item list is rejected", () => {
  assert.throws(() => parseXumengVideoCatalog({ brand: "叙梦短剧" }), /视频目录格式无效/);
});

test("video drama ranking is stable within a day and changes the exploration order across days", () => {
  const dramas = parseXumengVideoCatalog({ items: [
    ...["11138", "11139", "11140", "11141"].map(id => ({ id: `hg-${id}-1`, dramaId: `hg-${id}`, title: id, episode: "第01集", mediaKey: `video/huangguo/${id}/ep-001.mp4`, posterKey: `posters/huangguo/${id}.jpg`, category: "AI成人短剧" })),
  ] });
  const today = rankXumengVideoDramas(dramas, "2026-11-12").map(item => item.dramaId);
  assert.deepEqual(rankXumengVideoDramas(dramas, "2026-11-12").map(item => item.dramaId), today);
  assert.notDeepEqual(rankXumengVideoDramas(dramas, "2026-11-13").map(item => item.dramaId), today);
});
