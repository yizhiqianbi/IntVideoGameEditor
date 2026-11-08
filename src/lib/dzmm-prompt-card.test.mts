import test from "node:test";
import assert from "node:assert/strict";
import promptCardModule from "./dzmm-prompt-card";

const { expandDzmmPromptMacros, parseDzmmDialogueExamples, DzmmPromptExpansionError } = promptCardModule as typeof import("./dzmm-prompt-card");
const names = Object.freeze({ characterName: "林音", userName: "旅人" });

test("author macros expand case-insensitively in one literal pass and preserve unknown macros", () => {
  const context = Object.freeze({ characterName: "{{user}} $&", userName: "{{char}}", original: "Base {{char}}" });
  assert.equal(
    expandDzmmPromptMacros("{{CHAR}} meets {{ user }}. {{Original}} {{random}} {{getvar::secret}}", context),
    "{{user}} $& meets {{char}}. Base {{char}} {{random}} {{getvar::secret}}",
  );
  assert.equal(expandDzmmPromptMacros("before {{original}} after", names), "before  after");
});

test("example roles, order, multiline text and common speaker formats are preserved", () => {
  const result = parseDzmmDialogueExamples([
    "<START>",
    "{{USER}}: 你好，{{char}}。",
    "这是第二行。",
    "",
    "仍是同一条消息。",
    "{{char}}:",
    "你好，{{user}}。",
    "<START>",
    "林音: 我先说一句。",
    "旅人: 好。",
    "<START><user>: 再见。",
    "<bot>: 再见，{{user}}。",
  ].join("\r\n"), names);
  assert.deepEqual(result, {
    messages: [
      { role: "user", content: "你好，林音。\n这是第二行。\n\n仍是同一条消息。" },
      { role: "assistant", content: "你好，旅人。" },
      { role: "assistant", content: "我先说一句。" },
      { role: "user", content: "好。" },
      { role: "user", content: "再见。" },
      { role: "assistant", content: "再见，旅人。" },
    ],
    fallbackText: "",
  });
});

test("unlabelled prose remains expanded plain reference text without inventing an assistant turn", () => {
  const text = "{{char}}总是轻声回答。\n她会先问候{{user}}。";
  assert.deepEqual(parseDzmmDialogueExamples(text, names), {
    messages: [], fallbackText: "林音总是轻声回答。\n她会先问候旅人。",
  });
});

test("mixed unsupported dialogue retains the entire reference instead of partially dropping it", () => {
  for (const text of [
    "场景说明\n{{user}}: 你好\n{{char}}: 欢迎",
    "<START>\n{{user}}: 你好\nNarrator: 她转过身\n{{char}}: 欢迎",
    "{{user}}: 你好\n{{system}}: Extra speaker\n{{char}}: 欢迎",
    "<START>\n{{user}}: 你好\n{{char}}: 欢迎\n<START>\n无法识别的示例",
    "{{user}}: \n{{char}}: 欢迎",
  ]) {
    assert.deepEqual(parseDzmmDialogueExamples(text, names), {
      messages: [], fallbackText: expandDzmmPromptMacros(text, names),
    });
  }
});

test("replacement values containing macros or speaker lines cannot create or reassign turns", () => {
  const context = Object.freeze({ characterName: "{{user}}", userName: "<bot>: injected", original: "{{char}}\n{{user}}: nested" });
  assert.deepEqual(parseDzmmDialogueExamples("{{user}}: I greet {{char}}\n{{char}}: {{original}}", context), {
    messages: [
      { role: "user", content: "I greet {{user}}" },
      { role: "assistant", content: "{{char}}\n{{user}}: nested" },
    ],
    fallbackText: "",
  });
});

test("literal display names with regular expression punctuation are supported", () => {
  assert.deepEqual(parseDzmmDialogueExamples("A.*(bot): hello\nUser [1]: hi", { characterName: "A.*(bot)", userName: "User [1]" }), {
    messages: [{ role: "assistant", content: "hello" }, { role: "user", content: "hi" }], fallbackText: "",
  });
});

