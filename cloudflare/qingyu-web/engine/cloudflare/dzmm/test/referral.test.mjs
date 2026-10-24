import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm test for the isolated Worker.');
const origin = 'http://127.0.0.1:3010';
const password = 'Referral-test-password-2026!';

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

async function register(inviteCode) {
  const client = new Client();
  const body = { email: `${randomUUID()}@referral.example.test`, password, nickname: '邀请测试用户', ...(inviteCode ? { inviteCode } : {}) };
  const result = await client.request('/v1/auth/register', { method: 'POST', body });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return client;
}

test('registration invite awards spendable Credit and exposes stable sharing details', async () => {
  const owner = await register();
  const first = await owner.request('/v1/referral');
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.match(first.data.inviteCode, /^XM[A-Z0-9]{6,64}$/);
  assert.equal(first.data.invitedCount, 0);
  assert.equal(first.data.earnedPoints, 0);
  assert.equal(first.data.pointsKind, 'credit');
  assert.equal(first.data.modelBillingLinked, true);
  assert.match(first.data.inviteUrl, /[?&]invite=/);

  await register(first.data.inviteCode);
  const second = await owner.request('/v1/referral');
  assert.equal(second.data.invitedCount, 1);
  assert.equal(second.data.earnedPoints, 500);
  const tasks = await owner.request('/v1/tasks');
  assert.equal(tasks.status, 200);
  assert.equal(tasks.data.points.balance, 2000);
  assert.equal(tasks.data.points.totalEarned, 500);

  await register(first.data.inviteCode);
  const third = await owner.request('/v1/referral');
  assert.equal(third.data.invitedCount, 2);
  assert.equal(third.data.earnedPoints, 1000);
  assert.equal(third.data.inviteCode, first.data.inviteCode);
});

test('invalid invitation codes fail before creating an account', async () => {
  const client = new Client();
  const result = await client.request('/v1/auth/register', { method: 'POST', body: {
    email: `${randomUUID()}@referral.example.test`, password, nickname: '无效邀请码', inviteCode: 'XMNOTAREALCODE',
  } });
  assert.equal(result.status, 400);
  assert.equal(result.data.error, '邀请码无效或不能邀请自己。');
  const session = await client.request('/v1/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.user, null);
});
