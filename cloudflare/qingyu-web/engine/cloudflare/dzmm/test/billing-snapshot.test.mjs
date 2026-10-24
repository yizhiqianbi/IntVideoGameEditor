import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { handleBillingApi } = await tsImport('../src/billing-api.ts', import.meta.url);
const { reserveCreditUsage, finalizeCreditUsage, CREDIT_RESERVATION_TTL_MS } = await tsImport('../src/credit-usage.ts', import.meta.url);
const rates = { revision: 1, inputCreditsPer1000: 1, outputCreditsPer1000: 1 };
let store, DB;

// This store is independent of Wrangler persistence and of any running browser
// fixture. The only writes are synthetic accounts, grants and real usage facts.
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated billing snapshot store")}}',
    d1Databases: { DB: `billing-snapshot-${randomUUID()}` },
  }));
  DB = await store.getD1Database('DB');
  const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(sql).filter(source => source.trim()).map(source => DB.prepare(source)));
  }
});
after(async () => { await store?.dispose(); });

async function fixture(credits = 1000) {
  const now = Date.now(), token = randomBytes(32).toString('hex');
  const user = { id: randomUUID(), email: `${randomUUID()}@snapshot.example.test`, nickname: '原创账本快照测试', isGuest: false, role: 'user', version: 0 };
  const statements = [
    DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id, user.email, user.nickname, now),
    DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(token).digest('hex'), user.id, now + 86400000, now),
  ];
  if (credits) statements.push(DB.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)')
    .bind(`snapshot_${randomUUID()}`, user.id, credits, '隔离测试原创账本，无真实付款', now));
  await DB.batch(statements);
  return { user, token, now, env: { DB, APP_ORIGINS: 'https://snapshot.example.test', CREDIT_BILLING_ENABLED: 'true', CREDIT_BILLING_RATES_JSON: JSON.stringify(rates) } };
}
function request(f, query = '') {
  return new Request(`https://snapshot.example.test/v1/billing/usage${query}`, { headers: { Cookie: `qingyu_session=${f.token}` } });
}
async function usage(f, query = '', env = f.env) {
  const response = await handleBillingApi(request(f, query), env);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  return response.json();
}
async function reserve(f, extra = {}) {
  const result = await reserveCreditUsage(request(f), f.env, f.user, {
    requestId: randomUUID(), operation: 'chat', model: 'provider/snapshot-original-model',
    requestFingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
    inputTokenUpperBound: 0, maxOutputTokens: 50000, ...extra,
  }, { now: () => f.now });
  assert.equal(result.created, true);
  assert.ok(result.claimToken);
  assert.equal(result.receipt.reservedCredits, 50);
  return result;
}
async function settleTwenty(f, reservation) {
  const receipt = await finalizeCreditUsage(f.env, {
    reservationId: reservation.receipt.id, accountId: f.user.id, claimToken: reservation.claimToken,
    outcome: 'completed', hasValidOutput: true, usage: { promptTokens: 0, completionTokens: 20000 },
  }, { now: () => f.now });
  assert.equal(receipt.status, 'settled');
  assert.equal(receipt.chargedCredits, 20);
  assert.equal(receipt.returnedCredits, 30);
  return receipt;
}
function amounts(snapshot) {
  return { available: snapshot.availableBalance, reserved: snapshot.reservedCredits, spent: snapshot.totalSpent, debt: snapshot.debtCredits };
}
function rowFacts(snapshot) {
  return snapshot.items.map(({ id, status, reservedCredits, chargedCredits, returnedCredits, promptTokens, completionTokens, finalizedAt }) =>
    ({ id, status, reservedCredits, chargedCredits, returnedCredits, promptTokens, completionTokens, finalizedAt }));
}
function afterFirstReadBatch(database, callback) {
  let calls = 0;
  return {
    prepare: sql => database.prepare(sql),
    async batch(statements) {
      const results = await database.batch(statements);
      if (++calls === 1) await callback();
      return results;
    },
    get calls() { return calls; },
  };
}

test('a settlement after the billing read batch cannot mix old wallet totals with a new receipt', async t => {
  const f = await fixture(), held = await reserve(f);
  const old = await usage(f);
  assert.deepEqual(amounts(old), { available: 950, reserved: 50, spent: 0, debt: 0 });
  assert.equal(old.items[0].status, 'reserved');
  let settled;
  // The first real handler read has finished. Settle through the original DB,
  // not the wrapper, before releasing that read's results to the handler. A
  // single atomic read keeps all of its old rows; a later detail read does not.
  const interleaving = afterFirstReadBatch(DB, async () => { settled = await settleTwenty(f, held); });
  const concurrent = await usage(f, '', { ...f.env, DB: interleaving });
  const next = await usage(f);
  assert.ok(settled);
  assert.deepEqual(amounts(next), { available: 980, reserved: 0, spent: 20, debt: 0 });
  assert.deepEqual(next.items, [settled]);
  t.diagnostic(JSON.stringify({ case: 'settle-after-first-read', old: { amounts: amounts(old), rows: rowFacts(old) },
    concurrent: { amounts: amounts(concurrent), rows: rowFacts(concurrent) }, next: { amounts: amounts(next), rows: rowFacts(next) },
    handlerReadBatches: interleaving.calls }));
  assert.deepEqual(amounts(concurrent), amounts(old));
  assert.deepEqual(concurrent.items, old.items, 'all receipts must belong to the same old snapshot as its wallet totals');
  assert.equal(concurrent.nextCursor, old.nextCursor);
});

