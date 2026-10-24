import test from "node:test";
import assert from "node:assert/strict";
import draftModule from "./dzmm-character-draft";
import characterModule from "./dzmm-characters";
import storageModule from "./dzmm-storage";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import publishingModule from "./dzmm-publishing";

const { parseDzmmCharacterAuthoringDraft, compileDzmmPrivateWorldBook } = draftModule as typeof import("./dzmm-character-draft");
const { parsePrivateCharacter, parseCharacterImport, exportCharacterJson, exportCharacterDraftJson, parseCharacterDraftImport } = characterModule as typeof import("./dzmm-characters");
const { hydrateDzmmState, DZMM_INITIAL_STATE } = storageModule as typeof import("./dzmm-storage");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { buildDzmmPromptPlan, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { submitDzmmCharacter } = publishingModule as typeof import("./dzmm-publishing");

function privateDraft() {
  return { version: 1, characterBook: { name: "海港记录", description: "作者正在整理的资料。", scanDepth: 4, entries: [
    { id: "name", name: "仅名称", content: "", keysText: "", secondaryText: "" },
    { id: "keys", content: "", keysText: "  灯塔，旧海图\n", secondaryText: "" },
    { id: "content", content: "AUTHORING_ONLY_TEST 还没写关键词。", keysText: "", secondaryText: "" },
    { id: "disabled", content: "停用仍需保存这段文字。", keysText: "", secondaryText: "", enabled: false, insertionOrder: 3 },
    { id: "complete", name: "码头", content: "码头的旧地图放在柜台。", keysText: "码头", secondaryText: "地图", selective: true, caseSensitive: false, insertionOrder: 4 },
  ] } };
}
function savedCharacter() {
  const raw = privateDraft();
  const compiled = compileDzmmPrivateWorldBook(raw);
  return parsePrivateCharacter({ name: "海港档案室", description: "沈澄，29岁，想找到失踪船只的旧记录。", firstMessage: "请看这两份记录。", ...compiled }, "local-authoring-test");
}

test("private worldbook preserves partial text, raw keyword formatting, order and settings across state reload", () => {
  const character = savedCharacter();
  const input = { ...DZMM_INITIAL_STATE, custom: [character], conversations: [{ id: "own-history", characterId: character.id, title: character.name, updatedAt: 1, messages: [{ id: "start", role: "assistant", content: "请看这两份记录。" }] }] };
  const restored = hydrateDzmmState(JSON.stringify(input));
  assert.deepEqual(restored.warnings, []);
  assert.deepEqual(restored.state.custom[0].authoringDraft, privateDraft());
  assert.deepEqual(restored.state.conversations, input.conversations);
  assert.deepEqual(restored.state.custom[0].characterBook?.entries.map(entry => entry.id), ["complete"]);
});

test("private draft files roundtrip authored rows while ordinary card export and import stay distinct", () => {
  const character = savedCharacter();
  assert.throws(() => exportCharacterJson(character), /私人创作草稿/);
  const file = exportCharacterDraftJson(character);
  assert.equal(JSON.parse(file).spec, "xumeng_authoring_draft_v1");
  assert.throws(() => parseCharacterImport(file), /仅支持/);
  const restored = parseCharacterDraftImport(file, "local-restored");
  assert.deepEqual(restored.authoringDraft, character.authoringDraft);
  assert.deepEqual(restored.characterBook, character.characterBook);
  assert.equal(restored.id, "local-restored");
  const malformed = JSON.parse(file);
  delete malformed.data.authoringDraft;
  assert.throws(() => parseCharacterDraftImport(malformed), /缺少创作数据/);
  const ordinary = parseCharacterImport(character);
  assert.equal(ordinary.authoringDraft, undefined);
  assert.equal(exportCharacterJson(ordinary).includes("AUTHORING_ONLY_TEST"), false);
});

test("real prompt assembly sends only completed lore and never private authoring text or metadata", () => {
  const character = savedCharacter();
  const request = prepareDzmmRequest(character, [{ role: "user", content: "我查看码头的地图。" }]);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  assert.equal(JSON.stringify(request).includes("authoringDraft"), false);
  assert.equal(JSON.stringify(plan).includes("AUTHORING_ONLY_TEST"), false);
  assert.equal(JSON.stringify(plan).includes("停用仍需保存这段文字"), false);
  assert.ok(JSON.stringify(plan).includes("码头的旧地图放在柜台"));
});

test("finishing the remaining rows clears the private marker and restores ordinary card export", () => {
  const character = savedCharacter();
  const raw = privateDraft();
  raw.characterBook.entries.forEach(entry => { entry.content ||= "已完成的地点设定。"; entry.keysText ||= "地点"; });
  const complete = parsePrivateCharacter({ ...character, authoringDraft: raw }, character.id);
  assert.equal(complete.authoringDraft, null);
  assert.equal(complete.characterBook?.entries.length, 5);
  assert.equal(JSON.parse(exportCharacterJson(complete)).authoringDraft, undefined);
});

test("invalid private metadata warns without dropping a valid character or its existing history", () => {
  const character = savedCharacter();
  const conversation = { id: "own-history", characterId: character.id, title: "档案室", updatedAt: 1, messages: [{ id: "start", role: "assistant", content: "你好。" }] };
  const restored = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, custom: [{ ...character, authoringDraft: { version: 99 } }], conversations: [conversation] }));
  assert.equal(restored.state.custom.length, 1);
  assert.deepEqual(restored.state.conversations, [conversation]);
  assert.equal(restored.warnings.length, 1);
  assert.match(restored.warnings[0], /保留角色/);
});

test("private draft shape, IDs, types, Unicode size and combined card size remain bounded", () => {
  for (const invalid of [null, { version: 2 }, { version: 1, characterBook: { entries: [] , scanDepth: 0 } }, { version: 1, characterBook: { entries: [{ content: "x\0", keysText: "", secondaryText: "" }] } }]) {
    assert.throws(() => parseDzmmCharacterAuthoringDraft(invalid));
  }
  const duplicates = privateDraft(); duplicates.characterBook.entries[1].id = "name";
  assert.throws(() => parseDzmmCharacterAuthoringDraft(duplicates), /ID/);
  const oversized = { version: 1, characterBook: { entries: Array.from({ length: 40 }, (_, id) => ({ id: String(id), content: "中".repeat(8000), keysText: "", secondaryText: "" })) } };
  assert.throws(() => parseDzmmCharacterAuthoringDraft(oversized), /256 KB/);
  const combined = { version: 1, characterBook: { entries: Array.from({ length: 11 }, (_, id) => ({ id: String(id), content: "中".repeat(7000), keysText: "", secondaryText: "" })) } };
  assert.doesNotThrow(() => parseDzmmCharacterAuthoringDraft(combined));
  assert.throws(() => parsePrivateCharacter({ name: "大型私稿", description: "字".repeat(12000), authoringDraft: combined }), /总量/);
});

test("public submission fails before a request can expose unfinished private authoring data", async () => {
  await assert.rejects(submitDzmmCharacter(savedCharacter()), /未完成项/);
});
