import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import characterModule from "./dzmm-characters";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import storageModule from "./dzmm-storage";

const {
  DZMM_CHARACTERS,
  DEFAULT_DZMM_CHARACTER_COVER,
  DZMM_ORIGINAL_CHARACTERS,
  DZMM_SOURCE_NOTE,
  parseCharacterImport,
  parseCharacterDraftImport,
  parsePrivateCharacter,
  decodeDzmmCharacterImportBytes,
  exportCharacterDraftJson,
  exportCharacterJson,
} = characterModule as typeof import("./dzmm-characters");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { buildDzmmPromptPlan, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { DZMM_INITIAL_STATE, hydrateDzmmState } = storageModule as typeof import("./dzmm-storage");

test("strict role file bytes preserve UTF-8 BOM, newlines, emoji and literal replacement characters", () => {
  const notes = "  原创备注\r\n合法字面字符：\uFFFD 🌱\n  ";
  const payload = "\uFEFF  \r\n" + JSON.stringify({ name: "原创字节角色", description: "港口修钟师\r\n等待旅人 🌱 \uFFFD", creatorNotes: notes }) + "\r\n ";
  const bytes = new TextEncoder().encode(payload);
  assert.equal(decodeDzmmCharacterImportBytes(bytes), payload);
  assert.equal(decodeDzmmCharacterImportBytes(bytes.buffer), payload);
  for (const parse of [parseCharacterImport, parseCharacterDraftImport]) {
    const card = parse(decodeDzmmCharacterImportBytes(bytes), "utf8-card");
    assert.equal(card.description, "港口修钟师\r\n等待旅人 🌱 \uFFFD");
    assert.equal(card.creatorNotes, notes);
    assert.equal(parseCharacterImport(exportCharacterJson(card)).creatorNotes, notes);
  }
});

test("strict byte import preserves incomplete private worldbook text and keeps structural validation", () => {
  const authored = { version: 1, characterBook: { name: "原创潮汐记录", entries: [{ id: "unfinished", name: "待补词条", content: "  原创未完成线索\r\n🌱 \uFFFD  ", keysText: "", secondaryText: "" }] } };
  const card = parsePrivateCharacter({ name: "原创修钟师", description: "核对钟摆。", authoringDraft: authored }, "private-byte-card");
  const bytes = new TextEncoder().encode("\uFEFF" + exportCharacterDraftJson(card));
  const restored = parseCharacterDraftImport(decodeDzmmCharacterImportBytes(bytes), "independent-import");
  assert.deepEqual(restored.authoringDraft, authored);
  assert.throws(() => parseCharacterImport({ name: restored.name, characterBook: authored.characterBook }), /世界书/);
  assert.throws(() => parseCharacterDraftImport(decodeDzmmCharacterImportBytes(new TextEncoder().encode(JSON.stringify({ spec: "xumeng_authoring_draft_v1", data: { character: { name: "坏结构" }, authoringDraft: { ...authored, characterBook: { entries: [{ content: 42, keysText: "", secondaryText: "" }] } } } })))), /私人创作草稿/);
});

test("GBK and malformed UTF-8 role JSON bytes reject before lossy parsing", () => {
  const encoder = new TextEncoder();
  const prefix = encoder.encode('{"name":"original","description":"');
  const suffix = encoder.encode('"}');
  for (const bad of [
    [0xd4, 0xad, 0xb4, 0xb4], // Own GBK encoding of 原创.
    [0xe4, 0xb8], [0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
  ]) {
    const bytes = Uint8Array.from([...prefix, ...bad, ...suffix]);
    assert.throws(() => parseCharacterDraftImport(decodeDzmmCharacterImportBytes(bytes)), /文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。/);
    assert.throws(() => parseCharacterImport(decodeDzmmCharacterImportBytes(bytes)), /文件不是有效的 UTF-8 文本/);
  }
});

test("role import byte bounds apply to the exact view before decoding without truncation", () => {
  const payload = '{"name":"original-byte-limit"}';
  const bytes = new TextEncoder().encode(payload);
  const framed = Uint8Array.from([0xff, ...bytes, 0xff]);
  assert.equal(decodeDzmmCharacterImportBytes(framed.subarray(1, framed.length - 1)), payload);
  const atLimit = new Uint8Array(256 * 1024).fill(0x20);
  atLimit.set(bytes);
  assert.equal(decodeDzmmCharacterImportBytes(atLimit).length, atLimit.length);
  assert.equal(parseCharacterDraftImport(decodeDzmmCharacterImportBytes(atLimit)).name, "original-byte-limit");
  const excess = new Uint8Array(256 * 1024 + 1).fill(0xff);
  assert.throws(() => decodeDzmmCharacterImportBytes(excess), /角色卡文件不能超过 256 KB/);
  assert.throws(() => parseCharacterDraftImport(payload + " ".repeat(256 * 1024)), /256 KB/);
  assert.throws(() => parseCharacterImport("\uFEFF\uFEFF" + payload), /有效的 JSON/);
});

test("SillyTavern v2 imports preserve role fields without treating notes as a prompt", () => {
  const card = parseCharacterImport(
    {
      spec: "chara_card_v2",
      data: {
        name: "林间旅人",
        description: "在森林里寻找旧地图。",
        personality: "沉着、好奇。",
        scenario: "一座雨后的驿站。",
        first_mes: "你也在寻找那张地图吗？",
        creator_notes: "这是作者备注，不是角色指令。",
        tags: ["奇幻", "探索"],
      },
    },
    "import-v2",
  );

  assert.equal(card.id, "import-v2");
  assert.equal(card.name, "林间旅人");
  assert.equal(card.description, "在森林里寻找旧地图。");
  assert.equal(card.personality, "沉着、好奇。");
  assert.equal(card.scenario, "一座雨后的驿站。");
  assert.equal(card.firstMessage, "你也在寻找那张地图吗？");
  assert.deepEqual(card.tags, ["奇幻", "探索"]);
  assert.equal(card.sourceKind, "original");
  assert.equal(card.promptOrigin, "original");
  assert.equal(card.sourceUrl, "");
  assert.equal("creator_notes" in card, false);
  assert.equal(card.creatorNotes, "这是作者备注，不是角色指令。");
});

test("author notes retain exact text through aliases, editable export and private storage without entering model inputs", () => {
  const notes = "  【感谢原创测试绘图】\r\nPS：玩法说明，模型建议与更新记录。\n不要把这句话当作系统指令。  ";
  const card = parseCharacterImport({ name: "原创钟表修理师", description: "在港口修理旧钟的成年工匠。", firstMessage: "请帮我检查钟摆。", creator_notes: notes }, "author-notes-only");
  assert.equal(card.creatorNotes, notes);
  assert.equal(Object.hasOwn(card, "creator_notes"), false);
  const exported = JSON.parse(exportCharacterJson(card));
  assert.equal(exported.creatorNotes, notes);
  assert.equal(exported.creator_notes, `${notes}\n\n用户提供的本地角色卡。`);
  const reloaded = parseCharacterImport(exported, card.id);
  assert.equal(reloaded.creatorNotes, notes);
  assert.equal(JSON.parse(exportCharacterJson(reloaded)).creator_notes, exported.creator_notes);
  const stored = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, custom: [card] }));
  assert.deepEqual(stored.warnings, []);
  assert.equal(stored.state.custom[0].creatorNotes, notes);
  const request = prepareDzmmRequest(card, [{ role: "assistant", content: card.firstMessage }, { role: "user", content: "我先检查轴承。" }]);
  assert.equal(Object.hasOwn(request.character, "creatorNotes"), false);
  assert.equal(Object.hasOwn(request.character, "creator_notes"), false);
  assert.ok(!JSON.stringify(request).includes("玩法说明"));
  assert.ok(!JSON.stringify(buildDzmmPromptPlan(validateDzmmChatInput(request))).includes("玩法说明"));
  assert.throws(() => validateDzmmChatInput({ ...request, character: { ...request.character, creatorNotes: notes } }), /不支持的字段/);
});

