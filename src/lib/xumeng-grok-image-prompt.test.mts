import assert from "node:assert/strict";
import test from "node:test";
import { cleanGrokImagePrompt, grokImageOptimizeMessages, GROK_IMAGE_OPTIMIZE_SYSTEM } from "./xumeng-grok-image-prompt.ts";

test("grok image optimize follows the imagine prompt contract", () => {
  assert.match(GROK_IMAGE_OPTIMIZE_SYSTEM, /grok-imagine-image-2.0/);
  assert.match(GROK_IMAGE_OPTIMIZE_SYSTEM, /主体/);
  assert.match(GROK_IMAGE_OPTIMIZE_SYSTEM, /不要写 8K/);
  const ready = grokImageOptimizeMessages("夜里窗边的短发女人，二十一岁，黑金挂脖。");
  assert.ok("user" in ready);
  if ("user" in ready) assert.match(ready.user, /这是一张新图/);
  const edit = grokImageOptimizeMessages("把背景换成夜景，人不要动。", true);
  if ("user" in edit) assert.match(edit.user, /修改一张已有的图/);
});

test("grok image optimize refuses an empty or blocked line", () => {
  assert.deepEqual(grokImageOptimizeMessages("  "), { error: "先写一句再优化。" });
  assert.deepEqual(grokImageOptimizeMessages("画一个未成年学生"), { error: "不能优化这段描述。" });
});

test("clean grok image prompt drops the wrapper", () => {
  assert.equal(cleanGrokImagePrompt("```\n提示词：窗边的女人。\n```"), "窗边的女人。");
});
