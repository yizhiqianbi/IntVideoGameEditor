import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Only isolated tests can seed old ledger timestamps; no HTTP clock or reward override exists.
export async function seedTestTaskClaims(userId, claims) {
  assert.match(userId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
  const config = process.env.DZMM_TEST_CONFIG_PATH;
  const persist = process.env.DZMM_TEST_PERSIST_PATH;
  assert.equal(config, join(cwd, 'wrangler.jsonc'));
  assert.ok(typeof persist === 'string' && resolve(persist).startsWith(join(tmpdir(), 'dzmm-worker-test-')));
  assert.ok(Array.isArray(claims) && claims.length <= 20);
  const ids = ['daily_checkin', 'first_conversation', 'publish_character', 'follow_authors', 'complete_profile', 'forum_reply'];
  const sql = claims.map(claim => {
    assert.ok(ids.includes(claim.taskId));
    assert.ok(Number.isSafeInteger(claim.claimedAt) && claim.claimedAt >= 0);
    const period = claim.taskId === 'daily_checkin' ? new Date(claim.claimedAt).toISOString().slice(0, 10) : 'once';
    assert.match(period, /^(once|\d{4}-\d{2}-\d{2})$/);
    const points = claim.taskId === 'publish_character' ? 20 : 5;
    const expiresAt = claim.taskId === 'daily_checkin' ? claim.claimedAt + 30 * 86400000 : 'NULL';
    return `INSERT INTO task_claims(user_id,task_id,period,points,claimed_at,expires_at) VALUES('${userId}','${claim.taskId}','${period}',${points},${claim.claimedAt},${expiresAt});`;
  }).join('\n');
  await promisify(execFile)(process.execPath, [join(cwd, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--local',
    '--config', config, '--persist-to', persist, '--command', sql], { cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' } });
}
