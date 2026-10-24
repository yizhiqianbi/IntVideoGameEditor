import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { handleTaskMarket } = await tsImport('../src/task-market.ts', import.meta.url);
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { readTaskCenter } = await tsImport('../src/tasks.ts', import.meta.url);
const PREFIX = '/v1/task-market';
const DAY = 86400000;
let store, DB, MEDIA;
async function applyMigrations(database, select = () => true) {
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => f.endsWith('.sql') && select(f)).sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(sql).filter(s => s.trim()).map(s => database.prepare(s)));
  }
}
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated task market")}}',
    d1Databases: { DB: 'task-market-isolated' }, r2Buckets: { MEDIA: 'task-market-isolated' } }));
  DB = await store.getD1Database('DB'); MEDIA = await store.getR2Bucket('MEDIA');
  await applyMigrations(DB);
});
after(async () => { await store?.dispose(); });

async function fixture({ role = 'user', guest = false } = {}, database = DB) {
  const now = Date.now(), id = randomUUID(), token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const user = { id, email: null, nickname: '原创任务测试者', isGuest: guest, role, version: 0 };
  await database.batch([
    database.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,?,?,?)').bind(id, user.nickname, Number(guest), role, now),
    database.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash, id, now + 60 * DAY, now),
    database.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(), id, 100, 'isolated test', now),
  ]);
  return { now, user, token, hash, env: { DB: database, MEDIA, APP_ORIGINS: 'https://qingyu.invalid' } };
}
function payload(f, extra = {}) {
  return { accountId: f.user.id, requestId: randomUUID(), title: '港城地图创作任务',
    description: '创作一段成年档案员整理旧港口地图的原创短篇。', requirements: '文字流畅，有清楚的起因与结果。',
    category: 'writing', characterId: null, rewardPoints: 10, slots: 2, deadlineAt: f.now + DAY, ...extra };
}
async function call(f, path, { method = 'GET', body, headers = {}, supplied = f.user, env = f.env, entry = false, urlOrigin = 'https://qingyu.invalid' } = {}) {
  const request = new Request(urlOrigin + path, { method,
    headers: { Origin: 'https://qingyu.invalid', Cookie: `qingyu_session=${f.token}`, ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response;
  try { response = entry ? await fetchRequest(request, env) : await handleTaskMarket(request, env, supplied, { now: () => f.now }); }
  catch (error) { if (!error.status) throw error; response = Response.json({ error: error.message, ...error.details }, { status: error.status }); }
  assert.ok(response);
  return { status: response.status, headers: response.headers, data: await response.json() };
}
function expect(result, status) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
async function publish(f, extra = {}) { return expect(await call(f, PREFIX, { method: 'POST', body: payload(f, extra) }), 201).task; }
async function approve(admin, task) {
  return expect(await call(admin, `${PREFIX}/${task.id}/review`, { method: 'POST', body: {
    accountId: admin.user.id, version: task.version, decision: 'approved',
  } }), 200).task;
}
async function claim(f, task) { return call(f, `${PREFIX}/${task.id}/claim`, { method: 'POST', body: { accountId: f.user.id } }); }
async function submit(f, task, assignment, body = '  成年档案员摊开旧地图，发现码头的位置已变化。\n她核对日志后画出了新航线。  ') {
  return call(f, `${PREFIX}/${task.id}/submissions`, { method: 'POST', body: { accountId: f.user.id, version: assignment.version, body } });
}
async function review(owner, task, assignment, decision = 'approved', reason) {
  return call(owner, `${PREFIX}/${task.id}/assignments/${assignment.id}/review`, { method: 'POST', body: {
    accountId: owner.user.id, version: assignment.version, decision, ...(reason === undefined ? {} : { reason }),
  } });
}
async function cancel(owner, task) {
  return expect(await call(owner, `${PREFIX}/${task.id}/cancel`, { method: 'POST', body: { accountId: owner.user.id, version: task.version } }), 200).task;
}
async function detail(f, task) { return call(f, `${PREFIX}/${task.id}`); }
async function wallet(f) { return DB.prepare('SELECT * FROM credit_usage_balances WHERE user_id=?').bind(f.user.id).first(); }
async function rewards(task) { return (await DB.prepare('SELECT * FROM task_market_rewards WHERE task_id=?').bind(task.id).all()).results; }

// Pause only this request's already-completed D1 read. The writer keeps the
// original database, so its real handler can commit before the read resumes.
function pausedDetailDatabase(database) {
  let reached, release;
  const ready = new Promise(resolve => { reached = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const raw = new WeakMap(), sqlByStatement = new WeakMap();
  let paused = false;
  async function pause(kind) {
    if (paused) return;
    paused = true; reached(kind); await resume;
  }
  function statement(value, sql) {
    const wrapped = new Proxy(value, { get(target, key) {
      if (key === 'bind') return (...args) => statement(target.bind(...args), sql);
      if (key === 'first') return async (...args) => {
        const row = await target.first(...args);
        if (sql === 'SELECT * FROM task_market_assignments WHERE task_id=? AND user_id=?') await pause('individual-assignment-read');
        return row;
      };
      const member = Reflect.get(target, key);
      return typeof member === 'function' ? member.bind(target) : member;
    } });
    raw.set(wrapped, value); sqlByStatement.set(wrapped, sql); return wrapped;
  }
  const wrapped = new Proxy(database, { get(target, key) {
    if (key === 'prepare') return sql => statement(target.prepare(sql), sql);
    if (key === 'batch') return async statements => {
      const results = await target.batch(statements.map(item => raw.get(item) ?? item));
      if (statements.some(item => sqlByStatement.get(item)?.includes('s.id AS submission_id'))) await pause('atomic-detail-batch');
      return results;
    };
    const member = Reflect.get(target, key);
    return typeof member === 'function' ? member.bind(target) : member;
  } });
  return { DB: wrapped, ready, release };
}

test('detail preserves one D1 snapshot when another real submission commits between reads', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture();
  const task = await approve(admin, await publish(owner, { title: '隔离快照：港城地图核对' }));
  const claimed = expect(await claim(participant, task), 201).assignment;
  const gate = pausedDetailDatabase(DB);
  const reading = call(participant, `${PREFIX}/${task.id}`, { env: { ...participant.env, DB: gate.DB } });
  let captured, committed, pausedAt;
  let timeout;
  const missedPause = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('detail did not reach its actual D1 snapshot gate')), 10_000); });
  try {
    pausedAt = await Promise.race([gate.ready, missedPause]);
    committed = expect(await submit(participant, task, claimed, '  原创隔离成果：林舟按潮汐记录校正了旧港口地图。\n新的航线已标注。  '), 201);
    assert.deepEqual(await DB.prepare('SELECT status,version,revision FROM task_market_assignments WHERE id=?').bind(claimed.id).first(),
      { status: 'submitted', version: 2, revision: 1 });
  } finally { clearTimeout(timeout); gate.release(); }
  captured = expect(await reading, 200);
  const next = expect(await detail(participant, task), 200);
  if (process.env.TASK_SNAPSHOT_EVIDENCE_DIR) {
    await mkdir(process.env.TASK_SNAPSHOT_EVIDENCE_DIR, { recursive: true });
    const phase = process.env.TASK_SNAPSHOT_EVIDENCE_PHASE === 'before' ? 'before' : 'after';
    await writeFile(join(process.env.TASK_SNAPSHOT_EVIDENCE_DIR, `${phase}-detail.json`), JSON.stringify({
      evidenceLevel: 'isolated-api: actual handler + disposable Miniflare D1', pausedAt,
      schedule: ['target GET read paused after D1 executed', 'independent real POST submissions committed', 'target GET resumed', 'new unpaused GET'],
      accountId: participant.user.id, taskId: task.id, captured, committed, next,
      realModelCalls: 0, productionOperations: 0,
    }, null, 2) + '\n');
  }
  assert.equal(captured.assignment.status, 'claimed');
  assert.equal(captured.assignment.version, 1);
  assert.equal(captured.task.submissionCount, 0);
  assert.deepEqual(captured.submissions, [], 'a claimed snapshot cannot contain a later submitted result');
  assert.equal(next.assignment.status, 'submitted');
  assert.equal(next.assignment.version, 2);
  assert.equal(next.task.submissionCount, 1);
  assert.equal(next.submissions.length, 1);
  assert.deepEqual(next.submissions[0].assignment, next.assignment);
  assert.equal(next.submissions[0].body, committed.submission.body);
  assert.equal(next.submissions[0].revision, 1);
  assert.equal((await rewards(task)).length, 0);
});

