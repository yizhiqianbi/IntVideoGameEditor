import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { require as tsxRequire } from 'tsx/cjs/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { DZMM_LISTED_CHARACTERS } = tsxRequire('../../../src/lib/dzmm-bundled-cards.ts', import.meta.url);
const { isPublicRecommendationCharacter, recommendationDay } = tsxRequire('../../../src/lib/xumeng-recommendations.ts', import.meta.url);
const { syncRecommendationFacts, recommendForUser, recordRecommendationEvents, loadCooccurrence, recommendationFactQueries } =
  tsxRequire('../src/recommendations.ts', import.meta.url);
const { recordAcquisitionTouch, markAcquisitionStarted } = tsxRequire('../src/acquisition.ts', import.meta.url);
const { acquisitionRegisteredStatement } = tsxRequire('../src/referrals.ts', import.meta.url);

const NOW = Date.parse('2026-10-28T04:00:00Z');
let store, DB, storagePath;
const owners = [];

before(async () => {
  storagePath = await mkdtemp(join(tmpdir(), 'xumeng-recommendations-'));
  store = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("recommendations")}}',
    d1Databases: { DB: `recommendations-${randomUUID()}` },
    resourcePersistencePath: join(storagePath, 'persist'), resourceTmpPath: join(storagePath, 'tmp'),
  }));
  DB = await store.getD1Database('DB');
  const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter((file) => file.endsWith('.sql')).sort();
  assert.ok(migrations.includes('0062_recommendations.sql'));
  for (const file of migrations) {
    const statements = splitSqlStatements(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    await DB.batch(statements.filter((sql) => sql.trim()).map((sql) => DB.prepare(sql)));
  }
});

after(async () => {
  try {
    if (DB) {
      for (const id of owners) await DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
      await DB.prepare('DELETE FROM recommendation_item_daily').run();
    }
  } finally {
    try { await store?.dispose(); }
    finally { if (storagePath) await rm(storagePath, { recursive: true, force: true }); }
  }
});

function listed(count) {
  return DZMM_LISTED_CHARACTERS.filter((character) => isPublicRecommendationCharacter(character)).slice(0, count);
}

async function user(label) {
  const id = randomUUID();
  owners.push(id);
  await DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,?,?)').bind(id, label, 'user', NOW).run();
  return { id, email: null, nickname: label, isGuest: false, role: 'user', version: 0 };
}

async function like(userId, characterId) {
  await DB.prepare('INSERT INTO character_likes(character_id,user_id,created_at) VALUES(?,?,?)').bind(characterId, userId, NOW).run();
}

async function talk(userId, characterId, turns) {
  const conversationId = randomUUID();
  await DB.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at,position) VALUES(?,?,?,?,?,0)')
    .bind(userId, conversationId, characterId, '推荐测试', NOW).run();
  for (let index = 0; index < turns; index += 1) {
    await DB.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,?,?,?,?,?)')
      .bind(userId, conversationId, randomUUID(), 'user', '继续聊聊', index).run();
  }
}

