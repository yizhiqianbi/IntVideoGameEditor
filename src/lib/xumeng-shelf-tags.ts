/** Homepage shelf vocabulary. Adult fiction tags only; minor-coded tags are rejected. */

export const XUMENG_SHELF_TAGS = [
  "古风", "修仙", "调教", "熟女", "处女", "外冷内齁", "外冷内骚", "反差", "性奴", "巨乳", "白丝",
  "异世界穿越", "西方奇幻", "魔王统治", "战争策略", "领地经营", "开放世界", "调教征服", "后宫",
  "小母猪", "师姐", "御姐", "合欢宗", "内鬼", "伪装",
  "纯爱", "抽象", "网图", "沙雕",
  "乱伦", "母子", "母女", "兄妹", "姐弟", "嫂子", "舅妈", "姨妈", "婶婶", "继母", "继姐", "继兄", "姑嫂", "翁媳", "公媳", "岳母", "小姨子", "近亲", "背德", "禁忌", "父子",
  "人妻", "少妇", "女上司", "女帝", "圣女", "魔后", "女王", "女仆", "母狗", "淫荡", "痴女", "冷淡", "傲娇", "病娇", "毒舌", "温柔",
  "黑丝", "丝袜", "旗袍", "制服", "过膝袜", "足控",
  "NTR", "绿帽", "出轨", "偷情", "露出", "群交", "3P", "双飞", "内射", "中出", "怀孕", "口交", "乳交", "SM", "捆绑", "支配", "服从", "堕落", "催眠",
  "甜宠", "女性向", "百合", "男娘", "扶她", "男同", "油腻", "一般向", "同人", "男性向", "NSFW", "剧情", "单人", "全性向",
  "都市", "异世界", "穿越", "重生", "快穿", "系统", "无限流", "末日", "赛博", "西幻", "奇幻", "魔法", "冒险", "种田", "经营", "沙盒", "模拟", "宫斗", "权谋",
  "双修", "采补", "炉鼎", "宗门",
  "网恋", "主播", "明星", "模特", "护士", "秘书", "老板娘", "邻居", "同事", "青梅竹马", "年上", "年下",
  "破处", "非处", "肉便器", "潮吹", "后入", "骑乘", "颜射", "吞精", "足交",
  "兽耳", "狐妖", "精灵", "吸血鬼", "触手", "异种", "攻", "受", "伪娘",
  "强制", "野外", "车震", "网袜", "汉服", "和服", "女警", "空姐", "征服", "奴隶", "项圈", "宠物",
  "暗恋", "追妻", "离婚", "闪婚", "契约", "先婚后爱", "女强", "大女主",
] as const;

const SHELF_TAG_PATTERN = /^[\p{L}\p{N}]{1,16}$/u;
const MINOR_SHELF_TAG = /萝莉|幼女|幼男|幼态|正太|未成年|小学生|初中|高中|国中|国小|中学生|女学生|男学生|学生妹|女童|男童|幼童|儿童|炼铜|恋童|loli|lolita|shota|underage|child|父女|养女|义女|继女|干女|校园|校花|学妹|学弟|师生|同桌|甜妹|女高|女初|(?<!大)学生|1[3-7]\+/i;

export function normalizeShelfTag(value: string): string {
  return value.trim().replace(/^#+/u, "").replace(/\s+/gu, "");
}

export function shelfTagError(value: string): string | null {
  const tag = normalizeShelfTag(value);
  if (!tag) return "请输入标签。";
  if (tag.length > 16 || !SHELF_TAG_PATTERN.test(tag)) return "标签最多 16 个字，不要加符号。";
  if (MINOR_SHELF_TAG.test(tag)) return "不能上传涉及未成年人的标签。";
  return null;
}

export function characterMatchesShelfTags(tags: readonly string[], selected: readonly string[]): boolean {
  if (!selected.length) return true;
  return selected.some((tag) => characterMatchesShelfTag(tags, tag));
}

export function characterMatchesShelfTag(tags: readonly string[], selected: string): boolean {
  if (selected === "全部") return true;
  const needle = normalizeShelfTag(selected).toLowerCase();
  if (!needle) return true;
  return tags.some((tag) => {
    const hay = normalizeShelfTag(tag).toLowerCase();
    return hay === needle || (needle.length >= 2 && hay.includes(needle));
  });
}

export function toggleShelfTag(current: string, tag: string): string {
  const next = normalizeShelfTag(tag);
  const tags = [...new Set(current.split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean))];
  const index = tags.findIndex((item) => normalizeShelfTag(item).toLowerCase() === next.toLowerCase());
  if (index >= 0) tags.splice(index, 1);
  else if (tags.length < 20) tags.push(next);
  return tags.join("，");
}

