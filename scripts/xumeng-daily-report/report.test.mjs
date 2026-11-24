import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSnapshotSql } from './snapshot.mjs';
import {
  sections, reportPeriod, parseSnapshot, safeCollectionError, buildReport,
  renderMarkdown, saveReport, runReport, withReportLock, atomicWrite,
} from './report.mjs';

const NOW = Date.parse('2026-10-11T09:00:00+08:00');
// The fixture matches the full fixed SELECT contract for an empty database;
// it never stands in for an actual production query.
const aggregates = () => ({
  users: { ordinaryRegisteredTotal: 0, guestTotal: 0, demoTotal: 0, superTotal: 0,
    newRegistrationsByGrant: 0, legacyAccountsCreatedInDay: 0, activeUsersByRecordedActions: 0 },
  subscriptions: { activeVipUsersCurrent: 0, activePeriodsCurrent: 0, queuedPeriodsCurrent: 0,
    expiringUsersNext7Days: 0, newPaidOrdersInDay: 0, firstPurchaseOrdersInDay: 0,
    repeatPurchaseOrdersInDay: 0, dailyClaimCount: 0, dailyClaimCredits: 0,
    revokedPeriodsInDay: 0, refundedOrdersTotal: 0, refundCashflowInDay: null, automaticRenewal: false },
  payments: { paid: [], superPaid: [], createdByStatus: [], refunds: [], subscriptionRefundedOrdersTotal: 0 },
  credits: { grants: [], modelChargeCredits: 0, mediaChargeCredits: 0, modelReleaseCount: 0,
    mediaReleaseCount: 0, currentAvailableCredits: 0, currentReservedCredits: 0, currentDebtCredits: 0,
    super: { modelChargeCredits: 0, mediaChargeCredits: 0, currentAvailableCredits: 0 } },
  modelUsage: { ordinary: [], super: [], legacySuper: [] },
  generation: { ordinary: [], super: [], chatMedia: [], live: null },
  community: { postsCreated: 0, repliesCreated: 0, demoPostsCreated: 0, demoRepliesCreated: 0,
    pendingReportsCurrent: 0, tasksCreated: 0, assignmentsCreated: 0, communityRewardPoints: 0 },
  creation: { newNovels: 0, newGames: 0, newScenarios: 0, newPublications: 0, submissionsCreated: 0,
    pendingSubmissionsCurrent: 0, conversationsUpdated: 0, messagesTotalCurrent: 0, privateCharactersTotalCurrent: 0 },
  feedback: { received: 0, statusCurrent: [], decisionsInDay: 0 },
});
const collectors = {
  d1: async () => ({ data: aggregates(), rowsRead: 23, rowsWritten: 0, querySha256: 'fixture' }),
  site: async () => ({ httpStatus: 200, js: '/assets/index-fixture.js', css: null }),
  project: async () => ({ currentRound: 'ordinary-fixture', activeRoundStatus: 'fixture-only',
    issueCountsByStatus: { open: 1 }, roundsCompletedInPeriod: [] }),
};