test('fact queries exclude demo accounts and never read display heat', async () => {
  const source = await readFile(new URL('../src/recommendations.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('display_heat'), false);
  assert.equal(source.includes('display_likes'), false);
  assert.equal(source.includes('xumeng-homepage-stats'), false);
  assert.ok(recommendationFactQueries.length >= 5);
  for (const sql of recommendationFactQueries) assert.match(sql, /u\.is_demo=0/);
});

test('backfill counts real likes and five user turns, then hide and blocked tags remove them', async () => {
  const [liked, qualified, shallow] = listed(3);
  const account = await user('推荐账户');
  await like(account.id, liked.id);
  await talk(account.id, qualified.id, 5);
  await talk(account.id, shallow.id, 4);
  await DB.prepare('INSERT INTO favorites(user_id,character_id,position) VALUES(?,?,0)').bind(account.id, 'local-not-public').run();
  await DB.prepare('INSERT INTO character_likes(character_id,user_id,created_at) VALUES(?,?,?)').bind('local-not-public', account.id, NOW).run();

  const env = { DB };
  await syncRecommendationFacts(env, NOW);
  const likedDaily = await DB.prepare('SELECT day_key, likes, qualified FROM recommendation_item_daily WHERE character_id=?').bind(liked.id).first();
  const qualifiedDaily = await DB.prepare('SELECT qualified, likes FROM recommendation_item_daily WHERE character_id=?').bind(qualified.id).first();
  const shallowDaily = await DB.prepare('SELECT qualified FROM recommendation_item_daily WHERE character_id=?').bind(shallow.id).first();
  assert.equal(likedDaily.day_key, recommendationDay(NOW));
  assert.equal(Number(likedDaily.likes), 1);
  assert.equal(Number(likedDaily.qualified), 0);
  assert.equal(Number(qualifiedDaily.qualified), 1);
  assert.equal(shallowDaily, null);

  const ranking = await recommendForUser(env, account, { surface: 'ranking', period: 'all', now: NOW });
  assert.equal(ranking.ids[0], qualified.id);
  assert.ok(ranking.ids.includes(liked.id));
  assert.equal(ranking.ids.includes(shallow.id), false);
  assert.equal(ranking.ids.includes('local-not-public'), false);
  assert.equal(ranking.reasons[qualified.id], 'ranking');

  await DB.prepare('DELETE FROM character_likes WHERE character_id=? AND user_id=?').bind(liked.id, account.id).run();
  const afterUnlike = await recommendForUser(env, account, { surface: 'ranking', period: 'day', now: NOW });
  assert.equal(afterUnlike.ids.includes(liked.id), false);

  await recordRecommendationEvents(env, account.id, [{ characterId: qualified.id, surface: 'home', action: 'hide' }], NOW);
  const hidden = await recommendForUser(env, account, { surface: 'home', now: NOW });
  assert.equal(hidden.ids.includes(qualified.id), false);
  assert.deepEqual(hidden.hiddenIds, [qualified.id]);

  const tag = qualified.tags.find((item) => item && item !== 'NSFW' && item !== '剧情') ?? qualified.tags[0];
  await DB.prepare('INSERT INTO preferences(user_id,nickname,persona,preset,model,dark,extra_json) VALUES(?,?,?,?,?,?,?)')
    .bind(account.id, '推荐账户', '', '', 'qwen', 0, JSON.stringify({ blockedTags: [tag] })).run();
  await DB.prepare('DELETE FROM recommendation_hidden WHERE user_id=?').bind(account.id).run();
  const blocked = await recommendForUser(env, account, { surface: 'ranking', period: 'all', now: NOW });
  if (qualified.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) assert.equal(blocked.ids.includes(qualified.id), false);
});

test('two other accounts must share a card before co-occurrence counts', async () => {
  const [left, right] = listed(2);
  const self = await user('共现自己');
  const first = await user('共现甲');
  const second = await user('共现乙');
  await like(self.id, left.id);
  await like(first.id, left.id); await like(first.id, right.id);
  await like(second.id, left.id); await like(second.id, right.id);
  const support = await loadCooccurrence({ DB }, self.id, [left.id]);
  assert.ok((support.get(right.id) ?? 0) >= 2);
});

test('depth events count only after five stored user turns and do not store message text', async () => {
  const [character] = listed(1);
  const account = await user('深度账户');
  await talk(account.id, character.id, 4);
  assert.equal(await recordRecommendationEvents({ DB }, account.id, [{ characterId: character.id, surface: 'home', action: 'depth', content: '不要保存这句话' }], NOW), 0);
  const stored = await DB.prepare('SELECT content FROM messages WHERE user_id=?').bind(account.id).all();
  assert.ok(stored.results.every((row) => row.content === '继续聊聊'));
  await talk(account.id, character.id, 1);
  assert.equal(await recordRecommendationEvents({ DB }, account.id, [{ characterId: character.id, surface: 'related', action: 'depth' }], NOW), 1);
  const daily = await DB.prepare('SELECT qualified FROM recommendation_item_daily WHERE character_id=?').bind(character.id).first();
  assert.equal(Number(daily.qualified), 1);
  assert.equal(await recordRecommendationEvents({ DB }, account.id, [{ characterId: character.id, surface: 'related', action: 'depth' }], NOW), 0);
  const again = await DB.prepare('SELECT qualified FROM recommendation_item_daily WHERE character_id=?').bind(character.id).first();
  assert.equal(Number(again.qualified), 1);
  const events = await DB.prepare('SELECT action FROM recommendation_events WHERE user_id=? AND character_id=?').bind(account.id, character.id).all();
  assert.equal(events.results.some((row) => JSON.stringify(row).includes('不要保存')), false);
});

test('guests get a quality cold start and search stays inside the catalog match', async () => {
  const [low, high] = listed(12).slice(10);
  const guestId = randomUUID();
  owners.push(guestId);
  await DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,1,?,?)').bind(guestId, '游客冷启动', 'user', NOW).run();
  const day = recommendationDay(NOW);
  const upsert = `INSERT INTO recommendation_item_daily(character_id,day_key,qualified,likes,favorites) VALUES(?,?,?,?,?)
    ON CONFLICT(character_id, day_key) DO UPDATE SET qualified=excluded.qualified`;
  await DB.prepare(upsert).bind(high.id, day, 8, 0, 0).run();
  await DB.prepare(upsert).bind(low.id, day, 1, 0, 0).run();
  const guest = { id: guestId, email: null, nickname: '游客冷启动', isGuest: true, role: 'user', version: 0 };
  const home = await recommendForUser({ DB }, guest, { surface: 'home', now: NOW });
  assert.equal(home.personalized, false);
  assert.ok(home.ids.indexOf(high.id) < home.ids.indexOf(low.id));
  const tag = high.tags.find((item) => item && !['NSFW', '男性向', '剧情', '校园'].includes(item));
  assert.ok(tag);
  const scoped = await recommendForUser({ DB }, guest, { surface: 'home', tags: [tag], now: NOW });
  assert.equal(scoped.ids.includes(high.id), true);
  assert.equal(scoped.ids.includes(low.id), low.tags.includes(tag));
  const searched = await recommendForUser({ DB }, guest, { surface: 'search', q: 'zzzz-not-a-published-card', now: NOW });
  assert.deepEqual(searched.ids, []);
  const category = await recommendForUser({ DB }, guest, { surface: 'category', tags: ['这个标签不存在于任何投稿'], now: NOW });
  assert.deepEqual(category.ids, []);
});

test('the first acquisition touch is kept and counts open, register, and chat', async () => {
  const now = NOW;
  const inviterId = randomUUID();
  const guestId = randomUUID();
  owners.push(inviterId, guestId);
  const code = `XM${inviterId.replace(/-/g, '').toUpperCase().slice(0, 30)}`;
  await DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at,referral_code) VALUES(?,?,0,?,?,?)').bind(inviterId, '邀请人', 'user', now, code).run();
  await DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,1,?,?)').bind(guestId, '被邀请游客', 'user', now).run();
  const guest = { id: guestId, email: null, nickname: '被邀请游客', isGuest: true, role: 'user', version: 0 };
  const [character] = listed(1);
  assert.equal(await recordAcquisitionTouch({ DB }, guest, { source: 'character_share', inviteCode: code, characterId: character.id }, now), true);
  assert.equal(await recordAcquisitionTouch({ DB }, guest, { source: 'poster', inviteCode: 'XMOTHER1', poster: 'gaze' }, now + 10), false);
  const first = await DB.prepare('SELECT source, inviter_id, character_id, registered_at, started_at FROM acquisition_touches WHERE user_id=?').bind(guestId).first();
  assert.equal(first.source, 'character_share');
  assert.equal(first.inviter_id, inviterId);
  assert.equal(first.character_id, character.id);
  assert.equal(first.registered_at, null);
  const nonce = randomUUID();
  await DB.prepare('UPDATE users SET is_guest=0, mutation_token=? WHERE id=?').bind(nonce, guestId).run();
  await acquisitionRegisteredStatement({ DB }, guestId, nonce, now + 20).run();
  await acquisitionRegisteredStatement({ DB }, guestId, nonce, now + 30).run();
  const registered = await DB.prepare('SELECT registered_at FROM acquisition_touches WHERE user_id=?').bind(guestId).first();
  assert.equal(Number(registered.registered_at), now + 20);
  await recordRecommendationEvents({ DB }, guestId, [{ characterId: character.id, surface: 'home', action: 'start' }], now + 40);
  await markAcquisitionStarted({ DB }, guestId, now + 50);
  const started = await DB.prepare('SELECT started_at FROM acquisition_touches WHERE user_id=?').bind(guestId).first();
  assert.equal(Number(started.started_at), now + 40);
  const unknown = { ...guest, id: randomUUID() };
  owners.push(unknown.id);
  await DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,1,?,?)').bind(unknown.id, '无效码', 'user', now).run();
  assert.equal(await recordAcquisitionTouch({ DB }, unknown, { source: 'invite_link', inviteCode: 'XMNOTREAL' }, now), true);
  const unbound = await DB.prepare('SELECT inviter_id, source FROM acquisition_touches WHERE user_id=?').bind(unknown.id).first();
  assert.equal(unbound.source, 'invite_link');
  assert.equal(unbound.inviter_id, null);
  const funnel = await DB.prepare(`SELECT COUNT(*) AS opens,
    COALESCE(SUM(CASE WHEN registered_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS registrations,
    COALESCE(SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS started
    FROM acquisition_touches WHERE inviter_id=?`).bind(inviterId).first();
  assert.equal(Number(funnel.opens), 1);
  assert.equal(Number(funnel.registrations), 1);
  assert.equal(Number(funnel.started), 1);
});
