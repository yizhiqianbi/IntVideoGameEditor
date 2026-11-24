import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  TOONFLOW_SAMPLE,
  nextToonflowStep,
  toonflowAssetPrompt,
  toonflowPromptSettings,
} from "../src/lib/toonflow";

test("toon look produces general character and scene references", () => {
  assert.match(TOONFLOW_SAMPLE, /26岁/);
  assert.match(
    toonflowAssetPrompt(
      { kind: "reference", title: "林晚", description: "黑色长发" },
      "toon",
    ),
    /二维动画角色设定图/,
  );
  assert.match(
    toonflowAssetPrompt(
      { kind: "reference", title: "林晚", description: "黑色长发" },
      "toon",
    ),
    /横向三格分镜排版/,
  );
  assert.match(
    toonflowAssetPrompt(
      { kind: "scene", title: "酒店套房", description: "暖光" },
      "toon",
    ),
    /二维动画场景设定图/,
  );
  assert.match(toonflowPromptSettings("toon").style, /二维动画短剧/);
  assert.doesNotMatch(JSON.stringify(toonflowPromptSettings("toon")), /情欲|裸露|成人向|性征/);
  assert.match(toonflowPromptSettings("cinematic").style, /写实电影感/);
});

test("pipeline only advances when the current stage has output", () => {
  assert.equal(
    nextToonflowStep("story", { shots: 0, assets: 0, images: 0, videos: 0 }),
    "story",
  );
  assert.equal(
    nextToonflowStep("story", { shots: 3, assets: 2, images: 0, videos: 0 }),
    "script",
  );
  assert.equal(
    nextToonflowStep("cast", { shots: 3, assets: 2, images: 1, videos: 0 }),
    "shoot",
  );
});
