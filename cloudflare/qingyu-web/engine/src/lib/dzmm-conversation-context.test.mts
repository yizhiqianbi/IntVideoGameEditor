import test from "node:test";
import assert from "node:assert/strict";
import conversationModule from "./dzmm-conversation-context";
import characterModule from "./dzmm-characters";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import memoryModule from "./dzmm-story-memory";
import type { DzmmSavedConversation, DzmmSavedMessage } from "./dzmm-storage";

const { applyDzmmConversationOpening, captureDzmmConversationOpening, parseDzmmConversationOpening,
  reconcileDzmmConversationOpening, resolveDzmmConversationOpening, restoreDzmmConversationContexts } = conversationModule as typeof import("./dzmm-conversation-context");
const { parseCharacterImport } = characterModule as typeof import("./dzmm-characters");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { buildDzmmPromptPlan, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { createDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");

const original = parseCharacterImport({ name: "地图员", description: "延续已经发生的相遇。", firstMessage: "主开场：书店。",
  openingMessages: [{ role: "user", content: "我来到书店。" }, { role: "assistant", content: "主开场：书店。" }],
  alternateGreetings: ["备选开场：灯塔。"] }, "local-opening-test");
const edited = { ...original, firstMessage: "新版开场：医院。", openingMessages: [{ role: "assistant" as const, content: "新版开场：医院。" }],
  alternateGreetings: ["新版备选：车站。"] };
const memoryState = { summary: "已在灯塔发现纸条。", scene: "灯塔", completed: ["发现纸条"], pending: ["核对纸条"], relationships: [], items: ["纸条"] };

function saved(index = 0): DzmmSavedConversation {
  const opening = captureDzmmConversationOpening(original, index);
  return { id: `conversation-${index}`, characterId: original.id, title: "地图", updatedAt: 1234, opening,
    messages: opening.messages.map((message, position) => ({ ...message, id: `opening-${index}-${position}` })) };
}
function planFor(character: typeof original, conversation: DzmmSavedConversation, storyMemory = conversation.storyMemory) {
  const request = prepareDzmmRequest(applyDzmmConversationOpening(character, conversation), conversation.messages,
    undefined, undefined, "balanced", undefined, { userName: "旅人", storyMemory });
  return { request, plan: buildDzmmPromptPlan(validateDzmmChatInput(request)) };
}
function storyTurns(plan: ReturnType<typeof buildDzmmPromptPlan>) {
  return plan.messages.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source));
}

test("new primary and alternate conversations capture only their chosen raw opening and independent arrays", () => {
  const primary = captureDzmmConversationOpening(original);
  const alternate = captureDzmmConversationOpening(original, 1);
  assert.deepEqual(primary.messages, original.openingMessages);
  assert.notEqual(primary.messages, original.openingMessages);
  assert.notEqual(primary.messages[0], original.openingMessages?.[0]);
  assert.deepEqual(alternate.messages, [{ role: "assistant", content: "备选开场：灯塔。" }]);
  assert.equal(alternate.source, "template");
  assert.equal(Object.hasOwn(alternate, "description"), false);
  assert.throws(() => captureDzmmConversationOpening(original, 2), /不存在/);
});

test("editing a card keeps a prior conversation's full opening while a new conversation receives the new opening", () => {
  const conversation = saved();
  conversation.messages.push({ id: "question", role: "user", content: "找一本书。" });
  const before = JSON.stringify({ edited, conversation });
  const { request, plan } = planFor(edited, conversation);
  assert.deepEqual(storyTurns(plan), conversation.messages.map(({ role, content }) => ({ role, content })));
  assert.ok(!JSON.stringify(storyTurns(plan)).includes("医院"));
  assert.deepEqual(request.character.openingMessages, original.openingMessages);
  assert.equal(resolveDzmmConversationOpening(edited, conversation), conversation.opening);
  assert.equal(JSON.stringify({ edited, conversation }), before);
  const newOpening = captureDzmmConversationOpening(edited);
  assert.deepEqual(newOpening.messages, edited.openingMessages);
  assert.notDeepEqual(newOpening.messages, conversation.opening?.messages);
});

