import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as catalogModule from "./dzmm-catalog";
import * as characterModule from "./dzmm-characters";
import * as conversationModule from "./dzmm-conversation-context";
import * as memoryModule from "./dzmm-memory-client";
import * as chatModule from "./dzmm-chat";
import type { Character } from "./dzmm-characters";
import type { DzmmSavedConversation } from "./dzmm-storage";

const { mergeDzmmSharedCatalog, getDzmmNewConversationBlockReason, DZMM_CHARACTER_CONTEXT_MISSING, DZMM_CHARACTER_UNLISTED } =
  ("default" in catalogModule ? catalogModule.default : catalogModule) as typeof import("./dzmm-catalog");
const { parseCharacterImport, DZMM_LISTED_CHARACTERS } =
  ("default" in characterModule ? characterModule.default : characterModule) as typeof import("./dzmm-characters");
const { captureDzmmConversationOpening, applyDzmmConversationOpening, restoreDzmmConversationContexts } =
  ("default" in conversationModule ? conversationModule.default : conversationModule) as typeof import("./dzmm-conversation-context");
const { prepareDzmmRememberedRequest } =
  ("default" in memoryModule ? memoryModule.default : memoryModule) as typeof import("./dzmm-memory-client");
const { buildDzmmPromptPlan, validateDzmmChatInput } =
  ("default" in chatModule ? chatModule.default : chatModule) as typeof import("./dzmm-chat");

type CatalogCard = Character & { catalogReadiness?: "metadata-only" | "public-context" | "full-card" };
const createdAt = "2026-10-15T00:00:00.000Z";
// Only the ID establishes that this ordinary fixture is currently listed. No real card text is read.
const listedId = DZMM_LISTED_CHARACTERS[0].id;

function card(id = "fixture-mapkeeper", readiness: CatalogCard["catalogReadiness"] = "public-context"): CatalogCard {
  return { ...parseCharacterImport({ name: "原创地图员", author: "原创测试作者", tags: ["原创", "探索"],
    description: "DESC_MAP：地图员保存着青桥镇的旧地图。", personality: "PERSON_MAP：认真核对路线，先听取旅人的选择。",
    scenario: "SCENE_MAP：旅人来到镇上的地图馆。", firstMessage: "OPEN_MAP：地图员把蓝色地图铺在桌上。",
    systemPrompt: "SYSTEM_MAP：根据已提供的信息描述地图馆。", postHistoryInstructions: "POST_MAP：等待旅人选择下一步。",
    messageExamples: "<START>\n{{user}}: EXAMPLE_MAP：哪里可以看地图？\n{{char}}: 请看靠窗的桌子。",
    alternateGreetings: ["ALT_MAP：地图员在庭院整理新路线。"], introduction: "DISPLAY_MAP：目录展示文字。",
    creatorNotes: "NOTES_MAP：仅供作者核对。", gallery: ["/dzmm/covers/placeholder.webp"],
    characterBook: { name: "原创地图馆", entries: [{ id: "map-rule", keys: [], constant: true, content: "BOOK_MAP：所有借出的地图都登记在蓝册中。" }] },
  }, id), sourceKind: "public-summary", promptOrigin: "public-verbatim", catalogReadiness: readiness,
  sourceUrl: `https://example.org/characters/${id}`, createdAt, heat: "未知", likes: "0" };
}

function metadata(id = "fixture-mapkeeper"): CatalogCard {
  return { ...card(id, "metadata-only"), description: "", personality: "", scenario: "", firstMessage: "",
    systemPrompt: undefined, postHistoryInstructions: undefined, messageExamples: undefined,
    alternateGreetings: undefined, characterBook: undefined, promptOrigin: "original" };
}

function conversation(character: Character): DzmmSavedConversation {
  const opening = captureDzmmConversationOpening(character);
  return { id: "fixture-conversation", characterId: character.id, title: "地图馆", updatedAt: 1234, opening,
    messages: [...opening.messages.map((message, index) => ({ ...message, id: `opening-${index}` })),
      { id: "question", role: "user", content: "USER_MAP：我想先看通往北桥的路线。" }] };
}

