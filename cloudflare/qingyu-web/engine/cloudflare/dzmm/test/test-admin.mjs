import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Only the disposable store created by scripts/test.mjs can be promoted here.
// There is no API route or remote D1 operation for granting this role.
export async function promoteTestUserToSuper(userId) {
  assert.match(userId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
  const config = process.env.DZMM_TEST_CONFIG_PATH;
  const persist = process.env.DZMM_TEST_PERSIST_PATH;
  assert.equal(config, join(cwd, 'wrangler.jsonc'));
  assert.ok(typeof persist === 'string' && resolve(persist).startsWith(join(tmpdir(), 'dzmm-worker-test-')));
  await promisify(execFile)(process.execPath, [join(cwd, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'DB', '--local', '--config', config, '--persist-to', persist,
    '--command', `UPDATE users SET role='super' WHERE id='${userId}' AND is_guest=0;`], {
    cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
  });
}
