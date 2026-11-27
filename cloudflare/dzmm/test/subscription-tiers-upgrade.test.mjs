import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { splitSqlStatements } from './sql-migrations.mjs';

async function loadDep(name, fallbackRel) {
  try { return await import(name); }
  catch { return await import(new URL(fallbackRel, import.meta.url).href); }
}

const { Miniflare, convertV4MiniflareOptions } = await loadDep('miniflare', '../../dzmm-web/node_modules/miniflare/dist/src/index.js');
const esbuild = await loadDep('esbuild', '../../../node_modules/esbuild/lib/main.js');

const DAY = 86_400_000;
const PLANS = [
  { id: 'vip_weekly', label: '体验周卡', tier: 1, revision: 3, amountMinor: 1800, currency: 'cny', durationDays: 7, dailyCredits: 300, maxClaims: 7, timezone: 'Asia/Shanghai', dailyAudioLimit: 10, dailyImageLimit: 3 },
  { id: 'vip_monthly_basic', label: '基础月卡', tier: 2, revision: 2, amountMinor: 3800, currency: 'cny', durationDays: 30, dailyCredits: 300, maxClaims: 30, timezone: 'Asia/Shanghai', dailyAudioLimit: 20, dailyImageLimit: 5 },
  { id: 'vip_monthly_pro', label: '进阶月卡', tier: 3, revision: 2, amountMinor: 8800, currency: 'cny', durationDays: 30, dailyCredits: 750, maxClaims: 30, timezone: 'Asia/Shanghai', dailyAudioLimit: 40, dailyImageLimit: 10 },
  { id: 'vip_monthly_ultra', label: '尊享月卡', tier: 4, revision: 2, amountMinor: 18800, currency: 'cny', durationDays: 30, dailyCredits: 1700, maxClaims: 30, timezone: 'Asia/Shanghai', dailyAudioLimit: 80, dailyImageLimit: 20 },
];

