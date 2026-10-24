import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { promoteTestUserToSuper } from './test-admin.mjs';

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm test to start the isolated local Worker.');
const appOrigin = 'http://127.0.0.1:3010';
const sampleCharacterId = 'qy-shiyu';
const password = 'Dzmm-test-password-2026!';
const byId = (left, right) => left.id.localeCompare(right.id);

class Client {
  constructor(cookie = '') { this.cookie = cookie; this.accountId = null; }
  async request(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const requestHeaders = { Origin: appOrigin, ...headers };
    if (this.cookie) requestHeaders.Cookie = this.cookie;
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: requestHeaders,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data, headers: response.headers, cookie };
  }
}

function expectStatus(response, ...codes) {
  assert.ok(codes.includes(response.status), `Expected ${codes.join('/')} but got ${response.status}: ${JSON.stringify(response.data)}`);
  return response.data;
}
async function guest() {
  const client = new Client();
  expectStatus(await client.request('/v1/auth/guest', { method: 'POST' }), 200, 201);
  assert.ok(client.cookie, 'Guest must receive a session cookie.');
  return client;
}
async function snapshot(client) { return expectStatus(await client.request('/v1/state'), 200); }
async function save(client, state, version) {
  const accountId = client.accountId ?? (await snapshot(client)).user.id;
  return client.request('/v1/state', { method: 'PUT', body: { state, version, accountId } });
}
function blankState(nickname = '测试用户') {
  return {
    version: 1, favorites: [], custom: [], conversations: [],
    preferences: { nickname, persona: '', preset: '', model: 'balanced', dark: false },
  };
}
function newCharacter(id = `test-${randomUUID()}`) {
  return {
    id, name: '雾港档案员', author: '测试作者', description: '成年档案员帮助旅人寻找遗失地图。',
    personality: '耐心细致。', scenario: '海港书库。', firstMessage: '你想查哪一份地图？',
    tags: ['剧情', '原创'], cover: '/art/shiyu.webp',
  };
}
async function createCharacter(client, character = newCharacter()) {
  const result = expectStatus(await client.request('/v1/characters', { method: 'POST', body: { character } }), 200, 201);
  assert.ok(result.state.custom.some(item => item.id === character.id));
  return { result, character };
}
async function createConversation(client, characterId = sampleCharacterId) {
  const conversation = { id: `chat-${randomUUID()}`, characterId, title: '寻找地图', updatedAt: Date.now(), messages: [] };
  const result = expectStatus(await client.request('/v1/conversations', { method: 'POST', body: { conversation } }), 200, 201);
  assert.ok(result.state.conversations.some(item => item.id === conversation.id));
  return { result, conversation };
}

test('private state requires a server session', async () => {
  const anonymous = new Client();
  expectStatus(await anonymous.request('/v1/state'), 401);
  expectStatus(await anonymous.request('/v1/conversations'), 401);
  expectStatus(await anonymous.request('/v1/state', { method: 'PUT', body: { state: blankState(), version: 0 } }), 401);
});

test('guest identity is reused and the cookie is HttpOnly and SameSite', async () => {
  const client = new Client();
  const first = await client.request('/v1/auth/guest', { method: 'POST' });
  expectStatus(first, 200, 201);
  assert.match(first.cookie, /HttpOnly/i);
  assert.match(first.cookie, /SameSite=Lax/i);
  const before = await snapshot(client);
  expectStatus(await client.request('/v1/auth/guest', { method: 'POST' }), 200, 201);
  const after = await snapshot(client);
  assert.equal(after.user.id, before.user.id);
  assert.equal(after.user.isGuest, true);
  assert.equal(after.version, 0);
});

test('state survives a new HTTP client using the same session', async () => {
  const client = await guest();
  const initial = await snapshot(client);
  assert.equal(initial.initialized, false);
  const state = blankState('持久化昵称');
  state.favorites = [sampleCharacterId];
  state.conversations = [{ id: 'persistent-chat', characterId: sampleCharacterId, title: '第一次探险', updatedAt: 1000,
    messages: [{ id: 'opening', role: 'assistant', content: '晨雾散去，你抵达海港。' }, { id: 'reply', role: 'user', content: '去书库。' }] }];
  const saved = expectStatus(await save(client, state, initial.version), 200);
  assert.equal(saved.version, initial.version + 1);
  const reloaded = await snapshot(new Client(client.cookie));
  assert.deepEqual(reloaded.state, saved.state);
  assert.equal(reloaded.initialized, true);
});

