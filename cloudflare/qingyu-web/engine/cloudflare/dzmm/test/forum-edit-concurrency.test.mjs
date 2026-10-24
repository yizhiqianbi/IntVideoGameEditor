import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { build } from 'esbuild';
import { splitSqlStatements } from './sql-migrations.mjs';

// Real authenticated router and disposable transactional D1. The optional
// source override preserves a sealed negative baseline without editing source.
async function loadRouter() {
  if (!process.env.DZMM_FORUM_SOURCE) return tsImport('../src/app.ts', import.meta.url);
  const forumPath = fileURLToPath(new URL('../src/forum.ts', import.meta.url));
  const contents = await readFile(resolve(process.env.DZMM_FORUM_SOURCE), 'utf8');
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/app.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    plugins: [{ name: 'sealed-forum-baseline', setup(builder) {
      builder.onLoad({ filter: /[/\\]forum\.ts$/ }, args => args.path === forumPath
        ? { contents, loader: 'ts', resolveDir: dirname(forumPath) } : null);
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const { fetchRequest } = await loadRouter();
const origin = 'https://forum-concurrency.example.test';
let store, DB;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated forum edit store")}}',
    d1Databases: { DB: `forum-edit-${randomUUID()}` } }));
  DB = await store.getD1Database('DB');
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
    const source = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => DB.prepare(sql)));
  }
});
after(async () => { await store?.dispose(); });

