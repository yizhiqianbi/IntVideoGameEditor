import test from "node:test";
import assert from "node:assert/strict";
import memoryModule from "./memory";

const { parseTavernMemoryConfig, parseTavernMemoryProfile, tavernMemoryProfileInstruction, TAVERN_MEMORY_PROFILES } = memoryModule as typeof import("./memory");

test("memory profiles are validated", () => {
  for (const profile of TAVERN_MEMORY_PROFILES) assert.equal(parseTavernMemoryProfile(profile), profile);
  assert.equal(parseTavernMemoryProfile("verbose"), undefined);
  assert.equal(parseTavernMemoryProfile(42), undefined);
});

test("memory injection config is bounded", () => {
  assert.deepEqual(parseTavernMemoryConfig({ depth: 2 }), { depth: 2, role: "system" });
  assert.deepEqual(parseTavernMemoryConfig({ depth: 20 }), { depth: 20, role: "system" });
  assert.equal(parseTavernMemoryConfig({ depth: 21 }), undefined);
  assert.equal(parseTavernMemoryConfig({ depth: -1 }), undefined);
  assert.equal(parseTavernMemoryConfig({ depth: 1.5 }), undefined);
  assert.equal(parseTavernMemoryConfig({ depth: 1, role: "user" }), undefined);
  assert.equal(parseTavernMemoryConfig({ depth: 1, extra: true }), undefined);
  assert.equal(parseTavernMemoryConfig("2"), undefined);
});

test("profile instructions change along with verbosity", () => {
  assert.equal(tavernMemoryProfileInstruction(undefined), "");
  assert.equal(tavernMemoryProfileInstruction("balanced"), "");
  assert.match(tavernMemoryProfileInstruction("compact"), /400字/u);
  assert.match(tavernMemoryProfileInstruction("detailed"), /1600字/u);
});
