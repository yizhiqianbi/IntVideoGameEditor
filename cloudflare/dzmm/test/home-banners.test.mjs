import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { promoteTestUserToSuper } from './test-admin.mjs';

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm test for the isolated Worker.');
const origin = 'http://127.0.0.1:3010';
const password = 'Banner-test-password-2026!';

class Client {
  constructor(cookie = '') { this.cookie = cookie; this.user = null; }
  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Origin: origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user) this.user = data.user;
    return { status: response.status, data };
  }
}

test('homepage banners are general by default and a chosen empty audience falls back to male', async () => {
  const admin = new Client();
  const registered = await admin.request('/v1/auth/register', { method: 'POST', body: {
    email: `${randomUUID()}@banner.example.test`, password, nickname: '横幅管理员',
  } });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  await promoteTestUserToSuper(admin.user.id);
  const session = await admin.request('/v1/session');
  assert.equal(session.data.user.role, 'super');

  const created = await admin.request('/v1/admin/banners', { method: 'POST', body: {
    accountId: admin.user.id, audience: 'general', position: 2, title: '今晚的故事', body: '先看一段，再决定要不要聊。', href: '#checkin',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const male = await admin.request('/v1/admin/banners', { method: 'POST', body: {
    accountId: admin.user.id, audience: 'male', position: 9, title: '男性向横幅', body: '只在选定受众后出现。', href: null,
  } });
  assert.equal(male.status, 201, JSON.stringify(male.data));
  const duplicate = await admin.request('/v1/admin/banners', { method: 'POST', body: {
    accountId: admin.user.id, audience: 'general', position: 2, title: '重复位置', body: '不应保存。',
  } });
  assert.equal(duplicate.status, 409);

  const home = await new Client().request('/v1/home/banners');
  assert.equal(home.status, 200);
  assert.deepEqual(home.data.banners.map((item) => item.title), ['今晚的故事']);
  const female = await new Client().request('/v1/home/banners?audience=female');
  assert.deepEqual(female.data.banners.map((item) => item.title), ['男性向横幅']);

  const removed = await admin.request(`/v1/admin/banners/${created.data.banner.id}/delete`, { method: 'POST', body: { accountId: admin.user.id } });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.banner.deletedAt !== null, true);
  const after = await new Client().request('/v1/home/banners');
  assert.deepEqual(after.data.banners, []);
  const reused = await admin.request('/v1/admin/banners', { method: 'POST', body: {
    accountId: admin.user.id, audience: 'general', position: 2, title: '重新使用的位置', body: '软删除后编号可以再用。',
  } });
  assert.equal(reused.status, 201, JSON.stringify(reused.data));
});
