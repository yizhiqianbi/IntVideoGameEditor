import test from "node:test";
import assert from "node:assert/strict";
import worldbookModule from "./worldbook";
const { TAVERN_ENTRY_POSITION, TAVERN_SELECTIVE_LOGIC, activateTavernWorldbook, estimateTavernTokens, nextTavernActivationState, parseTavernWorldbook, parseTavernWorldbookEntry } = worldbookModule as typeof import("./worldbook");
import type { TavernWorldbook, TavernWorldbookEntry } from "./worldbook";

type EntryInput = Partial<Omit<TavernWorldbookEntry, "id">> & { id?: string; content: string };
type BookInput = { name?: string; scanDepth?: number; entries: EntryInput[] };

function entry(input: EntryInput): TavernWorldbookEntry {
  const parsed = parseTavernWorldbookEntry({ id: input.id ?? "e", ...input }, 0);
  assert.ok(parsed, "entry should parse");
  return parsed;
}

function book(input: BookInput): TavernWorldbook {
  return parseTavernWorldbook({ name: input.name ?? "book", ...(input.scanDepth !== undefined ? { scan_depth: input.scanDepth } : {}), entries: input.entries });
}

const messages = (...contents: string[]) => contents.map(content => ({ role: "assistant" as const, content }));

test("parses v2 string positions and v3 extension positions", () => {
  const v2 = parseTavernWorldbookEntry({ keys: ["a"], content: "A", position: "after_char" })!;
  assert.equal(v2.position, TAVERN_ENTRY_POSITION.AFTER_CHAR);
  const v3 = parseTavernWorldbookEntry({ content: "B", extensions: { position: 4, depth: 2, role: 1 } })!;
  assert.equal(v3.position, TAVERN_ENTRY_POSITION.AT_DEPTH);
  assert.equal(v3.depth, 2);
  assert.equal(v3.role, "user");
  assert.equal(parseTavernWorldbookEntry({ content: "   " }), null);
});

test("constant entries always activate and split by position", () => {
  const result = activateTavernWorldbook(book({ entries: [
    { id: "before", content: "BEFORE", constant: true, position: TAVERN_ENTRY_POSITION.BEFORE_CHAR },
    { id: "after", content: "AFTER", constant: true, position: TAVERN_ENTRY_POSITION.AFTER_CHAR },
    { id: "depth", content: "DEPTH", constant: true, position: TAVERN_ENTRY_POSITION.AT_DEPTH, depth: 3, role: "user" },
  ] }), messages("hello"));
  assert.deepEqual(result.beforeChar.map(item => item.id), ["before"]);
  assert.deepEqual(result.afterChar.map(item => item.id), ["after"]);
  assert.deepEqual(result.atDepth.map(item => [item.entry.id, item.depth, item.role]), [["depth", 3, "user"]]);
});

test("keyword matching is case-insensitive by default and respects caseSensitive", () => {
  const insensitive = activateTavernWorldbook(book({ entries: [{ id: "a", keys: ["Old Port"], content: "X" }] }), messages("the OLD PORT is busy"));
  assert.equal(insensitive.activated.length, 1);
  const sensitive = activateTavernWorldbook(book({ entries: [{ id: "a", keys: ["Old Port"], content: "X", caseSensitive: true }] }), messages("the OLD PORT is busy"));
  assert.equal(sensitive.activated.length, 0);
});

test("matchWholeWords avoids substring hits and useRegex accepts patterns", () => {
  const whole = activateTavernWorldbook(book({ entries: [{ id: "a", keys: ["港"], content: "X", matchWholeWords: true }] }), messages("旧港口"));
  assert.equal(whole.activated.length, 0, "CJK substring should not match whole-word");
  const regex = activateTavernWorldbook(book({ entries: [{ id: "b", keys: ["旧[港城]"], content: "X", useRegex: true }] }), messages("旧城"));
  assert.equal(regex.activated.length, 1);
  const invalid = activateTavernWorldbook(book({ entries: [{ id: "c", keys: ["["], content: "X", useRegex: true }] }), messages("a [ bracket"));
  assert.equal(invalid.activated.length, 1);
  assert.ok(invalid.warnings.some(warning => warning.includes("正则关键词无效")));
});

test("selective logic supports AND_ANY, AND_ALL, NOT_ALL and NOT_ANY", () => {
  const build = (logic: number): TavernWorldbook => book({ entries: [{
    id: "e", content: "X", keys: ["alpha"], selective: true, secondaryKeys: ["one", "two"], selectiveLogic: logic as never,
  }] });
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.AND_ANY), messages("alpha one")).activated.length, 1);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.AND_ANY), messages("alpha three")).activated.length, 0);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.AND_ALL), messages("alpha one two")).activated.length, 1);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.AND_ALL), messages("alpha one")).activated.length, 0);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.NOT_ALL), messages("alpha one")).activated.length, 1);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.NOT_ALL), messages("alpha one two")).activated.length, 0);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.NOT_ANY), messages("alpha one")).activated.length, 0);
  assert.equal(activateTavernWorldbook(build(TAVERN_SELECTIVE_LOGIC.NOT_ANY), messages("alpha three")).activated.length, 1);
});

