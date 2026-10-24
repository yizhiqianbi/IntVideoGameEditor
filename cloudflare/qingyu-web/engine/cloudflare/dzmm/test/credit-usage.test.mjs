import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { build } from 'esbuild';

const { creditBillingConfig, quoteCreditUsage, reserveCreditUsage, finalizeCreditUsage, releaseExpiredCreditUsage, getPendingCreditUsage,
  creditUsageBalanceStatement, CREDIT_RESERVATION_TTL_MS } = await tsImport('../src/credit-usage.ts', import.meta.url);
const { chargeDzmmCreditTokens, reserveDzmmCreditCost, chargeDzmmProviderCostUsd } = await tsImport('../../../src/lib/dzmm-credit-pricing.ts', import.meta.url);
const { DZMM_MODEL_OPTIONS, dzmmModelCostPolicy } = await tsImport('../../../src/lib/dzmm-models.ts', import.meta.url);
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { liveWallet } = await tsImport('../src/payment-wallet.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
const BASE = Date.now(), rates = { revision: 1, inputCreditsPer1000: 3, outputCreditsPer1000: 9 };
const costPolicy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
const costRates = { revision: 1, inputCreditsPer1000: 4.022753, outputCreditsPer1000: 12.068258 };
function useCostPolicy(f) { f.env = { ...f.env, CREDIT_BILLING_RATES_JSON: JSON.stringify(costRates),
  CREDIT_BILLING_COST_POLICY_JSON: JSON.stringify(costPolicy) }; return f; }
let store, DB;
function memoryStore(name) { return new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
  script: 'export default {fetch(){return new Response("isolated credit store")}}', d1Databases: { DB: name } })); }
async function migrate(database, files = migrations) {
  for (const file of files) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
}
before(async () => { store = memoryStore('credit-usage-tests'); DB = await store.getD1Database('DB'); await migrate(DB); });
after(async () => { await store?.dispose(); });
async function fixture(database = DB, isGuest = false) {
  const user = { id: randomUUID(), email: `${randomUUID()}@credit.example.test`, nickname: '计费测试', isGuest, role: 'user', version: 0 };
  const token = randomBytes(32).toString('hex'), hash = createHash('sha256').update(token).digest('hex');
  await database.batch([
    database.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,?,?)').bind(user.id, user.email, user.nickname, isGuest ? 1 : 0, BASE),
    database.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash, user.id, BASE + 86400000, BASE),
  ]);
  return { user, token, hash, now: BASE, env: { DB: database, APP_ORIGINS: 'https://credit.example.test', CREDIT_BILLING_ENABLED: 'true', CREDIT_BILLING_RATES_JSON: JSON.stringify(rates) } };
}
function request(f, path = '/v1/billing/usage') { return new Request(`https://credit.example.test${path}`, { headers: { Cookie: `qingyu_session=${f.token}` } }); }
function input(extra = {}) { return { requestId: randomUUID(), operation: 'chat', model: 'provider/story-model',
  requestFingerprint: createHash('sha256').update(randomUUID()).digest('hex'), inputTokenUpperBound: 1000, maxOutputTokens: 8000, ...extra }; }
function reserve(f, value = input(), env = f.env) { return reserveCreditUsage(request(f), env, f.user, value, { now: () => f.now }); }
function quote(f, value = input(), env = f.env) { return quoteCreditUsage(request(f), env, f.user, value, { now: () => f.now }); }
function finalize(f, reservation, extra = {}, env = f.env) { return finalizeCreditUsage(env, { reservationId: reservation.receipt.id,
  accountId: f.user.id, claimToken: reservation.claimToken, outcome: 'completed', hasValidOutput: true,
  usage: { promptTokens: 500, completionTokens: 500 }, ...extra }, { now: () => f.now }); }
function balance(f) { return creditUsageBalanceStatement(f.env, f.user.id).first(); }
async function fundStripe(f, mode = 'live', credits = 100) {
  const orderId = `pay_${randomUUID()}`, eventId = `evt_${randomUUID()}`;
  await f.env.DB.batch([
    f.env.DB.prepare(`INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at)
      VALUES(?,?,?, ?,?,?,?,'paid',?,?,?)`).bind(orderId, f.user.id, randomUUID(), `usd_${credits / 100}`, credits, credits, mode, BASE, BASE, BASE),
    f.env.DB.prepare("INSERT INTO payment_events VALUES(?,'checkout.session.completed',?,'isolated',?)").bind(eventId, orderId, BASE),
    f.env.DB.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',?,?)")
      .bind(orderId, f.user.id, eventId, credits, BASE),
  ]);
  return orderId;
}
async function fundZpay(f) {
  const orderId = `zp_${randomUUID()}`, eventId = `zp_evt_${randomUUID()}`;
  await f.env.DB.batch([
    f.env.DB.prepare(`INSERT INTO zpay_orders(id,user_id,request_id,package_id,amount_minor,credits,method,out_trade_no,merchant_pid,channel_id,payment_name,checkout_url,status,created_at,updated_at,paid_at)
      VALUES(?,?,?,'cny_28',2800,2800,'alipay',?,'isolated_pid','123','isolated order','https://credit.example.test','paid',?,?,?)`)
      .bind(orderId, f.user.id, randomUUID(), randomBytes(16).toString('hex').replace(/[a-f]/g, '1'), BASE, BASE, BASE),
    f.env.DB.prepare("INSERT INTO zpay_events VALUES(?,'notify',?,'isolated_trade','isolated',?)").bind(eventId, orderId, BASE),
    f.env.DB.prepare("INSERT INTO zpay_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',2800,?)")
      .bind(orderId, f.user.id, eventId, BASE),
  ]);
}
function status(expected) { return error => error?.status === expected; }

test('readonly quotes preserve explicitly free guest mode and paid mode still rejects guests', async () => {
  const f = await fixture(DB, true), value = input();
  const disabled = { ...f.env, CREDIT_BILLING_ENABLED: 'false' };
  assert.deepEqual(await quoteCreditUsage(request(f), disabled, f.user, value), { enabled: false });
  await assert.rejects(quoteCreditUsage(request(f), f.env, f.user, value), status(403));
  assert.equal((await balance(f)).reserved_credits, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(f.user.id).first()).n, 0);
});
function brokenDatabase(database) { return { prepare: sql => database.prepare(sql), batch: statements => database.batch([
  ...statements, database.prepare('SELECT * FROM deliberately_missing_billing_table'),
]) }; }

