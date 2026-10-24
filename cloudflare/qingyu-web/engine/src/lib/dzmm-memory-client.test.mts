import test from "node:test";
import assert from "node:assert/strict";
import clientModule from "./dzmm-memory-client";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import memoryModule from "./dzmm-story-memory";
import type { DzmmCharacter, DzmmChatMessage } from "./dzmm-chat";
import type { DzmmStoryMemory, DzmmStoryMessage, DzmmStoryState } from "./dzmm-story-memory";

const { prepareDzmmRememberedRequest, DzmmMemoryRequestError } = clientModule as typeof import("./dzmm-memory-client");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { buildDzmmPromptPlan, validateDzmmChatInput, DZMM_REQUEST_LIMIT_BYTES } = chatModule as typeof import("./dzmm-chat");
const { createDzmmStoryMemory, matchesDzmmStoryMemory, DZMM_MEMORY_BATCH_LIMIT_CHARS } =
  memoryModule as typeof import("./dzmm-story-memory");

const character: DzmmCharacter = {
  name: "林音", description: "书店店员", personality: "安静", scenario: "雨中的书店", firstMessage: "欢迎来到书店。",
};

function history(length: number, contentLength = 0): DzmmStoryMessage[] {
  assert.equal(length % 2, 0, "This fixture ends with the user turn required for generation.");
  return Array.from({ length }, (_, index) => ({
    id: `turn-${index}`, role: index % 2 ? "user" : "assistant", content: `turn ${index}: ${"中".repeat(contentLength)}`.trimEnd(),
  }));
}

function state(label: string): DzmmStoryState {
  return { summary: label, scene: "雨中的书店", completed: ["地图已找到。"], pending: ["用户尚未决定路线。"],
    relationships: ["店员与用户初次相识。"], items: ["用户保管地图。"] };
}

function raw(messages: readonly DzmmStoryMessage[]): DzmmChatMessage[] {
  return messages.map(({ role, content }) => ({ role, content: content.trim() }));
}

type MemoryBody = { messages: DzmmChatMessage[]; previousState?: DzmmStoryState; model: string };

function summaryFetch(
  bodies: MemoryBody[],
  reply: (call: number, body: MemoryBody, init: RequestInit) => Response | Promise<Response> = call =>
    Response.json({ state: state(`model summary ${call}`) }),
): typeof fetch {
  const requestIds = new Set<string>();
  return (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "/api/memory", "Preparation must only call the memory endpoint.");
    assert.ok(init);
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Content-Type"), "application/json");
    const requestId = headers.get("X-Xumeng-Request-Id") ?? "";
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(requestIds.has(requestId), false, "Each summary batch is a distinct billed operation.");
    requestIds.add(requestId);
    const body = JSON.parse(String(init.body)) as MemoryBody;
    assert.ok(body.messages.length > 0 && body.messages.length <= 24);
    assert.ok(body.messages.reduce((sum, message) => sum + message.content.length, 0) <= DZMM_MEMORY_BATCH_LIMIT_CHARS);
    for (const message of body.messages) assert.deepEqual(Object.keys(message), ["role", "content"]);
    bodies.push(body);
    return reply(bodies.length, body, init);
  }) as typeof fetch;
}

function assertCompleteCoverage(
  full: readonly DzmmStoryMessage[],
  result: Awaited<ReturnType<typeof prepareDzmmRememberedRequest>>,
) {
  const covered = result.memory?.sourceCount ?? 0;
  assert.equal(covered + result.request.messages.length, full.length,
    "The covered prefix and raw tail must account for every original turn, without a gap or overlap.");
  assert.deepEqual(result.request.messages, raw(full.slice(covered)));
  assert.deepEqual(result.request.messages.at(-1), raw(full).at(-1));
  if (result.memory) {
    assert.equal(matchesDzmmStoryMemory(result.memory, full), true);
    assert.deepEqual(result.request.storyMemory, result.memory.state);
  }
  assert.ok(new TextEncoder().encode(JSON.stringify(result.request)).byteLength <= DZMM_REQUEST_LIMIT_BYTES);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(result.request));
  const recent = plan.messages.filter((_message, index) => plan.diagnostics.segments[index].source === "recent-history");
  assert.deepEqual(recent, result.request.messages,
    "The provider's recent-history layer must contain the complete prepared raw tail.");
}

