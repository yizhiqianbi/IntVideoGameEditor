import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import novelModule from "./dzmm-novels";
import clientModule from "./dzmm-novels-client";
import type { DzmmNovelDetail, DzmmNovelGenerationInput } from "./dzmm-novels";
const { createDzmmNovelDraft, dzmmNovelDraftFromDetail, exportDzmmNovelJson, exportDzmmNovelText,
  parseDzmmNovelDraft, parseDzmmNovelImport } = novelModule as typeof import("./dzmm-novels");
const { clearDzmmNovelRecovery, dismissDzmmNovelRecovery, DzmmNovelClientError, fetchDzmmNovel, generateDzmmNovel, readDzmmNovelRecoveries, readDzmmNovelRecovery,
  saveDzmmNovel, writeDzmmNovelRecovery } = clientModule as typeof import("./dzmm-novels-client");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function draft() { return { ...createDzmmNovelDraft(), title: "隔离原创测试", notes: "手动创作指令" }; }
function detail(accountId = "account-a"): DzmmNovelDetail {
  const { chapters, ...work } = draft();
  return { accountId, work: { ...work, version: 1, createdAt: 1, updatedAt: 1 }, chapters: chapters.map((chapter, position) => ({ ...chapter, workId: work.id, position, version: 1, createdAt: 1, updatedAt: 1 })) };
}
function memoryStorage() {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const scope = (work: { id: string }, ownerId = "document-a") => ({ ownerId, workId: work.id });

test("success must match both signed-in account and requested work before adoption", async () => {
  const value = detail("account-b"); globalThis.fetch = async () => Response.json(value);
  await assert.rejects(fetchDzmmNovel("account-a", value.work.id), /账号已改变/);
  globalThis.fetch = async () => Response.json(detail());
  await assert.rejects(fetchDzmmNovel("account-a", "another-work"), /作品编号/);
});
test("CAS conflict returns verified cloud snapshot without altering local draft", async () => {
  const cloud = detail(), local = { ...dzmmNovelDraftFromDetail(cloud), title: "本地未保存" };
  const before = JSON.stringify(local);
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.accountId, "account-a"); assert.equal(body.version, 1);
    return Response.json({ accountId: "account-a", error: "云端已改变", current: { ...cloud, work: { ...cloud.work, version: 2 } } }, { status: 409 });
  };
  await assert.rejects(saveDzmmNovel("account-a", local, 1), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 409 && error.current?.work.version === 2);
  assert.equal(JSON.stringify(local), before);
});
test("lost new-work acknowledgement retries the identical create and accepts the verified existing manuscript", async () => {
  const cloud = detail(); cloud.chapters[0].content = "  桥上的灯亮了。\n\n保留原稿🌉\n";
  const local = dzmmNovelDraftFromDetail(cloud), sent: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/backend/v1/novels"); assert.equal(init?.method, "POST");
    sent.push(String(init?.body));
    if (sent.length === 1) throw new TypeError("saved create lost its response");
    return Response.json({ accountId: "account-a", error: "作品已存在", current: cloud }, { status: 409 });
  };
  await assert.rejects(saveDzmmNovel("account-a", local, null), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 503);
  const acknowledged = await saveDzmmNovel("account-a", local, null);
  assert.deepEqual(acknowledged, cloud); assert.deepEqual(dzmmNovelDraftFromDetail(acknowledged), local);
  assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]);
});
test("lost acknowledgements equate optional empty cast but preserve conflicts for changed profile data", async () => {
  const cloud = detail(), local = { ...dzmmNovelDraftFromDetail(cloud), characters: [] };
  globalThis.fetch = async () => Response.json({ accountId: "account-a", error: "作品已存在", current: cloud }, { status: 409 });
  assert.deepEqual(await saveDzmmNovel("account-a", local, null), cloud);
  const character = { id: "bridge-guide", name: "林澈", avatar: "", description: "地图员", personality: "核对证据。",
    scenario: "桥边", dialogue: "先看航志。", liveVoice: "Tina" as const };
  cloud.work.characters = [character];
  const withCast = { ...local, characters: [{ ...character }] };
  assert.deepEqual((await saveDzmmNovel("account-a", withCast, null)).work.characters, [character]);
  for (const characters of [[], [{ ...character, description: "另一人物背景" }], [{ ...character, liveVoice: "zh_female_liuchangnv_uranus_bigtts" as const }]]) {
    await assert.rejects(saveDzmmNovel("account-a", { ...local, characters }, null), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 409 && !!error.current);
  }
});
test("unchanged PUT acknowledgement adopts the verified current version with no extra request or manuscript normalization", async () => {
  const cloud = detail(); cloud.work = { ...cloud.work, version: 3, updatedAt: 3, tags: ["桥", "灯"], outline: "  原创大纲\n" };
  cloud.chapters[0].content = "\n保留空白、换行🙂  ";
  const local = dzmmNovelDraftFromDetail(cloud), before = JSON.stringify(local); let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++; assert.equal(input, `/api/backend/v1/novels/${cloud.work.id}`); assert.equal(init?.method, "PUT");
    assert.equal(JSON.parse(String(init?.body)).version, 2);
    return Response.json({ accountId: "account-a", error: "云端已改变", current: cloud }, { status: 409 });
  };
  const acknowledged = await saveDzmmNovel("account-a", local, 2);
  assert.equal(acknowledged.work.version, 3); assert.equal(requests, 1);
  assert.deepEqual(dzmmNovelDraftFromDetail(acknowledged), local); assert.equal(JSON.stringify(local), before);
});
test("a different work, manuscript field, chapter ID or chapter order keeps the full conflict and submitted local text", async () => {
  const cloud = detail(); cloud.work = { ...cloud.work, tags: ["桥", "灯"], synopsis: "普通原创简介", outline: "两章大纲", type: "novel" };
  cloud.chapters = [
    { ...cloud.chapters[0], content: "  第一段\n" },
    { ...cloud.chapters[0], id: "chapter-two", title: "第二章", content: "第二段🙂\n  ", position: 1 },
  ];
  const local = dzmmNovelDraftFromDetail(cloud), before = JSON.stringify(local);
  const variants: { label: string; current: DzmmNovelDetail }[] = [
    { label: "other work", current: { ...cloud, work: { ...cloud.work, id: "other-work" }, chapters: cloud.chapters.map(chapter => ({ ...chapter, workId: "other-work" })) } },
    ...(["title", "synopsis", "notes", "outline"] as const).map(field => ({ label: field, current: { ...cloud, work: { ...cloud.work, [field]: `${cloud.work[field]}更改` } } })),
    { label: "type", current: { ...cloud, work: { ...cloud.work, type: "story" } } },
    { label: "tags order", current: { ...cloud, work: { ...cloud.work, tags: [...cloud.work.tags].reverse() } } },
    { label: "chapter ID", current: { ...cloud, chapters: cloud.chapters.map((chapter, index) => index === 0 ? { ...chapter, id: "replaced-chapter" } : chapter) } },
    { label: "chapter title", current: { ...cloud, chapters: cloud.chapters.map((chapter, index) => index === 0 ? { ...chapter, title: "改后的标题" } : chapter) } },
    { label: "chapter whitespace", current: { ...cloud, chapters: cloud.chapters.map((chapter, index) => index === 0 ? { ...chapter, content: chapter.content.trim() } : chapter) } },
    { label: "chapter order", current: { ...cloud, chapters: [...cloud.chapters].reverse().map((chapter, position) => ({ ...chapter, position })) } },
  ];
  for (const { label, current } of variants) {
    globalThis.fetch = async () => Response.json({ accountId: "account-a", error: label, current }, { status: 409 });
    await assert.rejects(saveDzmmNovel("account-a", local, 1), (error: unknown) => error instanceof DzmmNovelClientError
      && error.status === 409 && error.message === label && !!error.current, label);
    assert.equal(JSON.stringify(local), before, label);
  }
});
test("invalid or foreign conflict snapshots, non-conflict failures and cancelled requests cannot acknowledge a save", async () => {
  const cloud = detail(), local = dzmmNovelDraftFromDetail(cloud);
  for (const current of [{ ...cloud, accountId: "account-b" }, { ...cloud, chapters: cloud.chapters.map(chapter => ({ ...chapter, workId: "another-parent" })) }]) {
    globalThis.fetch = async () => Response.json({ accountId: "account-a", error: "未确认保存", current }, { status: 409 });
    await assert.rejects(saveDzmmNovel("account-a", local, null), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 409 && error.current === undefined);
  }
  globalThis.fetch = async () => Response.json({ accountId: "account-b", error: "账号已改变", current: cloud }, { status: 409 });
  await assert.rejects(saveDzmmNovel("account-a", local, null), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 401);
  globalThis.fetch = async () => Response.json({ accountId: "account-a", error: "服务暂不可用", current: cloud }, { status: 503 });
  await assert.rejects(saveDzmmNovel("account-a", local, null), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 503);
  const controller = new AbortController();
  globalThis.fetch = async () => { controller.abort(); return Response.json({ accountId: "account-a", error: "已停止", current: cloud }, { status: 409 }); };
  await assert.rejects(saveDzmmNovel("account-a", local, null, controller.signal), (error: unknown) => error instanceof DzmmNovelClientError && error.status === 409);
});
test("late identical acknowledgement compares the immutable submitted snapshot without altering later caller edits or recovery", async () => {
  const cloud = detail(), local = dzmmNovelDraftFromDetail(cloud), storage = memoryStorage();
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
  const pending = saveDzmmNovel("account-a", local, null);
  local.chapters[0].content = "等待回包期间的较新原稿🙂\n";
  const newest = writeDzmmNovelRecovery({ accountId: "account-a", draft: local, baseVersion: null, selectedChapterId: local.chapters[0].id, updatedAt: 2 }, scope(local), storage);
  release(Response.json({ accountId: "account-a", error: "作品已存在", current: cloud }, { status: 409 }));
  const acknowledged = await pending;
  assert.deepEqual(acknowledged, cloud); assert.equal(local.chapters[0].content, "等待回包期间的较新原稿🙂\n");
  assert.equal(storage.getItem(newest.storageKey), newest.raw);
  assert.equal(readDzmmNovelRecovery("account-a", storage)?.draft.chapters[0].content, local.chapters[0].content);
});
test("account-specific recovery preserves unnamed and oversize failed-save drafts", () => {
  const storage = memoryStorage(), work = createDzmmNovelDraft();
  work.chapters = Array.from({ length: 31 }, (_, i) => ({ id: `chapter-${i}`, title: "", content: "中".repeat(50_000) }));
  const entry = writeDzmmNovelRecovery({ accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: "chapter-0", updatedAt: 1 }, scope(work), storage);
  assert.equal(readDzmmNovelRecovery("account-b", storage), null);
  assert.equal(readDzmmNovelRecovery("account-a", storage)?.draft.chapters[30].content.length, 50_000);
  assert.equal(clearDzmmNovelRecovery(entry, "document-b", storage), false); assert.ok(readDzmmNovelRecovery("account-a", storage));
  assert.equal(clearDzmmNovelRecovery(entry, "document-a", storage), true); assert.equal(readDzmmNovelRecovery("account-a", storage), null);
});
test("cast recovery preserves incomplete edits by account and refuses cloud saves before any request", async () => {
  const storage = memoryStorage(), work = { ...draft(), characters: [{ id: "editing-person", name: "", avatar: "https:",
    description: "  待编辑背景\n🙂 ", personality: "保留说话习惯。", scenario: "初始局势", dialogue: "未完成台词", liveVoice: "Tina" as const }] };
  const before = JSON.stringify(work); let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Incomplete cast must not reach the service."); };
  const entry = writeDzmmNovelRecovery({ accountId: "account-a", draft: work, baseVersion: 2, selectedChapterId: work.chapters[0].id, updatedAt: 1 }, scope(work), storage);
  assert.equal(readDzmmNovelRecovery("account-b", storage), null);
  const recovered = readDzmmNovelRecovery("account-a", storage)!;
  assert.deepEqual(recovered.draft, work); assert.equal(recovered.baseVersion, 2);
  await assert.rejects(saveDzmmNovel("account-a", recovered.draft, 2), /姓名/);
  assert.equal(requests, 0); assert.equal(JSON.stringify(work), before); assert.equal(storage.getItem(entry.storageKey), entry.raw);
  const restored = parseDzmmNovelImport(exportDzmmNovelJson(recovered.draft), { format: "json" });
  assert.notEqual(restored.characters![0].id, work.characters[0].id);
  assert.equal(restored.characters![0].avatar, "https:");
});
test("failed tag-limit saves recover and export exact draft; JSON reimports still reject before fetch", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("invalid draft must not reach the service"); };
  for (const tags of [Array.from({ length: 21 }, (_, index) => `原创标签${index + 1}`), ["长".repeat(41)]]) {
    const storage = memoryStorage(), work = { ...draft(), tags, outline: "第一幕\n\n  原创大纲🙂  ",
      chapters: [{ id: "chapter-own", title: "原创章节", content: "  保留每一行。\n\n🙂\n  " }] };
    const before = JSON.stringify(work);
    writeDzmmNovelRecovery({ accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: "chapter-own", updatedAt: 1 }, scope(work), storage);
    await assert.rejects(saveDzmmNovel("account-a", work, null), /标签/);
    const recovered = readDzmmNovelRecovery("account-a", storage);
    assert.ok(recovered);
    assert.deepEqual(recovered.draft, work);
    assert.equal(recovered.selectedChapterId, "chapter-own");
    const backup = exportDzmmNovelJson(recovered.draft);
    assert.deepEqual(JSON.parse(backup).work, work);
    assert.ok(exportDzmmNovelText(recovered.draft).endsWith(work.chapters[0].content));
    let nextId = 0;
    const imported = parseDzmmNovelImport(backup, { format: "json", createId: () => `copy-${++nextId}` });
    assert.deepEqual({ ...imported, id: work.id, chapters: imported.chapters.map((chapter, index) => ({ ...chapter, id: work.chapters[index].id })) }, work);
    assert.throws(() => parseDzmmNovelDraft(imported), /标签/);
    await assert.rejects(saveDzmmNovel("account-a", imported, null), /标签/);
    assert.equal(JSON.stringify(work), before);
  }
  assert.equal(requests, 0);
});
test("recovery keeps structural validation and the original 16 MB serialized limit", () => {
  const storage = memoryStorage(), work = draft();
  for (const invalid of [{ ...work, tags: ["原创", 3] }, { ...work, id: "invalid id" }, { ...work, type: "invalid" },
    { ...work, chapters: [work.chapters[0], work.chapters[0]] }, { ...work, tags: ["a".repeat(16_000_000)] }]) {
    storage.setItem("xumeng-novel-recovery:account-a", JSON.stringify({ accountId: "account-a", draft: invalid,
      baseVersion: null, selectedChapterId: work.chapters[0].id, updatedAt: 1 }));
    assert.equal(readDzmmNovelRecovery("account-a", storage), null);
  }
});
test("different documents preserve separate recoveries for both different and identical works", () => {
  const storage = memoryStorage(), first = draft(), second = { ...draft(), title: "另一个原创稿" };
  const a = writeDzmmNovelRecovery({ accountId: "account-a", draft: first, baseVersion: 1, selectedChapterId: first.chapters[0].id, updatedAt: 1 }, scope(first), storage);
  const b = writeDzmmNovelRecovery({ accountId: "account-a", draft: second, baseVersion: null, selectedChapterId: second.chapters[0].id, updatedAt: 1 }, scope(second, "document-b"), storage);
  const c = writeDzmmNovelRecovery({ accountId: "account-a", draft: { ...first, notes: "同一作品的另一份未保存修改" }, baseVersion: 1, selectedChapterId: first.chapters[0].id, updatedAt: 1 }, scope(first, "document-c"), storage);
  assert.equal(new Set([a.storageKey, b.storageKey, c.storageKey]).size, 3);
  assert.equal(readDzmmNovelRecoveries("account-a", storage).length, 3);
  assert.deepEqual(readDzmmNovelRecoveries("account-b", storage), []);
  assert.equal(clearDzmmNovelRecovery(a, "document-a", storage), true);
  assert.deepEqual(new Set(readDzmmNovelRecoveries("account-a", storage).map(entry => entry.raw)), new Set([b.raw, c.raw]));
  assert.equal(clearDzmmNovelRecovery({ ...c, storageKey: b.storageKey }, "document-c", storage), false);
  assert.equal(storage.getItem(b.storageKey), b.raw);
});
test("stale save cleanup and delayed cross-document dismiss preserve newer revisions even with equal timestamps", () => {
  const storage = memoryStorage(), work = draft();
  const recovery = { accountId: "account-a", draft: work, baseVersion: 1, selectedChapterId: work.chapters[0].id, updatedAt: 1 };
  const first = writeDzmmNovelRecovery(recovery, scope(work), storage);
  const second = writeDzmmNovelRecovery({ ...recovery, draft: { ...work, notes: "第一份之后继续写" } }, scope(work), storage);
  assert.notEqual(first.revision, second.revision);
  assert.equal(clearDzmmNovelRecovery(first, "document-a", storage), false);
  dismissDzmmNovelRecovery(first, storage);
  assert.equal(readDzmmNovelRecoveries("account-a", storage)[0].raw, second.raw);
  dismissDzmmNovelRecovery(second, storage);
  assert.equal(storage.getItem(second.storageKey), second.raw);
  assert.deepEqual(readDzmmNovelRecoveries("account-a", storage), []);
  const third = writeDzmmNovelRecovery({ ...recovery, draft: { ...work, notes: "活跃页面的新稿再次可恢复" } }, scope(work), storage);
  dismissDzmmNovelRecovery(first, storage);
  assert.equal(readDzmmNovelRecoveries("account-a", storage)[0].raw, third.raw);
  // A late dismiss does not overwrite the marker for another ignored revision.
  storage.setItem(second.storageKey, second.raw);
  assert.deepEqual(readDzmmNovelRecoveries("account-a", storage), []);
});
test("legacy recovery remains read-only and delayed dismiss matches exact raw rather than time", () => {
  const storage = memoryStorage(), work = { ...draft(), tags: Array.from({ length: 21 }, (_, index) => `原创标签${index}`) };
  const original = { accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: work.chapters[0].id, updatedAt: 1 };
  const key = "xumeng-novel-recovery:account-a", raw = JSON.stringify(original);
  storage.setItem(key, raw);
  const old = readDzmmNovelRecoveries("account-a", storage)[0];
  assert.equal(old.ownerId, null); assert.equal(old.revision, null); assert.deepEqual(old.draft, work);
  assert.equal(clearDzmmNovelRecovery(old, "document-a", storage), false);
  const newerRaw = JSON.stringify({ ...original, draft: { ...work, notes: "旧版页面继续编辑，时间相同" } });
  storage.setItem(key, newerRaw);
  dismissDzmmNovelRecovery(old, storage);
  assert.equal(storage.getItem(key), newerRaw);
  const newer = readDzmmNovelRecoveries("account-a", storage)[0]; assert.equal(newer.raw, newerRaw);
  dismissDzmmNovelRecovery(newer, storage);
  dismissDzmmNovelRecovery(old, storage);
  assert.deepEqual(readDzmmNovelRecoveries("account-a", storage), []);
  storage.setItem(key, raw); assert.deepEqual(readDzmmNovelRecoveries("account-a", storage), []);
});
test("restoring a foreign or legacy entry serializes canonical fields only and clearing the copy preserves its source", () => {
  const storage = memoryStorage(), work = draft();
  const source = writeDzmmNovelRecovery({ accountId: "account-a", draft: work, baseVersion: 1, selectedChapterId: work.chapters[0].id, updatedAt: 1 }, scope(work, "original-document"), storage);
  let copied = writeDzmmNovelRecovery(source, scope(work, "restored-document"), storage);
  for (let index = 0; index < 5; index++) copied = writeDzmmNovelRecovery(copied, scope(work, "restored-document"), storage);
  const parsed = JSON.parse(copied.raw);
  assert.deepEqual(Object.keys(parsed).sort(), ["accountId", "draft", "baseVersion", "selectedChapterId", "updatedAt", "recoveryVersion", "ownerId", "workId", "revision"].sort());
  assert.deepEqual(parsed.draft, work);
  assert.ok(copied.raw.length < source.raw.length + 50);
  assert.equal(clearDzmmNovelRecovery(copied, "restored-document", storage), true);
  assert.equal(readDzmmNovelRecoveries("account-a", storage)[0].raw, source.raw);
});
test("recovery scope binding and malformed records cannot expose or clear another work", () => {
  const storage = memoryStorage(), work = draft();
  const input = { accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: work.chapters[0].id, updatedAt: 1 };
  assert.throws(() => writeDzmmNovelRecovery(input, { ownerId: "document-a", workId: "another-work" }, storage), /归属/);
  assert.throws(() => writeDzmmNovelRecovery(input, scope(work, "invalid owner"), storage), /编号/);
  const entry = writeDzmmNovelRecovery(input, scope(work), storage), value = JSON.parse(entry.raw);
  for (const malformed of [{ ...value, accountId: "account-b" }, { ...value, ownerId: "document-b" }, { ...value, workId: "another-work" },
    { ...value, revision: 3 }, { ...value, recoveryVersion: 1 }, { ...value, draft: { ...work, tags: [3] } }]) {
    storage.setItem(entry.storageKey, JSON.stringify(malformed));
    assert.deepEqual(readDzmmNovelRecoveries("account-a", storage), []);
    assert.equal(clearDzmmNovelRecovery(entry, "document-a", storage), false);
  }
});
test("quota failure leaves foreign and legacy sources visible and never silently discards other drafts", () => {
  const storage = memoryStorage(), work = draft(), input = { accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: work.chapters[0].id, updatedAt: 1 };
  const entry = writeDzmmNovelRecovery(input, scope(work), storage);
  storage.setItem("xumeng-novel-recovery:account-a", JSON.stringify(input));
  const legacy = readDzmmNovelRecoveries("account-a", storage).find(candidate => candidate.ownerId === null)!;
  const full = { setItem: () => { throw new DOMException("storage is full", "QuotaExceededError"); } };
  assert.throws(() => dismissDzmmNovelRecovery(entry, full), /storage is full/);
  assert.throws(() => dismissDzmmNovelRecovery(legacy, full), /storage is full/);
  assert.throws(() => writeDzmmNovelRecovery({ ...input, draft: { ...work, notes: "尚未写入的稿件" } }, scope(work), full), /storage is full/);
  assert.equal(storage.getItem(entry.storageKey), entry.raw);
  assert.equal(readDzmmNovelRecoveries("account-a", storage).length, 2);
});
test("many work slots are retained without a shared index or automatic deletion", () => {
  const storage = memoryStorage();
  for (let index = 0; index < 30; index++) {
    const work = { ...draft(), id: `original-work-${index}` };
    writeDzmmNovelRecovery({ accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: work.chapters[0].id, updatedAt: index }, scope(work), storage);
  }
  assert.equal(readDzmmNovelRecoveries("account-a", storage).length, 30);
  assert.equal(storage.length, 30);
});
test("unknown committed response after cancellation cannot erase recovery", async () => {
  const storage = memoryStorage(), work = draft(), controller = new AbortController();
  writeDzmmNovelRecovery({ accountId: "account-a", draft: work, baseVersion: null, selectedChapterId: work.chapters[0].id, updatedAt: 1 }, scope(work), storage);
  let committed = false;
  globalThis.fetch = async (_input, init) => { committed = true; controller.abort(); init?.signal?.throwIfAborted(); return Response.json({}); };
  await assert.rejects(saveDzmmNovel("account-a", work, null, controller.signal), /abort/i);
  assert.equal(committed, true); assert.equal(readDzmmNovelRecovery("account-a", storage)?.draft.title, work.title);
});
test("generation decodes streaming UTF-8, uses same-origin credentials and never mutates draft", async () => {
  const work = draft(), { id: _id, chapters: _chapters, ...metadata } = work; void _id; void _chapters;
  const input: DzmmNovelGenerationInput = { operation: "outline", work: metadata, model: "balanced", maxTokens: 2048 };
  const encoder = new TextEncoder(), bytes = encoder.encode("原创大纲🙂"), pieces: string[] = [];
  const before = JSON.stringify(work);
  globalThis.fetch = async (url, init) => { assert.equal(url, "/api/novel-generation"); assert.equal(init?.credentials, "same-origin");
    assert.equal(new Headers(init?.headers).get("X-Xumeng-Request-Id"), "00000000-0000-4000-8000-000000000001");
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(bytes.slice(0, 2)); stream.enqueue(bytes.slice(2, 9)); stream.enqueue(bytes.slice(9)); stream.close(); } }), { headers: { "Content-Type": "text/plain; charset=utf-8" } }); };
  await generateDzmmNovel(input, { signal: new AbortController().signal, onDelta: delta => pieces.push(delta), requestId: "00000000-0000-4000-8000-000000000001" });
  assert.equal(pieces.join(""), "原创大纲🙂"); assert.equal(JSON.stringify(work), before);
});
test("interrupted generation retains received text; JSON errors are not inserted as manuscript", async () => {
  const work = draft(), { id: _id, chapters: _chapters, ...metadata } = work; void _id; void _chapters;
  const input: DzmmNovelGenerationInput = { operation: "outline", work: metadata, model: "balanced" }, pieces: string[] = [];
  globalThis.fetch = async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode("已收到的预览")); }, pull(stream) { stream.error(new Error("连接中断")); } }), { headers: { "Content-Type": "text/plain" } });
  await assert.rejects(generateDzmmNovel(input, { signal: new AbortController().signal, onDelta: delta => pieces.push(delta) }), /连接中断/);
  assert.equal(pieces.join(""), "已收到的预览");
  globalThis.fetch = async () => Response.json({ error: "积分不足" }, { status: 402 });
  await assert.rejects(generateDzmmNovel(input, { signal: new AbortController().signal, onDelta: delta => pieces.push(delta) }), /积分不足/);
  assert.equal(pieces.join(""), "已收到的预览");
});