async function fixtureDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'xumeng-report-test-'));
  try { await callback(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('default period is the completed previous Beijing day at the exact midnight boundary', () => {
  const midnight = Date.parse('2026-10-11T00:00:00+08:00');
  assert.deepEqual(reportPeriod(undefined, midnight), {
    date: '2026-10-10', timezone: 'Asia/Shanghai',
    startMs: Date.parse('2026-10-09T16:00:00Z'),
    endMs: Date.parse('2026-10-10T16:00:00Z'), snapshotMs: midnight,
  });
  assert.equal(reportPeriod(undefined, midnight - 1).date, '2026-10-09');
});

test('explicit periods validate real calendar dates and refuse incomplete days', () => {
  assert.equal(reportPeriod('2024-02-29', NOW).date, '2024-02-29');
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-10-11', '2026-10-12', 'bad', '2026-1-01']) {
    assert.throws(() => reportPeriod(date, NOW));
  }
  assert.throws(() => reportPeriod(undefined, NaN));
  assert.throws(() => reportPeriod(undefined, -1));
});

test('D1 response must prove one read-only aggregate row with all expected sections', () => {
  const row = Object.fromEntries(Object.entries(aggregates()).map(([name, value]) => [name, JSON.stringify(value)]));
  const good = [{ success: true, meta: { rows_written: 0, rows_read: 12 }, results: [row] }];
  assert.deepEqual(parseSnapshot(JSON.stringify(good)), { data: aggregates(), rowsRead: 12, rowsWritten: 0 });
  const invalid = [
    {}, [], [good[0], good[0]],
    [{ ...good[0], success: false }],
    [{ ...good[0], meta: { rows_written: 1 } }],
    [{ ...good[0], meta: {} }],
    [{ ...good[0], results: [] }],
    [{ ...good[0], results: [row, row] }],
    [{ ...good[0], results: [{ ...row, email: 'private@example.invalid' }] }],
    [{ ...good[0], results: [{ ...row, users: null }] }],
    [{ ...good[0], results: [{ ...row, users: '[]' }] }],
    [{ ...good[0], results: [{ ...row, users: 'invalid' }] }],
    [{ ...good[0], results: [{ ...row, users: '{}' }] }],
    [{ ...good[0], results: [{ ...row, payments: JSON.stringify({ ...aggregates().payments, paid: undefined }) }] }],
    [{ ...good[0], results: [{ ...row, subscriptions: JSON.stringify({ ...aggregates().subscriptions, automaticRenewal: true }) }] }],
    [{ ...good[0], results: [{ ...row, users: JSON.stringify({ ...aggregates().users, ordinaryRegisteredTotal: -1 }) }] }],
  ];
  for (const value of invalid) assert.throws(() => parseSnapshot(JSON.stringify(value)));
  assert.throws(() => parseSnapshot('not-json'));
});

test('USDT receipts require six-decimal units and NOWPayments provenance before a report can accept them', () => {
  const receipt = { provider:'nowpayments',kind:'subscription',currency:'usdt',amountScale:6,orderCount:1,
    grossAmountMinor:5_000_000,refundAmountMinorCurrentlyForTheseOrders:null };
  const envelope = item => {
    const metrics=aggregates(); metrics.payments.paid=[item];
    return JSON.stringify([{success:true,meta:{rows_written:0,rows_read:1},results:[
      Object.fromEntries(Object.entries(metrics).map(([name,value])=>[name,JSON.stringify(value)])),
    ]}]);
  };
  assert.deepEqual(parseSnapshot(envelope(receipt)).data.payments.paid,[receipt]);
  for(const invalid of [
    {...receipt,amountScale:undefined}, {...receipt,amountScale:2}, {...receipt,currency:'usd'},
    {...receipt,provider:'zpay'}, {...receipt,grossAmountMinor:5.5},
    {...receipt,refundAmountMinorCurrentlyForTheseOrders:-1},
  ]) assert.throws(()=>parseSnapshot(envelope(invalid)),/USDT aggregate units/);
});

test('USDT Markdown totals show exact 5.000000, separate fiat and Super; unknown fees and refunds are never profit or zero', async () => {
  const metrics=aggregates();
  metrics.payments.paid=[
    {provider:'nowpayments',kind:'subscription',currency:'usdt',amountScale:6,orderCount:1,grossAmountMinor:5_000_000,refundAmountMinorCurrentlyForTheseOrders:null},
    {provider:'stripe',kind:'recharge',currency:'usd',orderCount:1,grossAmountMinor:100,refundAmountMinorCurrentlyForTheseOrders:0},
    {provider:'zpay',kind:'subscription',currency:'cny',orderCount:1,grossAmountMinor:2800,refundAmountMinorCurrentlyForTheseOrders:null},
  ];
  metrics.payments.superPaid=[{...metrics.payments.paid[0],grossAmountMinor:25_000_000}];
  const report=await buildReport(reportPeriod(undefined,NOW),{...collectors,d1:async()=>({data:metrics,rowsRead:1,rowsWritten:0})});
  const markdown=renderMarkdown(report);
  assert.match(markdown,/普通账号已确认订单总额（USDT） \| 5\.000000 \|/);
  assert.match(markdown,/普通账号实付毛额（USD，未扣退款） \| 1 \|/);
  assert.match(markdown,/普通账号实付毛额（CNY，未扣退款） \| 28 \|/);
  assert.match(markdown,/Super 实付（单列） \/ 1 \/ 已确认订单总额（USDT） \| 25\.000000 \|/);
  assert.match(markdown,/这些实付订单当前累计退款额（USDT） \| 未获取 \|/);
  assert.match(markdown,/渠道 \| NOWPayments \|/);
  assert.match(markdown,/超额付款、实际结算及退款现金流未核实；支付手续费与网络费用未获取，订单总额不是净利润/);
  assert.equal(report.metrics.payments.paid[0].grossAmountMinor,5_000_000);
  assert.equal(report.metrics.payments.paid[0].amountScale,6);
  assert.equal(report.metrics.subscriptions.automaticRenewal,false);
  assert.doesNotMatch(markdown,/\| 50,000 \|/);
  const legacy=renderMarkdown(await buildReport(reportPeriod(undefined,NOW),collectors));
  assert.doesNotMatch(legacy,/USDT|microUSDT|NOWPayments/);
});

test('actual SQL over the real migrated schema meets the helper contract without NaN or private content', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const folder = fileURLToPath(new URL('../../cloudflare/dzmm/migrations/', import.meta.url));
    for (const name of readdirSync(folder).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(folder, name), 'utf8'));
    }
    const period = reportPeriod(undefined, NOW);
    const row = db.prepare(buildSnapshotSql(period)).get();
    const result = parseSnapshot(JSON.stringify([{ success: true, meta: { rows_written: 0, rows_read: 0 }, results: [row] }]));
    assert.deepEqual(result.data, aggregates());
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  } finally { db.close(); }
});

