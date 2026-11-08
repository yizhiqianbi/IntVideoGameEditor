import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { require as tsxRequire } from 'tsx/cjs/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { handleApi } = tsxRequire('../src/data.ts', import.meta.url);
const { parseCharacterImport } = tsxRequire('../../../src/lib/dzmm-characters.ts', import.meta.url);
const { DZMM_AI_CHARACTERS } = tsxRequire('../../../src/lib/dzmm-ai-characters.ts', import.meta.url);
const { DZMM_CATALOG_CHARACTERS, DZMM_EXPORTED_FULL_CHARACTERS, DZMM_USER_PROVIDED_FULL_CHARACTERS, DZMM_LISTED_CHARACTERS }
  = tsxRequire('../../../src/lib/dzmm-bundled-cards.ts', import.meta.url);
const { hydrateDzmmState } = tsxRequire('../../../src/lib/dzmm-storage.ts', import.meta.url);
const { captureDzmmConversationOpening } = tsxRequire('../../../src/lib/dzmm-conversation-context.ts', import.meta.url);
const { getDzmmOpeningMessages } = tsxRequire('../../../src/lib/dzmm-character-context.ts', import.meta.url);

const ORIGIN = 'https://catalog-retirement.example.test';
const NOW = Date.parse('2026-10-15T12:00:00Z');
const retired = DZMM_AI_CHARACTERS.filter(card => card.catalogReadiness === 'metadata-only');
const retiredIds = new Set(retired.map(card => card.id));
const publicContextIds = DZMM_AI_CHARACTERS.filter(card => card.catalogReadiness === 'public-context').map(card => card.id);
const exportedCardIds = DZMM_EXPORTED_FULL_CHARACTERS.map(card => card.id);
const suppliedCardIds = DZMM_USER_PROVIDED_FULL_CHARACTERS.map(card => card.id);
const owners = [];
let store, DB, MEDIA, storagePath, modelCalls = 0, outboundCalls = 0;

before(async () => {
  storagePath = await mkdtemp(join(tmpdir(), 'xumeng-catalog-retirement-'));
  const namespace = `catalog-retirement-${randomUUID()}`;
  store = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated catalog retirement")}}',
    d1Databases: { DB: namespace }, r2Buckets: { MEDIA: namespace },
    resourcePersistencePath: join(storagePath, 'persist'), resourceTmpPath: join(storagePath, 'tmp'),
    outboundService: async () => { outboundCalls++; throw new Error('External requests are forbidden in this test'); },
  }));
  DB = await store.getD1Database('DB');
  MEDIA = await store.getR2Bucket('MEDIA');
  const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  assert.ok(migrations.includes('0046_character_likes.sql'));
  for (const file of migrations) {
    const statements = splitSqlStatements(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    await DB.batch(statements.filter(sql => sql.trim()).map(sql => DB.prepare(sql)));
  }
});

after(async () => {
  try {
    if (DB) {
      for (const id of owners) await DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
      for (const table of ['users', 'characters', 'conversations', 'messages', 'favorites', 'character_publications', 'character_submissions']) {
        assert.equal((await DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0, `${table} fixture cleanup`);
      }
    }
    if (MEDIA) assert.equal((await MEDIA.list()).objects.length, 0);
    assert.equal(modelCalls, 0);
    assert.equal(outboundCalls, 0);
  } finally {
    try { await store?.dispose(); }
    finally { if (storagePath) await rm(storagePath, { recursive: true, force: true }); }
  }
});

async function fixture() {
  const user = { id: randomUUID(), email: null, nickname: '原创目录回归账户', isGuest: false, role: 'user', version: 0 };
  owners.push(user.id);
  await DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,?,?)')
    .bind(user.id, user.nickname, user.role, NOW).run();
  return { user, env: { DB, MEDIA, APP_ORIGINS: ORIGIN, GENERATION_ENABLED: 'false', CHAT_MEDIA_ENABLED: 'false',
    AI: { async run() { modelCalls++; throw new Error('Model requests are forbidden in this test'); } } } };
}

