import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as exportedModule from "./xumeng-exported-cards";
import * as characterModule from "./dzmm-characters";
import * as catalogModule from "./dzmm-catalog";
import * as conversationModule from "./dzmm-conversation-context";
import * as storageModule from "./dzmm-storage";
import * as homepageStatsModule from "./xumeng-homepage-stats";
import type { Character } from "./dzmm-characters";
import type { DzmmSavedConversation } from "./dzmm-storage";

const { XUMENG_EXPORTED_CARD_RECORDS, getXumengExportedCardMetadata } =
  ("default" in exportedModule ? exportedModule.default : exportedModule) as typeof import("./xumeng-exported-cards");
const { DZMM_AI_CHARACTERS, DZMM_EXPORTED_FULL_CHARACTERS, DZMM_CATALOG_CHARACTERS,
  DZMM_LISTED_CHARACTERS, isDzmmListedCharacter, exportCharacterJson, parseCharacterImport } =
  ("default" in characterModule ? characterModule.default : characterModule) as typeof import("./dzmm-characters");
const { mergeDzmmSharedCatalog, getDzmmNewConversationBlockReason } =
  ("default" in catalogModule ? catalogModule.default : catalogModule) as typeof import("./dzmm-catalog");
const { captureDzmmConversationOpening } =
  ("default" in conversationModule ? conversationModule.default : conversationModule) as typeof import("./dzmm-conversation-context");
const { DZMM_INITIAL_STATE, hydrateDzmmState } =
  ("default" in storageModule ? storageModule.default : storageModule) as typeof import("./dzmm-storage");
const { xumengHomepageStat } =
  ("default" in homepageStatsModule ? homepageStatsModule.default : homepageStatsModule) as typeof import("./xumeng-homepage-stats");

const SOURCE_COMMIT = "dab0da437810b2ea4b5eec414c10c8fa35e779f8";
const SOURCE_REPOSITORY = "https://github.com/foreverse-app/character-card-skills";
const LICENSE_URL = `${SOURCE_REPOSITORY}/blob/${SOURCE_COMMIT}/LICENSE-CONTENT`;
const SOURCE_AUTHOR = "Foreverse Team (foreverse.app)";
const SOURCE_HASHES = {
  peiyu: "7dd714fdd35d4f479b91540700b25628cf518768b50222309e14722b56e2756a",
  tangtuantuan: "e4338fd4941f07857447f50b349568d3d001e07e024bde889c29672528d71d34",
  wangushi: "6bf91f72bddd973191b3953560059a89383a823215f4aea8710b3652387cf3a9",
  shenyan: "43842967b7d93bef5e7e8b18df02370e9327fb7f232297d981c8985438430a7c",
  huoyushen: "872bb81fb07273c7487cd2dd14c5b71d694048a12a676c286ed800bf39ee229b",
  jiwenqing: "6abc3b7a08cf82c9eb5a78b0322f471840dc31932410105de997e1ce8d784ce3",
  naifuer: "20c61ec2cf36462f69cecb002a2fa8b7dab31f6e450103cb2f1b710faac095ee",
  songzhixia: "ee3319fd0387d11cdabd1335f559514572af2c1953a8b748622893fb36ea8571",
  jiangchiye: "37b81f31102af1eeea6a464163d2256019307ab1b05bd83615e9dbb21fea198a",
  sunianzhi: "3f09b432271db35f89d84bdb9388fe8edfe53c1693b21b7fc8e04387a251a52c",
  xuanjing: "65587996b1087bf946f1a3e9874d6d17f820526f9bb667c58528d949dbedf4a2",
  "nie-xiaoqian": "5a6a3574edb1cef1099842175571d13a6834f06e1508c03e41eb6fb7aa4701a3",
  caleb: "cc6a6a66f2fe8e6e396e22eab4b4f9b3bb8b545c0891b9382e32e1f253c55d09",
  "edmund-harrower": "70c96d304edde86c27e68b2ccee40be799ae6e1036bae5a70a97c0843130930c",
  "frankie-doyle": "0798ae866eed8bd637a3e0e764ef166edb780f21379621f49c90bda0af54e210",
  "redline-salvage": "fde4d3d2f68a025cca1c87e5f9961ab178914d61a161f98dac1098714fb06c15",
  rosalind: "f530d2f7d3ad042fab235e78e918c77cbe5c726764bac15a832bec9a96247d86",
  "the-lighthouse": "61b9eb8e932f7d61d5e27a727832307136438460ba0e509ee8e0914ec67d6e5c",
} as const;
type Slug = keyof typeof SOURCE_HASHES;
const CARD_LANGUAGE: Record<Slug, "zh" | "en"> = {
  peiyu: "zh", tangtuantuan: "zh", wangushi: "zh", shenyan: "zh",
  huoyushen: "zh", jiwenqing: "zh", naifuer: "zh", songzhixia: "zh",
  jiangchiye: "zh", sunianzhi: "zh", xuanjing: "zh", "nie-xiaoqian": "zh",
  caleb: "en", "edmund-harrower": "en", "frankie-doyle": "en", "redline-salvage": "en", rosalind: "en", "the-lighthouse": "en",
};
const slugs = Object.keys(SOURCE_HASHES) as Slug[];
const expectedIds = slugs.map(slug => `xumeng-foreverse-${slug}`);
const researchDirectory = new URL("../../output/xumeng/iteration/exportable-cards-20261021/research/", import.meta.url);

