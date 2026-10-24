import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { promoteTestUserToSuper } from './test-admin.mjs';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);

const baseUrl = process.env.DZMM_TEST_BASE_URL;
assert.ok(baseUrl, 'Use npm test for the isolated Worker.');
const origin = 'http://127.0.0.1:3010';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1kAAAAASUVORK5CYII=', 'base64');
class Client {
  constructor() { this.cookie = ''; this.user = null; }
  async request(path, { method = 'GET', body, raw, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method,
      headers: { Origin: origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const bytes = new Uint8Array(await response.arrayBuffer());
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { data = null; }
    if (data?.user) this.user = data.user;
    return { status: response.status, data, bytes, headers: response.headers };
  }
}
function expect(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
function card(overrides = {}) {
  return { id: `draft-${randomUUID()}`, name: '图书馆成年档案员', author: '客户端不能冒充作者', description: '帮助成年旅人整理海港档案。',
    personality: '耐心细致', scenario: '安全的海港图书馆', firstMessage: '今天想研究哪张地图？',
    cover: '/art/shiyu.webp', tags: ['原创', '一般向'], ...overrides };
}
const submittedPath = id => `/v1/publishing/submissions/${id}`;
const unpublishPath = id => `/v1/publishing/publications/${id}/unpublish`;
async function submit(character, publication, client = owner) {
  return expect(await client.request('/v1/publishing/submissions', { method: 'POST', body: { character,
    ...(publication ? { publicationId: publication.id, version: publication.version } : {}) } }), 201);
}
async function review(result, decision = 'approved', reason = '', client = admin) {
  return client.request(`${submittedPath(result.submission.id)}/review`, { method: 'PATCH', body: { version: result.publication.version, decision, reason } });
}
async function unpublish(publication, client = owner) {
  return client.request(unpublishPath(publication.id), { method: 'POST', body: { version: publication.version } });
}
async function upload(client = owner) {
  return expect(await client.request('/v1/media', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' } }), 201).url;
}
let owner, stranger, admin, guest;
before(async () => {
  async function register(nickname) {
    const client = new Client();
    expect(await client.request('/v1/auth/register', { method: 'POST', body: { email: `${randomUUID()}@publishing.example.test`, password: 'Publishing-password-2026!', nickname } }), 201);
    return client;
  }
  owner = await register('真实投稿作者');
  stranger = await register('其他账户');
  admin = await register('发布审核管理员');
  await promoteTestUserToSuper(admin.user.id);
  expect(await admin.request('/v1/session'), 200);
  guest = new Client();
  assert.ok([200, 201].includes((await guest.request('/v1/auth/guest', { method: 'POST', body: {} })).status));
});

test('publishing accepts a direct normalized snapshot without autosync and pending stays private', async () => {
  expect(await new Client().request('/v1/publishing/catalog'), 200);
  expect(await new Client().request('/v1/publishing/submissions', { method: 'POST', body: { character: card() } }), 401);
  expect(await guest.request('/v1/publishing/submissions', { method: 'POST', body: { character: card() } }), 403);
  const draft = card({ heat: '999万', likes: '500万', messages: [{ role: 'user', content: 'PRIVATE_CHAT_SENTINEL' }] });
  const result = await submit(draft);
  assert.equal(result.submission.status, 'pending');
  assert.equal(result.submission.character.author, owner.user.nickname);
  assert.equal(result.submission.character.heat, '0');
  assert.equal(result.submission.character.sourceKind, 'original');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CHAT_SENTINEL'));
  assert.ok(!expect(await owner.request('/v1/state'), 200).state.custom.some(c => c.id === draft.id));
  expect(await new Client().request(`/v1/publishing/catalog/${result.publication.id}`), 404);
  expect(await new Client().request(submittedPath(result.submission.id)), 401);
  expect(await stranger.request(submittedPath(result.submission.id)), 404);
  expect(await owner.request(submittedPath(result.submission.id)), 200);
  expect(await admin.request(submittedPath(result.submission.id)), 200);
});

test('publishing refuses forged source/public metadata, foreign images and oversize snapshots', async () => {
  for (const overrides of [{ id: 'qy-shiyu' }, { id: ' qy-shiyu ' }, { sourceKind: 'public-summary' }, { promptOrigin: 'public-verbatim' },
    { sourceUrl: 'https://www.lumivale.xyz/character/2999180' }, { publicIntroductionSha256: 'fake' },
    { publication: { id: 'fake', authorId: admin.user.id, revision: 1 } }, { cover: 'https://example.test/private.png' },
    { cover: '/api/dzmm/backend/v1/media/other-user/1234.png' }, { gallery: ['/api/dzmm/backend/v1/media/other-user/1234.png'] }]) {
    expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { character: card(overrides) } }), 400);
  }
  expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { character: card({ description: 'a'.repeat(300000) }) } }), 413);
  expect(await admin.request('/v1/publishing/submissions?status=not-a-status'), 400);
  expect(await new Client().request('/v1/publishing/catalog?limit=999'), 400);
  expect(await new Client().request('/v1/publishing/catalog', { method: 'POST', body: {} }), 405);
});

