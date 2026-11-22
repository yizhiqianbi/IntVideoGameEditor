import test from "node:test";
import assert from "node:assert/strict";
import promptModule from "./prompt";
import worldbookModule from "./worldbook";

const { TAVERN_PROMPT_SECTIONS, buildTavernPromptPlan } = promptModule as typeof import("./prompt");
const { parseTavernWorldbook } = worldbookModule as typeof import("./worldbook");

const book = parseTavernWorldbook({ entries: [
  { id: "before", keys: ["a"], content: "BEFORE_LORE", position: "before_char" },
  { id: "after", keys: ["a"], content: "AFTER_LORE", position: "after_char" },
  { id: "depth", keys: [], constant: true, content: "DEPTH_LORE", extensions: { position: 4, depth: 2, role: 0 } },
] });

const baseInput = {
  characterName: "裴聿",
  userName: "楚曦",
  main: "MAIN_SYSTEM",
  charDescription: "CHAR_DESCRIPTION",
  charPersonality: "CHAR_PERSONALITY",
  scenario: "SCENARIO",
  personaDescription: "PERSONA",
  preset: "PRESET",
  worldInfoBefore: book.entries.filter(entry => entry.content === "BEFORE_LORE"),
  worldInfoAfter: book.entries.filter(entry => entry.content === "AFTER_LORE"),
  worldInfoAtDepth: book.entries.filter(entry => entry.content === "DEPTH_LORE").map(entry => ({ entry, depth: 2, role: "system" as const })),
  dialogueExamples: [{ role: "system" as const, content: "EXAMPLE_DIALOGUE" }],
  opening: [{ role: "assistant" as const, content: "OPENING" }],
  history: [
    { role: "user" as const, content: "USER_1" },
    { role: "assistant" as const, content: "ASSISTANT_1" },
    { role: "user" as const, content: "USER_2" },
    { role: "assistant" as const, content: "ASSISTANT_2" },
  ],
  memory: "MEMORY",
  authorNote: { content: "AUTHOR_NOTE", depth: 1, role: "system" as const },
  postHistoryInstructions: "POST_HISTORY",
  statusPanel: "STATUS_PANEL",
  jailbreak: "JAILBREAK",
};

test("default order follows the SillyTavern prompt manager", () => {
  const plan = buildTavernPromptPlan(baseInput);
  const order = plan.messages.map(message => message.content);
  for (const item of ["MAIN_SYSTEM", "BEFORE_LORE", "PERSONA", "CHAR_DESCRIPTION", "CHAR_PERSONALITY", "SCENARIO", "PRESET", "AFTER_LORE", "EXAMPLE_DIALOGUE", "OPENING", "USER_1", "ASSISTANT_1", "USER_2", "ASSISTANT_2"]) {
    assert.ok(order.includes(item), `missing ${item}`);
  }
  assert.ok(order.indexOf("MAIN_SYSTEM") < order.indexOf("CHAR_DESCRIPTION"));
  assert.ok(order.indexOf("BEFORE_LORE") < order.indexOf("CHAR_DESCRIPTION"));
  assert.ok(order.indexOf("AFTER_LORE") > order.indexOf("PRESET"));
  assert.ok(order.indexOf("EXAMPLE_DIALOGUE") > order.indexOf("AFTER_LORE"));
  assert.ok(order.indexOf("MEMORY") > order.indexOf("ASSISTANT_2"));
  assert.ok(order.indexOf("POST_HISTORY") > order.indexOf("MEMORY"));
  assert.ok(order.indexOf("JAILBREAK") > order.indexOf("STATUS_PANEL"));
});

test("sections can be disabled individually", () => {
  const plan = buildTavernPromptPlan(baseInput, { enabled: { charPersonality: false, jailbreak: false } });
  const contents = plan.messages.map(message => message.content);
  assert.ok(!contents.includes("JAILBREAK"));
  assert.ok(!contents.includes("CHAR_PERSONALITY"));
  assert.ok(contents.includes("MAIN_SYSTEM"));
});

test("custom order defines the complete section list", () => {
  const plan = buildTavernPromptPlan(baseInput, { order: ["jailbreak", "main", "chatHistory"] });
  assert.equal(plan.messages[0].content, "JAILBREAK");
  assert.equal(plan.messages[1].content, "MAIN_SYSTEM");
  assert.ok(!plan.messages.some(message => message.content === "CHAR_DESCRIPTION"), "unlisted sections are not injected");
});

test("depth injection places author note and world info inside history", () => {
  const plan = buildTavernPromptPlan(baseInput);
  const contents = plan.messages.map(message => message.content);
  const depthIndex = contents.indexOf("DEPTH_LORE");
  const noteIndex = contents.indexOf("AUTHOR_NOTE");
  assert.ok(depthIndex > contents.indexOf("MAIN_SYSTEM"));
  assert.ok(depthIndex < contents.indexOf("ASSISTANT_2"), "depth 2 lands before the last two messages");
  assert.equal(noteIndex, contents.indexOf("ASSISTANT_2") - 1, "author note with depth 1 lands before the final message");
});

test("budget trims the oldest history but keeps recent turns and system sections", () => {
  const longHistory = Array.from({ length: 40 }, (_, index) => ({ role: (index % 2 === 0 ? "user" : "assistant") as const, content: `历史消息${index}`.repeat(20) }));
  const plan = buildTavernPromptPlan({ ...baseInput, history: longHistory }, { contextTokens: 1200, minimumHistory: 2 });
  assert.ok(plan.trimmedHistory > 0);
  assert.ok(plan.warnings.some(warning => warning.includes("裁剪")));
  const contents = plan.messages.map(message => message.content);
  assert.ok(contents.includes("MAIN_SYSTEM"));
  assert.ok(contents.includes("JAILBREAK"));
  assert.ok(contents.some(content => content.startsWith("历史消息39")));
});

test("all expected section ids are exported", () => {
  for (const id of ["main", "worldInfoBefore", "charDescription", "worldInfoAfter", "chatHistory", "jailbreak"]) {
    assert.ok(TAVERN_PROMPT_SECTIONS.includes(id as never), `missing section ${id}`);
  }
});

test("authored openings survive context budgeting", () => {
  const longHistory = Array.from({ length: 30 }, (_, index) => ({ role: "user" as const, content: `历史${index}`.repeat(40) }));
  const plan = buildTavernPromptPlan({ characterName: "C", userName: "U", main: "M", opening: [{ role: "assistant" as const, content: "OPENING_KEEP" }], history: longHistory }, { contextTokens: 600 });
  assert.ok(plan.trimmedHistory > 0);
  assert.ok(plan.messages.some(message => message.content === "OPENING_KEEP"));
});

test("author note depth is computed against the trimmed history", () => {
  const longHistory = Array.from({ length: 20 }, (_, index) => ({ role: "user" as const, content: `历史${index}`.repeat(40) }));
  const plan = buildTavernPromptPlan({ characterName: "C", userName: "U", main: "M", history: longHistory, authorNote: { content: "NOTE", depth: 1, role: "system" } }, { contextTokens: 800 });
  const contents = plan.messages.map(message => message.content);
  const noteIndex = contents.indexOf("NOTE");
  assert.ok(noteIndex > 0);
  const keptHistory = contents.filter(content => content.startsWith("历史"));
  assert.equal(noteIndex, contents.indexOf(keptHistory[keptHistory.length - 1]) - 1);
});
