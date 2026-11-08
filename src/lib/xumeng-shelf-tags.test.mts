import test from "node:test";
import assert from "node:assert/strict";
import {
  XUMENG_SHELF_TAGS, characterMatchesShelfTag, coverShelfTags, fillCustomShelfTags, mergeShelfTags, normalizeShelfTag, shelfTagError, toggleShelfTag,
} from "./xumeng-shelf-tags.ts";

test("the built-in shelf accepts every listed adult tag once", () => {
  const seen = new Set<string>();
  for (const tag of XUMENG_SHELF_TAGS) {
    assert.equal(shelfTagError(tag), null, tag);
    assert.equal(seen.has(tag.toLowerCase()), false, tag);
    seen.add(tag.toLowerCase());
  }
  assert.ok(XUMENG_SHELF_TAGS.includes("乱伦"));
  assert.ok(XUMENG_SHELF_TAGS.includes("小母猪"));
  assert.ok(XUMENG_SHELF_TAGS.includes("外冷内齁"));
});

test("uploaded tags drop the hash and reject minor-coded words", () => {
  assert.equal(normalizeShelfTag("  #古风  "), "古风");
  assert.equal(shelfTagError("#母女"), null);
  assert.equal(shelfTagError("兄妹"), null);
  assert.match(shelfTagError("萝莉") ?? "", /未成年人/);
  assert.match(shelfTagError("父女") ?? "", /未成年人/);
  assert.match(shelfTagError("高中生") ?? "", /未成年人/);
  assert.match(shelfTagError("幼女乱伦") ?? "", /未成年人/);
  assert.match(shelfTagError("校园") ?? "", /未成年人/);
  assert.equal(shelfTagError("大学生"), null);
  assert.equal(shelfTagError("学姐"), null);
  assert.deepEqual(mergeShelfTags([], ["古风"], ["校园", "16+", "剧情"]), ["古风", "剧情"]);
  assert.match(shelfTagError("a".repeat(17)) ?? "", /16/);
  assert.equal(shelfTagError(""), "请输入标签。");
});

test("homepage tags keep community uploads first and still match card tags", () => {
  assert.deepEqual(mergeShelfTags(["新词", "古风", "萝莉"], ["古风", "修仙"], ["剧情", "仙侠古风"]), ["新词", "古风", "修仙", "剧情", "仙侠古风"]);
  assert.equal(characterMatchesShelfTag(["仙侠古风", "剧情"], "古风"), true);
  assert.equal(characterMatchesShelfTag(["剧情"], "乱伦"), false);
  assert.equal(toggleShelfTag("一般向，古风", "修仙"), "一般向，古风，修仙");
  assert.equal(toggleShelfTag("一般向，古风", "古风"), "一般向");
  assert.deepEqual(coverShelfTags(["剧情", "一般向", "古风", "修仙", "校园"], 2), ["古风", "修仙"]);
  assert.deepEqual(fillCustomShelfTags("毒舌房东小节", ["自定义"]), ["毒舌", "都市", "反差", "年上"]);
  assert.deepEqual(fillCustomShelfTags("第二人生模拟系统", ["人生模拟", "自定义", "都市"]), ["人生模拟", "都市", "模拟", "经营"]);
  assert.deepEqual(fillCustomShelfTags("战败的女骑士，被送到我床上赎罪", ["自定义"]), ["自定义"]);
  assert.deepEqual(coverShelfTags(fillCustomShelfTags("Cosplay展的霸道女帝", ["自定义"]), 2), ["女帝", "御姐"]);
  assert.deepEqual(fillCustomShelfTags("我的手机，能把任何女人变成性奴", ["自定义"]).slice(0, 2), ["性奴", "都市"]);
});
