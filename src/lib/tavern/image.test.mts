import test from "node:test";
import assert from "node:assert/strict";
import imageModule from "./image";

const { DEFAULT_TAVERN_IMAGE_PRESET, TAVERN_IMAGE_PRESETS, applyTavernImagePreset, parseTavernImagePresetId, tavernImagePreset } = imageModule as typeof import("./image");

test("presets include the default and are unique", () => {
  assert.ok(TAVERN_IMAGE_PRESETS.some(preset => preset.id === DEFAULT_TAVERN_IMAGE_PRESET));
  assert.equal(new Set(TAVERN_IMAGE_PRESETS.map(preset => preset.id)).size, TAVERN_IMAGE_PRESETS.length);
});

test("unknown or malformed preset ids are ignored", () => {
  assert.equal(parseTavernImagePresetId("cinematic"), "cinematic");
  assert.equal(parseTavernImagePresetId("no-such-preset"), undefined);
  assert.equal(parseTavernImagePresetId(42), undefined);
  assert.equal(parseTavernImagePresetId(""), undefined);
  assert.equal(tavernImagePreset("no-such-preset"), undefined);
});

test("applying a preset wraps the prompt and adds the negative list", () => {
  const styled = applyTavernImagePreset("一位穿风衣的女性站在雨夜街头。", "cinematic");
  assert.match(styled, /电影剧照质感/u);
  assert.match(styled, /一位穿风衣的女性站在雨夜街头。/u);
  assert.match(styled, /避免出现：二次元/u);
});

test("default and unknown presets keep the original prompt byte-identical", () => {
  const prompt = "一位穿风衣的女性站在雨夜街头。";
  assert.equal(applyTavernImagePreset(prompt, "xumeng"), prompt);
  assert.equal(applyTavernImagePreset(prompt, "no-such-preset"), prompt);
  assert.equal(applyTavernImagePreset(prompt, undefined), prompt);
});

test("composed prompts are clamped without cutting a surrogate pair", () => {
  const long = "港".repeat(1500);
  const styled = applyTavernImagePreset(long, "watercolor");
  assert.ok(Array.from(styled).length <= 1400);
  assert.doesNotMatch(styled, /[\ud800-\udbff]$/u);
});