async function prepare(character: Character, saved: DzmmSavedConversation) {
  let fetches = 0;
  const prepared = await prepareDzmmRememberedRequest({ character: applyDzmmConversationOpening(character, saved),
    messages: saved.messages, model: "balanced", memoryFetch: async () => { fetches++; throw new Error("Network is forbidden in this fixture."); } });
  assert.equal(fetches, 0);
  assert.equal(prepared.summaryCalls, 0);
  return { ...prepared, plan: buildDzmmPromptPlan(validateDzmmChatInput(prepared.request)) };
}

test("new and fresh chats reject metadata-only cards while original imports and publications remain playable", () => {
  const missing = metadata(listedId);
  assert.equal(getDzmmNewConversationBlockReason(missing), DZMM_CHARACTER_CONTEXT_MISSING);
  assert.equal(getDzmmNewConversationBlockReason({ ...missing, sourceKind: "original" }), DZMM_CHARACTER_CONTEXT_MISSING);
  assert.equal(getDzmmNewConversationBlockReason({ ...card(listedId), catalogReadiness: undefined }), DZMM_CHARACTER_CONTEXT_MISSING);
  assert.equal(getDzmmNewConversationBlockReason({ ...card(listedId), promptOrigin: "unavailable" }), DZMM_CHARACTER_CONTEXT_MISSING);
  assert.equal(getDzmmNewConversationBlockReason(card(listedId)), null);
  assert.equal(getDzmmNewConversationBlockReason({ ...card(), sourceKind: "original", promptOrigin: "original" }), null);
  assert.equal(getDzmmNewConversationBlockReason({ ...card(), publication: { id: "fixture-publication", authorId: "fixture-author", revision: 1 } }), null);
  assert.equal(getDzmmNewConversationBlockReason(card("unlisted-original-fixture")), DZMM_CHARACTER_UNLISTED);
});

test("validated shared context upgrades a metadata card without dropping extended fields or mutating inputs", () => {
  const local = metadata();
  const remote = { ...card(), publicIntroductionSha256: createHash("sha256").update(card().description).digest("hex"),
    unexpectedPrivateField: "DO_NOT_COPY" };
  const before = JSON.stringify({ local, remote });
  const merged = mergeDzmmSharedCatalog([local], [remote]);
  assert.equal(merged.length, 1);
  for (const field of ["id", "name", "description", "personality", "scenario", "firstMessage", "systemPrompt", "postHistoryInstructions",
    "messageExamples", "alternateGreetings", "characterBook", "introduction", "creatorNotes", "gallery", "sourceUrl", "createdAt",
    "catalogReadiness", "publicIntroductionSha256"] as const) assert.deepEqual(merged[0][field], remote[field], field);
  assert.equal("unexpectedPrivateField" in merged[0], false);
  assert.notEqual(merged[0], remote);
  assert.notEqual(merged[0].characterBook, remote.characterBook);
  assert.equal(JSON.stringify({ local, remote }), before);
});

test("shared catalog ignores private cards, author drafts, publications and unlisted IDs even when marked complete", () => {
  const local = metadata();
  const invalid = [
    { ...card(), sourceKind: "original" }, { ...card(), publication: { id: "private", authorId: "private-author", revision: 1 } },
    { ...card(), publication: null }, { ...card(), authoringDraft: { private: true } }, card("not-in-current-catalog"),
  ];
  assert.deepEqual(mergeDzmmSharedCatalog([local], invalid), [local]);
  assert.equal(mergeDzmmSharedCatalog([local], invalid)[0], local);
});

test("metadata, unproven legacy templates and unavailable source data never replace a complete local card", () => {
  const local = card();
  for (const invalid of [metadata(), { ...card(), catalogReadiness: undefined }, { ...card(), catalogReadiness: "metadata-only" },
    { ...card(), promptOrigin: "unavailable" }, { ...card(), promptOrigin: "unknown" }]) {
    assert.equal(mergeDzmmSharedCatalog([local], [invalid])[0], local);
    assert.equal(mergeDzmmSharedCatalog([metadata()], [invalid])[0].description, "");
  }
});

test("display-only, malformed, credentialed and invalid public records cannot populate missing story context", () => {
  const local = metadata();
  const invalid = [
    { ...metadata(), catalogReadiness: "public-context" }, { ...card(), name: "" }, { ...card(), description: { text: "wrong" } },
    { ...card(), firstMessage: "invalid\0" }, { ...card(), createdAt: "not-a-date" }, { ...card(), sourceUrl: "javascript:alert(1)" },
    { ...card(), sourceUrl: "https://name:secret@example.org/character" }, { ...card(), publicIntroductionSha256: "wrong" },
    { ...card(), characterBook: { entries: [{ keys: [], content: "missing trigger" }] } }, null, [], "fixture", 1,
  ];
  for (const value of invalid) assert.equal(mergeDzmmSharedCatalog([local], [value])[0], local);
  for (const value of [null, undefined, {}, "not-an-array"]) assert.deepEqual(mergeDzmmSharedCatalog([local], value), [local]);
});

