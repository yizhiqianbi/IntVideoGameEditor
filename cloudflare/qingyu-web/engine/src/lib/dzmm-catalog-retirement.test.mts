import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as characterModule from "./dzmm-characters";
import * as catalogModule from "./dzmm-catalog";
import * as discoveryModule from "./dzmm-discovery";
import * as storageModule from "./dzmm-storage";
import * as searchModule from "./dzmm-conversation-search";
import type { Character } from "./dzmm-characters";
import type { DzmmAuthor } from "./dzmm-discovery";
import type { DzmmSavedConversation } from "./dzmm-storage";

const { DZMM_AI_CHARACTERS, DZMM_CATALOG_CHARACTERS, DZMM_EXPORTED_FULL_CHARACTERS, DZMM_LISTED_CHARACTERS, isDzmmListedCharacter, parseCharacterImport } =
  ("default" in characterModule ? characterModule.default : characterModule) as typeof import("./dzmm-characters");
const { mergeDzmmSharedCatalog, mergeDzmmConversationCharacters, getDzmmNewConversationBlockReason } =
  ("default" in catalogModule ? catalogModule.default : catalogModule) as typeof import("./dzmm-catalog");
const { filterDzmmCharacters, searchDzmmAuthors } =
  ("default" in discoveryModule ? discoveryModule.default : discoveryModule) as typeof import("./dzmm-discovery");
const { DZMM_INITIAL_STATE, hydrateDzmmState } =
  ("default" in storageModule ? storageModule.default : storageModule) as typeof import("./dzmm-storage");
const { filterDzmmConversations } =
  ("default" in searchModule ? searchModule.default : searchModule) as typeof import("./dzmm-conversation-search");
const retired = DZMM_AI_CHARACTERS.filter(character => character.catalogReadiness === "metadata-only");
const retiredIds = new Set(retired.map(character => character.id));

test("55 metadata placeholders stay retired while five verified backgrounds and eighteen exported cards retain their honest readiness", () => {
  assert.equal(retired.length, 55);
  assert.equal(DZMM_AI_CHARACTERS.length, 60, "The historical archive remains intact.");
  assert.equal(DZMM_LISTED_CHARACTERS.length, 23);
  assert.equal(DZMM_LISTED_CHARACTERS.filter(character => character.catalogReadiness === "public-context").length, 5);
  assert.equal(DZMM_EXPORTED_FULL_CHARACTERS.length, 18);
  assert.ok(DZMM_EXPORTED_FULL_CHARACTERS.every(character => character.catalogReadiness === "full-card"));
  for (const character of retired) assert.equal(isDzmmListedCharacter(character), false);
  for (const character of DZMM_LISTED_CHARACTERS) assert.equal(isDzmmListedCharacter(character), true);
  const shared = mergeDzmmSharedCatalog(DZMM_LISTED_CHARACTERS, DZMM_AI_CHARACTERS);
  assert.deepEqual(shared.map(character => character.id), DZMM_LISTED_CHARACTERS.map(character => character.id));
  for (const query of ["", ...retired.map(character => character.name)])
    assert.ok(filterDzmmCharacters(shared, { query }).every(character => !retiredIds.has(character.id)));
  for (const selected of shared)
    assert.ok(shared.filter(character => character.sourceKind === selected.sourceKind).every(character => !retiredIds.has(character.id)));
  const authors: DzmmAuthor[] = JSON.parse(readFileSync(new URL("./dzmm-authors.json", import.meta.url), "utf8"));
  const listedAuthors = authors.map(author => ({ ...author, characterIds: author.characterIds.filter(id => isDzmmListedCharacter({ id })) }))
    .filter(author => author.characterIds.length > 0);
  assert.ok(searchDzmmAuthors(listedAuthors, "").every(author => author.characterIds.every(id => !retiredIds.has(id))));
});

