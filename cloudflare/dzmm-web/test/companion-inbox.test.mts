import test from "node:test";
import assert from "node:assert/strict";
import { inboxEntries, inboxView } from "../../../src/app/xumeng/girlfriend/companion-inbox";

test("chat inbox keeps send order, hides sales cues, and counts unread after the seen line", () => {
  const entries = inboxEntries([
    { id: "1", role: "assistant", text: "在吗", createdAt: "2026-10-29T02:34:00.000Z" },
    { id: "2", role: "user", text: "对方刚打开聊天。先发第一条。", createdAt: "2026-10-29T02:35:00.000Z" },
    { id: "3", role: "user", text: "干啥呢发这么性感照片", createdAt: "2026-10-29T02:36:00.000Z" },
    { id: "4", role: "assistant", text: "[XUMENG_PRIVATE_STYLE v1]\nsecret\n[/XUMENG_PRIVATE_STYLE]\n嘴这么甜", createdAt: "2026-10-29T02:36:30.000Z" },
  ], [
    { id: "p", createdAt: "2026-10-29T02:34:10.000Z" },
  ]);
  assert.deepEqual(entries.map(entry => entry.id), ["1", "p", "3", "4"]);
  assert.equal(entries[1]?.text, "[图片]");
  const readThroughPhoto = inboxView(entries, "p");
  assert.equal(readThroughPhoto.preview, "嘴这么甜");
  assert.equal(readThroughPhoto.unread, 1);
  assert.equal(inboxView(entries, null).unread, 0);
  assert.equal(inboxView(entries, "4").unread, 0);
  assert.equal(inboxView(entries.slice(0, 2), "1").preview, "[图片]");
});