test("a chosen alternate survives memory compaction and later edits to every card opening", () => {
  const conversation = saved(1);
  conversation.messages.push(...Array.from({ length: 59 }, (_, index): DzmmSavedMessage => ({ id: `turn-${index}`,
    role: index % 2 ? "assistant" : "user", content: `灯塔后续${index}` })));
  conversation.storyMemory = createDzmmStoryMemory(memoryState, conversation.messages.slice(0, 32));
  const { request, plan } = planFor(edited, conversation);
  assert.deepEqual(request.messages, conversation.messages.slice(32).map(({ role, content }) => ({ role, content })));
  assert.deepEqual(storyTurns(plan), [{ role: "assistant", content: "备选开场：灯塔。" }, ...request.messages]);
  assert.equal(storyTurns(plan).filter(message => message.content === "备选开场：灯塔。").length, 1);
  assert.ok(!JSON.stringify(storyTurns(plan)).includes("医院"));
  assert.ok(!JSON.stringify(storyTurns(plan)).includes("车站"));
  assert.equal(plan.diagnostics.hasMemory, true);
});

test("editing or removing an opening turn keeps the edited real history and never reinserts the old template", () => {
  const originalConversation = saved();
  originalConversation.messages.push({ id: "latest", role: "user", content: "继续。" });
  for (const messages of [
    originalConversation.messages.map((message, index) => index === 0 ? { ...message, content: "我改在车站等候，牌子写着 {{user}}。" } : message),
    originalConversation.messages.slice(1),
    originalConversation.messages.filter((_message, index) => index !== 1),
  ]) {
    const conversation = { ...originalConversation, messages };
    const opening = resolveDzmmConversationOpening(edited, conversation);
    assert.equal(opening.source, "history");
    assert.deepEqual(opening.messages, []);
    const { plan } = planFor(edited, conversation);
    assert.deepEqual(storyTurns(plan), messages.map(({ role, content }) => ({ role, content })));
    assert.equal(plan.diagnostics.segments.filter(segment => segment.source === "opening").length, 0);
    const pinned = restoreDzmmConversationContexts([conversation], [edited]);
    assert.deepEqual(pinned[0].opening, opening);
    assert.equal(pinned[0].messages, messages);
  }
  const emptied = { ...originalConversation, messages: [], opening: reconcileDzmmConversationOpening(originalConversation.opening!, []) };
  assert.equal(emptied.opening.source, "history");
  assert.equal(restoreDzmmConversationContexts([emptied], [edited])[0], emptied, "An explicitly deleted opening must not be restored.");
  assert.deepEqual(originalConversation.opening?.messages, original.openingMessages);
  const duringRegeneration = { ...originalConversation, messages: originalConversation.messages.filter((_message, index) => index !== 1),
    opening: reconcileDzmmConversationOpening(originalConversation.opening!, originalConversation.messages.filter((_message, index) => index !== 1)) };
  assert.equal(duringRegeneration.opening.source, "history");
  const rolledBack = { ...duringRegeneration, messages: originalConversation.messages, opening: originalConversation.opening };
  assert.equal(resolveDzmmConversationOpening(edited, rolledBack), originalConversation.opening, "A failed regeneration restores the original template together with its real history.");
});

test("legacy migration recognizes complete primary and alternate prefixes and leaves unknown original history literal", () => {
  const primary = saved();
  const alternate = saved(1);
  delete primary.opening;
  delete alternate.opening;
  const unknown: DzmmSavedConversation = { ...primary, id: "unknown", messages: [
    { id: "old-scene", role: "assistant", content: "旧书店留下字面 {{user}}。" },
    { id: "old-user", role: "user", content: "继续读 {{char}}。" }], storyMemory: undefined };
  const absent = { ...unknown, id: "not-loaded", characterId: "absent-character" };
  const before = JSON.stringify([primary, alternate, unknown, absent]);
  const contexts = restoreDzmmConversationContexts([primary, alternate, unknown, absent], [original], {
    createId: () => { throw new Error("Populated history must not receive new IDs."); },
    now: () => { throw new Error("Pinning metadata must not change conversation time."); },
  });
  assert.equal(contexts[0].opening?.source, "template");
  assert.deepEqual(contexts[0].opening?.messages, original.openingMessages);
  assert.deepEqual(contexts[1].opening?.messages, [{ role: "assistant", content: "备选开场：灯塔。" }]);
  assert.deepEqual(contexts[2].opening, { version: 1, kind: "opening", source: "history", messages: [] });
  assert.equal(contexts[3], absent);
  assert.deepEqual(contexts.map(conversation => conversation.messages), [primary, alternate, unknown, absent].map(conversation => conversation.messages));
  assert.equal(restoreDzmmConversationContexts(contexts, [edited]), contexts);
  const { plan } = planFor(edited, contexts[2]);
  assert.deepEqual(storyTurns(plan), unknown.messages.map(({ role, content }) => ({ role, content })));
  assert.equal(plan.diagnostics.segments.filter(segment => segment.source === "opening").length, 0);
  assert.equal(JSON.stringify([primary, alternate, unknown, absent]), before);
  assert.equal(resolveDzmmConversationOpening(original, { messages: [primary.messages[0]] }).source, "history", "A partial multi-turn match is insufficient.");
});

