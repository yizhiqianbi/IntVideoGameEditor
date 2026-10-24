import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, readdir, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { require as tsxRequire } from 'tsx/cjs/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { handleChatMedia } = tsxRequire('../src/chat-media.ts', import.meta.url);
const BASE = Date.parse('2026-10-14T02:00:00Z'), LIMIT = 2 * 1024 * 1024;
const hash = content => createHash('sha256').update(content).digest('hex');
const artifact = new URL('../../../output/xumeng/iteration/heartbeat-20261014-media-directory/backend-tests.json', import.meta.url);
let store, DB, MEDIA, migrations;
const owners = [], objects = [], observations = [], requests = [];
let modelCalls = 0, providerCalls = 0;
const harnessArtifact = new URL('../../../output/xumeng/iteration/heartbeat-20261014-state-write-ack/diagnostics/media-harness-result.json', import.meta.url);
const harnessAudit = { pid: process.pid, namespace: 'media-directory-' + randomUUID(), storagePath: null, cleanup: null, disposed: false, ownStorageRemoved: false };
let ownedStoragePath;

before(async () => {
  await mkdir(new URL('.', harnessArtifact), { recursive: true });
  ownedStoragePath = await mkdtemp(fileURLToPath(new URL('./media-directory-own-', harnessArtifact)));
  harnessAudit.storagePath = ownedStoragePath;
  harnessAudit.resourcePersistencePath = join(ownedStoragePath, 'persist');
  harnessAudit.resourceTmpPath = join(ownedStoragePath, 'plugin-temp');
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("ordinary isolated media directory")}}',
    d1Databases: { DB: harnessAudit.namespace }, r2Buckets: { MEDIA: harnessAudit.namespace },
    resourcePersistencePath: harnessAudit.resourcePersistencePath, resourceTmpPath: harnessAudit.resourceTmpPath }));
  DB = await store.getD1Database('DB'); MEDIA = await store.getR2Bucket('MEDIA');
  migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(file=>file.endsWith('.sql')).sort();
  assert.ok(migrations.includes('0038_nowpayments_quarterly_membership.sql'), 'Use the current financial schema with preserved monthly and quarterly rights.');
  for (const file of migrations) await DB.batch(splitSqlStatements(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')).filter(sql=>sql.trim()).map(sql=>DB.prepare(sql)));
});

after(async () => {
  try {
    for (const key of objects) await MEDIA.delete(key);
    for (const id of owners) await DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
    const counts = {};
    for (const table of ['users', 'conversations', 'messages', 'chat_media_assets', 'chat_media_usage']) counts[table] = (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
    const r2Objects = (await MEDIA.list()).objects.length;
    assert.deepEqual(counts, { users: 0, conversations: 0, messages: 0, chat_media_assets: 0, chat_media_usage: 0 });
    harnessAudit.cleanup = { counts, r2Objects };
    assert.equal(r2Objects, 0); assert.equal(modelCalls, 0); assert.equal(providerCalls, 0);
    await mkdir(new URL('.', artifact), { recursive: true });
    await writeFile(artifact, JSON.stringify({ layer: 'actual isolated Miniflare D1/R2; ordinary original fixtures; no production',
      migrations, observations, requests, cleanup: { counts, r2Objects }, modelCalls, providerCalls, productionOperations: 0 }, null, 2));
  } finally {
    try { await store?.dispose(); harnessAudit.disposed = true; }
    finally {
      if (ownedStoragePath) {
        await rm(ownedStoragePath, { recursive: true, force: true });
        try { await access(ownedStoragePath); } catch (error) { harnessAudit.ownStorageRemoved = error.code === 'ENOENT'; }
      }
      await writeFile(harnessArtifact, JSON.stringify({ ...harnessAudit, modelCalls, providerCalls, productionOperations: 0 }, null, 2) + '\n');
    }
  }
});

async function fixture() {
  const user = { id: randomUUID(), email: null, nickname: '目录原创隔离验收者', isGuest: false, role: 'user', version: 0 };
  owners.push(user.id);
  const conversationId = randomUUID(), sqlReads = [], projections = {};
  await DB.batch([
    DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,?,?)').bind(user.id, user.nickname, user.role, BASE),
    DB.prepare('INSERT INTO conversations(user_id,id,character_id,title,updated_at) VALUES(?,?,?,?,?)').bind(user.id, conversationId, randomUUID(), '原创星港地图目录', BASE),
  ]);
  const rawStatements = new WeakMap();
  const traced = { prepare(sql) {
    const trace = bindings => { const wrapped = { async first(...args) { sqlReads.push({ sql, bindings }); const result = await DB.prepare(sql).bind(...bindings).first(...args); return projections.first ? projections.first(sql, result) : result; },
      async all(...args) { sqlReads.push({ sql, bindings }); const result = await DB.prepare(sql).bind(...bindings).all(...args); return projections.all ? projections.all(sql, result) : result; },
      async run(...args) { return DB.prepare(sql).bind(...bindings).run(...args); } };
      rawStatements.set(wrapped, DB.prepare(sql).bind(...bindings)); return wrapped;
    };
    return { bind(...bindings) { return trace(bindings); }, ...trace([]) };
  }, batch: statements => DB.batch(statements.map(statement=>rawStatements.get(statement) ?? statement)) };
  return { user, conversationId, sqlReads, projections, env: { DB: traced, MEDIA, CHAT_MEDIA_ENABLED: 'false',
    AI: { async run() { modelCalls++; throw new Error('No model invocation allowed'); } } } };
}