test('billing is disabled without a complete explicit server rate configuration; client amounts and malformed rates are rejected', async () => {
  const f = await fixture(); await fundStripe(f);
  assert.equal(creditBillingConfig({ ...f.env, CREDIT_BILLING_ENABLED: undefined }).enabled, false);
  for (const source of [undefined, 'bad-json', '{}', JSON.stringify({ ...rates, inputCreditsPer1000: 0 }), JSON.stringify({ ...rates, outputCreditsPer1000: 0.1 }), JSON.stringify({ ...rates, extra: 2 })]) {
    const env = { ...f.env, CREDIT_BILLING_RATES_JSON: source };
    assert.equal(creditBillingConfig(env).enabled, false); await assert.rejects(reserve(f, input(), env), status(503));
  }
  for (const extra of [{ credits: 1 }, { priceRevision: 2 }, { inputTokenUpperBound: -1 }, { maxOutputTokens: 1.5 }, { requestFingerprint: 'fake' }])
    await assert.rejects(reserve(f, input(extra)), status(400));
  assert.equal((await balance(f)).reserved_credits, 0);
});

test('a 100 Credit cost quote reduces only the output ceiling and never creates a hold or changes the request', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const value = input({ inputTokenUpperBound: 7290, maxOutputTokens: 2048 }), original = { ...value };
  assert.equal(reserveDzmmCreditCost(value.inputTokenUpperBound, value.maxOutputTokens, costPolicy), 119);
  const budget = await quote(f, value);
  assert.equal(budget.enabled, true); assert.equal(budget.availableCredits, 100); assert.equal(budget.requiredCredits, 100);
  assert.ok(budget.maxOutputTokens >= 128 && budget.maxOutputTokens < value.maxOutputTokens);
  assert.equal(reserveDzmmCreditCost(value.inputTokenUpperBound, budget.maxOutputTokens, costPolicy), budget.requiredCredits);
  assert.ok(reserveDzmmCreditCost(value.inputTokenUpperBound, budget.maxOutputTokens + 1, costPolicy) > budget.availableCredits);
  assert.deepEqual(value, original); assert.equal((await balance(f)).balance, 100);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(f.user.id).first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE user_id=?').bind(f.user.id).first()).n, 0);
  const adapted = { ...value, maxOutputTokens: budget.maxOutputTokens, requestFingerprint: 'b'.repeat(64) };
  const held = await reserve(f, adapted); assert.equal(held.receipt.reservedCredits, budget.requiredCredits);
  assert.equal((await DB.prepare('SELECT max_output_tokens,request_fingerprint FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first()).request_fingerprint, adapted.requestFingerprint);
  await assert.rejects(reserve(f, original), status(409));
});

test('input context and the minimum useful reply must fit; memory has a larger floor and small explicit ceilings are respected', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const tooLong = input({ inputTokenUpperBound: 12000, maxOutputTokens: 2048 });
  await assert.rejects(quote(f, tooLong), error => error.status === 402 && error.details.availableCredits === 100
    && error.details.requiredCredits === reserveDzmmCreditCost(12000, 128, costPolicy)
    && error.message.includes('当前可用 100 Credit') && error.message.includes('至少需要') && error.message.includes('缩短上下文'));
  const chat = await quote(f, input({ inputTokenUpperBound: 10500, maxOutputTokens: 2048 })); assert.ok(chat.maxOutputTokens >= 128);
  await assert.rejects(quote(f, input({ operation: 'memory', inputTokenUpperBound: 10500, maxOutputTokens: 2048 })), status(402));
  const shortMemory = await quote(f, input({ operation: 'memory', inputTokenUpperBound: 10500, maxOutputTokens: 64 }));
  assert.equal(shortMemory.maxOutputTokens, 64);
  assert.equal((await balance(f)).reserved_credits, 0);
});

test('quotes use spendable balance including pending holds, and expired holds are ignored without cleanup writes', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const held = await reserve(f, input({ maxOutputTokens: 1000 }));
  await finalize(f, held, { usage: undefined, generationId: 'gen_quote_pending' });
  assert.equal((await balance(f)).balance, 64);
  await assert.rejects(quote(f, input({ inputTokenUpperBound: 7290, maxOutputTokens: 2048 })), error => error.status === 402
    && error.details.availableCredits === 64 && error.details.reservedCredits === 36 && error.message.includes('36 Credit 正被其他请求预留'));
  const created = Date.now() - CREDIT_RESERVATION_TTL_MS - 1000;
  await DB.prepare('UPDATE credit_usage_requests SET created_at=?,expires_at=? WHERE id=?')
    .bind(created, created + CREDIT_RESERVATION_TTL_MS, held.receipt.id).run();
  const budget = await quote(f, input({ inputTokenUpperBound: 7290, maxOutputTokens: 2048 })); assert.equal(budget.availableCredits, 100);
  assert.equal((await DB.prepare('SELECT status FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first()).status, 'pending');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(held.receipt.id).first()).n, 0);
});

test('concurrent read-only quotes cannot authorize overspending when the current atomic reservation runs', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const values = Array.from({ length: 6 }, () => input({ inputTokenUpperBound: 7290, maxOutputTokens: 2048 }));
  const budgets = await Promise.all(values.map(value => quote(f, value)));
  assert.ok(budgets.every(budget => budget.availableCredits === 100 && budget.requiredCredits === 100));
  assert.equal((await balance(f)).reserved_credits, 0);
  const results = await Promise.allSettled(values.map((value, index) => reserve(f, { ...value, maxOutputTokens: budgets[index].maxOutputTokens })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 402));
  assert.equal((await balance(f)).balance, 0); assert.equal((await balance(f)).reserved_credits, 100);
});

test('legacy fractional-price quotes use the exact rounded tariff and keep a fully affordable ceiling', async () => {
  const f = await fixture(); await fundStripe(f);
  f.env.CREDIT_BILLING_RATES_JSON = JSON.stringify({ revision: 2, inputCreditsPer1000: 1.09, outputCreditsPer1000: 3 });
  await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 26300 }));
  const budget = await quote(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 8000 }));
  assert.equal(budget.requiredCredits, 20); assert.equal(budget.maxOutputTokens, 6303);
  assert.equal(chargeDzmmCreditTokens(1000, budget.maxOutputTokens, 1.09, 3), 20);
  assert.equal(chargeDzmmCreditTokens(1000, budget.maxOutputTokens + 1, 1.09, 3), 21);
  const short = await quote(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  assert.equal(short.maxOutputTokens, 1000); assert.equal(short.requiredCredits, 5); assert.equal(short.availableCredits, 20);
});

test('quotes verify the own current session, strictly reject money and invalid tokens, and fail closed on malformed config', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f); const other = await fixture();
  await assert.rejects(quoteCreditUsage(request(other), f.env, f.user, input(), { now: () => f.now }), status(401));
  const guest = await fixture(DB, true); await assert.rejects(quote(guest), status(403));
  for (const extra of [{ credits: 0 }, { costPolicy }, { inputTokenUpperBound: -1 }, { maxOutputTokens: 0 }, { requestFingerprint: 'fake' }])
    await assert.rejects(quote(f, input(extra)), status(400));
  assert.deepEqual(await quote(f, input(), { ...f.env, CREDIT_BILLING_ENABLED: 'false' }), { enabled: false });
  for (const env of [{ ...f.env, CREDIT_BILLING_RATES_JSON: '{}' }, { ...f.env, CREDIT_BILLING_COST_POLICY_JSON: '{}' }])
    await assert.rejects(quote(f, input(), env), status(503));
  await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.hash).run();
  await assert.rejects(quote(f), status(401)); assert.equal((await balance(f)).balance, 100);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(f.user.id).first()).n, 0);
});

