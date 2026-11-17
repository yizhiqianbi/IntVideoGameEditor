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
    headers: { Origin: site, 'CF-Connecting-IP': as?.id ?? 'anonymous', ...(as ? { Cookie: `dzmm_session=${as.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
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
test('review queue search stays inside the status filter and reaches past the first page', async () => {
  const author = await client();
  await DB.prepare('UPDATE users SET nickname=? WHERE id=?').bind('港湾作者甲', author.id).run();
  async function submitAs(card) {
    return expected(await request('/submissions', author, 'POST', { accountId: author.id, character: card }), 201);
  }
  async function approve(result) {
    return expected(await request(`/submissions/${result.submission.id}/review`, admin, 'PATCH', { accountId: admin.id, version: result.publication.version, decision: 'approved' }), 200);
  }
  const filler = await approve(await submitAs(draft('填充审核角色', `local-filler-${randomUUID()}`)));
  const characterId = `local-xueli-${randomUUID()}`;
  const target = await approve(await submitAs({ ...draft('雪梨专页', characterId), description: '独特简介标记不该被搜到' }));
  const pending = await submitAs(draft('雪梨专页待审', `local-pending-${randomUUID()}`));
  await DB.batch([
    DB.prepare('UPDATE character_submissions SET created_at=? WHERE id=?').bind(1, filler.submission.id),
    DB.prepare('UPDATE character_submissions SET created_at=? WHERE id=?').bind(9_000_000_000_000, target.submission.id),
  ]);
  const first = expected(await request('/submissions?status=approved&limit=1', admin), 200);
  assert.equal(first.q, '');
  assert.ok(first.total > 1);
  assert.equal(first.hasMore, true);
  assert.ok(!first.submissions.some(item => item.id === target.submission.id));
  const byName = expected(await request(`/submissions?status=approved&limit=1&q=${encodeURIComponent('雪梨专页')}`, admin), 200);
  assert.equal(byName.q, '雪梨专页');
  assert.equal(byName.total, 1);
  assert.equal(byName.hasMore, false);
  assert.equal(byName.submissions.length, 1);
  assert.equal(byName.submissions[0].id, target.submission.id);
  assert.equal(byName.submissions[0].character.name, '雪梨专页');
  assert.equal(byName.submissions[0].author.nickname, '港湾作者甲');
  assert.equal(byName.submissions[0].publicationId, target.publication.id);
  assert.equal(byName.submissions[0].isListed, true);
  assert.equal(typeof byName.submissions[0].publicationVersion, 'number');
  const spaced = expected(await request(`/submissions?status=approved&q=${encodeURIComponent('  雪梨专页  ')}`, admin), 200);
  assert.equal(spaced.q, '雪梨专页');
  assert.deepEqual(spaced.submissions.map(item => item.id), [target.submission.id]);
  const pendingName = expected(await request(`/submissions?status=pending&q=${encodeURIComponent('雪梨专页')}`, admin), 200);
  assert.deepEqual(pendingName.submissions.map(item => item.id), [pending.submission.id]);
  assert.equal(pendingName.total, 1);
  const byAuthor = expected(await request(`/submissions?status=approved&q=${encodeURIComponent('港湾作者')}&limit=1`, admin), 200);
  assert.equal(byAuthor.total, 2);
  assert.equal(byAuthor.hasMore, true);
  assert.equal(byAuthor.submissions.length, 1);
  assert.equal(byAuthor.submissions[0].id, filler.submission.id);
  assert.equal(byAuthor.submissions[0].author.nickname, '港湾作者甲');
  const byAuthorNext = expected(await request(`/submissions?status=approved&q=${encodeURIComponent('港湾作者')}&limit=1&offset=1`, admin), 200);
  assert.equal(byAuthorNext.total, 2);
  assert.equal(byAuthorNext.hasMore, false);
  assert.deepEqual(byAuthorNext.submissions.map(item => item.id), [target.submission.id]);
  for (const [label, value] of [['publication', target.publication.id], ['character', characterId], ['submission', target.submission.id]]) {
    const found = expected(await request(`/submissions?status=approved&q=${encodeURIComponent(value)}`, admin), 200);
    assert.equal(found.total, 1, label);
    assert.equal(found.submissions[0].id, target.submission.id, label);
  }
  assert.equal(expected(await request(`/submissions?status=rejected&q=${encodeURIComponent(target.publication.id)}`, admin), 200).total, 0);
  assert.equal(expected(await request(`/submissions?status=approved&q=${encodeURIComponent('独特简介标记不该被搜到')}`, admin), 200).total, 0);
  assert.equal(expected(await request(`/submissions?status=approved&q=${encodeURIComponent('验收作者')}`, admin), 200).total, 0);
  assert.equal(expected(await request('/submissions?status=approved&q=%20%20', admin), 200).q, '');
  const folded = await approve(await submitAs(draft('Shirakawa Rei', `local-rei-${randomUUID()}`)));
  assert.ok(expected(await request('/submissions?status=approved&q=shirakawa', admin), 200).submissions.some(item => item.id === folded.submission.id));
  assert.ok(expected(await request(`/submissions?status=approved&q=${encodeURIComponent('SHIRAKAWA')}`, admin), 200).submissions.some(item => item.id === folded.submission.id));
  expected(await request(`/submissions?status=approved&q=${encodeURIComponent('雪梨专页')}`, author), 403);
  expected(await request(`/submissions?status=approved&q=${'a'.repeat(121)}`, admin), 400);
  expected(await request('/submissions?status=approved&q=%00', admin), 400);
  expected(await request('/submissions?status=approved&q=%0A', admin), 400);
  expected(await request('/submissions?status=not-a-status&q=snow', admin), 400);
});
test('approved and subsequently taken-down publication enters archive without changing approved latest status', async () => {
  const approved = await review(await submit(draft('已退休的旧港管理员'))); await unpublish(approved);
  const archive = expected(await request('/mine?status=archived&limit=50'), 200);
  const item = archive.publications.find(item => item.id === approved.publication.id);
  assert.equal(item.latestSubmission.status, 'approved'); assert.equal(item.isListed, false); assert.equal(item.approvedRevision, 1);
  assert.ok(!expected(await request('/mine?status=published&limit=50'), 200).publications.some(item => item.id === approved.publication.id));
});