test('a character without a chosen cover can submit and publish using the site placeholder', async () => {
  const result = await submit(card({ cover: '' }));
  assert.equal(result.submission.character.cover, '/assets/qingyu/brand/qingyu-character-placeholder.svg');
  expect(await review(result), 200);
  const published = expect(await new Client().request(`/v1/publishing/catalog/${result.publication.id}`), 200);
  assert.equal(published.character.cover, '/assets/qingyu/brand/qingyu-character-placeholder.svg');
});

test('only Super can review and a rejected revision needs a reason before resubmission', async () => {
  const submitted = await submit(card());
  expect(await owner.request('/v1/publishing/submissions'), 403);
  expect(await guest.request('/v1/publishing/submissions'), 403);
  expect(await review(submitted, 'approved', '', owner), 403);
  expect(await review(submitted, 'rejected', ''), 400);
  const rejected = expect(await review(submitted, 'rejected', '请补充开场设定。'), 200);
  assert.equal(rejected.submission.status, 'rejected');
  assert.equal(rejected.submission.reason, '请补充开场设定。');
  expect(await new Client().request(`/v1/publishing/catalog/${submitted.publication.id}`), 404);
  const next = await submit(card({ id: submitted.publication.privateCharacterId, name: '补全后的档案员' }), rejected.publication);
  assert.equal(next.publication.currentRevision, 2);
  assert.equal(next.submission.status, 'pending');
  expect(await review(submitted), 409);
  const approved = expect(await review(next), 200);
  assert.equal(approved.publication.isListed, true);
  expect(await unpublish(approved.publication), 200);
});

test('approved public cards expose only submitted character data with server author identity', async () => {
  const draft = card({ systemPrompt: '维持成年档案员设定。', postHistoryInstructions: '记住旅人的地图选择。',
    messageExamples: '旅人：你好\n档案员：欢迎', alternateGreetings: ['欢迎查阅海港档案。'],
    openingMessages: [{ role: 'assistant', content: '欢迎。' }, { role: 'user', content: '我想找地图。' }],
    characterBook: { name: '海港知识', scanDepth: 5, entries: [{ keys: ['海港'], content: '这是一座安全的成年旅人港城。', enabled: true }] },
    introduction: '公开介绍与系统设定分开。', creatorNotes: '  【感谢测试绘图】\nPS：这是面向读者的玩法说明。  ', suggestedReplies: ['看看地图'] });
  const submitted = await submit(draft);
  const approved = expect(await review(submitted), 200);
  const published = expect(await new Client().request(`/v1/publishing/catalog/${approved.publication.id}`), 200).character;
  assert.equal(published.id, approved.publication.id);
  assert.notEqual(published.id, draft.id);
  assert.equal(published.author, owner.user.nickname);
  assert.equal(published.publication.authorId, owner.user.id);
  assert.equal(published.systemPrompt, draft.systemPrompt);
  assert.deepEqual(published.characterBook, draft.characterBook);
  assert.deepEqual(published.openingMessages, draft.openingMessages);
  assert.deepEqual(published.suggestedReplies, draft.suggestedReplies);
  assert.equal(published.introduction, draft.introduction);
  assert.equal(published.creatorNotes, draft.creatorNotes);
  const serialized = JSON.stringify(published);
  for (const privateValue of [owner.user.email, draft.id, 'password_hash', 'token_hash', 'snapshot_json']) assert.ok(!serialized.includes(privateValue));
  expect(await unpublish(approved.publication), 200);
});