async function call(f, path, method = 'GET', body) {
  try {
    const response = await handleApi(new Request(ORIGIN + path, {
      method, headers: { Origin: ORIGIN, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), f.env, f.user);
    return { status: response.status, data: await response.json() };
  } catch (error) {
    if (!Number.isInteger(error.status)) throw error;
    return { status: error.status, data: { error: error.message } };
  }
}

function ok(result) {
  // Only status codes are printed on failure; public source prose is never logged.
  assert.equal(result.status, 200);
  return result.data;
}
const snapshot = async f => ok(await call(f, '/v1/state'));
const ids = cards => cards.map(card => card.id).sort();
function originalCard(id = `local-${randomUUID()}`) {
  return parseCharacterImport({ id, name: '原创地图管理员', author: '隔离测试作者', tags: ['原创'],
    description: '一位成年地图管理员整理海港航线。', personality: '耐心而细致。',
    scenario: '灯塔旁的地图室刚刚开门。', firstMessage: '桌上的地图已经摊开，请选择下一处港口。' }, id);
}

test('public directory exposes verified backgrounds, eighteen licensed exports and the separate supplied batch while the archive remains intact', async () => {
  assert.equal(DZMM_AI_CHARACTERS.length, 60);
  assert.equal(retired.length, 55);
  assert.equal(publicContextIds.length, 5);
  assert.equal(exportedCardIds.length, 18);
  assert.ok(publicContextIds.every(id => !DZMM_LISTED_CHARACTERS.some(card => card.id === id)));
  assert.deepEqual(ids(DZMM_LISTED_CHARACTERS), [...exportedCardIds, ...suppliedCardIds].sort());
  const archiveIds = new Set([...DZMM_CATALOG_CHARACTERS, ...DZMM_AI_CHARACTERS].map(card => card.id));
  for (const card of DZMM_AI_CHARACTERS) assert.ok(archiveIds.has(card.id));
  const f = await fixture();
  assert.deepEqual(ids(ok(await call(f, '/v1/characters')).characters), [...exportedCardIds, ...suppliedCardIds].sort());
  for (const card of retired) {
    const result = ok(await call(f, `/v1/characters?q=${encodeURIComponent(card.name)}`));
    assert.ok(result.characters.every(candidate => !retiredIds.has(candidate.id)), 'Search must not reintroduce an archived card');
  }
});

test('card view omits bundled prompt text while search and private cards stay complete', async () => {
  const f = await fixture();
  const full = ok(await call(f, '/v1/characters'));
  const cardView = ok(await call(f, '/v1/characters?view=card'));
  assert.deepEqual(ids(cardView.characters), ids(full.characters));
  assert.deepEqual(cardView.suppressedPrivateIds, full.suppressedPrivateIds);
  const listed = new Map(DZMM_LISTED_CHARACTERS.map(card => [card.id, card]));
  const exported = new Set([...exportedCardIds, ...suppliedCardIds]);
  const context = new Set(publicContextIds);
  let projectedCount = 0;
  let searchable = null;
  for (const summary of cardView.characters) {
    const source = listed.get(summary.id);
    if (!source) continue;
    if (exported.has(summary.id)) {
      projectedCount += 1;
      assert.equal(summary.listPreview, true);
      assert.equal(summary.firstMessage, '');
      assert.equal(summary.characterBook, undefined);
      assert.ok(summary.description.length <= 180);
      if (!searchable && source.description.length > 240) searchable = source;
    } else if (context.has(summary.id)) {
      assert.equal(summary.listPreview, undefined);
      assert.equal(summary.description.length, source.description.length);
      assert.equal(summary.firstMessage.length, source.firstMessage.length);
    }
  }
  assert.ok(projectedCount > 0);
  assert.ok(searchable);
  const needle = searchable.description.slice(200, 224);
  const found = ok(await call(f, `/v1/characters?view=card&q=${encodeURIComponent(needle)}`));
  const projected = found.characters.find(card => card.id === searchable.id);
  assert.ok(projected);
  assert.equal(projected.listPreview, true);
  assert.ok(projected.description.length < searchable.description.length);
  const mine = originalCard();
  ok(await call(f, '/v1/characters', 'POST', { character: mine }));
  const saved = ok(await call(f, '/v1/characters?view=card')).characters.find(card => card.id === mine.id);
  assert.ok(saved);
  assert.equal(saved.listPreview, undefined);
  assert.equal(saved.firstMessage, mine.firstMessage);
  assert.equal(saved.description, mine.description);
  assert.equal((await call(f, '/v1/characters?view=prompt')).status, 400);
});

test('all fifty-five retired conversations retain ordinary saved messages and opening snapshots through hydrate, save and reload', async () => {
  const f = await fixture();
  const opening = captureDzmmConversationOpening(originalCard('local-fixed-opening-fixture'));
  const conversations = retired.map((card, index) => ({
    id: `retired-conversation-${index}`, characterId: card.id, title: `原创历史记录 ${index}`,
    updatedAt: NOW + index, opening,
    messages: [{ id: `opening-${index}`, role: 'assistant', content: opening.messages[0].content },
      { id: `reply-${index}`, role: 'user', content: '我选择向北的港口。' }],
  }));
  // Seed existing local D1 records directly, rather than reopening retired cards.
  for (const [index, conversation] of conversations.entries()) {
    await DB.batch([
      DB.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at,position,opening_json) VALUES(?,?,?,?,?,?,?)')
        .bind(f.user.id, conversation.id, conversation.characterId, conversation.title, conversation.updatedAt, index, JSON.stringify(opening)),
      ...conversation.messages.map((message, position) => DB.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,?,?,?,?,?)')
        .bind(f.user.id, conversation.id, message.id, message.role, message.content, position)),
      DB.prepare('INSERT INTO favorites(user_id,character_id,position) VALUES(?,?,?)').bind(f.user.id, conversation.characterId, index),
    ]);
  }
  const before = await snapshot(f);
  assert.deepEqual(before.state.conversations, conversations);
  const hydrated = hydrateDzmmState(JSON.stringify(before.state));
  assert.deepEqual(hydrated.warnings, []);
  assert.deepEqual(hydrated.state.conversations, conversations);
  assert.deepEqual(new Set(hydrated.state.favorites), retiredIds);
  const state = structuredClone(hydrated.state);
  state.preferences.nickname = '保留旧剧情后的原创昵称';
  const saved = ok(await call(f, '/v1/state', 'PUT', { accountId: f.user.id, version: before.version, state }));
  assert.deepEqual(saved.state.conversations, conversations);
  assert.deepEqual((await snapshot(f)).state.conversations, conversations);
  // Explicitly restating the existing ID exercises the full-archive lookup.
  const first = conversations[0];
  const updated = ok(await call(f, `/v1/conversations/${first.id}`, 'PATCH', { conversation: { characterId: first.characterId } }));
  const retained = updated.state.conversations.find(item => item.id === first.id);
  assert.deepEqual(retained.messages, first.messages);
  assert.deepEqual(retained.opening, first.opening);
});