test('actual app requires session and trusted Origin; strict body prevents forged rewards and account impersonation', async () => {
  const f = await fixture(), guest = await fixture({ guest: true });
  expect(await call(f, PREFIX, { headers: { Cookie: '' }, entry: true }), 401);
  expect(await call(f, PREFIX, { method: 'POST', body: payload(f), headers: { Origin: 'https://evil.test' }, entry: true }), 403);
  expect(await call(f, PREFIX, { method: 'POST', body: payload(f), headers: { Origin: '', 'Sec-Fetch-Site': 'same-origin' } }), 403);
  expect(await call(guest, PREFIX, { method: 'POST', body: payload(guest) }), 403);
  for (const extra of [{ points: 999 }, { credits: 1 }, { rewardPoints: 999 }, { rewardPoints: '10' }, { slots: 21 },
    { slots: 0 }, { deadlineAt: f.now }, { category: 'money' }, { characterId: 'private-card' }, { accountId: randomUUID() }]) {
    expect(await call(f, PREFIX, { method: 'POST', body: payload(f, extra) }), extra.accountId ? 409 : 400);
  }
  expect(await call(f, PREFIX, { method: 'POST', body: payload(f), supplied: { ...f.user, id: randomUUID(), role: 'super' } }), 401);
  expect(await call(f, PREFIX + '/not-an-id'), 400);
  expect(await call(f, PREFIX, { method: 'PATCH', body: payload(f) }), 405);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_market_tasks WHERE user_id=?').bind(f.user.id).first()).n, 0);
  expect(await call(guest, PREFIX), 200);
  const created = expect(await call(f, PREFIX, { method: 'POST', body: payload(f), entry: true }), 201);
  assert.equal(created.accountId, f.user.id); assert.equal(created.task.status, 'pending');
  const gateway = expect(await call(f, PREFIX, { method: 'POST', body: payload(f), entry: true,
    urlOrigin: 'https://qingyu-backend.internal', headers: { Origin: 'https://qingyu-backend.internal' } }), 201);
  assert.equal(gateway.task.status, 'pending');
  expect(await call(f, PREFIX, { method: 'POST', body: payload(f), headers: { Origin: 'https://alternate.test' },
    env: { ...f.env, APP_ORIGINS: 'https://qingyu.invalid\n https://alternate.test' } }), 201);
});