async function account(role = 'user', isGuest = false) {
  const user = { id: randomUUID(), nickname: 'Original forum test author', role, isGuest };
  const token = randomBytes(32).toString('hex'), now = Date.now();
  await DB.batch([
    DB.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,?,?,?)')
      .bind(user.id, `${randomUUID()}@forum-concurrency.example.test`, user.nickname, isGuest ? 1 : 0, role, now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(token).digest('hex'), user.id, now + 86400000, now),
  ]);
  return { user, token, ip: randomUUID() };
}
async function api(actor, path, { method = 'GET', body, database = DB } = {}) {
  const request = new Request(`${origin}${path}`, { method, headers: {
    Origin: origin, 'CF-Connecting-IP': actor?.ip ?? randomUUID(),
    ...(actor ? { Cookie: `qingyu_session=${actor.token}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const response = await fetchRequest(request, { DB: database, APP_ORIGINS: origin });
  return { status: response.status, data: await response.json() };
}
function expect(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
function draft(name = 'Original lighthouse discussion') {
  return { title: name, body: 'Compare the printed chart with the lighthouse log.\nKeep the dated notes.',
    category: 'characters', tags: ['original', 'navigation'] };
}
async function create(actor) {
  return expect(await api(actor, '/v1/forum/posts', { method: 'POST', body: draft() }), 201).post;
}
const postPath = post => `/v1/forum/posts/${post.id}`;
function update(actor, post, value, options = {}) {
  return api(actor, postPath(post), { method: 'PATCH', body: { ...value, baseUpdatedAt: post.updatedAt }, ...options });
}
async function get(actor, post) { return expect(await api(actor, postPath(post))).post; }
async function row(post) {
  const record = await DB.prepare('SELECT * FROM forum_posts WHERE id=?').bind(post.id).first();
  const tags = (await DB.prepare('SELECT tag FROM forum_post_tags WHERE post_id=? ORDER BY tag').bind(post.id).all()).results.map(row => row.tag);
  return { record, tags };
}
function hookedDatabase({ beforeBatch, afterBatch } = {}) {
  return { prepare: sql => DB.prepare(sql), batch: async statements => {
    await beforeBatch?.();
    const results = await DB.batch(statements);
    await afterBatch?.();
    return results;
  } };
}
async function frozenTime(now, run) {
  const original = Date.now;
  Date.now = () => now;
  try { return await run(); } finally { Date.now = original; }
}

test('PATCH without a base timestamp is rejected safely for old pages, never overwriting body or tags', async () => {
  const owner = await account(), post = await create(owner), beforeRow = await row(post);
  expect(await api(owner, postPath(post), { method: 'PATCH', body: draft('Legacy page overwrite') }), 428);
  assert.deepEqual(await row(post), beforeRow);
  assert.deepEqual(await get(owner, post), post);
});

test('invalid timestamp tokens are rejected without a partial update', async () => {
  const owner = await account(), post = await create(owner), beforeRow = await row(post);
  for (const baseUpdatedAt of [null, -1, 0.5, '1', {}, [], Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    expect(await api(owner, postPath(post), { method: 'PATCH', body: { ...draft('Invalid overwrite'), baseUpdatedAt } }), 400);
    assert.deepEqual(await row(post), beforeRow);
  }
});

test('stale save returns the complete current snapshot while preserving winner body, category and tags', async () => {
  const owner = await account(), post = await create(owner);
  const winnerDraft = { ...draft('New edition'), body: 'The owner confirmed the seventh marker.', category: 'life', tags: ['winner', 'verified'] };
  const winner = expect(await update(owner, post, winnerDraft)).post, beforeRow = await row(post);
  const response = await update(owner, post, { ...draft('Stale edition'), body: 'This obsolete note must not return.', category: 'help', tags: ['stale'] });
  const conflict = expect(response, 409);
  assert.equal(conflict.code, 'FORUM_EDIT_CONFLICT');
  assert.deepEqual(conflict.current, winner);
  assert.deepEqual(await row(post), beforeRow);
  assert.deepEqual(await get(owner, post), winner);
});

test('two real same-base concurrent saves have one complete winner and one conflict, never mixed tags', async () => {
  const owner = await account(), post = await create(owner);
  const candidates = ['left', 'right'].map(name => ({ title: `${name} edition`, body: `${name} complete body`,
    category: name === 'left' ? 'social' : 'help', tags: [name, `${name}-only`] }));
  const responses = await Promise.all(candidates.map(value => update(owner, post, value)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winnerIndex = responses.findIndex(response => response.status === 200);
  const winner = responses[winnerIndex].data.post, loser = responses[1 - winnerIndex].data;
  assert.equal(loser.code, 'FORUM_EDIT_CONFLICT');
  assert.deepEqual(loser.current, winner);
  assert.deepEqual({ title: winner.title, body: winner.body, category: winner.category, tags: [...winner.tags].sort() },
    { ...candidates[winnerIndex], tags: [...candidates[winnerIndex].tags].sort() });
  assert.deepEqual(await get(owner, post), winner);
});

test('same-millisecond and backwards-clock edits advance the CAS token and reject an old base', async () => {
  const owner = await account(), post = await create(owner);
  await frozenTime(post.updatedAt, async () => {
    const first = expect(await update(owner, post, draft('First same-millisecond edit'))).post;
    assert.equal(first.updatedAt, post.updatedAt + 1);
    const response = expect(await update(owner, post, draft('Obsolete same-millisecond edit')), 409);
    assert.deepEqual(response.current, first);
    const next = expect(await update(owner, first, draft('Second same-millisecond edit'))).post;
    assert.equal(next.updatedAt, first.updatedAt + 1);
    assert.deepEqual(await get(owner, post), next);
  });
  const current = await get(owner, post);
  await frozenTime(post.updatedAt - 1000, async () => {
    const next = expect(await update(owner, current, draft('Backwards clock edit'))).post;
    assert.equal(next.updatedAt, current.updatedAt + 1);
    assert.deepEqual(await get(owner, post), next);
  });
});

test('owner and current super role may edit; other users, guests and missing sessions cannot', async () => {
  const owner = await account(), other = await account(), admin = await account('super');
  const guest = await account('user', true), guestSuper = await account('super', true), post = await create(owner);
  const owned = expect(await update(owner, post, draft('Owner edit'))).post;
  for (const [actor, status] of [[other, 404], [guest, 403], [guestSuper, 403], [null, 401]]) {
    const rejection = expect(await update(actor, owned, draft('Unauthorized edit')), status);
    assert.equal(Object.hasOwn(rejection, 'current'), false);
    const oldPageRejection = expect(await api(actor, postPath(post), { method: 'PATCH', body: draft('Unauthorized legacy page') }), status);
    assert.equal(Object.hasOwn(oldPageRejection, 'current'), false);
    assert.deepEqual(await get(owner, post), owned);
  }
  const administered = expect(await update(admin, owned, draft('Administrator edit'))).post;
  assert.equal(administered.author.id, owner.user.id);
  assert.deepEqual(await get(owner, post), administered);
  await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(admin.user.id).run();
  expect(await update(admin, administered, draft('Demoted administrator edit')), 404);
  assert.deepEqual(await get(owner, post), administered);
});

test('deletion after ownership check yields 404 and cannot leave tags or resurrect the post', async () => {
  const owner = await account(), post = await create(owner);
  let deleted = false;
  const database = hookedDatabase({ beforeBatch: async () => {
    assert.equal(deleted, false);
    deleted = true;
    await DB.prepare('DELETE FROM forum_posts WHERE id=?').bind(post.id).run();
  } });
  const rejection = expect(await update(owner, post, draft('Deleted post edit'), { database }), 404);
  assert.equal(deleted, true);
  assert.equal(Object.hasOwn(rejection, 'current'), false);
  assert.deepEqual(await row(post), { record: null, tags: [] });
  expect(await api(owner, postPath(post)), 404);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('transaction failure rolls back title, body, category, CAS timestamp and all tag replacements', async () => {
  const owner = await account(), post = await create(owner), beforeRow = await row(post);
  const database = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare('INSERT INTO forum_post_tags(post_id,tag) VALUES(?,?)').bind(randomUUID(), 'invalid-foreign-parent'),
  ]) };
  expect(await update(owner, post, { title: 'Rollback edit', body: 'This must fully roll back.', category: 'help', tags: ['rollback'] }, { database }), 500);
  assert.deepEqual(await row(post), beforeRow);
  assert.deepEqual(await get(owner, post), post);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('successful response is its own transaction snapshot even if another edit commits before serialization', async () => {
  const owner = await account(), post = await create(owner);
  const primary = { title: 'First transaction', body: 'First transaction complete body.', category: 'life', tags: ['first', 'stable'] };
  let committedRow;
  const database = hookedDatabase({ afterBatch: async () => {
    committedRow = await row(post);
    await DB.batch([
      DB.prepare('UPDATE forum_posts SET title=?,body=?,category=?,updated_at=? WHERE id=?')
        .bind('Subsequent transaction', 'Subsequent complete body.', 'help', committedRow.record.updated_at + 1, post.id),
      DB.prepare('DELETE FROM forum_post_tags WHERE post_id=?').bind(post.id),
      DB.prepare('INSERT INTO forum_post_tags(post_id,tag) VALUES(?,?)').bind(post.id, 'subsequent'),
    ]);
  } });
  const saved = expect(await update(owner, post, primary, { database })).post;
  assert.deepEqual(saved, { ...post, ...primary, tags: [...primary.tags].sort(), updatedAt: committedRow.record.updated_at });
  assert.equal((await get(owner, post)).title, 'Subsequent transaction');
  assert.deepEqual((await get(owner, post)).tags, ['subsequent']);
});