test('real D1 concurrent distinct reservations against one balance cannot overspend', async () => {
  const f = await fixture(); await fundStripe(f);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(f)));
  const winners = results.filter(result => result.status === 'fulfilled');
  assert.equal(winners.length, 1); assert.equal(winners[0].value.receipt.reservedCredits, 75);
  for (const rejected of results.filter(result => result.status === 'rejected')) assert.equal(rejected.reason.status, 402);
  const totals = await balance(f); assert.equal(totals.balance, 25); assert.equal(totals.reserved_credits, 75); assert.equal(totals.total_spent, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(f.user.id).first()).n, 1);
});

test('concurrent request replay grants one execution claim only; changed requests are conflicting and no second hold is created', async () => {
  const f = await fixture(); await fundStripe(f); const value = input();
  const responses = await Promise.all(Array.from({ length: 6 }, () => reserve(f, value)));
  assert.equal(responses.filter(result => result.created).length, 1); assert.equal(responses.filter(result => result.claimToken).length, 1);
  assert.equal(new Set(responses.map(result => result.receipt.id)).size, 1);
  for (const extra of [{ requestFingerprint: 'a'.repeat(64) }, { model: 'other-model' }, { maxOutputTokens: 100 }, { operation: 'memory' }])
    await assert.rejects(reserve(f, { ...value, ...extra }), status(409));
  assert.equal((await balance(f)).reserved_credits, 75);
});

test('settlement uses frozen rates, combines before rounding, returns unused hold, and works after billing is switched off', async () => {
  const f = await fixture(); await fundStripe(f);
  const value = input({ inputTokenUpperBound: 100, maxOutputTokens: 100 }), held = await reserve(f, value);
  assert.equal(held.receipt.reservedCredits, 2);
  const off = { ...f.env, CREDIT_BILLING_ENABLED: 'false', CREDIT_BILLING_RATES_JSON: JSON.stringify({ ...rates, revision: 2, inputCreditsPer1000: 1000 }) };
  const replay = await reserve(f, value, off); assert.equal(replay.created, false); assert.equal(replay.receipt.priceRevision, 1);
  const done = await finalize(f, held, { usage: { promptTokens: 1, completionTokens: 1 } }, off);
  assert.equal(done.chargedCredits, 1); assert.equal(done.returnedCredits, 1); assert.equal(done.priceRevision, 1);
  assert.equal((await balance(f)).balance, 99); assert.equal((await balance(f)).reserved_credits, 0); assert.equal((await balance(f)).total_spent, 1);
});

test('duplicate settlement is one debit, conflicting refund/usage cannot change the terminal fact, and another account cannot finalize it', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f);
  const done = await Promise.all(Array.from({ length: 6 }, () => finalize(f, held)));
  assert.ok(done.every(item => item.chargedCredits === 6 && item.returnedCredits === 69));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(held.receipt.id).first()).n, 1);
  await assert.rejects(finalize(f, held, { outcome: 'failed', hasValidOutput: false, usage: undefined }), status(409));
  await assert.rejects(finalize(f, held, { usage: { promptTokens: 501, completionTokens: 500 } }), status(409));
  await assert.rejects(finalize(f, held, { accountId: randomUUID() }), status(404));
  await assert.rejects(finalize(f, held, { claimToken: randomUUID() }), status(404));
  await assert.rejects(finalize(f, held, { credits: 0 }), status(400));
  assert.equal((await balance(f)).balance, 94);
});

test('simultaneous charge and refund compete once and preserve the exact balance invariant', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f);
  const finals = await Promise.allSettled([finalize(f, held), finalize(f, held, { outcome: 'cancelled', hasValidOutput: false, usage: undefined })]);
  assert.equal(finals.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(finals.find(result => result.status === 'rejected').reason.status, 409);
  const row = await DB.prepare('SELECT * FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first();
  const totals = await balance(f); assert.equal(totals.balance + totals.reserved_credits + totals.total_spent, 100);
  assert.equal(totals.reserved_credits, 0); assert.equal(totals.total_spent, row.charged_credits);
});

test('failed chat/memory without valid output releases all credits even when the provider spent tokens', async () => {
  for (const operation of ['chat', 'memory']) {
    const f = await fixture(); await fundStripe(f); const held = await reserve(f, input({ operation }));
    const done = await finalize(f, held, { outcome: 'failed', hasValidOutput: false });
    assert.equal(done.status, 'released'); assert.equal(done.releaseReason, 'no_valid_output'); assert.equal(done.returnedCredits, 75); assert.equal(done.chargedCredits, 0);
    await finalize(f, held, { outcome: 'failed', hasValidOutput: false }); assert.equal((await balance(f)).balance, 100);
  }
});

test('partial output lacking usage remains pending, generation reconciliation settles once using a server-only capability', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f);
  const pending = await finalize(f, held, { outcome: 'cancelled', usage: undefined, generationId: 'gen_isolated_1' });
  assert.equal(pending.status, 'pending'); assert.equal(pending.chargedCredits, 0); assert.equal(pending.returnedCredits, 0);
  assert.equal((await balance(f)).balance, 25); assert.equal((await balance(f)).reserved_credits, 75);
  const queue = await getPendingCreditUsage(f.env, 50, { now: () => f.now }); const entry = queue.find(item => item.reservationId === held.receipt.id);
  assert.equal(entry.generationId, 'gen_isolated_1'); assert.ok(entry.claimToken); assert.notEqual(entry.claimToken, held.claimToken);
  const done = await finalize(f, held, { outcome: entry.outcome, claimToken: entry.claimToken, generationId: entry.generationId });
  assert.equal(done.status, 'settled'); assert.equal(done.chargedCredits, 6); assert.equal((await balance(f)).balance, 94);
  assert.ok(!(await getPendingCreditUsage(f.env, 50, { now: () => f.now })).some(item => item.reservationId === held.receipt.id));
});

test('pending usage timeout and abandoned reservations release once; late usage cannot retroactively charge released funds', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f);
  await finalize(f, held, { outcome: 'failed', usage: undefined, generationId: 'gen_expired' });
  f.now += CREDIT_RESERVATION_TTL_MS - 1; assert.equal(await releaseExpiredCreditUsage(f.env, f.user.id, { now: () => f.now }), 0);
  f.now += 1; assert.equal(await releaseExpiredCreditUsage(f.env, f.user.id, { now: () => f.now }), 1);
  assert.equal(await releaseExpiredCreditUsage(f.env, f.user.id, { now: () => f.now }), 0);
  const expired = await DB.prepare('SELECT * FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first();
  assert.equal(expired.release_reason, 'usage_timeout'); assert.equal(expired.outcome, 'expired'); assert.equal((await balance(f)).balance, 100);
  await assert.rejects(finalize(f, held, { outcome: 'failed' }), status(409));
  const abandoned = await reserve(f); f.now += CREDIT_RESERVATION_TTL_MS;
  const fresh = await reserve(f); assert.equal(fresh.created, true);
  assert.equal((await DB.prepare('SELECT release_reason FROM credit_usage_requests WHERE id=?').bind(abandoned.receipt.id).first()).release_reason, 'request_timeout');
});

