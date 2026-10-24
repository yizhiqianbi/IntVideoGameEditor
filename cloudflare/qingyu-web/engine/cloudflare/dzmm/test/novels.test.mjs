import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Exercise the authenticated router against disposable, transactional D1.
// No live providers, remote bindings, or ordinary development store are used.
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { exportDzmmNovelJson, parseDzmmNovelImport } = await tsImport('../../../src/lib/dzmm-novels.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
const origin = 'https://novels.example.test';
let store, DB;

function memoryStore(name) {
  return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated novels store")}}', d1Databases: { DB: name } }));
}
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => { store = memoryStore('private-novel-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });

class Client {
  cookie = '';
  accountId;
  ip = randomUUID();
  async request(path, { method = 'GET', body, raw, headers = {}, database = DB } = {}) {
    const request = new Request(`${origin}${path}`, { method, headers: {
      Origin: origin, 'CF-Connecting-IP': this.ip, Cookie: this.cookie,
      ...(body === undefined && raw === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const response = await fetchRequest(request, { DB: database, APP_ORIGINS: origin });
    const cookie = response.headers.get('Set-Cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data?.user?.id) this.accountId = data.user.id;
    return { status: response.status, data };
  }
}
function expect(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
async function guest() { const client = new Client(); expect(await client.request('/v1/auth/guest', { method: 'POST' })); return client; }
function draft(id = randomUUID()) {
  return { id, title: ' 雾港纪事 ', synopsis: '穿过晨雾，寻找遗失的地图。', type: 'novel', tags: ['原创', '冒险'],
    notes: '保留每个决定造成的后果。', outline: '一：抵达港口。\n二：寻找地图。', chapters: [
      { id: 'arrival', title: '第一章：晨雾', content: '  旅人抵达雾港。\n\n海面闪着银光 🌊。\n' },
      { id: 'blank', title: '', content: '' },
      { id: 'map', title: '地图', content: '“你要寻找什么？”\n旅人答：A map, please.\t' },
    ] };
}
function cast(name = '雾港地图员') {
  return [{ id: 'map-reader', name, avatar: 'https://example.test/avatar.png', description: '  成年地图员。\n保留空格与🙂  ',
    personality: '先核对证据，再作判断。', scenario: '港口刚开门。', dialogue: '“先看测量日期。”', liveVoice: 'Tina' }];
}
function body(client, work, version) { return { accountId: client.accountId, work, ...(version === undefined ? {} : { version }) }; }
async function create(client, work = draft()) { return expect(await client.request('/v1/novels', { method: 'POST', body: body(client, work) }), 201); }
async function get(client, id) { return expect(await client.request(`/v1/novels/${id}`)); }
async function save(client, work, version) { return client.request(`/v1/novels/${work.id}`, { method: 'PUT', body: body(client, work, version) }); }
function asDraft(detail) { const { version, createdAt, updatedAt, ...work } = detail.work; return { ...work, chapters: detail.chapters.map(({ id, title, content }) => ({ id, title, content })) }; }

test('additive private-novel migration preserves existing user, account version and conversation data', async () => {
  const migrationStore = memoryStore('private-novel-migration');
  try {
    const database = await migrationStore.getD1Database('DB');
    await migrate(database, migrations.filter(file => file < '0021_private_novels.sql'));
    const userId = randomUUID();
    await database.batch([
      database.prepare('INSERT INTO users(id,nickname,is_guest,version,created_at) VALUES(?,?,1,7,123)').bind(userId, '原始用户'),
      database.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,?,?,?,456)')
        .bind(userId, 'old-chat', 'qy-shiyu', '已有会话'),
      database.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,?,?,?,?,0)')
        .bind(userId, 'old-chat', 'old-message', 'assistant', '已有正文。'),
    ]);
    const before = await database.batch([
      database.prepare('SELECT * FROM users'), database.prepare('SELECT * FROM conversations'), database.prepare('SELECT * FROM messages'),
    ]);
    await migrate(database, ['0021_private_novels.sql']);
    const after = await database.batch([
      database.prepare('SELECT * FROM users'), database.prepare('SELECT * FROM conversations'), database.prepare('SELECT * FROM messages'),
    ]);
    assert.deepEqual(after.map(result => result.results), before.map(result => result.results));
    assert.deepEqual((await database.prepare('SELECT * FROM novels').all()).results, []);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await migrationStore.dispose(); }
});
test('additive cast migration preserves existing novels and chapters with an empty JSON default', async () => {
  const migrationStore = memoryStore('private-novel-cast-migration');
  try {
    const database = await migrationStore.getD1Database('DB');
    await migrate(database, migrations.filter(file => file < '0031_novel_characters.sql'));
    const accountId = randomUUID();
    await database.batch([
      database.prepare('INSERT INTO users(id,nickname,is_guest,version,created_at) VALUES(?,?,1,7,123)').bind(accountId, '已有作者'),
      database.prepare(`INSERT INTO novels(user_id,id,title,synopsis,type,tags_json,notes,outline,version,mutation_token,created_at,updated_at)
        VALUES(?, 'old-work', '已有小说', '旧简介', 'novel', '[]', '作者备注', '旧大纲', 3, 'old-token', 123, 456)`).bind(accountId),
      database.prepare(`INSERT INTO novel_chapters(user_id,work_id,id,title,content,position,word_count,version,created_at,updated_at)
        VALUES(?, 'old-work', 'old-chapter', '已有章', '已有正文🌊', 0, 6, 2, 123, 456)`).bind(accountId),
    ]);
    const before = await database.batch([database.prepare('SELECT * FROM novels'), database.prepare('SELECT * FROM novel_chapters'), database.prepare('SELECT * FROM users')]);
    await migrate(database, ['0031_novel_characters.sql']);
    const after = await database.batch([database.prepare('SELECT * FROM novels'), database.prepare('SELECT * FROM novel_chapters'), database.prepare('SELECT * FROM users')]);
    assert.deepEqual(after[0].results, before[0].results.map(row => ({ ...row, characters_json: '[]' })));
    assert.deepEqual(after.slice(1).map(result => result.results), before.slice(1).map(result => result.results));
    for (const invalid of ['{}', 'broken', JSON.stringify(Array.from({ length: 31 }, () => ({})))]) {
      await assert.rejects(database.prepare('UPDATE novels SET characters_json=?').bind(invalid).run(), /CHECK constraint failed/);
    }
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await migrationStore.dispose(); }
});

test('novel endpoints require a session and reject stale-account mutations without changing records', async () => {
  const anonymous = new Client();
  for (const [path, method] of [['/v1/novels', 'GET'], ['/v1/novels', 'POST'], ['/v1/novels/missing', 'GET'], ['/v1/novels/missing', 'PUT'], ['/v1/novels/missing', 'DELETE']]) {
    expect(await anonymous.request(path, { method, ...(method === 'GET' ? {} : { body: {} }) }), 401);
  }
  const client = await guest(), other = await guest(), work = draft();
  const original = await create(client, work);
  for (const [path, method, payload] of [
    ['/v1/novels', 'POST', { work: draft() }],
    [`/v1/novels/${work.id}`, 'PUT', { work, version: 1 }],
    [`/v1/novels/${work.id}`, 'DELETE', { version: 1 }],
  ]) {
    const response = await client.request(path, { method, body: { accountId: other.accountId, ...payload } });
    expect(response, 401); assert.equal(response.data.accountId, client.accountId);
  }
  expect(await client.request('/v1/novels', { method: 'POST', body: { work: draft() } }), 401);
  assert.deepEqual(await get(client, work.id), original);
});

test('two accounts cannot read, overwrite or delete each other and may own the same IDs independently', async () => {
  const owner = await guest(), other = await guest(), work = draft();
  const ownerSaved = await create(owner, work);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await other.request(`/v1/novels/${work.id}`, { method,
      ...(method === 'GET' ? {} : { body: method === 'PUT' ? body(other, work, 1) : { accountId: other.accountId, version: 1 } }) });
    expect(response, 404); assert.equal(response.data.accountId, other.accountId);
    assert.equal(Object.hasOwn(response.data, 'current'), false);
  }
  assert.deepEqual(expect(await other.request('/v1/novels')).works, []);
  await assert.rejects(DB.prepare(`INSERT INTO novel_chapters(user_id,work_id,id,title,content,position,word_count,version,created_at,updated_at)
    VALUES(?,?,?,'','',0,0,1,0,0)`).bind(other.accountId, work.id, 'foreign-parent').run(), /FOREIGN KEY constraint failed/);
  const own = { ...work, title: '另一账户的私人故事', type: 'story', chapters: [{ id: 'arrival', title: '同名章', content: '另一份正文' }] };
  await create(other, own);
  assert.equal((await get(other, work.id)).chapters[0].content, '另一份正文');
  assert.deepEqual(await get(owner, work.id), ownerSaved);
  expect(await other.request(`/v1/novels/${work.id}`, { method: 'DELETE', body: { accountId: other.accountId, version: 1 } }));
  assert.deepEqual(await get(owner, work.id), ownerSaved);
});

test('private work metadata, whitespace, Unicode and blank chapters survive reopening with accurate summaries', async () => {
  const client = await guest(), work = draft();
  const stateBefore = expect(await client.request('/v1/state'));
  const saved = await create(client, work);
  assert.equal(saved.accountId, client.accountId);
  assert.deepEqual(asDraft(saved), work);
  assert.equal(saved.work.version, 1);
  assert.ok(saved.work.createdAt > 0);
  assert.deepEqual(saved.chapters.map(chapter => chapter.position), [0, 1, 2]);
  assert.ok(saved.chapters.every(chapter => chapter.version === 1 && chapter.workId === work.id));
  const reopened = new Client(); reopened.cookie = client.cookie;
  assert.deepEqual(await get(reopened, work.id), saved);
  const list = expect(await client.request('/v1/novels'));
  assert.equal(list.accountId, client.accountId);
  assert.equal(list.works[0].chapterCount, 3);
  assert.equal(list.works[0].wordCount, work.chapters.reduce((sum, chapter) => sum + (chapter.content.match(/\S/gu)?.length ?? 0), 0));
  assert.equal(Object.hasOwn(list.works[0], 'chapters'), false);
  assert.deepEqual(expect(await client.request('/v1/state')), stateBefore, 'Novel writes must not consume the chat-account version or alter its state.');
});
test('cast profiles survive list, reopening and import while legacy saves preserve them unless explicitly cleared', async () => {
  const client = await guest(), legacy = draft(), work = { ...legacy, characters: cast() };
  const saved = await create(client, work);
  assert.deepEqual(asDraft(saved), work);
  assert.deepEqual(expect(await client.request('/v1/novels')).works[0].characters, work.characters);
  const reopened = new Client(); reopened.cookie = client.cookie;
  assert.deepEqual((await get(reopened, work.id)).work.characters, work.characters);
  const preserved = expect(await save(client, { ...legacy, title: '旧页面改的标题' }, 1));
  assert.deepEqual(preserved.work.characters, work.characters);
  assert.equal(preserved.work.version, 2);
  assert.deepEqual(preserved.chapters, saved.chapters);
  const imported = parseDzmmNovelImport(exportDzmmNovelJson(asDraft(preserved)), { format: 'json' });
  assert.notEqual(imported.characters[0].id, work.characters[0].id);
  assert.equal(imported.characters[0].description, work.characters[0].description);
  assert.deepEqual(asDraft(await create(client, imported)), imported);
  assert.deepEqual(await get(client, work.id), preserved);
  const cleared = expect(await save(client, { ...asDraft(preserved), characters: [] }, 2));
  assert.equal(Object.hasOwn(cleared.work, 'characters'), false);
  assert.equal((await DB.prepare('SELECT characters_json FROM novels WHERE user_id=? AND id=?').bind(client.accountId, work.id).first()).characters_json, '[]');
  assert.deepEqual((await get(client, imported.id)).work.characters, imported.characters);
});
test('cast IDs and updates are private to each account and work', async () => {
  const owner = await guest(), other = await guest(), sharedId = randomUUID();
  const left = await create(owner, { ...draft(sharedId), characters: cast('左侧作者的人物') });
  const right = await create(other, { ...draft(sharedId), characters: cast('右侧作者的人物') });
  const separate = await create(owner, { ...draft(), characters: cast('同一作者的另一部作品人物') });
  const changed = { ...asDraft(left), characters: cast('更新后的左侧人物') };
  assert.deepEqual(expect(await save(owner, changed, 1)).work.characters, changed.characters);
  assert.deepEqual(await get(other, sharedId), right);
  assert.deepEqual(await get(owner, separate.work.id), separate);
  expect(await other.request(`/v1/novels/${separate.work.id}`), 404);
});

test('whole-work save atomically adds, removes and reorders chapters while preserving unchanged chapter versions', async () => {
  const client = await guest(), work = draft(), saved = await create(client, work);
  const byId = new Map(saved.chapters.map(chapter => [chapter.id, chapter]));
  const next = { ...work, title: '新作品标题', notes: '新的创作备注', chapters: [
    work.chapters[2], { ...work.chapters[0], content: `${work.chapters[0].content}第二段正文。` },
    { id: 'new', title: '', content: '' },
  ] };
  const updated = expect(await save(client, next, 1));
  assert.deepEqual(asDraft(updated), next);
  assert.equal(updated.work.version, 2);
  assert.deepEqual(updated.chapters.map(chapter => [chapter.id, chapter.position, chapter.version]), [['map', 0, 2], ['arrival', 1, 2], ['new', 2, 1]]);
  assert.equal(updated.chapters[0].createdAt, byId.get('map').createdAt);
  assert.equal(updated.chapters[1].createdAt, byId.get('arrival').createdAt);
  const metadataOnly = { ...next, synopsis: '仅改作品简介。' };
  const unchangedChapters = expect(await save(client, metadataOnly, 2));
  assert.equal(unchangedChapters.work.version, 3);
  assert.deepEqual(unchangedChapters.chapters, updated.chapters);
  assert.deepEqual(await get(client, work.id), unchangedChapters);
  const cleared = expect(await save(client, { ...metadataOnly, chapters: [] }, 3));
  assert.deepEqual(cleared.chapters, []);
  assert.equal(expect(await client.request('/v1/novels')).works[0].chapterCount, 0);
  assert.equal(expect(await client.request('/v1/novels')).works[0].wordCount, 0);
});

test('duplicate creation and stale save/delete return only the current owned snapshot without changing any chapter', async () => {
  const client = await guest(), work = draft(), first = await create(client, work);
  const duplicate = await client.request('/v1/novels', { method: 'POST', body: body(client, { ...work, chapters: [{ id: 'injected', title: '', content: '不可插入' }] }) });
  expect(duplicate, 409); assert.deepEqual(duplicate.data.current, first);
  const next = { ...work, title: '胜者标题', chapters: [{ id: 'winner', title: '胜者章', content: '完整的新正文' }] };
  const current = expect(await save(client, next, 1));
  const stale = await save(client, { ...work, title: '过期标题', chapters: [{ id: 'stale', title: '', content: '不能落库' }] }, 1);
  expect(stale, 409); assert.deepEqual(stale.data.current, current);
  const deletion = await client.request(`/v1/novels/${work.id}`, { method: 'DELETE', body: { accountId: client.accountId, version: 1 } });
  expect(deletion, 409); assert.deepEqual(deletion.data.current, current);
  assert.deepEqual(await get(client, work.id), current);
});

test('two same-version concurrent saves have one complete winner and one conflict, with no mixed chapters', async () => {
  const client = await guest(), work = draft(); await create(client, work);
  const candidates = ['left', 'right'].map(name => ({ ...work, title: `${name} title`, characters: cast(`${name} character`), chapters: [
    { id: `${name}-one`, title: name, content: `${name} first` }, { id: `${name}-two`, title: name, content: `${name} second` },
  ] }));
  const responses = await Promise.all(candidates.map(candidate => save(client, candidate, 1)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winnerIndex = responses.findIndex(response => response.status === 200), winner = responses[winnerIndex].data;
  assert.deepEqual(asDraft(winner), candidates[winnerIndex]);
  assert.deepEqual(responses[1 - winnerIndex].data.current, winner);
  assert.deepEqual(await get(client, work.id), winner);
  assert.equal(winner.work.version, 2);
});

test('same-version save/delete race cannot produce an orphan chapter or delete an updated version', async () => {
  const client = await guest(), work = draft(); await create(client, work);
  const next = { ...work, chapters: [{ id: 'new-only', title: '新章', content: '只属于新版本。' }] };
  const [update, deletion] = await Promise.all([
    save(client, next, 1),
    client.request(`/v1/novels/${work.id}`, { method: 'DELETE', body: { accountId: client.accountId, version: 1 } }),
  ]);
  if (update.status === 200) {
    expect(deletion, 409); assert.deepEqual(deletion.data.current, update.data);
    assert.deepEqual(await get(client, work.id), update.data);
  } else {
    expect(update, 404); expect(deletion);
    expect(await client.request(`/v1/novels/${work.id}`), 404);
    assert.deepEqual((await DB.prepare('SELECT * FROM novel_chapters WHERE user_id=? AND work_id=?').bind(client.accountId, work.id).all()).results, []);
  }
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('transaction failure rolls back novel metadata, version, token and chapter changes for creation and replacement', async () => {
  const client = await guest(), work = draft(), initial = await create(client, work);
  const originalRow = await DB.prepare('SELECT * FROM novels WHERE user_id=? AND id=?').bind(client.accountId, work.id).first();
  const broken = { prepare: sql => DB.prepare(sql), batch: statements => DB.batch([...statements,
    DB.prepare(`INSERT INTO novel_chapters(user_id,work_id,id,title,content,position,word_count,version,created_at,updated_at)
      VALUES(?,?,?,'','',100,0,1,0,0)`).bind(client.accountId, work.id, randomUUID()),
  ]) };
  const next = { ...work, title: '必须回滚', characters: cast('不能保存的人物'), chapters: [{ id: 'rollback', title: '', content: '不能留下一部分正文' }] };
  const failed = await client.request(`/v1/novels/${work.id}`, { method: 'PUT', body: body(client, next, 1), database: broken });
  expect(failed, 500); assert.equal(failed.data.accountId, client.accountId);
  assert.deepEqual(await get(client, work.id), initial);
  assert.deepEqual(await DB.prepare('SELECT * FROM novels WHERE user_id=? AND id=?').bind(client.accountId, work.id).first(), originalRow);
  const importedId = randomUUID();
  expect(await client.request('/v1/novels', { method: 'POST', body: body(client, { ...next, id: importedId }), database: broken }), 500);
  expect(await client.request(`/v1/novels/${importedId}`), 404);
});

test('invalid or oversized snapshots never partially change metadata or chapters', async () => {
  const client = await guest(), work = draft(), saved = await create(client, work);
  const invalid = [
    { ...work, title: '   ' }, { ...work, title: 'x'.repeat(121) }, { ...work, type: 'poem' },
    { ...work, synopsis: 'x'.repeat(4001) }, { ...work, notes: 'x'.repeat(8001) }, { ...work, outline: 'x'.repeat(20001) },
    { ...work, tags: Array.from({ length: 21 }, (_, i) => String(i)) }, { ...work, tags: ['x'.repeat(41)] },
    { ...work, tags: ['same', 'same'] }, { ...work, notes: 'hidden\0text' }, { ...work, id: 'bad/id' },
    { ...work, chapters: [{ id: 'one', title: '', content: 'x'.repeat(50001) }] },
    { ...work, chapters: [{ id: 'one', title: 'x'.repeat(121), content: '' }] },
    { ...work, chapters: [{ id: 'one', title: '', content: 'hidden\0text' }] },
    { ...work, chapters: [{ id: 'same', title: '', content: '' }, { id: 'same', title: '', content: '' }] },
    { ...work, chapters: Array.from({ length: 101 }, (_, i) => ({ id: `chapter-${i}`, title: '', content: '' })) },
    { ...work, chapters: Array.from({ length: 11 }, (_, i) => ({ id: `chapter-${i}`, title: '', content: '中'.repeat(46000) })) },
  ];
  for (const candidate of invalid) {
    const response = await client.request(`/v1/novels/${work.id}`, { method: 'PUT', body: body(client, candidate, 1) });
    expect(response, 400); assert.equal(response.data.accountId, client.accountId);
  }
  for (const version of [undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER]) expect(await save(client, work, version), 400);
  expect(await save(client, { ...work, id: randomUUID() }, 1), 404);
  expect(await client.request(`/v1/novels/${work.id}`, { method: 'PUT', body: body(client, { ...work, id: 'wrong-path' }, 1) }), 400);
  expect(await client.request(`/v1/novels/${work.id}`, { method: 'PUT', body: { ...body(client, work, 1), userId: 'forged' } }), 400);
  expect(await client.request(`/v1/novels/${work.id}`, { method: 'PUT', raw: '{broken' }), 400);
  const payload = body(client, work, 1);
  expect(await client.request(`/v1/novels/${work.id}`, { method: 'PUT', body: payload, headers: { 'Content-Length': '1600001' } }), 413);
  expect(await client.request(`/v1/novels/${work.id}`, { method: 'PUT', raw: JSON.stringify({ ...payload, padding: 'x'.repeat(1600000) }) }), 413);
  assert.deepEqual(await get(client, work.id), saved);
});
test('invalid cast snapshots never mutate the current profiles, manuscript or CAS version', async () => {
  const client = await guest(), work = { ...draft(), characters: cast() }, saved = await create(client, work), profile = work.characters[0];
  const invalid = [null, {}, [null], [profile, profile], [{ ...profile, id: 'invalid/id' }], [{ ...profile, name: '  ' }],
    [{ ...profile, avatar: 'https:' }], [{ ...profile, avatar: 'javascript:alert(1)' }], [{ ...profile, avatar: 'http://example.test/avatar.png' }],
    [{ ...profile, description: 'x'.repeat(2001) }], [{ ...profile, personality: 'hidden\0text' }],
    [{ ...profile, liveVoice: 'unsupported' }], [{ ...profile, ownerId: 'forged' }], Array.from({ length: 31 }, (_, i) => ({ ...profile, id: `cast-${i}` }))];
  for (const characters of invalid) {
    const response = await save(client, { ...work, title: '不能保存的标题', characters }, 1);
    expect(response, 400); assert.equal(response.data.accountId, client.accountId);
  }
  assert.deepEqual(await get(client, work.id), saved);
});

test('near-limit imported JSON round-trips as a new atomic work without touching its source', async () => {
  const client = await guest();
  const work = { ...draft(), chapters: Array.from({ length: 100 }, (_, i) => ({ id: `bulk-${i}`, title: `第${i + 1}章`,
    content: `${i}:` + '完整正文🌊\n'.repeat(650) })) };
  const source = await create(client, work);
  const imported = parseDzmmNovelImport(exportDzmmNovelJson(work), { format: 'json' });
  assert.notEqual(imported.id, work.id);
  const saved = await create(client, imported);
  assert.deepEqual(asDraft(await get(client, imported.id)), imported);
  assert.deepEqual(saved.chapters.map(chapter => chapter.content), work.chapters.map(chapter => chapter.content));
  assert.deepEqual(await get(client, work.id), source);
  assert.equal(saved.chapters.length, 100);
  assert.equal(expect(await client.request('/v1/novels')).works.length, 2);
});

test('novel reads avoid loading chat state and successful deletion cascades only its own chapters', async () => {
  const client = await guest(), first = await create(client), second = await create(client);
  const queries = [];
  const spy = { prepare(sql) { queries.push(sql); return DB.prepare(sql); }, batch: statements => DB.batch(statements) };
  expect(await client.request('/v1/novels', { database: spy }));
  expect(await client.request(`/v1/novels/${first.work.id}`, { database: spy }));
  assert.ok(!queries.some(sql => /\b(?:conversations|messages|favorites|characters|preferences)\b/.test(sql)), queries.join('\n'));
  const deleted = expect(await client.request(`/v1/novels/${first.work.id}`, { method: 'DELETE', body: { accountId: client.accountId, version: 1 } }));
  assert.deepEqual(deleted, { accountId: client.accountId, deleted: true });
  expect(await client.request(`/v1/novels/${first.work.id}`), 404);
  assert.deepEqual(await get(client, second.work.id), second);
  assert.deepEqual((await DB.prepare('SELECT * FROM novel_chapters WHERE user_id=? AND work_id=?').bind(client.accountId, first.work.id).all()).results, []);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});