type SourceEntry = {
  id: string | number; comment?: string; keys: string[]; secondary_keys?: string[]; content: string;
  enabled?: boolean; constant?: boolean; selective?: boolean; case_sensitive?: boolean;
  insertion_order?: number; position?: "before_char" | "after_char"; extensions?: unknown;
};
type SourceCard = {
  spec: string; spec_version: string;
  data: {
    name: string; description: string; personality: string; scenario: string; first_mes: string;
    mes_example: string; system_prompt: string; post_history_instructions: string; creator_notes: string;
    alternate_greetings: string[]; tags: string[]; creator: string; character_version: string;
    extensions: unknown; character_book: { name: string; entries: SourceEntry[]; extensions?: unknown };
  };
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
// Compare complete values while keeping all source prose out of assertion output.
function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(canonical(value)) ?? "undefined");
}
function assertSameContent(actual: unknown, expected: unknown, label: string): void {
  assert.equal(fingerprint(actual), fingerprint(expected), label);
}
function sourceBytes(slug: Slug): Buffer {
  return readFileSync(new URL(`foreverse-${slug}.v2.json`, researchDirectory));
}
function sourceCard(slug: Slug): SourceCard {
  return JSON.parse(sourceBytes(slug).toString("utf8")) as SourceCard;
}
function fullCharacter(slug: Slug): Character {
  const character = DZMM_EXPORTED_FULL_CHARACTERS.find(item => item.id === `xumeng-foreverse-${slug}`);
  assert.ok(character, `${slug}: exported character exists`);
  return character;
}

test("downloaded v2 originals reimport with their creator attribution", () => {
  for (const slug of slugs) {
    const source = sourceCard(slug);
    const imported = parseCharacterImport(sourceBytes(slug).toString("utf8"));
    assert.equal(imported.author, source.data.creator);
    assertSameContent(imported.characterBook?.entries.map(entry => entry.content), source.data.character_book.entries.map(entry => entry.content), `${slug}: original worldbook`);
  }
});

