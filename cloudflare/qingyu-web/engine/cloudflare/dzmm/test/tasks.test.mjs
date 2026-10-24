import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { promoteTestUserToSuper } from './test-admin.mjs';
import { seedTestTaskClaims } from './tasks-test-store.mjs';
const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm test for the isolated Worker.');
const origin = 'http://127.0.0.1:3010';
const DAY = 86400000;
class Client {
  constructor(cookie = '') { this.cookie = cookie; this.user = null; }
  async request(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { Origin: origin, 'CF-Connecting-IP': '198.51.100.47',
      ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user) this.user = data.user;
    return { status: response.status, data };
  }
}
function expect(response, status) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
async function center(client) { return expect(await client.request('/v1/tasks'), 200); }
function task(state, id) { return state.tasks.find(item => item.id === id); }
async function claim(client, id, extra = {}) {
  return client.request(`/v1/tasks/${id}/claim`, { method: 'POST', body: { accountId: client.user.id, ...extra } });
}
async function conversation(client, messages) {
  const id = `task-chat-${randomUUID()}`;
  expect(await client.request('/v1/conversations', { method: 'POST', body: { conversation: { id, characterId: 'qy-shiyu', messages } } }), 200);
  return id;
}
async function preferences(client, value) { return expect(await client.request('/v1/preferences', { method: 'PATCH', body: { preferences: value } }), 200); }
async function post(client) {
  return expect(await client.request('/v1/forum/posts', { method: 'POST', body: { title: '任务中心隔离测试', body: '讨论海港地图的整理方法。', category: 'help', tags: ['地图'] } }), 201).post;
}
async function reply(client, postId) { return expect(await client.request(`/v1/forum/posts/${postId}/replies`, { method: 'POST', body: { body: '可以先整理年代与航线。' } }), 201).reply; }
function character(id = `task-draft-${randomUUID()}`) { return { id, name: '成年港城档案员', description: '帮助成年旅人整理地图。',
  personality: '耐心细致', scenario: '虚构港城图书馆', firstMessage: '今天想查哪张地图？', tags: ['原创'], cover: '/art/shiyu.webp' }; }
let owner, stranger, admin, concurrent, expiry, guest;
before(async () => {
  async function register(nickname) {
    const client = new Client();
    expect(await client.request('/v1/auth/register', { method: 'POST', body: { email: `${randomUUID()}@tasks.example.test`, password: 'Task-password-2026!', nickname } }), 201);
    return client;
  }
  owner = await register('任务作者'); stranger = await register('其他任务账户'); admin = await register('任务审核员');
  concurrent = await register('并发任务账户'); expiry = await register('到期任务账户');
  await promoteTestUserToSuper(admin.user.id);
  expect(await admin.request('/v1/session'), 200);
  guest = new Client();
  assert.ok([200, 201].includes((await guest.request('/v1/auth/guest', { method: 'POST', body: {} })).status));
});

test('task center returns actual guest progress and exposes the spendable Credit wallet', async () => {
  expect(await new Client().request('/v1/tasks'), 401);
  expect(await new Client().request('/v1/tasks/daily_checkin/claim', { method: 'POST', body: {} }), 401);
  const empty = await center(guest);
  assert.equal(empty.accountId, guest.user.id); assert.equal(empty.isGuest, true);
  assert.equal(empty.pointsKind, 'credit'); assert.equal(empty.modelBillingLinked, true);
  assert.ok(empty.note.includes('Credit')); assert.equal(empty.points.balance, 0);
  assert.equal(empty.tasks.length, 6); assert.equal(empty.recentClaims.length, 0);
  assert.equal(empty.resetAt, (Math.floor(empty.serverTime / DAY) + 1) * DAY);
  assert.equal(empty.timezone, 'UTC');
  assert.equal(task(empty, 'daily_checkin').period, new Date(empty.serverTime).toISOString().slice(0, 10));
  await conversation(guest, [{ role: 'user', content: '帮我找旧地图。' }]);
  const progressed = await center(guest);
  assert.equal(task(progressed, 'first_conversation').eligible, true);
  assert.equal(task(progressed, 'first_conversation').claimable, false);
  expect(await claim(guest, 'first_conversation'), 403);
  expect(await claim(guest, 'daily_checkin'), 403);
  assert.equal((await center(guest)).points.balance, 0);
});

