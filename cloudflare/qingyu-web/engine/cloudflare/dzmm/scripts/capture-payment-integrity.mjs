import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Read-only D1 snapshot. Payment rows remain in memory; output contains only
// counts and SHA-256 fingerprints, never checkout URLs, balances or credentials.
const run = promisify(execFile);
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after phase.');
const scope = process.argv[3];
if (scope !== undefined && !['tiers', 'subscriptions', 'usage'].includes(scope)) throw new Error('Unknown integrity capture scope.');
let captureStep = 'initial';
async function query(sql) {
  let stdout;
  try {
    ({ stdout } = await run(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--remote', '--config',
      'wrangler.production.jsonc', '--json', '--command', sql], { cwd: backendRoot,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' }, maxBuffer: 2 * 1024 * 1024 }));
  } catch { throw new Error('Read-only D1 integrity query failed; query output was not printed.'); }
  const results = JSON.parse(stdout);
  if (!Array.isArray(results) || results.length !== 1 || results[0].success !== true || results[0].meta.rows_written !== 0) {
    throw new Error('Unexpected D1 integrity response.');
  }
  return results[0].results;
}
async function snapshot() {
  const tables = {};
  for (const [name, order] of [
    ['payment_orders', 'id'], ['payment_events', 'event_id'], ['payment_refunds', 'refund_id'], ['payment_credit_ledger', 'id'],
    ...(scope !== undefined ? [['zpay_orders', 'id'], ['zpay_events', 'event_id'], ['zpay_refund_state', 'refund_id'], ['zpay_credit_ledger', 'id']] : []),
    ...(scope === 'usage' ? [['subscription_orders', 'id'], ['subscription_events', 'event_id'],
      ['subscription_periods', 'id'], ['subscription_daily_claims', 'id'], ['subscription_credit_ledger', 'id'],
      ['zpay_payment_bindings', 'out_trade_no'], ['conversations', 'id'], ['messages', 'id']] : []),
  ]) {
    captureStep = name;
    const rows = await query(`SELECT * FROM ${name} ORDER BY ${order}`);
    tables[name] = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  captureStep = 'statistics';
  const statistics = await query(`SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM users WHERE email_verified_at IS NOT NULL) AS verified_email_accounts,
    (SELECT COUNT(*) FROM sessions) AS sessions,
    (SELECT COUNT(*) FROM conversations) AS conversations,
    (SELECT COUNT(*) FROM messages) AS messages,
    (SELECT COUNT(*) FROM characters) AS private_characters,
    (SELECT seq FROM sqlite_sequence WHERE name='payment_credit_ledger') AS stripe_ledger_sequence
    ${scope !== undefined ? ", (SELECT seq FROM sqlite_sequence WHERE name='zpay_credit_ledger') AS zpay_ledger_sequence" : ''}`);
  captureStep = 'foreign_keys';
  const foreignKeys = await query('PRAGMA foreign_key_check');
  const report = { phase, capturedAt: new Date().toISOString(), stateMutations: 0, tables,
    statistics: statistics[0], foreignKeyViolations: foreignKeys.length };
  const filename = scope === 'usage' ? `credit-usage-migration-integrity-${phase}-2026-10-05.json`
    : scope === 'subscriptions' ? `zpay-subscription-migration-integrity-${phase}-2026-10-05.json`
    : scope === 'tiers' ? `zpay-tier-migration-integrity-${phase}-2026-10-05.json` : `zpay-migration-integrity-${phase}-2026-10-04.json`;
  const path = resolve(backendRoot, '../../output/xumeng', filename);
  await mkdir(resolve(backendRoot, '../../output/xumeng'), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath: path, ...report }));
}
snapshot().catch(() => { console.error(`Read-only integrity capture failed at ${captureStep}; no private query result was printed.`); process.exitCode = 1; });
