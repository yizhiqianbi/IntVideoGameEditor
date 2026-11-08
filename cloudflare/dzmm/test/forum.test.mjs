import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { promoteTestUserToSuper } from './test-admin.mjs';

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm test to start the isolated local Worker.');
const origin = 'http://127.0.0.1:3010';
const prefix = `f-${randomUUID()}`;

class Client {
  constructor(cookie = '') { this.cookie = cookie; this.user = null; }
  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { Origin: origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json().catch(() => null);
    if (data?.user) this.user = data.user;
    return { status: response.status, data };
  }
}
function expect(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
async function register(nickname) {
  const client = new Client();
  expect(await client.request('/v1/auth/register', { method: 'POST', body: { email: `${randomUUID()}@forum.example.test`, password: 'Forum-testing-password-2026!', nickname } }), 201);
  return client;
}
function draft(overrides = {}) { return { title: `${prefix} 雾港创作交流`, body: '欢迎交流角色创作。\n第二段保留换行。', category: 'characters', tags: [prefix, '创作'], ...overrides }; }
async function create(client, overrides) {
  return expect(await client.request('/v1/forum/posts', { method: 'POST', body: draft(overrides) }), 201).post;
}
let alice, bob, admin, guest;
before(async () => {
  alice = await register('论坛作者');
  bob = await register('论坛读者');
  admin = await register('论坛管理员');
  await promoteTestUserToSuper(admin.user.id);
  expect(await admin.request('/v1/session'), 200);
  assert.equal(admin.user.role, 'super');
  guest = new Client();
  const result = await guest.request('/v1/auth/guest', { method: 'POST', body: {} });
  assert.ok([200, 201].includes(result.status));
});

test('forum guest can browse but cannot post, reply, vote, delete, or report', async () => {
  expect(await new Client().request('/v1/forum/posts'), 401);
  expect(await guest.request('/v1/forum/posts'), 200);
  const post = await create(alice);
  expect(await guest.request(`/v1/forum/posts/${post.id}`), 200);
  expect(await guest.request('/v1/forum/posts', { method: 'POST', body: draft() }), 403);
  expect(await guest.request(`/v1/forum/posts/${post.id}`, { method: 'PATCH', body: draft() }), 403);
  expect(await guest.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 403);
  expect(await guest.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: '游客回复' } }), 403);
  expect(await guest.request(`/v1/forum/posts/${post.id}/vote`, { method: 'PUT', body: { value: 1 } }), 403);
  expect(await guest.request(`/v1/forum/posts/${post.id}/report`, { method: 'POST', body: { reason: '游客举报' } }), 403);
  expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
});

test('forum post and reply persist through real D1 and public authors reveal only id and nickname', async () => {
  const post = await create(alice, { title: '  新主题  ', body: '  第一段\n第二段  ', tags: ['原创', '原创', prefix] });
  assert.equal(post.title, '新主题');
  assert.equal(post.body, '第一段\n第二段');
  assert.deepEqual([...post.tags].sort(), ['原创', prefix].sort());
  assert.deepEqual(post.author, { id: alice.user.id, nickname: '论坛作者' });
  assert.equal(post.upvotes, 0); assert.equal(post.downvotes, 0); assert.equal(post.replyCount, 0); assert.equal(post.myVote, 0);
  const reply = expect(await bob.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: '  一条真实回复\n欢迎交流  ' } }), 201).reply;
  assert.equal(reply.body, '一条真实回复\n欢迎交流');
  const reloaded = expect(await new Client(guest.cookie).request(`/v1/forum/posts/${post.id}`), 200);
  assert.deepEqual(reloaded.post.author, post.author);
  assert.equal(reloaded.post.replyCount, 1); assert.equal(reloaded.total, 1);
  assert.deepEqual(reloaded.replies[0], reply);
  for (const author of [reloaded.post.author, reloaded.replies[0].author]) assert.deepEqual(Object.keys(author).sort(), ['id', 'nickname']);
  assert.ok(!JSON.stringify(reloaded).includes(alice.user.email));
  assert.ok(!JSON.stringify(reloaded).includes(bob.user.email));
  expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
  expect(await bob.request(`/v1/forum/replies/${reply.id}`, { method: 'DELETE' }), 404);
});

test('forum author edits and deletes only own content while body role forgery grants no access', async () => {
  const post = await create(alice);
  const reply = expect(await bob.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: '读者的回复' } }), 201).reply;
  expect(await bob.request(`/v1/forum/posts/${post.id}`, { method: 'PATCH', body: { ...draft({ title: '越权修改' }), role: 'super' } }), 404);
  expect(await bob.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE', body: { role: 'super' } }), 404);
  expect(await alice.request(`/v1/forum/replies/${reply.id}`, { method: 'DELETE' }), 404);
  const updated = expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'PATCH', body: draft({ title: '作者修改', category: 'help', tags: ['求助'], baseUpdatedAt: post.updatedAt }) }), 200).post;
  assert.equal(updated.title, '作者修改'); assert.equal(updated.category, 'help'); assert.deepEqual(updated.tags, ['求助']);
  assert.equal(updated.createdAt, post.createdAt); assert.ok(updated.updatedAt >= post.updatedAt);
  expect(await bob.request(`/v1/forum/replies/${reply.id}`, { method: 'DELETE' }), 200);
  assert.equal(expect(await guest.request(`/v1/forum/posts/${post.id}`), 200).total, 0);
  expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
});