async function seed(f, count, { content = index => `原创星港灯塔记录 ${index}。`, createdAt = index => BASE + index,
  stale = false, pending = false, sharedMessage = false, idPrefix = 'cm_directory' } = {}) {
  const ids = [], rows = [], sharedId = randomUUID();
  if (sharedMessage) await DB.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,?,?,?,?,0)')
    .bind(f.user.id, f.conversationId, sharedId, 'assistant', content(0)).run();
  for (let index = 0; index < count; index++) {
    const id = `${idPrefix}_${String(index).padStart(5, '0')}_${randomUUID()}`, messageId = sharedMessage ? sharedId : randomUUID();
    const text = content(index), sourceHash = stale || sharedMessage ? hash(`过期版本 ${index}`) : hash(text), at = createdAt(index), token = randomUUID();
    if (!sharedMessage) rows.push(DB.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content,position) VALUES(?,?,?,?,?,?)')
      .bind(f.user.id, f.conversationId, messageId, 'assistant', text, index));
    rows.push(DB.prepare(`INSERT INTO chat_media_assets(id,user_id,conversation_id,message_id,kind,source_hash,status,processing_token,object_key,mime_type,byte_length,audio_text_chars,total_text_chars,created_at,updated_at)
      VALUES(?,?,?,?,'audio',?,?,?,?,?,?,?,?,?,?)`).bind(id, f.user.id, f.conversationId, messageId, sourceHash, pending ? 'pending' : 'ready', token,
      `directory/${f.user.id}/${id}`, pending ? null : 'audio/mpeg', pending ? null : 3, pending ? null : 10, pending ? null : 10, at, at));
    if (pending) rows.push(DB.prepare("INSERT INTO chat_media_usage(id,user_id,asset_id,kind,day_key,status,created_at,expires_at) VALUES(?,?,?,'audio','2026-10-14','pending',?,?)")
      .bind(token, f.user.id, id, BASE, BASE + 120000));
    ids.push(id);
    if (rows.length >= 70) { await DB.batch(rows.splice(0)); }
  }
  if (rows.length) await DB.batch(rows);
  return ids;
}

async function call(f, query = '', { user = f.user, conversationId = f.conversationId, env = f.env } = {}) {
  let response;
  try { response = await handleChatMedia(new Request(`https://qingyu.invalid/v1/chat-media?conversationId=${encodeURIComponent(conversationId)}${query}`), env, user, { now: () => BASE }); }
  catch (error) { if (!Number.isInteger(error.status)) throw error; response = Response.json({ error: error.message, ...error.details }, { status: error.status }); }
  const data = await response.json(); requests.push({ accountId: user.id, conversationId, query, status: response.status,
    assets: data.assets?.length ?? null, pending: data.pending?.length ?? null, scannedRows: data.directory?.scannedRows ?? null });
  return { status: response.status, data };
}
function ok(result) { assert.equal(result.status, 200, result.data.error); return result.data; }
const cursor = array => Buffer.from(JSON.stringify(array)).toString('base64url');
async function all(f, limit = 500) {
  const pages = [], assets = [], pending = []; let next = null;
  do {
    const page = ok(await call(f, `&pagination=1&limit=${limit}${next ? '&cursor=' + next : ''}`));
    pages.push(page); assets.push(...page.assets); pending.push(...page.pending); next = page.directory.nextCursor;
    assert.ok(pages.length <= 100, 'fixture loop guard, not production truncation');
  } while (next);
  return { pages, assets, pending };
}

