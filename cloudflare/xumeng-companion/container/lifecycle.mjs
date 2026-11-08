/** Single-account native lifecycle. Durable storage is owned by the outer host. */
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const wait = ms => new Promise(done => setTimeout(done, ms));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const lifecycleError = (code, status = 503) => Object.assign(new Error(code), { code, status });

async function exists(path) { try { await access(path); return true; } catch { return false; } }

async function managedProcess(command, args, options, logfile) {
  const log = await open(logfile, 'a', 0o600);
  try {
    const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', log.fd, log.fd] });
    const process = { child, done: false, result: null };
    // Attach before the first await; spawn errors can arrive on the next tick.
    process.exited = new Promise(done => {
      const finish = result => { process.done = true; process.result = result; done(result); };
      child.once('exit', (code, signal) => finish({ code, signal }));
      child.once('error', () => finish({ code: 1, signal: null }));
    });
    return process;
  } finally { await log.close(); }
}

async function stopProcess(process, deadline) {
  if (!process) return { code: 0, signal: null };
  if (process.done) {
    if (process.result?.code !== 0) throw lifecycleError('NATIVE_STOP_UNCLEAN');
    return process.result;
  }
  process.child.kill('SIGTERM');
  const remaining = Math.max(0, deadline - Date.now());
  let timer;
  const timeout = new Promise(done => { timer = setTimeout(() => done(null), remaining); });
  const result = await Promise.race([process.exited, timeout]);
  clearTimeout(timer);
  if (!result) {
    // Runner owns a Worker and plugin descendants. Kill the isolated process
    // group at deadline so an orphan cannot keep writing or calling providers.
    try { globalThis.process.kill(-process.child.pid, 'SIGKILL'); }
    catch { process.child.kill('SIGKILL'); }
    throw lifecycleError('NATIVE_STOP_TIMEOUT');
  }
  if (result.code !== 0) throw lifecycleError('NATIVE_STOP_UNCLEAN');
  return result;
}

export const DEFAULT_PORTS = Object.freeze({ webui: 18001, gateway: 3227, wsServer: 8095, apiServer: 8096 });

export function defaultRuntime({ env = process.env, instance, source, packageDir, fetcher = fetch, ports = DEFAULT_PORTS }) {
  const python = join(source, '.venv/bin/python');
  const childEnv = { ...env, MAIBOT_INSTANCE_DIR: instance, MAIBOT_WEBUI_URL: `http://127.0.0.1:${ports.webui}`, MAIBOT_GATEWAY_PORT: String(ports.gateway), TZ: 'Asia/Shanghai' };
  delete childEnv.COMPANION_CONTROL_TOKEN;
  const gateway = `http://127.0.0.1:${ports.gateway}`;
  const command = async (script, args) => {
    try { return await execute(python, [join(packageDir, script), ...args], { env: childEnv, maxBuffer: 32 * 1024, timeout: 120_000 }); }
    catch { throw lifecycleError('INSTANCE_OPERATION_FAILED'); }
  };
  return {
    async prepare() {
      const present = await exists(instance);
      // Ports and the memory data path are rewritten on every start: a snapshot
      // may have been taken in a pool slot with a different directory/ports.
      await command('prepare-instance.py', ['--directory', instance, '--webui-port', String(ports.webui),
        '--ws-port', String(ports.wsServer), '--api-port', String(ports.apiServer), ...(present ? ['--check-existing'] : [])]);
    },
    async startNative() {
      await mkdir(join(instance, 'logs'), { recursive: true, mode: 0o700 });
      return managedProcess(join(source, '.venv/bin/maibot'), ['run', '--directory', instance], { env: childEnv, cwd: instance }, join(instance, 'logs/container-native.log'));
    },
    async startGateway() {
      return managedProcess(process.execPath, [join(packageDir, 'gateway.mjs')], { env: childEnv, cwd: packageDir }, join(instance, 'logs/container-gateway.log'));
    },
    stopProcess,
    async nativeHealth() {
      const response = await fetcher(`${gateway}/api/health`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw lifecycleError('NATIVE_NOT_READY');
      return response.json();
    },
    async proxy(path, { method, body, signal }) {
      return fetcher(`${gateway}${path}`, {
        method, body, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)].filter(Boolean)), redirect: 'error',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      });
    },
    async snapshot(path, account) { await command('archive.py', ['snapshot', '--instance', instance, '--archive', path, '--account', account]); },
    async restore(path, account, template) {
      const args = ['restore', '--instance', instance, '--archive', path, '--account', account];
      if (template) args.push('--template', template);
      await command('archive.py', args);
    },
  };
}