test('pending and cancelled-unapproved tasks remain private; public, owner, admin search and paging are authoritative', async () => {
  const owner = await fixture(), stranger = await fixture(), admin = await fixture({ role: 'super' });
  const uniqueTitle = '地图-' + randomUUID(), pending = await publish(owner, { title: uniqueTitle });
  expect(await detail(stranger, pending), 404);
  assert.equal(expect(await call(stranger, `${PREFIX}?filter=all&q=${uniqueTitle}`), 200).total, 0);
  assert.equal(expect(await call(owner, `${PREFIX}?filter=my&q=${uniqueTitle}`), 200).total, 1);
  expect(await call(stranger, PREFIX + '/admin'), 403);
  const adminList = expect(await call(admin, `${PREFIX}/admin?status=pending&q=${uniqueTitle}&category=writing&limit=1&offset=0`), 200);
  assert.equal(adminList.total, 1); assert.equal(adminList.tasks[0].id, pending.id);
  assert.equal(adminList.pointsKind, 'credit'); assert.equal(adminList.modelBillingLinked, true);
  assert.equal(expect(await call(admin, `${PREFIX}/admin?status=pending&q=${uniqueTitle}&category=feedback`), 200).total, 0);
  const cancelled = await cancel(owner, pending);
  assert.equal(cancelled.status, 'cancelled'); expect(await detail(stranger, cancelled), 404);
  assert.equal(expect(await call(stranger, `${PREFIX}?filter=completed&q=${uniqueTitle}`), 200).total, 0);
  for (const query of ['filter=invalid', 'category=invalid', 'limit=0', 'offset=-1', 'limit=51']) expect(await call(owner, PREFIX + '?' + query), 400);
});

test('publish request ID is idempotent across expiry; rule changes need a different task and current Super role is required', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), body = payload(owner);
  const pending = expect(await call(owner, PREFIX, { method: 'POST', body }), 201).task;
  assert.equal(expect(await call(owner, PREFIX, { method: 'POST', body }), 200).task.id, pending.id);
  expect(await call(owner, PREFIX, { method: 'POST', body: { ...body, slots: 3 } }), 409);
  expect(await call(owner, `${PREFIX}/${pending.id}/review`, { method: 'POST', supplied: { ...owner.user, role: 'super' },
    body: { accountId: owner.user.id, version: 1, decision: 'approved' } }), 403);
  await DB.prepare("UPDATE users SET role='user' WHERE id=?").bind(admin.user.id).run();
  expect(await call(admin, `${PREFIX}/${pending.id}/review`, { method: 'POST', body: { accountId: admin.user.id, version: 1, decision: 'approved' } }), 404);
  await DB.prepare("UPDATE users SET role='super' WHERE id=?").bind(admin.user.id).run();
  const opened = await approve(admin, pending);
  assert.equal(opened.status, 'open'); assert.equal(opened.version, 2);
  expect(await call(admin, `${PREFIX}/${pending.id}/review`, { method: 'POST', body: { accountId: admin.user.id, version: 1, decision: 'approved', rewardPoints: 20 } }), 400);
  expect(await call(admin, `${PREFIX}/${pending.id}/review`, { method: 'POST', body: { accountId: admin.user.id, version: 1, decision: 'approved' } }), 409);
  owner.now = body.deadlineAt + 1;
  assert.equal(expect(await call(owner, PREFIX, { method: 'POST', body }), 200).task.id, pending.id);
  const ownPending = await publish(admin), ownOpened = await approve(admin, ownPending);
  assert.equal(ownOpened.status, 'open'); expect(await claim(admin, ownOpened), 403);
});

test('public character references only; delisting blocks platform approval and new claims without private-card reads', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture();
  const publicationId = 'published-' + randomUUID(), submissionId = randomUUID();
  await DB.batch([
    DB.prepare('INSERT INTO character_publications(id,user_id,private_character_id,approved_revision,is_listed,mutation_token,created_at,updated_at) VALUES(?,?,?,1,1,?,?,?)').bind(publicationId, owner.user.id, 'original-map-test', randomUUID(), owner.now, owner.now),
    DB.prepare("INSERT INTO character_submissions(id,publication_id,revision,status,snapshot_json,created_at) VALUES(?,?,1,'approved',?,?)").bind(submissionId, publicationId, JSON.stringify({ name: '成年港城档案员' }), owner.now),
  ]);
  const pending = await publish(owner, { characterId: publicationId });
  assert.equal(pending.characterName, '成年港城档案员');
  await DB.prepare('UPDATE character_publications SET is_listed=0 WHERE id=?').bind(publicationId).run();
  expect(await call(admin, `${PREFIX}/${pending.id}/review`, { method: 'POST', body: { accountId: admin.user.id, version: 1, decision: 'approved' } }), 409);
  await DB.prepare('UPDATE character_publications SET is_listed=1 WHERE id=?').bind(publicationId).run();
  const opened = await approve(admin, pending);
  await DB.prepare('UPDATE character_publications SET is_listed=0 WHERE id=?').bind(publicationId).run();
  assert.equal(expect(await detail(participant, opened), 200).task.canClaim, false);
  expect(await claim(participant, opened), 409);
  expect(await call(owner, PREFIX, { method: 'POST', body: payload(owner, { characterId: 'published-' + randomUUID() }) }), 400);
  const staticRef = await publish(owner, { characterId: 'qy-shiyu' }); assert.equal(staticRef.characterId, 'qy-shiyu');
});

