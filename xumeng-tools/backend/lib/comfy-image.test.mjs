import assert from "node:assert/strict";
import { test } from "node:test";
import { qwenWorkflow } from "./comfy-image.mjs";

test("text-only jobs use Qwen Image Edit", () => {
  const graph = qwenWorkflow("雨夜的月台。风格：动漫。", "blank.png", 7);
  assert.equal(graph["1"].inputs.unet_name, "qwen_image_edit_2511_bf16.safetensors");
  assert.equal(graph["6"].inputs.prompt, "雨夜的月台。风格：动漫。");
  assert.equal(graph["8"].inputs.image, "blank.png");
  assert.equal(graph["9"].inputs.seed, 7);
});

test("reference jobs use Qwen Image Edit and the uploaded file", () => {
  const graph = qwenWorkflow("换成夜景。风格：写实。", "ref.png", 9);
  assert.equal(graph["1"].inputs.unet_name, "qwen_image_edit_2511_bf16.safetensors");
  assert.equal(graph["6"].inputs.prompt, "换成夜景。风格：写实。");
  assert.equal(graph["8"].inputs.image, "ref.png");
  assert.equal(graph["9"].inputs.seed, 9);
  assert.equal(graph["6"].inputs.image2, undefined);
});

test("a second reference is attached beside the picture being edited", () => {
  const graph = qwenWorkflow("把参考脸换到画面上。", "scene.png", 3, "face.png");
  assert.equal(graph["8"].inputs.image, "scene.png");
  assert.equal(graph["15"].inputs.image, "face.png");
  assert.deepEqual(graph["6"].inputs.image2, ["16", 0]);
  assert.deepEqual(graph["7"].inputs.image2, ["16", 0]);
});

test("a third reference is attached as image3", () => {
  const graph = qwenWorkflow("保留三张图里的人。", "a.png", 1, ["b.png", "c.png"]);
  assert.equal(graph["17"].inputs.image, "c.png");
  assert.deepEqual(graph["6"].inputs.image3, ["18", 0]);
  assert.deepEqual(graph["7"].inputs.image3, ["18", 0]);
});