test('original all-ages catalog supports persisted favorites and complete opening conversations', async () => {
  const client = await guest();
  const catalog = expectStatus(await client.request('/v1/characters'),200).characters;
  const imported = catalog;
  const importedIds = catalog.map(c=>c.id);
  assert.deepEqual(new Set(importedIds),new Set(['qy-shiyu','qy-shen','qy-linchuan','qy-xingcheng']));
  assert.ok(catalog.every(c=>c.sourceKind==='original' && c.catalogReadiness==='full-card' && c.firstMessage.trim()));
  const characterId='qy-shiyu'; const character=catalog.find(c=>c.id===characterId);
  expectStatus(await client.request(`/v1/favorites/${characterId}`, { method: 'PUT' }), 200);
  const { conversation, result } = await createConversation(client, characterId);
  const openingReload = await snapshot(new Client(client.cookie));
  assert.deepEqual(openingReload.state.favorites, [characterId]);
  assert.equal(openingReload.state.custom.length, 0, 'Public catalog records do not belong to the private role table.');
  const seed = openingReload.state.conversations.find(item => item.id === conversation.id).messages;
  assert.equal(seed.length, 1);
  assert.equal(seed[0].role, 'assistant');
  assert.ok(seed[0].id);
  assert.ok(seed[0].content === character.firstMessage.trim(), 'Missing authored openings display the unchanged public background.');
  const messages = [
    { id: 'traveler-question', role: 'user', content: '你还好吗？需要一杯温水吗？' },
    { id: 'traveler-reply', role: 'assistant', content: '许安安醒来，揉了揉眼睛：谢谢，我刚才太累了。' },
  ];
  const saved = expectStatus(await client.request(`/v1/conversations/${conversation.id}/messages`, {
    method: 'PUT', body: { messages, version: result.version },
  }), 200);
  const reloaded = await snapshot(new Client(client.cookie));
  assert.deepEqual(reloaded.state, saved.state);
  assert.deepEqual(expectStatus(await new Client(client.cookie).request(`/v1/conversations/${conversation.id}`), 200).conversation.messages, messages);

  // Every newly captured ID must be recognized by D1 state persistence, not
  // only by the catalog response; retain the existing populated conversation.
  const expandedState = structuredClone(reloaded.state);
  expandedState.favorites = [...importedIds];
  expandedState.conversations.push(...imported.filter(item => item.id !== characterId).map(item => ({
    id: `captured-chat-${item.id}`, characterId: item.id, title: item.name,
    updatedAt: 1000, messages: [],
  })));
  const expandedSaved = expectStatus(await save(client, expandedState, reloaded.version), 200);
  const expandedReload = await snapshot(new Client(client.cookie));
  assert.deepEqual(expandedReload.state, expandedSaved.state);
  assert.deepEqual(expandedReload.state, expandedState);
  assert.equal(expandedReload.state.custom.length, 0);
  assert.deepEqual(new Set(expandedReload.state.favorites), new Set(importedIds));
  assert.deepEqual(new Set(expandedReload.state.conversations.map(item => item.characterId)), new Set(importedIds));

  for (const publicId of catalog.map(item => item.id)) {
    expectStatus(await client.request('/v1/characters', { method: 'POST', body: { character: newCharacter(publicId) } }), 400);
    const forgedState = structuredClone(expandedReload.state);
    forgedState.custom = [newCharacter(publicId)];
    expectStatus(await save(client, forgedState, expandedReload.version), 400);
  }
  const unchanged = await snapshot(new Client(client.cookie));
  assert.equal(unchanged.version, expandedReload.version);
  assert.deepEqual(unchanged.state, expandedReload.state);
});

test('register upgrades a guest without losing roles, chats or favorites', async () => {
  const client = await guest();
  const before = await snapshot(client);
  const { character } = await createCharacter(client);
  const { conversation } = await createConversation(client, character.id);
  const current = await snapshot(client);
  const state = current.state;
  state.preferences.nickname = '注册前昵称';
  state.favorites = [sampleCharacterId];
  const saved = expectStatus(await save(client, state, current.version), 200);
  const oldCookie = client.cookie;
  const email = `upgrade-${randomUUID()}@example.test`;
  const registered = expectStatus(await client.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '注册后昵称' } }), 200, 201);
  const after = await snapshot(client);
  assert.equal(after.user.id, before.user.id);
  assert.equal(after.user.isGuest, false);
  assert.equal(after.user.email, email);
  assert.equal(after.user.nickname, '注册后昵称');
  assert.equal(after.state.preferences.nickname, '注册后昵称');
  assert.equal(after.version, saved.version + 1);
  assert.equal(registered.user.version, after.version);
  assert.deepEqual(after.state, {
    ...saved.state,
    preferences: { ...saved.state.preferences, nickname: '注册后昵称' },
  });
  assert.deepEqual(after.state.favorites, [sampleCharacterId]);
  assert.equal(after.state.custom[0].id, character.id);
  assert.equal(after.state.conversations[0].id, conversation.id);
  assert.notEqual(client.cookie, oldCookie, 'Registration must rotate the session.');
  expectStatus(await new Client(oldCookie).request('/v1/state'), 401);
  // A tab holding the old guest snapshot must not restore the pre-registration
  // nickname after the account upgrade rotates its session.
  const conflict = expectStatus(await save(client, saved.state, saved.version), 409);
  assert.equal(conflict.version, after.version);
  assert.equal(conflict.state.preferences.nickname, '注册后昵称');
  assert.deepEqual((await snapshot(client)).state, after.state);
});