test('twenty concurrent users compete for one slot; one awardable assignment and same-user replay do not overbook', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' });
  const task = await approve(admin, await publish(owner, { slots: 1 }));
  const participants = await Promise.all(Array.from({ length: 20 }, () => fixture()));
  const attempts = await Promise.all(participants.map(f => claim(f, task)));
  assert.equal(attempts.filter(r => r.status === 201).length, 1);
  assert.equal(attempts.filter(r => r.status === 409).length, 19);
  const winner = participants[attempts.findIndex(r => r.status === 201)], original = attempts.find(r => r.status === 201).data.assignment;
  const replays = await Promise.all(Array.from({ length: 8 }, () => claim(winner, task)));
  for (const replay of replays) { assert.equal(replay.status, 200); assert.equal(replay.data.assignment.id, original.id); }
  expect(await claim(owner, task), 403);
  assert.equal(expect(await detail(winner, task), 200).task.remainingSlots, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_market_assignments WHERE task_id=?').bind(task.id).first()).n, 1);
});

test('withdrawal frees a slot but cannot farm repeated participation; submitted or approved work cannot be withdrawn', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), first = await fixture(), second = await fixture();
  const task = await approve(admin, await publish(owner, { slots: 1 }));
  const a = expect(await claim(first, task), 201).assignment;
  expect(await call(second, `${PREFIX}/${task.id}/withdraw`, { method: 'POST', body: { accountId: second.user.id, version: a.version } }), 409);
  const withdrew = expect(await call(first, `${PREFIX}/${task.id}/withdraw`, { method: 'POST', body: { accountId: first.user.id, version: a.version } }), 200);
  assert.equal(withdrew.assignment.status, 'withdrawn'); assert.equal(withdrew.task.remainingSlots, 1);
  expect(await claim(first, task), 409);
  const b = expect(await claim(second, task), 201).assignment;
  const submitted = expect(await submit(second, task, b), 201).assignment;
  expect(await call(second, `${PREFIX}/${task.id}/withdraw`, { method: 'POST', body: { accountId: second.user.id, version: submitted.version } }), 409);
  const approved = expect(await review(owner, task, submitted), 200).assignment;
  expect(await call(second, `${PREFIX}/${task.id}/withdraw`, { method: 'POST', body: { accountId: second.user.id, version: approved.version } }), 409);
});

test('submission text is preserved; only participant/owner can read it; returns create distinct revisions with stale-write protection', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), f = await fixture(), stranger = await fixture();
  const task = await approve(admin, await publish(owner)), a = expect(await claim(f, task), 201).assignment;
  const content = '  私人原创测试：旧地图的灯塔忽然变亮。\n她记下了新的潮汐时间。  ';
  const submitted = expect(await submit(f, task, a, content), 201);
  assert.equal(submitted.submission.body, content);
  expect(await submit(f, task, a, '过期版本不能覆盖原稿'), 409);
  assert.equal(expect(await detail(stranger, task), 200).submissions.length, 0);
  assert.equal(expect(await detail(f, task), 200).submissions[0].body, content);
  assert.equal(expect(await detail(owner, task), 200).submissions[0].body, content);
  expect(await review(stranger, task, submitted.assignment), 404);
  expect(await review(owner, task, submitted.assignment, 'returned'), 400);
  const returned = expect(await review(owner, task, submitted.assignment, 'returned', '请补充地图变化的原因。'), 200).assignment;
  assert.equal(returned.status, 'returned'); assert.equal((await rewards(task)).length, 0);
  const revised = expect(await submit(f, task, returned, '灯塔变亮是为了指引港口迁移后的航线。'), 201);
  assert.equal(revised.submission.revision, 2);
  const history = expect(await detail(f, task), 200).submissions;
  assert.equal(history.length, 2); assert.ok(history.some(s => s.body === content));
  expect(await submit(stranger, task, revised.assignment), 409);
});

test('concurrent acceptance and lost-response retry award one Credit grant without duplicate task IDs', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture();
  const task = await approve(admin, await publish(owner, { rewardPoints: 20, slots: 1 }));
  const a = expect(await claim(participant, task), 201).assignment, s = expect(await submit(participant, task, a), 201).assignment;
  await DB.prepare("INSERT INTO task_claims(user_id,task_id,period,points,claimed_at,expires_at) VALUES(?,'complete_profile','once',5,?,NULL)").bind(participant.user.id, participant.now).run();
  const before = await wallet(participant), centerBefore = await readTaskCenter(participant.env, participant.user, participant.now);
  assert.equal(centerBefore.points.balance, 105);
  const reviews = await Promise.all(Array.from({ length: 10 }, () => review(owner, task, s)));
  assert.equal(reviews.filter(r => r.status === 200).length, 1); assert.equal(reviews.filter(r => r.status === 409).length, 9);
  expect(await review(owner, task, s), 409); // The successful response can be lost; retry cannot award again.
  const entries = await rewards(task); assert.equal(entries.length, 1); assert.equal(entries[0].points, 20);
  assert.equal(entries[0].expires_at, null); assert.equal(entries[0].user_id, participant.user.id);
  const center = await readTaskCenter(participant.env, participant.user, participant.now);
  assert.equal(center.points.balance, 125); assert.equal(center.points.totalEarned, 25);
  assert.equal(center.tasks.length, 6); assert.equal(center.recentClaims.length, 1);
  assert.equal(center.recentClaims[0].taskId, 'complete_profile');
  const after = await wallet(participant);
  assert.deepEqual(after, { ...before, granted_credits: before.granted_credits + 20, balance: before.balance + 20 });
  assert.equal(expect(await detail(participant, task), 200).task.status, 'completed');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_market_reviews WHERE task_id=? AND kind=?').bind(task.id, 'submission').first()).n, 1);
});