test('bounded reconciliation rotates two batches so ambiguous earlier generations cannot starve newer pending requests', async () => {
  const rotationStore = memoryStore('credit-reconciliation-rotation');
  try {
    const database = await rotationStore.getD1Database('DB'); await migrate(database); const f = await fixture(database); await fundStripe(f, 'live', 1000);
    for (let index = 0; index < 4; index++) {
      const held = await reserve(f);
      await finalize(f, held, { outcome: 'cancelled', usage: undefined, generationId: `gen_rotation_${index}` });
    }
    const fields = 'id,model,generation_id,outcome,input_rate,output_rate,status,authorization_hash,reconciliation_token';
    const before = (await database.prepare(`SELECT ${fields} FROM credit_usage_requests ORDER BY id`).all()).results;
    const first = await getPendingCreditUsage(f.env, 2, { now: () => f.now });
    const second = await getPendingCreditUsage(f.env, 2, { now: () => f.now });
    assert.equal(first.length, 2); assert.equal(second.length, 2);
    assert.equal(new Set([...first, ...second].map(item => item.reservationId)).size, 4);
    assert.deepEqual((await database.prepare(`SELECT ${fields} FROM credit_usage_requests ORDER BY id`).all()).results, before);
    const totals = await balance(f); assert.equal(totals.total_spent, 0); assert.equal(totals.reserved_credits, 300);
  } finally { await rotationStore.dispose(); }
});

test('unexpected provider usage cannot debit beyond reserved credits and is marked for reconciliation', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f, input({ inputTokenUpperBound: 10, maxOutputTokens: 10 }));
  const done = await finalize(f, held, { usage: { promptTokens: 10000, completionTokens: 10000 } });
  assert.equal(done.reservedCredits, 1); assert.equal(done.chargedCredits, 1); assert.equal(done.returnedCredits, 0); assert.equal(done.usageExceedsReservation, true);
  assert.equal((await balance(f)).balance, 99);
});

test('expired holds stop freezing wallet availability even when no cron, cleanup or new generation runs', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f);
  const created = Date.now() - CREDIT_RESERVATION_TTL_MS - 1000;
  await DB.prepare('UPDATE credit_usage_requests SET created_at=?,expires_at=? WHERE id=?')
    .bind(created, created + CREDIT_RESERVATION_TTL_MS, held.receipt.id).run();
  const wallet = await liveWallet(f.env, f.user, 'stripe'); assert.equal(wallet.balance, 100); assert.equal(wallet.reservedCredits, 0);
  const overview = await (await fetchRequest(request(f), f.env)).json(); assert.equal(overview.availableBalance, 100); assert.equal(overview.reservedCredits, 0);
  assert.equal((await DB.prepare('SELECT status FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first()).status, 'reserved');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(held.receipt.id).first()).n, 0);
});

test('a stale clock captured before an await cannot charge an expired hold after its balance funded a new request', async () => {
  const f = await fixture(); await fundStripe(f); const old = await reserve(f);
  const created = Date.now() - CREDIT_RESERVATION_TTL_MS - 1000;
  await DB.prepare('UPDATE credit_usage_requests SET created_at=?,expires_at=? WHERE id=?')
    .bind(created, created + CREDIT_RESERVATION_TTL_MS, old.receipt.id).run();
  f.now = created + CREDIT_RESERVATION_TTL_MS - 1;
  const current = await reserve(f); assert.equal(current.created, true); assert.equal((await balance(f)).reserved_credits, 75);
  await assert.rejects(finalize(f, old, { usage: { promptTokens: 1000, completionTokens: 8000 } }), status(409));
  const totals = await balance(f); assert.equal(totals.total_spent, 0); assert.equal(totals.balance, 25); assert.equal(totals.reserved_credits, 75);
});

test('sandbox Stripe cannot fund requests; merged task Credits and real providers combine without rewriting payment facts', async () => {
  const f = await fixture(); await fundStripe(f, 'test', 1000);
  await DB.prepare("INSERT INTO task_claims VALUES(?,'complete_profile','once',5,?,NULL)").bind(f.user.id, BASE).run();
  await assert.rejects(reserve(f), status(402)); const order = await fundStripe(f); await fundZpay(f);
  assert.equal((await balance(f)).balance, 2905);
  const debitUser = await fixture(); const debitOrder = await fundStripe(debitUser); const held = await reserve(debitUser);
  await finalize(debitUser, held, { usage: { promptTokens: 1000, completionTokens: 8000 } });
  const event = `evt_${randomUUID()}`;
  await DB.batch([
    DB.prepare("INSERT INTO payment_events VALUES(?,'charge.refunded',?,'verified',?)").bind(event, debitOrder, BASE),
    DB.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'refund_adjustment',-100,?)")
      .bind(debitOrder, debitUser.user.id, event, BASE),
  ]);
  const totals = await balance(debitUser); assert.equal(totals.balance, 0); assert.equal(totals.debt_credits, 75); assert.equal(totals.granted_credits, 0);
  await assert.rejects(reserve(debitUser), status(402));
  const wallet = await liveWallet(debitUser.env, debitUser.user, 'stripe'); assert.equal(wallet.balance, 0); assert.equal(wallet.debtCredits, 75); assert.equal(wallet.totalRefunded, 100);
  assert.equal((await DB.prepare('SELECT credits FROM payment_credit_ledger WHERE source_event_id=?').bind(event).first()).credits, -100);
  assert.ok(order);
});

