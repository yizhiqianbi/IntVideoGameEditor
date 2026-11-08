import assert from "node:assert/strict";
import { test } from "node:test";
import catalog from "./xumeng-video-catalog.ts";

const { parseXumengVideoCatalog, xumengVideoDramaIdFromRoute, xumengVideoMediaUrl, xumengVideoPosterUrl } = catalog as typeof import("./xumeng-video-catalog.ts");

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

test("a catalog without an item list is rejected", () => {
  assert.throws(() => parseXumengVideoCatalog({ brand: "叙梦短剧" }), /视频目录格式无效/);
});