test("eighteen original exports join five public backgrounds without changing the sixty-card archive or relisting retired placeholders", () => {
  assert.equal(DZMM_EXPORTED_FULL_CHARACTERS.length, 18);
  assert.deepEqual(DZMM_EXPORTED_FULL_CHARACTERS.map(card => card.id).sort(), [...expectedIds].sort());
  assert.equal(DZMM_LISTED_CHARACTERS.length, 23);
  assert.equal(new Set(DZMM_LISTED_CHARACTERS.map(card => card.id)).size, 23);
  assert.equal(DZMM_LISTED_CHARACTERS.filter(card => card.catalogReadiness === "full-card").length, 18);
  assert.equal(DZMM_LISTED_CHARACTERS.filter(card => card.catalogReadiness === "public-context").length, 5);

  const metadataBytes = readFileSync(new URL("./dzmm-ai-metadata-2026-10-14.json", import.meta.url));
  const contextBytes = readFileSync(new URL("./dzmm-public-context-2026-10-15.json", import.meta.url));
  assert.equal(sha256(metadataBytes), "b4384925570fabc6b4392ae4e1226020655d7edf2b598d7637e01548c0b08a15");
  assert.equal(sha256(contextBytes), "6fcf8eb37cd6d9ac3ad64bea3684a1c5004f7fe0cf714809fbcfc4cdbff0ed7f");
  const metadata = JSON.parse(metadataBytes.toString("utf8")) as { records: { id: string | number; title: string; author: string }[] };
  const contexts = JSON.parse(contextBytes.toString("utf8")) as { characters: { id: string; description: string; firstMessage?: string }[] };
  const byId = new Map(contexts.characters.map(card => [card.id, card]));
  assert.equal(DZMM_AI_CHARACTERS.length, 60);
  assert.deepEqual(DZMM_AI_CHARACTERS.map(card => card.id), metadata.records.map(record => String(record.id)));
  assert.equal(DZMM_AI_CHARACTERS.filter(card => card.catalogReadiness === "metadata-only").length, 55);
  for (const [index, card] of DZMM_AI_CHARACTERS.entries()) {
    const source = metadata.records[index], context = byId.get(card.id);
    assertSameContent(card.name, source.title.trim() || `公开角色 ${source.id}`, `${card.id}: historical name`);
    assertSameContent(card.author, source.author.trim() || "匿名创作者", `${card.id}: historical author`);
    assertSameContent(card.description, context?.description ?? "", `${card.id}: historical description`);
    assertSameContent(card.firstMessage, context?.firstMessage ?? "", `${card.id}: historical opening`);
    assertSameContent([card.personality, card.scenario], ["", ""], `${card.id}: no invented setting`);
    assert.equal(card.catalogReadiness, context ? "public-context" : "metadata-only");
    assert.equal(card.promptOrigin, context ? "public-verbatim" : "unavailable");
    assert.equal(isDzmmListedCharacter(card), Boolean(context));
    assert.equal(DZMM_CATALOG_CHARACTERS.filter(archived => archived.id === card.id).length, 1);
    if (!context) assert.equal(typeof getDzmmNewConversationBlockReason(card), "string");
  }
});

test("only the eighteen selected source exports are embedded intact, including all unknown and nested extension fields", () => {
  assert.equal(XUMENG_EXPORTED_CARD_RECORDS.length, 18);
  assert.deepEqual(XUMENG_EXPORTED_CARD_RECORDS.map(record => record.slug).sort(), [...slugs].sort());
  assert.deepEqual(XUMENG_EXPORTED_CARD_RECORDS.map(record => record.id).sort(), [...expectedIds].sort());
  for (const slug of slugs) {
    const record = XUMENG_EXPORTED_CARD_RECORDS.find(item => item.slug === slug);
    assert.ok(record, `${slug}: source record exists`);
    assert.equal(sha256(sourceBytes(slug)), SOURCE_HASHES[slug], `${slug}: independently captured file bytes`);
    assert.equal(record.sha256, SOURCE_HASHES[slug], `${slug}: advertised file checksum`);
    assertSameContent(record.card, sourceCard(slug), `${slug}: complete original JSON structure`);
    assert.equal(record.card.spec, "chara_card_v2");
    assert.equal(record.card.spec_version, "2.0");
  }
});

test("runtime full cards preserve all supported source text, author identity and worldbook entry order and placement", () => {
  const fields = [
    ["name", "name"], ["description", "description"], ["personality", "personality"], ["scenario", "scenario"],
    ["firstMessage", "first_mes"], ["messageExamples", "mes_example"], ["systemPrompt", "system_prompt"],
    ["postHistoryInstructions", "post_history_instructions"], ["creatorNotes", "creator_notes"],
    ["alternateGreetings", "alternate_greetings"], ["tags", "tags"],
  ] as const;
  for (const slug of slugs) {
    const character = fullCharacter(slug), source = sourceCard(slug).data;
    for (const [runtimeField, sourceField] of fields)
      assertSameContent(character[runtimeField], source[sourceField], `${slug}: ${runtimeField}`);
    assert.equal(character.author, SOURCE_AUTHOR);
    assert.equal(character.author, source.creator);
    assert.equal(character.cover, `/dzmm/exported-cards/foreverse-${slug}-cover.png`);
    assert.equal(character.heat, xumengHomepageStat(character.id)?.heat);
    assert.equal(character.likes, xumengHomepageStat(character.id)?.likes);
    assert.equal(character.sourceKind, "public-summary");
    assert.equal(character.promptOrigin, "public-verbatim");
    assert.equal(character.catalogReadiness, "full-card");
    assert.equal(isDzmmListedCharacter(character), true);
    assert.equal(getDzmmNewConversationBlockReason(character), null);
    assertSameContent(character.characterBook?.name, source.character_book.name, `${slug}: worldbook name`);
    assert.equal(character.characterBook?.entries.length, source.character_book.entries.length);
    const expectedEntries = source.character_book.entries.map(entry => ({
      id: String(entry.id), name: entry.comment, keys: entry.keys, secondaryKeys: entry.secondary_keys,
      content: entry.content, enabled: entry.enabled, constant: entry.constant, selective: entry.selective,
      caseSensitive: entry.case_sensitive, insertionOrder: entry.insertion_order, position: entry.position,
    }));
    assertSameContent(character.characterBook?.entries, expectedEntries, `${slug}: every worldbook field in source order`);
  }
});

