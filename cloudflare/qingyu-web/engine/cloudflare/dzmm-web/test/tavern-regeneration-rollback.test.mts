import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// The web workspace uses the native TypeScript7 CLI package, which has no compiler API.
import ts from "../../../node_modules/typescript/lib/typescript.js";
import memoryModule from "../../../src/lib/dzmm-story-memory";
import memoryClientModule from "../../../src/lib/dzmm-memory-client";
import worldModule from "../../../src/lib/dzmm-world-state";
import openingModule from "../../../src/lib/dzmm-conversation-context";
import worldStreamModule from "../../../src/lib/dzmm-world-stream";
import characterModule from "../../../src/lib/dzmm-characters";
import storageModule from "../../../src/lib/dzmm-storage";
import actionsModule from "../../../src/lib/dzmm-message-actions";
import type { DzmmComposerDrafts } from "../../../src/lib/dzmm-composer-drafts";
import type { DzmmSavedConversation, DzmmSavedState } from "../../../src/lib/dzmm-storage";

const { createDzmmStoryMemory, matchesDzmmStoryMemory } = memoryModule as typeof import("../../../src/lib/dzmm-story-memory");
const { prepareDzmmRememberedRequest, DzmmMemoryRequestError } = memoryClientModule as typeof import("../../../src/lib/dzmm-memory-client");
const { appendDzmmWorldSnapshot, createDzmmWorldState, pruneDzmmWorldJournal, resolveDzmmWorldRuntime } = worldModule as typeof import("../../../src/lib/dzmm-world-state");
const { reconcileDzmmConversationOpening, applyDzmmConversationOpening, captureDzmmConversationOpening } = openingModule as typeof import("../../../src/lib/dzmm-conversation-context");
const { readDzmmWorldResponse } = worldStreamModule as typeof import("../../../src/lib/dzmm-world-stream");
const { parseCharacterImport } = characterModule as typeof import("../../../src/lib/dzmm-characters");
const { hydrateDzmmState, DZMM_INITIAL_STATE } = storageModule as typeof import("../../../src/lib/dzmm-storage");
const { createDzmmRegenerationBranch } = actionsModule as typeof import("../../../src/lib/dzmm-message-actions");

