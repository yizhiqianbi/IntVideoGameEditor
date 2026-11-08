import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Synthetic guest sessions only. No existing private data, model or wallet mutations.
const origin = 'https://xumengchat.top';
const reportPath = new URL('../../../output/xumeng/iteration/rounds/round15-20261007-novels-production-api.json', import.meta.url);
const report = { startedAt: new Date().toISOString(), accounts: [], checks: [], models: 0, payments: 0, publicPosts: 0, cleanupPending: true };
async function record() { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }
function client() {
  let cookie = '';
  return { async call(path, method = 'GET', body) {
    const response = await fetch(origin + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const session = response.headers.getSetCookie().find(value => value.startsWith('dzmm_session='));
    if (session) cookie = session.split(';')[0];
    const value = await response.json();
    return { status: response.status, value };
  } };
}
function pass(name) { report.checks.push({ name, passed: true }); }
const owner = client(), other = client(), anonymous = client();
const workId = 'qa-r15-' + randomUUID(); let version;
try {
  assert.equal((await anonymous.call('/api/backend/v1/novels')).status, 401);
  assert.equal((await anonymous.call('/api/novel-generation', 'POST', {})).status, 401);
  pass('private-storage-and-generation-require-session');
  for (const agent of [owner, other]) {
    const guest = await agent.call('/api/backend/v1/auth/guest', 'POST');
    assert.ok([200, 201].includes(guest.status));
    assert.equal(guest.value.user.isGuest, true); report.accounts.push(guest.value.user.id); await record();
  }
  const accountId = report.accounts[0];
  assert.equal((await owner.call('/api/backend/v1/novels')).value.works.length, 0);
  const work = { id: workId, title: '本轮原创测试 · 海港未建之桥', synopsis: '地图员核对一座尚未修建的桥。', type: 'story',
    tags: ['原创测试'], notes: '普通科幻短篇，线索有因果。', outline: '发现地图→核对航志→确认测量日期。',
    chapters: [{ id: 'qa-r15-ch1', title: '旧地图', content: '林澈在旧地图上发现一座桥。\n\n他决定先查航志。' },
      { id: 'qa-r15-ch2', title: '航志', content: '图书管理员给他找来了原始记录。' }] };
  const created = await owner.call('/api/backend/v1/novels', 'POST', { accountId, work });
  assert.equal(created.status, 201); version = created.value.work.version; assert.equal(version, 1);
  const reopened = await owner.call('/api/backend/v1/novels/' + workId);
  assert.equal(reopened.status, 200); assert.equal(reopened.value.accountId, accountId);
  assert.deepEqual(reopened.value.chapters.map(({ id, title, content }) => ({ id, title, content })), work.chapters);
  pass('create-and-reopen-complete-original-manuscript');
  const next = { ...work, title: work.title + ' · 已核对', chapters: [work.chapters[1], { ...work.chapters[0], content: work.chapters[0].content + '\n日期已经确认。' },
    { id: 'qa-r15-ch3', title: '测量日期', content: '原始记录证明地图标记是下一年的规划。' }] };
  const saved = await owner.call('/api/backend/v1/novels/' + workId, 'PUT', { accountId, version, work: next });
  assert.equal(saved.status, 200); version = saved.value.work.version; assert.equal(version, 2);
  assert.deepEqual(saved.value.chapters.map(({ id, title, content, position }) => ({ id, title, content, position })),
    next.chapters.map((chapter, position) => ({ ...chapter, position })));
  pass('atomic-reorder-add-and-edit');
  const stale = await owner.call('/api/backend/v1/novels/' + workId, 'PUT', { accountId, version: 1, work });
  assert.equal(stale.status, 409); assert.equal(stale.value.current.work.version, 2);
  assert.deepEqual(stale.value.current.chapters, saved.value.chapters);
  pass('stale-snapshot-cannot-erase-new-chapters');
  assert.equal((await other.call('/api/backend/v1/novels/' + workId)).status, 404);
  assert.equal((await other.call('/api/backend/v1/novels', 'POST', { accountId, work })).status, 401);
  pass('other-account-read-and-old-tab-write-denied');
  const removed = await owner.call('/api/backend/v1/novels/' + workId, 'DELETE', { accountId, version });
  assert.equal(removed.status, 200); assert.equal(removed.value.deleted, true); version = undefined;
  assert.equal((await owner.call('/api/backend/v1/novels/' + workId)).status, 404);
  assert.equal((await owner.call('/api/backend/v1/novels')).value.works.length, 0);
  pass('delete-and-list-return-to-own-baseline'); report.complete = true;
} catch (error) { report.error = error.message; throw error; }
finally {
  if (version) {
    const removed = await owner.call('/api/backend/v1/novels/' + workId, 'DELETE', { accountId: report.accounts[0], version }).catch(() => null);
    report.workCleanupStatus = removed?.status ?? 'unknown';
  } else report.workCleanupStatus = report.complete ? 'deleted-and-confirmed' : 'check-own-test-id';
  await owner.call('/api/backend/v1/auth/logout', 'POST').catch(() => {});
  await other.call('/api/backend/v1/auth/logout', 'POST').catch(() => {});
  report.finishedAt = new Date().toISOString(); await record();
  console.log(JSON.stringify({ checks: report.checks.length, complete: report.complete, workCleanup: report.workCleanupStatus,
    accountsToDelete: report.accounts, report: reportPath.pathname }));
}