test('collector error output is classified without retaining messages, secrets, or private payloads', () => {
  for (const [message, code] of [
    ['auth token has expired', 'cloudflare_auth_unavailable'],
    ['no such table: hidden', 'database_schema_mismatch'],
    ['too many terms in compound SELECT: SQLITE_ERROR', 'database_query_rejected'],
    ['ETIMEDOUT', 'network_unavailable'],
    ['other provider error', 'collection_failed'],
  ]) {
    const result = safeCollectionError({ message, stdout: 'SECRET_FIXTURE_TOKEN', stderr: 'private@example.invalid' });
    assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_FIXTURE_TOKEN|private@example|hidden/);
  }
});

test('unavailable business data stays null even when other sources succeed', async () => {
  const report = await buildReport(reportPeriod(undefined, NOW), {
    ...collectors, d1: async () => { throw { message: 'ETIMEDOUT', stdout: 'SECRET_FIXTURE_TOKEN' }; },
  });
  assert.equal(report.status, 'partial');
  assert.equal(report.productionMetricsAvailable, false);
  assert.deepEqual(report.metrics, Object.fromEntries(sections.map(name => [name, null])));
  const markdown = renderMarkdown(report);
  assert.match(markdown, /未获取/);
  assert.doesNotMatch(JSON.stringify(report) + markdown, /SECRET_FIXTURE_TOKEN/);
});

test('failed refresh preserves a prior good report and latest bytes, recording only a separate failed attempt', async () => {
  await fixtureDirectory(async directory => {
    const good = await buildReport(reportPeriod(undefined, NOW), collectors);
    await saveReport(good, directory);
    const before = await Promise.all(['2026-10-10.md', '2026-10-10.json', 'latest.md', 'latest.json'].map(name => readFile(join(directory, name), 'utf8')));
    const failed = await buildReport(reportPeriod(undefined, NOW + 1000), { ...collectors, d1: async () => { throw new Error('ETIMEDOUT'); } });
    const result = await saveReport(failed, directory);
    assert.equal(result.preservedPrevious, true);
    const after = await Promise.all(['2026-10-10.md', '2026-10-10.json', 'latest.md', 'latest.json'].map(name => readFile(join(directory, name), 'utf8')));
    assert.deepEqual(after, before);
    const attempt = JSON.parse(await readFile(result.attemptPath, 'utf8'));
    assert.equal(attempt.productionMetricsAvailable, false);
    assert.equal(attempt.metrics.payments, null);
  });
});