test('501 ready assets survive two pages with the same timestamp tie; legacy remains complete without directory field', async () => {
  const f = await fixture(), ids = await seed(f, 501, { createdAt: () => BASE });
  const legacy = ok(await call(f)); assert.equal(legacy.assets.length, 501); assert.equal(legacy.directory, undefined);
  const result = await all(f); assert.equal(result.pages.length, 2); assert.equal(result.pages[0].assets.length, 500); assert.equal(result.pages[1].assets.length, 1);
  assert.deepEqual(result.assets.map(row=>row.id), [...ids].sort()); assert.equal(new Set(result.assets.map(row=>row.id)).size, 501);
  assert.equal(result.pages[0].directory.after, null); assert.deepEqual(result.pages[1].directory.after,
    { createdAt: BASE, id: [...ids].sort()[499] });
  assert.deepEqual(result.pages[0].directory.upper, result.pages[1].directory.upper);
  assert.deepEqual(result.pages[0].vip, { active: false, expiresAt: null, adminPreview: false, unlimited: false });
  assert.deepEqual(result.pages[0].features, { audio: false, image: false });
  observations.push({ case: 'boundary501-and-legacy', role: f.user.role, legacy: 501, pages: result.pages.map(page=>({ assets: page.assets.length, directory: page.directory })), completeIds: 501 });
});

test('fully stale first page remains empty but advances raw cursor and reaches a later matching asset', async () => {
  const f = await fixture(); await seed(f, 500, { stale: true }); const valid = await seed(f, 1, { createdAt: () => BASE + 2000, idPrefix: 'cm_matching' });
  const result = await all(f); assert.equal(result.pages[0].assets.length, 0); assert.equal(result.pages[0].pending.length, 0);
  assert.equal(result.pages[0].directory.scannedRows, 500); assert.ok(result.pages[0].directory.nextCursor);
  assert.deepEqual(result.assets.map(row=>row.id), valid); assert.equal(result.pages.length, 2);
  observations.push({ case: 'empty-stale-page-progress', scannedFirst: 500, returnedFirst: 0, completeIds: result.assets.map(row=>row.id) });
});

test('mixed ready and leased pending page together; usage stays global and a newer row outside high-water waits for reload', async () => {
  const f = await fixture(); await seed(f, 2); const pendingIds = await seed(f, 2, { pending: true, createdAt: i=>BASE + 100 + i, idPrefix: 'cm_pending' });
  const first = ok(await call(f, '&pagination=1&limit=2')); const later = await seed(f, 1, { createdAt: () => BASE + 300, idPrefix: 'cm_later' });
  const second = ok(await call(f, '&pagination=1&limit=2&cursor=' + first.directory.nextCursor));
  assert.deepEqual(second.pending.map(row=>row.id), pendingIds); assert.equal(second.assets.length, 0); assert.equal(second.directory.nextCursor, null);
  assert.deepEqual(first.usage, { audio: 2, image: 0 }); assert.deepEqual(second.usage, first.usage);
  assert.ok(![...first.assets, ...second.assets].some(row=>row.id === later[0]));
  assert.ok((await all(f)).assets.some(row=>row.id === later[0]));
  observations.push({ case: 'pending-quota-and-high-water', usage: first.usage, pending: pendingIds.length, newAfterUpperExcluded: true });
});