test('a private original card remains creatable, discoverable by its owner and usable for a new conversation', async () => {
  const f = await fixture(), card = originalCard();
  ok(await call(f, '/v1/characters', 'POST', { character: card }));
  assert.ok(ok(await call(f, '/v1/characters')).characters.some(item => item.id === card.id));
  const conversationId = randomUUID();
  const saved = ok(await call(f, '/v1/conversations', 'POST', { conversation: { id: conversationId, characterId: card.id } }));
  const conversation = saved.state.conversations.find(item => item.id === conversationId);
  assert.equal(conversation.characterId, card.id);
  assert.equal(conversation.messages[0].content, card.firstMessage);
  assert.ok(conversation.opening);
  const stranger = await fixture(), before = await snapshot(stranger);
  assert.ok(!ok(await call(stranger, '/v1/characters')).characters.some(item => item.id === card.id));
  const denied = await call(stranger, '/v1/conversations', 'POST', { conversation: { id: randomUUID(), characterId: card.id } });
  assert.equal(denied.status, 404, 'Guessing a private character ID must not authorize a new conversation');
  const after = await snapshot(stranger);
  assert.equal(after.version, before.version);
  assert.deepEqual(after.state, before.state);
});

test('verified public-context and all full cards retain every authored opening through isolated backend save and reload', async () => {
  const f = await fixture();
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let exportedOpenings = 0, suppliedOpenings = 0, suppliedDefaults = 0;
  for (const character of DZMM_LISTED_CHARACTERS) {
    const primary = getDzmmOpeningMessages({ ...character, alternateGreetings: [] });
    const openingIndices = [...(primary.length ? [0] : []), ...(character.alternateGreetings ?? []).map((_, index) => index + 1)];
    if (!primary.length && suppliedCardIds.includes(character.id)) {
      assert.equal(hash(captureDzmmConversationOpening(character)), hash(captureDzmmConversationOpening(character, openingIndices[0])), 'Missing primary selects the first authored alternate.');
      const defaultId = randomUUID();
      const defaultResult = ok(await call(f, '/v1/conversations', 'POST', { conversation: { id: defaultId, characterId: character.id } }));
      const savedDefault = defaultResult.state.conversations.find(item => item.id === defaultId);
      assert.equal(hash(savedDefault.opening), hash(captureDzmmConversationOpening(character, openingIndices[0])), 'Backend default creation uses the original first alternate.');
      assert.equal(hash((await snapshot(f)).state.conversations.find(item => item.id === defaultId)), hash(savedDefault));
      suppliedDefaults++;
    }
    for (const index of openingIndices) {
      const conversationId = randomUUID();
      const opening = captureDzmmConversationOpening(character, index);
      const result = await call(f, '/v1/conversations', 'POST', { conversation: {
        id: conversationId, characterId: character.id, ...(index ? { opening } : {}),
      } });
      assert.equal(result.status, 200, `${character.id} opening ${index}: ${result.data.error ?? result.status}`);
      const saved = ok(result).state.conversations.find(item => item.id === conversationId);
      assert.equal(saved?.characterId, character.id);
      assert.equal(hash(saved.opening), hash(opening));
      assert.equal(hash(saved.messages.map(({ role, content }) => ({ role, content }))), hash(opening.messages));
      const reloaded = (await snapshot(f)).state.conversations.find(item => item.id === conversationId);
      assert.equal(hash(reloaded), hash(saved));
      if (exportedCardIds.includes(character.id)) exportedOpenings++;
      if (suppliedCardIds.includes(character.id)) suppliedOpenings++;
    }
  }
  assert.equal(exportedOpenings, DZMM_EXPORTED_FULL_CHARACTERS.reduce((sum, card) => sum + 1 + (card.alternateGreetings?.length ?? 0), 0));
  assert.equal(suppliedOpenings, DZMM_USER_PROVIDED_FULL_CHARACTERS.reduce((sum, card) => sum + (getDzmmOpeningMessages({ ...card, alternateGreetings: [] }).length ? 1 : 0) + (card.alternateGreetings?.length ?? 0), 0));
  assert.equal(suppliedDefaults, DZMM_USER_PROVIDED_FULL_CHARACTERS.filter(card => !getDzmmOpeningMessages({ ...card, alternateGreetings: [] }).length).length);
});