test('a pending update keeps approved version visible, then explicit approval replaces it', async () => {
  const draft = card({ name: '已审核版本一' });
  const first = expect(await review(await submit(draft)), 200);
  const update = await submit({ ...draft, name: '尚待审核版本二' }, first.publication);
  let publicCard = expect(await new Client().request(`/v1/publishing/catalog/${first.publication.id}`), 200).character;
  assert.equal(publicCard.name, '已审核版本一'); assert.equal(publicCard.publication.revision, 1);
  expect(await review(first), 409);
  const second = expect(await review(update), 200);
  publicCard = expect(await new Client().request(`/v1/publishing/catalog/${first.publication.id}`), 200).character;
  assert.equal(publicCard.name, '尚待审核版本二'); assert.equal(publicCard.publication.revision, 2);
  const list = expect(await new Client().request('/v1/publishing/catalog?limit=50'), 200);
  assert.equal(list.characters.filter(c => c.id === first.publication.id).length, 1);
  expect(await unpublish(second.publication), 200);
});

test('withdraw and owner/Super takedown enforce versions and invalidate pending approvals', async () => {
  const first = expect(await review(await submit(card())), 200);
  const pending = await submit(card({ id: first.publication.privateCharacterId, name: '待更新' }), first.publication);
  expect(await stranger.request(`${submittedPath(pending.submission.id)}/withdraw`, { method: 'POST', body: { version: pending.publication.version } }), 404);
  const withdrawn = expect(await owner.request(`${submittedPath(pending.submission.id)}/withdraw`, { method: 'POST', body: { version: pending.publication.version } }), 200);
  assert.equal(withdrawn.submission.status, 'withdrawn'); assert.equal(withdrawn.publication.isListed, true);
  expect(await review(pending), 409);
  const again = await submit(card({ id: first.publication.privateCharacterId, name: '再次待更新' }), withdrawn.publication);
  expect(await unpublish(again.publication, stranger), 404);
  expect(await unpublish(first.publication), 409);
  const removed = expect(await unpublish(again.publication, admin), 200).publication;
  assert.equal(removed.isListed, false); assert.equal(removed.latestSubmission.status, 'withdrawn');
  expect(await new Client().request(`/v1/publishing/catalog/${first.publication.id}`), 404);
  expect(await review(again), 409);
  const relisted = expect(await review(await submit(card({ id: first.publication.privateCharacterId, name: '作者再次提交后通过' }), removed)), 200);
  assert.equal(relisted.publication.isListed, true);
  expect(await unpublish(relisted.publication), 200);
});

test('uploaded cover and gallery become independent approved copies, with no private R2 access', async () => {
  const cover = await upload(); const gallery = await upload();
  const submitted = await submit(card({ cover, gallery: [gallery] }));
  const preview = submitted.submission.previewCoverUrl.replace('/api/dzmm/backend', '');
  expect(await new Client().request(preview), 401);
  expect(await stranger.request(preview), 404);
  const reviewedImage = await admin.request(preview); expect(reviewedImage, 200);
  assert.deepEqual(Buffer.from(reviewedImage.bytes), png);
  const approved = expect(await review(submitted), 200);
  const published = expect(await new Client().request(`/v1/publishing/catalog/${approved.publication.id}`), 200).character;
  assert.ok(published.cover.startsWith('/api/dzmm/backend/v1/publishing/media/'));
  assert.ok(published.gallery[0].startsWith('/api/dzmm/backend/v1/publishing/media/'));
  assert.ok(!JSON.stringify(published).includes(`/v1/media/${owner.user.id}/`));
  for (const privateUrl of [cover, gallery]) {
    expect(await stranger.request(privateUrl.replace('/api/dzmm/backend', '')), 404);
    expect(await owner.request(privateUrl.replace('/api/dzmm/backend', ''), { method: 'DELETE' }), 200);
  }
  for (const authorized of [owner, admin]) {
    const approvedPreview = await authorized.request(preview);
    expect(approvedPreview, 200);
    assert.deepEqual(Buffer.from(approvedPreview.bytes), png);
  }
  expect(await stranger.request(preview), 404);
  for (const url of [published.cover, ...published.gallery]) {
    const image = await new Client().request(url.replace('/api/dzmm/backend', '')); expect(image, 200);
    assert.deepEqual(Buffer.from(image.bytes), png);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(image.headers.get('cache-control'), 'no-store');
  }
  expect(await unpublish(approved.publication), 200);
  for (const url of [published.cover, ...published.gallery]) expect(await new Client().request(url.replace('/api/dzmm/backend', '')), 404);
});

