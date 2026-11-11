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

  assert.equal(first.data.rewardPoints, 20);
  assert.equal(first.data.rebatePercent, 15);
  assert.equal(first.data.rebateCurrency, 'CNY');
  assert.equal(first.data.activityRewardPoints, 5);
  assert.equal(first.data.activityRewardDays, 3);

  const invitee = await register(first.data.inviteCode);
  const second = await owner.request('/v1/referral');
  assert.equal(second.data.invitedCount, 1);
  assert.equal(second.data.earnedPoints, 20);
  const tasks = await owner.request('/v1/tasks');
  assert.equal(tasks.status, 200);
  assert.equal(tasks.data.points.balance, 320);
  assert.equal(tasks.data.points.totalEarned, 20);

  const catalog = await invitee.request('/v1/characters');
  const character = catalog.data.characters.find((item) => item.catalogReadiness === 'full-card' || item.catalogReadiness === 'public-context');
  assert.ok(character, '需要一个可开启会话的角色');
  const conversationId = randomUUID();
  const opened = await invitee.request('/v1/conversations', { method: 'POST', body: { conversation: {
    id: conversationId, characterId: character.id, messages: [{ role: 'assistant', content: '今晚想聊什么？' }],
  } } });
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  const round = await invitee.request(`/v1/conversations/${conversationId}/messages`, { method: 'PUT', body: { messages: [
    { role: 'assistant', content: '今晚想聊什么？' },
    { role: 'user', content: '我们先把今天的事说完。' },
    { role: 'assistant', content: '好，你先说。' },
  ] } });
  assert.equal(round.status, 200, JSON.stringify(round.data));
  const active = await owner.request('/v1/referral');
  assert.equal(active.data.earnedPoints, 25);
  const repeated = await invitee.request(`/v1/conversations/${conversationId}/messages`, { method: 'PUT', body: { messages: [
    { role: 'assistant', content: '今晚想聊什么？' },
    { role: 'user', content: '我们先把今天的事说完。' },
    { role: 'assistant', content: '好，你先说。' },
    { role: 'user', content: '明天也继续。' },
    { role: 'assistant', content: '那就说到这里。' },
  ] } });
  assert.equal(repeated.status, 200, JSON.stringify(repeated.data));
  assert.equal((await owner.request('/v1/referral')).data.earnedPoints, 25);

  await register(first.data.inviteCode);
  const third = await owner.request('/v1/referral');
  assert.equal(third.data.invitedCount, 2);
  assert.equal(third.data.earnedPoints, 45);
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
