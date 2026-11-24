import { readFile, mkdir, writeFile, rename, rm, open, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { buildSnapshotSql } from './snapshot.mjs';

const exec = promisify(execFile);
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultOutput = resolve(projectRoot, 'output/xumeng/daily-reports');
export const sections = ['users', 'subscriptions', 'payments', 'credits', 'modelUsage', 'generation', 'community', 'creation', 'feedback'];
const requiredMetrics = {
  users: ['ordinaryRegisteredTotal', 'guestTotal', 'demoTotal', 'superTotal', 'newRegistrationsByGrant', 'legacyAccountsCreatedInDay', 'activeUsersByRecordedActions'],
  subscriptions: ['activeVipUsersCurrent', 'activePeriodsCurrent', 'queuedPeriodsCurrent', 'expiringUsersNext7Days', 'newPaidOrdersInDay', 'firstPurchaseOrdersInDay', 'repeatPurchaseOrdersInDay', 'dailyClaimCount', 'dailyClaimCredits', 'revokedPeriodsInDay', 'refundedOrdersTotal'],
  payments: ['subscriptionRefundedOrdersTotal'],
  credits: ['modelChargeCredits', 'mediaChargeCredits', 'modelReleaseCount', 'mediaReleaseCount', 'currentAvailableCredits', 'currentReservedCredits', 'currentDebtCredits'],
  community: ['postsCreated', 'repliesCreated', 'demoPostsCreated', 'demoRepliesCreated', 'pendingReportsCurrent', 'tasksCreated', 'assignmentsCreated', 'communityRewardPoints'],
  creation: ['newNovels', 'newGames', 'newScenarios', 'newPublications', 'submissionsCreated', 'pendingSubmissionsCurrent', 'conversationsUpdated', 'messagesTotalCurrent', 'privateCharactersTotalCurrent'],
  feedback: ['received', 'decisionsInDay'],
};
const requiredArrays = { payments: ['paid', 'superPaid', 'createdByStatus', 'refunds'], credits: ['grants'],
  modelUsage: ['ordinary', 'super', 'legacySuper'], generation: ['ordinary', 'super', 'chatMedia'], feedback: ['statusCurrent'] };
const DAY = 86400000;
export const shanghaiDate = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);

export function reportPeriod(date, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Invalid clock.');
  const day = date ?? shanghaiDate(nowMs - DAY);
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Expected a calendar date YYYY-MM-DD.');
  const startMs = Date.parse(`${day}T00:00:00+08:00`);
  if (!Number.isSafeInteger(startMs) || startMs < 0 || shanghaiDate(startMs) !== day) throw new Error('Invalid calendar date.');
  const endMs = startMs + DAY;
  if (endMs > nowMs) throw new Error('Only completed Beijing calendar days can be reported.');
  return { date: day, timezone: 'Asia/Shanghai', startMs, endMs, snapshotMs: nowMs };
}

export function parseSnapshot(stdout) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { throw new Error('D1 returned an invalid aggregate response.'); }
  if (!Array.isArray(envelope) || envelope.length !== 1 || envelope[0]?.success !== true
      || envelope[0]?.meta?.rows_written !== 0 || envelope[0]?.results?.length !== 1) {
    throw new Error('D1 aggregate response was not a verified single read-only result.');
  }
  const row = envelope[0].results[0], data = {};
  if (Object.keys(row).some(key => !sections.includes(key))) throw new Error('Unexpected aggregate columns.');
  for (const key of sections) {
    if (typeof row[key] !== 'string') throw new Error('Missing aggregate section.');
    try { data[key] = JSON.parse(row[key]); } catch { throw new Error('Invalid aggregate section.'); }
    if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw new Error('Invalid aggregate shape.');
  }
  for (const [section, keys] of Object.entries(requiredMetrics)) for (const key of keys) {
    if (!Number.isSafeInteger(data[section][key]) || data[section][key] < 0) throw new Error('Missing or invalid aggregate metric.');
  }
  for (const [section, keys] of Object.entries(requiredArrays)) for (const key of keys) {
    if (!Array.isArray(data[section][key])) throw new Error('Missing aggregate dimension.');
  }
  for (const row of [...data.payments.paid, ...data.payments.superPaid]) {
    if (row?.currency === 'usdt' || row?.provider === 'nowpayments') {
      if (row.currency !== 'usdt' || row.provider !== 'nowpayments' || row.amountScale !== 6
          || !Number.isSafeInteger(row.grossAmountMinor) || row.grossAmountMinor < 0
          || (row.refundAmountMinorCurrentlyForTheseOrders !== null
            && (!Number.isSafeInteger(row.refundAmountMinorCurrentlyForTheseOrders) || row.refundAmountMinorCurrentlyForTheseOrders < 0))) {
        throw new Error('Invalid USDT aggregate units.');
      }
    }
  }
  if (data.subscriptions.refundCashflowInDay !== null || data.subscriptions.automaticRenewal !== false || data.generation.live !== null
      || !data.credits.super || ['modelChargeCredits', 'mediaChargeCredits', 'currentAvailableCredits'].some(key => !Number.isSafeInteger(data.credits.super[key]))) {
    throw new Error('Missing aggregate coverage facts.');
  }
  // Only the fixed aggregate SELECT supplies these objects. Raw D1 rows and
  // credentials are never written or printed, including on collection failure.
  return { data, rowsRead: envelope[0].meta?.rows_read ?? null, rowsWritten: 0 };
}