test('a settlement completed before the billing read returns wholly new totals and receipt facts', async t => {
  const f = await fixture(), held = await reserve(f);
  const settled = await settleTwenty(f, held), snapshot = await usage(f);
  assert.deepEqual(amounts(snapshot), { available: 980, reserved: 0, spent: 20, debt: 0 });
  assert.deepEqual(snapshot.items, [settled]);
  assert.equal(snapshot.accountId, f.user.id);
  assert.equal(snapshot.nextCursor, null);
  t.diagnostic(JSON.stringify({ case: 'settle-before-read', amounts: amounts(snapshot), rows: rowFacts(snapshot) }));
});

async function historicalExempt(f, createdAt) {
  const id = `usage_${randomUUID()}`;
  // No current Super exemption is enabled. This is an immutable historical
  // row with provider usage, as retained by migration 0022 and the read API.
  await DB.prepare(`INSERT INTO super_generation_usage(id,user_id,request_id,operation,model,request_fingerprint,
    input_token_upper_bound,max_output_tokens,price_revision,input_rate,output_rate,authorization_hash,processing_token,
    status,has_valid_output,prompt_tokens,completion_tokens,outcome,created_at,expires_at,finalized_at)
    VALUES(?,?,?,'memory','provider/historical-original-model',?,10,100,1,1,1,?,?,'settled',1,10,20,'completed',?,?,?)`)
    .bind(id, f.user.id, randomUUID(), 'a'.repeat(64), 'b'.repeat(64), randomUUID(), createdAt, createdAt + CREDIT_RESERVATION_TTL_MS, createdAt).run();
  return { id, createdAt, exempt: true };
}
function descending(a, b) { return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0); }
function cursorFor(row) { return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url'); }

test('mixed ordinary and historical exempt pages retain tie ordering, lookahead cursor, ownership and empty-page behavior', async () => {
  const f = await fixture(), other = await fixture();
  const first = await reserve(f), second = await reserve(f);
  const expected = [
    { id: first.receipt.id, createdAt: f.now, exempt: false },
    { id: second.receipt.id, createdAt: f.now, exempt: false },
    await historicalExempt(f, f.now),
    await historicalExempt(f, f.now),
    await historicalExempt(f, f.now - 1),
  ].sort(descending);
  const foreign = await reserve(other), foreignExempt = await historicalExempt(other, f.now + 1);
  const firstPage = await usage(f, '?limit=2');
  const secondPage = await usage(f, `?limit=2&cursor=${firstPage.nextCursor}`);
  const thirdPage = await usage(f, `?limit=2&cursor=${secondPage.nextCursor}`);
  const pages = [firstPage, secondPage, thirdPage];
  assert.deepEqual(pages.map(page => page.items.length), [2, 2, 1]);
  assert.equal(firstPage.nextCursor, cursorFor(expected[1]));
  assert.equal(secondPage.nextCursor, cursorFor(expected[3]));
  assert.equal(thirdPage.nextCursor, null);
  const items = pages.flatMap(page => page.items);
  assert.deepEqual(items.map(item => item.id), expected.map(row => row.id));
  assert.equal(new Set(items.map(item => item.id)).size, expected.length);
  for (const [index, item] of items.entries()) {
    assert.equal(item.accountId, f.user.id);
    assert.equal(item.createdAt, expected[index].createdAt);
    assert.equal(Boolean(item.billingExempt), expected[index].exempt);
    if (expected[index].exempt) {
      assert.equal(item.status, 'settled');
      assert.equal(item.operation, 'memory');
      assert.equal(item.reservedCredits, 0);
      assert.equal(item.chargedCredits, 0);
      assert.equal(item.returnedCredits, 0);
      assert.equal(item.promptTokens, 10);
      assert.equal(item.completionTokens, 20);
    } else {
      assert.equal(item.status, 'reserved');
      assert.equal(item.reservedCredits, 50);
      assert.equal(item.chargedCredits, 0);
      assert.equal(item.returnedCredits, 0);
    }
  }
  for (const page of pages) {
    assert.deepEqual(amounts(page), { available: 900, reserved: 100, spent: 0, debt: 0 });
    assert.equal(page.creditUnlimited, false);
    assert.equal(page.billingExempt, false);
    const source = JSON.stringify(page);
    assert.ok(!source.includes(foreign.receipt.id));
    assert.ok(!source.includes(foreignExempt.id));
    assert.ok(!source.includes(other.user.id));
  }
  const pastEnd = await usage(f, `?limit=2&cursor=${cursorFor(expected.at(-1))}`);
  assert.deepEqual(pastEnd.items, []);
  assert.equal(pastEnd.nextCursor, null);
  assert.deepEqual(amounts(pastEnd), amounts(firstPage));
  const empty = await fixture(0), emptyPage = await usage(empty, '?limit=2');
  assert.equal(emptyPage.accountId, empty.user.id);
  assert.deepEqual(amounts(emptyPage), { available: 0, reserved: 0, spent: 0, debt: 0 });
  assert.deepEqual(emptyPage.items, []);
  assert.equal(emptyPage.nextCursor, null);
});