test("download and license metadata are pinned to the captured commit and cannot be forged by supplied card fields", () => {
  for (const slug of slugs) {
    const character = fullCharacter(slug), metadata = getXumengExportedCardMetadata(character);
    assert.ok(metadata, `${slug}: public metadata exists`);
    assert.equal(metadata.id, character.id);
    assert.equal(metadata.slug, slug);
    assert.equal(metadata.sourceCommit, SOURCE_COMMIT);
    assert.equal(metadata.sourceUrl, `${SOURCE_REPOSITORY}/blob/${SOURCE_COMMIT}/cards/${CARD_LANGUAGE[slug]}/${slug}/${slug}.v2.json`);
    assert.equal(metadata.downloadUrl, `/assets/xumeng/exported-cards/foreverse-${slug}.v2.json`);
    assert.equal(metadata.sha256, SOURCE_HASHES[slug]);
    assert.equal(metadata.author, SOURCE_AUTHOR);
    assert.equal(metadata.attribution, SOURCE_AUTHOR);
    assert.equal(metadata.licenseName, "CC BY 4.0");
    assert.equal(metadata.licenseUrl, LICENSE_URL);
    assert.equal(metadata.version, sourceCard(slug).data.character_version);
    assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));
    assert.ok(metadata.changes.length > 0);
    assert.equal(Object.hasOwn(metadata, "card"), false, `${slug}: download metadata excludes source prose`);
    const forged = { ...character, sourceUrl: "https://example.invalid/forged-source",
      downloadUrl: "javascript:forged()", licenseUrl: "https://example.invalid/forged-license",
      licenseName: "forged", sourceCommit: "forged", attribution: "forged", sha256: "forged" };
    assertSameContent(getXumengExportedCardMetadata(forged), metadata, `${slug}: only trusted manifest metadata is returned`);
    for (const invalid of [
      { ...character, sourceKind: "original", promptOrigin: "original" },
      { ...character, id: "local-copy-of-an-export" },
      { ...character, id: "xumeng-foreverse-not-imported" },
      { ...character, id: "xumeng-foreverse-unknown" },
      { ...character, catalogReadiness: "public-context" },
      { ...character, promptOrigin: "unavailable" },
      { ...character, publication: { id: "published-fixture", authorId: "fixture", revision: 1 } },
      { ...character, publication: null },
      { ...character, authoringDraft: { version: 1 } },
    ]) assert.equal(Boolean(getXumengExportedCardMetadata(invalid)), false, `${slug}: private, unknown or ineligible card rejected`);
  }
  for (const character of DZMM_AI_CHARACTERS)
    assert.equal(Boolean(getXumengExportedCardMetadata(character)), false, "historical catalog cards have no original-export claim");
});

test("compatible exports preserve author notes and runtime fields while disclosing attribution, license and adaptation", () => {
  for (const slug of slugs) {
    const character = fullCharacter(slug), metadata = getXumengExportedCardMetadata(character)!;
    const before = fingerprint(character), exported = JSON.parse(exportCharacterJson(character));
    assertSameContent(exported.creatorNotes, sourceCard(slug).data.creator_notes, `${slug}: original author notes`);
    const notes = exported.creator_notes;
    assert.equal(typeof notes, "string");
    for (const value of [metadata.attribution, metadata.licenseName, metadata.licenseUrl,
      metadata.sourceUrl, metadata.downloadUrl, metadata.changes])
      assert.equal(notes.includes(value), true, `${slug}: provenance remains in compatible export`);
    assert.equal(/公开页面的渲染结果|本次预览|不代表原始模板/.test(notes), false, `${slug}: no public-preview provenance claim`);
    assert.equal(/兼容格式|适配/.test(notes), true, `${slug}: export identifies its adaptation`);
    const reimported = parseCharacterImport(exported, `local-roundtrip-${slug}`);
    for (const field of ["name", "author", "description", "personality", "scenario", "firstMessage", "messageExamples",
      "systemPrompt", "postHistoryInstructions", "creatorNotes", "alternateGreetings", "characterBook"] as const)
      assertSameContent(reimported[field], character[field], `${slug}: compatible roundtrip ${field}`);
    assert.equal(Boolean(getXumengExportedCardMetadata(reimported)), false, `${slug}: private import has no original-source download claim`);
    assert.equal(fingerprint(character), before, `${slug}: export does not mutate the source card`);
  }
});

