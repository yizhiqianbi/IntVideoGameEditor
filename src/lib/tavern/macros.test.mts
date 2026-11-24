import test from "node:test";
import assert from "node:assert/strict";
import macrosModule from "./macros";
const { expandTavernMacros, expandTavernMacrosDeep } = macrosModule as typeof import("./macros");

const context = {
  characterName: "裴聿",
  userName: "楚曦",
  description: "大理寺少卿",
  personality: "冷静",
  scenario: "长安",
  persona: "现代旅人",
  now: new Date("2026-11-20T10:05:00+08:00"),
  seed: 42,
};

test("expands identity and context macros", () => {
  const result = expandTavernMacros("{{char}}与{{user}}在{{scenario}}相遇，{{personality}}，{{description}}，{{persona}}", context);
  assert.equal(result.text, "裴聿与楚曦在长安相遇，冷静，大理寺少卿，现代旅人");
  assert.deepEqual(result.unknown, []);
});

test("expands date and time macros from the injected clock", () => {
  const result = expandTavernMacros("{{date}} {{time}} {{weekday}}", context);
  assert.match(result.text, /^2026-11-20 \d{2}:\d{2} Friday$/u);
});

test("random and pick are deterministic for one seed", () => {
  const first = expandTavernMacros("{{random::甲::乙::丙}}|{{pick::A::B::C}}", context);
  const second = expandTavernMacros("{{random::甲::乙::丙}}|{{pick::A::B::C}}", context);
  assert.equal(first.text, second.text);
  assert.match(first.text, /^(甲|乙|丙)\|(A|B|C)$/u);
});

test("dice roll returns a bounded sum with details", () => {
  const result = expandTavernMacros("{{roll:2d6}}", context);
  const total = Number(result.text.split(" ")[0]);
  assert.ok(Number.isInteger(total) && total >= 2 && total <= 12, result.text);
});

test("comments are removed and unknown macros are preserved and reported", () => {
  const result = expandTavernMacros("前{{// 隐藏注释}}后{{unknown_macro}}", context);
  assert.equal(result.text, "前后{{unknown_macro}}");
  assert.deepEqual(result.unknown, ["unknown_macro"]);
});

test("trim and newline helpers are applied once", () => {
  assert.equal(expandTavernMacros("  多行\n\n\n文本  {{trim}}", context).text, "多行\n\n文本");
  assert.equal(expandTavernMacros("第一行{{newline}}第二行", context).text, "第一行\n第二行");
});

test("deep expansion walks arrays and objects without mutating the input", () => {
  const input = { first_mes: "{{char}}来了", tags: ["{{user}}"], nested: { note: "{{unknown_here}}" } };
  const result = expandTavernMacrosDeep(input, context);
  assert.equal(result.value.first_mes, "裴聿来了");
  assert.deepEqual(result.value.tags, ["楚曦"]);
  assert.equal(input.first_mes, "{{char}}来了");
  assert.deepEqual(result.unknown, ["unknown_here"]);
});

test("newline macro keeps surrounding whitespace instead of trimming the whole text", () => {
  assert.equal(expandTavernMacros("  甲 {{newline}} 乙  ", context).text, "  甲 \n 乙  ");
});