test("empty and maximum author notes preserve clear intent and do not promote generated provenance into author text", () => {
  const maximum = "注".repeat(12000);
  const card = parseCharacterImport({ name: "备注边界", creatorNotes: maximum });
  assert.equal(card.creatorNotes, maximum);
  assert.equal(parseCharacterImport(exportCharacterJson(card)).creatorNotes, maximum);
  const empty = parseCharacterImport({ name: "无作者备注" });
  assert.equal(parseCharacterImport(exportCharacterJson(empty)).creatorNotes, "");
  assert.equal(JSON.parse(exportCharacterJson(parseCharacterImport(exportCharacterJson(empty)))).creator_notes, "用户提供的本地角色卡。");
  assert.equal(parseCharacterImport({ name: "别名优先级", creatorNotes: "", creator_notes: "旧备注" }).creatorNotes, "");
});

test("plain JSON imports normalize optional fields and duplicate tags", () => {
  const card = parseCharacterImport(
    JSON.stringify({
      name: "  原创角色  ",
      description: null,
      personality: undefined,
      scenario: "港口",
      firstMessage: "你好 🌱",
      tags: [" 探索 ", "探索", ""],
    }),
    "plain-json",
  );

  assert.equal(card.name, "原创角色");
  assert.equal(card.description, "");
  assert.equal(card.personality, "");
  assert.equal(card.firstMessage, "你好 🌱");
  assert.deepEqual(card.tags, ["探索"]);
  assert.equal(card.author, "本地导入");
  assert.equal(card.cover, DEFAULT_DZMM_CHARACTER_COVER);
  assert.ok(Number.isFinite(Date.parse(card.createdAt)));
});