test("probability is deterministic per seed and respects 0/100", () => {
  const always = book({ entries: [{ id: "a", keys: ["x"], content: "A", useProbability: true, probability: 100 }] });
  const never = book({ entries: [{ id: "b", keys: ["x"], content: "B", useProbability: true, probability: 0 }] });
  const sometimes = book({ entries: [{ id: "c", keys: ["x"], content: "C", useProbability: true, probability: 50 }] });
  assert.equal(activateTavernWorldbook(always, messages("x"), { seed: 1 }).activated.length, 1);
  assert.equal(activateTavernWorldbook(never, messages("x"), { seed: 1 }).activated.length, 0);
  const first = activateTavernWorldbook(sometimes, messages("x"), { seed: 7 }).activated.length;
  const second = activateTavernWorldbook(sometimes, messages("x"), { seed: 7 }).activated.length;
  assert.equal(first, second);
});

test("group keeps the highest weight entry", () => {
  const result = activateTavernWorldbook(book({ entries: [
    { id: "low", keys: ["x"], content: "LOW", group: "g", groupWeight: 10 },
    { id: "high", keys: ["x"], content: "HIGH", group: "g", groupWeight: 90 },
  ] }), messages("x"));
  assert.deepEqual(result.activated.map(item => item.id), ["high"]);
  assert.ok(result.skipped.some(item => item.id === "low" && item.reason === "group"));
});

test("recursion activates entries keyed on other activated content and honours recursion flags", () => {
  const recursive = book({ entries: [
    { id: "first", keys: ["dragon"], content: "The dragon guards the old gate." },
    { id: "second", keys: ["old gate"], content: "The gate opens at dusk." },
  ] });
  const result = activateTavernWorldbook(recursive, messages("a dragon appears"), { recursionLimit: 3 });
  assert.deepEqual(result.activated.map(item => item.id).sort(), ["first", "second"]);
  const prevented = book({ entries: [
    { id: "first", keys: ["dragon"], content: "The dragon guards the old gate.", preventRecursion: true },
    { id: "second", keys: ["old gate"], content: "The gate opens at dusk." },
  ] });
  assert.deepEqual(activateTavernWorldbook(prevented, messages("a dragon"), { recursionLimit: 3 }).activated.map(item => item.id), ["first"]);
  const excluded = book({ entries: [
    { id: "first", keys: ["dragon"], content: "The dragon guards the old gate." },
    { id: "second", keys: ["old gate"], content: "The gate opens at dusk.", excludeRecursion: true },
  ] });
  assert.deepEqual(activateTavernWorldbook(excluded, messages("a dragon"), { recursionLimit: 3 }).activated.map(item => item.id), ["first"]);
  const delayed = book({ entries: [{ id: "late", keys: ["dragon"], content: "LATE", delayUntilRecursion: true }] });
  assert.deepEqual(activateTavernWorldbook(delayed, messages("a dragon"), { recursionLimit: 3 }).activated, []);
});

test("sticky, cooldown and delay use the activation state", () => {
  const stickyBook = book({ entries: [{ id: "s", keys: ["x"], content: "S", sticky: 3 }] });
  const state = { s: { lastTurn: 5 } };
  assert.equal(activateTavernWorldbook(stickyBook, messages("nothing"), { turn: 6, state }).activated.length, 1);
  assert.equal(activateTavernWorldbook(stickyBook, messages("nothing"), { turn: 9, state }).activated.length, 0);
  const cooldownBook = book({ entries: [{ id: "c", keys: ["x"], content: "C", cooldown: 2 }] });
  assert.equal(activateTavernWorldbook(cooldownBook, messages("x"), { turn: 6, state: { c: { lastTurn: 5 } } }).activated.length, 0);
  const delayBook = book({ entries: [{ id: "d", keys: ["x"], content: "D", delay: 3 }] });
  assert.equal(activateTavernWorldbook(delayBook, messages("x"), { turn: 2, state: { d: { lastTurn: 1 } } }).activated.length, 0);
  const next = nextTavernActivationState({}, { activatedIds: ["s"] } as never, 6);
  assert.deepEqual(next, { s: { lastTurn: 6 } });
});

test("token budget skips entries that opt in and reports the count", () => {
  const huge = "港".repeat(50);
  const result = activateTavernWorldbook(book({ entries: [
    { id: "a", keys: ["x"], content: huge },
    { id: "b", keys: ["x"], content: huge },
  ] }), messages("x"), { tokenBudget: 60 });
  assert.equal(result.activated.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes("token 预算")));
  assert.ok(result.skipped.some(item => item.reason === "budget"));
});

test("scanDepth limits how far back keyword matching looks", () => {
  const bookValue = book({ entries: [{ id: "a", keys: ["trigger"], content: "X" }] });
  assert.equal(activateTavernWorldbook(bookValue, messages("trigger", "a", "b"), { scanDepth: 1 }).activated.length, 0);
  assert.equal(activateTavernWorldbook(bookValue, messages("trigger", "a", "b"), { scanDepth: 3 }).activated.length, 1);
});

test("estimated tokens count CJK as one and ASCII as a quarter", () => {
  assert.equal(estimateTavernTokens("港港港港"), 4);
  assert.equal(estimateTavernTokens("abcd"), 1);
});

test("disabled entries are reported instead of injected", () => {
  const result = activateTavernWorldbook(book({ entries: [{ id: "a", keys: ["x"], content: "X", enabled: false }] }), messages("x"));
  assert.equal(result.activated.length, 0);
  assert.ok(result.skipped.some(item => item.id === "a" && item.reason === "disabled"));
});