test('pending rows require their exact active lease and current source hash; expired lease is released without fresh allowance', async () => {
  const f = await fixture(), active = await seed(f, 1, { pending: true });
  const wrong = await seed(f, 1, { pending: true, idPrefix: 'cm_wrong_lease' }), stale = await seed(f, 1, { pending: true, stale: true, idPrefix: 'cm_stale_pending' });
  const expired = await seed(f, 1, { pending: true, idPrefix: 'cm_expired' });
  await DB.prepare('UPDATE chat_media_usage SET asset_id=? WHERE user_id=? AND asset_id=?').bind(randomUUID(), f.user.id, wrong[0]).run();
  await DB.prepare('UPDATE chat_media_usage SET expires_at=? WHERE user_id=? AND asset_id=?').bind(BASE - 1, f.user.id, expired[0]).run();
  const result = await all(f); assert.deepEqual(result.pending.map(row=>row.id), active); assert.equal(result.assets.length, 0);
  assert.ok(!result.pending.some(row=>[...wrong, ...stale, ...expired].includes(row.id)));
  assert.equal((await DB.prepare('SELECT status FROM chat_media_usage WHERE user_id=? AND asset_id=?').bind(f.user.id, expired[0]).first()).status, 'failed');
  assert.equal(result.pages[0].usage.audio, 3);
});

test('strict opt-in query rejects unknown/repeated/cross-scope/oversized/malformed and inconsistent cursor before reading foreign data', async () => {
  const f = await fixture(); await seed(f, 2); const foreign = await fixture(); await seed(foreign, 1);
  const first = ok(await call(f, '&pagination=1&limit=1')), token = JSON.parse(Buffer.from(first.directory.nextCursor, 'base64url').toString());
  const bad = [
    '&limit=500', '&pagination=0', '&pagination=1&pagination=1', '&pagination=1&limit=0', '&pagination=1&limit=501',
    '&pagination=1&limit=500&limit=500', '&pagination=1&unknown=1', '&pagination=1&cursor=',
    '&pagination=1&cursor=' + 'a'.repeat(1025), '&pagination=1&cursor=***',
    '&pagination=1&limit=1&cursor=' + first.directory.nextCursor + '&cursor=' + first.directory.nextCursor,
    '&pagination=1&limit=2&cursor=' + first.directory.nextCursor,
    ...[[2, ...token.slice(1)], [1, foreign.user.id, ...token.slice(2)], [1, token[1], foreign.conversationId, ...token.slice(3)],
      [...token.slice(0, 4), token[6] + 1, token[5], token[6], token[7]],
      [...token.slice(0, 4), token[6], token[7], token[6], token[7]], [...token, 'extra'],
      [...token.slice(0, 4), -1, ...token.slice(5)]].map(value=>'&pagination=1&limit=1&cursor=' + cursor(value)),
  ];
  const beforeReads = f.sqlReads.length;
  for (const query of bad) assert.equal((await call(f, query)).status, 400, query);
  assert.equal(f.sqlReads.length, beforeReads);
  assert.equal((await call(f, '&pagination=1', { conversationId: foreign.conversationId })).status, 404);
  const direct = ok(await call(f, '&pagination=1'));
  assert.ok(direct.assets.every(asset=>asset.conversationId === f.conversationId));
  assert.ok(!f.sqlReads.filter(row=>/FROM messages WHERE|FROM chat_media_assets a/.test(row.sql)).some(row=>row.bindings.includes(foreign.user.id)));
});

test('empty directory and a deleted final suffix are valid completion, not a fabricated point-in-time snapshot', async () => {
  const f = await fixture(); const empty = ok(await call(f, '&pagination=1'));
  assert.deepEqual(empty.directory, { version: 1, limit: 500, scannedRows: 0, upper: null, after: null, nextCursor: null });
  const ids = await seed(f, 2); const first = ok(await call(f, '&pagination=1&limit=1'));
  await DB.prepare('DELETE FROM chat_media_assets WHERE user_id=? AND id=?').bind(f.user.id, ids[1]).run();
  const last = ok(await call(f, '&pagination=1&limit=1&cursor=' + first.directory.nextCursor));
  assert.equal(last.directory.scannedRows, 0); assert.equal(last.directory.nextCursor, null);
  assert.deepEqual(last.directory.upper, first.directory.upper); assert.notEqual(last.directory.after, null);
});