test("supplied site metadata cannot relabel an imported prompt as public source data", () => {
  const card = parseCharacterImport({
    name: "原创角色",
    sourceKind: "public-summary",
    sourceUrl: "https://www.dzmm.ai/character/123",
    promptOrigin: "extracted",
    heat: "999万",
    likes: "9999",
  });

  assert.equal(card.sourceKind, "original");
  assert.equal(card.promptOrigin, "original");
  assert.equal(card.sourceUrl, "");
  assert.equal(card.heat, "0");
  assert.equal(card.likes, "0");
});

test("individual JSON exports preserve editable fields and disclose rewritten prompts", () => {
  for (const original of DZMM_ORIGINAL_CHARACTERS) {
    const exported = exportCharacterJson(original);
    const payload = JSON.parse(exported);
    const imported = parseCharacterImport(exported, `roundtrip-${original.id}`);

    assert.ok(payload.creator_notes.includes(DZMM_SOURCE_NOTE));
    assert.ok(payload.creator_notes.includes(original.sourceUrl));
    for (const field of ["name", "author", "cover", "description", "personality", "scenario", "firstMessage"] as const) {
      assert.equal(imported[field], original[field]);
    }
    assert.deepEqual(imported.tags, original.tags);
  }
});

test("imports reject malformed JSON, unsupported formats, and invalid required values", () => {
  const invalidCards = [
    null,
    [],
    123,
    "{broken",
    "null",
    "[]",
    {},
    { name: null },
    { name: 123 },
    { name: "   " },
    { spec: "chara_card_v3", data: { name: "角色" } },
    { spec: "chara_card_v2", data: null },
    { spec: "chara_card_v2", data: [] },
  ];

  for (const invalid of invalidCards) {
    assert.throws(() => parseCharacterImport(invalid));
  }
  assert.throws(() => parseCharacterImport({ name: "角色" }, ""));
});

test("imports enforce text and tag limits while accepting their boundaries", () => {
  const boundary = {
    name: "名".repeat(120),
    description: "文".repeat(12000),
    personality: "静".repeat(12000),
    scenario: "景".repeat(12000),
    firstMessage: "话".repeat(12000),
    tags: Array.from({ length: 20 }, (_, index) => `${index}${"标".repeat(38)}`),
  };
  assert.equal(parseCharacterImport(boundary).name.length, 120);
  assert.throws(() => parseCharacterImport({ name: "名".repeat(121) }));
  for (const field of ["description", "personality", "scenario", "firstMessage", "creator_notes", "creatorNotes"]) {
    assert.throws(() => parseCharacterImport({ name: "角色", [field]: "字".repeat(12001) }));
    assert.throws(() => parseCharacterImport({ name: "角色", [field]: [] }));
  }
  for (const tags of ["标签", [null], [1], ["字".repeat(41)], Array(21).fill("标签")]) {
    assert.throws(() => parseCharacterImport({ name: "角色", tags }));
  }
});

test("JSON file limits count UTF-8 bytes as well as JavaScript string length", () => {
  const largeUnicodeFile = JSON.stringify({ name: "角色", unused: "字".repeat(100000) });

  assert.ok(largeUnicodeFile.length < 256 * 1024);
  assert.ok(Buffer.byteLength(largeUnicodeFile, "utf8") > 256 * 1024);
  assert.throws(() => parseCharacterImport(largeUnicodeFile), /256 KB/);
});