test("short chats preserve the complete raw history without summary calls or invented memory", async () => {
  const messages = history(20);
  const before = structuredClone(messages);
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  const result = await prepareDzmmRememberedRequest({ character, messages, model: "story", preset: "自然对白",
    userPersona: "海港旅人", userName: "阿青", maxTokens: 2048, memoryFetch: summaryFetch(bodies),
    onMemory: memory => updates.push(memory) });
  assert.equal(result.summaryCalls, 0);
  assert.equal(result.memory, undefined);
  assert.equal(result.request.storyMemory, undefined);
  assert.deepEqual(bodies, []);
  assert.deepEqual(updates, []);
  assert.deepEqual(messages, before);
  assert.equal(result.request.userName, "阿青");
  assert.equal(result.request.model, "story");
  assert.equal(result.request.maxTokens, 2048);
  assert.equal(result.request.preset, "自然对白");
  assert.equal(result.request.userPersona, "海港旅人");
  assertCompleteCoverage(messages, result);
});

test("initial backfill summarizes sequential whole prefixes before exposing a complete request", async () => {
  const messages = history(100);
  const before = structuredClone(messages);
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  const result = await prepareDzmmRememberedRequest({ character, messages, model: "balanced", memoryFetch: summaryFetch(bodies),
    onMemory: memory => updates.push(memory) });
  assert.equal(result.summaryCalls, 3);
  assert.equal(bodies[0].previousState, undefined);
  assert.deepEqual(bodies[1].previousState, state("model summary 1"));
  assert.deepEqual(bodies[2].previousState, state("model summary 2"));
  assert.deepEqual(updates.map(memory => memory.sourceCount), [24, 48, 72]);
  assert.deepEqual(bodies.flatMap(body => body.messages), raw(messages.slice(0, result.memory!.sourceCount)));
  for (const memory of updates) assert.equal(matchesDzmmStoryMemory(memory, messages), true);
  assert.deepEqual(result.memory?.state, state("model summary 3"));
  assert.deepEqual(messages, before);
  assertCompleteCoverage(messages, result);
});

test("UTF-8 trimming below forty raw turns also summarizes every removed turn", async () => {
  const messages = history(40, 1_000);
  const largeCharacter = { ...character, description: "描".repeat(12_000), personality: "性".repeat(12_000) };
  const initiallyTrimmed = prepareDzmmRequest(largeCharacter, messages);
  assert.ok(initiallyTrimmed.messages.length < 40,
    "This fixture must exercise byte-budget trimming, rather than the normal forty-message window.");
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  const result = await prepareDzmmRememberedRequest({ character: largeCharacter, messages, model: "balanced",
    memoryFetch: summaryFetch(bodies), onMemory: memory => updates.push(memory) });
  assert.ok(result.summaryCalls >= 1);
  assert.ok(result.memory!.sourceCount >= messages.length - initiallyTrimmed.messages.length);
  assert.deepEqual(bodies.flatMap(body => body.messages), raw(messages.slice(0, result.memory!.sourceCount)));
  assert.equal(updates.at(-1)?.sourceCount, result.memory?.sourceCount);
  assertCompleteCoverage(messages, result);
});

test("large individual turns are summarized whole within the character cap, with complete prefix coverage", async () => {
  const messages = history(20, 10_000);
  const bodies: MemoryBody[] = [];
  const result = await prepareDzmmRememberedRequest({ character, messages, model: "balanced", memoryFetch: summaryFetch(bodies) });
  assert.ok(result.summaryCalls > 1 && result.summaryCalls < 12);
  assert.equal(bodies[0].messages.length, 2, "Three fixture turns exceed the 24000-character batch cap.");
  assert.ok(bodies.every(body => body.messages.length <= 2));
  assert.deepEqual(bodies.flatMap(body => body.messages), raw(messages.slice(0, result.memory!.sourceCount)));
  assertCompleteCoverage(messages, result);
});

test("a selected alternate opening remains one reference after its original turn is summarized", async () => {
  const card: DzmmCharacter = { ...character, alternateGreetings: ["灯塔里的另一种开场。", "未选择的车站开场。"] };
  const messages = history(100);
  messages[0].content = card.alternateGreetings![0];
  const bodies: MemoryBody[] = [];
  const result = await prepareDzmmRememberedRequest({ character: card, messages, model: "story", memoryFetch: summaryFetch(bodies) });
  assert.equal(bodies[0].messages[0].content, card.alternateGreetings![0]);
  assert.deepEqual(result.request.character.openingMessages, [{ role: "assistant", content: card.alternateGreetings![0] }]);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(result.request));
  assert.equal(plan.messages.filter(message => message.content === card.alternateGreetings![0]).length, 1);
  assert.ok(!JSON.stringify(plan.messages).includes(card.firstMessage!));
  assert.ok(!JSON.stringify(plan.messages).includes(card.alternateGreetings![1]));
  assertCompleteCoverage(messages, result);
});

