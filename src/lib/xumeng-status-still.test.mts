import test from "node:test";
import assert from "node:assert/strict";
import stillModule from "./xumeng-status-still.ts";

const { statusStillScene } = stillModule as typeof import("./xumeng-status-still.ts");

test("status fields lead and the reply only adds a short supplement", () => {
  const scene = statusStillScene([
    "她把伞靠在柜台边，看着门口。",
    "点击查看状态栏",
    "地点：深夜便利店",
    "衣着：白衬衫",
    "心情：未知",
  ].join("\n"));
  assert.equal(scene && "scene" in scene && scene.scene, "按这些词条把衣着、身体、姿势和接触画出来，不要改成穿戴整齐的远景或肖像。地点：深夜便利店。衣着：白衬衫。正在发生：她把伞靠在柜台边，看着门口。");
});

test("a reply without status fields stays out of this prompt", () => {
  assert.equal(statusStillScene("她站在窗边，雨还在下。"), null);
});

test("an unmarked tail of status lines becomes the prompt", () => {
  const scene = statusStillScene("她靠在沙发上。\n地点：[[公寓沙发上]]\n衣着：白衬衫\n心情：发烫");
  assert.equal(scene && "scene" in scene && scene.scene, "按这些词条把衣着、身体、姿势和接触画出来，不要改成穿戴整齐的远景或肖像。地点：公寓沙发上。衣着：白衬衫。心情：发烫。正在发生：她靠在沙发上。");
});

test("body contact is kept instead of a tame closing line", () => {
  const scene = statusStillScene("她穴口贴着你，热液滴在腿上。阳光从窗外进来。\n地点：房间\n衣着：吊带滑下\n姿势：跪着");
  assert.equal(scene && "scene" in scene && scene.scene.includes("穴口贴着你") && !scene.scene.includes("阳光从窗外进来"), true);
});

test("known labels lift a short unmarked status tail", () => {
  const scene = statusStillScene("灯还亮着。\n地点：旧书房\n衣着：长外套", ["地点", "衣着"]);
  assert.equal(scene && "scene" in scene && scene.scene.includes("地点：旧书房。衣着：长外套"), true);
});