export function safeCollectionError(error) {
  const source = `${error?.message ?? ''} ${error?.stdout ?? ''} ${error?.stderr ?? ''}`;
  if (/auth token has expired|could not be refreshed|authentication error|not authenticated|login required/i.test(source)) {
    return { code: 'cloudflare_auth_unavailable', message: 'Cloudflare 授权未能刷新。请确认网络或代理可用；网络恢复后若仍失败，在本机重新授权 Wrangler。' };
  }
  if (/no such (table|column)/i.test(source)) {
    return { code: 'database_schema_mismatch', message: '正式数据库结构与日报查询不匹配，需要核对迁移；未修改数据库。' };
  }
  if (/SQLITE_ERROR|D1_ERROR/i.test(source)) {
    return { code: 'database_query_rejected', message: 'Cloudflare D1 暂未接受统计查询，需要检查查询兼容性；未修改数据库。' };
  }
  if (/timeout|ETIMEDOUT|ECONN|ENOTFOUND|fetch failed|SSL|network/i.test(source)) {
    return { code: 'network_unavailable', message: '网络连接失败或超时，未获取正式数据。' };
  }
  return { code: 'collection_failed', message: '采集失败，未获取正式数据。原始命令输出未保存。' };
}

export async function collectD1(period) {
  const sql = buildSnapshotSql(period);
  const backend = resolve(projectRoot, 'cloudflare/dzmm');
  const { stdout } = await exec(process.execPath, [resolve(backend, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'DB', '--remote', '--config', 'wrangler.production.jsonc', '--command', sql, '--json'], {
    cwd: backend, timeout: 45000, killSignal: 'SIGTERM', maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
  });
  return { ...parseSnapshot(stdout), querySha256: createHash('sha256').update(sql).digest('hex') };
}

export async function collectSite() {
  const response = await fetch('https://xumengchat.top/', { signal: AbortSignal.timeout(15000), redirect: 'manual' });
  if (response.status !== 200) throw new Error('Site HTTP check failed.');
  const html = await response.text();
  if (html.length > 1000000) throw new Error('Unexpected site document size.');
  const js = html.match(/(?:src|href)="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1] ?? null;
  const css = html.match(/href="(\/assets\/index-[A-Za-z0-9_-]+\.css)"/)?.[1] ?? null;
  if (!js) throw new Error('Site entry resource not found.');
  return { httpStatus: response.status, js, css, checkedAt: new Date().toISOString(), scope: 'public-homepage-http-only' };
}

export async function collectProject(period) {
  const backlog = JSON.parse(await readFile(resolve(projectRoot, 'output/xumeng/iteration/backlog.json'), 'utf8'));
  const states = {};
  for (const item of backlog.issues ?? []) states[item.status ?? 'unknown'] = (states[item.status ?? 'unknown'] ?? 0) + 1;
  const rounds = [];
  const folder = resolve(projectRoot, 'output/xumeng/iteration/rounds');
  for (const name of (await readdir(folder)).filter(name => name.endsWith('.json'))) {
    let record;
    try { record = JSON.parse(await readFile(resolve(folder, name), 'utf8')); } catch { continue; }
    const completedAt = Date.parse(record.completedAt ?? '');
    if (!(completedAt >= period.startMs && completedAt < period.endMs)) continue;
    rounds.push({ id: String(record.id ?? name.slice(0, -5)), status: String(record.status ?? 'unknown'),
      issuesClosed: record.measurements?.issuesClosed ?? null, publishes: record.measurements?.publishes ?? null });
  }
  return { currentRound: backlog.currentRound ?? null, activeRoundStatus: backlog.activeRound?.status ?? null,
    issueCountsByStatus: states, roundsCompletedInPeriod: rounds, recordedProductionVersions: backlog.productionVersions ?? null,
    scope: 'local-project-records-not-production-acceptance' };
}

export async function buildReport(period, collectors = {}) {
  const functions = { d1: collectD1, site: collectSite, project: collectProject, ...collectors };
  const sources = {};
  await Promise.all(Object.entries(functions).map(async ([name, collect]) => {
    try { sources[name] = { status: 'ok', ...await collect(period) }; }
    catch (error) { sources[name] = { status: 'unavailable', ...safeCollectionError(error) }; }
  }));
  return { schemaVersion: 1, reportType: 'xumeng-daily-operations', period, generatedAt: new Date(period.snapshotMs).toISOString(),
    status: ['d1', 'site', 'project'].every(name => sources[name]?.status === 'ok') ? 'complete' : 'partial',
    productionMetricsAvailable: sources.d1.status === 'ok', sources,
    metrics: sources.d1.status === 'ok' ? sources.d1.data : Object.fromEntries(sections.map(name => [name, null])),
    privacy: { aggregateOnly: true, personalIdentifiers: false, privateContent: false, credentials: false },
    unmeasured: ['浏览量及全站 DAU 未埋点，登录/模型活动人数不能代表 DAU。',
      'VIP 为手动续期，不是自动续扣；日报不推算 MRR。',
      '订阅订单没有独立退款金额与确认时间，订阅退款日现金流暂不可统计。',
      'API 账本成本不包含 Cloudflare、发信、支付手续费或完整直播成本，不能作为净利润。',
      '直播缺少统一的 D1 会话/秒数/费用账本，直播时长及真实成本暂未获取。',
      '日报从现存记录计算，删除的账号及其级联记录不可追溯；角色/访客转注册等历史身份变化无法完全还原。'],
  };
}

const titles = { users: '账号与活动', subscriptions: 'VIP 订阅', payments: '付款与收入', credits: 'Credit 账务',
  modelUsage: '模型用量与接口成本', generation: '图片、视频与语音', community: '论坛与玩家任务', creation: '创作与投稿', feedback: '反馈收件箱' };
// Labels for the public aggregate contract are supplemented as metrics evolve.
const labels = {
  ordinaryRegisteredTotal: '普通注册账号（当前）', registeredNew: '新增普通注册账号', guestTotal: '游客账号（当前）',
  superTotal: 'Super 账号（当前）', demoTotal: '演示作者（单列）', activeUsers: '有记录活动的普通账号',
  activeUsersNow: '有效 VIP 人数（当前）', activeUsersAtDayEnd: '报告日结束时有效 VIP 人数',
  paidOrders: '报告日实付订单数', newPaidUsers: '首次购买人数', renewalOrders: '续期订单数',
  scheduledPeriods: '待生效权益期（当前）', expiresNext7DaysUsers: '未来 7 天最终到期人数',
  claims: '报告日领取次数', claimedCredits: '报告日签到发放 Credit', pendingOrdersNow: '待支付订单（当前）',
  currency: '币种', amountScale: '金额小数位', provider: '渠道', kind: '类型', model: '模型', operation: '操作', status: '状态',
  amountMinor: '金额（最小货币单位）', grossAmountMinor: '实付总额（最小货币单位）', refundAmountMinor: '确认退款（最小货币单位）',
  providerCostUsd: '已记录接口费用（USD）', unknownCostRequests: '费用未知请求', promptTokens: '输入 Token', completionTokens: '输出 Token',
  availableNow: '可用 Credit（当前）', reservedNow: '预留 Credit（当前）', debtNow: '欠账 Credit（当前）',
  chargedCredits: '已结算扣除 Credit', dailyGranted: '报告日发放 Credit', releasedRequests: '释放预留请求数',
  chargedRequests: '结算请求数', requests: '请求数', current: '当前快照', daily: '报告日期间',
  audio: '语音', image: '图片', video: '视频', count: '数量', total: '合计', ordinary: '普通账号', super: 'Super 账号',
  paid: '已付款', pending: '待处理', fix: '待修复', improve: '待改进', later: '稍后处理', done: '已完成',
  newRegistrationsByGrant: '报告日新增注册（赠额凭据）', legacyAccountsCreatedInDay: '按账号创建时间计（可与注册赠额新增重叠）',
  activeUsersByRecordedActions: '报告日有记录活动的账号（非 DAU）',
  activeVipUsersCurrent: '有效 VIP 人数（当前）', activePeriodsCurrent: '生效中的权益期（当前）',
  queuedPeriodsCurrent: '排队待生效权益期（当前）', expiringUsersNext7Days: '未来 7 天最终到期会员人数',
  newPaidOrdersInDay: '报告日确认付款订单', firstPurchaseOrdersInDay: '首次购买订单', repeatPurchaseOrdersInDay: '再次购买订单',
  dailyClaimCount: '报告日签到领取次数', dailyClaimCredits: '报告日签到发放 Credit', revokedPeriodsInDay: '报告日撤销权益期',
  refundedOrdersTotal: '已标记退款订单（当前累计）', refundCashflowInDay: '报告日订阅退款现金流', automaticRenewal: '自动续扣',
  createdByStatus: '报告日创建订单，按当前状态', orderCount: '订单数', mode: '支付模式',
  refundAmountMinorCurrentlyForTheseOrders: '这些实付订单当前累计退款额（最小货币单位）',
  refunds: '已确认充值退款', confirmedCount: '确认数量', basis: '时间口径', subscriptionRefundedOrdersTotal: '退款订阅订单（当前累计）',
  superPaid: 'Super 实付（单列）', grants: '报告日 Credit 入账流水', source: '来源', credits: 'Credit 数值',
  modelChargeCredits: '报告日模型结算扣除 Credit', mediaChargeCredits: '报告日媒体结算扣除 Credit',
  modelReleaseCount: '报告日模型释放预留次数', mediaReleaseCount: '报告日媒体释放预留次数',
  currentAvailableCredits: '可用 Credit（当前）', currentReservedCredits: '预留 Credit（当前）', currentDebtCredits: '欠账 Credit（当前）',
  legacySuper: '历史 Super 免扣请求（单列）', requestsCreated: '报告日发起请求数', promptTokensKnown: '已回填输入 Token',
  completionTokensKnown: '已回填输出 Token', tokenUsageUnknownCount: 'Token 用量未知请求数',
  providerCostUsdKnown: '已记录接口成本（USD）', providerCostUnknownCount: '成本未知请求数',
  jobsCreated: '报告日创建任务数', costBasis: '成本口径', chatMedia: '聊天内媒体请求', live: '直播会话/时长/费用',
  postsCreated: '报告日普通账号主题数', repliesCreated: '报告日普通账号回复数',
  demoPostsCreated: '报告日演示主题数（单列）', demoRepliesCreated: '报告日演示回复数（单列）',
  pendingReportsCurrent: '普通账号待处理举报（当前）', tasksCreated: '报告日玩家任务创建数',
  assignmentsCreated: '报告日任务领取数', communityRewardPoints: '报告日社区奖励积分（非 Credit）',
  newNovels: '报告日新建小说数', newGames: '报告日新建游戏数', newScenarios: '报告日新建团本数',
  newPublications: '报告日新增投稿角色记录数（未必已上线）', submissionsCreated: '报告日提交投稿数', pendingSubmissionsCurrent: '普通账号待审投稿（当前）',
  conversationsUpdated: '报告日有更新的现存会话数', messagesTotalCurrent: '现存消息数量（当前）',
  privateCharactersTotalCurrent: '现存私人角色数量（当前）', received: '报告日收到群反馈数',
  statusCurrent: '反馈状态（当前）', decisionsInDay: '报告日反馈处理次数',
};
const escape = value => String(value).replace(/[|\n\r]/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const valueLabels = { cny: 'CNY', usd: 'USD', usdt: 'USDT', zpay: 'ZPay', stripe: 'Stripe', nowpayments: 'NOWPayments', subscription: 'VIP 订阅', recharge: '充值',
  live: '真实支付', test: '测试支付', new_signup: '新注册赠额', daily_grant: 'VIP 签到',
  settled: '已结算', reserved: '已预留', released: '已释放', pending: '待处理', processing: '生成中', ready: '已完成',
  failed: '失败', unknown: '结果未知', paid: '已付款', refunded: '已退款', partially_refunded: '部分退款', expired: '已过期',
  fix: '待修复', improve: '待改进', later: '稍后处理', done: '已完成',
  provider_usage: '供应商实际用量', frozen_sku: '冻结 SKU 估价', chat: '对话', memory: '摘要', audio: '语音', image: '图片', video: '视频' };
Object.assign(valueLabels, { stripe_purchase: 'Stripe 实付充值', stripe_refund_adjustment: 'Stripe 退款 Credit 调整',
  zpay_purchase: 'ZPay 实付充值', zpay_refund_adjustment: 'ZPay 退款 Credit 调整', vip_daily_grant: 'VIP 签到赠额',
  signup_gift: '新注册赠额', operator_grant: '站主赠额', admin_adjustment: '管理手动调整',
  last_refund_state_update_not_cash_time: 'Stripe 退款最终状态更新（非现金打款时间）',
  verified_receipt_time_not_cash_time: 'ZPay 退款确认凭据时间（非现金打款时间）' });
const display = value => value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? '未获取' : typeof value === 'boolean' ? (value ? '是' : '否')
  : typeof value === 'number' ? value.toLocaleString('zh-CN', { maximumFractionDigits: 8 }) : escape(valueLabels[value] ?? value);
const usdtMoney = value => {
  const minor = typeof value === 'bigint' ? value : Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return minor === null || minor < 0n ? '未获取' : `${minor / 1_000_000n}.${String(minor % 1_000_000n).padStart(6, '0')}`;
};
const usdtMoneyLabels = { amountMinor: '金额（USDT）', grossAmountMinor: '已确认订单总额（USDT）',
  refundAmountMinorCurrentlyForTheseOrders: '这些实付订单当前累计退款额（USDT）' };
function tableFor(object, prefix = '') {
  const rows = [];
  for (const [key, value] of Object.entries(object)) {
    const usdtAmount = object.currency === 'usdt' && object.amountScale === 6 && Object.hasOwn(usdtMoneyLabels, key);
    const label = prefix + (usdtAmount ? usdtMoneyLabels[key] : labels[key] ?? key);
    if (Array.isArray(value)) {
      if (!value.length) rows.push(`| ${escape(label)} | 无记录 |`);
      for (let i = 0; i < value.length; i++) {
        if (value[i] && typeof value[i] === 'object') rows.push(...tableFor(value[i], `${label} / ${i + 1} / `));
        else rows.push(`| ${escape(label)} / ${i + 1} | ${display(value[i])} |`);
      }
    } else if (value && typeof value === 'object') rows.push(...tableFor(value, `${label} / `));
    else rows.push(`| ${escape(label)} | ${usdtAmount ? usdtMoney(value) : display(value)} |`);
  }
  return rows;
}
export function renderMarkdown(report) {
  const { period, sources } = report;
  const usdtReceipts = [...(report.metrics.payments?.paid ?? []), ...(report.metrics.payments?.superPaid ?? [])];
  const hasUsdt = usdtReceipts.some(row => row.currency === 'usdt');
  const generated = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(report.generatedAt));
  const lines = [`# 叙梦经营日报 · ${period.date}`, '', `统计范围：北京时间 ${period.date} 00:00–24:00。生成时间：${generated}。`, '',
    report.productionMetricsAvailable ? '正式数据：已读取 Cloudflare D1 的单条只读聚合快照。当前状态指标以生成时刻为准。'
      : '**正式经营数据未获取，以下缺失项不能当作 0。**', '', '## 采集状态', '', '| 来源 | 结果 |', '| --- | --- |'];
  for (const [name, source] of Object.entries(sources)) lines.push(`| ${({ d1: '正式 D1 数据', site: '主站 HTTP', project: '本地迭代台账' })[name]} | ${source.status === 'ok' ? '已获取' : escape(source.message)} |`);
  if (report.productionMetricsAvailable) {
    const m = report.metrics;
    lines.push('', '## 今日概览', '', '| 指标 | 结果 |', '| --- | --- |',
      `| 新增注册 | ${display(m.users.newRegistrationsByGrant)} |`,
      `| 有效 VIP（当前） | ${display(m.subscriptions.activeVipUsersCurrent)} |`,
      `| VIP 首购 / 再次购买 | ${display(m.subscriptions.firstPurchaseOrdersInDay)} / ${display(m.subscriptions.repeatPurchaseOrdersInDay)} |`,
      `| 未来 7 天最终到期会员 | ${display(m.subscriptions.expiringUsersNext7Days)} |`,
      `| 签到发放 Credit | ${display(m.subscriptions.dailyClaimCredits)} |`,
      `| 实际结算消费 Credit | ${display(m.credits.modelChargeCredits + m.credits.mediaChargeCredits)} |`);
    for (const currency of ['cny', 'usd']) {
      const amount = (m.payments.paid ?? []).filter(row => row.currency === currency).reduce((n, row) => n + row.grossAmountMinor, 0);
      lines.push(`| 普通账号实付毛额（${currency.toUpperCase()}，未扣退款） | ${display(amount / 100)} |`);
    }
    if (hasUsdt) {
      const rows = m.payments.paid.filter(row => row.currency === 'usdt');
      const valid = rows.every(row => row.amountScale === 6 && Number.isSafeInteger(row.grossAmountMinor) && row.grossAmountMinor >= 0);
      const amount = valid ? rows.reduce((n, row) => n + BigInt(row.grossAmountMinor), 0n) : null;
      lines.push(`| 普通账号已确认订单总额（USDT） | ${usdtMoney(amount)} |`);
    }
  }
  for (const name of sections) {
    lines.push('', `## ${titles[name]}`, '');
    if (!report.metrics[name]) lines.push('未获取。');
    else lines.push('| 指标 | 数值 |', '| --- | --- |', ...tableFor(report.metrics[name]));
  }
  lines.push('', '## 网站与本地迭代', '');
  if (sources.site.status === 'ok') lines.push(`主站 HTTP：${sources.site.httpStatus}；当前页面资源：${escape(sources.site.js)}。这仅验证公开页面可达。`, '');
  if (sources.project.status === 'ok') {
    const p = sources.project;
    lines.push(`当前轮次：${escape(p.currentRound ?? '未记录')}；状态：${escape(p.activeRoundStatus ?? '未记录')}。`, '', '| 问题状态 | 数量 |', '| --- | --- |');
    for (const [name, count] of Object.entries(p.issueCountsByStatus)) lines.push(`| ${escape(name)} | ${display(count)} |`);
    lines.push('', `报告日期间归档轮次：${p.roundsCompletedInPeriod.length}。仅为本地记录，不能替代正式验收。`);
    if (p.roundsCompletedInPeriod.length) {
      lines.push('', '| 轮次 | 结果 | 关闭问题 | 发布次数 |', '| --- | --- | --- | --- |');
      for (const round of p.roundsCompletedInPeriod) lines.push(`| ${escape(round.id)} | ${escape(round.status)} | ${display(round.issuesClosed)} | ${display(round.publishes)} |`);
    }
  }
  lines.push('', '## 指标口径与限制', '',
    '- 普通经营账号排除游客、演示作者和当前 Super；Super 用量单列。未标记的测试账号无法自动识别。',
    `- 付款按确认付款时间统计，排除 Stripe 测试模式；待支付不计收入。CNY 与 USD${hasUsdt ? ' 与 USDT' : ''} 分开，金额单位见列名。`,
    ...(hasUsdt ? ['- USDT 使用 6 位小数，JSON 金额为 microUSDT；不折算 CNY 或 USD。NOWPayments 按已确认订单面额统计，超额付款、实际结算及退款现金流未核实；支付手续费与网络费用未获取，订单总额不是净利润。'] : []),
    '- Credit 是钱包点数，不是现金收入；释放预留不是退款收入。费用未知时列为未知，不补零。',
    '- 模型/媒体按报告日发起的请求统计，费用与状态是采集时已回填结果；日后补核会变化，不能当作供应商当日账单。',
    '- 注册新增按 new_signup 赠额凭据日期统计，包含游客转注册；凭据上线前的历史注册无法还原。',
    ...report.unmeasured.map(item => `- ${item}`), '', '仅保存统计数字、模型维度及本地迭代状态，不保存邮箱、个人身份、聊天正文、反馈原文或密钥。', '');
  return lines.join('\n');
}

async function readExisting(file) {
  try {
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record?.schemaVersion !== 1 || record?.reportType !== 'xumeng-daily-operations'
        || !/^\d{4}-\d{2}-\d{2}$/.test(record?.period?.date ?? '') || !['partial', 'complete'].includes(record.status)
        || typeof record.productionMetricsAvailable !== 'boolean' || !record.sources || !record.metrics) throw new Error('Invalid existing report.');
    return record;
  } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Existing report is invalid; preserved without overwrite.'); }
}
export async function atomicWrite(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, data, { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export async function saveReport(report, directory = defaultOutput) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const jsonPath = resolve(directory, `${report.period.date}.json`), markdownPath = resolve(directory, `${report.period.date}.md`);
  const previous = await readExisting(jsonPath);
  // Check canonical pointers before changing any existing artifact. A corrupted
  // pointer is preserved for diagnosis rather than silently replaced.
  await readExisting(resolve(directory, 'latest.json'));
  await readExisting(resolve(directory, 'latest-successful.json'));
  if (previous?.productionMetricsAvailable && !report.productionMetricsAvailable) {
    const attemptPath = resolve(directory, `${report.period.date}.failed-${report.period.snapshotMs}.json`);
    await atomicWrite(attemptPath, JSON.stringify(report, null, 2) + '\n');
    await repairDerivedReports(previous, directory);
    return { preservedPrevious: true, jsonPath, markdownPath, attemptPath };
  }
  const raw = JSON.stringify(report, null, 2) + '\n', markdown = renderMarkdown(report);
  await atomicWrite(markdownPath, markdown);
  await atomicWrite(jsonPath, raw);
  await repairDerivedReports(report, directory);
  return { preservedPrevious: false, jsonPath, markdownPath };
}

export async function repairDerivedReports(report, directory) {
  const latest = await readExisting(resolve(directory, 'latest.json'));
  const successful = await readExisting(resolve(directory, 'latest-successful.json'));
  const chosen = !latest || latest.period.date <= report.period.date ? report : latest;
  // JSON is canonical. On a repeated run, repair missing or interrupted Markdown
  // output without making another production request or changing the metrics.
  await atomicWrite(resolve(directory, `${report.period.date}.md`), renderMarkdown(report));
  await atomicWrite(resolve(directory, 'latest.md'), renderMarkdown(chosen));
  await atomicWrite(resolve(directory, 'latest.json'), JSON.stringify(chosen, null, 2) + '\n');
  const chosenSuccess = report.productionMetricsAvailable && (!successful || successful.period.date <= report.period.date) ? report : successful;
  if (chosenSuccess) {
    await atomicWrite(resolve(directory, 'latest-successful.md'), renderMarkdown(chosenSuccess));
    await atomicWrite(resolve(directory, 'latest-successful.json'), JSON.stringify(chosenSuccess, null, 2) + '\n');
  }
  const dates = (await readdir(directory)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
  await atomicWrite(resolve(directory, 'index.md'), '# 叙梦日报归档\n\n' + dates.map(name => `- [${name.slice(0, 10)}](./${name.slice(0, 10)}.md)`).join('\n') + '\n');
}

export async function withReportLock(directory, callback) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = resolve(directory, '.report.lock'), owner = { pid: process.pid, host: hostname(), runId: randomUUID() };
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another daily report run holds the lock. Check its process before removing a stale lock.'); throw error; }
  try { await lock.writeFile(JSON.stringify(owner)); return await callback(); }
  finally { await lock.close(); if (await readFile(lockPath, 'utf8').catch(() => '') === JSON.stringify(owner)) await rm(lockPath); }
}

export async function runReport({ date, nowMs = Date.now(), directory = defaultOutput, refresh = false, collectors } = {}) {
  const period = reportPeriod(date, nowMs);
  return withReportLock(directory, async () => {
    const previous = await readExisting(resolve(directory, `${period.date}.json`));
    if (!refresh && previous?.status === 'complete') {
      await repairDerivedReports(previous, directory);
      return { status: 'already-generated', markdownPath: resolve(directory, `${period.date}.md`), jsonPath: resolve(directory, `${period.date}.json`) };
    }
    const report = await buildReport(period, collectors);
    return { status: report.status, productionMetricsAvailable: report.productionMetricsAvailable, ...await saveReport(report, directory) };
  });
}
