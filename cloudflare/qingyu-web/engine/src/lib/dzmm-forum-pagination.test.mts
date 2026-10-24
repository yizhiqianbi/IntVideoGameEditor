import assert from "node:assert/strict";
import { test } from "node:test";
import paginationModule from "./dzmm-forum-pagination";

const { appendDzmmForumPage, nextDzmmForumOffset, retainAcknowledgedForumPost, captureAcknowledgedForumRevisions, retainAcknowledgedForumPosts } = paginationModule as typeof import("./dzmm-forum-pagination");
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `original-${index + 1}`, body: `原创阅览记录${index + 1}`, myVote: 0 }));

test("a new leading topic does not duplicate the boundary row or move the next offset backwards", () => {
  const original = rows(61);
  let visible = original.slice(0, 20);
  const changed = [{ id: "new-leading", body: "原创新主题", myVote: 0 }, ...original];
  const second = changed.slice(20, 40);
  visible = appendDzmmForumPage(visible, second);
  assert.equal(visible.length, 39);
  assert.deepEqual(visible, original.slice(0, 39));
  const nextOffset = nextDzmmForumOffset(20, second);
  assert.equal(nextOffset, 40);
  visible = appendDzmmForumPage(visible, changed.slice(nextOffset, nextOffset + 20));
  assert.deepEqual(visible, original.slice(0, 59));
});

test("a fully duplicated page still consumes its raw rows before the next continuation", () => {
  const original = rows(60);
  const first = original.slice(0, 20), duplicate = original.slice(0, 20);
  const visible = appendDzmmForumPage(first, duplicate);
  assert.deepEqual(visible, first);
  assert.equal(nextDzmmForumOffset(20, duplicate), 40);
  assert.deepEqual(appendDzmmForumPage(visible, original.slice(40, 60)), [...first, ...original.slice(40, 60)]);
});

test("overlaps preserve prior order and acknowledged vote metadata without mutating either page", () => {
  const first = rows(3);
  first[1] = { ...first[1], myVote: 1 };
  const incoming = [{ ...first[1], myVote: 0 }, { ...first[0], body: "旧快照" }, { id: "new", body: "原创新记录", myVote: 0 }];
  const firstSnapshot = structuredClone(first), incomingSnapshot = structuredClone(incoming);
  const visible = appendDzmmForumPage(first, incoming);
  assert.deepEqual(visible, [...first, incoming[2]]);
  assert.equal(visible[1], first[1]);
  assert.deepEqual(first, firstSnapshot);
  assert.deepEqual(incoming, incomingSnapshot);
});

test("repeated IDs within an incoming first or reply page are displayed once but all consume offset", () => {
  const reply = { id: "original-reply", body: "原创回复" };
  const incoming = [reply, { ...reply, body: "重复旧回复" }, { id: "next-reply", body: "下一条原创回复" }];
  assert.deepEqual(appendDzmmForumPage([], incoming), [reply, incoming[2]]);
  assert.equal(nextDzmmForumOffset(20, incoming), 23);
});

test("short final pages advance by raw rows rather than the requested limit", () => {
  const original = rows(3);
  assert.equal(nextDzmmForumOffset(40, original), 43);
  assert.equal(nextDzmmForumOffset(43, []), 43);
});

test("an older reply read retains a vote acknowledged after its captured revision", () => {
  const stale = { id: "original-post", myVote: 0, upvotes: 0 };
  const acknowledged = { revision: 1, post: { ...stale, myVote: 1, upvotes: 1 } };
  assert.equal(retainAcknowledgedForumPost(stale, acknowledged, 0), acknowledged.post);
});

test("a fresh read after the acknowledged vote still accepts current server metadata", () => {
  const previous = { id: "original-post", myVote: 1, upvotes: 1 };
  const fresh = { ...previous, upvotes: 2 };
  assert.equal(retainAcknowledgedForumPost(fresh, { revision: 1, post: previous }, 1), fresh);
  assert.equal(retainAcknowledgedForumPost(fresh, undefined, 0), fresh);
});

test("a new-filter list retains a vote acknowledged while its first-page read was pending", () => {
  const stale = rows(2), acknowledged = new Map<string, { revision: number; post: typeof stale[number] }>();
  const readRevisions = captureAcknowledgedForumRevisions(acknowledged);
  const updated = { ...stale[0], myVote: 1 };
  acknowledged.set(updated.id, { revision: 1, post: updated });
  assert.deepEqual(retainAcknowledgedForumPosts(stale, acknowledged, readRevisions), [updated, stale[1]]);
  assert.equal(readRevisions.has(updated.id), false);
  assert.equal(stale[0].myVote, 0);
});

test("a fresh list after acknowledgement accepts newer server data instead of freezing the ACK map", () => {
  const stale = rows(2), acknowledged = new Map([[stale[0].id, { revision: 1, post: { ...stale[0], myVote: 1 } }]]);
  const readRevisions = captureAcknowledgedForumRevisions(acknowledged);
  const fresh = { ...stale[0], myVote: 1, body: "更新的普通原创主题" };
  assert.equal(retainAcknowledgedForumPosts([fresh], acknowledged, readRevisions)[0], fresh);
  acknowledged.set(stale[0].id, { revision: 2, post: { ...fresh, myVote: -1 } });
  assert.equal(readRevisions.get(stale[0].id), 1);
});

test("a continuation can add a newly visible topic with its later acknowledged vote", () => {
  const original = rows(3), acknowledged = new Map<string, { revision: number; post: typeof original[number] }>();
  const readRevisions = captureAcknowledgedForumRevisions(acknowledged);
  const updated = { ...original[2], myVote: 1 };
  acknowledged.set(updated.id, { revision: 1, post: updated });
  const incoming = retainAcknowledgedForumPosts(original.slice(1), acknowledged, readRevisions);
  assert.deepEqual(appendDzmmForumPage(original.slice(0, 2), incoming), [original[0], original[1], updated]);
});