test('reservation session checks occur in SQL, and D1 rollback cannot strand holds or half-commit settlement', async () => {
  const f = await fixture(); await fundStripe(f); const other = await fixture();
  await assert.rejects(reserveCreditUsage(request(other), f.env, f.user, input(), { now: () => f.now }), status(401));
  const guest = await fixture(DB, true); await assert.rejects(reserve(guest), status(403));
  const broken = { ...f.env, DB: brokenDatabase(DB) }; await assert.rejects(reserve(f, input(), broken), /deliberately_missing_billing_table/);
  assert.equal((await balance(f)).reserved_credits, 0);
  const held = await reserve(f); await assert.rejects(finalize(f, held, {}, broken), /deliberately_missing_billing_table/);
  assert.equal((await DB.prepare('SELECT status FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first()).status, 'reserved');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(held.receipt.id).first()).n, 0);
  await finalize(f, held); assert.equal((await balance(f)).total_spent, 6);
});

test('public queries expose only own receipt data, stable pagination, and no billing mutation or private capability', async () => {
  const f = await fixture(); await fundStripe(f); const held = await reserve(f);
  await finalize(f, held, { usage: undefined, generationId: 'gen_private' });
  const other = await fixture(); await fundStripe(other); await reserve(other);
  const config = await (await fetchRequest(request(f, '/v1/billing/config'), f.env)).json(); assert.equal(config.enabled, true); assert.equal(config.priceRevision, 1);
  const body = await (await fetchRequest(request(f), f.env)).json(); assert.equal(body.accountId, f.user.id); assert.equal(body.availableBalance, 25);
  assert.equal(body.items.length, 1); assert.ok(body.items.every(item => item.accountId === f.user.id));
  for (const field of ['claimToken', 'request_fingerprint', 'requestFingerprint', 'authorization_hash', 'generation_id', 'generationId', 'reconciliation_token']) assert.ok(!JSON.stringify(body).includes(field));
  const noAuth = await fetchRequest(new Request('https://credit.example.test/v1/billing/usage'), f.env); assert.equal(noAuth.status, 401);
  for (const mutation of ['quote', 'reserve', 'finalize', 'releaseExpired', 'getPending']) {
    const response = await fetchRequest(new Request(`https://credit.example.test/v1/billing/${mutation}`, { method: 'POST', headers: { Cookie: `qingyu_session=${f.token}` }, body: '{}' }), f.env);
    assert.equal(response.status, 404);
  }
  await finalize(f, held, { generationId: 'gen_private' }); await reserve(f, input({ maxOutputTokens: 1 }));
  const page = await (await fetchRequest(request(f, '/v1/billing/usage?limit=1'), f.env)).json(); assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
  const next = await (await fetchRequest(request(f, `/v1/billing/usage?limit=1&cursor=${page.nextCursor}`), f.env)).json(); assert.equal(next.items.length, 1);
  assert.notEqual(page.items[0].id, next.items[0].id); assert.equal(next.nextCursor, null);
});

test('additive usage migration preserves all historical payment rows, community points and existing autoincrement sequences', async () => {
  const oldStore = memoryStore('credit-migration-history');
  try {
    const database = await oldStore.getD1Database('DB'); await migrate(database, migrations.filter(name => name < '0015_credit_usage.sql'));
    const f = await fixture(database); await fundStripe(f); await fundZpay(f);
    await database.prepare("INSERT INTO task_claims VALUES(?,'complete_profile','once',5,?,NULL)").bind(f.user.id, BASE).run();
    const tables = ['users', 'sessions', 'payment_orders', 'payment_events', 'payment_credit_ledger', 'zpay_orders', 'zpay_events', 'zpay_credit_ledger', 'task_claims'];
    const snapshots = await Promise.all(tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const sequences = (await database.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
    await migrate(database, ['0015_credit_usage.sql']);
    for (let i = 0; i < tables.length; i++) assert.deepEqual((await database.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results, snapshots[i].results);
    assert.deepEqual((await database.prepare('SELECT name,seq FROM sqlite_sequence WHERE name<>\'credit_usage_ledger\' ORDER BY name').all()).results, sequences);
    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []); assert.equal((await balance(f)).balance, 2900);
  } finally { await oldStore.dispose(); }
});

test('actual named Worker RPC preserves error status, disables only explicitly, and never exposes the private guard helper', async () => {
  const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'neutral',
    external: ['cloudflare:workers', 'node:*'], logLevel: 'silent' });
  const rpcStore = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'billing-backend', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text,
      d1Databases: { DB: 'rpc-credit-tests' }, bindings: { APP_ORIGINS: 'https://credit.example.test', CREDIT_BILLING_ENABLED: 'true', CREDIT_BILLING_RATES_JSON: JSON.stringify(rates) } },
    { name: 'billing-invalid', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text,
      d1Databases: { DB: 'rpc-credit-tests' }, bindings: { APP_ORIGINS: 'https://credit.example.test', CREDIT_BILLING_ENABLED: 'true', CREDIT_BILLING_RATES_JSON: '{}' } },
    { name: 'billing-disabled', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text,
      d1Databases: { DB: 'rpc-credit-tests' }, bindings: { APP_ORIGINS: 'https://credit.example.test', CREDIT_BILLING_ENABLED: 'false' } },
    { name: 'billing-cost', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text,
      d1Databases: { DB: 'rpc-credit-tests' }, bindings: { APP_ORIGINS: 'https://credit.example.test', CREDIT_BILLING_ENABLED: 'true',
        CREDIT_BILLING_RATES_JSON: JSON.stringify(costRates), CREDIT_BILLING_COST_POLICY_JSON: JSON.stringify(costPolicy) } },
    { name: 'billing-cost-invalid', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text,
      d1Databases: { DB: 'rpc-credit-tests' }, bindings: { APP_ORIGINS: 'https://credit.example.test', CREDIT_BILLING_ENABLED: 'true',
        CREDIT_BILLING_RATES_JSON: JSON.stringify(costRates), CREDIT_BILLING_COST_POLICY_JSON: '{}' } },
    { name: 'billing-probe', compatibilityDate: '2026-10-01', modules: true,
      script: 'export default {async fetch(request,env){const {method,args,target}=await request.json();try{return Response.json(await env[target||"BILLING"][method](...args))}catch(error){return Response.json({thrown:error.message})}}}',
      serviceBindings: { BILLING: { name: 'billing-backend', entrypoint: 'BillingService' }, INVALID: { name: 'billing-invalid', entrypoint: 'BillingService' },
        DISABLED: { name: 'billing-disabled', entrypoint: 'BillingService' }, COST: { name: 'billing-cost', entrypoint: 'BillingService' },
        COST_INVALID: { name: 'billing-cost-invalid', entrypoint: 'BillingService' } } },
  ] }));
  try {
    const database = await rpcStore.getD1Database('DB', 'billing-backend'); await migrate(database); const f = await fixture(database);
    const probe = await rpcStore.getWorker('billing-probe');
    async function call(method, ...args) { return (await probe.fetch('https://rpc.example.test', { method: 'POST', body: JSON.stringify({ method, args }) })).json(); }
    async function targetCall(target, method, ...args) { return (await probe.fetch('https://rpc.example.test', { method: 'POST', body: JSON.stringify({ target, method, args }) })).json(); }
    const dto = { ...input(), sessionToken: f.token, accountId: f.user.id };
    assert.equal((await targetCall('INVALID', 'quote', dto)).error.status, 503);
    assert.equal((await targetCall('COST_INVALID', 'quote', dto)).error.status, 503);
    assert.deepEqual(await targetCall('DISABLED', 'quote', dto), { enabled: false });
    assert.equal((await targetCall('DISABLED', 'quote', { ...dto, maxOutputTokens: 0 })).error.status, 400);
    for (const extra of [{ credits: 0 }, { costPolicy }, { maxOutputTokens: -1 }, { requestFingerprint: 'invalid' }])
      assert.equal((await call('quote', { ...dto, ...extra })).error.status, 400);
    assert.equal((await call('quote', { ...dto, sessionToken: '0'.repeat(64) })).error.status, 401);
    assert.equal((await call('quote', { ...dto, accountId: randomUUID() })).error.status, 401);
    const noFunds = await targetCall('COST', 'quote', { ...dto, maxOutputTokens: 2048 });
    assert.equal(noFunds.error.status, 402); assert.equal(noFunds.error.code, 'insufficient_credits'); assert.ok(noFunds.error.message.includes('当前可用 0 Credit'));
    const budgetUser = await fixture(database); await fundStripe(budgetUser);
    const budgetDtos = Array.from({ length: 6 }, () => ({ ...input({ inputTokenUpperBound: 7290, maxOutputTokens: 2048 }),
      sessionToken: budgetUser.token, accountId: budgetUser.user.id }));
    const budgets = await Promise.all(budgetDtos.map(value => targetCall('COST', 'quote', value)));
    assert.ok(budgets.every(budget => budget.enabled && budget.availableCredits === 100 && budget.requiredCredits === 100));
    assert.ok(budgets.every(budget => budget.maxOutputTokens >= 128 && budget.maxOutputTokens < 2048));
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(budgetUser.user.id).first()).n, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE user_id=?').bind(budgetUser.user.id).first()).n, 0);
    assert.equal((await targetCall('COST', 'quote', { ...budgetDtos[0], sessionToken: f.token })).error.status, 401);
    const budgetHolds = await Promise.all(budgetDtos.map((value, index) => targetCall('COST', 'reserve', {
      ...value, maxOutputTokens: budgets[index].maxOutputTokens, requestFingerprint: 'b'.repeat(64),
    })));
    assert.equal(budgetHolds.filter(held => held.created).length, 1);
    assert.ok(budgetHolds.filter(held => held.error).every(held => held.error.status === 402));
    const badRates = await targetCall('INVALID', 'reserve', dto); assert.equal(badRates.error.status, 503); assert.ok(!badRates.enabled);
    assert.deepEqual(await targetCall('DISABLED', 'reserve', dto), { enabled: false });
    const invalidSession = await call('reserve', { ...dto, sessionToken: '0'.repeat(64) }); assert.equal(invalidSession.error.status, 401);
    const hidden = await call('guard'); assert.ok(hidden.thrown); assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM credit_usage_requests WHERE user_id=?').bind(f.user.id).first()).n, 0);
    assert.equal((await call('reserve', dto)).error.status, 402); await fundStripe(f);
    const held = await call('reserve', dto); assert.equal(held.enabled, true); assert.equal(held.created, true); assert.ok(held.claimToken);
    const replay = await call('reserve', dto); assert.equal(replay.created, false); assert.equal(replay.claimToken, undefined);
    const completion = { reservationId: held.receipt.id, accountId: f.user.id, claimToken: held.claimToken, outcome: 'cancelled', hasValidOutput: true, generationId: 'gen_rpc_pending' };
    assert.equal((await call('finalize', completion)).receipt.status, 'pending');
    const queued = (await call('getPending', 20)).items.find(item => item.reservationId === held.receipt.id); assert.equal(queued.model, dto.model);
    const settled = await targetCall('DISABLED', 'finalize', { ...completion, claimToken: queued.claimToken, usage: { promptTokens: 500, completionTokens: 500 } });
    assert.equal(settled.receipt.chargedCredits, 6); assert.equal(settled.receipt.returnedCredits, 69);
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(held.receipt.id).first()).n, 1);
    assert.equal((await call('releaseExpired')).released, 0);
    assert.equal((await targetCall('COST_INVALID', 'reserve', { ...dto, requestId: randomUUID() })).error.status, 503);
    const costHeld = await targetCall('COST', 'reserve', { ...dto, requestId: randomUUID(), maxOutputTokens: 1000 });
    assert.equal(costHeld.receipt.reservedCredits, 36); assert.deepEqual(costHeld.receipt.costPolicy, costPolicy);
    const costCompletion = { reservationId: costHeld.receipt.id, accountId: f.user.id, claimToken: costHeld.claimToken,
      outcome: 'completed', hasValidOutput: true, generationId: 'gen_rpc_cost', usage: { promptTokens: 1000, completionTokens: 1000 } };
    assert.equal((await targetCall('COST', 'finalize', costCompletion)).receipt.status, 'pending');
    const costQueued = (await targetCall('COST', 'getPending', 20)).items.find(item => item.reservationId === costHeld.receipt.id);
    assert.deepEqual(costQueued.costPolicy, costPolicy);
    const costSettled = await targetCall('DISABLED', 'finalize', { ...costCompletion, claimToken: costQueued.claimToken,
      usage: { ...costCompletion.usage, providerCostUsd: 0.002 } });
    assert.equal(costSettled.receipt.chargedCredits, 5); assert.equal(costSettled.receipt.returnedCredits, 31);
    assert.equal(costSettled.receipt.providerCostUsd, 0.002); assert.deepEqual(costSettled.receipt.costPolicy, costPolicy);
  } finally { await rpcStore.dispose(); }
});