test('login restores the account and logout invalidates the server session', async () => {
  const client = await guest();
  const email = `login-${randomUUID()}@example.test`;
  expectStatus(await client.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '登录用户' } }), 200, 201);
  const before = await snapshot(client);
  const oldCookie = client.cookie;
  expectStatus(await client.request('/v1/auth/logout', { method: 'POST' }), 200, 204);
  expectStatus(await new Client(oldCookie).request('/v1/state'), 401);
  const another = new Client();
  expectStatus(await another.request('/v1/auth/login', { method: 'POST', body: { email, password } }), 200);
  assert.equal((await snapshot(another)).user.id, before.user.id);
});

test('wrong passwords and duplicate registrations do not replace an account', async () => {
  const owner = await guest();
  const email = `unique-${randomUUID()}@example.test`;
  expectStatus(await owner.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '原用户' } }), 200, 201);
  const duplicate = await guest();
  const duplicateId = (await snapshot(duplicate)).user.id;
  expectStatus(await duplicate.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '重复注册' } }), 400, 409);
  assert.equal((await snapshot(duplicate)).user.id, duplicateId);
  const wrong = new Client();
  const failure = await wrong.request('/v1/auth/login', { method: 'POST', body: { email, password: 'incorrect-password' } });
  expectStatus(failure, 401);
  assert.equal(wrong.cookie, '');
});

test('two users can use the same record IDs without reading each other', async () => {
  const first = await guest();
  const second = await guest();
  const sharedId = `shared-${randomUUID()}`;
  const a = newCharacter(sharedId); a.name = '第一位用户的人物';
  const b = newCharacter(sharedId); b.name = '第二位用户的人物';
  await createCharacter(first, a);
  await createCharacter(second, b);
  assert.equal((await snapshot(first)).state.custom[0].name, a.name);
  assert.equal((await snapshot(second)).state.custom[0].name, b.name);
  const userA = (await snapshot(first)).user.id;
  const forged = blankState('冒充用户'); forged.favorites = [sampleCharacterId];
  expectStatus(await second.request('/v1/state', { method: 'PUT', body: { state: forged, version: 1, accountId: second.accountId, userId: userA } }), 200, 400);
  assert.equal((await snapshot(first)).state.custom[0].name, a.name);
});

