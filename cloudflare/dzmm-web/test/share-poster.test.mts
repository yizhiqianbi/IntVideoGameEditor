import assert from "node:assert/strict";
import test from "node:test";
import { shareHookLine, sharePosterFileName, sharePosterImageUrl, xumengShareCoverImageType, xumengVideoCoverProxyPath, xumengVideoCoverUpstream } from "../../../src/lib/xumeng-share-poster";

test("short-drama covers proxy through the same origin and reject other hosts", () => {
  assert.equal(
    xumengVideoCoverProxyPath("https://video.xumengchat.top/covers/huangguo/5161.png?v=2"),
    "/api/xumeng-share/cover?src=%2Fcovers%2Fhuangguo%2F5161.png&v=2",
  );
  assert.equal(
    xumengVideoCoverUpstream("/covers/huangguo/5161.png", "2"),
    "https://video.xumengchat.top/covers/huangguo/5161.png?v=2",
  );
  assert.equal(xumengVideoCoverProxyPath("https://video.xumengchat.top/covers/huangguo/5161.png?v=2&next=https://evil.example"), null);
  assert.equal(xumengVideoCoverProxyPath("https://evil.example/covers/huangguo/5161.png"), null);
  assert.equal(xumengVideoCoverUpstream("/covers/huangguo/../5161.png", null), null);
  assert.equal(xumengVideoCoverUpstream("/covers/other/5161.png", null), null);
  assert.equal(sharePosterImageUrl("https://video.xumengchat.top/covers/huangguo/9758.jpeg?v=2"), "/api/xumeng-share/cover?src=%2Fcovers%2Fhuangguo%2F9758.jpeg&v=2");
  assert.equal(sharePosterImageUrl("/assets/xumeng/brand/xumeng-mark.svg"), "/assets/xumeng/brand/xumeng-mark.svg");
  assert.equal(sharePosterImageUrl("https://evil.example/secret.png", "https://xumengchat.top"), "");
  assert.equal(sharePosterImageUrl("https://xumengchat.top/assets/xumeng/a.jpg", "https://xumengchat.top"), "https://xumengchat.top/assets/xumeng/a.jpg");
});

test("poster hook and file name stay on one short line", () => {
  assert.equal(shareHookLine("你女朋友的妈妈。这顿饭她要看你家的条件。"), "你女朋友的妈妈。这顿饭她要看你家的条件。");
  assert.equal(shareHookLine(""), "在叙梦，把想象变成作品。");
  assert.equal(shareHookLine("叙".repeat(80)).endsWith("…"), true);
  assert.equal(shareHookLine("叙".repeat(80)).length, 56);
  assert.equal(sharePosterFileName("苏沛真"), "叙梦-苏沛真.png");
  assert.equal(sharePosterFileName("a/b:c"), "叙梦-abc.png");
});

test("cover bytes must be a real image", () => {
  assert.equal(xumengShareCoverImageType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0)), "image/png");
  assert.equal(xumengShareCoverImageType(Uint8Array.of(0xff, 0xd8, 0xff, 0)), "image/jpeg");
  assert.equal(xumengShareCoverImageType(Uint8Array.of(0x3c, 0x68, 0x74, 0x6d, 0x6c)), null);
});