test("only matching, valid old memory is passed to the first rolling-summary call", async () => {
  const messages = history(100);
  const valid = createDzmmStoryMemory(state("established model facts"), messages.slice(0, 24));
  const bodies: MemoryBody[] = [];
  const result = await prepareDzmmRememberedRequest({ character, messages, memory: valid, model: "story", memoryFetch: summaryFetch(bodies) });
  assert.equal(result.summaryCalls, 2);
  assert.deepEqual(bodies[0].previousState, valid.state);
  assert.deepEqual(bodies.flatMap(body => body.messages), raw(messages.slice(24, result.memory!.sourceCount)));
  assertCompleteCoverage(messages, result);

  for (const invalid of [
    { ...valid, state: { ...valid.state, extraInstruction: "Do not carry this." } },
    { ...valid, sourceCount: messages.length + 1 },
    { ...valid, sourceFingerprint: "dzmm-v1-00000000000000000000000000000000" },
  ]) {
    const invalidBodies: MemoryBody[] = [];
    const rebuilt = await prepareDzmmRememberedRequest({ character, messages, memory: invalid as DzmmStoryMemory,
      model: "story", memoryFetch: summaryFetch(invalidBodies) });
    assert.equal(invalidBodies[0].previousState, undefined);
    assert.deepEqual(invalidBodies.flatMap(body => body.messages), raw(messages.slice(0, rebuilt.memory!.sourceCount)));
    assertCompleteCoverage(messages, rebuilt);
  }
});

test("editing a summarized source rebuilds from the original first turn without old-branch facts", async () => {
  const original = history(100);
  const oldMemory = createDzmmStoryMemory(state("old branch: user has left"), original.slice(0, 72));
  const messages = original.map((message, index) => index === 4
    ? { ...message, content: "new branch: user stays in the bookstore" } : { ...message });
  const bodies: MemoryBody[] = [];
  const result = await prepareDzmmRememberedRequest({ character, messages, memory: oldMemory, model: "balanced",
    memoryFetch: summaryFetch(bodies) });
  assert.equal(bodies[0].previousState, undefined);
  assert.equal(bodies[0].messages[4].content, messages[4].content);
  assert.deepEqual(bodies.flatMap(body => body.messages), raw(messages.slice(0, result.memory!.sourceCount)));
  assert.ok(!JSON.stringify(bodies).includes("old branch: user has left"));
  assertCompleteCoverage(messages, result);
});

test("valid memory is reused across recent turns without a summary on every reply", async () => {
  const messages = history(100);
  const memory = createDzmmStoryMemory(state("previously summarized"), messages.slice(0, 72));
  const bodies: MemoryBody[] = [];
  const first = await prepareDzmmRememberedRequest({ character, messages, memory, model: "balanced", memoryFetch: summaryFetch(bodies) });
  assert.equal(first.summaryCalls, 0);
  assert.deepEqual(first.memory, memory);
  assertCompleteCoverage(messages, first);
  const nextHistory = [...messages,
    { id: "reply-100", role: "assistant" as const, content: "店员继续查看地图。" },
    { id: "user-101", role: "user" as const, content: "先停在书店里。" }];
  const second = await prepareDzmmRememberedRequest({ character, messages: nextHistory, memory: first.memory,
    model: "balanced", memoryFetch: summaryFetch(bodies) });
  assert.equal(second.summaryCalls, 0);
  assert.deepEqual(second.memory, memory);
  assert.deepEqual(bodies, []);
  assertCompleteCoverage(nextHistory, second);
});