test('concurrent state writes produce exactly one success and one version conflict', async () => {
  const client = await guest();
  const before = await snapshot(client);
  const states = [blankState('并发请求甲'), blankState('并发请求乙')];
  const results = await Promise.all(states.map(state => save(client, state, before.version)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const conflict = results.find(result => result.status === 409);
  const winner = results.find(result => result.status === 200);
  assert.equal(conflict.data.version, winner.data.version);
  assert.deepEqual((await snapshot(client)).state, winner.data.state);
});

test('state synchronization cannot write a stale tab into a different signed-in account', async () => {
  const first = await guest();
  const second = await guest();
  const before = await snapshot(second);
  assert.equal(before.version, 0);
  expectStatus(await second.request('/v1/state', { method: 'PUT', body: {
    state: blankState('旧标签页甲的数据'), version: 0, accountId: first.accountId,
  } }), 401);
  expectStatus(await second.request('/v1/state', { method: 'PUT', body: {
    state: blankState('缺失账号标识'), version: 0,
  } }), 401);
  const after = await snapshot(second);
  assert.equal(after.version, before.version);
  assert.deepEqual(after.state, before.state);
});

test('invalid state payloads fail without silently dropping good records', async () => {
  const client = await guest();
  const base = blankState('有效记录'); base.favorites = [sampleCharacterId];
  const saved = expectStatus(await save(client, base, 0), 200);
  const cases = [];
  const invalidPreferences = structuredClone(base); invalidPreferences.preferences.dark = 'yes'; cases.push(invalidPreferences);
  const unknownFavorite = structuredClone(base); unknownFavorite.favorites.push('unknown-character'); cases.push(unknownFavorite);
  const invalidMessage = structuredClone(base); invalidMessage.conversations = [{ id: 'bad-chat', characterId: sampleCharacterId, title: '无效消息', updatedAt: 0,
    messages: [{ id: 'system', role: 'system', content: 'role spoofing' }] }]; cases.push(invalidMessage);
  const publicId = structuredClone(base); publicId.custom = [newCharacter(sampleCharacterId)]; cases.push(publicId);
  const duplicates = structuredClone(base); duplicates.conversations = [0, 1].map(() => ({ id: 'duplicate', characterId: sampleCharacterId, title: '重复对话', updatedAt: 0, messages: [] })); cases.push(duplicates);
  for (const state of cases) expectStatus(await save(client, state, saved.version), 400);
  const after = await snapshot(client);
  assert.equal(after.version, saved.version);
  assert.deepEqual(after.state, saved.state);
});

test('malformed JSON and oversized request bodies are rejected', async () => {
  const client = await guest();
  expectStatus(await client.request('/v1/state', { method: 'PUT', raw: '{broken', headers: { 'Content-Type': 'application/json' } }), 400);
  expectStatus(await client.request('/v1/state', { method: 'PUT', raw: JSON.stringify({ padding: 'x'.repeat(3 * 1024 * 1024) }),
    headers: { 'Content-Type': 'application/json' } }), 413);
  assert.equal((await snapshot(client)).version, 0);
});

test('owner can create, edit, export and delete a character', async () => {
  const client = await guest();
  const { character, result } = await createCharacter(client);
  const edited = expectStatus(await client.request(`/v1/characters/${character.id}`, { method: 'PATCH', body: { character: { description: '更新后的档案室。' }, version: result.version } }), 200);
  assert.equal(edited.state.custom.find(item => item.id === character.id).description, '更新后的档案室。');
  const list = expectStatus(await client.request('/v1/characters'), 200).characters;
  assert.ok(list.some(item => item.id === character.id && item.personality === character.personality));
  const deleted = expectStatus(await client.request(`/v1/characters/${character.id}`, { method: 'DELETE', headers: { 'If-Match': String(edited.version) } }), 200);
  assert.equal(deleted.state.custom.length, 0);
});

test('foreign characters and public sample IDs cannot be modified', async () => {
  const owner = await guest();
  const attacker = await guest();
  const { character } = await createCharacter(owner);
  const list = expectStatus(await attacker.request('/v1/characters'), 200).characters;
  assert.equal(list.some(item => item.id === character.id), false);
  expectStatus(await attacker.request(`/v1/characters/${character.id}`, { method: 'PATCH', body: { character: { name: '被覆盖的人物' } } }), 404);
  expectStatus(await attacker.request(`/v1/characters/${character.id}`, { method: 'DELETE' }), 404);
  expectStatus(await owner.request(`/v1/characters/${sampleCharacterId}`, { method: 'PATCH', body: { character: { name: '篡改公开角色' } } }), 400, 403, 404);
  assert.equal((await snapshot(owner)).state.custom[0].name, character.name);
});

test('a stale character update returns the current revision and preserves the newer edit', async () => {
  const client = await guest();
  const { character, result } = await createCharacter(client);
  const fresh = expectStatus(await client.request(`/v1/characters/${character.id}`, {
    method: 'PATCH', body: { character: { name: '新版本人物' }, version: result.version },
  }), 200);
  const conflict = expectStatus(await client.request(`/v1/characters/${character.id}`, {
    method: 'PATCH', body: { character: { name: '旧版本覆盖' }, version: result.version },
  }), 409);
  assert.equal(conflict.version, fresh.version);
  assert.equal((await snapshot(client)).state.custom[0].name, '新版本人物');
});

test('deleting a custom character removes its dependent chats and favorites', async () => {
  const client = await guest();
  const { character } = await createCharacter(client);
  const { conversation } = await createConversation(client, character.id);
  expectStatus(await client.request(`/v1/favorites/${character.id}`, { method: 'PUT' }), 200);
  const deleted = expectStatus(await client.request(`/v1/characters/${character.id}`, { method: 'DELETE' }), 200);
  assert.equal(deleted.state.custom.some(item => item.id === character.id), false);
  assert.equal(deleted.state.conversations.some(item => item.id === conversation.id), false);
  assert.equal(deleted.state.favorites.includes(character.id), false);
  expectStatus(await client.request(`/v1/conversations/${conversation.id}`), 404);
});

test('conversations and messages are persisted and foreign access is denied', async () => {
  const owner = await guest();
  const attacker = await guest();
  const { conversation, result } = await createConversation(owner);
  const messages = [{ id: 'm-1', role: 'assistant', content: '你来到档案室。' }, { id: 'm-2', role: 'user', content: '查看地图。' }];
  expectStatus(await owner.request(`/v1/conversations/${conversation.id}/messages`, { method: 'PUT', body: { messages, version: result.version } }), 200);
  const loaded = expectStatus(await owner.request(`/v1/conversations/${conversation.id}`), 200);
  assert.deepEqual(loaded.conversation.messages, messages);
  expectStatus(await attacker.request(`/v1/conversations/${conversation.id}`), 404);
  expectStatus(await attacker.request(`/v1/conversations/${conversation.id}/messages`, { method: 'PUT', body: { messages } }), 404);
  expectStatus(await attacker.request(`/v1/conversations/${conversation.id}`, { method: 'DELETE' }), 404);
  assert.equal(expectStatus(await attacker.request('/v1/conversations'), 200).conversations.length, 0);
});

test('favorites and preferences are scoped to the current user', async () => {
  const client = await guest();
  const other = await guest();
  expectStatus(await client.request(`/v1/favorites/${sampleCharacterId}`, { method: 'PUT' }), 200);
  const changed = expectStatus(await client.request('/v1/preferences', { method: 'PATCH', body: { preferences: { nickname: '书库旅人', dark: true, model: 'story' } } }), 200);
  assert.deepEqual(changed.state.favorites, [sampleCharacterId]);
  assert.equal(changed.state.preferences.nickname, '书库旅人');
  assert.equal(changed.state.preferences.dark, true);
  assert.equal((await snapshot(other)).state.favorites.length, 0);
  expectStatus(await client.request(`/v1/favorites/${sampleCharacterId}`, { method: 'DELETE' }), 200);
  assert.deepEqual((await snapshot(client)).state.favorites, []);
});

test('optional profile, appearance, author, and preset preferences persist through real D1 reads', async () => {
  const owner = await guest();
  const other = await guest();
  const otherBefore = await snapshot(other);
  const oldState = blankState('旧存档昵称');
  oldState.favorites = [sampleCharacterId];
  const legacySaved = expectStatus(await save(owner, oldState, 0), 200);
  assert.deepEqual((await snapshot(new Client(owner.cookie))).state, oldState,
    'Core-only preference records must reload without optional defaults.');
  const extras = {
    bio: '我喜欢在海港收集故事。', gender: 'other', theme: 'system', homeLayout: 'single',
    showFloatingChat: false, floatingSize: 'large', floatingOpacity: 72.5, maxTokens: 4096,
    blockedTags: ['悬疑', '恐怖'], followedAuthors: ['作者甲', '作者乙'],
    presets: [
      { id: 'preset-story', name: '细节描写', content: '描写环境\n给用户留出选择。' },
      { id: 'preset-empty', name: '默认', content: '' },
    ],
  };
  const saved = expectStatus(await owner.request('/v1/preferences', {
    method: 'PATCH', body: { preferences: { ...extras, undeclaredPreference: 'must not be stored' }, version: legacySaved.version },
  }), 200);
  const expectedState = { ...oldState, preferences: { ...oldState.preferences, ...extras } };
  assert.deepEqual(saved.state, expectedState);
  assert.deepEqual((await snapshot(new Client(owner.cookie))).state, expectedState);
  assert.deepEqual((await snapshot(other)).state, otherBefore.state);
  assert.equal(Object.hasOwn(saved.state.preferences, 'undeclaredPreference'), false);

  const removed = expectStatus(await save(owner, oldState, saved.version), 200);
  assert.deepEqual((await snapshot(new Client(owner.cookie))).state, oldState,
    'Removing optional fields must remove their persisted values.');
  assert.equal(removed.version, saved.version + 1);
});

test('invalid extended preferences fail atomically without losing existing D1 records', async () => {
  const owner = await guest();
  const state = blankState('有效设置');
  state.favorites = [sampleCharacterId];
  state.preferences.bio = '保留现有介绍';
  state.preferences.presets = [{ id: 'kept', name: '保留预设', content: '保留故事进度。' }];
  const saved = expectStatus(await save(owner, state, 0), 200);
  const invalid = [
    { bio: '介'.repeat(501) }, { bio: '坏\0资料' }, { gender: 'unknown' }, { theme: 'blue' },
    { homeLayout: 'triple' }, { showFloatingChat: 'yes' }, { floatingSize: 'huge' },
    { floatingOpacity: 19 }, { floatingOpacity: 101 }, { floatingOpacity: null },
    { maxTokens: 127 }, { maxTokens: 4097 }, { maxTokens: 2048.5 },
    { blockedTags: ['有效', '坏\0标签'] }, { blockedTags: ['重复', '重复'] },
    { blockedTags: Array.from({ length: 51 }, (_, index) => `标签 ${index}`) },
    { followedAuthors: ['作者', '作'.repeat(121)] },
    { followedAuthors: Array.from({ length: 201 }, (_, index) => `作者 ${index}`) },
    { presets: [{ id: ' ', name: '无效', content: '' }] },
    { presets: [{ id: 'p', name: '坏\0名称', content: '' }] },
    { presets: [{ id: 'p', name: '正文太长', content: '预'.repeat(8001) }] },
    { presets: [{ id: 'p', name: '首项', content: '' }, { id: 'p', name: '重复', content: '' }] },
    { presets: Array.from({ length: 31 }, (_, index) => ({ id: `p-${index}`, name: '预设', content: '' })) },
  ];
  for (const preferences of invalid) {
    expectStatus(await owner.request('/v1/preferences', { method: 'PATCH', body: { preferences, version: saved.version } }), 400);
  }
  const reloaded = await snapshot(new Client(owner.cookie));
  assert.equal(reloaded.version, saved.version);
  assert.deepEqual(reloaded.state, state);
});

test('password changes verify the current password, keep this session, and revoke other sessions', async () => {
  const owner = await guest();
  const email = `password-change-${randomUUID()}@example.test`;
  expectStatus(await owner.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '改密用户' } }), 201);
  const accountBefore = await snapshot(owner);
  const second = new Client();
  expectStatus(await second.request('/v1/auth/login', { method: 'POST', body: { email, password } }), 200);
  const ownerCookie = owner.cookie;
  const newPassword = 'Changed-Dzmm-password-2026!';
  const invalid = [
    { currentPassword: 'incorrect-old-password', newPassword },
    { newPassword },
    { currentPassword: password, newPassword: 'short' },
    { currentPassword: password, newPassword: 'x'.repeat(257) },
    { currentPassword: password, newPassword: 'invalid\0password-value' },
  ];
  for (const body of invalid) {
    expectStatus(await owner.request('/v1/auth/password', { method: 'POST', body: { ...body, accountId: accountBefore.user.id } }), 400, 401);
    assert.deepEqual(await snapshot(owner), accountBefore);
    assert.equal((await snapshot(second)).user.id, accountBefore.user.id);
  }
  const changed = await owner.request('/v1/auth/password', { method: 'POST', body: { accountId: accountBefore.user.id, currentPassword: password, newPassword } });
  expectStatus(changed, 200);
  assert.deepEqual(changed.data, { passwordChanged: true, accountId: accountBefore.user.id });
  assert.equal(changed.cookie, null, 'A password change must preserve this session cookie.');
  assert.equal(owner.cookie, ownerCookie);
  assert.deepEqual(await snapshot(owner), accountBefore);
  expectStatus(await second.request('/v1/state'), 401);
  expectStatus(await new Client().request('/v1/auth/login', { method: 'POST', body: { email, password } }), 401);
  const fresh = new Client();
  expectStatus(await fresh.request('/v1/auth/login', { method: 'POST', body: { email, password: newPassword } }), 200);
  assert.deepEqual(await snapshot(fresh), accountBefore);
  const alternatives = ['Concurrent-password-alpha-2026!', 'Concurrent-password-beta-2026!'];
  const concurrent = await Promise.all([owner, fresh].map((client, index) => client.request('/v1/auth/password', {
    method: 'POST', body: { accountId: accountBefore.user.id, currentPassword: newPassword, newPassword: alternatives[index] },
  })));
  assert.equal(concurrent.filter(result => result.status === 200).length, 1,
    'Only one simultaneous change using the same old password may succeed.');
  assert.ok(concurrent.every(result => [200, 401, 409].includes(result.status)));
  const winnerPassword = alternatives[concurrent.findIndex(result => result.status === 200)];
  const afterRace = new Client();
  expectStatus(await afterRace.request('/v1/auth/login', { method: 'POST', body: { email, password: winnerPassword } }), 200);
  assert.deepEqual(await snapshot(afterRace), accountBefore);
});