test('approval refuses missing original media and obsolete revision images stop being public', async () => {
  const deleted = await upload();
  const submitted = await submit(card({ cover: deleted }));
  expect(await owner.request(deleted.replace('/api/dzmm/backend', ''), { method: 'DELETE' }), 200);
  expect(await review(submitted), 409);
  assert.equal(expect(await owner.request(submittedPath(submitted.submission.id)), 200).submission.status, 'pending');
  const media = await upload();
  const first = expect(await review(await submit(card({ cover: media }))), 200);
  const old = expect(await new Client().request(`/v1/publishing/catalog/${first.publication.id}`), 200).character.cover;
  const next = expect(await review(await submit(card({ id: first.publication.privateCharacterId }), first.publication)), 200);
  expect(await new Client().request(old.replace('/api/dzmm/backend', '')), 404);
  expect(await unpublish(next.publication), 200);
});

test('concurrent submit/review has one winner and cannot publish a stale snapshot', async () => {
  const media = await upload();
  const submitted = await submit(card({ cover: media }));
  const updates = await Promise.all(['并发一', '并发二'].map(name => owner.request('/v1/publishing/submissions', { method: 'POST',
    body: { character: card({ id: submitted.publication.privateCharacterId, name, cover: media }), publicationId: submitted.publication.id, version: submitted.publication.version } })));
  assert.deepEqual(updates.map(r => r.status).sort(), [201, 409]);
  const winner = updates.find(r => r.status === 201).data;
  assert.equal(winner.publication.currentRevision, 2);
  expect(await review(submitted), 409);
  const decisions = await Promise.all([review(winner), review(winner)]);
  assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
  const mine = expect(await owner.request('/v1/publishing/mine?limit=50'), 200).publications.find(p => p.id === winner.publication.id);
  assert.equal(mine.version, winner.publication.version + 1);
  const published = expect(await new Client().request(`/v1/publishing/catalog/${mine.id}`), 200).character;
  assert.equal(mine.latestSubmission.status, 'approved');
  const image = await new Client().request(published.cover.replace('/api/dzmm/backend', ''));
  expect(image, 200); assert.deepEqual(Buffer.from(image.bytes), png);
  expect(await unpublish(mine), 200);
});

