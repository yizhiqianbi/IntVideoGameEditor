import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

const base = process.env.DZMM_TEST_BASE_URL;
assert.ok(base, 'Run through the disposable Worker harness.');
const cwd = dirname(dirname(fileURLToPath(import.meta.url))), tag = `cursor-${randomUUID().slice(0, 24)}`;
let owner, other;
const posts = Array.from({ length: 61 }, (_, i) => ({ id: `48484848-4848-4484-8484-${String(1000 - i).padStart(12, '0')}`, createdAt: 1791450000000 - Math.floor(i / 4) * 1000 }));
const replies = Array.from({ length: 53 }, (_, i) => ({ id: `59595959-5959-4595-8595-${String(i + 1).padStart(12, '0')}`, createdAt: 1791450000000 + Math.floor(i / 4) * 1000 }));
async function sql(command) {
  const config = process.env.DZMM_TEST_CONFIG_PATH, persist = process.env.DZMM_TEST_PERSIST_PATH;
  assert.equal(config, join(cwd, 'wrangler.jsonc'));
  assert.ok(typeof persist === 'string' && resolve(persist).startsWith(join(tmpdir(), 'dzmm-worker-test-')));
  await promisify(execFile)(process.execPath, [join(cwd, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--local', '--config', config, '--persist-to', persist, '--command', command], { cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }, maxBuffer: 5_000_000 });
}
async function request(client, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Origin: 'http://127.0.0.1:3010', ...(client?.cookie ? { Cookie: client.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function register(nickname) {
  const result = await request(null, '/v1/auth/register', 'POST', { email: `${randomUUID()}@cursor.example.test`, password: 'Original-forum-cursor-test-2026!', nickname });
  assert.equal(result.status, 201); return { cookie: result.cookie, user: result.data.user };
}
const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; };
const topics = cursor => `/v1/forum/posts?limit=20&tag=${tag}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
const detail = (postId, cursor) => `/v1/forum/posts/${postId}?limit=20${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
before(async () => {
  owner = await register('原创游标作者'); other = await register('原创游标读者');
  await sql(posts.map((post, i) => `INSERT INTO forum_posts(id,user_id,title,body,category,created_at,updated_at) VALUES('${post.id}','${owner.user.id}','原创阅览笔记${i + 1}','普通原创阅读活动${i + 1}','life',${post.createdAt},${post.createdAt}); INSERT INTO forum_post_tags(post_id,tag) VALUES('${post.id}','${tag}');`).join('\n') + '\n' + replies.map((reply, i) => `INSERT INTO forum_replies(id,post_id,user_id,body,created_at) VALUES('${reply.id}','${posts[30].id}','${owner.user.id}','原创回复${i + 1}',${reply.createdAt});`).join('\n'));
});
after(async () => { if (owner && other) await sql(`DELETE FROM users WHERE id IN ('${owner.user.id}','${other.user.id}');`); });

test('forum topic cursor survives leading and boundary deletion, newer insertion, and timestamp ties', async () => {
  const first = expect(await request(owner, topics('')));
  assert.deepEqual(first.posts.map(p => p.id), posts.slice(0, 20).map(p => p.id));
  assert.equal(typeof first.nextCursor, 'string');
  expect(await request(owner, `/v1/forum/posts/${posts[0].id}`, 'DELETE'));
  expect(await request(owner, `/v1/forum/posts/${posts[19].id}`, 'DELETE'));
  const newest = expect(await request(owner, '/v1/forum/posts', 'POST', { title: '原创新阅览主题', body: '周末新阅读活动', category: 'life', tags: [tag] }), 201).post;
  const second = expect(await request(owner, topics(first.nextCursor)));
  assert.equal(second.offset, 20); assert.deepEqual(second.posts.map(p => p.id), posts.slice(20, 40).map(p => p.id));
  const third = expect(await request(owner, topics(second.nextCursor)));
  const last = expect(await request(owner, topics(third.nextCursor)));
  assert.deepEqual([...second.posts, ...third.posts, ...last.posts].map(p => p.id), posts.slice(20).map(p => p.id));
  assert.equal(last.posts.length, 1); assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null);
  assert.ok(![...second.posts, ...third.posts, ...last.posts].some(p => p.id === newest.id));
});

test('forum reply cursor survives earlier and boundary deletion and reaches new tail replies once', async () => {
  const postId = posts[30].id, first = expect(await request(owner, detail(postId, '')));
  assert.deepEqual(first.replies.map(r => r.id), replies.slice(0, 20).map(r => r.id));
  expect(await request(owner, `/v1/forum/replies/${replies[0].id}`, 'DELETE'));
  expect(await request(owner, `/v1/forum/replies/${replies[19].id}`, 'DELETE'));
  const newest = expect(await request(owner, `/v1/forum/posts/${postId}/replies`, 'POST', { body: '原创新尾部回复' }), 201).reply;
  const second = expect(await request(owner, detail(postId, first.nextCursor)));
  const last = expect(await request(owner, detail(postId, second.nextCursor)));
  assert.equal(second.offset, 20); assert.deepEqual(second.replies.map(r => r.id), replies.slice(20, 40).map(r => r.id));
  assert.deepEqual(last.replies.map(r => r.id), [...replies.slice(40).map(r => r.id), newest.id]);
  assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null);
});

test('forum cursors reject changed accounts, filters, parents, malformed positions and offset mixing', async () => {
  const listing = expect(await request(owner, topics(''))), cursor = listing.nextCursor;
  expect(await request(other, topics(cursor)), 400);
  for (const query of ['category=life', 'q=原创', 'tag=another']) {
    const url = new URL(`${base}${topics(cursor)}`); const [key, value] = query.split('='); url.searchParams.set(key, value);
    expect(await request(owner, url.pathname + url.search), 400);
  }
  expect(await request(owner, `${topics(cursor)}&offset=1`), 400);
  expect(await request(owner, topics('not-a-valid-cursor')), 400);
  const repliesPage = expect(await request(owner, detail(posts[30].id, '')));
  expect(await request(owner, detail(posts[31].id, repliesPage.nextCursor)), 400);
  expect(await request(owner, detail(posts[30].id, cursor)), 400);
});

test('legacy forum offset readers retain their page layout without cursor fields', async () => {
  const first = expect(await request(owner, topics())), second = expect(await request(owner, `${topics()}&offset=20`));
  assert.equal(Object.hasOwn(first, 'nextCursor'), false); assert.equal(second.offset, 20);
  assert.equal(first.posts.length, 20); assert.equal(second.posts.length, 20);
  const repliesPage = expect(await request(owner, `${detail(posts[30].id)}&offset=20`));
  assert.equal(Object.hasOwn(repliesPage, 'nextCursor'), false); assert.equal(repliesPage.offset, 20);
});