test("shared catalog responses cannot replace pinned full-card text, provenance, or popularity with fabricated values", () => {
  const localBefore = fingerprint(DZMM_LISTED_CHARACTERS);
  const remote = DZMM_EXPORTED_FULL_CHARACTERS.map(character => ({
    ...character, description: "FIXTURE_REPLACEMENT", firstMessage: "FIXTURE_OPENING", author: "FIXTURE_AUTHOR",
    creatorNotes: "FIXTURE_NOTES", characterBook: { entries: [{ keys: [], constant: true, content: "FIXTURE_BOOK" }] },
    sourceUrl: "https://example.invalid/forged-source", heat: "999999", likes: "888888", siteLikeCount: 777777, siteLiked: true,
  }));
  const remoteBefore = fingerprint(remote);
  const merged = mergeDzmmSharedCatalog(DZMM_LISTED_CHARACTERS, remote);
  assert.deepEqual(merged.map(card => card.id), DZMM_LISTED_CHARACTERS.map(card => card.id));
  for (const slug of slugs) {
    const expected = fullCharacter(slug), actual = merged.find(card => card.id === expected.id);
    assertSameContent(actual, expected, `${slug}: authoritative local card remains unchanged`);
    assert.equal(actual?.likes, xumengHomepageStat(expected.id)?.likes);
    assert.equal(actual?.heat, xumengHomepageStat(expected.id)?.heat);
  }
  assert.equal(fingerprint(DZMM_LISTED_CHARACTERS), localBefore, "shared merge does not mutate bundled cards");
  assert.equal(fingerprint(remote), remoteBefore, "shared merge does not mutate its response");
});

test("all eighteen full cards retain primary and alternate opening conversations and favorites through state hydration", () => {
  const charactersBefore = fingerprint(DZMM_EXPORTED_FULL_CHARACTERS);
  const conversations: DzmmSavedConversation[] = slugs.flatMap((slug, characterIndex) => {
    const character = fullCharacter(slug);
    assert.ok(character.alternateGreetings?.length, `${slug}: a source alternate opening exists`);
    return [0, 1].map(openingIndex => {
      const opening = captureDzmmConversationOpening(character, openingIndex);
      assert.equal(opening.kind, "opening", `${slug}/${openingIndex}: authored opening is selected`);
      assert.ok(opening.messages.length > 0, `${slug}/${openingIndex}: opening contains messages`);
      return {
        id: `export-hydration-${slug}-${openingIndex}`,
        characterId: character.id,
        title: `保存的开场 ${characterIndex + 1}/${openingIndex}`,
        updatedAt: 1792108800000 + characterIndex * 2 + openingIndex,
        opening,
        messages: opening.messages.map((message, messageIndex) => ({
          ...message, id: `export-opening-${slug}-${openingIndex}-${messageIndex}`,
        })),
      };
    });
  });
  assert.equal(conversations.length, 36);
  const saved = {
    ...DZMM_INITIAL_STATE, custom: [], conversations, favorites: [...expectedIds],
    preferences: { ...DZMM_INITIAL_STATE.preferences },
  };
  const savedBefore = fingerprint(saved);
  const restored = hydrateDzmmState(JSON.stringify(saved));
  assertSameContent(restored.warnings, [], "all thirty-six opening records hydrate without warnings");
  assert.equal(restored.state.conversations.length, 36);
  assertSameContent(restored.state.favorites, saved.favorites, "all eighteen full-card favorites survive");
  assertSameContent(restored.state.conversations, conversations, "all thirty-six saved conversations survive unchanged");
  for (const expected of conversations) {
    const actual = restored.state.conversations.find(item => item.id === expected.id);
    assert.ok(actual, `${expected.id}: saved conversation exists`);
    assert.equal(actual.characterId, expected.characterId, `${expected.id}: character ID survives`);
    assertSameContent(actual.messages, expected.messages, `${expected.id}: message IDs and content survive`);
    assertSameContent(actual.opening, expected.opening, `${expected.id}: selected opening snapshot survives`);
  }
  assert.equal(fingerprint(saved), savedBefore, "hydration does not mutate its source state");
  assert.equal(fingerprint(DZMM_EXPORTED_FULL_CHARACTERS), charactersBefore, "hydration does not mutate the full cards");
});
