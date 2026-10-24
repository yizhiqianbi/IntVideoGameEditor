import { test } from "node:test";
import assert from "node:assert/strict";
import performanceModule from "./xumeng-performance-character.ts";
import type { XumengNovelCharacter } from "./xumeng-performance-character.ts";
const { buildXumengLivePersona, parseXumengNovelCharacters, xumengPerformanceFromCard, xumengPerformanceFromNovel } = performanceModule as typeof import("./xumeng-performance-character.ts");
import type { Character } from "./dzmm-characters.ts";
const person: XumengNovelCharacter = { id: "navigator", name: "林舟", avatar: "/assets/test.webp", description: "沿岸测绘员", personality: "核对坐标后才动身", scenario: "码头地图室", dialogue: "先看看潮汐记录。", liveVoice: "zh_female_liuchangnv_uranus_bigtts" };
test("role voices survive saved cast and projection; legacy cast remains unchanged", () => {
  const selected = { ...person, liveVoice: "Katerina", speechVoice: "female-yujie" };
  const restored = parseXumengNovelCharacters(JSON.parse(JSON.stringify([selected])))[0];
  assert.equal(restored.liveVoice, "Katerina"); assert.equal(restored.speechVoice, "female-yujie");
  assert.equal(xumengPerformanceFromNovel(restored, { id: "a", title: "潮汐" }).speechVoice, "female-yujie");
  assert.equal(parseXumengNovelCharacters([person])[0].speechVoice, undefined);
  for (const speechVoice of [null, "Katerina", "invented-voice", {}]) assert.throws(() => parseXumengNovelCharacters([{ ...person, speechVoice }], { allowIncomplete: true }));
});
test("legacy novel has no cast; private incomplete work remains recoverable", () => {
  assert.deepEqual(parseXumengNovelCharacters(undefined), []);
  assert.throws(() => parseXumengNovelCharacters([{ ...person, name: "", avatar: "https:" }]));
  assert.equal(parseXumengNovelCharacters([{ ...person, name: "", avatar: "https:" }], { allowIncomplete: true })[0].avatar, "https:");
});
test("strict cast validation rejects duplicate IDs, invalid image schemes and unknown voices", () => {
  for (const row of [{ ...person, avatar: "javascript:alert(1)" }, { ...person, avatar: "//other.test/a.png" }, { ...person, avatar: "https://user:secret@example.com/a.png" }, { ...person, liveVoice: "unsupported" }, { ...person, extra: true }]) assert.throws(() => parseXumengNovelCharacters([row]));
  assert.throws(() => parseXumengNovelCharacters([person, person]));
  assert.throws(() => parseXumengNovelCharacters(Array.from({ length: 31 }, (_, index) => ({ ...person, id: String(index) }))));
  assert.deepEqual(parseXumengNovelCharacters([person]), [person]);
});
test("card projection separates author notes, carries constant facts and resolves public asset routes", () => {
  const card = { ...person, id: "card-a", cover: "/dzmm/covers/a.webp", firstMessage: "{{char}}对{{user}}说：地图找到了。\n\nPS：作者说明：测试说明。", systemPrompt: "保持测绘员身份", characterBook: { entries: [{ content: "港口名称青潮", keys: [], constant: true }, { content: "未触发的秘密", keys: ["钥匙"] }, { content: "禁用资料", keys: [], constant: true, enabled: false }] } } as unknown as Character;
  const projected = xumengPerformanceFromCard(card); const prompt = buildXumengLivePersona(projected);
  assert.equal(projected.avatar, "/assets/xumeng/covers/a.webp");
  assert.match(prompt, /保持测绘员身份/); assert.match(prompt, /港口名称青潮/);
  assert.match(prompt, /林舟对玩家说/);
  assert.match(buildXumengLivePersona(projected, "阿宁"), /林舟对阿宁说/);
  assert.doesNotMatch(prompt, /作者测试|未触发的秘密|禁用资料|\{\{user\}\}/);
});
test("novel identity and optional current prose are independent from style examples", () => {
  const profile = xumengPerformanceFromNovel(person, { id: "work-a", title: "潮汐手册" });
  assert.equal(profile.key, "novel:work-a:navigator"); assert.equal(profile.context, undefined);
  const withContext = xumengPerformanceFromNovel(person, { id: "work-a", title: "潮汐手册" }, "旧".repeat(2400) + "她已返回码头。\n\nPS：作者说明：编辑说明");
  assert.ok(withContext.context!.endsWith("她已返回码头。"));
  const prompt = buildXumengLivePersona(withContext);
  assert.match(prompt, /当前剧情参考/); assert.match(prompt, /台词风格示例（不是当前已发生的事件）/); assert.doesNotMatch(prompt, /编辑说明/);
});
test("maximal imported fields keep current facts inside the 5000 character persona limit", () => {
  const profile = xumengPerformanceFromNovel({ ...person, name: "林".repeat(120), description: "背景".repeat(1000), personality: "性格".repeat(1000), scenario: "局势".repeat(1000), dialogue: "样例".repeat(1000) }, { id: "a", title: "作品" }, "场景".repeat(900) + "新事实");
  profile.instructions = "补充".repeat(1000);
  const prompt = buildXumengLivePersona(profile);
  assert.ok(prompt.length <= 5000); assert.match(prompt, /新事实/); assert.match(prompt, /台词风格示例/);
});