test('fractional reference rates round trip through real D1 and token charging avoids binary ceiling overcharges', async () => {
  const f = await fixture(); await fundZpay(f);
  f.env.CREDIT_BILLING_RATES_JSON = JSON.stringify({ revision: 2, inputCreditsPer1000: 1.09, outputCreditsPer1000: 3 });
  const held = await reserve(f, input({ inputTokenUpperBound: 100000, maxOutputTokens: 1 }));
  assert.equal(held.receipt.reservedCredits, 110);
  const stored = await DB.prepare('SELECT input_rate,typeof(input_rate) AS storage FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first();
  assert.deepEqual(stored, { input_rate: 1.09, storage: 'real' });
  const done = await finalize(f, held, { usage: { promptTokens: 100000, completionTokens: 0 } });
  assert.equal(done.chargedCredits, 109); assert.equal(done.returnedCredits, 1); assert.equal(done.inputCreditsPer1000, 1.09);
  assert.ok(!Object.hasOwn(done, 'costPolicy')); assert.ok(!Object.hasOwn(done, 'providerCostUsd'));
  const publicConfig = await (await fetchRequest(request(f, '/v1/billing/config'), f.env)).json();
  assert.equal(publicConfig.inputCreditsPer1000, 1.09); assert.equal(publicConfig.priceRevision, 2);
  assert.equal(creditBillingConfig({ ...f.env, CREDIT_BILLING_RATES_JSON: JSON.stringify({ ...costRates, inputCreditsPer1000: 1.0000001 }) }).enabled, false);
});

test('actual cost reservations freeze their policy and cached lower provider cost lowers the charge for identical tokens', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const held = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  assert.equal(held.receipt.reservedCredits, 36); assert.deepEqual(held.receipt.costPolicy, costPolicy);
  const stored = await DB.prepare('SELECT cost_policy_json,input_rate,output_rate FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first();
  assert.deepEqual(JSON.parse(stored.cost_policy_json), costPolicy); assert.equal(stored.input_rate, costRates.inputCreditsPer1000);
  assert.equal(stored.output_rate, costRates.outputCreditsPer1000);
  const changed = { ...f.env, CREDIT_BILLING_ENABLED: 'false', CREDIT_BILLING_COST_POLICY_JSON: JSON.stringify({ ...costPolicy, usdToCny: 10 }) };
  const cached = await finalize(f, held, { usage: { promptTokens: 1000, completionTokens: 1000, providerCostUsd: 0.002 } }, changed);
  assert.equal(cached.chargedCredits, 5); assert.equal(cached.returnedCredits, 31);
  assert.equal(cached.providerCostUsd, 0.002); assert.deepEqual(cached.costPolicy, costPolicy);
  const second = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  const standard = await finalize(f, second, { usage: { promptTokens: 1000, completionTokens: 1000, providerCostUsd: 0.008 } });
  assert.equal(standard.chargedCredits, 17); assert.equal(standard.returnedCredits, 19);
  const overview = await (await fetchRequest(request(f), f.env)).json();
  assert.equal(overview.totalSpent, 22); assert.equal(overview.availableBalance, 78);
  assert.deepEqual(overview.items.find(item => item.id === held.receipt.id).costPolicy, costPolicy);
  assert.equal(overview.items.find(item => item.id === held.receipt.id).providerCostUsd, 0.002);
});

test('cost policy is optional only when omitted; malformed configured policies fail closed without a hold', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  for (const source of ['', '{}', 'broken-json', JSON.stringify({ ...costPolicy, multiplier: 4 }), JSON.stringify({ ...costPolicy, usdToCny: 6.7045881 }),
    JSON.stringify({ ...costPolicy, extra: true }), JSON.stringify({ ...costPolicy, maxOutputUsdPerMillion: 5 })]) {
    const env = { ...f.env, CREDIT_BILLING_COST_POLICY_JSON: source };
    assert.equal(creditBillingConfig(env).enabled, false); await assert.rejects(reserve(f, input(), env), status(503));
  }
  assert.equal((await balance(f)).reserved_credits, 0); assert.equal((await balance(f)).total_spent, 0);
  const publicConfig = await (await fetchRequest(request(f, '/v1/billing/config'), f.env)).json();
  assert.deepEqual(publicConfig.costPolicy, costPolicy); assert.equal(publicConfig.inputCreditsPer1000, costRates.inputCreditsPer1000);
});

