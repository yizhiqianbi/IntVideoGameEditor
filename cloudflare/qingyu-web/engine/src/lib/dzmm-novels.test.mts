import assert from "node:assert/strict";
import { test } from "node:test";
import novelModule from "./dzmm-novels";
import novelHandlerModule from "./dzmm-novel-handler";
import type { DzmmNovelDetail } from "./dzmm-novels";
import type { XumengNovelCharacter } from "./xumeng-performance-character";
const { cloneDzmmNovelDraft, createDzmmNovelDraft, decodeDzmmNovelImportBytes, dzmmNovelDraftFromDetail, exportDzmmNovelJson, exportDzmmNovelText, parseDzmmNovelDetail,
  parseDzmmNovelBackup, parseDzmmNovelDraft, parseDzmmNovelImport, parseDzmmNovelList } = novelModule as typeof import("./dzmm-novels");
const { prepareDzmmNovelGeneration } = novelHandlerModule as typeof import("./dzmm-novel-handler");

const original = () => ({ ...createDzmmNovelDraft("novel", (() => { let id = 0; return () => `test-${++id}`; })()), title: "原创 · 雨夜邮局",
  synopsis: "寻找一封迟到的信。", tags: ["成长", "悬疑"], notes: "第三人称，所有线索都有因果。", outline: "第一章：来信\n第二章：回信",
  chapters: [{ id: "chapter-one", title: "来信", content: "  门口响起脚步声。\n\n“是谁？”\n🙂  " }, { id: "chapter-two", title: "回信", content: "最后一段。" }] });
const cast = (): XumengNovelCharacter[] => [{ id: "letter-reader", name: "顾青", avatar: "/dzmm/brand/xumeng-character-placeholder.svg",
  description: "  成年邮局管理员；寻找迟到的信。\n🙂 ", personality: "先核对证据，再表达担忧。", scenario: "邮局刚开门。",
  dialogue: "“我先核对邮戳。”", liveVoice: "Tina" }];

