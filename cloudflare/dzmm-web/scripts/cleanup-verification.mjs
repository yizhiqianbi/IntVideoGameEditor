import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const reportPath = join(root, 'output/dzmm/frontend-cloudflare-verification.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
if (report.cleanupCompleted) {
  console.log('Deployment verification resources already cleaned.');
  process.exit(0);
}
const credentialPath = join(tmpdir(), 'dzmm-cloudflare-deployment-ui.json');
const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
assert.equal(credentials.baseUrl, report.baseUrl);
assert.ok(credentials.email.startsWith('dzmm-deploy-') && credentials.email.endsWith('@example.invalid'));
assert.ok(report.syntheticAccountIds.includes(credentials.userId));
assert.equal(report.syntheticAccountIds.length, 2);
assert.ok(report.syntheticAccountIds.every(id => /^[a-f0-9-]{36}$/.test(id)));
const base = credentials.baseUrl;
const login = await fetch(`${base}/api/dzmm/backend/v1/auth/login`, {
  method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: credentials.email, password: credentials.password }),
});
assert.equal(login.status, 200);
assert.equal((await login.json()).user.id, credentials.userId);
const cookie = login.headers.getSetCookie().find(item => item.startsWith('dzmm_session=')).split(';')[0];
const deleted = await fetch(new URL(credentials.mediaPath, base), {
  method: 'DELETE', headers: { Origin: base, Cookie: cookie },
});
assert.equal(deleted.status, 200);
const missing = await fetch(new URL(credentials.mediaPath, base), { headers: { Cookie: cookie } });
assert.equal(missing.status, 404);
const logout = await fetch(`${base}/api/dzmm/backend/v1/auth/logout`, {
  method: 'POST', headers: { Origin: base, Cookie: cookie },
});
assert.equal(logout.status, 200);

const ids = report.syntheticAccountIds.map(id => `'${id}'`).join(',');
const sql = `DELETE FROM users WHERE id IN (${ids}) AND (email LIKE 'dzmm-deploy-%@example.invalid' OR (is_guest=1 AND email IS NULL));\nSELECT COUNT(*) AS remaining FROM users WHERE id IN (${ids});\n`;
const sqlPath = join(tmpdir(), 'dzmm-cloudflare-deployment-cleanup.sql');
await writeFile(sqlPath, sql, { mode: 0o600 });
try {
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const config = join(root, 'cloudflare/dzmm/wrangler.production.jsonc');
  const child = spawn(process.execPath, [wrangler, 'd1', 'execute', 'dzmm-db', '--remote', '--config', config, '--file', sqlPath, '--yes', '--json'], {
    cwd: webRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error(`Cloudflare verification cleanup failed: ${errors}`);
  // D1 file execution may emit upload progress before its JSON result.
  const jsonStart = output.search(/^\[\s*$/m);
  const result = JSON.parse(jsonStart < 0 ? output : output.slice(jsonStart));
  assert.equal(result.at(-1).results[0].remaining, 0);
} finally {
  await unlink(sqlPath).catch(() => {});
}
report.cleanupCompleted = true;
report.cleanupCompletedAt = new Date().toISOString();
report.checks.push({ name: 'synthetic-r2-and-d1-cleanup', passed: true, deletedAccounts: 2, deletedMediaObjects: 1 });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await unlink(credentialPath);
console.log(JSON.stringify({ cleanupCompleted: true, deletedAccounts: 2, deletedMediaObjects: 1, checks: report.checks.length }));