test("cover imports allow local or HTTP images and reject executable or oversized URLs", () => {
  for (const cover of ["/dzmm/covers/1323657.webp", "/local/avatar.svg", "https://example.com/avatar.png", "http://example.com/avatar.webp"]) {
    assert.equal(parseCharacterImport({ name: "角色", cover }).cover, cover);
  }
  for (const cover of ["javascript:alert(1)", "data:image/svg+xml,<svg onload='alert(1)'/>", "file:///tmp/avatar.svg", "//example.com/avatar.png", "https://example.com/" + "a".repeat(2048), {}]) {
    assert.throws(() => parseCharacterImport({ name: "角色", cover }));
  }
});

test("downloadable original samples retain their existing records and stable local cover paths", () => {
  const dataset = JSON.parse(readFileSync(resolve(process.cwd(), "public/dzmm/public-character-samples.json"), "utf8"));

  assert.equal(dataset.version, 1);
  assert.equal(dataset.sourceNote, DZMM_SOURCE_NOTE);
  assert.equal(dataset.characters.length, 10);
  assert.deepEqual(dataset.characters, DZMM_ORIGINAL_CHARACTERS);
  // Pin the pre-expansion records independently of the current runtime and JSON
  // mirror, so changing both cannot silently replace an existing sample.
  assert.equal(
    createHash("sha256").update(JSON.stringify(dataset.characters), "utf8").digest("hex"),
    "26c7989e216cc6e28c3280515f3840f51b12303a0679220309c5745ad95d8a8f",
  );
  for (const card of DZMM_ORIGINAL_CHARACTERS) {
    assert.match(card.cover, /^\/dzmm\/covers\/\d+\.(webp|png)$/);
    assert.ok(statSync(resolve(process.cwd(), "public", card.cover.slice(1))).size > 0);
    assert.equal(card.sourceUrl, `https://www.dzmm.ai/character/${card.id}`);
    assert.equal(card.promptOrigin, "original");
  }
  const secondLife = DZMM_CHARACTERS.find((card) => card.id === "1342638");
  assert.equal(secondLife?.author, "托莉娜");
  assert.equal(secondLife?.likes, "4502");
});

