import assert from "node:assert/strict";
import test from "node:test";
import { MEDIA_CACHE_MAX_BYTES, mediaCacheRequest, mediaResponseCacheable } from "../src/worker.ts";

test("each byte range has its own cache entry", () => {
  const first = mediaCacheRequest("https://video.xumengchat.top/media/video/huangguo/10001/ep-002.mp4?unused=1", "bytes=0-1023");
  const second = mediaCacheRequest("https://video.xumengchat.top/media/video/huangguo/10001/ep-002.mp4", "bytes=1024-2047");
  const full = mediaCacheRequest("https://video.xumengchat.top/media/video/huangguo/10001/ep-002.mp4", null);
  assert.equal(new URL(first.url).searchParams.get("range"), "bytes=0-1023");
  assert.notEqual(first.url, second.url);
  assert.equal(new URL(full.url).search, "");
  assert.equal(first.method, "GET");
});

test("only bounded media responses are stored", () => {
  assert.equal(mediaResponseCacheable(1024), true);
  assert.equal(mediaResponseCacheable(MEDIA_CACHE_MAX_BYTES), true);
  assert.equal(mediaResponseCacheable(MEDIA_CACHE_MAX_BYTES + 1), false);
  assert.equal(mediaResponseCacheable(0), false);
});
