import test from "node:test";
import assert from "node:assert/strict";
import reviewModule from "./dzmm-authoring-review";
import promptModule from "./dzmm-prompt-card";
import contextModule from "./dzmm-character-context";
import type { DzmmAuthoringReviewInput } from "./dzmm-authoring-review";

const { analyzeDzmmAuthoringReview } = reviewModule as typeof import("./dzmm-authoring-review");
const { expandDzmmPromptMacros } = promptModule as typeof import("./dzmm-prompt-card");
const { activateDzmmCharacterBook } = contextModule as typeof import("./dzmm-character-context");

function draft(change: Partial<DzmmAuthoringReviewInput> = {}): DzmmAuthoringReviewInput {
  return { name: "修图师", introduction: "", description: "修图师核对航线。", personality: "", scenario: "", systemPrompt: "",
    postHistoryInstructions: "", messageExamples: "", messages: [{ role: "assistant", content: "坐。" }], greetings: [], selectedOpening: 0, entries: [], ...change };
}
function entry(change: Partial<DzmmAuthoringReviewInput["entries"][number]["entry"]> = {}, keysText = "港口", secondaryText = "") {
  return { entry: { content: "港口存放旧航志。", ...change }, keysText, secondaryText };
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.freeze(value); Object.values(value).forEach(freeze);
}

test("short valid openings report actual filled fields and counts without semantic judgements", () => {
  const report = analyzeDzmmAuthoringReview(draft({ personality: "  ", scenario: "工坊", systemPrompt: "请扮演修图师。",
    postHistoryInstructions: "保留尚未确认的航线。", messageExamples: "{{user}}:你好\n{{char}}:坐。",
    messages: [{ role: "assistant", content: "坐。" }, { role: "assistant", content: " \n" }, { role: "user", content: "好。" }, { role: "user", content: "\t" }] }));
  assert.deepEqual(report, { modelFields: ["详细描述", "故事场景", "系统指令", "后置指令", "对话示例"], hasScenario: true,
    assistantMessages: 1, userMessages: 1, enabledBookEntries: 0, constantBookEntries: 0, warnings: [] });
  const sparse = analyzeDzmmAuthoringReview(draft({ description: "", introduction: "介绍里写了目标、性格、关系和时间。" }));
  assert.deepEqual(sparse.modelFields, []); assert.equal(sparse.hasScenario, false); assert.deepEqual(sparse.warnings, []);
  assert.equal(sparse.assistantMessages, 1);
});

test("preview statistics follow the chosen alternative and ignore blank text", () => {
  const input = draft({ messages: [{ role: "assistant", content: "坐。" }, { role: "user", content: "好。" }], greetings: ["来。", " \n"] });
  const main = analyzeDzmmAuthoringReview(input); assert.equal(main.assistantMessages, 1); assert.equal(main.userMessages, 1);
  const alternative = analyzeDzmmAuthoringReview({ ...input, selectedOpening: 1 });
  assert.equal(alternative.assistantMessages, 1); assert.equal(alternative.userMessages, 0);
  const blank = analyzeDzmmAuthoringReview({ ...input, selectedOpening: 2 });
  assert.equal(blank.assistantMessages, 0); assert.equal(blank.userMessages, 0);
  const removed = analyzeDzmmAuthoringReview({ ...input, selectedOpening: 3 });
  assert.equal(removed.assistantMessages, 1); assert.equal(removed.userMessages, 1);
});

test("unknown macro warnings use the runtime expansion semantics in all model fields", () => {
  const context = { characterName: "角色", userName: "玩家", original: "默认指令" };
  for (const macro of ["{{char}}", "{{ USER }}", "{{\nOriginal\t}}", "{{date}}", "{{random::a::b}}", "{{getvar::affinity}}", "{{char:name}}", "{{char extra}}", "{{}}", "{{  }}"]) {
    const fields = ["description", "personality", "scenario", "systemPrompt", "postHistoryInstructions", "messageExamples"] as const;
    const expected = expandDzmmPromptMacros(macro, context) === macro;
    for (const field of fields) {
      const warnings = analyzeDzmmAuthoringReview(draft({ [field]: macro })).warnings;
      assert.equal(warnings.some(warning => warning.id === `macros-${field}`), expected, `${field}: ${macro}`);
      assert.ok(warnings.every(warning => warning.target === "identity"));
    }
  }
});