// Execute current product function bodies without mounting React, importing unrelated UI,
// or copying the mutation policy into a test double. Root separately verifies real UI/D1.
const source = fs.readFileSync(process.env.XUMENG_ROLLBACK_SOURCE
  ?? new URL("../../../src/components/dzmm/tavern-app.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("tavern-app.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function productFunction(name: string, bindings: Record<string, unknown>) {
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(found, `Product function ${name} exists`);
  const compiled = ts.transpileModule(found.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return ${name};`)(...Object.values(bindings));
}

const character = parseCharacterImport({ name: "原创测试·测绘师", description: "林岚，35岁。共同校对海港图册。", firstMessage: "地图室的窗户开着，我们先核对图例。" }, "rollback-original-cartographer");
function memory(messages: DzmmSavedConversation["messages"], label: string) {
  return createDzmmStoryMemory({ summary: label, scene: "原创地图室", completed: ["核对海港图例"],
    pending: ["整理图册"], relationships: [], items: ["海港图册"] }, messages);
}
function fixture(kind: "full" | "partial" | "none") {
  const messages: DzmmSavedConversation["messages"] = Array.from({ length: 7 }, (_, index) => ({ id: `rollback-message-${index}`,
    role: index % 2 ? "user" : "assistant", content: index === 0 ? character.firstMessage : `原创测绘记录 ${index + 1}：核对图册与图例。` }));
  const first = createDzmmWorldState(); first.location = "原创地图室"; first.facts = ["海港图例已核对"];
  first.threads = [{ id: "atlas", kind: "goal", text: "整理海港图册", status: "open", dueAtMinute: null }];
  const last = structuredClone(first); last.facts = ["海港图册已经整理完成"]; last.threads[0].status = "done";
  const journal = appendDzmmWorldSnapshot(appendDzmmWorldSnapshot(undefined, messages.slice(0, 3), first, 1000), messages, last, 2000);
  const conversation: DzmmSavedConversation = { id: "rollback-original-conversation", characterId: character.id,
    title: "原创海港图册", updatedAt: 3, messages, worldClockMode: "story", worldState: journal,
    opening: captureDzmmConversationOpening(character, 0),
    ...(kind === "none" ? {} : { storyMemory: memory(messages.slice(0, kind === "full" ? 7 : 3), "作者手动保留的完整摘要与细节。") }) };
  const hydrated = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, custom: [character], conversations: [conversation] }));
  assert.deepEqual(hydrated.warnings, []);
  assert.equal(hydrated.state.conversations.length, 1);
  return hydrated.state;
}

function wire(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}
type Scenario = "503" | "abort" | "whitespace" | "partial" | "complete" | "held-stream";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(kind: "full" | "partial" | "none", scenario: Scenario, temporaryMemory = false,
  options: { holdChat?: boolean; holdPrepare?: boolean; historical?: boolean; draft?: string; pending?: boolean } = {}) {
  let state: DzmmSavedState = fixture(kind);
  const original = structuredClone(state.conversations[0]);
  const other = { id: "rollback-other-conversation", characterId: character.id, title: "另一份原创独立记录", updatedAt: 5,
    messages: [{ id: "rollback-other-message", role: "assistant" as const, content: "这份独立记录尚未开始核对。" }] };
  state.conversations.push(other);
  let branchId = 0;
  const branch = options.historical ? createDzmmRegenerationBranch(original, original.messages[4].id,
    { now: 10, createId: () => `rollback-history-${++branchId}` }) : undefined;
  if (branch) state.conversations.push(branch);
  const targetId = branch?.id ?? original.id;
  const errors: string[] = [];
  const patched: DzmmSavedConversation[] = [];
  const submittedRequests: Awaited<ReturnType<typeof prepareDzmmRememberedRequest>>["request"][] = [];
  const preparedOptions: Parameters<typeof prepareDzmmRememberedRequest>[0][] = [];
  const chatStarted = deferred(), chatRelease = deferred(), prepareStarted = deferred(), prepareRelease = deferred(), streamStarted = deferred();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const activeAccount = { current: "original-isolated-account" };
  const composerDrafts: DzmmComposerDrafts = {
    [original.id]: { text: options.draft ?? "", failed: [], ...(options.pending ? { pending: { requestId: "older-request", text: "尚待确认的原句" } } : {}) },
    [other.id]: { text: "  另一会话草稿\n逐字保留  ", failed: [] },
  };
  const setComposerDrafts = (update: DzmmComposerDrafts | ((previous: DzmmComposerDrafts) => DzmmComposerDrafts)) => {
    const next = typeof update === "function" ? update(composerDrafts) : update;
    if (next === composerDrafts) return;
    for (const key of Object.keys(composerDrafts)) delete composerDrafts[key];
    Object.assign(composerDrafts, next);
  };
  let uid = 0, chatCalls = 0, suggestions = 0, summaryCalls = 0;
  const setState = (update: DzmmSavedState | ((previous: DzmmSavedState) => DzmmSavedState)) => {
    state = typeof update === "function" ? update(state) : update;
    const target = state.conversations.find(item => item.id === targetId);
    if (target) patched.push(structuredClone(target));
  };
  const patchMessages = productFunction("patchMessages", { setState, reconcileDzmmConversationOpening,
    appendDzmmWorldSnapshot, pruneDzmmWorldJournal, matchesDzmmStoryMemory });
  const successfulState = createDzmmWorldState(); successfulState.location = "原创新校对室";
  const send = productFunction("send", {
    loaded: true, cloud: { authBusy: false, assertAccount: () => {} }, activeAccount,
    active: original, activeCharacter: character, draft: options.draft ?? "", requestActive: { current: false }, composerDrafts,
    allowBilledConversation: () => true, uid: () => `rollback-new-${++uid}`,
    setBusy: () => {}, setNotice: () => {}, setError: (error: string) => { if (error) errors.push(error); },
    setRechargeNeeded: () => {}, setComposerDrafts, controller: { current: null },
    patchMessages, resolveDzmmWorldRuntime, applyDzmmConversationOpening, matchesDzmmStoryMemory,
    prepareDzmmRememberedRequest: async (requestOptions: Parameters<typeof prepareDzmmRememberedRequest>[0]) => {
      preparedOptions.push(requestOptions);
      const prepared = await prepareDzmmRememberedRequest({ ...requestOptions,
        memoryFetch: async () => { summaryCalls++; throw new Error("Unexpected real summary call in isolated test"); } });
      if (temporaryMemory) requestOptions.onMemory?.(memory(requestOptions.messages.slice(0, 3), "请求期间临时整理的新摘要。"));
      prepareStarted.resolve();
      if (options.holdPrepare) await prepareRelease.promise;
      return prepared;
    },
    state, setState, setSummarizing: () => {},
    fetch: async (_url: string, init: RequestInit) => {
      chatCalls++;
      submittedRequests.push(JSON.parse(String(init.body)));
      chatStarted.resolve();
      if (options.holdChat) await chatRelease.promise;
      if (scenario === "503") return Response.json({ error: "隔离回复暂不可用。" }, { status: 503 });
      if (scenario === "abort") throw new DOMException("Local abort", "AbortError");
      if (scenario === "whitespace") return wire([{ type: "text", text: " \n " }, { type: "done" }]);
      if (scenario === "partial") return wire([{ type: "text", text: "原创部分正文：图册仍待校对。" },
        { type: "world", state: successfulState, recordedAt: 4000, updated: true }, { type: "error", message: "隔离中断" }]);
      if (scenario === "held-stream") return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        streamController = controller; streamStarted.resolve();
      } }), { headers: { "Content-Type": "text/event-stream" } });
      return wire([{ type: "text", text: "原创新回复：我们来到新的校对室。" },
        { type: "world", state: successfulState, recordedAt: 4000, updated: true }, { type: "done" }]);
    },
    readDzmmWorldResponse, scheduleReplySuggestions: () => { suggestions++; },
    DzmmMemoryRequestError, billingConfig: { enabled: true }, openAccount: () => {}, setBillingRefresh: () => {},
  });
  return { original, other, branch, patchMessages, send: (regenerate = true) => send(regenerate, branch),
    current: () => state.conversations.find(item => item.id === targetId)!, state: () => state, patched, errors, preparedOptions, submittedRequests,
    chatStarted: chatStarted.promise, prepareStarted: prepareStarted.promise, streamStarted: streamStarted.promise,
    releaseChat: chatRelease.resolve, releasePrepare: prepareRelease.resolve,
    composer: () => structuredClone(composerDrafts),
    input: (text: string) => setComposerDrafts(previous => ({ ...previous, [targetId]: { ...previous[targetId], text, failed: previous[targetId]?.failed ?? [] } })),
    owner: (value: string) => { activeAccount.current = value; },
    stream: (events: unknown[]) => { for (const event of events) streamController!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); },
    endStream: () => streamController!.close(),
    calls: () => ({ chat: chatCalls, realSummary: summaryCalls, suggestions }) };
}

for (const kind of ["full", "partial", "none"] as const) test(`empty503 latest regeneration restores original ${kind} memory and all conversation metadata`, async () => {
  const f = harness(kind, "503"); await f.send();
  assert.deepEqual(f.current().messages, f.original.messages);
  assert.deepEqual(f.current().worldState, f.original.worldState);
  assert.deepEqual(f.current().opening, f.original.opening);
  assert.deepEqual(f.current().storyMemory, f.original.storyMemory);
  if (kind === "full") assert.ok(f.patched.every(c => JSON.stringify(c.messages) === JSON.stringify(f.original.messages)
    && JSON.stringify(c.storyMemory) === JSON.stringify(f.original.storyMemory)), "No empty regeneration may persist a destructive temporary prefix");
  const rehydrated = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, custom: [character], conversations: [f.current()] }));
  assert.deepEqual(rehydrated.warnings, []);
  assert.deepEqual(rehydrated.state.conversations[0].storyMemory, f.original.storyMemory);
  assert.deepEqual(f.calls(), { chat: 1, realSummary: 0, suggestions: 0 });
});

for (const scenario of ["abort", "whitespace"] as const) test(`latest regeneration ${scenario} without valid prose restores full source-matched memory`, async () => {
  const f = harness("full", scenario); await f.send();
  assert.deepEqual(f.current().messages, f.original.messages);
  assert.deepEqual(f.current().storyMemory, f.original.storyMemory);
  assert.deepEqual(f.current().worldState, f.original.worldState);
  assert.equal(f.calls().suggestions, 0);
});

for (const kind of ["full", "partial"] as const) test(`failed temporary summary cannot replace original ${kind} author-edited memory before prose or during empty rollback`, async () => {
  const f = harness(kind, "503", true); await f.send();
  assert.ok(f.patched.every(c => c.storyMemory?.state.summary !== "请求期间临时整理的新摘要。"));
  assert.deepEqual(f.current().storyMemory, f.original.storyMemory);
  assert.equal(f.current().storyMemory?.sourceCount, kind === "full" ? 7 : 3);
});

test("empty rollback with no original memory keeps a newly accepted valid prefix memory", async () => {
  const f = harness("none", "503", true); await f.send();
  assert.equal(f.current().storyMemory?.state.summary, "请求期间临时整理的新摘要。");
  assert.equal(matchesDzmmStoryMemory(f.current().storyMemory, f.current().messages), true);
  assert.deepEqual(f.current().messages, f.original.messages);
});

test("invalid explicit restore candidate never overrides a valid current prefix memory", async () => {
  const f = harness("partial", "503");
  const wrong = memory([{ id: "unrelated", role: "assistant", content: "另一份原创记录。" }], "不属于本会话的摘要。");
  f.patchMessages(f.original.id, f.original.messages, undefined, undefined, undefined, wrong);
  assert.deepEqual(f.current().storyMemory, f.original.storyMemory);
});

for (const kind of ["full", "partial"] as const) test(`valid partial regenerated prose never restores replaced assistant ${kind} summary or uncommitted world`, async () => {
  const f = harness(kind, "partial"); await f.send();
  assert.equal(f.current().messages.at(-1)?.content, "原创部分正文：图册仍待校对。");
  assert.notEqual(f.current().messages.at(-1)?.id, f.original.messages.at(-1)?.id);
  assert.deepEqual(f.current().worldState?.snapshots.map(s => s.sourceCount), [3]);
  assert.equal(f.current().worldState?.snapshots.at(-1)?.state.location, "原创地图室");
  assert.deepEqual(f.current().storyMemory, kind === "full" ? undefined : f.original.storyMemory);
  assert.equal(f.calls().suggestions, 0);
  assert.match(f.errors.at(-1)!, /回复中断/);
});

test("completed regenerated reply accepts its new world and does not restore old full summary", async () => {
  const f = harness("full", "complete"); await f.send();
  assert.equal(f.current().messages.at(-1)?.content, "原创新回复：我们来到新的校对室。");
  assert.equal(f.current().storyMemory, undefined);
  assert.equal(f.current().worldState?.snapshots.at(-1)?.state.location, "原创新校对室");
  assert.equal(f.calls().suggestions, 1);
  assert.deepEqual(f.errors, []);
});

for (const kind of ["full", "partial", "none"] as const) test(`held ${kind} regeneration preserves reloadable original state while requesting only the rewind prefix`, async () => {
  const f = harness(kind, "503", true, { holdChat: true });
  const operation = f.send();
  await f.chatStarted;
  try {
    assert.deepEqual(f.current(), f.original, "Pending regeneration must not create a destructive persisted state");
    assert.equal(f.patched.length, 0, "Temporary summaries and request prefixes stay outside saved conversation state");
    const reloaded = hydrateDzmmState(JSON.stringify(f.state()));
    assert.deepEqual(reloaded.warnings, []);
    assert.deepEqual(reloaded.state.conversations.find(c => c.id === f.original.id), f.original);
    assert.deepEqual(reloaded.state.conversations.find(c => c.id === f.other.id), f.other);
    const request = f.submittedRequests[0];
    assert.equal(request.messages.at(-1)?.role, "user");
    assert.equal(request.messages.at(-1)?.content, f.original.messages.at(-2)?.content);
    assert.equal(request.messages.some(m => m.content === f.original.messages.at(-1)?.content), false);
    assert.equal(JSON.stringify(request.world).includes("海港图册已经整理完成"), false);
    assert.equal(JSON.stringify(request.world).includes('"status":"done"'), false);
    if (kind === "full") assert.equal(request.storyMemory, undefined, "Old full-history memory is excluded from the request, not deleted from the saved state");
    assert.deepEqual(f.composer()[f.original.id], { text: "", failed: [] });
  } finally { f.releaseChat(); await operation; }
  assert.deepEqual(f.current().messages, f.original.messages);
  assert.deepEqual(f.state().conversations.find(c => c.id === f.other.id), f.other);
});

for (const kind of ["full", "partial"] as const) test(`valid partial regeneration commits its staged prefix memory and invalidates only replaced ${kind} continuity`, async () => {
  const f = harness(kind, "partial", true); await f.send();
  assert.equal(f.current().messages.at(-1)?.content, "原创部分正文：图册仍待校对。");
  assert.equal(f.current().storyMemory?.state.summary, "请求期间临时整理的新摘要。");
  assert.equal(f.current().storyMemory?.sourceCount, 3);
  assert.equal(matchesDzmmStoryMemory(f.current().storyMemory, f.current().messages), true);
  assert.deepEqual(f.current().worldState?.snapshots.map(s => s.sourceCount), [3]);
  assert.equal(JSON.stringify(f.current().worldState).includes("海港图册已经整理完成"), false);
  assert.deepEqual(f.current().opening, f.original.opening);
  const reloaded = hydrateDzmmState(JSON.stringify(f.state()));
  assert.deepEqual(reloaded.warnings, []);
  assert.deepEqual(reloaded.state.conversations.find(c => c.id === f.original.id), f.current());
  assert.deepEqual(f.state().conversations.find(c => c.id === f.other.id), f.other);
  assert.equal(f.calls().suggestions, 0);
});

test("complete regeneration commits staged memory with new world and one automatic suggestion", async () => {
  const f = harness("full", "complete", true); await f.send();
  assert.equal(f.current().storyMemory?.state.summary, "请求期间临时整理的新摘要。");
  assert.equal(matchesDzmmStoryMemory(f.current().storyMemory, f.current().messages), true);
  assert.deepEqual(f.current().worldState?.snapshots.map(s => s.sourceCount), [3, 7]);
  assert.equal(f.current().worldState?.snapshots.at(-1)?.state.location, "原创新校对室");
  assert.equal(f.calls().suggestions, 1);
});

for (const scenario of ["503", "partial", "complete"] as const) test(`historical regeneration ${scenario} keeps the original and unrelated conversation detached`, async () => {
  const f = harness("partial", scenario, true, { historical: true }); await f.send();
  assert.deepEqual(f.state().conversations.find(c => c.id === f.original.id), f.original);
  assert.deepEqual(f.state().conversations.find(c => c.id === f.other.id), f.other);
  assert.ok(f.current().messages.every(m => !f.original.messages.some(original => original.id === m.id)));
  assert.equal(f.submittedRequests[0].messages.at(-1)?.content, f.original.messages[3].content);
  assert.equal(f.submittedRequests[0].messages.some(m => m.content === f.original.messages[4].content), false);
  if (scenario === "503") assert.deepEqual(f.current().storyMemory, f.branch!.storyMemory);
  else {
    assert.equal(f.current().storyMemory?.state.summary, "请求期间临时整理的新摘要。");
    assert.equal(matchesDzmmStoryMemory(f.current().storyMemory, f.current().messages), true);
    assert.equal(matchesDzmmStoryMemory(f.current().storyMemory, f.original.messages), false, "Branch summary IDs cannot bind to source history");
  }
});

test("late regeneration memory after an account change cannot mutate state or dispatch chat", async () => {
  const f = harness("full", "503", false, { holdPrepare: true });
  const operation = f.send(); await f.prepareStarted;
  const before = structuredClone(f.state()), writes = f.patched.length;
  f.owner("another-isolated-account");
  const prepared = f.preparedOptions[0];
  prepared.onMemory?.(memory(prepared.messages.slice(0, 3), "迟到但不属于当前账号的摘要。"));
  f.releasePrepare(); await operation;
  assert.deepEqual(f.state(), before);
  assert.equal(f.patched.length, writes);
  assert.deepEqual(f.calls(), { chat: 0, realSummary: 0, suggestions: 0 });
});

test("late streamed regeneration text and completion after account change cannot replace any saved history", async () => {
  const f = harness("full", "held-stream", true);
  const operation = f.send(); await f.streamStarted;
  const before = structuredClone(f.state()), drafts = f.composer(), writes = f.patched.length;
  f.owner("another-isolated-account");
  const nextWorld = createDzmmWorldState(); nextWorld.location = "迟到的另一个地点";
  f.stream([{ type: "text", text: "迟到的替换正文。" }, { type: "world", state: nextWorld, recordedAt: 4000, updated: true }, { type: "done" }]);
  f.endStream(); await operation;
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.composer(), drafts);
  assert.equal(f.patched.length, writes);
  assert.equal(f.calls().suggestions, 0);
});

test("ordinary send still holds exact pending input and preserves the next draft after an empty failure", async () => {
  const input = "  原创新问题\n保留输入空白  ", next = "  下一句尚未发送\n原样保留  ";
  const f = harness("partial", "503", false, { holdChat: true, draft: input });
  const operation = f.send(false); await f.chatStarted;
  try {
    const pending = f.composer()[f.original.id];
    assert.equal(pending.text, "");
    assert.equal(pending.pending?.text, input);
    assert.equal(pending.pending?.requestId, "rollback-new-1");
    assert.equal(f.current().messages.at(-1)?.role, "user");
    assert.equal(f.current().messages.at(-1)?.content, input.trim());
    f.input(next);
  } finally { f.releaseChat(); await operation; }
  assert.deepEqual(f.composer()[f.original.id], { text: next, failed: [input] });
  assert.deepEqual(f.composer()[f.other.id], { text: "  另一会话草稿\n逐字保留  ", failed: [] });
  assert.deepEqual(f.current().messages, f.original.messages);
  assert.deepEqual(f.current().worldState, f.original.worldState);
  assert.equal(f.calls().chat, 1);
  assert.equal(f.calls().suggestions, 0);
});

test("ordinary send with an unconfirmed request remains blocked without mutating its draft or history", async () => {
  const f = harness("partial", "503", false, { draft: "新的原句", pending: true });
  const before = structuredClone(f.state()), drafts = f.composer(); await f.send(false);
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.composer(), drafts);
  assert.equal(f.calls().chat, 0);
  assert.match(f.errors.at(-1)!, /上次回复尚未确认/);
});