test('approved characters support persisted favorites and seeded chats while rejecting private ID shadows', async () => {
  const openingMessages = [{ role: 'user', content: '我来到海港。' }, { role: 'assistant', content: '欢迎查阅港城地图。' }];
  const approved = expect(await review(await submit(card({ openingMessages }))), 200);
  const id = approved.publication.id;
  const catalog = expect(await stranger.request('/v1/characters'), 200).characters;
  assert.equal(catalog.filter(character => character.id === id).length, 1);
  expect(await stranger.request(`/v1/favorites/${id}`, { method: 'PUT' }), 200);
  const conversationId = `chat-${randomUUID()}`;
  const created = expect(await stranger.request('/v1/conversations', { method: 'POST', body: { conversation: { id: conversationId, characterId: id } } }), 200);
  const seed = created.state.conversations.find(conversation => conversation.id === conversationId).messages;
  assert.deepEqual(seed.map(({ role, content }) => ({ role, content })), openingMessages);
  const reloadedClient = new Client(); reloadedClient.cookie = stranger.cookie;
  const reloaded = expect(await reloadedClient.request('/v1/state'), 200);
  assert.ok(reloaded.state.favorites.includes(id));
  assert.deepEqual(reloaded.state.conversations.find(conversation => conversation.id === conversationId).messages, seed);
  assert.ok(!reloaded.state.custom.some(character => character.id === id));
  expect(await stranger.request('/v1/characters', { method: 'POST', body: { character: card({ id }) } }), 400);
  const forgedState = structuredClone(reloaded.state);
  forgedState.custom.unshift(card({ id }));
  expect(await stranger.request('/v1/state', { method: 'PUT', body: { accountId: stranger.user.id, version: reloaded.version, state: forgedState } }), 400);
  assert.deepEqual(expect(await stranger.request('/v1/state'), 200).state, reloaded.state);
  expect(await unpublish(approved.publication), 200);
  // Existing private history remains available after a public character is taken down.
  const after = expect(await reloadedClient.request('/v1/state'), 200);
  assert.deepEqual(after.state.conversations.find(conversation => conversation.id === conversationId).messages, seed);
  expect(await reloadedClient.request('/v1/conversations', { method: 'POST', body: { conversation: { characterId: id } } }), 404);
});

test('public character likes persist across reloads, are idempotent, and support imported public cards', async () => {
  const approved = expect(await review(await submit(card({ name: '可持久点赞的公开角色' }))), 200);
  const id = approved.publication.id;
  const statsPath = `/v1/publishing/likes?ids=${encodeURIComponent(id)}`;
  let stats = expect(await stranger.request(statsPath), 200).likes[id];
  assert.deepEqual(stats, { count: 0, liked: false });
  stats = expect(await stranger.request(`/v1/publishing/likes/${encodeURIComponent(id)}`, { method: 'PUT' }), 200);
  assert.deepEqual(stats, { count: 1, liked: true });
  stats = expect(await stranger.request(`/v1/publishing/likes/${encodeURIComponent(id)}`, { method: 'PUT' }), 200);
  assert.deepEqual(stats, { count: 1, liked: true });
  const reloaded = new Client(); reloaded.cookie = stranger.cookie;
  assert.deepEqual(expect(await reloaded.request(statsPath), 200).likes[id], { count: 1, liked: true });
  assert.deepEqual(expect(await owner.request(statsPath), 200).likes[id], { count: 1, liked: false });
  stats = expect(await stranger.request(`/v1/publishing/likes/${encodeURIComponent(id)}`, { method: 'DELETE' }), 200);
  assert.deepEqual(stats, { count: 0, liked: false });
  stats = expect(await stranger.request(`/v1/publishing/likes/${encodeURIComponent(id)}`, { method: 'DELETE' }), 200);
  assert.deepEqual(stats, { count: 0, liked: false });

  const staticId = expect(await stranger.request('/v1/characters'), 200).characters.find(character => character.id === 'qy-shiyu').id;
  assert.deepEqual(expect(await stranger.request(`/v1/publishing/likes/${encodeURIComponent(staticId)}`, { method: 'PUT' }), 200), { count: 1, liked: true });
  assert.deepEqual(expect(await stranger.request(`/v1/publishing/likes/${encodeURIComponent(staticId)}`, { method: 'DELETE' }), 200), { count: 0, liked: false });
  expect(await stranger.request('/v1/publishing/likes/unknown-private-id', { method: 'PUT' }), 404);
  expect(await unpublish(approved.publication), 200);
});