test("display text and inactive lore are excluded while all authored openings and enabled lore are checked", () => {
  const input = draft({ name: "{{random}}", introduction: "{{getvar::secret}}", selectedOpening: 0,
    messages: [{ role: "assistant", content: "{{date}}" }, { role: "user", content: "{{time}}" }], greetings: ["{{weather}}", "{{char}}"],
    entries: [entry({ content: "{{date}}", constant: true }), entry({ content: "{{date}}", enabled: false }), entry({ content: "{{user}}" })] });
  const report = analyzeDzmmAuthoringReview(input);
  assert.deepEqual(report.warnings.map(warning => warning.id), ["macros-opening-0", "macros-opening-1", "macros-greeting-0", "macros-book-0"]);
  assert.deepEqual(report.warnings.map(warning => warning.target), ["opening", "opening", "opening", "book"]);
  assert.equal(report.enabledBookEntries, 2); assert.equal(report.constantBookEntries, 1);
});

test("empty selective secondary keywords warn only when keyword activation actually depends on them", () => {
  const input = draft({ entries: [entry({ selective: true }, "港口", " ,，\n"), entry({ selective: true }, "港口", "航线"),
    entry({ selective: true, constant: true }), entry({ selective: true, enabled: false }), entry({ selective: false })] });
  const report = analyzeDzmmAuthoringReview(input);
  assert.deepEqual(report.warnings.map(warning => warning.id), ["secondary-book-0"]);
  assert.equal(report.enabledBookEntries, 4); assert.equal(report.constantBookEntries, 1);
  const lore = { entries: [{ keys: ["港口"], content: "航线资料。", selective: true, secondaryKeys: [] }] };
  assert.equal(activateDzmmCharacterBook(lore, [{ role: "user", content: "港口航线" }]).entries.length, 0);
  assert.equal(activateDzmmCharacterBook({ entries: [{ ...lore.entries[0], constant: true }] }, []).entries.length, 1);
});

test("keyword macros remain literal even when the same supported macro expands in lore content", () => {
  const input = draft({ entries: [entry({ content: "{{char}}保管航志。" }, "{{char}}"), entry({ selective: true }, "港口", "{{user}}"),
    entry({ constant: true }, "{{date}}"), entry({ enabled: false }, "{{date}}"), entry({}, "港口")] });
  assert.deepEqual(analyzeDzmmAuthoringReview(input).warnings.map(warning => warning.id), ["keywords-book-0", "keywords-book-1"]);
  const lore = { entries: [{ keys: ["{{char}}"], content: "{{char}}保管航志。" }] };
  assert.equal(activateDzmmCharacterBook(lore, [{ role: "user", content: "修图师" }]).entries.length, 0);
  assert.equal(activateDzmmCharacterBook(lore, [{ role: "user", content: "{{char}}" }]).entries.length, 1);
});

test("analysis preserves frozen draft text and settings and has deterministic detached results", () => {
  const input = draft({ scenario: "  工坊  ", messages: [{ role: "assistant", content: "{{date}}\n坐。" }],
    entries: [entry({ name: "  旧码头  ", selective: true, content: "{{random}}" }, "{{char}}", " ， ")] });
  const before = structuredClone(input); freeze(input);
  const first = analyzeDzmmAuthoringReview(input), second = analyzeDzmmAuthoringReview(input);
  assert.deepEqual(input, before); assert.deepEqual(first, second);
  assert.notEqual(first.warnings, second.warnings); assert.notEqual(first.modelFields, second.modelFields);
  assert.equal(new Set(first.warnings.map(warning => warning.id)).size, first.warnings.length);
  first.modelFields.push("本地修改"); first.warnings[0].message = "本地修改";
  assert.deepEqual(analyzeDzmmAuthoringReview(input), second); assert.deepEqual(input, before);
});