test('backfilling an older report never moves latest backward and the archive includes both dates', async () => {
  await fixtureDirectory(async directory => {
    await saveReport(await buildReport(reportPeriod('2026-10-10', NOW), collectors), directory);
    await saveReport(await buildReport(reportPeriod('2026-10-09', NOW), collectors), directory);
    assert.equal(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')).period.date, '2026-10-10');
    const index = await readFile(join(directory, 'index.md'), 'utf8');
    assert.match(index, /2026-10-10\.md/);
    assert.match(index, /2026-10-09\.md/);
    assert.ok(index.indexOf('2026-10-10') < index.indexOf('2026-10-09'));
  });
});

test('a newer unavailable report is latest while latest-successful retains the earlier business snapshot', async () => {
  await fixtureDirectory(async directory => {
    await saveReport(await buildReport(reportPeriod('2026-10-09', NOW), collectors), directory);
    const unavailable = await buildReport(reportPeriod('2026-10-10', NOW), {
      ...collectors, d1: async () => { throw new Error('ETIMEDOUT'); },
    });
    await saveReport(unavailable, directory);
    const latest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
    const successful = JSON.parse(await readFile(join(directory, 'latest-successful.json'), 'utf8'));
    assert.equal(latest.period.date, '2026-10-10');
    assert.equal(latest.productionMetricsAvailable, false);
    assert.equal(successful.period.date, '2026-10-09');
    assert.equal(successful.productionMetricsAvailable, true);
    await saveReport(await buildReport(reportPeriod('2026-10-08', NOW), collectors), directory);
    assert.equal(JSON.parse(await readFile(join(directory, 'latest-successful.json'), 'utf8')).period.date, '2026-10-09');
  });
});

test('corrupt canonical pointers are preserved and rejected before changing dated artifacts', async () => {
  for (const raw of ['not json', '{}']) await fixtureDirectory(async directory => {
    const good = await buildReport(reportPeriod(undefined, NOW), collectors);
    await saveReport(good, directory);
    const before = await Promise.all(['2026-10-10.md', '2026-10-10.json'].map(name => readFile(join(directory, name), 'utf8')));
    await writeFile(join(directory, 'latest.json'), raw, 'utf8');
    const refreshed = await buildReport(reportPeriod(undefined, NOW + 1000), collectors);
    await assert.rejects(saveReport(refreshed, directory));
    assert.equal(await readFile(join(directory, 'latest.json'), 'utf8'), raw);
    const after = await Promise.all(['2026-10-10.md', '2026-10-10.json'].map(name => readFile(join(directory, name), 'utf8')));
    assert.deepEqual(after, before);
  });
});

test('repeat complete report avoids collection and repairs Markdown files lost after interruption', async () => {
  await fixtureDirectory(async directory => {
    await runReport({ directory, nowMs: NOW, collectors });
    const canonical = JSON.parse(await readFile(join(directory, '2026-10-10.json'), 'utf8'));
    await rm(join(directory, '2026-10-10.md'));
    await writeFile(join(directory, 'latest.md'), 'stale interrupted content', 'utf8');
    let called = 0;
    const failIfCalled = async () => { called++; throw new Error('Should not collect again.'); };
    const result = await runReport({ directory, nowMs: NOW + 1000, collectors: { d1: failIfCalled, site: failIfCalled, project: failIfCalled } });
    assert.equal(result.status, 'already-generated');
    assert.equal(called, 0);
    assert.equal(await readFile(join(directory, '2026-10-10.md'), 'utf8'), renderMarkdown(canonical));
    assert.equal(await readFile(join(directory, 'latest.md'), 'utf8'), renderMarkdown(canonical));
  });
});

test('lock rejects a concurrent run then releases after the callback completes', async () => {
  await fixtureDirectory(async directory => {
    let release, entered;
    const blocked = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const first = withReportLock(directory, async () => { entered(); await blocked; return 'first'; });
    await started;
    await assert.rejects(withReportLock(directory, async () => 'second'), /holds the lock/);
    release();
    assert.equal(await first, 'first');
    assert.equal(await withReportLock(directory, async () => 'third'), 'third');
    assert.ok(!(await readdir(directory)).includes('.report.lock'));
  });
});

test('lock releases on callback error and never removes a replacement owner lock', async () => {
  await fixtureDirectory(async directory => {
    await assert.rejects(withReportLock(directory, async () => { throw new Error('fixture failure'); }), /fixture failure/);
    assert.ok(!(await readdir(directory)).includes('.report.lock'));
    await withReportLock(directory, async () => { await writeFile(join(directory, '.report.lock'), 'replacement-owner', 'utf8'); });
    assert.equal(await readFile(join(directory, '.report.lock'), 'utf8'), 'replacement-owner');
  });
});

test('atomic writes use private permissions and clean temporary files if rename fails', async () => {
  await fixtureDirectory(async directory => {
    const path = join(directory, 'report.json');
    await atomicWrite(path, '{}\n');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(atomicWrite(directory, 'fixture'));
    assert.deepEqual(await readdir(directory), ['report.json']);
  });
});