test('atomic reward insertion failure rolls back acceptance and review; explicit retry then awards once', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture();
  const task = await approve(admin, await publish(owner)), a = expect(await claim(participant, task), 201).assignment;
  const s = expect(await submit(participant, task, a), 201).assignment;
  await DB.prepare(`CREATE TRIGGER task_market_test_fail_reward BEFORE INSERT ON task_market_rewards
    WHEN NEW.task_id='${task.id}' BEGIN SELECT RAISE(ABORT,'isolated reward write failure'); END`).run();
  try { await assert.rejects(review(owner, task, s), /isolated reward write failure/); }
  finally { await DB.prepare('DROP TRIGGER task_market_test_fail_reward').run(); }
  const row = await DB.prepare('SELECT status,version FROM task_market_assignments WHERE id=?').bind(s.id).first();
  assert.deepEqual(row, { status: 'submitted', version: s.version });
  assert.equal((await rewards(task)).length, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM task_market_reviews WHERE task_id=? AND kind='submission'").bind(task.id).first()).n, 0);
  expect(await review(owner, task, s), 200); assert.equal((await rewards(task)).length, 1);
});

test('cancel preserves promised submission before deadline and completed records; submitted work remains reviewable after deadline', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture(), stranger = await fixture();
  const task = await approve(admin, await publish(owner)), a = expect(await claim(participant, task), 201).assignment;
  const cancelled = await cancel(owner, task); expect(await claim(stranger, cancelled), 409);
  const s = expect(await submit(participant, cancelled, a), 201).assignment;
  participant.now = task.deadlineAt + 1; owner.now = participant.now;
  assert.equal(expect(await detail(participant, cancelled), 200).assignment.status, 'submitted');
  const accepted = expect(await review(owner, cancelled, s), 200).assignment;
  assert.equal(accepted.status, 'approved'); assert.equal((await rewards(task)).length, 1);
  assert.equal(expect(await detail(participant, cancelled), 200).submissions.length, 1);
  expect(await call(participant, `${PREFIX}/${task.id}`, { method: 'DELETE', body: {} }), 405);
});

test('deadline server clock closes claims/submissions; returned work cannot evade deadline and prior submitted still receives review', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), first = await fixture(), second = await fixture(), stranger = await fixture();
  const task = await approve(admin, await publish(owner));
  const a = expect(await claim(first, task), 201).assignment, b = expect(await claim(second, task), 201).assignment;
  const sa = expect(await submit(first, task, a), 201).assignment;
  const returned = expect(await review(owner, task, sa, 'returned', '请补充结尾。'), 200).assignment;
  const sb = expect(await submit(second, task, b), 201).assignment;
  for (const f of [first, second, stranger, owner]) f.now = task.deadlineAt;
  assert.equal(expect(await detail(first, task), 200).task.status, 'completed');
  expect(await claim(stranger, task), 409); expect(await submit(first, task, returned), 409);
  expect(await review(owner, task, sb), 200); assert.equal((await rewards(task)).length, 1);
  const listed = expect(await call(stranger, `${PREFIX}?filter=completed&q=${encodeURIComponent(task.title)}`), 200);
  assert.ok(listed.tasks.some(t => t.id === task.id));
});

test('joined lists every own participation after cancellation or expiry, with account isolation, hidden recovery and filtered paging', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture(), other = await fixture();
  const prefix = '领取入口-' + randomUUID();
  const opened = async (suffix, category = 'writing') => approve(admin, await publish(owner, { title: `${prefix}-${suffix}`, category }));
  const cancelled = await opened('发布者撤回'), cancelledAssignment = expect(await claim(participant, cancelled), 201).assignment;
  await cancel(owner, cancelled);
  const expired = await opened('到期未提交'); expect(await claim(participant, expired), 201);
  const submitted = await opened('已提交', 'feedback'), submittedAssignment = expect(await claim(participant, submitted), 201).assignment;
  expect(await submit(participant, submitted, submittedAssignment), 201);
  const returned = await opened('已退回'), returnedAssignment = expect(await claim(participant, returned), 201).assignment;
  assert.equal(expect(await review(owner, returned, expect(await submit(participant, returned, returnedAssignment), 201).assignment, 'returned', '请补充原创结尾。'), 200).assignment.status, 'returned');
  const approved = await opened('已验收'), approvedAssignment = expect(await claim(participant, approved), 201).assignment;
  expect(await review(owner, approved, expect(await submit(participant, approved, approvedAssignment), 201).assignment), 200);
  const withdrawn = await opened('已放弃'), withdrawnAssignment = expect(await claim(participant, withdrawn), 201).assignment;
  expect(await call(participant, `${PREFIX}/${withdrawn.id}/withdraw`, { method: 'POST', body: { accountId: participant.user.id, version: withdrawnAssignment.version } }), 200);
  const foreign = await opened('其他账号领取'); expect(await claim(other, foreign), 201);
  await opened('尚未领取'); await publish(owner, { title: `${prefix}-未审核` });

  const ownIds = [cancelled, expired, submitted, returned, approved, withdrawn].map(task => task.id);
  const listing = async (f, filter = 'joined', extra = '') => expect(await call(f, `${PREFIX}?filter=${filter}&q=${encodeURIComponent(prefix)}${extra}`), 200);
  const initial = await listing(participant);
  assert.equal(initial.total, 6); assert.deepEqual(new Set(initial.tasks.map(task => task.id)), new Set(ownIds));
  assert.ok(initial.tasks.every(task => task.participating));
  assert.equal(initial.tasks.find(task => task.id === cancelled.id).status, 'cancelled');
  assert.equal((await listing(participant, 'my')).total, 0);
  assert.equal((await listing(owner, 'my')).total, 9); assert.equal((await listing(owner)).total, 0);
  assert.deepEqual((await listing(other)).tasks.map(task => task.id), [foreign.id]);
  expect(await submit(participant, cancelled, cancelledAssignment, '撤回后仍按原期限提交的原创成果。'), 201);

  participant.now = Math.max(...initial.tasks.map(task => task.deadlineAt)) + 1;
  const expiredList = await listing(participant);
  assert.equal(expiredList.total, 6); assert.deepEqual(new Set(expiredList.tasks.map(task => task.id)), new Set(ownIds));
  assert.equal(expiredList.tasks.find(task => task.id === expired.id).status, 'completed');
  assert.equal(expect(await detail(participant, submitted), 200).assignment.status, 'submitted');
  const writingIds = ownIds.filter(id => id !== submitted.id), pages = [];
  for (const offset of [0, 2, 4]) {
    const page = await listing(participant, 'joined', `&category=writing&limit=2&offset=${offset}`);
    assert.equal(page.total, 5); assert.equal(page.offset, offset); assert.equal(page.limit, 2);
    assert.equal(page.hasMore, offset < 4); pages.push(...page.tasks.map(task => task.id));
  }
  assert.equal(pages.length, 5); assert.deepEqual(new Set(pages), new Set(writingIds));
  assert.equal((await listing(participant, 'joined', '&category=feedback')).tasks[0].id, submitted.id);
  assert.equal(expect(await call(participant, `${PREFIX}?filter=joined&q=${encodeURIComponent(prefix + '-尚未领取')}`), 200).total, 0);

  expect(await call(participant, `${PREFIX}/${cancelled.id}/hide`, { method: 'POST', body: { accountId: participant.user.id, hidden: true } }), 200);
  const hiddenList = await listing(participant);
  assert.equal(hiddenList.total, 5); assert.ok(!hiddenList.tasks.some(task => task.id === cancelled.id));
  assert.deepEqual((await listing(participant, 'hidden')).tasks.map(task => task.id), [cancelled.id]);
  assert.equal(expect(await detail(participant, cancelled), 200).assignment.id, cancelledAssignment.id);
  expect(await call(participant, `${PREFIX}/${cancelled.id}/hide`, { method: 'POST', body: { accountId: participant.user.id, hidden: false } }), 200);
  assert.equal((await listing(participant)).total, 6);
});