test("original private and published cards remain discoverable and new-chat eligible without reopening retired imports", () => {
  const original = parseCharacterImport({ name: "原创地图员", description: "保存青桥镇旧地图的地图员。",
    personality: "认真核对路线。", scenario: "旅人来到地图馆。", firstMessage: "地图员铺开蓝色地图。", tags: ["原创"] }, "local-retirement-mapkeeper");
  const published: Character = { ...original, id: "published-retirement-mapkeeper", sourceKind: "public-summary",
    publication: { id: "published-retirement-mapkeeper", authorId: "fixture-author", revision: 1 } };
  const visible = [original, ...mergeDzmmSharedCatalog(DZMM_LISTED_CHARACTERS, DZMM_AI_CHARACTERS), published];
  assert.deepEqual(filterDzmmCharacters(visible, { query: "原创地图员" }).map(character => character.id), [original.id, published.id]);
  assert.equal(getDzmmNewConversationBlockReason(original), null);
  assert.equal(getDzmmNewConversationBlockReason(published), null);
  for (const character of retired) assert.ok(getDzmmNewConversationBlockReason(character));
  for (const character of DZMM_LISTED_CHARACTERS) assert.equal(getDzmmNewConversationBlockReason(character), null);
});

test("all retired roles retain saved conversation IDs, opening snapshots, messages and favorites without returning to discovery", () => {
  const conversations: DzmmSavedConversation[] = retired.map((character, index) => ({
    id: `retired-conversation-${index}`, characterId: character.id, title: `保存的地图馆记录 ${index}`,
    updatedAt: 1792022400000 + index,
    opening: { version: 1, kind: "opening", source: "template", messages: [{ role: "assistant", content: "地图馆的旧开场保持不变。" }] },
    messages: [{ id: `saved-opening-${index}`, role: "assistant", content: "地图馆的旧开场保持不变。" },
      { id: `saved-user-${index}`, role: "user", content: "请继续查看我选中的旧地图。" }],
  }));
  const saved = { ...DZMM_INITIAL_STATE, custom: [], conversations, favorites: [...retiredIds],
    preferences: { ...DZMM_INITIAL_STATE.preferences } };
  const before = JSON.stringify(saved);
  const restored = hydrateDzmmState(before);
  assert.deepEqual(restored.warnings, []);
  assert.deepEqual(restored.state.conversations, conversations);
  assert.deepEqual(restored.state.favorites, saved.favorites);
  const historyCharacters = mergeDzmmConversationCharacters(DZMM_LISTED_CHARACTERS);
  for (const character of retired) {
    assert.equal(historyCharacters.find(item => item.id === character.id), DZMM_CATALOG_CHARACTERS.find(item => item.id === character.id));
    const found = filterDzmmConversations(restored.state.conversations, historyCharacters, character.name);
    assert.ok(found.some(conversation => conversation.characterId === character.id));
  }
  assert.ok(DZMM_LISTED_CHARACTERS.every(character => !retiredIds.has(character.id)));
  assert.equal(JSON.stringify(saved), before);
});

test("history resolution prefers the current owned card and never mutates the public collection or archive", () => {
  const archived = retired[0];
  const current: Character = { ...archived, name: "当前账户中已确认的地图员", sourceKind: "original", promptOrigin: "original", catalogReadiness: undefined };
  const privateCard = parseCharacterImport({ name: "原创档案员", description: "整理镇上的公开地图。" }, "local-retirement-archivist");
  const before = JSON.stringify(DZMM_CATALOG_CHARACTERS);
  const history = mergeDzmmConversationCharacters([current, privateCard, ...DZMM_LISTED_CHARACTERS]);
  assert.equal(history.find(character => character.id === current.id), current);
  assert.equal(history.find(character => character.id === privateCard.id), privateCard);
  assert.equal(history.filter(character => character.id === current.id).length, 1);
  assert.equal(JSON.stringify(DZMM_CATALOG_CHARACTERS), before);
  assert.equal(DZMM_LISTED_CHARACTERS.length, 23);
});