test("a failed later batch keeps successful onMemory progress and never exposes a chat-ready request", async () => {
  const messages = history(100);
  const before = structuredClone(messages);
  for (const failure of ["http", "network", "invalid-json", "invalid-state"] as const) {
    const bodies: MemoryBody[] = [];
    const updates: DzmmStoryMemory[] = [];
    let chatStarts = 0;
    const memoryFetch = summaryFetch(bodies, call => {
      if (call === 1) return Response.json({ state: state("saved successful batch") });
      if (failure === "http") return Response.json({ error: "summary temporarily unavailable" }, { status: 503 });
      if (failure === "network") throw new TypeError("network interrupted");
      if (failure === "invalid-json") return new Response("{broken", { status: 200 });
      return Response.json({ state: { ...state("invalid second batch"), items: "wrong" } });
    });
    const preparation = prepareDzmmRememberedRequest({ character, messages, model: "balanced", memoryFetch,
      onMemory: memory => updates.push(memory) }).then(result => { chatStarts++; return result; });
    await assert.rejects(preparation);
    assert.equal(chatStarts, 0, `${failure} must stop downstream reply generation.`);
    assert.equal(bodies.length, 2);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].sourceCount, 24);
    assert.deepEqual(updates[0].state, state("saved successful batch"));
    assert.equal(matchesDzmmStoryMemory(updates[0], messages), true);
    assert.deepEqual(messages, before);
    const resumeBodies: MemoryBody[] = [];
    const resumed = await prepareDzmmRememberedRequest({ character, messages, memory: updates[0], model: "balanced",
      memoryFetch: summaryFetch(resumeBodies) });
    assert.deepEqual(resumeBodies[0].messages[0], raw(messages)[24]);
    assert.deepEqual(resumeBodies[0].previousState, updates[0].state);
    assertCompleteCoverage(messages, resumed);
  }
});

test("abort forwards the signal, preserves earlier successful memory, and prevents reply generation", async () => {
  const messages = history(100);
  const controller = new AbortController();
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  let chatStarts = 0;
  const memoryFetch = summaryFetch(bodies, (call, _body, init) => {
    assert.equal(init.signal, controller.signal);
    if (call === 1) return Response.json({ state: state("successful batch before abort") });
    controller.abort();
    throw controller.signal.reason;
  });
  await assert.rejects(prepareDzmmRememberedRequest({ character, messages, model: "balanced", memoryFetch,
    signal: controller.signal, onMemory: memory => updates.push(memory) }).then(result => { chatStarts++; return result; }),
  { name: "AbortError" });
  assert.equal(chatStarts, 0);
  assert.equal(bodies.length, 2);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].sourceCount, 24);
  assert.equal(matchesDzmmStoryMemory(updates[0], messages), true);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const unusedBodies: MemoryBody[] = [];
  await assert.rejects(prepareDzmmRememberedRequest({ character, messages, model: "balanced", signal: alreadyAborted.signal,
    memoryFetch: summaryFetch(unusedBodies) }), { name: "AbortError" });
  assert.deepEqual(unusedBodies, []);
});

test("large backfills stop at twelve calls, preserve resumable prefixes, and resume without gaps", async () => {
  const messages = history(700);
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  let memory: DzmmStoryMemory | undefined;
  let chatStarts = 0;
  for (const expectedCoverage of [288, 576]) {
    const beforeCalls = bodies.length;
    await assert.rejects(prepareDzmmRememberedRequest({ character, messages, memory, model: "balanced",
      memoryFetch: summaryFetch(bodies), onMemory: updated => { memory = updated; updates.push(updated); } })
      .then(result => { chatStarts++; return result; }), /已保存整理进度/);
    assert.equal(bodies.length - beforeCalls, 12);
    assert.equal(memory?.sourceCount, expectedCoverage);
    assert.equal(chatStarts, 0);
    assert.equal(matchesDzmmStoryMemory(memory, messages), true);
  }
  const result = await prepareDzmmRememberedRequest({ character, messages, memory, model: "balanced",
    memoryFetch: summaryFetch(bodies), onMemory: updated => { memory = updated; updates.push(updated); } });
  assert.equal(result.summaryCalls, 4);
  assert.equal(result.memory?.sourceCount, 672);
  assert.equal(updates.length, 28);
  assert.deepEqual(bodies.flatMap(body => body.messages), raw(messages.slice(0, 672)));
  assertCompleteCoverage(messages, result);
});


test("summary insufficient credit preserves earlier progress and its HTTP status for recharge recovery", async () => {
  const messages = history(100);
  const original = structuredClone(messages);
  const updates: DzmmStoryMemory[] = [];
  const bodies: MemoryBody[] = [];
  await assert.rejects(prepareDzmmRememberedRequest({ character, messages, model: "balanced",
    memoryFetch: summaryFetch(bodies, call => call === 1 ? Response.json({ state: state("saved first batch") })
      : Response.json({ error: "Credit balance cannot cover reservation" }, { status: 402 })),
    onMemory: memory => updates.push(memory),
  }), error => error instanceof DzmmMemoryRequestError && error.status === 402 && /原始对话仍已保留/.test(error.message));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].sourceCount, 24);
  assert.ok(matchesDzmmStoryMemory(updates[0], messages));
  assert.deepEqual(messages, original);
});