test("complete remote records are authoritative only at equal or greater readiness and keep catalog order", () => {
  const full = card("fixture-mapkeeper", "full-card");
  const second = card("fixture-librarian");
  const incoming = { ...card(), description: "NEW_DESC_MAP：新确认的地图馆设定。" };
  assert.equal(mergeDzmmSharedCatalog([full, second], [incoming])[0], full);
  const updated = mergeDzmmSharedCatalog([full, second], [{ ...incoming, catalogReadiness: "full-card" }]);
  assert.deepEqual(updated.map(character => character.id), [full.id, second.id]);
  assert.equal(updated[0].description, incoming.description);
  assert.equal(updated[1], second);
  const repeated = mergeDzmmSharedCatalog(updated, [{ ...incoming, catalogReadiness: "full-card" }]);
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated, updated);
});

test("recovered public context reaches the actual first model-request plan with its opening exactly once", async () => {
  const recovered = mergeDzmmSharedCatalog([metadata()], [card()])[0];
  const saved = conversation(recovered);
  const before = JSON.stringify({ recovered, saved });
  const { request, plan } = await prepare(recovered, saved);
  const prompt = JSON.stringify(plan.messages);
  for (const marker of ["DESC_MAP", "PERSON_MAP", "SCENE_MAP", "OPEN_MAP", "SYSTEM_MAP", "POST_MAP", "EXAMPLE_MAP", "BOOK_MAP", "USER_MAP"]) {
    assert.ok(prompt.includes(marker), `${marker} reaches the model plan`);
  }
  assert.equal(prompt.split("OPEN_MAP").length - 1, 1);
  assert.doesNotMatch(prompt, /DISPLAY_MAP|NOTES_MAP|ALT_MAP/);
  assert.ok(!request.character.firstMessage, "The saved opening is sent once through openingMessages.");
  assert.deepEqual(request.character.openingMessages, saved.opening?.messages);
  assert.equal(JSON.stringify({ recovered, saved }), before);
});

test("catalog recovery leaves an existing conversation's old opening unchanged while a new chat gets the new opening", async () => {
  const old = { ...card(), firstMessage: "OLD_OPEN_MAP：地图员在门口等候。" };
  const saved = conversation(old);
  const before = JSON.stringify(saved);
  const updated = mergeDzmmSharedCatalog([metadata()], [card()])[0];
  const restored = restoreDzmmConversationContexts([saved], [updated]);
  assert.equal(restored[0], saved);
  const { plan } = await prepare(updated, restored[0]);
  const turns = plan.messages.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source));
  assert.deepEqual(turns, saved.messages.map(({ role, content }) => ({ role, content })));
  assert.deepEqual(captureDzmmConversationOpening(updated).messages, [{ role: "assistant", content: updated.firstMessage }]);
  assert.notDeepEqual(captureDzmmConversationOpening(updated).messages, saved.opening?.messages);
  assert.equal(JSON.stringify(saved), before);
});

test("a saved metadata-card conversation and explicitly deleted opening retain their own history when resumed", async () => {
  const missing = metadata(listedId);
  const saved = conversation({ ...card(listedId), firstMessage: "SAVED_OPEN_MAP：我们已在旧地图馆见过。" });
  assert.equal(getDzmmNewConversationBlockReason(missing), DZMM_CHARACTER_CONTEXT_MISSING);
  const restored = restoreDzmmConversationContexts([saved], [missing]);
  assert.equal(restored[0], saved);
  const { plan } = await prepare(missing, saved);
  assert.ok(JSON.stringify(plan.messages).includes("SAVED_OPEN_MAP"));
  const deleted: DzmmSavedConversation = { ...saved, messages: [], opening: { version: 1, kind: "opening", source: "history", messages: [] } };
  assert.equal(restoreDzmmConversationContexts([deleted], [card(listedId)])[0], deleted);
  assert.deepEqual(applyDzmmConversationOpening(card(listedId), deleted).openingMessages, []);
});