test('retired metadata cards cannot start fresh conversations and rejection leaves account state unchanged', async () => {
  const f = await fixture();
  const before = await snapshot(f);
  for (const card of retired) {
    const result = await call(f, '/v1/conversations', 'POST', { conversation: { id: randomUUID(), characterId: card.id } });
    assert.equal(result.status, 404);
  }
  const legacy = DZMM_CATALOG_CHARACTERS.find(card => !DZMM_AI_CHARACTERS.some(current => current.id === card.id));
  assert.ok(legacy);
  assert.equal((await call(f, '/v1/conversations', 'POST', { conversation: { id: randomUUID(), characterId: legacy.id } })).status, 404);
  const after = await snapshot(f);
  assert.equal(after.version, before.version);
  assert.deepEqual(after.state, before.state);
});

test('published originals require a listed approved revision; guessed pending or retired publication IDs cannot start new chats', async () => {
  const owner = await fixture(), reader = await fixture();
  async function publication(status) {
    const publicationId = `published-${randomUUID()}`, card = originalCard();
    await DB.batch([
      DB.prepare('INSERT INTO character_publications(id,user_id,private_character_id,approved_revision,is_listed,mutation_token,created_at,updated_at) VALUES(?,?,?,1,1,?,?,?)')
        .bind(publicationId, owner.user.id, card.id, randomUUID(), NOW, NOW),
      DB.prepare('INSERT INTO character_submissions(id,publication_id,revision,status,snapshot_json,created_at,reviewed_at) VALUES(?,?,1,?,?,?,?)')
        .bind(randomUUID(), publicationId, status, JSON.stringify(card), NOW, NOW),
    ]);
    return publicationId;
  }
  const approved = await publication('approved'), pending = await publication('pending');
  const catalog = ok(await call(reader, '/v1/characters')).characters;
  assert.ok(catalog.some(card => card.id === approved));
  assert.ok(!catalog.some(card => card.id === pending));
  const conversationId = randomUUID();
  ok(await call(reader, '/v1/conversations', 'POST', { conversation: { id: conversationId, characterId: approved } }));
  const existing = ok(await call(reader, `/v1/conversations/${conversationId}`)).conversation;
  await DB.prepare('UPDATE character_publications SET is_listed=0 WHERE id=?').bind(approved).run();
  assert.ok(!ok(await call(reader, '/v1/characters')).characters.some(card => card.id === approved));
  for (const caller of [owner, reader]) {
    const before = await snapshot(caller);
    for (const characterId of [approved, pending]) {
      assert.equal((await call(caller, '/v1/conversations', 'POST', { conversation: { id: randomUUID(), characterId } })).status, 404);
    }
    const after = await snapshot(caller);
    assert.equal(after.version, before.version);
    assert.deepEqual(after.state, before.state);
  }
  assert.deepEqual(ok(await call(reader, `/v1/conversations/${conversationId}`)).conversation, existing);
});