test('individual hide persists, affects only that account and cannot destroy participation records', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), f = await fixture(), other = await fixture();
  const title = '隐藏隔离-' + randomUUID(), task = await approve(admin, await publish(owner, { title }));
  const a = expect(await claim(f, task), 201).assignment;
  const hidden = expect(await call(f, `${PREFIX}/${task.id}/hide`, { method: 'POST', body: { accountId: f.user.id, hidden: true } }), 200);
  assert.equal(hidden.task.hidden, true); assert.equal(hidden.task.canClaim, false);
  const reloaded = { ...f };
  assert.equal(expect(await call(reloaded, `${PREFIX}?filter=all&q=${title}`), 200).total, 0);
  assert.equal(expect(await call(reloaded, `${PREFIX}?filter=hidden&q=${title}`), 200).tasks[0].id, task.id);
  assert.equal(expect(await call(other, `${PREFIX}?filter=all&q=${title}`), 200).total, 1);
  assert.equal(expect(await detail(f, task), 200).assignment.id, a.id);
  expect(await submit(f, task, a), 201);
  expect(await call(f, `${PREFIX}/${task.id}/hide`, { method: 'POST', body: { accountId: f.user.id, hidden: false } }), 200);
  assert.equal(expect(await call(f, `${PREFIX}?filter=all&q=${title}`), 200).total, 1);
});

test('session deletion after public read blocks mutation; ten pending submissions cap and approval audit stay bounded', async () => {
  const owner = await fixture(), participant = await fixture(), admin = await fixture({ role: 'super' });
  const task = await approve(admin, await publish(owner)); expect(await detail(participant, task), 200);
  await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(participant.hash).run();
  expect(await claim(participant, task), 401);
  const capped = await fixture();
  for (let i = 0; i < 10; i++) await publish(capped, { title: '待审核原创任务 ' + i });
  expect(await call(capped, PREFIX, { method: 'POST', body: payload(capped) }), 409);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM task_market_tasks WHERE user_id=? AND status='pending'").bind(capped.user.id).first()).n, 10);
});

