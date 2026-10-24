import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';

const { companionReserve, companionFinalize, companionOverview } = await tsImport('../src/companion-billing.ts', import.meta.url);
const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
let mf, db;
async function migrate(database) {
  for (const file of migrations) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(Boolean).map(sql => database.prepare(sql)));
  }
}
before(async () => { mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true, script: 'export default {fetch(){return new Response("test")}}', d1Databases: { DB: 'companion-billing' } })); db = await mf.getD1Database('DB'); await migrate(db); });
after(async () => mf?.dispose());
async function fixture(credits = 10) {
  const userId = randomUUID(), token = randomBytes(32).toString('hex'), now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,?,?)').bind(userId, `${userId}@test.invalid`, '测试', 0, now),
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'), userId, now + 86400000, now),
    db.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)').bind(`grant_${userId}`, userId, credits, 'isolated test', now),
  ]);
  return { userId, token, env: { DB: db, COMPANION_BILLING_ENABLED: 'true' } };
}
function input(f, requestId = randomUUID()) { return { sessionToken: f.token, accountId: f.userId, requestId, sessionId: randomUUID(), requestFingerprint: createHash('sha256').update(requestId).digest('hex') }; }

test('companion reservation is exactly two credits, idempotent, and failed replies release it', async () => {
  const f = await fixture(4), value = input(f);
  const first = await companionReserve(f.env, value); assert.equal(first.created, true); assert.equal(first.receipt.reservedCredits, 2);
  const replay = await companionReserve(f.env, value); assert.equal(replay.created, false); assert.equal(replay.receipt.id, first.receipt.id); assert.equal(replay.claimToken, undefined);
  const done = await companionFinalize(f.env, { accountId: f.userId, reservationId: first.receipt.id, claimToken: first.claimToken, outcome: 'failed' });
  assert.equal(done.receipt.status, 'released'); assert.equal(done.receipt.chargedCredits, 0);
  const overview = await companionOverview(f.env, new Request('https://billing.invalid'), { id: f.userId, isGuest: false });
  assert.equal(overview.balance, 4); assert.equal(overview.receipts[0].status, 'released');
});

test('completed reply charges two credits once and insufficient balance fails closed', async () => {
  const f = await fixture(2), first = await companionReserve(f.env, input(f));
  const done = await companionFinalize(f.env, { accountId: f.userId, reservationId: first.receipt.id, claimToken: first.claimToken, outcome: 'completed' });
  assert.equal(done.receipt.chargedCredits, 2);
  await assert.rejects(companionReserve(f.env, input(f)), error => error?.status === 402);
  const replay = await companionFinalize(f.env, { accountId: f.userId, reservationId: first.receipt.id, claimToken: first.claimToken, outcome: 'completed' });
  assert.equal(replay.receipt.chargedCredits, 2);
});
