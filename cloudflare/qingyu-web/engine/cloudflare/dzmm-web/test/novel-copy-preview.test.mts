import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// The web TypeScript7 CLI does not expose the compiler API used for extraction.
import ts from "../../../node_modules/typescript/lib/typescript.js";
import novelsModule from "../../../src/lib/dzmm-novels";
import clientModule from "../../../src/lib/dzmm-novels-client";
import type { DzmmNovelDraft, DzmmNovelDetail } from "../../../src/lib/dzmm-novels";
import type { DzmmNovelRecovery, DzmmNovelRecoveryEntry } from "../../../src/lib/dzmm-novels-client";

const { cloneDzmmNovelDraft, dzmmNovelDraftFromDetail, parseDzmmNovelDraft } = novelsModule as typeof import("../../../src/lib/dzmm-novels");
const { saveDzmmNovel, fetchDzmmNovels, fetchDzmmNovel, writeDzmmNovelRecovery, readDzmmNovelRecoveries,
  clearDzmmNovelRecovery, DzmmNovelClientError } = clientModule as typeof import("../../../src/lib/dzmm-novels-client");

const source = fs.readFileSync(process.env.XUMENG_NOVEL_COPY_SOURCE
  ?? new URL("../../../src/components/dzmm/novel-studio.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("novel-studio.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const names = ["syncRecoveries", "stash", "commit", "updateDraft", "forgetRecovery", "clearPreview", "replaceEditor", "run", "save", "insertPreview", "open"];
const selected = new Map<string, ts.FunctionDeclaration>();
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) selected.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(tree);
for (const name of names) assert.ok(selected.has(name), `Product function ${name} exists`);
const compiled = ts.transpileModule(names.map(name => selected.get(name)!.getText(tree)).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Editor = Omit<DzmmNovelRecovery, "updatedAt">;
type Preview = { accountId: string; workId: string; chapterId: string | null; operation: "outline" | "continue";
  text: string; state: "ready" | "stopped" | "failed" };
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const ACCOUNT = "novel-copy-original-account";
const PREVIEW_TEXT = "  原创预览：海风翻过目录页，测绘师在空白处记下下一段航线。\n\n 保留这些空白与🙂。  ";
function draft(): DzmmNovelDraft {
  return { id: "original-harbour-book", title: "原创测试·海港目录", synopsis: "两位成年测绘师核对航路资料。",
    type: "novel", tags: ["一般向"], notes: "依据图册线索展开。", outline: "第一章核对旧图；第二章整理新目录。",
    chapters: [{ id: "original-chapter-one", title: "旧图", content: "第一章的原创记录，不应收到续写。" },
      { id: "original-chapter-two", title: "目录", content: "第二章的原创记录，等待续写。" }] };
}
function detail(value: DzmmNovelDraft, version: number): DzmmNovelDetail {
  const { chapters, ...work } = parseDzmmNovelDraft(value);
  return { accountId: ACCOUNT, work: { ...work, version, createdAt: 1, updatedAt: version },
    chapters: chapters.map((chapter, position) => ({ ...chapter, workId: work.id, position, version, createdAt: 1, updatedAt: version })) };
}

function harness(options: { operation?: "outline" | "continue"; orphan?: boolean; previewAccount?: string; previewWork?: string;
  previewState?: Preview["state"]; noPreview?: boolean; failCreates?: number } = {}) {
  const originalDraft = draft();
  if (options.orphan) originalDraft.chapters = originalDraft.chapters.slice(0, 1);
  const original: Editor = { accountId: ACCOUNT, draft: originalDraft, baseVersion: 1, selectedChapterId: originalDraft.chapters[0].id };
  const storage = new MemoryStorage();
  const editorRef = { current: original as Editor | null }, savedEditor = { current: structuredClone(original) as Editor | null }, dirtyRef = { current: true };
  const previewRef = { current: options.noPreview ? null : { accountId: options.previewAccount ?? ACCOUNT,
    workId: options.previewWork ?? originalDraft.id, chapterId: options.operation === "outline" ? null : "original-chapter-two",
    operation: options.operation ?? "continue", text: PREVIEW_TEXT, state: options.previewState ?? "stopped" } as Preview | null };
  const activeAccount = { current: ACCOUNT }, guestRef = { current: false }, mounted = { current: true }, epoch = { current: 1 };
  const actionRef = { current: null as string | null }, controller = { current: null as AbortController | null };
  const ownRecovery = { current: null as DzmmNovelRecoveryEntry | null }, copySources = { current: new Map<string, DzmmNovelRecoveryEntry[]>() };
  const guarded: boolean[] = [], errors: string[] = [];
  let conflict = false, editorState: Editor | null = original, previewState: Preview | null = previewRef.current;
  let failCreates = options.failCreates ?? 0;
  const server = new Map<string, DzmmNovelDetail>([[originalDraft.id, detail({ ...structuredClone(originalDraft), title: "云端原创目录已更新" }, 2)]]);
  const calls: { method: string; path: string; status: number; workId?: string }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const pathname = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    assert.ok(pathname.startsWith("/api/backend/v1/novels"), "Only original isolated novel calls allowed");
    const workId = decodeURIComponent(pathname.slice("/api/backend/v1/novels/".length));
    const method = init?.method ?? "GET";
    let body: unknown, status = 200;
    if (method === "GET") {
      if (pathname === "/api/backend/v1/novels") body = { accountId: ACCOUNT, works: [...server.values()].map(row => ({ ...row.work,
        chapterCount: row.chapters.length, wordCount: row.chapters.reduce((sum, c) => sum + c.content.length, 0) })) };
      else { body = server.get(workId); assert.ok(body, "Requested original fixture exists"); }
    } else {
      const payload = JSON.parse(String(init?.body)); assert.equal(payload.accountId, ACCOUNT);
      const work = parseDzmmNovelDraft(payload.work);
      if (method === "POST" && failCreates > 0) { failCreates--; status = 503; body = { accountId: ACCOUNT, error: "隔离保存服务暂不可用。" }; }
      else if (method === "PUT" && payload.version !== server.get(work.id)?.work.version) {
        status = 409; body = { accountId: ACCOUNT, error: "隔离云端版本已更新。", current: server.get(work.id) };
      } else {
        body = detail(work, method === "POST" ? 1 : payload.version + 1); status = method === "POST" ? 201 : 200;
        server.set(work.id, structuredClone(body as DzmmNovelDetail));
      }
    }
    calls.push({ method, path: pathname, status, ...(method === "GET" ? {} : { workId: JSON.parse(String(init?.body)).work.id }) });
    return Response.json(body, { status });
  };
  const bindings = {
    editorRef, savedEditor, dirtyRef, previewRef, activeAccount, guestRef, mounted, epoch, actionRef, controller, ownRecovery, copySources,
    recoveryOwnerId: "original-test-owner", callbacks: { current: { onDirtyChange: (value: boolean) => guarded.push(value), onBusyChange: () => {} } },
    setEditor: (value: Editor | null) => { editorState = value; }, setDirty: () => {},
    setPreview: (value: Preview | null) => { previewState = value; }, setStorageError: () => {}, setRecoveries: () => {},
    setTagText: () => {}, setConflict: (value: boolean) => { conflict = value; }, setError: (value: string) => { if (value) errors.push(value); },
    setNotice: () => {}, setSelectedCharacterId: () => {}, setImportCharacterId: () => {}, setIncludeChapterContext: () => {},
    setSection: () => {}, setAction: () => {}, setLibrary: () => {}, onRequireAccount: () => { throw new Error("Unexpected authentication request"); },
    writeDzmmNovelRecovery: (value: DzmmNovelRecovery, scope: Parameters<typeof writeDzmmNovelRecovery>[1]) => writeDzmmNovelRecovery(value, scope, storage),
    readDzmmNovelRecoveries: (accountId: string) => readDzmmNovelRecoveries(accountId, storage),
    clearDzmmNovelRecovery: (entry: DzmmNovelRecoveryEntry, owner: string) => clearDzmmNovelRecovery(entry, owner, storage),
    cloneDzmmNovelDraft, saveDzmmNovel, fetchDzmmNovels, fetchDzmmNovel, dzmmNovelDraftFromDetail, DzmmNovelClientError,
    errorText: (failure: unknown) => failure instanceof Error ? failure.message : "操作失败，当前正文已保留。",
  };
  const functions = new Function(...Object.keys(bindings), `${compiled}; return { ${names.join(",")} };`)(...Object.values(bindings));
  async function execute<T>(action: () => Promise<T>): Promise<T> {
    const oldFetch = globalThis.fetch; globalThis.fetch = transport;
    try { return await action(); } finally { globalThis.fetch = oldFetch; }
  }
  functions.stash(original);
  return {
    original, calls, errors, guarded, server, storage, functions,
    editor: () => editorState!, preview: () => previewState,
    save: (copy = false): Promise<boolean> => execute(() => functions.save(copy)),
    open: (id: string): Promise<void> => execute(() => functions.open(id)),
    insert: () => functions.insertPreview(), conflict: () => conflict,
    recovery: () => readDzmmNovelRecoveries(ACCOUNT, storage),
  };
}

async function encounterConflict(f: ReturnType<typeof harness>) {
  assert.equal(await f.save(), false);
  assert.equal(f.conflict(), true);
  assert.equal(f.preview()?.text, PREVIEW_TEXT);
  assert.equal(f.calls.at(-1)?.status, 409);
}

test("copy503 after conflict keeps exact stopped preview and original manuscript/recovery", async () => {
  const f = harness({ failCreates: 1 }); await encounterConflict(f);
  assert.equal(await f.save(true), false);
  assert.equal(f.calls.at(-1)?.status, 503);
  assert.notEqual(f.editor().draft.id, f.original.draft.id);
  assert.equal(f.preview()?.text, PREVIEW_TEXT);
  assert.equal(f.preview()?.state, "stopped");
  assert.equal(f.preview()?.workId, f.editor().draft.id);
  assert.equal(f.preview()?.chapterId, f.editor().draft.chapters[1].id);
  assert.notEqual(f.preview()?.chapterId, f.original.draft.chapters[1].id);
  assert.deepEqual(f.editor().draft.chapters.map(c => c.content), f.original.draft.chapters.map(c => c.content));
  assert.equal(f.recovery().some(entry => entry.draft.id === f.original.draft.id), true);
  assert.equal(f.recovery().some(entry => entry.draft.id === f.editor().draft.id), true);
});

test("failed copy retry keeps the same copy/preview through successful save without generating another copy", async () => {
  const f = harness({ failCreates: 1, previewState: "failed" }); await encounterConflict(f);
  assert.equal(await f.save(true), false); const id = f.editor().draft.id;
  assert.equal(await f.save(), true);
  assert.equal(f.editor().draft.id, id);
  assert.equal(f.preview()?.workId, id);
  assert.equal(f.preview()?.text, PREVIEW_TEXT);
  assert.equal(f.preview()?.state, "failed");
  assert.deepEqual(f.calls.filter(c => c.method === "POST").map(c => c.workId), [id, id]);
  assert.equal(f.guarded.at(-1), true, "Uninserted preview still guards after confirmed manuscript save");
});

test("successful copy inserts preview into copied second chapter exactly once and preserves original work", async () => {
  const f = harness({ previewState: "ready" }); await encounterConflict(f);
  assert.equal(await f.save(true), true);
  const copyId = f.editor().draft.id;
  f.insert(); f.insert();
  assert.equal(f.editor().draft.chapters.length, 2);
  assert.equal(f.editor().draft.chapters[0].content, f.original.draft.chapters[0].content);
  assert.equal(f.editor().draft.chapters[1].content, `${f.original.draft.chapters[1].content}\n\n${PREVIEW_TEXT}`);
  assert.equal(f.preview(), null);
  assert.equal(await f.save(), true);
  assert.equal(f.server.get(copyId)?.chapters[1].content, `${f.original.draft.chapters[1].content}\n\n${PREVIEW_TEXT}`);
  assert.equal(f.server.get(f.original.draft.id)?.chapters[1].content, f.original.draft.chapters[1].content);
});

test("copied orphan preview stays orphaned and inserts one new chapter without targeting a surviving chapter", async () => {
  const f = harness({ orphan: true }); await encounterConflict(f);
  assert.equal(await f.save(true), true);
  assert.equal(f.preview()?.text, PREVIEW_TEXT);
  assert.equal(f.editor().draft.chapters.some(c => c.id === f.preview()?.chapterId), false);
  f.insert(); f.insert();
  assert.equal(f.editor().draft.chapters.length, 2);
  assert.equal(f.editor().draft.chapters[0].content, f.original.draft.chapters[0].content);
  assert.equal(f.editor().draft.chapters[1].content, PREVIEW_TEXT);
  assert.equal(f.preview(), null);
});

test("outline preview retains exact text and null chapter across copy503 then inserts only into copied outline", async () => {
  const f = harness({ operation: "outline", failCreates: 1 }); await encounterConflict(f);
  assert.equal(await f.save(true), false);
  assert.equal(f.preview()?.workId, f.editor().draft.id);
  assert.equal(f.preview()?.chapterId, null);
  assert.equal(f.preview()?.text, PREVIEW_TEXT);
  f.insert(); f.insert();
  assert.equal(f.editor().draft.outline, PREVIEW_TEXT);
  assert.deepEqual(f.editor().draft.chapters.map(c => c.content), f.original.draft.chapters.map(c => c.content));
  assert.equal(f.original.draft.outline, "第一章核对旧图；第二章整理新目录。");
});

for (const mismatch of ["account", "work"] as const) test(`copy never adopts a preview from the wrong ${mismatch}`, async () => {
  const f = harness(mismatch === "account" ? { previewAccount: "another-isolated-account" } : { previewWork: "another-isolated-work" });
  assert.equal(await f.save(true), true);
  assert.equal(f.preview(), null);
  f.insert();
  assert.deepEqual(f.editor().draft.chapters.map(c => c.content), f.original.draft.chapters.map(c => c.content));
});

test("ordinary verified work open still clears old uninserted preview", async () => {
  const f = harness();
  await f.open(f.original.draft.id);
  assert.equal(f.preview(), null);
  assert.equal(f.editor().draft.title, "云端原创目录已更新");
  assert.equal(f.editor().baseVersion, 2);
});

test("copy without a preview retains normal independent work/chapter save behaviour", async () => {
  const f = harness({ noPreview: true });
  assert.equal(await f.save(true), true);
  assert.equal(f.preview(), null);
  assert.notEqual(f.editor().draft.id, f.original.draft.id);
  assert.equal(f.editor().baseVersion, 1);
  assert.equal(f.editor().draft.chapters.every((c, i) => c.id !== f.original.draft.chapters[i].id), true);
  assert.deepEqual(f.editor().draft.chapters.map(c => c.content), f.original.draft.chapters.map(c => c.content));
});