test('cost mode tokens without cost remain pending, reconcile once with trusted cost, and otherwise expire without estimation', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const held = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  const pending = await finalize(f, held, { generationId: 'gen_cost_pending', usage: { promptTokens: 1000, completionTokens: 1000 } });
  assert.equal(pending.status, 'pending'); assert.equal(pending.chargedCredits, 0);
  assert.equal(pending.promptTokens, null); assert.ok(!Object.hasOwn(pending, 'providerCostUsd'));
  const queued = (await getPendingCreditUsage(f.env)).find(item => item.reservationId === held.receipt.id);
  assert.deepEqual(queued.costPolicy, costPolicy);
  const recovered = await finalizeCreditUsage(f.env, { reservationId: queued.reservationId, accountId: queued.accountId, claimToken: queued.claimToken,
    outcome: queued.outcome, hasValidOutput: true, generationId: queued.generationId,
    usage: { promptTokens: 1000, completionTokens: 1000, providerCostUsd: 0.002 } });
  assert.equal(recovered.chargedCredits, 5); assert.equal(recovered.returnedCredits, 31);
  await assert.rejects(finalize(f, held, { generationId: 'gen_cost_pending', usage: { promptTokens: 1000, completionTokens: 1000, providerCostUsd: 0.003 } }), status(409));
  const missing = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  assert.equal((await finalize(f, missing, { usage: undefined, generationId: 'gen_cost_missing_usage' })).status, 'pending');
  f.now += CREDIT_RESERVATION_TTL_MS;
  assert.equal(await releaseExpiredCreditUsage(f.env, f.user.id, { now: () => f.now }), 1);
  const receipt = (await (await fetchRequest(request(f), f.env)).json()).items.find(item => item.id === missing.receipt.id);
  assert.equal(receipt.status, 'released'); assert.equal(receipt.chargedCredits, 0); assert.equal(receipt.returnedCredits, 36);
  assert.equal(receipt.releaseReason, 'usage_timeout'); assert.equal((await balance(f)).total_spent, 5);
});

test('trusted zero costs settle at zero; invalid cost or frozen policy cannot mutate an account balance', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const zero = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  const done = await finalize(f, zero, { usage: { promptTokens: 1, completionTokens: 1, providerCostUsd: 0 } });
  assert.equal(done.status, 'settled'); assert.equal(done.chargedCredits, 0); assert.equal(done.providerCostUsd, 0); assert.equal(done.returnedCredits, 36);
  const held = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  for (const cost of [-1, 1e-13, 1_000_001, '0.002', null, NaN, Infinity])
    await assert.rejects(finalize(f, held, { usage: { promptTokens: 1, completionTokens: 1, providerCostUsd: cost } }), status(400));
  assert.equal((await balance(f)).total_spent, 0); assert.equal((await balance(f)).reserved_credits, 36);
  await DB.prepare('UPDATE credit_usage_requests SET cost_policy_json=? WHERE id=?').bind('{}', held.receipt.id).run();
  await assert.rejects(finalize(f, held, { usage: { promptTokens: 1, completionTokens: 1, providerCostUsd: 0.002 } }), status(503));
  assert.equal((await balance(f)).total_spent, 0); assert.equal((await DB.prepare('SELECT status FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first()).status, 'reserved');
});

test('costs above the reservation stay truthful but capped, concurrent settlement is one debit and failed output releases all', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f);
  const held = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  const done = await Promise.all(Array.from({ length: 6 }, () => finalize(f, held, { usage: { promptTokens: 1000, completionTokens: 1000, providerCostUsd: 1 } })));
  assert.ok(done.every(receipt => receipt.chargedCredits === 36 && receipt.usageExceedsReservation && receipt.providerCostUsd === 1));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=?').bind(held.receipt.id).first()).n, 1);
  assert.equal((await balance(f)).balance, 64); assert.equal((await balance(f)).reserved_credits, 0);
  const failed = await reserve(f, input({ inputTokenUpperBound: 1000, maxOutputTokens: 1000 }));
  const released = await finalize(f, failed, { outcome: 'failed', hasValidOutput: false, usage: { promptTokens: 1000, completionTokens: 0, providerCostUsd: 0.002 } });
  assert.equal(released.status, 'released'); assert.equal(released.chargedCredits, 0); assert.equal(released.returnedCredits, 36); assert.equal(released.providerCostUsd, 0.002);
  const other = await fixture();
  await assert.rejects(finalize(f, held, { accountId: other.user.id, usage: { promptTokens: 1000, completionTokens: 1000, providerCostUsd: 1 } }), status(404));
});