test('claim requires matching account and refuses forged progress, reward, date and unexpected methods', async () => {
  const before = await center(owner);
  for (const accountId of [undefined, null, '', stranger.user.id, `bad\0id`]) {
    expect(await owner.request('/v1/tasks/daily_checkin/claim', { method: 'POST', body: accountId === undefined ? {} : { accountId } }), 401);
  }
  for (const extra of [{ points: 100000 }, { progress: 100 }, { completed: true }, { period: 'tomorrow' }, { expiresAt: null }, { role: 'super' }])
    expect(await claim(owner, 'daily_checkin', extra), 400);
  expect(await owner.request('/v1/tasks/daily_checkin/claim', { method: 'POST', body: { accountId: owner.user.id }, headers: { Origin: 'https://untrusted.example.test' } }), 403);
  expect(await owner.request('/v1/tasks/daily_checkin/claim'), 405);
  expect(await owner.request('/v1/tasks', { method: 'POST', body: {} }), 405);
  expect(await owner.request('/v1/tasks/unknown/claim', { method: 'POST', body: { accountId: owner.user.id } }), 404);
  expect(await owner.request('/v1/tasks/daily_checkin/claim', { method: 'POST', raw: '{broken', headers: { 'Content-Type': 'application/json' } }), 400);
  expect(await owner.request('/v1/tasks/daily_checkin/claim', { method: 'POST', body: { accountId: owner.user.id, padding: 'x'.repeat(2048) } }), 413);
  const after = await center(owner);
  assert.deepEqual(after.points, before.points); assert.deepEqual(after.recentClaims, []);
});

test('first conversation requires an owned persistent user turn and remains a once-only reward after deletion', async () => {
  const id = await conversation(owner, [{ role: 'assistant', content: '欢迎，想找什么书？' }]);
  await conversation(stranger, [{ role: 'user', content: '其他账户的问题。' }]);
  assert.equal(task(await center(owner), 'first_conversation').eligible, false);
  expect(await claim(owner, 'first_conversation'), 400);
  expect(await owner.request(`/v1/conversations/${id}/messages`, { method: 'PUT', body: { messages: [{ role: 'user', content: '请找海港地图。' }] } }), 200);
  const earned = expect(await claim(owner, 'first_conversation'), 201);
  assert.equal(earned.claim.points, 5); assert.equal(earned.claim.period, 'once'); assert.equal(earned.claim.expiresAt, null);
  assert.equal(earned.points.balance, 1505);
  expect(await owner.request(`/v1/conversations/${id}`, { method: 'DELETE' }), 200);
  const deleted = await center(owner);
  assert.equal(task(deleted, 'first_conversation').eligible, false); assert.equal(task(deleted, 'first_conversation').claimed, true);
  expect(await claim(owner, 'first_conversation'), 409);
  assert.equal((await center(owner)).points.balance, 1505);
});

test('profile and five unique followed authors are evaluated from saved preferences rather than client claims', async () => {
  await preferences(owner, { bio: ' \t\n\u00a0\u3000', followedAuthors: ['甲', '乙', '丙', '丁'] });
  assert.equal(task(await center(owner), 'complete_profile').eligible, false);
  assert.equal(task(await center(owner), 'follow_authors').progress, 4);
  expect(await claim(owner, 'complete_profile'), 400); expect(await claim(owner, 'follow_authors'), 400);
  expect(await owner.request('/v1/preferences', { method: 'PATCH', body: { preferences: { followedAuthors: ['甲', '乙', '丙', '丁', '甲'] } } }), 400);
  await preferences(stranger, { bio: '另一个账户的介绍', followedAuthors: ['A', 'B', 'C', 'D', 'E'] });
  assert.equal(task(await center(owner), 'follow_authors').progress, 4);
  await preferences(owner, { bio: '喜欢整理港城地图。', followedAuthors: ['甲', '乙', '丙', '丁', '戊'] });
  assert.equal(task(await center(owner), 'follow_authors').progress, 5);
  expect(await claim(owner, 'complete_profile'), 201); const earned = expect(await claim(owner, 'follow_authors'), 201);
  assert.equal(earned.points.balance, 1515);
  await preferences(owner, { bio: '', followedAuthors: [] });
  expect(await claim(owner, 'complete_profile'), 409); expect(await claim(owner, 'follow_authors'), 409);
  assert.equal((await center(owner)).points.balance, 1515);
});

test('publication rewards require approved listed owner content and are not earned for pending or taken down cards', async () => {
  const draft = character();
  const pending = expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { character: draft, accountId: owner.user.id } }), 201);
  expect(await claim(owner, 'publish_character'), 400);
  const approved = expect(await admin.request(`/v1/publishing/submissions/${pending.submission.id}/review`, { method: 'PATCH', body: {
    version: pending.publication.version, decision: 'approved', accountId: admin.user.id,
  } }), 200);
  assert.equal(task(await center(owner), 'publish_character').eligible, true);
  assert.equal(task(await center(stranger), 'publish_character').eligible, false);
  const removed = expect(await owner.request(`/v1/publishing/publications/${approved.publication.id}/unpublish`, { method: 'POST', body: {
    version: approved.publication.version, accountId: owner.user.id,
  } }), 200);
  expect(await claim(owner, 'publish_character'), 400);
  const next = expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { character: draft, publicationId: removed.publication.id,
    version: removed.publication.version, accountId: owner.user.id } }), 201);
  const relisted = expect(await admin.request(`/v1/publishing/submissions/${next.submission.id}/review`, { method: 'PATCH', body: {
    version: next.publication.version, decision: 'approved', accountId: admin.user.id,
  } }), 200);
  const earned = expect(await claim(owner, 'publish_character'), 201);
  assert.equal(earned.claim.points, 20); assert.equal(earned.points.balance, 1535);
  expect(await owner.request(`/v1/publishing/publications/${relisted.publication.id}/unpublish`, { method: 'POST', body: {
    version: relisted.publication.version, accountId: owner.user.id,
  } }), 200);
  expect(await claim(owner, 'publish_character'), 409);
});