test('forum search/category/tag and pagination use bound literal values and report accurate totals', async () => {
  const fixtures = [];
  for (let index = 0; index < 5; index++) fixtures.push(await create(alice, { title: `${prefix} page ${index}`, category: index < 3 ? 'life' : 'social', tags: [prefix, index < 3 ? '日常' : '交友'] }));
  const first = expect(await guest.request(`/v1/forum/posts?tag=${prefix}&limit=2`), 200);
  assert.equal(first.total, 5); assert.equal(first.posts.length, 2); assert.equal(first.hasMore, true);
  const second = expect(await guest.request(`/v1/forum/posts?tag=${prefix}&limit=2&offset=2`), 200);
  const last = expect(await guest.request(`/v1/forum/posts?tag=${prefix}&limit=2&offset=4`), 200);
  assert.equal(last.posts.length, 1); assert.equal(last.hasMore, false);
  assert.equal(new Set([...first.posts, ...second.posts, ...last.posts].map((item) => item.id)).size, 5);
  assert.equal(expect(await guest.request(`/v1/forum/posts?tag=${prefix}&category=life`), 200).total, 3);
  assert.equal(expect(await guest.request(`/v1/forum/posts?q=${encodeURIComponent(`${prefix} page 4`)}`), 200).total, 1);
  assert.equal(expect(await guest.request(`/v1/forum/posts?q=${encodeURIComponent("' OR 1=1 --")}`), 200).total, 0);
  assert.equal(expect(await guest.request(`/v1/forum/posts?q=${encodeURIComponent('%')}`), 200).total, 0);
  assert.equal(expect(await guest.request(`/v1/forum/posts?tag=${encodeURIComponent("' OR 1=1 --")}`), 200).total, 0);
  assert.ok(first.popularTags.some((item) => item.tag === prefix && item.count === 5));
  for (const post of fixtures) expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
});

test('forum voting is idempotent, toggles direction, cancels, and remains account scoped', async () => {
  const post = await create(alice);
  const vote = async (client, value) => expect(await client.request(`/v1/forum/posts/${post.id}/vote`, { method: 'PUT', body: { value } }), 200).post;
  assert.equal((await vote(bob, 1)).upvotes, 1);
  const same = await vote(bob, 1); assert.equal(same.upvotes, 1); assert.equal(same.myVote, 1);
  const reversed = await vote(bob, -1); assert.equal(reversed.upvotes, 0); assert.equal(reversed.downvotes, 1); assert.equal(reversed.myVote, -1);
  assert.equal((await vote(alice, 1)).upvotes, 1);
  const guestPost = expect(await guest.request(`/v1/forum/posts/${post.id}`), 200).post;
  assert.equal(guestPost.myVote, 0); assert.equal(guestPost.downvotes, 1);
  const cancelled = await vote(bob, 0); assert.equal(cancelled.downvotes, 0); assert.equal(cancelled.upvotes, 1); assert.equal(cancelled.myVote, 0);
  assert.equal((await vote(bob, 0)).upvotes, 1);
  expect(await bob.request(`/v1/forum/posts/${post.id}/vote`, { method: 'PUT', body: { value: '1' } }), 400);
  expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
  expect(await bob.request(`/v1/forum/posts/${post.id}/vote`, { method: 'PUT', body: { value: 1 } }), 404);
});

test('forum replies paginate in order and deletion cascades through replies, tags, votes, and reports', async () => {
  const post = await create(alice);
  const replies = [];
  for (let index = 0; index < 3; index++) replies.push(expect(await bob.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: `回复 ${index}` } }), 201).reply);
  const first = expect(await guest.request(`/v1/forum/posts/${post.id}?limit=2`), 200);
  assert.equal(first.total, 3); assert.equal(first.hasMore, true); assert.deepEqual(first.replies.map((item) => item.id), replies.slice(0, 2).map((item) => item.id));
  const last = expect(await guest.request(`/v1/forum/posts/${post.id}?limit=2&offset=2`), 200);
  assert.equal(last.total, 3); assert.equal(last.hasMore, false); assert.equal(last.replies[0].id, replies[2].id);
  expect(await bob.request(`/v1/forum/posts/${post.id}/vote`, { method: 'PUT', body: { value: 1 } }), 200);
  expect(await bob.request(`/v1/forum/posts/${post.id}/report`, { method: 'POST', body: { reason: '用于验证删除级联' } }), 201);
  const before = expect(await admin.request('/v1/forum/reports'), 200);
  const report = before.reports.find((item) => item.postId === post.id); assert.ok(report);
  expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
  expect(await guest.request(`/v1/forum/posts/${post.id}`), 404);
  expect(await bob.request(`/v1/forum/replies/${replies[0].id}`, { method: 'DELETE' }), 404);
  assert.ok(!expect(await admin.request('/v1/forum/reports'), 200).reports.some((item) => item.id === report.id));
  expect(await admin.request(`/v1/forum/reports/${report.id}/status`, { method: 'PATCH', body: { status: 'resolved' } }), 404);
  assert.equal(expect(await guest.request(`/v1/forum/posts?tag=${prefix}`), 200).total, 0);
});

