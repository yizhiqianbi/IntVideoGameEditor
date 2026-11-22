import test from "node:test";
import assert from "node:assert/strict";
import generationModule from "./image-generation";

const {
  DEFAULT_TAVERN_IMAGE_GENERATION, composeTavernImagePrompt, parseTavernImageGeneration,
  parseTavernImageSize, TAVERN_IMAGE_GENERATION_LIMITS,
} = generationModule as typeof import("./image-generation");

const context = { characterName: "顾念", userName: "楚曦", description: "你的前女友", personality: "冷淡", scenario: "公寓客厅", appearance: "黑长直发" };

test("defaults are safe and disabled", () => {
  const parsed = parseTavernImageGeneration(DEFAULT_TAVERN_IMAGE_GENERATION)!;
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.autoMode, "off");
  assert.equal(parsed.size, "3:4");
});

test("invalid stored values fall back to safe defaults", () => {
  assert.equal(parseTavernImageGeneration("x"), undefined);
  assert.equal(parseTavernImageSize("2:1"), "3:4");
  const parsed = parseTavernImageGeneration({ enabled: true, autoMode: "weird", interval: 999, size: "banana" })!;
  assert.equal(parsed.autoMode, "off");
  assert.equal(parsed.interval, TAVERN_IMAGE_GENERATION_LIMITS.interval);
  assert.equal(parsed.size, "3:4");
});

test("templates expand macros and inject character/scenario", () => {
  const generation = { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, promptPrefix: "{{char}} style", mainPrompt: "user {{user}}", injectCharacter: true, injectScenario: true };
  const { prompt, size } = composeTavernImagePrompt({ base: "她坐在沙发上。", generation, context });
  assert.match(prompt, /顾念 style/);
  assert.match(prompt, /user 楚曦/);
  assert.match(prompt, /外貌：黑长直发/);
  assert.match(prompt, /场景设定：公寓客厅/);
  assert.match(prompt, /她坐在沙发上。/);
  assert.equal(size, "3:4");
});

test("negative prompt becomes an explicit avoid-list", () => {
  const generation = { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, negativePrompt: "watermark, 低清晰度" };
  const { prompt } = composeTavernImagePrompt({ base: "scene", generation, context });
  assert.match(prompt, /避免出现：watermark, 低清晰度/);
});

test("composition is clamped without cutting a surrogate pair", () => {
  const generation = { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, mainPrompt: "港".repeat(900) };
  const { prompt } = composeTavernImagePrompt({ base: "scene", generation, context });
  assert.ok(Array.from(prompt).length <= TAVERN_IMAGE_GENERATION_LIMITS.prompt);
  assert.doesNotMatch(prompt, /[\ud800-\udbff]$/u);
});
