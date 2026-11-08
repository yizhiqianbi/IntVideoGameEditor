import test from "node:test";
import assert from "node:assert/strict";
import { companionVisualScene } from "../../../src/app/xumeng/girlfriend/companion-moment";

test("girlfriend stills use the reported moment before the raw reply", () => {
  const scene = companionVisualScene({
    situation: "刚下班，站在商场连廊里。",
    messages: [
      { role: "assistant", text: "我到了。\n<xumeng-moment>{\"scene\":\"商场连廊的灯下\",\"clothing\":\"米色风衣\",\"mood\":\"刚下班\"}</xumeng-moment>" },
    ],
  });
  assert.equal(scene, "商场连廊的灯下，米色风衣，刚下班");
});

test("girlfriend stills fall back to her situation when she has not spoken", () => {
  assert.equal(companionVisualScene({ situation: "刚下班，站在商场连廊里。", messages: [] }), "刚下班，站在商场连廊里。");
});
