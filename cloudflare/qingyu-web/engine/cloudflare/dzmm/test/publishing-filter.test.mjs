import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
let store, DB, env, owner, stranger, admin, oldest;
const site = 'https://creator-filter.example.test';
const clients = [];
const draft = (name, id = `local-${randomUUID()}`) => ({ id, name, author: '验收作者',
  description: '成年档案员整理雨港的旧地图。', firstMessage: '欢迎来到雨港档案室。', tags: ['原创'], cover: '' });
const expected = (value, status) => { assert.equal(value.status, status, JSON.stringify(value.data)); return value.data; };
async function client(role = 'user') {
  const id = randomUUID(), token = randomBytes(32).toString('hex'), now = Date.now();
  await DB.batch([
    DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,?,?)').bind(id, '原创隔离验收者', role, now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'), id, now + 3600000, now),
  ]);
  const value = { id, token }; clients.push(value); return value;
}
async function request(path, as = owner, method = 'GET', body) {
  const response = await fetchRequest(new Request(`${site}/v1/publishing${path}`, { method,
    headers: { Origin: site, 'CF-Connecting-IP': as?.id ?? 'anonymous', ...(as ? { Cookie: `qingyu_session=${as.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  return { status: response.status, data: await response.json() };
}
async function submit(card, previous) {
  return expected(await request('/submissions', owner, 'POST', { accountId: owner.id, character: card,
    ...(previous ? { publicationId: previous.id, version: previous.version } : {}) }), 201);
}
async function review(result, decision = 'approved') {
  return expected(await request(`/submissions/${result.submission.id}/review`, admin, 'PATCH', { accountId: admin.id,
    version: result.publication.version, decision, ...(decision === 'rejected' ? { reason: '请补充港口开放时间。' } : {}) }), 200);
}
async function withdraw(result) {
  return expected(await request(`/submissions/${result.submission.id}/withdraw`, owner, 'POST', { accountId: owner.id, version: result.publication.version }), 200);
}
async function unpublish(result) {
  return expected(await request(`/publications/${result.publication.id}/unpublish`, owner, 'POST', { accountId: owner.id, version: result.publication.version }), 200).publication;
}
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated publishing filters")}}', d1Databases: { DB: 'creator-publishing-filter' }, r2Buckets: { MEDIA: 'creator-publishing-filter' } }));
  DB = await store.getD1Database('DB');
  const MEDIA = await store.getR2Bucket('MEDIA'); env = { DB, MEDIA, APP_ORIGINS: site };
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(sql).filter(part => part.trim()).map(part => DB.prepare(part)));
  }
  owner = await client(); stranger = await client(); admin = await client('super');
  oldest = await submit(draft('最早的雨港档案员'));
  for (let index = 1; index <= 20; index++) await withdraw(await submit(draft(`已撤回的海图助手 ${index}`)));
  // Fix only this fixture's timestamp so its oldest record has a deterministic position.
  await DB.prepare('UPDATE character_publications SET updated_at=1 WHERE id=? AND user_id=?').bind(oldest.publication.id, owner.id).run();
});
after(async () => {
  try {
    for (const { id } of clients) await DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
    for (const table of ['users', 'sessions', 'character_publications', 'character_submissions']) {
      assert.equal((await DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0, `cleanup ${table}`);
    }
    assert.equal((await env.MEDIA.list()).objects.length, 0, 'no media assets created');
  } finally { await store?.dispose(); }
});

test('mine filters before pagination so the matching21st record is on the first status page', async () => {
  const first = expected(await request('/mine?limit=20'), 200);
  assert.equal(first.status, 'all'); assert.equal(first.total, 21); assert.equal(first.publications.length, 20); assert.equal(first.hasMore, true);
  assert.ok(!first.publications.some(item => item.id === oldest.publication.id));
  const second = expected(await request('/mine?limit=20&offset=20&status=all'), 200);
  assert.deepEqual(second.publications.map(item => item.id), [oldest.publication.id]); assert.equal(second.total, 21); assert.equal(second.hasMore, false);
  const pending = expected(await request('/mine?status=pending&limit=20'), 200);
  assert.equal(pending.status, 'pending'); assert.equal(pending.total, 1); assert.equal(pending.hasMore, false);
  assert.deepEqual(pending.publications.map(item => item.id), [oldest.publication.id]);
});
test('withdrawal archive uses its own total and page boundary', async () => {
  const archive = expected(await request('/mine?status=archived&limit=19'), 200);
  assert.equal(archive.total, 20); assert.equal(archive.publications.length, 19); assert.equal(archive.hasMore, true);
  const last = expected(await request('/mine?status=archived&limit=19&offset=19'), 200);
  assert.equal(last.publications.length, 1); assert.equal(last.total, 20); assert.equal(last.hasMore, false);
  assert.ok([...archive.publications, ...last.publications].every(item => item.latestSubmission.status === 'withdrawn'));
});
test('mine validates statuses and pagination without broadening the selection', async () => {
  for (const query of ['status=', 'status=approved', 'status=not-a-filter', 'status=all&status=pending', 'status=__proto__', 'limit=0', 'offset=-1']) expected(await request(`/mine?${query}`), 400);
  for (const status of ['all', 'pending', 'published', 'rejected', 'archived']) expected(await request(`/mine?status=${status}`), 200);
});
test('owner isolation and reviewer-only permissions remain unchanged', async () => {
  const other = expected(await request('/mine?status=all', stranger), 200); assert.deepEqual(other.publications, []); assert.equal(other.total, 0);
  expected(await request('/mine?status=pending', null), 401);
  expected(await request('/submissions?status=pending', owner), 403);
  const queue = expected(await request('/submissions?status=pending', admin), 200); assert.ok(queue.submissions.some(item => item.id === oldest.submission.id));
});
test('published overlaps pending/rejected updates while approved previous version remains public', async () => {
  const first = await review(await submit(draft('已上线的成年领航员')));
  let update = await submit(draft('正在审核的新领航员', first.publication.privateCharacterId), first.publication);
  const pending = expected(await request('/mine?status=pending'), 200).publications.find(item => item.id === first.publication.id);
  const published = expected(await request('/mine?status=published'), 200).publications.find(item => item.id === first.publication.id);
  assert.equal(pending.latestSubmission.status, 'pending'); assert.equal(published.isListed, true); assert.equal(published.approvedRevision, 1);
  assert.equal(expected(await request(`/catalog/${first.publication.id}`, null), 200).character.name, '已上线的成年领航员');
  update = await review(update, 'rejected');
  const rejected = expected(await request('/mine?status=rejected'), 200).publications.find(item => item.id === first.publication.id);
  assert.equal(rejected.latestSubmission.status, 'rejected'); assert.equal(rejected.isListed, true);
  assert.equal(expected(await request(`/catalog/${first.publication.id}`, null), 200).character.publication.revision, 1);
  await unpublish(update);
});
test('withdrawn update is archived while approved version stays listed, then actual unpublish stays discoverable', async () => {
  const first = await review(await submit(draft('灯塔管理员')));
  const update = await submit(draft('灯塔管理员更新', first.publication.privateCharacterId), first.publication);
  const withdrawn = await withdraw(update);
  for (const status of ['archived', 'published', 'all']) assert.ok(expected(await request(`/mine?status=${status}`), 200).publications.some(item => item.id === first.publication.id));
  assert.equal(expected(await request(`/catalog/${first.publication.id}`, null), 200).character.name, '灯塔管理员');
  await unpublish(withdrawn);
  const archived = expected(await request('/mine?status=archived'), 200);
  // Archives may now span pages; inspect through the server's own filtered pagination.
  const allArchived = [...archived.publications, ...expected(await request(`/mine?status=archived&offset=${archived.publications.length}&limit=50`), 200).publications];
  const item = allArchived.find(item => item.id === first.publication.id);
  assert.ok(item); assert.equal(item.isListed, false); assert.equal(item.latestSubmission.status, 'withdrawn');
  expected(await request(`/catalog/${first.publication.id}`, null), 404);
});
test('approved and subsequently taken-down publication enters archive without changing approved latest status', async () => {
  const approved = await review(await submit(draft('已退休的旧港管理员'))); await unpublish(approved);
  const archive = expected(await request('/mine?status=archived&limit=50'), 200);
  const item = archive.publications.find(item => item.id === approved.publication.id);
  assert.equal(item.latestSubmission.status, 'approved'); assert.equal(item.isListed, false); assert.equal(item.approvedRevision, 1);
  assert.ok(!expected(await request('/mine?status=published&limit=50'), 200).publications.some(item => item.id === approved.publication.id));
});
