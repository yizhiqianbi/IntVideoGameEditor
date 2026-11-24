/** Start the official MaiBot Runner/Worker, a transport-only gateway, and XUMENG. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createConnection } from 'node:net';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(repository, 'experiments/maibot-native');
const instance = resolve(root, 'instance');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dry-run') || args.length > 1) throw new Error('仅支持 --dry-run。');
const entry = 'http://127.0.0.1:3010/xumeng#chat/girlfriend';
const definitions = [
  { name: 'MaiBot 原生运行时', command: resolve(root, 'upstream/.venv/bin/maibot'), args: ['run', '--directory', instance], port: 18001 },
  { name: '女友消息网关', command: process.execPath, args: [resolve(root, 'gateway.mjs')], port: 3227 },
  { name: '叙梦', command: process.execPath, args: [resolve(repository, 'scripts/xumeng-dev.mjs')], port: 3010 },
];
if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ entry, runtime: 'official MaiBot Runner + Worker', services: definitions, legacyEngine: false, agreementAcceptance: 'user confirmation required; never automatic' }, null, 2));
  process.exit(0);
}
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  // Native shutdown persists memory and allows up to 50s, with its runner using
  // a 60s hard deadline. Do not truncate vector/graph writes after six seconds.
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }, 65_000);
  timer.unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
async function occupied(port) {
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = result => { socket.destroy(); done(result); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(1000, () => finish(false));
  });
}
async function gatewayHealth() {
  try { return await (await fetch('http://127.0.0.1:3227/api/health', { signal: AbortSignal.timeout(20_000) })).json(); }
  catch { return null; }
}
async function confirmationsPresent() {
  for (const [document, marker] of [['EULA.md', 'eula.confirmed'], ['PRIVACY.md', 'privacy.confirmed']]) {
    const expected = createHash('md5').update(await readFile(resolve(root, 'upstream', document))).digest('hex');
    try { if ((await readFile(resolve(instance, marker), 'utf8')).trim() !== expected) return false; }
    catch { return false; }
  }
  return true;
}
function start(service, native = false) {
  let log;
  if (native) log = openSync(resolve(instance, 'logs/launcher.log'), 'a', 0o600);
  const child = spawn(service.command, service.args, {
    cwd: repository, stdio: native ? ['inherit', log, log] : 'inherit',
    env: { ...process.env, MAIBOT_INSTANCE_DIR: instance, MAIBOT_GATEWAY_PORT: '3227', MAIBOT_WEBUI_URL: 'http://127.0.0.1:18001', TZ: 'Asia/Shanghai', XUMENG_COMPANION_URL: 'http://127.0.0.1:3227' },
  });
  if (log !== undefined) closeSync(log);
  children.add(child);
  child.once('error', error => { console.error(`${service.name}启动失败：${error.message}`); stop(1); });
  child.once('exit', code => { children.delete(child); if (!stopping) { console.error(`${service.name}已退出，请查看本机日志。`); stop(code || 1); } });
  return child;
}
try {
  await mkdir(resolve(instance, 'logs'), { recursive: true, mode: 0o700 });
  for (const service of definitions.slice(1)) {
    if (await occupied(service.port)) {
      if (service.port === 3227 && (await gatewayHealth())?.runtime !== 'maibot-native') throw new Error('3227 仍被旧聊天服务占用。请停止旧启动器后重试。');
      console.log(`${service.name}已在运行。`);
    } else { start(service); console.log(`正在启动${service.name}…`); }
  }
  const confirmed = await confirmationsPresent();
  if (!(await occupied(18001))) {
    if (!confirmed && !process.stdin.isTTY) throw new Error('MaiBot 首次启动需由用户在交互终端确认 EULA 与隐私条款。');
    start(definitions[0], true);
    if (!confirmed) {
      console.log('MaiBot 首次运行需要你阅读并接受官方 EULA.md 与 PRIVACY.md。');
      console.log(`文件目录：${resolve(root, 'upstream')}`);
      console.log('仅在你已阅读并同意后，输入 confirmed 再回车；此启动器不会自动接受条款。');
    }
    console.log(`原生运行日志：${resolve(instance, 'logs/launcher.log')}（包含本机管理信息，请勿公开）`);
  }
  const deadline = Date.now() + (confirmed ? 180_000 : 3_600_000);
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    const status = await gatewayHealth();
    if (status?.runtime === 'maibot-native' && status.ready) {
      ready = true;
      console.log(`MaiBot 已连接：${entry}`);
      console.log('按 Ctrl+C 停止本次启动的服务；原生记忆会先完成持久化。');
      break;
    }
    await new Promise(done => setTimeout(done, 2500));
  }
  if (!stopping && !ready) throw new Error('MaiBot 启动超时，请查看原生日志；本次启动的进程将关闭。');
} catch (error) { console.error(error.message); stop(1); }
