import test from "node:test";
import assert from "node:assert/strict";
import flagsModule from "./flags";

const { readTavernFlags, TAVERN_FLAG_ENV } = flagsModule as typeof import("./flags");

test("features are enabled by default and only 'false' disables them", () => {
  assert.deepEqual(readTavernFlags(undefined), { engine: true, group: true, sampler: true, imagePresets: true, memory: true });
  assert.deepEqual(readTavernFlags({}), { engine: true, group: true, sampler: true, imagePresets: true, memory: true });
  assert.equal(readTavernFlags({ TAVERN_GROUP: "0" }).group, true);
  assert.equal(readTavernFlags({ TAVERN_GROUP: "no" }).group, true);
  assert.equal(readTavernFlags({ TAVERN_GROUP: " FALSE " }).group, false);
  assert.equal(readTavernFlags({ [TAVERN_FLAG_ENV.engine]: "false" }).engine, false);
});

test("flags are independent", () => {
  const flags = readTavernFlags({ TAVERN_GROUP: "false", TAVERN_IMAGE_PRESETS: "false" });
  assert.equal(flags.group, false);
  assert.equal(flags.imagePresets, false);
  assert.equal(flags.engine, true);
  assert.equal(flags.sampler, true);
  assert.equal(flags.memory, true);
});