test('forum reports deduplicate, keep private reasons from readers, and require Super for review', async () => {
  const post = await create(alice);
  expect(await bob.request(`/v1/forum/posts/${post.id}/report`, { method: 'POST', body: { reason: '需要管理员检查的说明' } }), 201);
  expect(await bob.request(`/v1/forum/posts/${post.id}/report`, { method: 'POST', body: { reason: '重复举报不创建新记录' } }), 200);
  expect(await alice.request('/v1/forum/reports'), 403);
  expect(await bob.request('/v1/forum/reports'), 403);
  expect(await guest.request('/v1/forum/reports'), 403);
  const pending = expect(await admin.request('/v1/forum/reports'), 200);
  const matching = pending.reports.filter((item) => item.postId === post.id); assert.equal(matching.length, 1);
  const report = matching[0]; assert.equal(report.reason, '需要管理员检查的说明');
  assert.deepEqual(report.reporter, { id: bob.user.id, nickname: '论坛读者' });
  expect(await bob.request(`/v1/forum/reports/${report.id}/status`, { method: 'PATCH', body: { status: 'resolved', role: 'super' } }), 403);
  expect(await admin.request(`/v1/forum/reports/${report.id}/status`, { method: 'PATCH', body: { status: 'invented' } }), 400);
  expect(await admin.request(`/v1/forum/reports/${report.id}/status`, { method: 'PATCH', body: { status: 'resolved' } }), 200);
  assert.ok(!expect(await admin.request('/v1/forum/reports'), 200).reports.some((item) => item.id === report.id));
  assert.ok(expect(await admin.request('/v1/forum/reports?status=resolved'), 200).reports.some((item) => item.id === report.id));
  const detail = expect(await guest.request(`/v1/forum/posts/${post.id}`), 200);
  assert.ok(!JSON.stringify(detail).includes(report.reason));
  expect(await alice.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
});

test('forum Super can moderate another author without changing attribution', async () => {
  const post = await create(alice);
  const reply = expect(await bob.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: '管理员将删除这条测试回复' } }), 201).reply;
  const edited = expect(await admin.request(`/v1/forum/posts/${post.id}`, { method: 'PATCH', body: draft({ title: '管理员修订主题', tags: ['审核'], baseUpdatedAt: post.updatedAt }) }), 200).post;
  assert.equal(edited.title, '管理员修订主题'); assert.deepEqual(edited.author, post.author);
  expect(await admin.request(`/v1/forum/replies/${reply.id}`, { method: 'DELETE' }), 200);
  expect(await admin.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
  expect(await guest.request(`/v1/forum/posts/${post.id}`), 404);
});

test('forum rejects malformed ids, oversized and null text, invalid category/tags, and cross-origin mutations', async () => {
  for (const path of ['/v1/forum/posts/nope', '/v1/forum/posts/%27%20OR%201%3D1', '/v1/forum/replies/not-an-id']) expect(await alice.request(path, { method: path.includes('replies') ? 'DELETE' : 'GET' }), 400);
  for (const params of ['limit=31', 'limit=0', 'offset=-1', 'offset=abc', 'offset=100001', 'category=invalid', 'q=%00']) expect(await guest.request(`/v1/forum/posts?${params}`), 400);
  for (const invalid of [
    { title: '' }, { title: 'x'.repeat(121) }, { title: '含\0空字符' },
    { body: '' }, { body: 'x'.repeat(12001) }, { body: '含\0空字符' },
    { category: 'fake' }, { tags: 'tag' }, { tags: Array(11).fill('tag') }, { tags: ['x'.repeat(41)] }, { tags: ['含\0空字符'] },
  ]) expect(await bob.request('/v1/forum/posts', { method: 'POST', body: draft(invalid) }), 400);
  const post = await create(bob);
  expect(await alice.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: 'x'.repeat(4001) } }), 400);
  expect(await alice.request(`/v1/forum/posts/${post.id}/replies`, { method: 'POST', body: { body: '\0' } }), 400);
  expect(await alice.request(`/v1/forum/posts/${post.id}/report`, { method: 'POST', body: { reason: 'x'.repeat(1001) } }), 400);
  expect(await bob.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE', headers: { Origin: 'https://attacker.example' } }), 403);
  expect(await guest.request(`/v1/forum/posts/${post.id}`), 200);
  expect(await bob.request(`/v1/forum/posts/${post.id}`, { method: 'DELETE' }), 200);
});