test('anonymous, guest, and foreign-origin requests cannot change an account password', async () => {
  const anonymous = new Client();
  const body = { currentPassword: password, newPassword: 'Another-password-2026!' };
  expectStatus(await anonymous.request('/v1/auth/password', { method: 'POST', body }), 401);
  const visitor = await guest();
  const guestFailure = await visitor.request('/v1/auth/password', { method: 'POST', body });
  expectStatus(guestFailure, 400);
  assert.match(guestFailure.data.error, /游客.*注册/);
  expectStatus(await visitor.request('/v1/auth/password', { method: 'POST', body, headers: { Origin: 'https://untrusted.example' } }), 403);
  expectStatus(await visitor.request('/v1/auth/password'), 405);
});

test('public account creation and writable state cannot grant the super role', async () => {
  const anonymous = new Client();
  expectStatus(await anonymous.request('/v1/auth/guest', { method: 'POST', body: { role: 'super' } }), 400);
  assert.equal(anonymous.cookie, '');
  const visitor = await guest();
  assert.equal((await snapshot(visitor)).user.role, 'user');
  const email = `role-forgery-${randomUUID()}@example.test`;
  expectStatus(await visitor.request('/v1/auth/register', {
    method: 'POST', body: { email, password, nickname: '普通用户', role: 'super' },
  }), 400);
  assert.equal((await snapshot(visitor)).user.isGuest, true);
  expectStatus(await visitor.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '普通用户' } }), 201);
  const before = await snapshot(visitor);
  assert.equal(before.user.role, 'user');
  const forged = blankState('仍是普通用户');
  forged.role = 'super';
  forged.preferences.role = 'super';
  const saved = expectStatus(await save(visitor, forged, before.version), 200);
  assert.equal(saved.user.role, 'user');
  assert.equal(Object.hasOwn(saved.state, 'role'), false);
  assert.equal(Object.hasOwn(saved.state.preferences, 'role'), false);
  assert.equal(expectStatus(await visitor.request('/v1/session'), 200).user.role, 'user');
});

