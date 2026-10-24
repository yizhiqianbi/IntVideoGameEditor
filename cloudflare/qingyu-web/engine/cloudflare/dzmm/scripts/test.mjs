import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Run the actual Worker against a disposable D1/R2 store. No remote bindings,
// production database, or ordinary .wrangler/state directory are touched.
const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'dzmm-worker-test-'));
const wrangler = join(cwd, 'node_modules/wrangler/bin/wrangler.js');
const config = join(cwd, 'wrangler.jsonc');
const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
let worker;
let workerOutput = '';

async function command(args) {
  const child = spawn(process.execPath, [wrangler, ...args], {
    cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    output = (output + chunk).slice(-50000);
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Wrangler command failed (${code}):\n${output}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function ready(url) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Worker exited:\n${workerOutput}`);
    try {
      // A 401 response still proves the app router is ready.
      const response = await fetch(`${url}/v1/session`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Worker startup timed out:\n${workerOutput}`);
}

try {
  await command(['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', scratch]);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1',
    '--port', String(port), '--config', config, '--persist-to', scratch], {
    cwd, env: childEnv, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => {
    workerOutput = (workerOutput + chunk).slice(-50000);
  });
  await ready(baseUrl);
  const selectedFiles = process.env.QINGYU_TEST_FILES?.split(',').filter(Boolean);
  const testFiles = (await readdir(join(cwd, 'test'))).filter(name => name.endsWith('.test.mjs') && (!selectedFiles || selectedFiles.includes(name))).sort().map(name => join('test', name));
  const tests = spawn(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
    cwd, env: { ...childEnv, DZMM_TEST_BASE_URL: baseUrl, DZMM_TEST_CONFIG_PATH: config, DZMM_TEST_PERSIST_PATH: scratch }, stdio: 'inherit',
  });
  const [code, signal] = await once(tests, 'exit');
  if (signal) process.stderr.write(`Test runner stopped by ${signal}\n`);
  process.exitCode = code ?? 1;
  if (process.exitCode) process.stderr.write(`\nWorker diagnostic output:\n${workerOutput}\n`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (worker && worker.exitCode === null) {
    const stopped = once(worker, 'exit');
    if (process.platform !== 'win32') process.kill(-worker.pid, 'SIGTERM');
    else worker.kill('SIGTERM');
    await Promise.race([stopped, delay(3000)]);
    if (worker.exitCode === null) {
      if (process.platform !== 'win32') process.kill(-worker.pid, 'SIGKILL');
      else worker.kill('SIGKILL');
      await stopped;
    }
  }
  await rm(scratch, { recursive: true, force: true });
}