test('latest submission for every participant stays reviewable even when another participant has more than 100 revisions', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), first = await fixture(), prolific = await fixture();
  const task = await approve(admin, await publish(owner)), a = expect(await claim(first, task), 201).assignment;
  const sa = expect(await submit(first, task, a, '第一位参与者待验收成果，不能被别人的修订挤掉。'), 201).assignment;
  const b = expect(await claim(prolific, task), 201).assignment;
  // Seed ordinary synthetic revisions in isolated D1 to test the read boundary
  // without 202 HTTP write operations or real accounts.
  await DB.batch([
    ...Array.from({ length: 101 }, (_, i) => DB.prepare('INSERT INTO task_market_submissions(id,assignment_id,revision,body,created_at) VALUES(?,?,?,?,?)')
      .bind(randomUUID(), b.id, i + 1, '第二位参与者原创修订 ' + (i + 1), prolific.now + i + 1)),
    DB.prepare("UPDATE task_market_assignments SET status='submitted',revision=101,submitted_at=?,version=2 WHERE id=?").bind(prolific.now + 101, b.id),
  ]);
  const ownerView = expect(await detail(owner, task), 200).submissions;
  assert.equal(ownerView.length, 100);
  assert.ok(ownerView.some(s => s.assignmentId === sa.id && s.revision === 1));
  assert.ok(ownerView.some(s => s.assignmentId === b.id && s.revision === 101));
  // Withdrawn participants free slots but retain submitted revisions. Their
  // number can exceed the live slot budget and must not hide live submissions.
  const exited = Array.from({ length: 101 }, (_, i) => ({ userId: randomUUID(), id: randomUUID(), at: prolific.now + 200 + i }));
  await DB.batch(exited.flatMap(e => [
    DB.prepare("INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,'已退出原创测试者',0,'user',?)").bind(e.userId, e.at),
    DB.prepare("INSERT INTO task_market_assignments(id,task_id,user_id,status,version,revision,mutation_token,created_at,updated_at,submitted_at,reward_points) VALUES(?,?,?,'withdrawn',3,1,?,?,?,?,10)")
      .bind(e.id, task.id, e.userId, randomUUID(), e.at, e.at, e.at),
    DB.prepare('INSERT INTO task_market_submissions(id,assignment_id,revision,body,created_at) VALUES(?,?,1,?,?)')
      .bind(randomUUID(), e.id, '已退出参与者保留的原创稿件', e.at),
  ]));
  const withWithdrawn = expect(await detail(owner, task), 200).submissions;
  assert.equal(withWithdrawn.length, 100);
  assert.equal(withWithdrawn.filter(s => s.assignment.status === 'submitted').length, 2);
  assert.ok(withWithdrawn.some(s => s.assignmentId === sa.id && s.revision === 1));
  assert.ok(withWithdrawn.some(s => s.assignmentId === b.id && s.revision === 101));
  expect(await review(owner, task, sa), 200);
  const privateView = expect(await detail(prolific, task), 200).submissions;
  assert.ok(privateView.every(s => s.userId === prolific.user.id));
  assert.equal(privateView[0].revision, 101);
});

test('additive instructions migration preserves an actual legacy row and its expired frozen publication replay', async () => {
  const legacyStore = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated legacy task")}}',
    d1Databases: { DB: 'task-market-legacy-instructions' } }));
  try {
    const legacyDB = await legacyStore.getD1Database('DB');
    await applyMigrations(legacyDB, file => file !== '0027_task_market_instructions.sql');
    const owner = await fixture({}, legacyDB), body = payload(owner), id = randomUUID();
    const fingerprint = JSON.stringify([body.title, body.description, body.requirements, body.category, body.characterId,
      body.rewardPoints, body.slots, body.deadlineAt]);
    await legacyDB.prepare(`INSERT INTO task_market_tasks(id,user_id,request_id,request_fingerprint,title,description,requirements,category,
      reward_points,slots,deadline_at,status,version,mutation_token,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',1,?,?,?)`).bind(id, owner.user.id, body.requestId, fingerprint, body.title,
      body.description, body.requirements, body.category, body.rewardPoints, body.slots, body.deadlineAt,
      randomUUID(), owner.now, owner.now).run();
    const before = await legacyDB.prepare('SELECT * FROM task_market_tasks WHERE id=?').bind(id).first();
    await applyMigrations(legacyDB, file => file === '0027_task_market_instructions.sql');
    const afterRow = await legacyDB.prepare('SELECT * FROM task_market_tasks WHERE id=?').bind(id).first();
    const { instructions_json, ...unchanged } = afterRow;
    assert.deepEqual(unchanged, before);
    assert.deepEqual(JSON.parse(instructions_json), { goal: '', constraints: [], rules: [] });
    owner.now = body.deadlineAt + 1;
    const recovered = expect(await call(owner, PREFIX, { method: 'POST', body }), 200).task;
    assert.equal(recovered.id, id); assert.equal(recovered.description, body.description);
    assert.deepEqual(recovered.instructions, { goal: '', constraints: [], rules: [] });
    const emptyReplay = expect(await call(owner, PREFIX, { method: 'POST', body: { ...body,
      instructions: { goal: '', constraints: [], rules: [] } } }), 200).task;
    assert.equal(emptyReplay.id, id);
    const stored = await legacyDB.prepare('SELECT request_fingerprint,version FROM task_market_tasks WHERE id=?').bind(id).first();
    assert.deepEqual(stored, { request_fingerprint: fingerprint, version: 1 });
    expect(await call(owner, PREFIX, { method: 'POST', body: { ...body,
      instructions: { goal: '新增目标需要另发委托。', constraints: [], rules: [] } } }), 409);
  } finally { await legacyStore.dispose(); }
});

