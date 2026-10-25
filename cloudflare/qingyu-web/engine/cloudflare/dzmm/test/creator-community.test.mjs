import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { promoteTestUserToSuper } from './test-admin.mjs';

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm run test:backend to start the isolated local Worker.');
const origin = 'http://127.0.0.1:3010';
class Client {
  constructor(cookie = '') { this.cookie = cookie; this.accountId = null; }
  async request(path, { method = 'GET', body } = {}) {
    const headers = { Origin: origin };
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}
function assertStatus(result, ...statuses) {
  assert.ok(statuses.includes(result.status), `${result.status}: ${JSON.stringify(result.data)}`);
  return result.data;
}

test('creator community keeps profiles pending, supports free feed, and never starts payment', async () => {
  const anonymous = new Client();
  assertStatus(await anonymous.request('/v1/community/creators'), 200);
  assertStatus(await anonymous.request('/v1/community/feed'), 200);

  const user = new Client();
  const email = `creator-${randomUUID()}@example.test`;
  assertStatus(await user.request('/v1/auth/register', { method: 'POST', body: { email, password: 'creator-community-password-2026', nickname: '测试创作者' } }), 201);
  const profile = assertStatus(await user.request('/v1/community/creators', { method: 'POST', body: { displayName: '雾港日记', bio: '一段温柔的故事。' } }), 201).profile;
  assert.equal(profile.status, 'pending');
  assertStatus(await user.request('/v1/community/creators', { method: 'GET' }), 200).creators.forEach(item => assert.notEqual(item.id, profile.id));

  await promoteTestUserToSuper(user.accountId);
  assertStatus(await user.request(`/v1/community/moderation/creators/${profile.id}`, { method: 'PATCH', body: { status: 'approved' } }), 200);
  const detail = assertStatus(await user.request(`/v1/community/creators/${profile.id}`), 200);
  assert.equal(detail.creator.displayName, '雾港日记');
  assertStatus(await user.request(`/v1/community/creators/${profile.id}/follow`, { method: 'POST' }), 200);
  const intent = assertStatus(await user.request(`/v1/community/creators/${profile.id}/subscription-intent`, { method: 'POST' }), 201);
  assert.equal(intent.paymentsEnabled, false);

  const post = assertStatus(await user.request(`/v1/community/creators/${profile.id}/posts`, {
    method: 'POST', body: { type: 'text', body: '今天有一条新的探险线索。', visibility: 'free' },
  }), 201).post;
  assert.equal(post.visibility, 'free');
  assert.ok(!(assertStatus(await anonymous.request('/v1/community/feed'), 200).posts.some(item => item.id === post.id)), 'pending posts are not public before moderation');
  assertStatus(await user.request(`/v1/community/moderation/posts/${post.id}`, { method: 'PATCH', body: { status: 'approved' } }), 200);
  const feed = assertStatus(await anonymous.request('/v1/community/feed'), 200);
  assert.ok(feed.posts.some(item => item.id === post.id));

  assertStatus(await user.request(`/v1/community/posts/${post.id}/like`, { method: 'POST' }), 200);
});