test("short multi-openings omit author-only assistant turns without creating a summary or changing original history", async () => {
  const note = "作者备注：AUTHOR_METADATA_ONLY，请查看更新说明。";
  const opening = [{ role: "assistant" as const, content: note },
    { role: "user" as const, content: "我走进成年工匠的钟表铺。" },
    { role: "assistant" as const, content: "工匠打开工具箱。\nPS：作者注：AUTHOR_METADATA_ONLY" }];
  const card = { ...character, firstMessage: note, openingMessages: opening };
  const messages = [...opening, { role: "user" as const, content: "我检查齿轮。" }]
    .map((message, index) => ({ ...message, id: `short-author-${index}` }));
  const before = structuredClone(messages);
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  const result = await prepareDzmmRememberedRequest({ character: card, messages, model: "fast",
    memoryFetch: summaryFetch(bodies), onMemory: update => updates.push(update) });
  assert.equal(result.summaryCalls, 0);
  assert.equal(result.memory, undefined);
  assert.deepEqual(bodies, []);
  assert.deepEqual(updates, []);
  assert.deepEqual(result.request.messages, [{ role: "user", content: opening[1].content },
    { role: "assistant", content: "工匠打开工具箱。" }, { role: "user", content: "我检查齿轮。" }]);
  assert.ok(!JSON.stringify(result.request).includes("AUTHOR_METADATA_ONLY"));
  assert.deepEqual(messages, before);
});

test("long legacy PS openings are cleaned in summary payloads while memory fingerprints cover exact original messages", async () => {
  const body = "成年工匠将钟摆放在桌上。";
  const card = { ...character, firstMessage: `${body}\nPS：作者注：AUTHOR_METADATA_ONLY` };
  const messages = history(100);
  messages[0].content = card.firstMessage;
  const before = structuredClone(messages);
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  const result = await prepareDzmmRememberedRequest({ character: card, messages, model: "fast",
    memoryFetch: summaryFetch(bodies), onMemory: update => updates.push(update) });
  assert.ok(result.summaryCalls > 0);
  const expected = raw(messages.slice(0, result.memory!.sourceCount));
  expected[0].content = body;
  assert.deepEqual(bodies.flatMap(value => value.messages), expected);
  assert.ok(!JSON.stringify(bodies).includes("AUTHOR_METADATA_ONLY"));
  for (const memory of updates) assert.equal(matchesDzmmStoryMemory(memory, messages), true);
  assert.equal(result.memory!.sourceFingerprint,
    createDzmmStoryMemory(result.memory!.state, messages.slice(0, result.memory!.sourceCount)).sourceFingerprint);
  assert.equal(matchesDzmmStoryMemory(result.memory, messages.map((message, index) => index === 0 ? { ...message, content: body } : message)), false);
  assert.deepEqual(result.request.messages, raw(messages.slice(result.memory!.sourceCount)));
  assert.ok(!JSON.stringify(buildDzmmPromptPlan(validateDzmmChatInput(result.request))).includes("AUTHOR_METADATA_ONLY"));
  assert.deepEqual(messages, before);
});

test("summary failure and retry resume raw-prefix coverage without resending legacy author PS or losing saved progress", async () => {
  const body = "成年工匠让旅人看看旧钟。";
  const card = { ...character, firstMessage: `${body}\nPS：作者注：AUTHOR_METADATA_ONLY` };
  const messages = history(100);
  messages[0].content = card.firstMessage;
  const before = structuredClone(messages);
  const bodies: MemoryBody[] = [];
  const updates: DzmmStoryMemory[] = [];
  await assert.rejects(prepareDzmmRememberedRequest({ character: card, messages, model: "fast",
    memoryFetch: summaryFetch(bodies, call => call === 1 ? Response.json({ state: state("saved clean first batch") })
      : Response.json({ error: "temporary outage" }, { status: 503 })),
    onMemory: update => updates.push(update),
  }), error => error instanceof DzmmMemoryRequestError && error.status === 503);
  assert.equal(updates.length, 1);
  assert.equal(matchesDzmmStoryMemory(updates[0], messages), true);
  assert.equal(bodies[0].messages[0].content, body);
  assert.ok(!JSON.stringify(bodies).includes("AUTHOR_METADATA_ONLY"));
  const resumedBodies: MemoryBody[] = [];
  const resumed = await prepareDzmmRememberedRequest({ character: card, messages, memory: updates[0], model: "fast",
    memoryFetch: summaryFetch(resumedBodies) });
  assert.deepEqual(resumedBodies[0].messages[0], raw(messages)[updates[0].sourceCount]);
  assert.deepEqual(resumedBodies[0].previousState, updates[0].state);
  const expected = raw(messages.slice(0, resumed.memory!.sourceCount));
  expected[0].content = body;
  assert.deepEqual([...bodies[0].messages, ...resumedBodies.flatMap(value => value.messages)], expected);
  assert.equal(matchesDzmmStoryMemory(resumed.memory, messages), true);
  assert.ok(!JSON.stringify(resumedBodies).includes("AUTHOR_METADATA_ONLY"));
  assert.deepEqual(messages, before);
});