test('trusted local super role is returned by login, session, and state without a public bootstrap route', async () => {
  const owner = await guest();
  const email = `super-account-${randomUUID()}@example.test`;
  const registered = expectStatus(await owner.request('/v1/auth/register', { method: 'POST', body: { email, password, nickname: '管理员' } }), 201);
  assert.equal(registered.user.role, 'user');
  await promoteTestUserToSuper(registered.user.id);
  assert.equal(expectStatus(await owner.request('/v1/session'), 200).user.role, 'super');
  assert.equal((await snapshot(owner)).user.role, 'super');
  const fresh = new Client();
  const loggedIn = expectStatus(await fresh.request('/v1/auth/login', { method: 'POST', body: { email, password } }), 200);
  assert.equal(loggedIn.user.role, 'super');
  assert.equal((await snapshot(fresh)).user.role, 'super');
  expectStatus(await new Client().request('/v1/auth/bootstrap', { method: 'POST', body: { role: 'super' } }), 404);
});

test('catalog search does not interpret SQL text or wildcard syntax as a query', async () => {
  const client = await guest();
  const normal = expectStatus(await client.request(`/v1/characters?q=${encodeURIComponent('陆时予')}`), 200).characters;
  assert.ok(normal.some(item => item.id === sampleCharacterId));
  const malicious = expectStatus(await client.request(`/v1/characters?q=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`), 200).characters;
  assert.deepEqual(malicious, []);
  assert.ok((await snapshot(client)).user.id);
});