test('publishing account bindings prevent a stale tab from submitting, reviewing, withdrawing or unpublishing', async () => {
  const before = expect(await owner.request('/v1/publishing/mine?limit=50'), 200);
  expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { accountId: stranger.user.id, character: card() } }), 401);
  assert.deepEqual(expect(await owner.request('/v1/publishing/mine?limit=50'), 200), before);
  const submitted = expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { accountId: owner.user.id, character: card() } }), 201);
  const pendingBefore = expect(await owner.request(submittedPath(submitted.submission.id)), 200);
  expect(await admin.request(`${submittedPath(submitted.submission.id)}/review`, { method: 'PATCH', body: {
    accountId: owner.user.id, version: submitted.publication.version, decision: 'approved',
  } }), 401);
  expect(await owner.request(`${submittedPath(submitted.submission.id)}/withdraw`, { method: 'POST', body: {
    accountId: stranger.user.id, version: submitted.publication.version,
  } }), 401);
  assert.deepEqual(expect(await owner.request(submittedPath(submitted.submission.id)), 200), pendingBefore);
  const approved = expect(await admin.request(`${submittedPath(submitted.submission.id)}/review`, { method: 'PATCH', body: {
    accountId: admin.user.id, version: submitted.publication.version, decision: 'approved',
  } }), 200);
  const catalogBefore = expect(await new Client().request(`/v1/publishing/catalog/${approved.publication.id}`), 200);
  expect(await owner.request(unpublishPath(approved.publication.id), { method: 'POST', body: {
    accountId: stranger.user.id, version: approved.publication.version,
  } }), 401);
  assert.deepEqual(expect(await new Client().request(`/v1/publishing/catalog/${approved.publication.id}`), 200), catalogBefore);
  expect(await owner.request(unpublishPath(approved.publication.id), { method: 'POST', body: {
    accountId: owner.user.id, version: approved.publication.version,
  } }), 200);
});

test('publication requires an assistant opening and actual model setting, while private incomplete drafts remain valid', async () => {
  const cases = [
    { firstMessage: '', openingMessages: [] },
    { firstMessage: '', openingMessages: [{ role: 'user', content: '只有用户的初始消息' }], alternateGreetings: ['仅备选开场'] },
    { description: '', personality: '', scenario: '', systemPrompt: '', introduction: '只有展示介绍', suggestedReplies: ['去海港'] },
  ];
  const before = expect(await owner.request('/v1/publishing/mine?limit=50'), 200);
  for (const overrides of cases) expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: {
    accountId: owner.user.id, character: card(overrides),
  } }), 400);
  assert.deepEqual(expect(await owner.request('/v1/publishing/mine?limit=50'), 200), before);
  const incomplete = card({ firstMessage: '', description: '', personality: '', scenario: '', introduction: '尚在草拟' });
  const saved = expect(await owner.request('/v1/characters', { method: 'POST', body: { character: incomplete, accountId: owner.user.id } }), 200);
  assert.ok(saved.state.custom.some(character => character.id === incomplete.id));
  const valid = await submit(card({ firstMessage: '', description: '', personality: '', scenario: '', systemPrompt: '成年档案员帮助旅人整理港城地图。',
    openingMessages: [{ role: 'assistant', content: '欢迎，我们从哪张地图开始？' }] }));
  expect(await owner.request(`${submittedPath(valid.submission.id)}/withdraw`, { method: 'POST', body: {
    accountId: owner.user.id, version: valid.publication.version,
  } }), 200);
});