test("existing memory partly covering a multi-opening retains original indices while skipping later author-only turns", async () => {
  const opening = [{ role: "assistant" as const, content: "作者备注：AUTHOR_METADATA_ONLY_A" },
    { role: "user" as const, content: "我来到成年工匠的钟表铺。" },
    { role: "assistant" as const, content: "作者备注：AUTHOR_METADATA_ONLY_B" },
    { role: "assistant" as const, content: "工匠递来旧钟。\nPS：作者注：AUTHOR_METADATA_ONLY_C" }];
  const card = { ...character, firstMessage: opening[0].content, openingMessages: opening };
  const messages = history(100).map((message, index) => index < opening.length ? { ...message, ...opening[index] } : message);
  const before = structuredClone(messages);
  const previous = createDzmmStoryMemory(state("known visit"), messages.slice(0, 2));
  const bodies: MemoryBody[] = [];
  const result = await prepareDzmmRememberedRequest({ character: card, messages, memory: previous, model: "fast",
    memoryFetch: summaryFetch(bodies) });
  assert.deepEqual(bodies[0].previousState, previous.state);
  assert.deepEqual(bodies[0].messages[0], { role: "assistant", content: "工匠递来旧钟。" });
  const expected = raw(messages.slice(3, result.memory!.sourceCount));
  expected[0].content = "工匠递来旧钟。";
  assert.deepEqual(bodies.flatMap(value => value.messages), expected);
  assert.equal(matchesDzmmStoryMemory(result.memory, messages), true);
  assert.deepEqual(result.request.messages, raw(messages.slice(result.memory!.sourceCount)));
  assert.ok(!JSON.stringify(bodies).includes("AUTHOR_METADATA_ONLY"));
  assert.deepEqual(messages, before);
});

test("author-only summary batches advance exact raw coverage locally and preserve existing facts without model calls", async () => {
  const notePrefix = "作者备注：";
  const opening = Array.from({ length: 20 }, () => ({ role: "assistant" as const,
    content: notePrefix + "x".repeat(12000 - notePrefix.length) }));
  const card = { ...character, firstMessage: opening[0].content, openingMessages: opening };
  const messages = history(100).map((message, index) => index < opening.length ? { ...message, ...opening[index] } : message);
  const before = structuredClone(messages);
  const established = createDzmmStoryMemory(state("established ordinary facts"), messages.slice(0, 2));
  for (const previous of [undefined, established]) {
    const knownState = previous?.state ?? { summary: "", scene: "", completed: [], pending: [], relationships: [], items: [] };
    const bodies: MemoryBody[] = [];
    const updates: DzmmStoryMemory[] = [];
    let summaryStarts = 0;
    const result = await prepareDzmmRememberedRequest({ character: card, messages, memory: previous, model: "fast",
      memoryFetch: summaryFetch(bodies), onMemory: update => updates.push(update), onSummaryStart: () => summaryStarts++ });
    const localUpdates = updates.filter(update => update.sourceCount <= 20);
    assert.ok(localUpdates.length > 0);
    for (const update of localUpdates) {
      assert.deepEqual(update.state, knownState);
      assert.equal(matchesDzmmStoryMemory(update, messages), true);
    }
    assert.equal(localUpdates.at(-1)?.sourceCount, 20);
    assert.equal(result.summaryCalls, bodies.length);
    assert.equal(summaryStarts, bodies.length);
    assert.deepEqual(bodies[0].previousState, knownState);
    assert.deepEqual(bodies.flatMap(value => value.messages), raw(messages.slice(20, result.memory!.sourceCount)));
    assert.equal(matchesDzmmStoryMemory(result.memory, messages), true);
    assert.deepEqual(result.request.messages, raw(messages.slice(result.memory!.sourceCount)));
    assert.deepEqual(messages, before);
  }
});