test('mutation requests from an unapproved Origin cannot use the session', async () => {
  const client = await guest();
  const before = await snapshot(client);
  expectStatus(await client.request('/v1/preferences', { method: 'PATCH', headers: { Origin: 'https://untrusted.example' },
    body: { preferences: { nickname: '外站修改' } } }), 403);
  assert.deepEqual((await snapshot(client)).state, before.state);
  const preflight = await client.request('/v1/state', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT' } });
  expectStatus(preflight, 200, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), appOrigin);
  // Browsers use the same-origin Next.js proxy. Cross-site credentialed
  // requests to the raw Worker are deliberately not enabled.
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

test('R2 cover upload round-trips bytes and denies another user access', async () => {
  const owner = await guest();
  const other = await guest();
  const uploaded = expectStatus(await owner.request('/v1/media', {
    method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' },
  }), 200, 201);
  const user = (await snapshot(owner)).user;
  assert.ok(uploaded.key.startsWith(`${user.id}/`));
  assert.match(uploaded.url, /^\/api\/dzmm\/backend\/v1\/media\//);
  const path = `/v1/media/${uploaded.key}`;
  const download = await fetch(`${baseUrl}${path}`, { headers: { Cookie: owner.cookie, Origin: appOrigin } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /^image\/png/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  expectStatus(await other.request(path), 404);
  expectStatus(await other.request(path, { method: 'DELETE' }), 404);
  expectStatus(await owner.request(path, { method: 'DELETE' }), 200, 204);
  expectStatus(await owner.request(path), 404);
});

test('R2 upload rejects active image formats and forged image signatures', async () => {
  const client = await guest();
  expectStatus(await client.request('/v1/media', { method: 'POST', raw: '<svg><script>alert(1)</script></svg>',
    headers: { 'Content-Type': 'image/svg+xml' } }), 400, 415);
  expectStatus(await client.request('/v1/media', { method: 'POST', raw: '<html>forged image</html>',
    headers: { 'Content-Type': 'image/png' } }), 400, 415);
});

test('R2 upload rejects an oversized image before creating an object', async () => {
  const client = await guest();
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
  png.copy(oversized);
  expectStatus(await client.request('/v1/media', { method: 'POST', raw: oversized,
    headers: { 'Content-Type': 'image/png' } }), 413);
});

test('conversation creation restores authored openings, existing background and blank-card welcomes without replacing supplied history', async () => {
  const client = await guest();
  const cases = [
    { character: { ...newCharacter(), firstMessage: '', scenario: '  现有海港书库场景。  ' }, expected: '现有海港书库场景。' },
    { character: { ...newCharacter(), firstMessage: '', scenario: '', description: '  已有的档案员资料。  ' }, expected: '已有的档案员资料。' },
    { character: { ...newCharacter(), firstMessage: '', scenario: '', description: '', introduction: 'DISPLAY_ONLY' }, welcome: true },
    { character: { ...newCharacter(), firstMessage: '欢迎，{{user}}。', openingMessages: [{ role: 'assistant', content: '作者的明确开场。' }] }, expected: '作者的明确开场。' },
  ];
  const allIds = new Set();
  for (const item of cases) {
    const { character } = item;
    await createCharacter(client, character);
    const { conversation } = await createConversation(client, character.id);
    const reloaded = await snapshot(new Client(client.cookie));
    const seed = reloaded.state.conversations.find(candidate => candidate.id === conversation.id).messages;
    assert.equal(seed.length, 1);
    assert.equal(seed[0].role, 'assistant');
    assert.ok(seed[0].id && !allIds.has(seed[0].id));
    allIds.add(seed[0].id);
    if (item.welcome) {
      assert.ok(seed[0].content.includes(character.name));
      assert.ok(seed[0].content.includes('什么场景'));
      assert.ok(!seed[0].content.includes('DISPLAY_ONLY'));
    } else assert.equal(seed[0].content, item.expected);
    const savedCard = reloaded.state.custom.find(candidate => candidate.id === character.id);
    assert.equal(savedCard.firstMessage, character.firstMessage);
    assert.equal(savedCard.description, character.description.trim());
    assert.equal(savedCard.scenario, character.scenario.trim());
  }
  const explicit = {
    id: `chat-${randomUUID()}`, characterId: cases[0].character.id, title: '已有的分支',
    messages: [{ id: 'explicit-user', role: 'user', content: '从这个真实回合继续。' },
      { id: 'explicit-assistant', role: 'assistant', content: '保留已有回应。' }],
  };
  const saved = expectStatus(await client.request('/v1/conversations', { method: 'POST', body: { conversation: explicit } }), 200, 201);
  assert.deepEqual(saved.state.conversations.find(candidate => candidate.id === explicit.id).messages, explicit.messages);
  const reloaded = await snapshot(new Client(client.cookie));
  assert.deepEqual(reloaded.state.conversations.find(candidate => candidate.id === explicit.id).messages, explicit.messages);
});

test('private author context persists through D1 create, reload, edit and atomic invalid rejection', async () => {
  const client = await guest();
  const rich = { ...newCharacter(), introduction: '展示介绍不会发送给模型', creatorNotes: '  致谢与玩法提示仅向玩家展示。\nPS：保留原文。  ', suggestedReplies: ['找地图', '去灯塔'],
    gallery: ['/local/gallery.webp', 'https://example.test/gallery.webp'], systemPrompt: '保持档案员身份。',
    postHistoryInstructions: '结尾留出选择。', messageExamples: '旅人：地图？\n档案员：这里。', alternateGreetings: ['另一种开场。'],
    openingMessages: [{ role: 'user', content: '我来到港城。' }, { role: 'assistant', content: '欢迎来到书库。' }],
    characterBook: { name: '港城世界书', scanDepth: 5, entries: [
      { id: 'always', keys: [], content: '虚构港城。', constant: true },
      { id: 'lighthouse', keys: ['灯塔'], secondaryKeys: ['地图'], content: '灯塔保存旧海图。', selective: true, enabled: true, insertionOrder: 2 },
    ] }, publication: { id: 'forged', authorId: 'victim', revision: 1 },
  };
  expectStatus(await client.request('/v1/characters', { method: 'POST', body: { character: rich } }), 400);
  delete rich.publication;
  await createCharacter(client, rich);
  let persisted = await snapshot(new Client(client.cookie));
  const found = persisted.state.custom.find(item => item.id === rich.id);
  const fields = ['introduction', 'creatorNotes', 'suggestedReplies', 'gallery', 'systemPrompt', 'postHistoryInstructions', 'messageExamples', 'alternateGreetings', 'openingMessages', 'characterBook'];
  for (const field of fields) assert.deepEqual(found[field], rich[field]);
  assert.equal(Object.hasOwn(found, 'publication'), false);
  const { result, conversation } = await createConversation(client, rich.id);
  const seed = result.state.conversations.find(item => item.id === conversation.id).messages;
  assert.deepEqual(seed.map(({ role, content }) => ({ role, content })), rich.openingMessages);
  assert.ok(seed.every(message => message.id));
  const invalid = await client.request(`/v1/characters/${rich.id}`, { method: 'PATCH', body: { character: {
    systemPrompt: '这段改动必须回滚', characterBook: { entries: [{ keys: ['bad'], content: 'bad', enabled: 'yes' }] },
  } } });
  expectStatus(invalid, 400);
  const unchanged = await snapshot(client);
  assert.equal(unchanged.state.custom.find(item => item.id === rich.id).systemPrompt, rich.systemPrompt);
  assert.equal(unchanged.state.custom.find(item => item.id === rich.id).creatorNotes, rich.creatorNotes);
  assert.equal(unchanged.version, result.version);
  const edited = expectStatus(await client.request(`/v1/characters/${rich.id}`, { method: 'PATCH', body: { character: {
    systemPrompt: '新的系统设定。', creatorNotes: '', gallery: [], suggestedReplies: [], openingMessages: [], alternateGreetings: [], characterBook: { entries: [] },
  } } }), 200);
  persisted = await snapshot(new Client(client.cookie));
  assert.deepEqual(persisted.state, edited.state);
  assert.equal(persisted.state.custom[0].systemPrompt, '新的系统设定。');
  assert.equal(persisted.state.custom[0].creatorNotes, '');
  assert.deepEqual(persisted.state.custom[0].gallery, []);
  assert.deepEqual(persisted.state.custom[0].characterBook, { entries: [] });
  expectStatus(await (await guest()).request(`/v1/characters/${rich.id}`, { method: 'PATCH', body: { character: { systemPrompt: 'other account' } } }), 404);
});

test('old D1 cards without optional context fields retain their original shape and explicit chat history is preserved', async () => {
  const client = await guest();
  const { character } = await createCharacter(client);
  const persisted = await snapshot(new Client(client.cookie));
  const found = persisted.state.custom.find(item => item.id === character.id);
  for (const field of ['systemPrompt', 'postHistoryInstructions', 'messageExamples', 'alternateGreetings', 'openingMessages', 'characterBook', 'gallery', 'introduction', 'creatorNotes', 'suggestedReplies'])
    assert.equal(Object.hasOwn(found, field), false);
  const messages = [{ id: 'chosen-alternate', role: 'assistant', content: '用户选定的开场。' }];
  const result = expectStatus(await client.request('/v1/conversations', { method: 'POST', body: { conversation: {
    id: `chat-${randomUUID()}`, characterId: character.id, messages,
  } } }), 200);
  assert.deepEqual(result.state.conversations[0].messages, messages);
});