test('structured goals, constraint chips and ordered rules roundtrip without automatic completion or mutable publication identity', async () => {
  const owner = await fixture(), admin = await fixture({ role: 'super' }), participant = await fixture(), stranger = await fixture();
  const instructions = { goal: '  核对港城地图与潮汐记录。\n保留各项调查结论。  ',
    constraints: ['不跳过现场调查', '最多 50 条消息（含双方）'],
    rules: ['先询问成年档案员，再核对码头日志。', '完成调查后提交三条有出处的结论。'] };
  const body = payload(owner, { instructions });
  const pending = expect(await call(owner, PREFIX, { method: 'POST', body }), 201).task;
  assert.deepEqual(pending.instructions, instructions); assert.equal(pending.status, 'pending'); assert.equal(pending.version, 1);
  expect(await detail(stranger, pending), 404);
  const queue = expect(await call(admin, `${PREFIX}/admin?status=pending&q=${encodeURIComponent(body.title)}`), 200);
  assert.deepEqual(queue.tasks.find(task => task.id === pending.id).instructions, instructions);
  const shuffledKeys = { rules: [...instructions.rules], goal: instructions.goal, constraints: [...instructions.constraints] };
  assert.equal(expect(await call(owner, PREFIX, { method: 'POST', body: { ...body, instructions: shuffledKeys } }), 200).task.id, pending.id);
  for (const changed of [{ ...instructions, goal: '改为另一项调查。' },
    { ...instructions, rules: [...instructions.rules].reverse() },
    { ...instructions, constraints: [...instructions.constraints].reverse() }]) {
    expect(await call(owner, PREFIX, { method: 'POST', body: { ...body, instructions: changed } }), 409);
  }
  const task = await approve(admin, pending);
  assert.deepEqual(expect(await detail(stranger, task), 200).task.instructions, instructions);
  const oldWallet = await wallet(participant), a = expect(await claim(participant, task), 201).assignment;
  assert.equal(a.status, 'claimed'); assert.equal((await rewards(task)).length, 0);
  const s = expect(await submit(participant, task, a, '原创调查记录：完成两处码头核对，汇总三条结论。'), 201).assignment;
  assert.equal(s.status, 'submitted'); assert.equal((await rewards(task)).length, 0);
  expect(await review(stranger, task, s), 404);
  expect(await review(owner, task, s), 200);
  assert.equal((await rewards(task)).length, 1);
  const afterWallet = await wallet(participant);
  assert.deepEqual(afterWallet, { ...oldWallet, granted_credits: oldWallet.granted_credits + 10, balance: oldWallet.balance + 10 });
  assert.deepEqual(expect(await detail(participant, task), 200).task.instructions, instructions);
  owner.now = body.deadlineAt + 1;
  assert.equal(expect(await call(owner, PREFIX, { method: 'POST', body }), 200).task.id, pending.id);
});

test('instruction validation rejects malformed, excessive and forged state metadata before writing; valid boundary content is retained', async () => {
  const owner = await fixture(), blank = { goal: '', constraints: [], rules: [] };
  const invalid = [null, [], 'rule', {}, { ...blank, phaseComplete: true }, { ...blank, goal: 1 },
    { ...blank, goal: 'x'.repeat(4001) }, { ...blank, goal: '地图\0日志' },
    { ...blank, constraints: Array.from({ length: 11 }, () => '核对日志') },
    { ...blank, constraints: ['x'.repeat(121)] }, { ...blank, constraints: [7] }, { ...blank, constraints: [' '] },
    { ...blank, constraints: ['地图\0日志'] }, { ...blank, rules: Array.from({ length: 21 }, () => '提交结论') },
    { ...blank, rules: ['x'.repeat(501)] }, { ...blank, rules: [true] }, { ...blank, rules: ['\n'] },
    { ...blank, rules: ['地图\0日志'] },
    { goal: 'x'.repeat(4000), constraints: Array.from({ length: 10 }, () => 'x'.repeat(120)), rules: Array.from({ length: 20 }, () => 'x'.repeat(500)) }];
  for (const instructions of invalid) expect(await call(owner, PREFIX, { method: 'POST', body: payload(owner, { instructions }) }), 400);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_market_tasks WHERE user_id=?').bind(owner.user.id).first()).n, 0);
  const boundary = { goal: '图'.repeat(4000), constraints: Array.from({ length: 10 }, () => '港'.repeat(120)),
    rules: Array.from({ length: 20 }, () => '潮'.repeat(340)) };
  assert.equal(boundary.goal.length + boundary.constraints.join('').length + boundary.rules.join('').length, 12000);
  assert.deepEqual((await publish(owner, { instructions: boundary })).instructions, boundary);
  const ruleBoundary = { ...blank, rules: ['步'.repeat(500)] };
  assert.deepEqual((await publish(owner, { instructions: ruleBoundary })).instructions, ruleBoundary);
  const legacyShape = await publish(owner);
  assert.deepEqual(legacyShape.instructions, blank);
  for (const json of ['{}', '{"goal":1,"constraints":[],"rules":[]}', '[]', 'bad']) {
    await assert.rejects(DB.prepare('UPDATE task_market_tasks SET instructions_json=? WHERE id=?').bind(json, legacyShape.id).run());
  }
  assert.deepEqual(expect(await detail(owner, legacyShape), 200).task.instructions, blank);
});

test('structured instructions cannot bypass guest, platform or mutation permissions', async () => {
  const owner = await fixture(), guest = await fixture({ guest: true }), admin = await fixture({ role: 'super' }), participant = await fixture();
  const instructions = { goal: '记录港口地图变化。', constraints: ['保留原创文本'], rules: ['先核对日志。'] };
  expect(await call(guest, PREFIX, { method: 'POST', body: payload(guest, { instructions }) }), 403);
  const pending = await publish(owner, { instructions });
  expect(await call(owner, `${PREFIX}/${pending.id}/review`, { method: 'POST', body: { accountId: owner.user.id,
    version: pending.version, decision: 'approved' } }), 403);
  const task = await approve(admin, pending);
  expect(await call(participant, `${PREFIX}/${task.id}/claim`, { method: 'POST', body: { accountId: participant.user.id, instructions } }), 400);
  const a = expect(await claim(participant, task), 201).assignment;
  expect(await call(participant, `${PREFIX}/${task.id}/submissions`, { method: 'POST', body: { accountId: participant.user.id,
    version: a.version, body: '普通原创调查记录。', instructions, stageComplete: true } }), 400);
  assert.equal(expect(await detail(participant, task), 200).assignment.status, 'claimed');
  assert.deepEqual(expect(await detail(participant, task), 200).task.instructions, instructions);
  assert.equal((await rewards(task)).length, 0);
});