test('changing a conversation character enforces new-chat eligibility and ownership without blocking same-ID history restore', async () => {
  const owner = await fixture(), stranger = await fixture();
  const first = originalCard(), second = originalCard(), foreign = originalCard();
  for (const character of [first, second]) ok(await call(owner, '/v1/characters', 'POST', { character }));
  ok(await call(stranger, '/v1/characters', 'POST', { character: foreign }));
  const conversationId = randomUUID(), path = `/v1/conversations/${conversationId}`;
  ok(await call(owner, '/v1/conversations', 'POST', { conversation: { id: conversationId, characterId: first.id } }));
  const before = await snapshot(owner);
  const legacy = DZMM_CATALOG_CHARACTERS.find(card => !DZMM_AI_CHARACTERS.some(current => current.id === card.id));
  for (const characterId of [...retiredIds, legacy.id, foreign.id]) {
    const denied = await call(owner, path, 'PATCH', { conversation: { characterId, title: '不得保存的切换标题' } });
    assert.equal(denied.status, 404);
  }
  const afterDenied = await snapshot(owner);
  assert.equal(afterDenied.version, before.version);
  assert.deepEqual(afterDenied.state, before.state);

  const switched = ok(await call(owner, path, 'PATCH', { conversation: { characterId: second.id } }));
  assert.equal(switched.state.conversations.find(item => item.id === conversationId).characterId, second.id);
  const publishedId = `published-${randomUUID()}`, publicCard = originalCard();
  await DB.batch([
    DB.prepare('INSERT INTO character_publications(id,user_id,private_character_id,approved_revision,is_listed,mutation_token,created_at,updated_at) VALUES(?,?,?,1,1,?,?,?)')
      .bind(publishedId, stranger.user.id, publicCard.id, randomUUID(), NOW, NOW),
    DB.prepare("INSERT INTO character_submissions(id,publication_id,revision,status,snapshot_json,created_at,reviewed_at) VALUES(?,?,1,'approved',?,?,?)")
      .bind(randomUUID(), publishedId, JSON.stringify(publicCard), NOW, NOW),
  ]);
  const published = ok(await call(owner, path, 'PATCH', { conversation: { characterId: publishedId } }));
  assert.equal(published.state.conversations.find(item => item.id === conversationId).characterId, publishedId);

  const archivedId = randomUUID(), archivedOpening = captureDzmmConversationOpening(originalCard());
  await DB.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at,position,opening_json) VALUES(?,?,?,?,?,?,?)')
    .bind(owner.user.id, archivedId, retired[0].id, '同角色旧记录', NOW, 1, JSON.stringify(archivedOpening)).run();
  const archivedBefore = ok(await call(owner, `/v1/conversations/${archivedId}`)).conversation;
  const restored = ok(await call(owner, `/v1/conversations/${archivedId}`, 'PATCH', { conversation: { characterId: ` ${retired[0].id} ` } }));
  assert.deepEqual(restored.state.conversations.find(item => item.id === archivedId), archivedBefore);
});
