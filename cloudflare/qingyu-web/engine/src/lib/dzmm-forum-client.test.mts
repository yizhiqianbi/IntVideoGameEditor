import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import forumModule from "./dzmm-forum";
import cloudModule from "./dzmm-cloud";
import type { DzmmForumDraft, DzmmForumPost } from "./dzmm-forum";
const { fetchDzmmForumPosts, fetchDzmmForumPost, dzmmForumDemoSourceLabel, saveDzmmForumPost, DzmmForumEditConflictError } = forumModule as typeof import("./dzmm-forum");
const { DzmmCloudError, dzmmCloudRequest } = cloudModule as typeof import("./dzmm-cloud");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const calls: string[] = [];
function mock(value: unknown = {}) {
  calls.length = 0;
  globalThis.fetch = async (input) => { calls.push(String(input)); return Response.json(value); };
}

test("forum initial cursor requests opt in without dropping the empty start marker", async () => {
  mock(); await fetchDzmmForumPosts({ category: "life", cursor: "" });
  const query = new URL(calls[0], "https://isolated.example").searchParams;
  assert.equal(query.has("cursor"), true); assert.equal(query.get("cursor"), "");
  assert.equal(query.get("category"), "life"); assert.equal(query.has("offset"), false);
});

test("opaque reply cursors are URL encoded and replace the legacy offset", async () => {
  mock(); await fetchDzmmForumPost("original-post", 40, "opaque/+?=");
  const query = new URL(calls[0], "https://isolated.example").searchParams;
  assert.equal(query.get("cursor"), "opaque/+?="); assert.equal(query.has("offset"), false);
  assert.equal(query.get("limit"), "20");
});

test("legacy callers retain explicit topic and reply offset paging", async () => {
  mock(); await fetchDzmmForumPosts({ offset: 40 }); await fetchDzmmForumPost("original-post", 20);
  for (const [index, offset] of ["40", "20"].entries()) {
    const query = new URL(calls[index], "https://isolated.example").searchParams;
    assert.equal(query.get("offset"), offset); assert.equal(query.has("cursor"), false);
  }
});

const demoAuthor = {
  id: "fictional-author", nickname: "窗灯拾页", isDemo: true,
  provenance: { kind: "fictional-demo", source: "original", label: "官方原创示例", batchId: "demo-community-20261009" },
};
const normalAuthor = { id: "registered-author", nickname: "演示爱好者" };
const post = {
  id: "original-topic", title: "旧收音机的声音比外壳重要吗", body: "聊一聊声音如何参与场景。",
  category: "characters", tags: ["创作练习"], author: demoAuthor,
  createdAt: 1791541630390, updatedAt: 1791541630390, upvotes: 0, downvotes: 0, replyCount: 1, myVote: 0,
};

test("forum listing carries explicit demo provenance alongside unchanged registered authors", async () => {
  mock({ posts: [post, { ...post, id: "registered-topic", author: normalAuthor }], total: 2, offset: 0, limit: 20, hasMore: false, popularTags: [] });
  const listing = await fetchDzmmForumPosts({ q: "声音", category: "characters", cursor: "" });
  assert.deepEqual(listing.posts[0].author, demoAuthor);
  assert.equal(dzmmForumDemoSourceLabel(listing.posts[0].author), "官方原创示例");
  assert.deepEqual(listing.posts[1].author, normalAuthor);
  assert.equal(dzmmForumDemoSourceLabel(listing.posts[1].author), null);
  assert.equal(listing.posts[1].author.isDemo, undefined);
  assert.equal(new URL(calls[0], "https://isolated.example").searchParams.get("q"), "声音");
  assert.equal(listing.posts[0].upvotes, 0);
  assert.equal(listing.posts[0].replyCount, 1);
});

