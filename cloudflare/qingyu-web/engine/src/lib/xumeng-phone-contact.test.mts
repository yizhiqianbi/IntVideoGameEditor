import test from "node:test";
import assert from "node:assert/strict";
import contactModule from "./xumeng-phone-contact.ts";
import sceneModule from "./xumeng-live-scene.ts";
import type { XumengLiveSource, XumengPerformanceCharacter } from "./xumeng-performance-character.ts";

const { XUMENG_PHONE_DEFAULT_PERSONA, XUMENG_PHONE_DEFAULT_VOICE, createXumengManualPhoneContact,
  buildXumengManualPhonePersona, getXumengPhoneSourceReference, getXumengPhoneCallReference } = contactModule as typeof import("./xumeng-phone-contact.ts");
const { buildXumengLiveStartPersona } = sceneModule as typeof import("./xumeng-live-scene.ts");
const person: XumengPerformanceCharacter = { id: "cartographer", key: "novel:tide-notes:cartographer", source: "novel",
  sourceId: "tide-notes", sourceLabel: "潮汐手册", name: "林舟", avatar: "", description: "沿岸测绘员", personality: "先核对坐标",
  scenario: "码头地图室", dialogue: "先看记录。", liveVoice: "zh_female_liuchangnv_uranus_bigtts" };
const novelSource: XumengLiveSource = { key: "novel:tide-notes", kind: "novel", sourceId: "tide-notes", label: "潮汐手册",
  reference: "作品概要：测绘员追查海图；未选择的远航只是可能性。", characterKeys: [person.key] };

test("a new manual contact clears prior facts, relationship and dialogue and owns fresh scene arrays", () => {
  const previous = createXumengManualPhoneContact();
  previous.scene.situation = "三年后在山顶地图室";
  previous.scene.relationship = "玩家曾救过林舟，因此愿意合作";
  previous.scene.established = "原件仍在林舟手中";
  previous.scene.recentDialogue.push({ role: "character", text: "先核对第三页。" });
  const contact = createXumengManualPhoneContact();
  assert.equal(contact.name, ""); assert.equal(contact.background, "");
  assert.equal(contact.persona, XUMENG_PHONE_DEFAULT_PERSONA); assert.equal(contact.voice, XUMENG_PHONE_DEFAULT_VOICE);
  assert.equal(contact.scene.situation, ""); assert.equal(contact.scene.relationship, ""); assert.equal(contact.scene.established, "");
  assert.deepEqual(contact.scene.recentDialogue, []); assert.notEqual(contact.scene.recentDialogue, previous.scene.recentDialogue);
  const prompt = buildXumengLiveStartPersona(contact.persona, contact.scene, getXumengPhoneSourceReference(null, novelSource));
  assert.doesNotMatch(prompt, /山顶地图室|救过林舟|原件仍在|第三页|作品概要|远航/);
});

test("manual name and background become the call persona without old chapter references or author notes", () => {
  const contact = createXumengManualPhoneContact();
  const persona = buildXumengManualPhonePersona("陈遥", "独立书店店主，今天在整理新书。\n\nPS：作者说明：只是测试备注。");
  const prompt = buildXumengLiveStartPersona(persona, contact.scene, getXumengPhoneSourceReference(undefined, novelSource));
  assert.match(prompt, /陈遥/); assert.match(prompt, /独立书店店主/); assert.match(prompt, /今天在整理新书/);
  assert.doesNotMatch(prompt, /测试备注|测绘员|远航|潮汐手册/);
  assert.equal(buildXumengManualPhonePersona(" ", " "), XUMENG_PHONE_DEFAULT_PERSONA);
  assert.ok(buildXumengManualPhonePersona("名".repeat(500), "背景".repeat(3000)).length <= 2500);
});

test("only the chosen novel's reference accompanies its character and remains a reference rather than fact", () => {
  const reference = getXumengPhoneSourceReference(person, novelSource);
  assert.equal(reference, novelSource.reference);
  const scene = createXumengManualPhoneContact().scene;
  scene.situation = "地图室";
  scene.recentDialogue = [{ role: "user", text: "潮汐记录在这里。" }, { role: "character", text: "先核对第三页。" }];
  const prompt = buildXumengLiveStartPersona("林舟是沿岸测绘员", scene, reference);
  assert.match(prompt, /先核对第三页/); assert.match(prompt, /作品或章节参考（不代表本场已发生事实/);
  assert.match(prompt, /作品概要：测绘员追查海图/);
  assert.equal(getXumengPhoneSourceReference(person, { ...novelSource, sourceId: "another-work" }), "");
  assert.equal(getXumengPhoneSourceReference(person, { ...novelSource, kind: "game", sourceId: person.sourceId }), "");
});

test("a card accepts only its own character-library membership and no implicit game background", () => {
  const card = { ...person, key: "character:cartographer", source: "character" as const, sourceId: "cartographer" };
  const library: XumengLiveSource = { key: "character-library", kind: "character", sourceId: "character-library", label: "角色库",
    reference: "角色库自有资料", characterKeys: [card.key] };
  assert.equal(getXumengPhoneSourceReference(card, library), "角色库自有资料");
  assert.equal(getXumengPhoneSourceReference(card, { ...library, characterKeys: [] }), "");
  assert.equal(getXumengPhoneSourceReference(card, { ...library, key: "other-library" }), "");
  assert.equal(getXumengPhoneSourceReference(card, { ...library, kind: "game", key: "game:harbor" }), "");
  assert.equal(getXumengPhoneSourceReference(card, novelSource), "");
});

test("the latest chapter tail survives the bounded start prompt instead of being displaced by a long synopsis", () => {
  const source = { ...novelSource, reference: "概要".repeat(500) + "overview-only-marker" };
  const character = { ...person, context: "前文".repeat(1200) + "chapter-tail-unique-marker：她刚打开地图室的门。\n\nPS：作者说明：chapter-note-marker。" };
  const reference = getXumengPhoneCallReference(character, source);
  assert.ok(reference.length <= 500);
  const prompt = buildXumengLiveStartPersona("林舟是沿岸测绘员", createXumengManualPhoneContact().scene, reference);
  assert.match(prompt, /chapter-tail-unique-marker/); assert.match(prompt, /她刚打开地图室的门/);
  assert.doesNotMatch(prompt, /overview-only-marker|概要|chapter-note-marker|作者说明/);
});

test("matching overview is used only when no chapter body is available; manual and mismatched sources stay empty", () => {
  const source = { ...novelSource, reference: "当前作品概要\n\nPS：作者说明：overview-note-marker。" };
  assert.equal(getXumengPhoneCallReference(person, source), "当前作品概要");
  assert.equal(getXumengPhoneCallReference({ ...person, context: "\n\nPS：作者说明：only-notes。" }, source), "当前作品概要");
  assert.equal(getXumengPhoneCallReference(null, source), "");
  assert.equal(getXumengPhoneCallReference(undefined, source), "");
  assert.equal(getXumengPhoneCallReference(person, { ...source, sourceId: "another-work" }), "");
  assert.equal(getXumengPhoneCallReference(person, { ...source, kind: "game" }), "");
});

test("explicit chapter prose does not depend on the library finishing loading and truncation keeps complete Unicode characters", () => {
  const reference = getXumengPhoneCallReference({ ...person, context: "🧭".repeat(400) + "最新记录" }, undefined);
  assert.ok(reference.length <= 500); assert.match(reference, /最新记录$/);
  assert.doesNotMatch(reference, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
});