const COVER_SKIP = new Set(["剧情", "自定义", "一般向", "单人", "nsfw", "原创", "全性向"]);
/** Audience and format labels that do not distinguish one story from another. */
const SIMILARITY_SKIP = new Set([...COVER_SKIP, "男性向"]);

/** Cards whose text is only “自定义” get a concrete shelf tag. Names are matched exactly. */
const CUSTOM_TAG_BY_NAME: Record<string, readonly string[]> = {
  "自定义角色": ["开放世界", "沙盒", "模拟"],
  "《自定义世界》": ["开放世界", "沙盒", "模拟"],
  "《三万粉纪念：自定义世界》": ["开放世界", "沙盒", "模拟"],
  "第二人生模拟系统": ["都市", "模拟", "经营"],
  "Cosplay展的霸道女帝": ["女帝", "御姐", "巨乳", "网图", "反差", "调教征服"],
  "兽血沸腾": ["西方奇幻", "兽耳", "狐妖", "熟女", "异种", "后宫"],
  "开Y趴不带我？": ["群交", "后宫", "伪装", "开放世界"],
  "性虐都市": ["调教", "巨乳", "黑丝", "SM", "都市", "母狗"],
  "我的手机，能把任何女人变成性奴": ["性奴", "都市", "催眠", "强制", "调教"],
  "日本人非常能忍": ["都市", "制服", "反差", "露出"],
  "淫荡娇妻宁宁与绿奴老公": ["NTR", "绿帽", "人妻", "出轨", "巨乳"],
  "猎笼计划": ["调教", "足控", "丝袜", "都市", "反差"],
  "身为社畜的我竟然在愚人节获得了无论开什么玩笑都会成真的超能力": ["都市", "沙雕", "抽象", "反差"],
  "3000人银趴邮轮 全球最大伴侣交换聚会": ["群交", "后宫", "NTR", "出轨", "开放世界"],
  "恶魔女主人端来蛋糕，里面下了药": ["西方奇幻", "女王", "催眠", "调教", "御姐"],
  "毒舌房东小节": ["毒舌", "都市", "反差", "年上"],
  "签下契约后，恶魔每天来榨干我": ["西方奇幻", "女王", "御姐", "骑乘"],
};

export function fillCustomShelfTags(name: string, tags: readonly string[]): string[] {
  const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag && tag !== "自定义" && !MINOR_SHELF_TAG.test(tag)))];
  const extra = CUSTOM_TAG_BY_NAME[name.trim()];
  if (!extra) return cleaned.length ? cleaned : ["自定义"];
  const merged = [...cleaned];
  for (const tag of extra) {
    if (shelfTagError(tag)) continue;
    if (!merged.some((item) => item.toLowerCase() === tag.toLowerCase())) merged.push(tag);
  }
  return merged.slice(0, 8);
}

export function visibleShelfTags(tags: readonly string[], limit = 12): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/u, "");
    const key = tag.toLowerCase();
    if (!tag || tag.length > 24 || seen.has(key) || MINOR_SHELF_TAG.test(tag)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= limit) break;
  }
  return result;
}

export function characterHasMinorShelfTag(tags: readonly string[]): boolean {
  return tags.some((tag) => MINOR_SHELF_TAG.test(tag));
}

/** Tags that can explain why two public cards are similar. */
export function recommendationShelfTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/u, "");
    const key = tag.toLowerCase();
    if (!tag || tag.length > 24 || seen.has(key) || MINOR_SHELF_TAG.test(tag) || SIMILARITY_SKIP.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function coverShelfTags(tags: readonly string[], limit = 2): string[] {
  const all = visibleShelfTags(tags, 20);
  const specific = all.filter((tag) => !COVER_SKIP.has(tag.toLowerCase()));
  return (specific.length ? specific : all).slice(0, limit);
}

export function mergeShelfTags(community: readonly string[], catalog: readonly string[], cardTags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (raw: string, strict: boolean) => {
    const tag = strict ? normalizeShelfTag(raw) : raw.trim().replace(/^#+/u, "");
    const key = tag.toLowerCase();
    if (!tag || tag.length > 40 || seen.has(key) || MINOR_SHELF_TAG.test(tag)) return;
    if (strict && shelfTagError(tag)) return;
    seen.add(key);
    result.push(tag);
  };
  for (const tag of community) push(tag, true);
  for (const tag of catalog) push(tag, true);
  for (const tag of cardTags) push(tag, false);
  return result;
}