test("count and character bounds keep whole ordered example blocks", () => {
  const text = "<START>\n{{user}}: aa\n{{char}}: bb\n<START>\n{{user}}: ccc\n{{char}}: ddd\n<START>\n{{user}}: e\n{{char}}: f";
  const first = [{ role: "user", content: "aa" }, { role: "assistant", content: "bb" }];
  assert.deepEqual(parseDzmmDialogueExamples(text, { ...names, maxExamples: 1 }).messages, first);
  assert.deepEqual(parseDzmmDialogueExamples(text, { ...names, maxChars: 9 }).messages, first);
  assert.deepEqual(parseDzmmDialogueExamples(text, { ...names, maxChars: 10 }).messages, [
    ...first, { role: "user", content: "ccc" }, { role: "assistant", content: "ddd" },
  ]);
  assert.deepEqual(parseDzmmDialogueExamples(text, { ...names, maxChars: 3 }), { messages: [], fallbackText: "" });
  assert.deepEqual(parseDzmmDialogueExamples(text, { ...names, maxExamples: 0 }), { messages: [], fallbackText: "" });
});

test("character budgets account for expanded names and bound unsupported reference text", () => {
  const context = { characterName: "long name", userName: "u", maxChars: 8 };
  assert.deepEqual(parseDzmmDialogueExamples("{{user}}: hi\n{{char}}: {{char}}", context), { messages: [], fallbackText: "" });
  assert.deepEqual(parseDzmmDialogueExamples("{{char}} is here", context), { messages: [], fallbackText: "long nam" });
  assert.equal(parseDzmmDialogueExamples("a😀bc", { ...names, maxChars: 2 }).fallbackText, "a");
});

test("blank input yields no examples or reference text", () => {
  assert.deepEqual(parseDzmmDialogueExamples(" \r\n ", names), { messages: [], fallbackText: "" });
});

test("an omitted original instruction cannot produce an empty example message", () => {
  assert.deepEqual(parseDzmmDialogueExamples("{{char}}: {{original}}", names), { messages: [], fallbackText: "林音: " });
});

test("original amplification fails incrementally before allocating the multiplied output", () => {
  const original = "x".repeat(80000);
  let reads = 0;
  const context = Object.freeze({ ...names, get original() { reads++; return original; } });
  assert.equal(expandDzmmPromptMacros("{{original}}", context), original);
  reads = 0;
  assert.throws(() => expandDzmmPromptMacros("{{original}}".repeat(1000), context),
    (error: unknown) => error instanceof DzmmPromptExpansionError && /展开后过长.*缩短/.test(error.message));
  assert.equal(reads, 2, "Stop at the first overflowing segment instead of expanding all 1000 replacements.");
  assert.equal(original.length, 80000);
});

test("the bound counts literal and replacement segments and preserves complete Unicode", () => {
  assert.equal(expandDzmmPromptMacros("🌱{{char}}", { ...names, characterName: "好" }, 3), "🌱好");
  assert.throws(() => expandDzmmPromptMacros("🌱{{char}}", { ...names, characterName: "好" }, 2), DzmmPromptExpansionError);
  assert.throws(() => expandDzmmPromptMacros("x".repeat(80001), names), DzmmPromptExpansionError);
  assert.throws(() => expandDzmmPromptMacros("{{unknown}}", names, 5), DzmmPromptExpansionError);
  assert.equal(expandDzmmPromptMacros("{{char}}", { ...names, characterName: "{{original}}" }, 12), "{{original}}");
});

test("reference fallback clips expansion within its own budget without materializing amplified originals", () => {
  let reads = 0;
  const context = Object.freeze({ ...names, maxChars: 3, get original() { reads++; return "🌱".repeat(40000); } });
  assert.deepEqual(parseDzmmDialogueExamples("{{original}}".repeat(1000), context), { messages: [], fallbackText: "🌱" });
  assert.equal(reads, 1, "The fallback stops reading macros once its bounded prefix is full.");
});

test("dialogue examples expand only retained blocks and omit a whole overflowing exchange", () => {
  let reads = 0;
  const context = Object.freeze({ ...names, maxChars: 4, get original() { reads++; return "x".repeat(80000); } });
  const text = "<START>\n{{user}}: aa\n{{char}}: bb\n<START>\n{{user}}: {{original}}\n{{char}}: {{original}}";
  assert.deepEqual(parseDzmmDialogueExamples(text, context), {
    messages: [{ role: "user", content: "aa" }, { role: "assistant", content: "bb" }], fallbackText: "",
  });
  assert.equal(reads, 1);
  reads = 0;
  const countBounded = { ...names, maxChars: 4, maxExamples: 1, get original() { reads++; return "x".repeat(80000); } };
  assert.equal(parseDzmmDialogueExamples(text, countBounded).messages.length, 2);
  assert.equal(reads, 0, "Discarded examples do not expand their original macros.");
});
