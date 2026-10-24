import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const site = 'https://publishing-snapshot.example.test';
let store, DB, MEDIA, env, owner, stranger;
const accounts = [];
const expect = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; };
const card = (name = '雨港成年档案员', id = `local-${randomUUID()}`) => ({ id, name, author: '原创隔离作者',
  description: '成年档案员帮助旅人整理港口旧地图。', firstMessage: '这份海图从哪一页开始？', tags: ['原创'], cover: '' });

async function account() {
  const id = randomUUID(), token = randomBytes(32).toString('hex'), now = Date.now();
  await DB.batch([
    DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,\'user\',?)').bind(id, '普通原创测试作者', now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(token).digest('hex'), id, now + 3600000, now),
  ]);
  const value = { id, cookie: `qingyu_session=${token}` }; accounts.push(value); return value;
}
async function request(path, { as = owner, method = 'GET', body, binding = env } = {}) {
  const response = await fetchRequest(new Request(`${site}/v1/publishing${path}`, { method,
    headers: { Origin: site, 'CF-Connecting-IP': as?.id ?? 'anonymous', ...(as ? { Cookie: as.cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), binding);
  return { status: response.status, data: await response.json() };
}
async function submit(character = card(), previous, as = owner) {
  return expect(await request('/submissions', { as, method: 'POST', body: { accountId: as.id, character,
    ...(previous ? { publicationId: previous.id, version: previous.version } : {}) } }), 201);
}
// These ordinary test accounts do not invoke a Super review endpoint. This is a
// complete, atomic moderation-result simulation on their disposable local D1.
async function approve(result) {
  const publication = result.publication, nonce = randomUUID(), now = Date.now();
  const changed = await DB.batch([
    DB.prepare(`UPDATE character_publications SET version=version+1,is_listed=1,approved_revision=current_revision,mutation_token=?,updated_at=?
      WHERE id=? AND user_id=? AND version=? AND current_revision=?`)
      .bind(nonce, now, publication.id, publication.ownerId, publication.version, publication.currentRevision),
    DB.prepare(`UPDATE character_submissions SET status='approved',review_reason='',reviewed_by=NULL,reviewed_at=?
      WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM character_publications WHERE id=? AND mutation_token=?)`)
      .bind(now, result.submission.id, publication.id, nonce),
  ]);
  assert.deepEqual(changed.map(item => item.meta.changes), [1, 1]);
}
function snapshotBinding({ beforeRead, afterRead, fault } = {}) {
  const statements = new WeakMap(), observation = { snapshots: 0, standaloneLatestReads: 0, sizes: [] };
  function wrap(statement, sql) {
    const wrapped = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...values) => wrap(target.bind(...values), sql);
      if (key === 'first' || key === 'all' || key === 'run' || key === 'raw') return (...args) => {
        if (sql.includes('s.publication_id=? AND s.revision=?')) observation.standaloneLatestReads++;
        return target[key](...args);
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    statements.set(wrapped, { statement, sql }); return wrapped;
  }
  const binding = { ...env, DB: {
    prepare(sql) { return wrap(DB.prepare(sql), sql); },
    async batch(items) {
      const sql = items.map(item => statements.get(item)?.sql ?? '');
      const isMine = sql[0]?.includes('publication_created_at') && sql[0].includes('s.revision=p.current_revision');
      if (isMine) {
        observation.snapshots++; observation.sizes.push(items.length);
        assert.equal(items.length, 2);
        assert.match(sql[1], /SELECT COUNT\(\*\) AS total/);
        assert.ok(sql.every(value => value.includes('WHERE p.user_id=?')));
        if (beforeRead) await beforeRead();
        if (fault === 'before') throw new Error('isolated-mine-read-before-batch');
      }
      const result = await DB.batch(items.map(item => statements.get(item)?.statement ?? item));
      if (isMine) {
        if (afterRead) await afterRead();
        if (fault === 'after') throw new Error('isolated-mine-read-response-loss');
      }
      return result;
    },
  } };
  return { binding, observation };
}
function consistent(item) {
  assert.equal(item.version, item.latestSubmission.publicationVersion);
  assert.equal(item.currentRevision, item.latestSubmission.revision);
  assert.equal(item.approvedRevision, item.latestSubmission.approvedRevision);
  assert.equal(item.isListed, item.latestSubmission.isListed);
  assert.equal(item.id, item.latestSubmission.publicationId);
  assert.equal(item.ownerId, item.latestSubmission.author.id);
}
function observedRead(observation) {
  assert.equal(observation.snapshots, 1);
  assert.deepEqual(observation.sizes, [2]);
  assert.equal(observation.standaloneLatestReads, 0, 'no later current-submission lookup');
}
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated mine snapshot")}}',
    d1Databases: { DB: 'publishing-mine-snapshot' }, r2Buckets: { MEDIA: 'publishing-mine-snapshot' } }));
  DB = await store.getD1Database('DB'); MEDIA = await store.getR2Bucket('MEDIA'); env = { DB, MEDIA, APP_ORIGINS: site };
  const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  assert.ok(migrations.includes('0038_nowpayments_quarterly_membership.sql'), 'Use the currently published schema and apply every actual migration.');
  for (const file of migrations) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(sql).filter(part => part.trim()).map(part => DB.prepare(part)));
  }
  owner = await account(); stranger = await account();
});
beforeEach(async () => {
  await DB.batch(accounts.map(value => DB.prepare('DELETE FROM character_publications WHERE user_id=?').bind(value.id)));
  await DB.prepare('DELETE FROM auth_rate_limits').run();
});
after(async () => {
  try {
    for (const value of accounts) await DB.prepare('DELETE FROM users WHERE id=?').bind(value.id).run();
    await DB.prepare('DELETE FROM auth_rate_limits').run();
    for (const table of ['users', 'sessions', 'characters', 'character_publications', 'character_submissions', 'auth_rate_limits'])
      assert.equal((await DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0, `cleanup ${table}`);
    assert.equal((await MEDIA.list()).objects.length, 0, 'no provider/media object created');
    assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await store?.dispose(); }
});

test('ordinary pending and approved controls retain distinct publication/submission timestamps', async () => {
  const original = await submit();
  await DB.batch([
    DB.prepare('UPDATE character_publications SET created_at=1000,updated_at=2000 WHERE id=? AND user_id=?').bind(original.publication.id, owner.id),
    DB.prepare('UPDATE character_submissions SET created_at=1500 WHERE id=?').bind(original.submission.id),
  ]);
  const f = snapshotBinding(), pending = expect(await request('/mine?status=pending', { binding: f.binding }));
  assert.equal(pending.total, 1); assert.equal(pending.publications.length, 1); assert.equal(pending.hasMore, false);
  const item = pending.publications[0]; consistent(item);
  assert.equal(item.createdAt, 1000); assert.equal(item.updatedAt, 2000); assert.equal(item.latestSubmission.createdAt, 1500);
  assert.equal(item.latestSubmission.status, 'pending'); observedRead(f.observation);
  await approve(original);
  const approved = expect(await request('/mine?status=published')).publications[0]; consistent(approved);
  assert.equal(approved.version, 2); assert.equal(approved.isListed, true); assert.equal(approved.approvedRevision, 1);
});
test('approval before the atomic read yields the complete new filtered result', async () => {
  const original = await submit(), f = snapshotBinding({ beforeRead: () => approve(original) });
  const pending = expect(await request('/mine?status=pending', { binding: f.binding }));
  assert.equal(pending.total, 0); assert.deepEqual(pending.publications, []); assert.equal(pending.hasMore, false);
  observedRead(f.observation);
  const published = expect(await request('/mine?status=published')).publications[0]; consistent(published);
  assert.equal(published.latestSubmission.status, 'approved'); assert.equal(published.version, 2);
});
test('approval after the atomic read returns complete old pending state, followed by complete new state on refresh', async () => {
  const original = await submit(), f = snapshotBinding({ afterRead: () => approve(original) });
  const old = expect(await request('/mine?status=pending', { binding: f.binding }));
  assert.equal(old.total, 1); assert.equal(old.publications.length, 1); consistent(old.publications[0]);
  assert.equal(old.publications[0].version, 1); assert.equal(old.publications[0].isListed, false);
  assert.equal(old.publications[0].latestSubmission.status, 'pending'); observedRead(f.observation);
  assert.deepEqual(expect(await request('/mine?status=pending')).publications, []);
  const fresh = expect(await request('/mine?status=published')).publications[0]; consistent(fresh);
  assert.equal(fresh.version, 2); assert.equal(fresh.latestSubmission.status, 'approved');
});
test('actual author resubmission before the snapshot returns its new current revision', async () => {
  const original = await submit(); let update;
  const f = snapshotBinding({ beforeRead: async () => { update = await submit(card('新海图版本', original.publication.privateCharacterId), original.publication); } });
  const page = expect(await request('/mine?status=pending', { binding: f.binding }));
  assert.equal(page.total, 1); const item = page.publications[0]; consistent(item);
  assert.equal(item.currentRevision, 2); assert.equal(item.version, 2);
  assert.equal(item.latestSubmission.id, update.submission.id); assert.equal(item.latestSubmission.character.name, '新海图版本');
  observedRead(f.observation);
});
test('actual author resubmission after the snapshot cannot replace old pending with a late withdrawn/new-parent join', async () => {
  const original = await submit(); let update;
  const f = snapshotBinding({ afterRead: async () => { update = await submit(card('迟到的新海图', original.publication.privateCharacterId), original.publication); } });
  const page = expect(await request('/mine?status=pending', { binding: f.binding }));
  assert.equal(page.total, 1); const old = page.publications[0]; consistent(old);
  assert.equal(old.version, 1); assert.equal(old.currentRevision, 1); assert.equal(old.latestSubmission.id, original.submission.id);
  assert.equal(old.latestSubmission.status, 'pending'); assert.equal(old.latestSubmission.character.name, original.submission.character.name);
  observedRead(f.observation);
  const current = expect(await request('/mine?status=pending')).publications[0]; consistent(current);
  assert.equal(current.currentRevision, 2); assert.equal(current.latestSubmission.id, update.submission.id);
  assert.equal((await DB.prepare('SELECT status FROM character_submissions WHERE id=?').bind(original.submission.id).first()).status, 'withdrawn');
});
test('owner-filtered count and offset remain scoped while a foreign moderation result commits', async () => {
  await submit(card('本人第一份')); await submit(card('本人第二份'));
  const foreign = await submit(card('另一个普通作者'), undefined, stranger);
  const f = snapshotBinding({ beforeRead: () => approve(foreign) });
  const first = expect(await request('/mine?status=pending&limit=1', { binding: f.binding }));
  assert.equal(first.total, 2); assert.equal(first.hasMore, true); assert.equal(first.publications.length, 1);
  consistent(first.publications[0]); assert.equal(first.publications[0].ownerId, owner.id); observedRead(f.observation);
  const second = expect(await request('/mine?status=pending&limit=1&offset=1'));
  assert.equal(second.total, 2); assert.equal(second.hasMore, false); assert.notEqual(second.publications[0].id, first.publications[0].id);
  assert.equal(second.publications[0].ownerId, owner.id);
  const foreignPage = expect(await request('/mine?status=published', { as: stranger }));
  assert.equal(foreignPage.total, 1); assert.equal(foreignPage.publications[0].id, foreign.publication.id);
});
test('a new own submission after the batch cannot change the returned count or page boundary', async () => {
  await submit(card('快照原稿'));
  const f = snapshotBinding({ afterRead: () => submit(card('读后追加稿')) });
  const old = expect(await request('/mine?status=pending&limit=1', { binding: f.binding }));
  assert.equal(old.total, 1); assert.equal(old.publications.length, 1); assert.equal(old.hasMore, false); observedRead(f.observation);
  const fresh = expect(await request('/mine?status=pending&limit=1'));
  assert.equal(fresh.total, 2); assert.equal(fresh.publications.length, 1); assert.equal(fresh.hasMore, true);
});
for (const fault of ['before', 'after']) test(`failed ${fault}-batch read returns an error instead of a partial success page`, async () => {
  const original = await submit(), f = snapshotBinding({ fault });
  const failed = expect(await request('/mine?status=pending', { binding: f.binding }), 500);
  assert.equal(Object.hasOwn(failed, 'publications'), false); assert.equal(Object.hasOwn(failed, 'total'), false);
  observedRead(f.observation);
  const retried = expect(await request('/mine?status=pending'));
  assert.equal(retried.total, 1); assert.equal(retried.publications[0].id, original.publication.id); consistent(retried.publications[0]);
});
