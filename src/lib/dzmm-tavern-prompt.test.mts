import test from "node:test";
import assert from "node:assert/strict";
import chatModule from "./dzmm-chat";

const { buildDzmmPromptPlan, validateDzmmChatInput, xumengAdultWritingPrompt } = chatModule as typeof import("./dzmm-chat");

const request = {
  character: {
    name: "林霜",
    description: "CHARACTER_DESCRIPTION",
    personality: "冷静。",
    scenario: "办公室。",
    systemPrompt: "",
    characterBook: { entries: [
      { keys: [], constant: true, position: "before_char" as const, content: "BEFORE_LORE" },
      { keys: [], constant: true, position: "after_char" as const, content: "AFTER_LORE" },
    ] },
  },
  messages: [{ role: "assistant" as const, content: "开场。" }, { role: "user" as const, content: "靠近她。" }],
  userName: "你",
  userPersona: "出差的同事。",
  promptStyle: "tavern" as const,
};

test("tavern assembly keeps SillyTavern order and puts Xumeng adult writing last", () => {
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
  assert.equal(plan.diagnostics.version, "tavern-st-default+xumeng-adult");
  assert.equal(plan.messages[0].content, "Write 林霜's next reply in a fictional chat between 林霜 and 你.");
  assert.deepEqual(plan.diagnostics.segments.map(segment => segment.source), [
    "main", "worldInfoBefore", "personaDescription", "charDescription", "charPersonality", "scenario", "worldInfoAfter", "chatHistory", "chatHistory", "chatHistory", "jailbreak",
  ]);
  assert.equal(plan.messages.at(-1)?.content, xumengAdultWritingPrompt());
  assert.match(plan.messages.at(-1)!.content, /让读者活在身体里/);
  assert.ok(!plan.messages[0].content.includes("我是叙梦的专属 AI"));
  assert.ok(!JSON.stringify(plan.messages.slice(0, -1)).includes("让读者活在身体里"));
  assert.match(plan.messages.find(message => message.content.includes("BEFORE_LORE"))!.content, /BEFORE_LORE/);
  assert.ok(plan.messages.findIndex(message => message.content === "BEFORE_LORE") < plan.messages.findIndex(message => message.content === "CHARACTER_DESCRIPTION"));
  assert.ok(plan.messages.findIndex(message => message.content === "CHARACTER_DESCRIPTION") < plan.messages.findIndex(message => message.content === "AFTER_LORE"));
});

test("the existing Xumeng plan stays the default", () => {
  const { promptStyle: _ignored, ...current } = request;
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(current));
  assert.notEqual(plan.diagnostics.version, "tavern-st-default+xumeng-adult");
  assert.match(plan.messages[0].content, /我是叙梦的专属 AI/);
  assert.match(plan.messages[0].content, /让读者活在身体里/);
});

test("a card system prompt replaces the tavern main line", () => {
  const plan = buildDzmmPromptPlan(validateDzmmChatInput({ ...request, character: { ...request.character, systemPrompt: "CARD_SYSTEM" } }));
  assert.equal(plan.messages[0].content, "CARD_SYSTEM");
  assert.equal(plan.messages.at(-1)?.content, xumengAdultWritingPrompt());
});