test('additive cost migration leaves old reservations and payment facts intact, and old requests retain their original tariff', async () => {
  const legacyStore = memoryStore('cost-migration-legacy');
  try {
    const db = await legacyStore.getD1Database('DB'); await migrate(db, migrations.filter(name => name < '0020_credit_cost_pricing.sql'));
    const f = await fixture(db); await fundStripe(f); const claimToken = randomUUID(), id = `usage_${randomUUID()}`;
    await db.prepare(`INSERT INTO credit_usage_requests(id,user_id,request_id,operation,model,request_fingerprint,price_revision,input_rate,output_rate,
      input_token_upper_bound,max_output_tokens,reserved_credits,authorization_hash,processing_token,created_at,expires_at)
      VALUES(?,?,?,'chat','provider/story-model',?,1,3,9,1000,8000,75,?,'legacy',?,?)`)
      .bind(id, f.user.id, randomUUID(), 'a'.repeat(64), createHash('sha256').update(claimToken).digest('hex'), BASE, BASE + CREDIT_RESERVATION_TTL_MS).run();
    const fields = 'id,user_id,price_revision,input_rate,output_rate,reserved_credits,status,created_at,expires_at';
    const old = (await db.prepare(`SELECT ${fields} FROM credit_usage_requests`).all()).results;
    const tables = ['payment_orders', 'payment_events', 'payment_credit_ledger', 'zpay_orders', 'zpay_credit_ledger', 'subscription_credit_ledger'];
    const snapshots = await Promise.all(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const sequences = (await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).results;
    await migrate(db, ['0020_credit_cost_pricing.sql']);
    assert.deepEqual((await db.prepare(`SELECT ${fields} FROM credit_usage_requests`).all()).results, old);
    assert.deepEqual((await db.prepare('SELECT cost_policy_json,provider_cost_usd FROM credit_usage_requests').first()), { cost_policy_json: null, provider_cost_usd: null });
    for (let i = 0; i < tables.length; i++) assert.deepEqual((await db.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results, snapshots[i].results);
    assert.deepEqual((await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).results, sequences);
    const done = await finalizeCreditUsage(useCostPolicy(f).env, { reservationId: id, accountId: f.user.id, claimToken,
      outcome: 'completed', hasValidOutput: true, usage: { promptTokens: 500, completionTokens: 500, providerCostUsd: 0.001 } });
    assert.equal(done.chargedCredits, 6); assert.equal(done.returnedCredits, 69); assert.ok(!Object.hasOwn(done, 'costPolicy'));
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await legacyStore.dispose(); }
});


test('each fixed provider model quotes and reserves its own frozen catalogue ceiling; low-cost context is affordable without the Grok hold', async () => {
  const small = useCostPolicy(await fixture()); await fundStripe(small, 'live', 100);
  const context = input({ model: 'deepseek/deepseek-v4.1-flash', inputTokenUpperBound: 60000, maxOutputTokens: 2048 });
  const low = await quote(small, context); assert.equal(low.maxOutputTokens, 2048); assert.ok(low.requiredCredits < 100);
  await assert.rejects(quote(small, { ...context, model: 'x-ai/grok-4.6' }), status(402));
  const heldSmall = await reserve(small, context); assert.equal(heldSmall.receipt.reservedCredits, low.requiredCredits);
  await finalize(small, heldSmall, { hasValidOutput: false, outcome: 'failed', usage: undefined });
  const f = useCostPolicy(await fixture()); await fundStripe(f, 'live', 1000);
  for (const option of DZMM_MODEL_OPTIONS) {
    const value = input({ model: option.providerModel, inputTokenUpperBound: 24000, maxOutputTokens: 2048 });
    const expected = dzmmModelCostPolicy(costPolicy, option.providerModel), budget = await quote(f, value);
    const reservation = await reserve(f, value);
    assert.deepEqual(reservation.receipt.costPolicy, expected); assert.equal(reservation.receipt.model, option.providerModel);
    assert.equal(budget.requiredCredits, reserveDzmmCreditCost(value.inputTokenUpperBound, value.maxOutputTokens, expected));
    assert.equal(reservation.receipt.reservedCredits, budget.requiredCredits);
    const raw = await DB.prepare('SELECT cost_policy_json,model FROM credit_usage_requests WHERE id=?').bind(reservation.receipt.id).first();
    assert.deepEqual(JSON.parse(raw.cost_policy_json), expected); assert.equal(raw.model, option.providerModel);
    await finalize(f, reservation, { hasValidOutput: false, outcome: 'failed', usage: undefined });
  }
});

test('a model hold keeps its identity and actual-cost multiplier across changed configuration and duplicate finalize/reserve retries', async () => {
  const f = useCostPolicy(await fixture()); await fundStripe(f, 'live', 1000);
  const value = input({ model: 'anthropic/claude-sonnet-5.5', inputTokenUpperBound: 24000, maxOutputTokens: 2048 });
  const reservation = await reserve(f, value), frozen = reservation.receipt.costPolicy;
  const changed = { ...f.env, CREDIT_BILLING_COST_POLICY_JSON: JSON.stringify({ ...costPolicy, usdToCny: 9 }),
    CREDIT_BILLING_RATES_JSON: JSON.stringify({ ...costRates, revision: 2 }) };
  const fact = { usage: { promptTokens: 5000, completionTokens: 300, providerCostUsd: 0.004 } };
  const settled = await finalize(f, reservation, fact, changed);
  assert.equal(settled.chargedCredits, chargeDzmmProviderCostUsd(0.004, frozen)); assert.deepEqual(settled.costPolicy, frozen);
  assert.deepEqual(await finalize(f, reservation, fact, changed), settled);
  const duplicate = await reserve(f, value, changed); assert.equal(duplicate.created, false); assert.deepEqual(duplicate.receipt, settled);
  await assert.rejects(reserve(f, { ...value, model: 'openai/gpt-6.1-sol' }, changed), status(409));
  const ledger = await DB.prepare("SELECT COUNT(*) AS n FROM credit_usage_ledger WHERE usage_id=? AND kind='charge'").bind(settled.id).first();
  assert.equal(ledger.n, 1);
  await assert.rejects(reserve(f, input({ model: 'deepseek/deepseek-v4.1-flash', maxInputUsdPerMillion: 0.0001 })), status(400));
});


test('new non-default model tariffs cannot silently downgrade to the legacy token estimate', async () => {
 const f = await fixture(); await fundStripe(f, 'live', 1000);
 for(const option of DZMM_MODEL_OPTIONS.filter(model=>model.id!=='grok')){
  const value=input({model:option.providerModel});
  await assert.rejects(quote(f,value),status(503)); await assert.rejects(reserve(f,value),status(503));
 }
 assert.equal((await balance(f)).reserved_credits,0);
});