test("real replies to a demo topic retain their own provenance and authored content", async () => {
  const reply = { id: "registered-reply", postId: post.id, body: "<b>声音可以推进情节</b>", author: normalAuthor, createdAt: post.createdAt + 60000 };
  mock({ post, replies: [reply], total: 1, offset: 0, limit: 20, hasMore: false, nextCursor: null });
  const detail = await fetchDzmmForumPost(post.id, 0, "");
  assert.deepEqual(detail.post.author, demoAuthor);
  assert.deepEqual(detail.replies[0], reply);
  assert.equal(detail.replies[0].author.isDemo, undefined);
  assert.equal(detail.replies[0].author.provenance, undefined);
  assert.equal(detail.nextCursor, null);
});

test("incomplete or unmarked author provenance cannot claim the official source", async () => {
  const sources = [
    { ...demoAuthor, provenance: undefined },
    { ...demoAuthor, provenance: { kind: "fictional-demo", source: "original" } },
    { ...demoAuthor, provenance: { ...demoAuthor.provenance, batchId: " " } },
    { ...demoAuthor, provenance: { ...demoAuthor.provenance, label: "其他来源" } },
    { ...demoAuthor, provenance: { ...demoAuthor.provenance, source: "external" } },
    { ...normalAuthor, provenance: demoAuthor.provenance },
    { ...demoAuthor, isDemo: "true" },
  ];
  mock({ posts: sources.map((author, index) => ({ ...post, id: `source-${index}`, author })), total: sources.length, offset: 0, limit: 20, hasMore: false, popularTags: [] });
  const listing = await fetchDzmmForumPosts();
  for (const candidate of listing.posts) assert.equal(dzmmForumDemoSourceLabel(candidate.author), null);
});

const editId = '92929292-9292-4929-8929-929292929292';
const editDraft: DzmmForumDraft = { title: '  航标校对🧭  ', body: '  核对第七枚航标。\n第二页保留换行。  ',
  category: 'life', tags: [' 海图 ', '原创', '海图'], baseUpdatedAt: 100 };
function currentEdit(overrides: Partial<DzmmForumPost> = {}): DzmmForumPost {
  return { id: editId, title: editDraft.title.trim(), body: editDraft.body.trim(), category: editDraft.category,
    tags: ['原创', '海图'], author: normalAuthor, createdAt: 50, updatedAt: 101, upvotes: 2, downvotes: 1, replyCount: 3, myVote: 0, ...overrides };
}
const mutationCalls: { url: string; init?: RequestInit }[] = [];
function mutationMock(data: unknown, status = 200) {
  mutationCalls.length = 0;
  globalThis.fetch = async (input, init) => {
    mutationCalls.push({ url: String(input), init });
    return Response.json(data, { status });
  };
}
function conflictMock(current: unknown, status = 409) {
  mutationMock({ error: 'Another page changed this post.', code: 'FORUM_EDIT_CONFLICT', current }, status);
}
async function expectConflict(draft: DzmmForumDraft, current: unknown, expectedCurrent?: DzmmForumPost, status = 409) {
  conflictMock(current, status);
  await assert.rejects(saveDzmmForumPost(draft, editId), failure => {
    assert.ok(failure instanceof DzmmForumEditConflictError);
    assert.equal(failure.status, status);
    assert.deepEqual(failure.current, expectedCurrent);
    return true;
  });
  assert.equal(mutationCalls.length, 1, 'Conflicts must never retry or overwrite automatically.');
}

test('forum PATCH sends the exact draft and base timestamp once with the existing session transport', async () => {
  const current = currentEdit();
  mutationMock({ post: current });
  assert.deepEqual(await saveDzmmForumPost(editDraft, editId), current);
  assert.equal(mutationCalls.length, 1);
  assert.equal(mutationCalls[0].url, `/api/backend/v1/forum/posts/${editId}`);
  assert.equal(mutationCalls[0].init?.method, 'PATCH');
  assert.equal(mutationCalls[0].init?.credentials, 'same-origin');
  assert.equal(mutationCalls[0].init?.cache, 'no-store');
  assert.deepEqual(JSON.parse(mutationCalls[0].init?.body as string), editDraft);
});

