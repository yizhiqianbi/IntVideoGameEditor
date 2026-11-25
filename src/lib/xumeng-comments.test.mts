import assert from "node:assert/strict";
import test from "node:test";
import {
  addReplyInList,
  removeCommentInList,
  sortXumengComments,
  toggleCommentLikeInList,
  validateCommentBody,
  XUMENG_COMMENT_MAX_LENGTH,
  type XumengComment,
} from "./xumeng-comments";

function sampleComments(): XumengComment[] {
  return [
    {
      id: "c1",
      characterId: "char-1",
      authorId: "u1",
      authorName: "林夕",
      body: "节奏很有代入感",
      createdAt: 1732000000000,
      likes: 5,
      likedBy: [],
      replies: [],
    },
    {
      id: "c2",
      characterId: "char-1",
      authorId: "u2",
      authorName: "阿白",
      body: "最新一条评论",
      createdAt: 1732500000000,
      likes: 2,
      likedBy: [],
      replies: [],
    },
    {
      id: "c3",
      characterId: "char-1",
      authorId: "u3",
      authorName: "小鹿",
      body: "最热门评论",
      createdAt: 1732100000000,
      likes: 19,
      likedBy: ["u9"],
      replies: [],
    },
  ];
}

test("validateCommentBody trims, rejects empty, and enforces max length", () => {
  assert.deepEqual(validateCommentBody("   "), { ok: false, reason: "empty" });
  assert.deepEqual(validateCommentBody("  太好玩了  "), { ok: true, text: "太好玩了" });
  const tooLong = "a".repeat(XUMENG_COMMENT_MAX_LENGTH + 1);
  assert.deepEqual(validateCommentBody(tooLong), { ok: false, reason: "too_long" });
});

test("sortXumengComments sorts by hot engagement score or latest timestamp", () => {
  const hot = sortXumengComments(sampleComments(), "hot");
  assert.deepEqual(hot.map((c) => c.id), ["c3", "c1", "c2"]);

  const latest = sortXumengComments(sampleComments(), "latest");
  assert.deepEqual(latest.map((c) => c.id), ["c2", "c3", "c1"]);
});

test("toggleCommentLikeInList toggles viewerId membership and updates like count", () => {
  const liked = toggleCommentLikeInList(sampleComments(), "c1", "viewer-1");
  const c1 = liked.find((c) => c.id === "c1")!;
  assert.equal(c1.likedBy.includes("viewer-1"), true);
  assert.equal(c1.likes, 6);

  const unliked = toggleCommentLikeInList(liked, "c1", "viewer-1");
  const c1Again = unliked.find((c) => c.id === "c1")!;
  assert.equal(c1Again.likedBy.includes("viewer-1"), false);
  assert.equal(c1Again.likes, 5);
});

test("addReplyInList appends a nested reply to the targeted comment", () => {
  const updated = addReplyInList(sampleComments(), "c1", {
    id: "r1",
    authorId: "u9",
    authorName: "测试玩家",
    body: "同感，这段很惊艳！",
    createdAt: 1732600000000,
  });
  assert.equal(updated.find((c) => c.id === "c1")?.replies.length, 1);
  assert.equal(updated.find((c) => c.id === "c1")?.replies[0]?.id, "r1");
  assert.equal(updated.find((c) => c.id === "c2")?.replies.length, 0);
});

test("removeCommentInList enforces author ownership for top-level comments and replies", () => {
  const blocked = removeCommentInList(sampleComments(), "c2", "wrong-user");
  assert.deepEqual(blocked.map((c) => c.id), ["c1", "c2", "c3"]);

  const removed = removeCommentInList(sampleComments(), "c2", "u2");
  assert.deepEqual(removed.map((c) => c.id), ["c1", "c3"]);

  const withReply = addReplyInList(removed, "c1", {
    id: "r1",
    authorId: "u9",
    authorName: "测试玩家",
    body: "可删除的回复",
    createdAt: 1732600000000,
  });
  const replyRemoved = removeCommentInList(withReply, "r1", "u9");
  assert.equal(replyRemoved.find((c) => c.id === "c1")?.replies.length, 0);
});