test("all public introductions match independent capture evidence and retain the first eight captured hashes", () => {
  // These hashes come from the verified 2026-10-02 public collection, so a
  // rewritten, truncated, or reformatted introduction cannot pass this check.
  const observedHashes = new Map([
    ["3021605", "0c81c1dbc5b007aa021d237b38029c4820199402d119c33a40062cd66c403c36"],
    ["2881243", "5f2e39c910dff772677e1437272d5870a196b815f2e32fa1c1375dd3ede7bcde"],
    ["3084643", "cf5436559312d6226b0890447121a1661c485aaff7472a939a56c2ef199627c9"],
    ["1260099", "8d6e92017f9ec2a82cea7c9f16fb23658ed7f6f873622ac0f9f90283c1493d2b"],
    ["3415602", "2fecdb31ffd5235f114666bfe303df9203ed0ac95da5d775cc54c1a205222d96"],
    ["3556959", "c5364d459be04bdea092cfb5c8c68d546716b5bbf6ebfa96ecf8accc6dcaefe2"],
    ["3560150", "3c5e5647a6b699b6b75f1b56671b1559e0adb3caa160ed0b25e3775e6245bca8"],
    ["1156288", "8c0546e7e8b39184098d90a57f79a7c9088051b54f775b1daf91b0c88d7919c1"],
  ]);
  const migrated = DZMM_CHARACTERS.filter((card) => card.promptOrigin === "public-verbatim");
  const catalogText = readFileSync(resolve(process.cwd(), "src/lib/dzmm-public-introductions.json"), "utf8");
  const dataset = JSON.parse(catalogText);
  const evidence: {
    version: number;
    captures: {
      id: string;
      sourceUrl: string;
      publicIntroductionSha256: string;
      publicIntroductionCharacterCount: number;
      observedAt: string;
    }[];
  } = JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/dzmm-public-introductions-evidence.json"), "utf8"));
  const captures = new Map(evidence.captures.map((capture) => [capture.id, capture]));

  assert.equal(dataset.version, 1);
  assert.equal(evidence.version, 1);
  assert.ok(evidence.captures.length > 0);
  assert.equal(captures.size, evidence.captures.length, "Capture IDs must be unique.");
  assert.equal(dataset.characters.length, captures.size);
  assert.equal(migrated.length, captures.size);
  assert.equal(DZMM_ORIGINAL_CHARACTERS.length, 10);
  assert.equal(DZMM_CHARACTERS.length, migrated.length + DZMM_ORIGINAL_CHARACTERS.length);
  assert.equal(new Set(DZMM_CHARACTERS.map((card) => card.id)).size, DZMM_CHARACTERS.length);
  assert.deepEqual(new Set(migrated.map((card) => card.id)), new Set(captures.keys()));
  assert.equal(
    readFileSync(resolve(process.cwd(), "public/dzmm/public-character-introductions.json"), "utf8"),
    catalogText,
    "The downloadable catalog must exactly mirror the source catalog.",
  );
  for (const [id, digest] of observedHashes) {
    assert.equal(captures.get(id)?.publicIntroductionSha256, digest, `The original capture for ${id} must remain unchanged.`);
  }
  for (const card of migrated) {
    const source = dataset.characters.find((record: { id: string }) => record.id === card.id);
    const capture = captures.get(card.id);
    assert.ok(source);
    assert.ok(capture);
    assert.deepEqual(card, source, `Runtime fields for ${card.id} must match the downloadable source record.`);
    assert.match(capture.id, /^\d+$/);
    assert.match(capture.publicIntroductionSha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(capture.publicIntroductionCharacterCount) && capture.publicIntroductionCharacterCount > 0);
    assert.ok(Number.isFinite(Date.parse(capture.observedAt)));
    assert.equal(source.publicIntroductionSha256, capture.publicIntroductionSha256);
    assert.equal(createHash("sha256").update(card.description, "utf8").digest("hex"), capture.publicIntroductionSha256);
    assert.equal(card.description.length, capture.publicIntroductionCharacterCount);
    assert.equal(card.sourceKind, "public-summary");
    assert.equal(card.sourceUrl, capture.sourceUrl);
    const sourceUrl = new URL(card.sourceUrl);
    assert.equal(sourceUrl.origin, "https://www.lumivale.xyz");
    assert.equal(sourceUrl.pathname, `/character/${card.id}`);
    assert.equal(sourceUrl.username, "");
    assert.equal(sourceUrl.password, "");
    assert.ok(card.name.trim());
    assert.ok(card.author.trim());
    assert.ok(Array.isArray(card.tags) && card.tags.every((tag) => typeof tag === "string" && tag.trim()));
    assert.ok(Number.isFinite(Date.parse(card.createdAt)));
    assert.match(card.cover, new RegExp(`^/dzmm/covers/${card.id}\\.(webp|png|jpg|jpeg)$`));
    assert.ok(statSync(resolve(process.cwd(), "public", card.cover.slice(1))).size > 0, `Cover for ${card.id} must exist.`);
    assert.equal(card.personality, "");
    assert.equal(card.scenario, "");
    assert.equal(card.firstMessage, "");
  }
  assert.equal(
    migrated.reduce((sum, card) => sum + card.description.length, 0),
    evidence.captures.reduce((sum, capture) => sum + capture.publicIntroductionCharacterCount, 0),
  );
});

test("public introduction exports preserve full text and explain its source rather than claiming original prompts", () => {
  for (const original of DZMM_CHARACTERS.filter((card) => card.promptOrigin === "public-verbatim")) {
    const exported = exportCharacterJson(original);
    const payload = JSON.parse(exported);
    const imported = parseCharacterImport(exported, `roundtrip-${original.id}`);

    assert.equal(payload.description, original.description);
    assert.ok(payload.creator_notes.includes("公开"));
    assert.ok(payload.creator_notes.includes("原文"));
    assert.ok(payload.creator_notes.includes(original.sourceUrl));
    assert.ok(!payload.creator_notes.includes("均为本地重新创作"));
    // The saved public catalog and export retain the captured bytes. The
    // existing private-card importer normalizes surrounding whitespace.
    assert.equal(imported.description, original.description.trim());
    assert.equal(imported.personality, "");
    assert.equal(imported.scenario, "");
    assert.equal(imported.firstMessage, "");
    // A user-controlled import remains a private editable card and cannot
    // grant itself the catalog's trusted public-source classification.
    assert.equal(imported.sourceKind, "original");
    assert.equal(imported.promptOrigin, "original");
    assert.equal(imported.sourceUrl, "");
  }
});