// Fault injection uses the actual authenticated API and a separate disposable D1/R2.
// It never changes the running test Worker's database or any production binding.
async function approvalFaultFixture(t) {
  const store=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',modules:true,
    script:'export default {fetch(){return new Response("isolated approval faults")}}',
    d1Databases:{DB:'publishing-faults'},r2Buckets:{MEDIA:'publishing-faults'}}));
  t.after(()=>store.dispose());
  const DB=await store.getD1Database('DB'),MEDIA=await store.getR2Bucket('MEDIA');
  for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort()){
    const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');
    await DB.batch(splitSqlStatements(sql).filter(part=>part.trim()).map(part=>DB.prepare(part)));
  }
  const cookies={},users={},site='https://approval-fault.example.test',env={DB,MEDIA,APP_ORIGINS:site};
  for(const [name,role] of [['owner','user'],['admin','super']]){
    const id=randomUUID(),token=randomBytes(32).toString('hex'),now=Date.now();
    users[name]={id};cookies[name]=`qingyu_session=${token}`;
    await DB.batch([
      DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,?,?)').bind(id,'隔离审核账户',role,now),
      DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
        .bind(createHash('sha256').update(token).digest('hex'),id,now+3600000,now),
    ]);
  }
  async function request(path,{method='GET',body,as='admin',env:binding=env}={}){
    const response=await fetchRequest(new Request(`${site}/v1/publishing${path}`,{method,
      headers:{Origin:site,'CF-Connecting-IP':users[as]?.id??'public',...(cookies[as]?{Cookie:cookies[as]}:{}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})}),binding);
    const bytes=new Uint8Array(await response.arrayBuffer());
    return {status:response.status,data:response.headers.get('Content-Type')?.includes('json')?JSON.parse(new TextDecoder().decode(bytes)):bytes};
  }
  const paths=[];
  for(const slot of ['cover','gallery']){
    const key=`${users.owner.id}/${randomUUID()}.png`;
    await MEDIA.put(key,png,{httpMetadata:{contentType:'image/png'},customMetadata:{ownerId:users.owner.id}});
    paths.push(`/api/dzmm/backend/v1/media/${key}`);
  }
  const character=card({cover:paths[0],gallery:[paths[1]]});
  const submitted=expect(await request('/submissions',{method:'POST',as:'owner',body:{character}}),201);
  return {DB,MEDIA,env,request,character,submitted,
    review(result=submitted,binding=env){return request(`/submissions/${result.submission.id}/review`,{
      method:'PATCH',body:{version:result.publication.version,decision:'approved'},env:binding});}};
}
function observedApprovalBucket(f){
  const keys=[],deleted=[];
  return {keys,deleted,binding:{head:f.MEDIA.head.bind(f.MEDIA),get:f.MEDIA.get.bind(f.MEDIA),
    async put(key,...args){await f.MEDIA.put(key,...args);keys.push(key);},
    async delete(key){deleted.push(key);await f.MEDIA.delete(key);}}};
}
async function approvalFaultRow(f,submission=f.submitted.submission){
  return f.DB.prepare('SELECT s.status,s.published_media_json,p.is_listed,p.version FROM character_submissions s JOIN character_publications p ON p.id=s.publication_id WHERE s.id=?')
    .bind(submission.id).first();
}
async function assertApprovalImages(f,result=f.submitted){
  const published=expect(await f.request(`/catalog/${result.publication.id}`,{as:'public'}),200).character;
  for(const path of [published.cover,...published.gallery]){
    assert.deepEqual(Buffer.from(expect(await f.request(path.replace('/api/dzmm/backend/v1/publishing',''),{as:'public'}),200)),png);
  }
  return published;
}

test('approval atomic failure before commit cleans unreferenced cover and gallery and remains retryable',async t=>{
  const f=await approvalFaultFixture(t),objects=observedApprovalBucket(f);
  const DB={prepare:f.DB.prepare.bind(f.DB),async batch(){throw Error('mock-before-commit');}};
  expect(await f.review(undefined,{...f.env,DB,MEDIA:objects.binding}),500);
  assert.equal(objects.keys.length,2);assert.deepEqual(objects.deleted.sort(),objects.keys.slice().sort());
  for(const key of objects.keys)assert.equal(await f.MEDIA.head(key),null);
  const row=await approvalFaultRow(f);assert.equal(row.status,'pending');assert.equal(row.is_listed,0);
  expect(await f.request(`/catalog/${f.submitted.publication.id}`,{as:'public'}),404);
  const approved=expect(await f.review(),200);await assertApprovalImages(f,approved);
});

test('approval batch response loss preserves committed public cover and gallery on reload',async t=>{
  const f=await approvalFaultFixture(t),objects=observedApprovalBucket(f);
  const DB={prepare:f.DB.prepare.bind(f.DB),async batch(statements){await f.DB.batch(statements);throw Error('mock-lost-approved-response');}};
  expect(await f.review(undefined,{...f.env,DB,MEDIA:objects.binding}),500);
  assert.equal(objects.keys.length,2);assert.deepEqual(objects.deleted,[]);
  const row=await approvalFaultRow(f);assert.equal(row.status,'approved');assert.equal(row.is_listed,1);
  for(const key of Object.values(JSON.parse(row.published_media_json)))assert.ok(await f.MEDIA.head(key));
  await assertApprovalImages(f);
  const mine=expect(await f.request('/mine',{as:'owner'}),200).publications[0];
  assert.equal(mine.latestSubmission.status,'approved');assert.equal(mine.version,row.version);
  expect(await f.review({publication:mine,submission:mine.latestSubmission}),409);
});