test('many stale versions of one long current message read its body once; metadata SQL never selects content', async () => {
  const f = await fixture(), content = '原创新航道。'.repeat(2000);
  await seed(f, 500, { sharedMessage: true, content: () => content });
  const result = ok(await call(f, '&pagination=1')); assert.equal(result.directory.scannedRows, 500); assert.equal(result.assets.length, 0);
  const bodyReads = f.sqlReads.filter(row=>/^SELECT id,role,content FROM messages WHERE/.test(row.sql));
  assert.equal(bodyReads.length, 1); assert.equal(bodyReads[0].bindings.length, 3);
  assert.ok(f.sqlReads.filter(row=>/^SELECT a\.\*/.test(row.sql)).every(row=>!row.sql.includes('m.content')));
  observations.push({ case: 'distinct-source-no-amplification', rawVersions: 500, sourceReadQueries: 1,
    distinctMessageIds: 1, actualSourceBytes: Buffer.byteLength(content), hypotheticalRepeatedBodyBytes: 500 * Buffer.byteLength(content) });
});

test('real source chunks use at most 40 distinct IDs; valid maximum UTF8 sources fit and projected oversize rejects before body read', async () => {
  const f = await fixture(); await seed(f, 41); ok(await call(f, '&pagination=1'));
  const reads = f.sqlReads.filter(row=>/^SELECT id,role,content FROM messages WHERE/.test(row.sql));
  assert.deepEqual(reads.map(row=>row.bindings.length - 2), [40, 1]);
  assert.equal(new Set(reads.flatMap(row=>row.bindings.slice(2))).size, 41);
  const largest = await fixture(); await seed(largest, 40, { content: () => '🌊'.repeat(12000) });
  assert.equal(ok(await call(largest, '&pagination=1')).assets.length, 40);
  const huge = await fixture(); await seed(huge, 40);
  huge.projections.first = (sql, result) => /^SELECT COALESCE\(SUM/.test(sql) ? { bytes: LIMIT + 1 } : result;
  const rejected = await call(huge, '&pagination=1'); assert.equal(rejected.status, 413);
  assert.equal(huge.sqlReads.filter(row=>/^SELECT id,role,content FROM messages WHERE/.test(row.sql)).length, 0);
  observations.push({ case: 'source-byte-cap', chunkMaxIds: 40, actualLargestValidChunkBytes: 40 * 4 * 12000,
    projectedOversizedBytes: LIMIT + 1, status: rejected.status, partialSuccess: false,
    scope: 'all stored contents satisfy real D1 12,000-character CHECK; oversize defense uses isolated SQL result projection, not actual stored history' });
});

test('an inconsistent projected source growth after byte precheck fails the entire page after actual byte verification', async () => {
  const f = await fixture(); await seed(f, 40); let grown = false;
  f.projections.all = (sql, result) => {
    if (/^SELECT id,role,content FROM messages WHERE/.test(sql)) { grown = true; return { ...result, results: result.results.map(row=>({ ...row, content: '海'.repeat(18000) })) }; }
    return result;
  };
  const result = await call(f, '&pagination=1'); assert.equal(result.status, 413); assert.equal(grown, true);
  assert.equal(result.data.assets, undefined); assert.equal(result.data.directory, undefined);
  observations.push({ case: 'post-read-byte-defense', actualD1SourceRemainedValid: true, projectedSourceBytes: 40 * 3 * 18000,
    status: result.status, partialSuccess: false, scope: 'isolated inconsistent SQL projection; no schema bypass or actual oversized historical data' });
});

test('ordinary non-VIP cached media remains listed and readable without any generation or provider request', async () => {
  const f = await fixture(), ids = await seed(f, 1), row = await DB.prepare('SELECT * FROM chat_media_assets WHERE user_id=? AND id=?').bind(f.user.id, ids[0]).first();
  objects.push(row.object_key);
  await MEDIA.put(row.object_key, Uint8Array.from([73, 68, 51]), { httpMetadata: { contentType: 'audio/mpeg' },
    customMetadata: { ownerId: f.user.id, assetId: row.id, sourceHash: row.source_hash } });
  assert.equal(ok(await call(f, '&pagination=1')).vip.active, false);
  const response = await handleChatMedia(new Request('https://qingyu.invalid/v1/chat-media/assets/' + row.id), f.env, f.user, { now: () => BASE });
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from([73, 68, 51]));
  assert.equal(modelCalls, 0); assert.equal(providerCalls, 0);
});