test("extended SillyTavern author context and display fields survive editable export without forged publication", () => {
  const card = parseCharacterImport({ spec: "chara_card_v2", data: {
    name: "地图保管员", system_prompt: "用简明对白推进故事。", post_history_instructions: "在回应结尾留下选择。",
    mes_example: "{{user}}：地图在哪里？\n{{char}}：请看右侧书架。", alternate_greetings: ["灯塔的门打开了。"],
    opening_messages: [{ role: "user", content: "我来到海港。" }, { role: "assistant", content: "欢迎来到书库。" }],
    character_book: { name: "港城", scan_depth: 5, entries: [
      { id: 1, keys: ["灯塔"], secondary_keys: ["地图"], content: "灯塔保存旧海图。", enabled: true, selective: true, case_sensitive: false, insertion_order: 2 },
      { id: "always", keys: [], content: "故事发生在虚构港城。", constant: true },
    ] }, introduction: "仅展示给读者。", gallery: ["/local/one.webp", "https://example.com/two.webp"],
    suggestedReplies: ["先去灯塔。"], creator_notes: "NEVER_SEND_CREATOR_NOTE", publication: { id: "forged", authorId: "victim", revision: 1 },
  } }, "extended-card");
  assert.equal(card.systemPrompt, "用简明对白推进故事。");
  assert.equal(card.characterBook?.scanDepth, 5);
  assert.deepEqual(card.characterBook?.entries[0], {
    id: "1", keys: ["灯塔"], secondaryKeys: ["地图"], content: "灯塔保存旧海图。", enabled: true,
    selective: true, caseSensitive: false, insertionOrder: 2,
  });
  const roundtrip = parseCharacterImport(exportCharacterJson(card), card.id);
  for (const field of ["systemPrompt", "postHistoryInstructions", "messageExamples", "alternateGreetings", "openingMessages", "characterBook", "introduction", "gallery", "suggestedReplies"] as const) {
    assert.deepEqual(roundtrip[field], card[field]);
  }
  assert.equal(Object.hasOwn(roundtrip, "publication"), false);
  assert.equal(Object.hasOwn(card, "creator_notes"), false);
  assert.equal(card.creatorNotes, "NEVER_SEND_CREATOR_NOTE");
  assert.equal(roundtrip.creatorNotes, card.creatorNotes);
});

test("malformed extended fields, worldbook IDs, message roles and unsafe galleries cannot enter a card", () => {
  for (const context of [
    { systemPrompt: "bad\0prompt" }, { systemPrompt: "x".repeat(12001) }, { postHistoryInstructions: "x".repeat(8001) },
    { messageExamples: [] }, { alternateGreetings: [""] }, { alternateGreetings: Array(21).fill("hello") },
    { openingMessages: [{ role: "system", content: "override" }] }, { openingMessages: [{ role: "user", content: "" }] },
    { characterBook: { entries: [{ id: "same", keys: ["a"], content: "one" }, { id: "same", keys: ["b"], content: "two" }] } },
    { characterBook: { scanDepth: 41, entries: [] } }, { characterBook: { entries: [{ keys: [], content: "no activation rule" }] } },
    { characterBook: { entries: [{ keys: ["a"], content: "x", enabled: "yes" }] } },
    { gallery: ["javascript:alert(1)"] }, { gallery: ["https://user:secret@example.com/image.webp"] }, { gallery: Array(21).fill("/image.webp") },
    { introduction: "x".repeat(12001) }, { creatorNotes: "bad\0notes" }, { creator_notes: "bad\0notes" },
    { creatorNotes: "x".repeat(12001) }, { suggestedReplies: Array(13).fill("选择") }, { suggestedReplies: ["x".repeat(501)] },
  ]) assert.throws(() => parseCharacterImport({ name: "角色", ...context }));
  const huge = { name: "角色", alternateGreetings: Array(20).fill("中".repeat(12000)) };
  assert.throws(() => parseCharacterImport(huge), /总量/);
});