async function loadModules() {
  const dir = await mkdtemp(join(tmpdir(), 'dzmm-sub-upgrade-test-'));
  const subOut = join(dir, 'subscriptions.mjs');
  const guaguaVipOut = join(dir, 'guagua-vip.mjs');
  const common = {
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['node:*', 'cloudflare:*', '@elevenlabs/elevenlabs-js'],
  };
  await Promise.all([
    esbuild.build({ ...common, entryPoints: [new URL('../src/subscriptions.ts', import.meta.url).pathname], outfile: subOut }),
    esbuild.build({ ...common, entryPoints: [new URL('../src/guagua-vip.ts', import.meta.url).pathname], outfile: guaguaVipOut }),
  ]);
  const [subMod, gvMod] = await Promise.all([
    import(pathToFileURL(subOut).href),
    import(pathToFileURL(guaguaVipOut).href),
  ]);
  return { subMod, gvMod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const { subMod, gvMod, cleanup: cleanupBundles } = await loadModules();
const { handleSubscriptions } = subMod;
const { fulfillGuaguaVip, readGuaguaVipByOrder } = gvMod;

async function createMigratedD1() {
  const options = {
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  const db = await mf.getD1Database('DB');
  const migrationsDir = new URL('../migrations/', import.meta.url);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.includes('0098_subscription_tiers_upgrade.sql'));
  for (const file of files) {
    if (file === '0090_guagua_first_half.sql') continue;
    const sql = await readFile(new URL(file, migrationsDir), 'utf8');
    const stmts = splitSqlStatements(sql).filter((part) => part.trim());
    if (stmts.length) await db.batch(stmts.map((stmt) => db.prepare(stmt)));
  }
  return { mf, db };
}

test('4-tier weekly + monthly plans support prorated trade-in upgrades, anti-tamper checks, chained upgrades, and queued-period shifting', async () => {
  const { mf, db } = await createMigratedD1();
  const baseNow = Date.UTC(2026, 10, 27, 4, 0, 0); // 2026-11-27 12:00 Asia/Shanghai
  let clock = baseNow;

  try {
    const userId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await db.batch([
      db.prepare('INSERT INTO users(id,email,nickname,is_guest,role,created_at) VALUES(?,?,?,0,?,?)')
        .bind(userId, 'vip-tier@example.com', '会员测试', 'user', baseNow),
      db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
        .bind(tokenHash, userId, baseNow + 90 * DAY, baseNow),
    ]);
    const user = { id: userId, email: 'vip-tier@example.com', nickname: '会员测试', isGuest: false, role: 'user', version: 0 };
    const env = {
      DB: db,
      APP_ORIGINS: 'https://xumengchat.top',
      PAYMENTS_ACCEPTING_ENABLED: 'true',
      PAYMENT_PROVIDER: 'guagua',
      GUAGUA_ENABLED: 'true',
      GUAGUA_MID: 'M123456',
      GUAGUA_SECRET: '0123456789abcdef0123456789abcdef',
      GUAGUA_CHANNEL_CODE: 'WX01',
      SUBSCRIPTION_ENABLED: 'true',
      SUBSCRIPTION_PLANS_JSON: JSON.stringify(PLANS),
    };

    const callSub = async (path, { method = 'GET', body } = {}) => {
      let res;
      try {
        res = await handleSubscriptions(
          new Request(`https://xumengchat.top${path}`, {
            method,
            headers: {
              Cookie: `dzmm_session=${token}`,
              'CF-Connecting-IP': '127.0.0.1',
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          }),
          env,
          user,
          { now: () => clock },
        );
      } catch (error) {
        if (!Number.isInteger(error?.status)) throw error;
        return { status: error.status, data: { error: error.message } };
      }
      return { status: res.status, data: await res.json() };
    };

    // 0. Migration 0098 repairs any dangling *_old FK references left by 0091_weekly_vip.sql
    const brokenRefs = await db
      .prepare("SELECT name, sql FROM sqlite_master WHERE sql LIKE '%subscription_orders_old%' OR sql LIKE '%subscription_periods_old%'")
      .all();
    assert.deepEqual(brokenRefs.results, []);

    const payVipOrder = async (orderId, amountMinor) => {
      const payment = await readGuaguaVipByOrder(env, orderId, userId);
      assert.ok(payment);
      const fact = { merOrderTid: payment.mer_order_tid, tid: `T${randomUUID().replace(/-/g, '').slice(0, 20)}`, amountMinor, status: 1 };
      await fulfillGuaguaVip(env, payment, fact, 'notify', clock);
      // Duplicate callback must be idempotent
      await fulfillGuaguaVip(env, payment, fact, 'notify', clock);
    };

    // 1. Config exposes all 4 plans including tiered media quotas
    const cfg = await callSub('/v1/subscriptions/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.data.enabled, true);
    assert.equal(cfg.data.plans.length, 4);
    assert.deepEqual(cfg.data.plans.map((p) => [p.id, p.tier, p.amountMinor, p.dailyCredits, p.dailyAudioLimit, p.dailyImageLimit]), [
      ['vip_weekly', 1, 1800, 300, 10, 3],
      ['vip_monthly_basic', 2, 3800, 300, 20, 5],
      ['vip_monthly_pro', 3, 8800, 750, 40, 10],
      ['vip_monthly_ultra', 4, 18800, 1700, 80, 20],
    ]);

    // 2. Buy Experience Weekly (¥18, 7 days, 300/day)
    const weeklyOrder = await callSub('/v1/subscriptions/checkout', {
      method: 'POST',
      body: { accountId: userId, planId: 'vip_weekly', planRevision: 3, requestId: randomUUID(), provider: 'zpay', mode: 'live', method: 'wxpay' },
    });
    assert.equal(weeklyOrder.status, 201);
    assert.equal(weeklyOrder.data.order.amountMinor, 1800);
    await payVipOrder(weeklyOrder.data.order.id, 1800);

    // Check initial full trade-in quotes (7/7 remaining -> ¥18 off)
    let overview = (await callSub('/v1/subscriptions')).data;
    assert.equal(overview.subscriptions.length, 1);
    const weeklySubId = overview.subscriptions[0].id;
    assert.equal(overview.subscriptions[0].status, 'active');
    assert.equal(overview.upgrades.vip_weekly, undefined);
    assert.equal(overview.upgrades.vip_monthly_basic.tradeInMinor, 1800);
    assert.equal(overview.upgrades.vip_monthly_basic.payableAmountMinor, 2000);
    assert.equal(overview.upgrades.vip_monthly_pro.tradeInMinor, 1800);
    assert.equal(overview.upgrades.vip_monthly_pro.payableAmountMinor, 7000);
    assert.equal(overview.upgrades.vip_monthly_ultra.tradeInMinor, 1800);
    assert.equal(overview.upgrades.vip_monthly_ultra.payableAmountMinor, 17000);

    // 3. Claim 2 days of weekly credits (600 total) -> 5/7 remaining -> trade-in drops to floor(1800*5/7)=1285
    const claim1 = await callSub('/v1/subscriptions/checkin', {
      method: 'POST',
      body: { accountId: userId, subscriptionId: weeklySubId, requestId: randomUUID(), provider: 'zpay', mode: 'live' },
    });
    assert.equal(claim1.status, 201);
    assert.equal(claim1.data.claim.credits, 300);

    clock += DAY;
    const claim2 = await callSub('/v1/subscriptions/checkin', {
      method: 'POST',
      body: { accountId: userId, subscriptionId: weeklySubId, requestId: randomUUID(), provider: 'zpay', mode: 'live' },
    });
    assert.equal(claim2.status, 201);
    assert.equal(claim2.data.claim.credits, 300);

    overview = (await callSub('/v1/subscriptions')).data;
    assert.equal(overview.upgrades.vip_monthly_pro.remainingUnits, 5);
    assert.equal(overview.upgrades.vip_monthly_pro.tradeInMinor, 1285);
    assert.equal(overview.upgrades.vip_monthly_pro.payableAmountMinor, 7515);

    // 4. Stale expectedAmountMinor (¥70 instead of ¥75.15) must be rejected with 409
    const staleUpgrade = await callSub('/v1/subscriptions/checkout', {
      method: 'POST',
      body: {
        accountId: userId, planId: 'vip_monthly_pro', planRevision: 2, requestId: randomUUID(),
        provider: 'zpay', mode: 'live', method: 'wxpay',
        upgradeFromSubscriptionId: weeklySubId, expectedAmountMinor: 7000,
      },
    });
    assert.equal(staleUpgrade.status, 409);

    // 5. Valid prorated upgrade checkout (¥75.15) -> pay -> weekly retired as 'upgraded', Pro active immediately for full 30 days
    const proUpgrade = await callSub('/v1/subscriptions/checkout', {
      method: 'POST',
      body: {
        accountId: userId, planId: 'vip_monthly_pro', planRevision: 2, requestId: randomUUID(),
        provider: 'zpay', mode: 'live', method: 'wxpay',
        upgradeFromSubscriptionId: weeklySubId, expectedAmountMinor: 7515,
      },
    });
    assert.equal(proUpgrade.status, 201);
    assert.equal(proUpgrade.data.order.amountMinor, 7515);
    assert.equal(proUpgrade.data.order.listAmountMinor, 8800);
    assert.equal(proUpgrade.data.order.tradeInMinor, 1285);
    assert.equal(proUpgrade.data.order.upgradeFromSubscriptionId, weeklySubId);

    await payVipOrder(proUpgrade.data.order.id, 7515);

    overview = (await callSub('/v1/subscriptions')).data;
    const activePro = overview.subscriptions.find((s) => s.status === 'active');
    const retiredWeekly = overview.subscriptions.find((s) => s.id === weeklySubId);
    assert.ok(activePro);
    assert.equal(activePro.planId, 'vip_monthly_pro');
    assert.equal(activePro.dailyCredits, 750);
    assert.equal(activePro.startsAt, clock);
    assert.equal(activePro.expiresAt, clock + 30 * DAY);
    assert.equal(retiredWeekly?.status, 'upgraded');
    assert.equal(retiredWeekly?.upgradedToOrderId, proUpgrade.data.order.id);

    // 6. Next day check-in grants 750 credits from the upgraded Pro monthly plan
    clock += DAY;
    const claimPro = await callSub('/v1/subscriptions/checkin', {
      method: 'POST',
      body: { accountId: userId, subscriptionId: activePro.id, requestId: randomUUID(), provider: 'zpay', mode: 'live' },
    });
    assert.equal(claimPro.status, 201);
    assert.equal(claimPro.data.claim.credits, 750);

    // 7. Chained upgrade (Pro -> Ultra) uses Pro's full listAmountMinor (8800), NOT just the ¥75.15 paid previously!
    // 29/30 remaining -> floor(8800 * 29 / 30) = 8506 -> payable = 18800 - 8506 = 10294
    overview = (await callSub('/v1/subscriptions')).data;
    assert.equal(overview.upgrades.vip_monthly_basic, undefined, 'lower tier must not offer upgrade');
    assert.equal(overview.upgrades.vip_monthly_pro, undefined, 'same tier must not offer upgrade');
    assert.equal(overview.upgrades.vip_monthly_ultra.remainingUnits, 29);
    assert.equal(overview.upgrades.vip_monthly_ultra.tradeInMinor, 8506);
    assert.equal(overview.upgrades.vip_monthly_ultra.payableAmountMinor, 10294);

    // 8. Lower-tier purchase queues normally at full price; then upgrading active Pro shifts queued period cleanly with zero overlap!
    const queuedBasicOrder = await callSub('/v1/subscriptions/checkout', {
      method: 'POST',
      body: { accountId: userId, planId: 'vip_monthly_basic', planRevision: 2, requestId: randomUUID(), provider: 'zpay', mode: 'live', method: 'wxpay' },
    });
    assert.equal(queuedBasicOrder.status, 201);
    assert.equal(queuedBasicOrder.data.order.amountMinor, 3800);
    await payVipOrder(queuedBasicOrder.data.order.id, 3800);

    overview = (await callSub('/v1/subscriptions')).data;
    const queuedBefore = overview.subscriptions.find((s) => s.status === 'queued');
    assert.ok(queuedBefore);
    assert.equal(queuedBefore.startsAt, activePro.expiresAt);
    assert.equal(queuedBefore.expiresAt - queuedBefore.startsAt, 30 * DAY);

    // Now upgrade active Pro -> Ultra while queuedBasic exists
    const ultraUpgrade = await callSub('/v1/subscriptions/checkout', {
      method: 'POST',
      body: {
        accountId: userId, planId: 'vip_monthly_ultra', planRevision: 2, requestId: randomUUID(),
        provider: 'zpay', mode: 'live', method: 'wxpay',
        upgradeFromSubscriptionId: activePro.id, expectedAmountMinor: 10294,
      },
    });
    assert.equal(ultraUpgrade.status, 201);
    await payVipOrder(ultraUpgrade.data.order.id, 10294);

    overview = (await callSub('/v1/subscriptions')).data;
    const activeUltra = overview.subscriptions.find((s) => s.status === 'active');
    const queuedAfter = overview.subscriptions.find((s) => s.id === queuedBefore.id);
    assert.equal(activeUltra?.planId, 'vip_monthly_ultra');
    assert.equal(activeUltra?.startsAt, clock);
    assert.equal(activeUltra?.expiresAt, clock + 30 * DAY);
    // Queued Basic was shifted so it starts right when Ultra ends, keeping exact 30-day duration!
    assert.equal(queuedAfter?.status, 'queued');
    assert.equal(queuedAfter?.startsAt, activeUltra.expiresAt);
    assert.equal(queuedAfter?.expiresAt - queuedAfter?.startsAt, 30 * DAY);
  } finally {
    await mf.dispose();
    await cleanupBundles();
  }
});