test('forum reward requires an existing own reply and deleting it or its parent cannot create progress', async () => {
  const thread = await post(stranger); await reply(stranger, thread.id);
  expect(await claim(owner, 'forum_reply'), 400);
  const removed = await reply(owner, thread.id);
  assert.equal(task(await center(owner), 'forum_reply').eligible, true);
  expect(await owner.request(`/v1/forum/replies/${removed.id}`, { method: 'DELETE' }), 200);
  expect(await claim(owner, 'forum_reply'), 400);
  await reply(owner, thread.id);
  const earned = expect(await claim(owner, 'forum_reply'), 201);
  assert.equal(earned.claim.points, 5); assert.equal(earned.points.balance, 1540);
  expect(await stranger.request(`/v1/forum/posts/${thread.id}`, { method: 'DELETE' }), 200);
  const deleted = await center(owner);
  assert.equal(task(deleted, 'forum_reply').eligible, false); assert.equal(task(deleted, 'forum_reply').claimed, true);
  expect(await claim(owner, 'forum_reply'), 409);
});

test('twenty concurrent daily claims atomically award one permanent Credit ledger entry', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => claim(concurrent, 'daily_checkin')));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 19);
  const earned = results.find(result => result.status === 201).data;
  assert.equal(earned.claim.expiresAt, null);
  assert.equal(earned.claim.period, new Date(earned.claim.claimedAt).toISOString().slice(0, 10));
  const reloaded = await center(new Client(concurrent.cookie));
  assert.equal(reloaded.points.balance, 1505); assert.equal(reloaded.points.totalEarned, 5); assert.equal(reloaded.recentClaims.length, 1);
  assert.equal(task(reloaded, 'daily_checkin').claimed, true); assert.equal(task(reloaded, 'daily_checkin').claimable, false);
  assert.equal((await center(stranger)).points.balance, 1500);
  assert.ok(!JSON.stringify(reloaded).includes(owner.user.id));
});

test('legacy reward expiry fields remain in audit history while merged Credit stays spendable', async () => {
  const now = Date.now();
  const activeAt = now - 29 * DAY;
  await seedTestTaskClaims(expiry.user.id, [
    { taskId: 'daily_checkin', claimedAt: now - 31 * DAY },
    { taskId: 'daily_checkin', claimedAt: now - 30 * DAY },
    { taskId: 'daily_checkin', claimedAt: activeAt },
    { taskId: 'first_conversation', claimedAt: now - 100 * DAY },
  ]);
  const before = await center(expiry);
  assert.equal(before.points.balance, 1520); assert.equal(before.points.totalEarned, 20); assert.equal(before.points.expired, 0);
  assert.equal(before.points.expiringSoon, 0); assert.equal(before.points.earliestExpiryAt, null);
  assert.equal(task(before, 'daily_checkin').claimed, false); assert.equal(task(before, 'daily_checkin').claimable, true);
  assert.equal(task(before, 'first_conversation').claimed, true);
  const earned = expect(await claim(expiry, 'daily_checkin'), 201);
  assert.equal(earned.points.balance, 1525); assert.equal(earned.points.totalEarned, 25); assert.equal(earned.points.expired, 0);
  expect(await claim(expiry, 'daily_checkin'), 409); expect(await claim(expiry, 'first_conversation'), 409);
  const reloaded = await center(new Client(expiry.cookie));
  assert.equal(reloaded.recentClaims.length, 5); assert.equal(reloaded.points.balance, 1525);
  assert.ok(reloaded.recentClaims.every(record => record.expiresAt === null));
});

test('guest upgrade retains actual progress and a registered account can then claim once', async () => {
  const guestId = guest.user.id;
  expect(await guest.request('/v1/auth/register', { method: 'POST', body: { email: `${randomUUID()}@tasks.example.test`, password: 'Task-password-2026!', nickname: '转正任务账户' } }), 201);
  assert.equal(guest.user.id, guestId);
  const upgraded = await center(guest);
  assert.equal(upgraded.isGuest, false); assert.equal(task(upgraded, 'first_conversation').claimable, true);
  const earned = expect(await claim(guest, 'first_conversation'), 201);
  assert.equal(earned.points.balance, 1505); assert.equal(earned.accountId, guestId);
});
