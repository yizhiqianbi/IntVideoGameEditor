import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Actual authenticated API and transactional D1, with disposable local storage.
// No provider generation, payment request, production account or remote D1.
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { prepareDzmmRequest } = await tsImport('../../../src/lib/dzmm-context.ts', import.meta.url);
const { buildDzmmPromptPlan, validateDzmmChatInput } = await tsImport('../../../src/lib/dzmm-chat.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
const origin = 'https://private-draft.example.test';
const SENTINEL = 'PRIVATE_UNFINISHED_WORLD_BOOK_SENTINEL';
let store, DB;

before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated private draft store")}}', d1Databases: { DB: 'private-draft-tests' } }));
  DB = await store.getD1Database('DB');
  for (const file of migrations) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => DB.prepare(sql)));
  }
});
after(async () => { await store?.dispose(); });

class Client {
  constructor({ cookie = '', accountId } = {}) { this.cookie = cookie; this.accountId = accountId; this.ip = randomUUID(); }
  async request(path, { method = 'GET', body } = {}) {
    const response = await fetchRequest(new Request(`${origin}${path}`, { method, headers: {
      Origin: origin, 'CF-Connecting-IP': this.ip, Cookie: this.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === undefined ? undefined : JSON.stringify(body) }), { DB, APP_ORIGINS: origin });
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}
function expect(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const snapshot = async client => expect(await client.request('/v1/state'));
const find = (envelope, id) => envelope.state.custom.find(character => character.id === id);
const save = (client, state, version) => client.request('/v1/state', { method: 'PUT', body: { state, version, accountId: client.accountId } });
const patch = (client, id, character) => client.request(`/v1/characters/${id}`, { method: 'PATCH', body: { character } });

function authoringDraft() {
  return { version: 1, characterBook: { name: '海港世界书', description: '编辑中的原创港城', scanDepth: 10, entries: [
    { id: 'library', name: '图书馆', content: '图书馆收藏虚构港城的旧地图。', keysText: '  图书馆，档案室  ', secondaryText: '', enabled: true, constant: false },
    { id: 'unfinished', name: '旧站钟', content: `${SENTINEL} 尚未填写触发词。`, keysText: '', secondaryText: '', enabled: true, constant: false },
  ] } };
}
function card(extra = {}) {
  return { id: `local-${randomUUID()}`, name: '成年海港档案员', description: '成年档案员帮助旅人研究虚构港城。',
    personality: '耐心细致', scenario: '海港图书馆', firstMessage: '想先查哪一张地图？', ...extra };
}
async function client({ superUser = false } = {}) {
  const accountId = randomUUID(), token = randomBytes(32).toString('hex'), now = Date.now();
  await DB.batch([
    DB.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,0,?,?)')
      .bind(accountId, `${accountId}@private-draft.example.test`, '私稿测试作者', superUser ? 'super' : 'user', now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(token).digest('hex'), accountId, now + 3600000, now),
  ]);
  return new Client({ cookie: `qingyu_session=${token}`, accountId });
}
async function fixture() {
  const owner = await client(), character = card({ authoringDraft: authoringDraft() });
  const saved = expect(await owner.request('/v1/characters', { method: 'POST', body: { character } }));
  return { owner, character: find(saved, character.id), saved };
}

test('unfinished authoring data survives D1 reload while only complete lore enters runnable prompts', async () => {
  const { owner, character } = await fixture();
  assert.deepEqual(character.authoringDraft, authoringDraft());
  assert.equal(character.characterBook.entries.length, 1);
  assert.deepEqual(character.characterBook.entries[0].keys, ['图书馆', '档案室']);
  const reloaded = find(await snapshot(new Client(owner)), character.id);
  assert.deepEqual(reloaded, character);
  const row = await DB.prepare('SELECT context_json FROM characters WHERE user_id=? AND id=?').bind(owner.accountId, character.id).first();
  const context = JSON.parse(row.context_json);
  assert.deepEqual(context.authoringDraft, authoringDraft());
  assert.deepEqual(context.characterBook, character.characterBook);
  const prepared = prepareDzmmRequest(reloaded, [{ role: 'assistant', content: reloaded.firstMessage }, { role: 'user', content: '我们去图书馆查地图。' }]);
  const prompt = buildDzmmPromptPlan(validateDzmmChatInput(prepared));
  assert.ok(JSON.stringify(prompt.messages).includes('图书馆收藏虚构港城的旧地图。'));
  assert.ok(!JSON.stringify(prepared).includes(SENTINEL));
  assert.ok(!JSON.stringify(prompt).includes(SENTINEL));
});

test('PATCH and old-client state sync retain private draft text but reject changes to its runnable book', async () => {
  const { owner, character } = await fixture();
  const changed = find(expect(await patch(owner, character.id, { name: '新名称', description: '成年档案员的新介绍。' })), character.id);
  assert.deepEqual(changed.authoringDraft, character.authoringDraft);
  assert.equal(changed.createdAt, character.createdAt);
  let before = await snapshot(owner), state = structuredClone(before.state);
  delete state.custom[0].authoringDraft;
  state.custom[0].scenario = '港城阅览室';
  const retained = find(expect(await save(owner, state, before.version)), character.id);
  assert.deepEqual(retained.authoringDraft, character.authoringDraft);
  assert.equal(retained.scenario, '港城阅览室');

  before = await snapshot(owner);
  expect(await patch(owner, character.id, { characterBook: { entries: [] } }), 400);
  assert.deepEqual(await snapshot(owner), before);
  state = structuredClone(before.state);
  delete state.custom[0].authoringDraft;
  state.custom[0].characterBook = { entries: [] };
  expect(await save(owner, state, before.version), 400);
  assert.deepEqual(await snapshot(owner), before);
});

test('private draft changes persist through full state and explicit null clears without restoring old text', async () => {
  const { owner, character } = await fixture();
  let before = await snapshot(owner), state = structuredClone(before.state);
  state.custom[0].authoringDraft.characterBook.entries[1].keysText = '  '; // Preserve raw editor spacing.
  state.custom[0].authoringDraft.characterBook.entries[1].content = `${SENTINEL} 新的未完成内容。`;
  const updated = find(expect(await save(owner, state, before.version)), character.id);
  assert.equal(updated.authoringDraft.characterBook.entries[1].keysText, '  ');
  assert.ok(updated.authoringDraft.characterBook.entries[1].content.endsWith('新的未完成内容。'));
  assert.deepEqual(find(await snapshot(new Client(owner)), character.id), updated);

  before = await snapshot(owner); state = structuredClone(before.state);
  state.custom[0].authoringDraft = null;
  state.custom[0].characterBook = { entries: [] };
  const cleared = find(expect(await save(owner, state, before.version)), character.id);
  assert.equal(cleared.authoringDraft, null);
  assert.deepEqual(cleared.characterBook, { entries: [] });
  const again = find(expect(await patch(owner, character.id, { description: '清除后继续编辑。' })), character.id);
  assert.equal(again.authoringDraft, null);
  assert.ok(!JSON.stringify(await snapshot(owner)).includes(SENTINEL));
});

test('finishing the final lore entry compiles it and removes the unfinished payload; PATCH null also clears', async () => {
  const { owner, character } = await fixture();
  const draft = structuredClone(character.authoringDraft);
  draft.characterBook.entries[1].keysText = '旧站钟';
  const completed = find(expect(await patch(owner, character.id, { authoringDraft: draft })), character.id);
  assert.equal(completed.authoringDraft, null);
  assert.equal(completed.characterBook.entries.length, 2);
  assert.equal(completed.characterBook.entries[1].content, draft.characterBook.entries[1].content);
  assert.deepEqual(find(await snapshot(new Client(owner)), character.id), completed);

  const second = await fixture();
  const cleared = find(expect(await patch(second.owner, second.character.id, { authoringDraft: null, characterBook: { entries: [] } })), second.character.id);
  assert.equal(cleared.authoringDraft, null);
  assert.deepEqual(cleared.characterBook, { entries: [] });
});

test('invalid authoring payloads and invalid runnable cards reject atomically instead of bypassing format checks', async () => {
  const { owner, character } = await fixture();
  const before = await snapshot(owner);
  const invalid = [
    { version: 2, characterBook: { entries: [] } },
    { version: 1, characterBook: { entries: [{ content: '草拟内容', keysText: ['invalid'], secondaryText: '' }] } },
    { version: 1, characterBook: { entries: [{ content: 'a'.repeat(8001), keysText: '', secondaryText: '' }] } },
    { version: 1, characterBook: { entries: [{ content: '', keysText: '', secondaryText: '', enabled: 'yes' }] } },
    { version: 1, characterBook: { entries: Array.from({ length: 100 }, (_, index) => ({ id: `entry-${index}`, content: 'a'.repeat(3000), keysText: '', secondaryText: '' })) } },
  ];
  for (const authoringDraft of invalid) {
    expect(await patch(owner, character.id, { description: '必须回滚的修改', authoringDraft }), 400);
    assert.deepEqual(await snapshot(owner), before);
  }
  expect(await patch(owner, character.id, { authoringDraft: authoringDraft(), characterBook: { entries: [{ keys: ['图书馆'], content: '' }] } }), 400);
  assert.deepEqual(await snapshot(owner), before);
  const state = structuredClone(before.state);
  state.custom[0].authoringDraft = { version: 0 };
  expect(await save(owner, state, before.version), 400);
  assert.deepEqual(await snapshot(owner), before);
  expect(await owner.request('/v1/characters', { method: 'POST', body: { character: card({ authoringDraft: invalid[0] }) } }), 400);
  assert.deepEqual(await snapshot(owner), before);
});

test('private authoring metadata stays account-scoped and damaged optional stored data cannot hide the runnable card', async () => {
  const { owner, character } = await fixture(), stranger = await client();
  expect(await patch(stranger, character.id, { description: '另一个账号不能覆盖' }), 404);
  const foreign = expect(await stranger.request('/v1/characters'));
  assert.ok(!foreign.characters.some(item => item.id === character.id));
  assert.ok(!JSON.stringify(foreign).includes(SENTINEL));
  assert.ok(!JSON.stringify(await snapshot(stranger)).includes(SENTINEL));
  expect(await new Client().request('/v1/state'), 401);

  const row = await DB.prepare('SELECT context_json FROM characters WHERE user_id=? AND id=?').bind(owner.accountId, character.id).first();
  const context = JSON.parse(row.context_json);
  context.authoringDraft = { version: 99 };
  await DB.prepare('UPDATE characters SET context_json=? WHERE user_id=? AND id=?').bind(JSON.stringify(context), owner.accountId, character.id).run();
  const recovered = find(await snapshot(owner), character.id);
  assert.ok(recovered);
  assert.equal(Object.hasOwn(recovered, 'authoringDraft'), false);
  assert.deepEqual(recovered.characterBook, character.characterBook);
  assert.equal(recovered.firstMessage, character.firstMessage);
});

test('publishing rejects unfinished authoring data and public or reviewer snapshots strip legacy private payloads', async () => {
  const { owner, character } = await fixture(), admin = await client({ superUser: true });
  const before = expect(await owner.request('/v1/publishing/mine'));
  expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { character } }), 400);
  assert.deepEqual(expect(await owner.request('/v1/publishing/mine')), before);
  const runnable = { ...character, authoringDraft: null };
  const submitted = expect(await owner.request('/v1/publishing/submissions', { method: 'POST', body: { character: runnable } }), 201);
  assert.equal(Object.hasOwn(submitted.submission.character, 'authoringDraft'), false);
  expect(await admin.request(`/v1/publishing/submissions/${submitted.submission.id}/review`, { method: 'PATCH', body: {
    version: submitted.publication.version, decision: 'approved',
  } }));
  const row = await DB.prepare('SELECT snapshot_json FROM character_submissions WHERE id=?').bind(submitted.submission.id).first();
  const legacy = JSON.parse(row.snapshot_json);
  assert.equal(Object.hasOwn(legacy, 'authoringDraft'), false);
  legacy.authoringDraft = authoringDraft();
  await DB.prepare('UPDATE character_submissions SET snapshot_json=? WHERE id=?').bind(JSON.stringify(legacy), submitted.submission.id).run();
  for (const [reader, path] of [
    [new Client(), '/v1/publishing/catalog'],
    [new Client(), `/v1/publishing/catalog/${submitted.publication.id}`],
    [owner, '/v1/publishing/mine'],
    [admin, `/v1/publishing/submissions/${submitted.submission.id}`],
  ]) {
    const result = expect(await reader.request(path));
    assert.ok(!JSON.stringify(result).includes('authoringDraft'), path);
    assert.ok(!JSON.stringify(result).includes(SENTINEL), path);
  }
  assert.deepEqual(find(await snapshot(owner), character.id).authoringDraft, character.authoringDraft);
});
