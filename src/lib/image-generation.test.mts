import assert from "node:assert/strict";
import { test } from "node:test";
import imageGenerationModule from "./image-generation.ts";

const {
  buildCharacterImagePrompt,
  buildSceneImagePrompt,
  CHARACTER_THREE_VIEW_PROMPT,
  REFERENCE_IMAGE_PROMPT,
} = imageGenerationModule as typeof import("./image-generation.ts");

test("reference character prompts use one image instead of the text-only three-view layout", () => {
  const prompt = buildCharacterImagePrompt({
    name: "婉如",
    bio: "成年酒吧服务员，水手服造型",
    basePrompt: "保持人物脸型和服装轮廓",
    hasReference: true,
  });
  assert.match(prompt, /单人单画面/);
  assert.doesNotMatch(prompt, /三视图/);
  assert.match(prompt, /保持参考图/);
});

test("text-only character prompts keep the established three-view behavior", () => {
  const prompt = buildCharacterImagePrompt({ name: "角色", bio: "成年角色", basePrompt: "写实" });
  assert.match(prompt, new RegExp(CHARACTER_THREE_VIEW_PROMPT.slice(0, 12)));
});

test("reference scene prompts preserve the source layout", () => {
  const prompt = buildSceneImagePrompt({
    name: "酒吧",
    description: "暖色木质吧台",
    basePrompt: "保持空间连续",
    hasReference: true,
  });
  assert.match(prompt, /保持参考图的空间布局/);
  assert.doesNotMatch(prompt, /无人物主导/);
});

test("reference instruction is explicit and shared by the server route", () => {
  assert.match(REFERENCE_IMAGE_PROMPT, /真正进行参考图生图/);
  assert.match(REFERENCE_IMAGE_PROMPT, /不要把参考图当成灵感图/);
});