test('a lost PATCH ACK is recovered only for newer complete normalized content, including tag order and duplicates', async () => {
  const current = currentEdit({ tags: ['海图', '原创'] });
  conflictMock(current);
  assert.deepEqual(await saveDzmmForumPost(editDraft, editId), current);
  assert.equal(mutationCalls.length, 1);
  assert.deepEqual(editDraft.tags, [' 海图 ', '原创', '海图']);
  assert.equal(editDraft.body, '  核对第七枚航标。\n第二页保留换行。  ');
});

test('differences in any editable field keep a complete current post for comparison instead of acknowledging the draft', async () => {
  const changed: Partial<DzmmForumPost>[] = [
    { title: 'A different title' }, { body: 'A different body' }, { body: editDraft.body.trim().replace('\n', ' ') },
    { category: 'help' }, { tags: ['海图'] }, { tags: ['海图', '原创', 'different'] },
  ];
  for (const fields of changed) {
    const current = currentEdit(fields);
    await expectConflict(editDraft, current, current);
  }
});

test('different IDs and malformed conflict snapshots cannot trigger lost-ACK recovery or enter comparison state', async () => {
  const valid = currentEdit();
  const missingBody = { ...valid } as Partial<DzmmForumPost>; delete missingBody.body;
  const malformed: unknown[] = [undefined, null, [], {}, { ...valid, id: 'other-post' }, missingBody,
    { ...valid, title: ' ' }, { ...valid, body: 'invalid\0body' }, { ...valid, category: 'unknown' },
    { ...valid, tags: '原创' }, { ...valid, tags: Array.from({ length: 11 }, (_, index) => String(index)) },
    { ...valid, tags: [''] }, { ...valid, author: null }, { ...valid, author: { id: 'author', nickname: '' } },
    { ...valid, createdAt: '50' }, { ...valid, updatedAt: 101.5 }, { ...valid, upvotes: -1 },
    { ...valid, downvotes: '1' }, { ...valid, replyCount: 0.5 }, { ...valid, myVote: 2 }];
  for (const current of malformed) await expectConflict(editDraft, current);
});

test('same or older timestamps and unversioned legacy drafts retain comparison but cannot be silently acknowledged', async () => {
  for (const updatedAt of [100, 99]) {
    const current = currentEdit({ updatedAt });
    await expectConflict(editDraft, current, current);
  }
  const legacyDraft = { ...editDraft }; delete legacyDraft.baseUpdatedAt;
  const current = currentEdit();
  await expectConflict(legacyDraft, current, current);
  await expectConflict({ ...editDraft, baseUpdatedAt: -1 }, current, current);
  await expectConflict({ ...editDraft, baseUpdatedAt: 100.5 }, current, current);
});

test('428 preserves the current comparison, generic error JSON remains available, and POST409 is never recovered', async () => {
  const current = currentEdit();
  await expectConflict(editDraft, current, current, 428);
  const errorData = { error: 'Saved comparison.', code: 'FORUM_EDIT_CONFLICT', current };
  mutationMock(errorData, 409);
  await assert.rejects(dzmmCloudRequest('/forum/posts/example', 'PATCH', editDraft), failure => {
    assert.ok(failure instanceof DzmmCloudError);
    assert.equal(failure.status, 409);
    assert.deepEqual(failure.data, errorData);
    return true;
  });
  mutationMock(errorData, 409);
  await assert.rejects(saveDzmmForumPost(editDraft), failure => {
    assert.ok(failure instanceof DzmmCloudError);
    assert.equal(failure instanceof DzmmForumEditConflictError, false);
    assert.equal(failure.status, 409);
    assert.deepEqual(failure.data, errorData);
    return true;
  });
  assert.equal(mutationCalls.length, 1);
  assert.equal(mutationCalls[0].init?.method, 'POST');
});