test("empty conversations restore their saved alternate with unique IDs and retain literal history opt-outs", () => {
  const populated = saved();
  const empty = { ...saved(1), messages: [], storyMemory: createDzmmStoryMemory(memoryState, saved(1).messages) };
  const literal: DzmmSavedConversation = { ...empty, id: "literal-empty", storyMemory: undefined,
    opening: { version: 1, kind: "opening", source: "history", messages: [] } };
  const contexts = restoreDzmmConversationContexts([populated, empty, literal], [edited], { createId: () => populated.messages[0].id, now: () => 9000 });
  assert.equal(contexts[0], populated);
  assert.equal(contexts[1].messages[0].content, "备选开场：灯塔。");
  assert.notEqual(contexts[1].messages[0].id, populated.messages[0].id);
  assert.equal(contexts[1].updatedAt, 9000);
  assert.equal(contexts[1].storyMemory, undefined);
  assert.equal(contexts[2], literal);
  assert.equal(restoreDzmmConversationContexts(contexts, [edited]), contexts);
});

test("opening templates expand macros once while recent history and legacy snapshots retain literal placeholders", () => {
  const character = { ...original, openingMessages: [{ role: "assistant" as const, content: "{{char}}向{{user}}递来地图。" }] };
  const opening = captureDzmmConversationOpening(character);
  assert.equal(opening.messages[0].content, "{{char}}向{{user}}递来地图。");
  const conversation: DzmmSavedConversation = { ...saved(), opening, messages: [
    { ...opening.messages[0], id: "macro-opening" }, { id: "literal-user", role: "user", content: "地图写着字面 {{user}} 和 {{char}}。" }] };
  const { plan } = planFor(edited, conversation);
  assert.deepEqual(storyTurns(plan), [{ role: "assistant", content: "地图员向旅人递来地图。" },
    { role: "user", content: "地图写着字面 {{user}} 和 {{char}}。" }]);
});

test("branches and exported/imported snapshots preserve the old selected scene independently of message IDs", () => {
  const conversation = saved(1);
  conversation.messages.push({ id: "latest", role: "user", content: "读纸条。" });
  const branch = { ...conversation, id: "branch", opening: parseDzmmConversationOpening(conversation.opening),
    messages: conversation.messages.map(message => ({ ...message, id: `branch-${message.id}` })) };
  const exported = JSON.stringify({ character: edited, messages: branch.messages, opening: branch.opening });
  const imported = JSON.parse(exported);
  const importedCharacter = parseCharacterImport(imported.character);
  const reimported = { ...branch, id: "reimported", characterId: importedCharacter.id,
    opening: parseDzmmConversationOpening(imported.opening), messages: imported.messages.map((message: DzmmSavedMessage) => ({ ...message, id: `import-${message.id}` })) };
  assert.notEqual(branch.opening.messages, conversation.opening?.messages);
  assert.deepEqual(reimported.opening, conversation.opening);
  assert.deepEqual(storyTurns(planFor(importedCharacter, reimported).plan), conversation.messages.map(({ role, content }) => ({ role, content })));
});

test("snapshot parsing rejects oversized or invalid optional metadata without promoting history to a template", () => {
  const valid = captureDzmmConversationOpening(original, 1);
  for (const invalid of [null, [], { ...valid, version: 2 }, { ...valid, kind: "invented" }, { ...valid, source: "unknown" },
    { ...valid, source: "history" }, { ...valid, messages: [] }, { ...valid, messages: Array(21).fill(valid.messages[0]) },
    { ...valid, messages: [{ role: "system", content: "Invalid role" }] }, { ...valid, messages: [{ role: "assistant", content: "" }] },
    { ...valid, messages: [{ role: "assistant", content: "x\0" }] }, { ...valid, messages: [{ role: "assistant", content: "x".repeat(12_001) }] },
    { ...valid, messages: Array(8).fill({ role: "assistant", content: "中".repeat(12_000) }) },
  ]) assert.throws(() => parseDzmmConversationOpening(invalid));
  assert.equal(parseDzmmConversationOpening({ ...valid, messages: [{ role: "assistant", content: "x".repeat(12_000) }] }).messages[0].content.length, 12_000);
  assert.deepEqual(parseDzmmConversationOpening({ version: 1, kind: "opening", source: "history", messages: [] }).messages, []);
});
