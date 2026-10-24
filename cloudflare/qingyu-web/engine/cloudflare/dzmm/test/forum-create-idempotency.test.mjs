import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { build } from 'esbuild';
import { splitSqlStatements } from './sql-migrations.mjs';

async function loadRouter() {
  if (!process.env.DZMM_FORUM_SOURCE) return tsImport('../src/app.ts', import.meta.url);
  const forumPath = fileURLToPath(new URL('../src/forum.ts', import.meta.url));
  const contents = await readFile(resolve(process.env.DZMM_FORUM_SOURCE), 'utf8');
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/app.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    plugins: [{ name: 'sealed-forum-create-baseline', setup(builder) {
      builder.onLoad({ filter: /[/\\]forum\.ts$/ }, args => args.path === forumPath
        ? { contents, loader: 'ts', resolveDir: dirname(forumPath) } : null);
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const { fetchRequest } = await loadRouter();
const origin = 'https://forum-create.example.test';
const cases = [];
let store, DB;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated forum creation store")}}',
    d1Databases: { DB: `forum-create-${randomUUID()}` } }));
  DB = await store.getD1Database('DB');
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
    const source = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => DB.prepare(sql)));
  }
});
after(async () => {
  await store?.dispose();
  if (process.env.DZMM_FORUM_CREATE_REPORT) {
    const target = resolve(process.env.DZMM_FORUM_CREATE_REPORT);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ at: new Date().toISOString(), tests: cases.length,
      pass: cases.filter(item => item.pass).length, fail: cases.filter(item => !item.pass).length,
      cases, actualAuthenticatedRouter: true, actualWorkerdD1: true, externalModelCalls: 0,
      productionOperations: 0, disposed: true,
      evidenceScope: 'Actual imported backend router with its authentication and validation; transactional SQLite D1 provided by an ephemeral Miniflare/workerd store. No browser, production writes or real provider calls.',
      sealedSource: process.env.DZMM_FORUM_SOURCE ?? null }, null, 2) + '\n');
  }
});
function check(name, run) {
  test(name, async () => {
    try { await run(); cases.push({ name, pass: true }); }
    catch (failure) { cases.push({ name, pass: false, error: String(failure) }); throw failure; }
  });
}
async function account(role = 'user', isGuest = false) {
  const user = { id: randomUUID(), nickname: 'Original forum creation author', role, isGuest };
  const token = randomBytes(32).toString('hex'), now = Date.now();
  await DB.batch([
    DB.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,?,?,?)')
      .bind(user.id, `${randomUUID()}@forum-create.example.test`, user.nickname, isGuest ? 1 : 0, role, now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(token).digest('hex'), user.id, now + 86400000, now),
  ]);
  return { user, token, ip: randomUUID() };
}
async function api(actor, path = '/v1/forum/posts', { method = 'POST', body, database = DB } = {}) {
  const response = await fetchRequest(new Request(`${origin}${path}`, { method, headers: {
    Origin: origin, 'CF-Connecting-IP': actor?.ip ?? randomUUID(),
    ...(actor ? { Cookie: `qingyu_session=${actor.token}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { DB: database, APP_ORIGINS: origin });
  return { status: response.status, data: await response.json() };
}
const draft = (changes = {}) => ({ title: 'Original lighthouse chart 🧭',
  body: 'Compare the dated chart with the lighthouse log.\nKeep the confirmed notes.',
  category: 'characters', tags: ['original', 'navigation'], ...changes });
const intent = (actor, changes = {}) => draft({ accountId: actor.user.id, requestId: randomUUID(), ...changes });
function expect(response, status = 201) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const rateKey = actor => createHash('sha256').update(`forum-create-account:${actor.user.id}`).digest('hex');
async function quota(actor) { return (await DB.prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(rateKey(actor)).first())?.count ?? 0; }
async function snapshot(actor) {
  const posts = (await DB.prepare('SELECT * FROM forum_posts WHERE user_id=? ORDER BY id').bind(actor.user.id).all()).results;
  const tags = (await DB.prepare('SELECT t.* FROM forum_post_tags t JOIN forum_posts p ON p.id=t.post_id WHERE p.user_id=? ORDER BY t.post_id,t.tag').bind(actor.user.id).all()).results;
  const receipts = (await DB.prepare('SELECT * FROM forum_create_requests WHERE user_id=? ORDER BY request_id').bind(actor.user.id).all()).results;
  return { posts, tags, receipts, createQuota: await quota(actor) };
}
const postPath = post => `/v1/forum/posts/${post.id}`;
function hookedDatabase({ afterBatch, failBatch } = {}) {
  return { prepare: sql => DB.prepare(sql), batch: async statements => {
    const results = await DB.batch(failBatch ? [...statements,
      DB.prepare("INSERT INTO forum_post_tags(post_id,tag) VALUES('missing-create-parent','invalid')")] : statements);
    await afterBatch?.();
    return results;
  } };
}

check('committed creation with a discarded ACK replays one post, one receipt and one tag set', async () => {
  const owner = await account(), body = intent(owner);
  const committed = expect(await api(owner, undefined, { body })).post;
  // Deliberately discard this response, as the client would after a transport loss.
  const before = await snapshot(owner);
  const replay = expect(await api(owner, undefined, { body })).post;
  assert.deepEqual(replay, committed);
  assert.deepEqual(await snapshot(owner), before);
  assert.equal(before.posts.length, 1); assert.equal(before.receipts.length, 1); assert.equal(before.tags.length, 2);
  assert.equal(before.receipts[0].post_id, committed.id); assert.equal(before.createQuota, 1);
});

check('same-key normalization trims text, deduplicates and sorts tags, and canonicalizes UUID case', async () => {
  const owner = await account(), requestId = randomUUID();
  const original = intent(owner, { requestId: requestId.toUpperCase(), title: '  港口目录🧭  ', body: '  第一页\n第二页  ', tags: [' 海图 ', '原创', '海图'] });
  const saved = expect(await api(owner, undefined, { body: original })).post;
  const before = await snapshot(owner);
  const replay = expect(await api(owner, undefined, { body: { ...original, requestId, title: '港口目录🧭', body: '第一页\n第二页', tags: ['原创', '海图'] } })).post;
  assert.deepEqual(replay, saved); assert.deepEqual(await snapshot(owner), before);
  const expectedHash = createHash('sha256').update(JSON.stringify({ title: '港口目录🧭', body: '第一页\n第二页', category: 'characters', tags: ['原创', '海图'].sort() })).digest('hex');
  assert.equal(before.receipts[0].request_fingerprint, expectedHash);
  assert.equal(before.receipts[0].request_id, requestId);
});

check('changed title, body, category or tags under a committed key conflicts without writing', async () => {
  const owner = await account(), body = intent(owner);
  expect(await api(owner, undefined, { body })); const before = await snapshot(owner);
  for (const changes of [{ title: 'Another edition' }, { body: 'Changed evidence.' }, { category: 'life' }, { tags: ['different'] }]) {
    const response = expect(await api(owner, undefined, { body: { ...body, ...changes } }), 409);
    assert.equal(response.code, 'FORUM_CREATE_CONFLICT'); assert.equal(Object.hasOwn(response, 'post'), false);
    assert.deepEqual(await snapshot(owner), before);
  }
});

check('same-key concurrent identical creates have one winner and never duplicate parent or child rows', async () => {
  const owner = await account(), body = intent(owner);
  const responses = await Promise.all(Array.from({ length: 4 }, () => api(owner, undefined, { body })));
  const posts = responses.map(value => expect(value).post);
  for (const post of posts) assert.deepEqual(post, posts[0]);
  const saved = await snapshot(owner);
  assert.equal(saved.posts.length, 1); assert.equal(saved.receipts.length, 1); assert.equal(saved.tags.length, 2); assert.equal(saved.createQuota, 1);
});

check('same-key concurrent different creates return one complete winner and one conflict with no mixed tags', async () => {
  const owner = await account(), requestId = randomUUID();
  const candidates = ['left', 'right'].map(name => intent(owner, { requestId, title: `${name} complete title`, body: `${name} complete body`,
    category: name === 'left' ? 'life' : 'help', tags: [name, `${name}-only`] }));
  const responses = await Promise.all(candidates.map(body => api(owner, undefined, { body })));
  assert.deepEqual(responses.map(value => value.status).sort(), [201, 409]);
  const winnerIndex = responses.findIndex(value => value.status === 201), winner = responses[winnerIndex].data.post;
  assert.equal(responses[1 - winnerIndex].data.code, 'FORUM_CREATE_CONFLICT');
  assert.deepEqual({ title: winner.title, body: winner.body, category: winner.category, tags: [...winner.tags].sort() },
    { title: candidates[winnerIndex].title, body: candidates[winnerIndex].body, category: candidates[winnerIndex].category, tags: [...candidates[winnerIndex].tags].sort() });
  const saved = await snapshot(owner);
  assert.equal(saved.posts.length, 1); assert.equal(saved.receipts.length, 1); assert.equal(saved.tags.length, 2); assert.equal(saved.createQuota, 1);
});

check('creation keys are owner scoped, wrong account assertions cannot post, and guests cannot replay', async () => {
  const owner = await account(), other = await account(), guest = await account('user', true), requestId = randomUUID();
  const first = expect(await api(owner, undefined, { body: intent(owner, { requestId }) })).post;
  const second = expect(await api(other, undefined, { body: intent(other, { requestId }) })).post;
  assert.notEqual(first.id, second.id); assert.equal(second.author.id, other.user.id);
  const before = await snapshot(other);
  const wrong = expect(await api(other, undefined, { body: intent(owner, { requestId }) }), 409);
  assert.equal(wrong.code, 'FORUM_ACCOUNT_CHANGED'); assert.deepEqual(await snapshot(other), before);
  expect(await api(guest, undefined, { body: { ...intent(guest), requestId } }), 403);
  expect(await api(null, undefined, { body: intent(owner) }), 401);
  assert.equal((await snapshot(guest)).posts.length, 0);
});

check('invalid keys and malformed payloads cannot leave a creation receipt or spend create quota', async () => {
  const owner = await account();
  for (const requestId of [null, '', 'bad', 5, {}, [], ' 92929292-9292-4929-8929-929292929292 ']) {
    expect(await api(owner, undefined, { body: intent(owner, { requestId }) }), 400);
  }
  for (const changes of [{ title: '' }, { body: 'bad\0body' }, { category: 'invalid' }, { tags: [''] }, { tags: Array.from({ length: 11 }, (_, i) => String(i)) }]) {
    expect(await api(owner, undefined, { body: intent(owner, changes) }), 400);
  }
  assert.deepEqual(await snapshot(owner), { posts: [], tags: [], receipts: [], createQuota: 0 });
});

check('deleted topics leave a receipt tombstone and a retry cannot revive content or tags', async () => {
  const owner = await account(), body = intent(owner), post = expect(await api(owner, undefined, { body })).post;
  expect(await api(owner, postPath(post), { method: 'DELETE' }), 200);
  const before = await snapshot(owner);
  assert.equal(before.posts.length, 0); assert.equal(before.tags.length, 0); assert.equal(before.receipts.length, 1);
  assert.equal(before.receipts[0].post_id, null);
  const gone = expect(await api(owner, undefined, { body }), 410); assert.equal(gone.code, 'FORUM_CREATE_DELETED');
  assert.deepEqual(await snapshot(owner), before);
  expect(await api(owner, undefined, { body: { ...body, title: 'Changed deleted draft' } }), 409);
  assert.deepEqual(await snapshot(owner), before);
});

check('replay after a later edit returns current topic without overwriting it with original submitted text', async () => {
  const owner = await account(), body = intent(owner), post = expect(await api(owner, undefined, { body })).post;
  const updated = expect(await api(owner, postPath(post), { method: 'PATCH', body: draft({ title: 'Owner corrected date',
    tags: ['verified'], baseUpdatedAt: post.updatedAt }) }), 200).post;
  const before = await snapshot(owner);
  assert.deepEqual(expect(await api(owner, undefined, { body })).post, updated);
  assert.deepEqual(await snapshot(owner), before);
});

check('receipt, post, tags and create quota all roll back when the D1 batch fails', async () => {
  const owner = await account(), body = intent(owner);
  expect(await api(owner, undefined, { body, database: hookedDatabase({ failBatch: true }) }), 500);
  assert.deepEqual(await snapshot(owner), { posts: [], tags: [], receipts: [], createQuota: 0 });
  const post = expect(await api(owner, undefined, { body })).post;
  assert.equal((await snapshot(owner)).receipts[0].post_id, post.id); assert.equal(await quota(owner), 1);
});

check('new creation returns its own transactional snapshot if another edit commits before serialization', async () => {
  const owner = await account(), body = intent(owner); let later;
  const database = hookedDatabase({ afterBatch: async () => {
    const row = await DB.prepare('SELECT id,updated_at FROM forum_posts WHERE user_id=?').bind(owner.user.id).first();
    later = expect(await api(owner, `/v1/forum/posts/${row.id}`, { method: 'PATCH', body: draft({ title: 'Later title', tags: ['later'], baseUpdatedAt: row.updated_at }) }), 200).post;
  } });
  const saved = expect(await api(owner, undefined, { body, database })).post;
  assert.equal(saved.title, body.title); assert.deepEqual([...saved.tags].sort(), [...body.tags].sort());
  assert.equal(later.title, 'Later title'); assert.equal(saved.id, later.id); assert.ok(saved.updatedAt < later.updatedAt);
  assert.deepEqual(expect(await api(owner, postPath(saved), { method: 'GET' }), 200).post, later);
});

check('concurrent recovery at the create ceiling consumes exactly one remaining intent and replay remains available', async () => {
  const owner = await account(), body = intent(owner), now = Date.now();
  await DB.prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,19,?)').bind(rateKey(owner), now).run();
  const responses = await Promise.all(Array.from({ length: 4 }, () => api(owner, undefined, { body })));
  for (const response of responses) expect(response);
  assert.equal(await quota(owner), 20);
  const before = await snapshot(owner);
  expect(await api(owner, undefined, { body: intent(owner) }), 429);
  assert.deepEqual(await snapshot(owner), before);
  const replay = expect(await api(owner, undefined, { body })).post;
  assert.equal(replay.id, responses[0].data.post.id); assert.deepEqual(await snapshot(owner), before);
});

check('an expired create window resets for a new intent without consuming quota for an old replay', async () => {
  const owner = await account(), body = intent(owner);
  expect(await api(owner, undefined, { body }));
  await DB.prepare('UPDATE auth_rate_limits SET count=20,window_start=? WHERE key=?').bind(Date.now() - 600001, rateKey(owner)).run();
  const before = await snapshot(owner);
  expect(await api(owner, undefined, { body })); assert.deepEqual(await snapshot(owner), before);
  expect(await api(owner, undefined, { body: intent(owner) })); assert.equal(await quota(owner), 1);
});

check('old callers without a key remain compatible and deliberate distinct intents may publish identical text', async () => {
  const owner = await account();
  const legacyA = expect(await api(owner, undefined, { body: draft() })).post;
  const legacyB = expect(await api(owner, undefined, { body: draft() })).post;
  const keyedA = expect(await api(owner, undefined, { body: intent(owner) })).post;
  const keyedB = expect(await api(owner, undefined, { body: intent(owner) })).post;
  assert.equal(new Set([legacyA.id, legacyB.id, keyedA.id, keyedB.id]).size, 4);
  const saved = await snapshot(owner); assert.equal(saved.posts.length, 4); assert.equal(saved.receipts.length, 2); assert.equal(saved.createQuota, 4);
});
