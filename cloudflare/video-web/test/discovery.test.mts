import assert from "node:assert/strict";
import test from "node:test";
import { playDocument, playIdFromPath, publicEpisode, videoRobotsTxt, videoSitemapXml } from "../src/discovery";

const episode = {
  id: "hg-10001-2",
  title: "港口夜航",
  episode: "第02集",
  category: "AI成人短剧",
  posterKey: "posters/huangguo/10001.jpg",
  mediaKey: "video/huangguo/10001/ep-002.mp4",
};

test("robots points crawlers at the episode sitemap and keeps import routes closed", () => {
  const robots = videoRobotsTxt();
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \/\nDisallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/video\.xumengchat\.top\/sitemap\.xml/);
  assert.match(robots, /Content-Signal: search=yes, ai-input=yes, ai-train=yes/);
});

test("sitemap lists only matching public episodes", () => {
  const xml = videoSitemapXml({
    updatedAt: "2026-11-05T02:00:00.000Z",
    items: [
      episode,
      { ...episode, id: "hg-10001-2" },
      { ...episode, id: "hg-10001-3", mediaKey: "video/huangguo/10001/ep-002.mp4" },
      { ...episode, id: "not-a-play-url", mediaKey: "video/private/secret.mp4" },
    ],
  });
  assert.equal([...xml.matchAll(/<loc>/g)].length, 2);
  assert.match(xml, /<loc>https:\/\/video\.xumengchat\.top\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/video\.xumengchat\.top\/play\/hg-10001-2<\/loc><lastmod>2026-11-05<\/lastmod>/);
  assert.match(xml, /<video:content_loc>https:\/\/video\.xumengchat\.top\/media\/video\/huangguo\/10001\/ep-002\.mp4\?v=3<\/video:content_loc>/);
  assert.match(xml, /<video:family_friendly>no<\/video:family_friendly>/);
  assert.doesNotMatch(xml, /\/api\/|secret|not-a-play-url|hg-10001-3/);
  assert.equal(publicEpisode({ ...episode, title: "  港口夜航\n" }, "2026-11-05T02:00:00.000Z")?.title, "港口夜航");
  assert.equal(playIdFromPath("/play/hg-10001-2/"), "hg-10001-2");
  assert.equal(playIdFromPath("/play/../secret"), null);
});

test("a play document replaces the library title with the episode", () => {
  const item = publicEpisode(episode, "2026-11-05T02:00:00.000Z");
  assert.ok(item);
  const html = playDocument(`<!doctype html><html><head><title>叙梦短剧</title><meta name="description" content="片库"/><link rel="canonical" href="https://video.xumengchat.top/" /><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><div id="root"></div></body></html>`, item);
  assert.match(html, /<title>港口夜航 第02集｜叙梦短剧<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/video\.xumengchat\.top\/play\/hg-10001-2"/);
  assert.match(html, /"@type":"VideoObject"/);
  assert.doesNotMatch(html, /<title>叙梦短剧<\/title>|content="片库"|WebSite/);
  assert.equal([...html.matchAll(/<title>/g)].length, 1);
  assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1);
});
