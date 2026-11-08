import test from "node:test";
import assert from "node:assert/strict";
import illustrationModule from "./dzmm-illustration";
const { composeDzmmIllustration, parseDzmmIllustrationDraft, parseDzmmIllustrationShots } = illustrationModule as typeof import("./dzmm-illustration");

const shot = { scale: "wide" as const, title: "窗边", summary: "她看着窗外", person: "一名成年人", clothing: "长袖衬衫",
  intimacy: "无", pose: "站在窗边", place: "客厅", detail: "暖光", camera: "全身" };

test("three shots are ordered wide, medium, close", () => {
  const shots = parseDzmmIllustrationShots({ shots: [
    { ...shot, scale: "close", title: "手" },
    { ...shot, scale: "wide", title: "房间" },
    { ...shot, scale: "medium", title: "上半身" },
  ] });
  assert.deepEqual(shots.map(item => item.scale), ["wide", "medium", "close"]);
  assert.equal(shots[0].title, "房间");
});

test("a chosen shot keeps the camera person and stays within 800 characters", () => {
  const scene = composeDzmmIllustration({ pov: true, shot });
  assert.match(scene, /玩家眼里/);
  assert.match(scene, /长袖衬衫/);
  assert.ok(Array.from(scene).length <= 800);
  const draft = parseDzmmIllustrationDraft({ accountId: "user", conversationId: "talk", messageId: "line", pov: false, visibility: "private", shot });
  assert.equal(draft.visibility, "private");
  assert.throws(() => parseDzmmIllustrationDraft({ ...draft, extra: true }), /字段无效/);
  assert.throws(() => parseDzmmIllustrationShots({ shots: [shot, shot, { ...shot, scale: "medium" }] }), /景别/);
});