test("JSON backup round trips exact manuscript and creates independent work/chapter identifiers", () => {
  const draft = original(), backup = exportDzmmNovelJson(draft); let id = 0;
  const imported = parseDzmmNovelImport(backup, { format: "json", createId: () => `copy-${++id}` });
  assert.equal(imported.id, "copy-1"); assert.notEqual(imported.id, draft.id);
  assert.deepEqual(imported.chapters.map(item => [item.title, item.content]), draft.chapters.map(item => [item.title, item.content]));
  assert.equal(imported.chapters[0].id, "copy-2"); assert.deepEqual(imported.tags, draft.tags);
  assert.equal(imported.notes, draft.notes); assert.equal(imported.outline, draft.outline);
  assert.ok(!backup.includes("accountId"));
});
test("private backup preserves unfinished title and blank chapters; server save still requires title", () => {
  const draft = createDzmmNovelDraft();
  assert.throws(() => parseDzmmNovelDraft(draft), /作品标题/);
  assert.equal(parseDzmmNovelImport(exportDzmmNovelJson(draft), { format: "json" }).title, "");
  assert.equal(parseDzmmNovelDraft({ ...draft, title: "未完成" }).chapters[0].content, "");
});
test("optional cast survives backup, cloud detail/list hydration and independent imports without changing legacy format", () => {
  const legacy = original();
  assert.equal(Object.hasOwn(parseDzmmNovelBackup(legacy), "characters"), false);
  assert.deepEqual(JSON.parse(exportDzmmNovelJson(legacy)), { schema: "xumeng-novel", version: 1, work: legacy });
  const draft = { ...legacy, characters: cast() };
  assert.deepEqual(parseDzmmNovelDraft(draft), draft);
  assert.deepEqual(JSON.parse(exportDzmmNovelJson(draft)).work, draft);
  const { chapters, ...work } = draft;
  const detail: DzmmNovelDetail = { accountId: "account-a", work: { ...work, version: 1, createdAt: 1, updatedAt: 1 },
    chapters: chapters.map((chapter, position) => ({ ...chapter, workId: work.id, position, version: 1, createdAt: 1, updatedAt: 1 })) };
  const hydrated = dzmmNovelDraftFromDetail(parseDzmmNovelDetail(detail, "account-a"));
  assert.deepEqual(hydrated, draft);
  hydrated.characters![0].description = "副本编辑";
  assert.equal(detail.work.characters![0].description, draft.characters[0].description);
  assert.deepEqual(parseDzmmNovelList({ accountId: "account-a", works: [{ ...detail.work, chapterCount: chapters.length, wordCount: 30 }] }, "account-a").works[0].characters, cast());
  let id = 0;
  const imported = parseDzmmNovelImport(exportDzmmNovelJson(draft), { format: "json", createId: () => `cast-copy-${++id}` });
  assert.equal(imported.characters![0].id, "cast-copy-4");
  assert.deepEqual(imported.characters!.map(({ id: _id, ...profile }) => profile), draft.characters.map(({ id: _id, ...profile }) => profile));
  assert.deepEqual(imported.chapters.map(chapter => chapter.content), draft.chapters.map(chapter => chapter.content));
  assert.equal(exportDzmmNovelText(draft), exportDzmmNovelText(legacy), "TXT contains manuscript prose, with profiles preserved in JSON.");
  const copied = cloneDzmmNovelDraft(draft);
  assert.notEqual(copied.id, draft.id); assert.notEqual(copied.characters![0].id, draft.characters[0].id);
  copied.characters![0].name = "只改副本";
  assert.equal(draft.characters[0].name, "顾青");
});
test("cast validation rejects malformed, duplicate, oversized and unknown profile data without truncation", () => {
  const draft = { ...original(), characters: cast() }, profile = draft.characters[0];
  const malformed = [null, {}, [null], [{ ...profile, name: " " }], [{ ...profile, id: "bad/id" }],
    [profile, profile], [{ ...profile, liveVoice: "unknown" }], [{ ...profile, extra: "unsupported" }],
    [{ ...profile, description: "x".repeat(2001) }], [{ ...profile, description: "hidden\0text" }],
    [{ ...profile, avatar: "javascript:alert(1)" }], [{ ...profile, avatar: "http://example.test/avatar.png" }],
    Array.from({ length: 31 }, (_, i) => ({ ...profile, id: `cast-${i}` }))];
  for (const characters of malformed) assert.throws(() => parseDzmmNovelDraft({ ...draft, characters }));
  const { chapters, ...work } = draft;
  assert.throws(() => parseDzmmNovelList({ accountId: "account-a", works: [{ ...work, characters: [{ ...profile, liveVoice: "invalid" }], version: 1, createdAt: 1, updatedAt: 1, chapterCount: chapters.length, wordCount: 1 }] }, "account-a"));
  const incomplete = { ...draft, characters: [{ ...profile, name: "", avatar: "https:" }] };
  assert.deepEqual(parseDzmmNovelBackup(incomplete), incomplete);
  const restored = parseDzmmNovelImport(exportDzmmNovelJson(incomplete), { format: "json" });
  assert.equal(restored.characters![0].name, ""); assert.equal(restored.characters![0].avatar, "https:");
  assert.throws(() => parseDzmmNovelDraft(restored), /姓名/);
  assert.throws(() => parseDzmmNovelBackup({ ...draft, characters: [{ ...profile, description: "x".repeat(2001) }] }), /2000/);
});
test("independent copies skip source identifier collisions across chapters and cast", () => {
  const draft = { ...original(), characters: cast() };
  const collisions = [draft.id, draft.chapters[0].id, draft.characters[0].id]; let id = 0;
  const cloned = cloneDzmmNovelDraft(draft, () => collisions.shift() ?? `new-${++id}`);
  const identities = [cloned.id, ...cloned.chapters.map(chapter => chapter.id), ...cloned.characters!.map(character => character.id)];
  assert.equal(new Set(identities).size, identities.length);
  assert.deepEqual(identities, ["new-1", "new-2", "new-3", "new-4"]);
  assert.throws(() => cloneDzmmNovelDraft(draft, () => draft.id), /独立副本编号/);
});
test("private backups preserve unfinished tag count and length without relaxing cloud validation", () => {
  for (const tags of [Array.from({ length: 21 }, (_, index) => `原创标签${index + 1}`), ["  " + "长".repeat(41) + "  "]]) {
    const draft = { ...original(), tags }, backup = exportDzmmNovelJson(draft);
    assert.deepEqual(parseDzmmNovelBackup(draft), draft);
    assert.deepEqual(JSON.parse(backup).work, draft);
    const imported = parseDzmmNovelImport(backup, { format: "json" });
    assert.deepEqual(imported.tags, tags);
    assert.deepEqual({ ...imported, id: draft.id, chapters: imported.chapters.map((chapter, index) => ({ ...chapter, id: draft.chapters[index].id })) }, draft);
    assert.equal(exportDzmmNovelText(draft), exportDzmmNovelText(original()));
    assert.throws(() => parseDzmmNovelDraft(draft), /标签/);
    assert.throws(() => parseDzmmNovelDraft(imported), /标签/);
    const { chapters, ...work } = draft;
    const cloudWork = { ...work, version: 1, createdAt: 1, updatedAt: 1 };
    assert.throws(() => parseDzmmNovelList({ accountId: "account-a", works: [{ ...cloudWork, chapterCount: chapters.length, wordCount: 30 }] }, "account-a"), /标签/);
    assert.throws(() => parseDzmmNovelDetail({ accountId: "account-a", work: cloudWork,
      chapters: chapters.map((chapter, position) => ({ ...chapter, position, workId: work.id, version: 1, createdAt: 1, updatedAt: 1 })) }, "account-a"), /标签/);
  }
});
test("backup parsing still rejects malformed tags and manuscript structure", () => {
  const draft = original();
  const malformed = [
    { ...draft, tags: ["原创", 3] }, { ...draft, tags: "原创" }, { ...draft, tags: ["重复", "重复"] },
    { ...draft, tags: ["\0"] }, { ...draft, tags: ["  "] }, { ...draft, id: "invalid id" },
    { ...draft, type: "unsupported" }, { ...draft, extra: "unsupported" },
    { ...draft, chapters: [{ ...draft.chapters[0], id: "invalid id" }] },
    { ...draft, chapters: [draft.chapters[0], draft.chapters[0]] },
    { ...draft, chapters: [{ ...draft.chapters[0], content: 3 }] },
  ];
  for (const work of malformed) {
    assert.throws(() => parseDzmmNovelBackup(work));
    assert.throws(() => parseDzmmNovelImport(JSON.stringify({ schema: "xumeng-novel", version: 1, work }), { format: "json" }));
  }
  assert.throws(() => parseDzmmNovelBackup({ ...draft, chapters: Array.from({ length: 101 }, (_, index) => ({ id: `chapter-${index}`, title: "章", content: "原稿" })) }), /100 个章节/);
  assert.throws(() => parseDzmmNovelBackup({ ...draft, chapters: [{ ...draft.chapters[0], content: "原".repeat(50_001) }] }), /章节正文/);
});
test("AI request validation still rejects unfinished backup tags", () => {
  for (const tags of [Array.from({ length: 21 }, (_, index) => `原创标签${index + 1}`), ["长".repeat(41)]]) {
    const { id: _id, chapters: _chapters, ...work } = parseDzmmNovelBackup({ ...original(), tags });
    void _id; void _chapters;
    assert.throws(() => prepareDzmmNovelGeneration({ operation: "outline", work, model: "fast" }), /标签/);
  }
});
test("large TXT imports split without losing Unicode or whitespace", () => {
  const content = "甲".repeat(49_999) + "🙂" + "\n  后半段\n\n" + "乙".repeat(20_000);
  const draft = parseDzmmNovelImport(content, { format: "txt", filename: "原创故事.txt" });
  assert.equal(draft.title, "原创故事"); assert.equal(draft.type, "story"); assert.equal(draft.chapters.length, 2);
  assert.equal(draft.chapters.map(item => item.content).join(""), content);
  assert.equal(draft.chapters[0].content.length, 49_999);
  assert.ok(draft.chapters.every(item => item.content.length <= 50_000));
});
test("strict byte imports preserve UTF-8 BOM, line endings, whitespace, emoji and literal replacement characters", () => {
  const content = "  原创雾港来信。\r\n\r\n“这是字面上的 � 符号。”🙂\n  ", marked = "\uFEFF" + content;
  const bytes = new TextEncoder().encode(marked);
  assert.equal(decodeDzmmNovelImportBytes(bytes), marked);
  assert.equal(decodeDzmmNovelImportBytes(bytes.buffer), marked);
  const imported = parseDzmmNovelImport(decodeDzmmNovelImportBytes(bytes), { format: "txt", filename: "原创来信.txt" });
  assert.equal(imported.chapters.map(chapter => chapter.content).join(""), content);
  const work = { ...original(), notes: "字面符号 �；保留指令。\r\n  " };
  const json = "\uFEFF" + exportDzmmNovelJson(work);
  const restored = parseDzmmNovelImport(decodeDzmmNovelImportBytes(new TextEncoder().encode(json)), { format: "json" });
  assert.equal(restored.notes, work.notes);
  assert.deepEqual(restored.chapters.map(chapter => [chapter.title, chapter.content]), work.chapters.map(chapter => [chapter.title, chapter.content]));
  assert.deepEqual(restored.tags, work.tags);
});
test("TXT and JSON byte imports reject malformed UTF-8 before parsing or allocating work IDs", () => {
  const invalidInputs = [
    new Uint8Array([0xd4, 0xad, 0xb4, 0xb4]), // GBK bytes for 原创; not valid UTF-8 as a whole.
    new Uint8Array([0xe4, 0xb8]), // Truncated multibyte character.
    new Uint8Array([0x80]), // Unpaired continuation byte.
    new Uint8Array([0xc0, 0xaf]), // Overlong encoding.
    new Uint8Array([0xed, 0xa0, 0x80]), // Encoded UTF-16 surrogate.
    new Uint8Array([0xf4, 0x90, 0x80, 0x80]), // Above Unicode's highest code point.
  ];
  const expectedError = "文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。";
  for (const bytes of invalidInputs) {
    assert.throws(() => decodeDzmmNovelImportBytes(bytes), { message: expectedError });
    assert.throws(() => decodeDzmmNovelImportBytes(bytes.buffer), { message: expectedError });
    for (const format of ["txt", "json"] as const) {
      let created = 0;
      const prefix = new TextEncoder().encode(format === "json" ? '{"schema":"xumeng-novel","version":1,"work":{"title":"' : "原创正文：");
      const file = new Uint8Array(prefix.length + bytes.length); file.set(prefix); file.set(bytes, prefix.length);
      assert.throws(() => parseDzmmNovelImport(decodeDzmmNovelImportBytes(file), { format, createId: () => `unused-${++created}` }), { message: expectedError });
      assert.equal(created, 0);
    }
  }
});
test("byte import limits apply to the exact view and reject excess bytes before decoding", () => {
  const surrounding = new Uint8Array([0xff, 0x20, 0xe4, 0xbf, 0xa1, 0x20, 0xff]);
  assert.equal(decodeDzmmNovelImportBytes(surrounding.subarray(1, 6)), " 信 ");
  assert.equal(decodeDzmmNovelImportBytes(new Uint8Array(1_500_000).fill(0x61)).length, 1_500_000);
  assert.throws(() => decodeDzmmNovelImportBytes(new Uint8Array(1_500_001).fill(0xff)), /1.5 MB/);
  const encoded = new TextEncoder().encode("信".repeat(500_001));
  assert.throws(() => decodeDzmmNovelImportBytes(encoded), /1.5 MB/);
});
test("validation rejects oversized manuscript instead of truncating; backup can still preserve it", () => {
  const draft = original(); draft.chapters = Array.from({ length: 31 }, (_, i) => ({ id: `chapter-${i}`, title: "完整章", content: "中".repeat(50_000) }));
  assert.throws(() => parseDzmmNovelDraft(draft), /1.5 MB/);
  const backup = JSON.parse(exportDzmmNovelJson(draft));
  assert.equal(backup.work.chapters[30].content.length, 50_000);
  assert.throws(() => parseDzmmNovelImport(JSON.stringify(backup), { format: "json" }), /1.5 MB/);
});
test("unfinished tags cannot bypass ordinary import or backup size bounds", () => {
  const backup = exportDzmmNovelJson({ ...original(), tags: ["a".repeat(1_500_001)] });
  assert.throws(() => parseDzmmNovelImport(backup, { format: "json" }), /1.5 MB/);
  assert.throws(() => parseDzmmNovelBackup({ ...original(), tags: ["a".repeat(16_000_000)] }), /16 MB/);
});
test("unsupported imports, duplicate chapters and NUL text fail explicitly", () => {
  assert.throws(() => parseDzmmNovelImport('{"schema":"other","version":1}', { format: "json" }), /不受支持/);
  assert.throws(() => parseDzmmNovelImport("", { format: "txt" }), /没有正文/);
  const draft = original(); draft.chapters[1].id = draft.chapters[0].id;
  assert.throws(() => parseDzmmNovelDraft(draft), /不能重复/);
  assert.throws(() => parseDzmmNovelDraft({ ...original(), notes: "原文\0注入" }), /创作指令/);
});
test("remote hydration validates account, chapter parent and complete ordering", () => {
  const { chapters, ...draft } = original();
  const detail: DzmmNovelDetail = { accountId: "account-a", work: { ...draft, version: 2, createdAt: 1, updatedAt: 2 },
    chapters: chapters.map((item, position) => ({ ...item, workId: draft.id, position, version: 1, createdAt: 1, updatedAt: 2 })) };
  assert.deepEqual(dzmmNovelDraftFromDetail(parseDzmmNovelDetail(detail, "account-a")), original());
  assert.throws(() => parseDzmmNovelDetail(detail, "account-b"), /账号/);
  assert.throws(() => parseDzmmNovelDetail({ ...detail, chapters: [...detail.chapters].reverse() }, "account-a"), /顺序/);
  assert.throws(() => parseDzmmNovelDetail({ ...detail, chapters: [{ ...detail.chapters[0], workId: "foreign-work" }] }, "account-a"), /归属/);
});
test("TXT exports chapters in authored order, including unsaved literal text", () => {
  const text = exportDzmmNovelText(original());
  assert.ok(text.indexOf("来信") < text.indexOf("回信"));
  assert.ok(text.includes("  门口响起脚步声。\n\n“是谁？”\n🙂  "));
  assert.ok(text.endsWith("最后一段。"));
});
