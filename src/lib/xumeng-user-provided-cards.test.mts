import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as suppliedModule from "./xumeng-user-provided-cards";
import * as characterModule from "./dzmm-characters";
import * as exportedModule from "./xumeng-exported-cards";
import * as catalogModule from "./dzmm-catalog";
import * as openingModule from "./dzmm-conversation-context";
import * as storageModule from "./dzmm-storage";
import * as contextModule from "./dzmm-context";
import * as chatModule from "./dzmm-chat";
import * as characterContextModule from "./dzmm-character-context";
import type { DzmmSavedConversation } from "./dzmm-storage";
const { XUMENG_USER_PROVIDED_CARD_RECORDS: records } = ("default" in suppliedModule ? suppliedModule.default : suppliedModule) as typeof import("./xumeng-user-provided-cards");
const { DZMM_USER_PROVIDED_FULL_CHARACTERS: cards, DZMM_LISTED_CHARACTERS, exportCharacterJson, parseCharacterImport } = ("default" in characterModule ? characterModule.default : characterModule) as typeof import("./dzmm-characters");
const { getXumengExportedCardMetadata } = ("default" in exportedModule ? exportedModule.default : exportedModule) as typeof import("./xumeng-exported-cards");
const { getDzmmNewConversationBlockReason, mergeDzmmSharedCatalog } = ("default" in catalogModule ? catalogModule.default : catalogModule) as typeof import("./dzmm-catalog");
const { captureDzmmConversationOpening, applyDzmmConversationOpening } = ("default" in openingModule ? openingModule.default : openingModule) as typeof import("./dzmm-conversation-context");
const { DZMM_INITIAL_STATE, hydrateDzmmState } = ("default" in storageModule ? storageModule.default : storageModule) as typeof import("./dzmm-storage");
const { prepareDzmmRequest } = ("default" in contextModule ? contextModule.default : contextModule) as typeof import("./dzmm-context");
const { buildDzmmPromptPlan, validateDzmmChatInput } = ("default" in chatModule ? chatModule.default : chatModule) as typeof import("./dzmm-chat");
const { getDzmmOpeningMessages } = ("default" in characterContextModule ? characterContextModule.default : characterContextModule) as typeof import("./dzmm-character-context");

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const fingerprint = (value: unknown) => hash(JSON.stringify(canonical(value)) ?? "undefined");
const equal = (actual: unknown, expected: unknown, label: string) => assert.equal(fingerprint(actual), fingerprint(expected), label);
const root = new URL("../../public/dzmm/user-cards/", import.meta.url);

test("the user-supplied original manifest contains exactly the approved JSON and PNG pairs", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.provenance, "user-provided");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.batch, "20261024");
  const expected = records.flatMap(record => [
    { path: `20261024/${record.slug}.json`, bytes: record.jsonBytes, sha256: record.sha256 },
    { path: `20261024/${record.slug}.png`, bytes: record.pngBytes, sha256: record.pngSha256 },
  ]).sort((a, b) => a.path.localeCompare(b.path));
  equal([...manifest.files].sort((a, b) => a.path.localeCompare(b.path)), expected, "no unselected archive files");
  for (const file of expected) {
    const bytes = readFileSync(new URL(file.path, root));
    assert.equal(bytes.length, file.bytes, "original byte length");
    assert.equal(hash(bytes), file.sha256, "original file hash");
  }
});

test("approved runtime cards retain original prose, worldbook fields and every opening without invented source claims", () => {
  assert.equal(cards.length, records.length);
  for (const record of records) {
    const original = JSON.parse(readFileSync(new URL(`20261024/${record.slug}.json`, root), "utf8"));
    // A null book means no worldbook. This is the sole schema normalization;
    // the downloadable source remains byte-for-byte unchanged.
    if (original.data?.character_book === null) delete original.data.character_book;
    equal(record.card, original, "complete source structure retained in runtime manifest");
    const source = parseCharacterImport(original, record.id), card = cards.find(item => item.id === record.id)!;
    assert.ok(card);
    for (const field of ["name", "description", "personality", "scenario", "firstMessage", "systemPrompt", "postHistoryInstructions", "messageExamples", "creatorNotes", "alternateGreetings", "openingMessages", "characterBook", "tags"] as const)
      equal(card[field], source[field], `source field ${field}`);
    const metadata = getXumengExportedCardMetadata(card)!;
    assert.equal(metadata.provenanceKind, "user-provided");
    assert.equal(metadata.sourceUrl, "");
    assert.equal(metadata.licenseUrl, "");
    assert.equal(metadata.licenseName, "许可未核验");
    assert.equal(metadata.pngDownloadUrl, record.pngDownloadUrl);
    assert.equal(card.cover, record.coverUrl);
    assert.equal(getDzmmNewConversationBlockReason(card), null);
    assert.ok(DZMM_LISTED_CHARACTERS.some(item => item.id === card.id));
    assert.equal(getXumengExportedCardMetadata({ ...card, sourceKind: "original" }), undefined);
    equal(mergeDzmmSharedCatalog([card], [{ ...card, description: "forged", sourceUrl: "https://invalid.test/" }]), [card], "remote response cannot replace supplied source");
    const compatible = JSON.parse(exportCharacterJson(card));
    assert.match(compatible.creator_notes, /用户提供；许可未核验/);
    assert.ok(compatible.creator_notes.includes(record.downloadUrl));
    assert.ok(compatible.creator_notes.includes(record.pngDownloadUrl));
    const restored = parseCharacterImport(compatible);
    for (const field of ["description", "personality", "scenario", "firstMessage", "characterBook", "alternateGreetings", "systemPrompt", "postHistoryInstructions", "messageExamples", "creatorNotes"] as const)
      equal(restored[field], card[field], `compatible export ${field}`);
  }
});

test("every supplied primary and alternate opening assembles locally and survives a saved-state round trip", () => {
  for (const card of cards) {
    const primary = getDzmmOpeningMessages({ ...card, alternateGreetings: [] });
    const indices = [...(primary.length ? [0] : []), ...(card.alternateGreetings ?? []).map((_, index) => index + 1)];
    if (!primary.length) equal(captureDzmmConversationOpening(card), captureDzmmConversationOpening(card, indices[0]), "empty main greeting uses the first original alternate");
    for (const index of indices) {
    const opening = captureDzmmConversationOpening(card, index);
    assert.ok(opening.messages.some(message => message.role === "assistant" && message.content.trim()), "playable assistant opening");
    const conversation: DzmmSavedConversation = { id: `check-${card.id}-${index}`, characterId: card.id, title: "本地原卡保真检查", updatedAt: 1,
      opening, messages: [...opening.messages.map((message, i) => ({ ...message, id: `opening-${i}` })), { id: "original-user", role: "user", content: "我先看看周围。" }] };
    const request = prepareDzmmRequest(applyDzmmConversationOpening(card, conversation), conversation.messages, undefined, undefined, "balanced", 1024, { userName: "本地访客" });
    const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
    assert.ok(plan.messages.length);
    equal(request.character.openingMessages, opening.messages, "selected opening retained in prompt request");
    const hydrated = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, conversations: [conversation], favorites: [card.id] }));
    assert.equal(hydrated.warnings.length, 0);
    equal(hydrated.state.conversations[0], conversation, "saved opening and messages survive reload");
    }
  }
});