test('approval recovery query failures retain uncertain copies after committed or uncommitted batches',async t=>{
  for(const committed of [false,true]){
    const f=await approvalFaultFixture(t),objects=observedApprovalBucket(f);let failed=false,checks=0;
    const DB={prepare(sql){
      if(failed&&sql.includes('json_each(s.published_media_json)'))return {bind(){return {async first(){checks++;throw Error('mock-recovery-offline');}};}};
      return f.DB.prepare(sql);
    },async batch(statements){if(committed)await f.DB.batch(statements);failed=true;throw Error('mock-batch-response-offline');}};
    expect(await f.review(undefined,{...f.env,DB,MEDIA:objects.binding}),500);
    assert.equal(checks,2);assert.equal(objects.keys.length,2);assert.deepEqual(objects.deleted,[]);
    for(const key of objects.keys)assert.ok(await f.MEDIA.head(key));
    const row=await approvalFaultRow(f);assert.equal(row.status,committed?'approved':'pending');
    if(committed)await assertApprovalImages(f);
    else expect(await f.request(`/catalog/${f.submitted.publication.id}`,{as:'public'}),404);
  }
});

test('obsolete approval cleanup removes its own copies and preserves a same-revision or newer-revision winner',async t=>{
  for(const newerRevision of [false,true]){
    const f=await approvalFaultFixture(t),objects=observedApprovalBucket(f);let started,release;
    const began=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
    const DB={prepare:f.DB.prepare.bind(f.DB),async batch(statements){started();await hold;return f.DB.batch(statements);}};
    const old=f.review(undefined,{...f.env,DB,MEDIA:objects.binding});await began;
    const candidate=newerRevision?expect(await f.request('/submissions',{method:'POST',as:'owner',body:{
      character:{...f.character,name:'新版成年档案员'},publicationId:f.submitted.publication.id,version:f.submitted.publication.version,
    }}),201):f.submitted;
    const winner=expect(await f.review(candidate),200);release();expect(await old,409);
    assert.equal(objects.keys.length,2);assert.deepEqual(objects.deleted.sort(),objects.keys.slice().sort());
    for(const key of objects.keys)assert.equal(await f.MEDIA.head(key),null);
    const row=await approvalFaultRow(f,winner.submission);
    for(const key of Object.values(JSON.parse(row.published_media_json)))assert.ok(await f.MEDIA.head(key));
    const published=await assertApprovalImages(f,winner);assert.equal(published.publication.revision,newerRevision?2:1);
  }
});

test('lost approval response after a newer publication preserves both new media and approved historical previews',async t=>{
  const f=await approvalFaultFixture(t),objects=observedApprovalBucket(f);let started,release;
  const began=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
  const DB={prepare:f.DB.prepare.bind(f.DB),async batch(statements){await f.DB.batch(statements);started();await hold;throw Error('mock-old-response-lost');}};
  const old=f.review(undefined,{...f.env,DB,MEDIA:objects.binding});await began;
  const mine=expect(await f.request('/mine',{as:'owner'}),200).publications[0];
  const updated=expect(await f.request('/submissions',{method:'POST',as:'owner',body:{
    character:{...f.character,name:'审核通过后的新版'},publicationId:mine.id,version:mine.version,
  }}),201);
  const winner=expect(await f.review(updated),200);release();expect(await old,500);
  assert.equal(objects.keys.length,2);assert.deepEqual(objects.deleted,[]);
  const published=await assertApprovalImages(f,winner);assert.equal(published.publication.revision,2);
  for(const slot of ['cover','gallery-0'])assert.deepEqual(Buffer.from(expect(await f.request(
    `/submissions/${f.submitted.submission.id}/media/${slot}`,{as:'owner'}),200)),png);
  expect(await f.request(`/media/${mine.id}/1/cover`,{as:'public'}),404);
});