export class CompanionLifecycle {
  constructor({ env = process.env, packageDir = '/opt/companion', runtime, ports = DEFAULT_PORTS, startupTimeoutMs = 120_000, stopTimeoutMs = 90_000, pollMs = 500, now = Date.now } = {}) {
    this.env = env;
    this.instance = resolve(env.COMPANION_INSTANCE_DIR || '/var/lib/xumeng-companion/instance');
    this.source = resolve(env.MAIBOT_SOURCE_DIR || '/opt/maibot');
    this.account = env.COMPANION_ACCOUNT_ID || '';
    this.runtime = runtime || defaultRuntime({ env, instance: this.instance, source: this.source, packageDir, ports });
    this.now = now;
    this.timings = {};
    this.bootId = randomUUID();
    this.state = 'stopped';
    this.native = this.gateway = null;
    this.active = new Set();
    this.operation = false;
    this.cleanStop = true;
    this.startupTimeoutMs = startupTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.pollMs = pollMs;
  }
  health() {
    return { service: 'xumeng-companion-container', bootId: this.bootId, state: this.state,
      runtimeStarted: Boolean(this.native && !this.native.done || this.gateway && !this.gateway.done),
      ready: this.state === 'running', nativeReady: this.state === 'running',
      durabilityReady: false, persistence: 'external-host', cleanStop: this.cleanStop, timings: { ...this.timings } };
  }
  async exclusive(fn) {
    if (this.operation) throw lifecycleError('LIFECYCLE_BUSY', 409);
    this.operation = true;
    try { return await fn(); } finally { this.operation = false; }
  }
  watch(process) {
    process.exited?.then(() => {
      if (['running', 'starting'].includes(this.state)) { this.state = 'failed'; this.cleanStop = false; }
    });
  }
  async start() {
    return this.exclusive(async () => {
      if (this.state === 'running') return this.health();
      if (this.state !== 'stopped' || !this.cleanStop) throw lifecycleError('INSTANCE_REQUIRES_RECOVERY', 409);
      if (!uuid.test(this.account)) throw lifecycleError('TRIAL_ACCOUNT_NOT_CONFIGURED');
      this.state = 'starting';
      const startedAt = this.now();
      try {
        await this.runtime.prepare();
        const prepared = this.now();
        this.native = await this.runtime.startNative(); this.watch(this.native);
        this.gateway = await this.runtime.startGateway(); this.watch(this.gateway);
        const deadline = Date.now() + this.startupTimeoutMs;
        while (Date.now() < deadline && this.state === 'starting') {
          let health;
          try { health = await this.runtime.nativeHealth(); } catch { /* Native boot is bounded below. */ }
          if (health?.runtime === 'maibot-native' && health.ready === true && this.state === 'starting') {
            this.state = 'running'; this.cleanStop = false;
            const ready = this.now();
            this.timings.prepareMs = prepared - startedAt;
            this.timings.nativeBootMs = ready - prepared;
            this.timings.startMs = ready - startedAt;
            return this.health();
          }
          await wait(this.pollMs);
        }
        throw lifecycleError('NATIVE_START_TIMEOUT');
      } catch (error) {
        this.state = 'stopping';
        try { await this.stopChildren(Date.now() + this.stopTimeoutMs); }
        catch { this.cleanStop = false; }
        this.state = 'failed';
        throw error;
      }
    });
  }
  async stopChildren(deadline) {
    // Native finishes memory writes while the gateway is still receiving final events.
    let failure;
    try { await this.runtime.stopProcess(this.native, deadline); } catch (error) { failure = error; }
    try { await this.runtime.stopProcess(this.gateway, deadline); } catch (error) { failure ||= error; }
    if (failure) throw failure;
    this.native = this.gateway = null;
  }
  async stop() {
    return this.exclusive(async () => {
      if (this.state === 'stopped' && this.cleanStop) return this.health();
      const alreadyFailed = this.state === 'failed';
      this.state = 'stopping';
      const deadline = Date.now() + this.stopTimeoutMs;
      try {
        while (this.active.size && Date.now() < deadline) await wait(Math.min(this.pollMs, 100));
        if (this.active.size) {
          // Revoke the runtime even when an accepted transport request hangs.
          // An expired deadline forces termination and can never yield a backup.
          try { await this.stopChildren(deadline); } catch { /* Preserve the drain failure. */ }
          throw lifecycleError('REQUEST_DRAIN_TIMEOUT');
        }
        await this.stopChildren(deadline);
        if (alreadyFailed) throw lifecycleError('INSTANCE_STOPPED_AFTER_FAILURE');
        this.state = 'stopped'; this.cleanStop = true;
        return this.health();
      } catch (error) {
        this.state = 'failed'; this.cleanStop = false;
        throw error;
      }
    });
  }
  /** Pool-only: terminate this tenant's processes before its files are removed.
   * The host calls this after a committed checkpoint or an explicit reset. */
  async discard(deadlineMs = 15_000) {
    if (this.operation) throw lifecycleError('LIFECYCLE_BUSY', 409);
    this.operation = true;
    try {
      this.state = 'stopping';
      try { await this.stopChildren(Date.now() + deadlineMs); } catch { /* Process groups are killed at the deadline. */ }
      this.native = this.gateway = null;
      this.state = 'discarded';
    } finally { this.operation = false; }
  }
  async proxy(path, options) {
    if (this.state !== 'running' || this.operation) throw lifecycleError('NATIVE_NOT_READY');
    const id = randomUUID(); this.active.add(id);
    try {
      const response = await this.runtime.proxy(path, options);
      // Read to completion before a snapshot can begin; native JSON can include history.
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body || []) {
        bytes += chunk.byteLength;
        if (bytes > 16 * 1024 * 1024) throw lifecycleError('NATIVE_RESPONSE_TOO_LARGE', 502);
        chunks.push(chunk);
      }
      return { status: response.status, body: Buffer.concat(chunks), contentType: response.headers.get('content-type') || 'application/json' };
    } finally { this.active.delete(id); }
  }
  async snapshot(path) {
    return this.exclusive(async () => {
      if (this.state !== 'stopped' || !this.cleanStop) throw lifecycleError('SNAPSHOT_REQUIRES_CLEAN_STOP', 409);
      this.state = 'snapshotting';
      try { await this.runtime.snapshot(path, this.account); }
      finally { this.state = 'stopped'; }
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return { size: (await stat(path)).size, sha256: hash.digest('hex') };
    });
  }
  async restore(path, template) {
    return this.exclusive(async () => {
      if (this.state !== 'stopped' || !this.cleanStop) throw lifecycleError('RESTORE_REQUIRES_STOP', 409);
      if (!uuid.test(this.account)) throw lifecycleError('TRIAL_ACCOUNT_NOT_CONFIGURED');
      this.state = 'restoring';
      const startedAt = this.now();
      try { await this.runtime.restore(path, this.account, template); }
      finally { this.state = 'stopped'; }
      this.timings.restoreMs = this.now() - startedAt;
      return { restored: true, template: template || undefined, ...this.health() };
    });
  }
}
