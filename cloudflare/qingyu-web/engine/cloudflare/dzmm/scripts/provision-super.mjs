import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(cwd, 'wrangler.production.jsonc');
const backendOrigin = 'https://qingyu-backend.internal';
const expectedAccountId = '274d62c1f24b885b3dfe562cda5d60c1';
const expectedDatabaseId = 'c466b70a-1d70-4e98-9a22-c5e19e20bb06';
const credentialsFile = '/Users/pencil/.codex/private/dzmm-super-credentials.json';
const email = 'super@dzmm.invalid';
const nickname = 'Super';
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
let temporaryCookie = '';

async function checkConfiguration() {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const database = config.d1_databases?.find(item => item.binding === 'DB');
  if (config.name !== 'dzmm-backend' || database?.database_id !== expectedDatabaseId
    || (config.account_id && config.account_id !== expectedAccountId)) {
    throw new Error('生产配置与指定的 DZMM 账户、Worker 或数据库不匹配。');
  }
}

function validateCredentials(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || value.email !== email
    || value.nickname !== nickname || typeof value.password !== 'string'
    || value.password.length < 24 || value.password.length > 256 || value.password.includes('\0')
    || (value.userId !== null && !uuidPattern.test(value.userId ?? ''))) {
    throw new Error('私有凭据文件格式或账户身份不匹配；不会覆盖已有凭据。');
  }
  return value;
}

async function readCredentials() {
  const handle = await open(credentialsFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('私有凭据必须是普通的小型 JSON 文件。');
    await handle.chmod(0o600);
    let value;
    try { value = JSON.parse(await handle.readFile('utf8')); }
    catch { throw new Error('私有凭据文件不是有效的 JSON；不会输出或覆盖其内容。'); }
    return validateCredentials(value);
  } finally { await handle.close(); }
}

async function loadOrCreateCredentials() {
  const directory = dirname(credentialsFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('私有凭据目录不能是符号链接。');
  await chmod(directory, 0o700);
  const initial = {
    version: 1, email, nickname, password: randomBytes(36).toString('base64url'),
    userId: null, role: 'pending', createdAt: new Date().toISOString(),
  };
  let handle;
  try {
    handle = await open(credentialsFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return readCredentials();
    throw new Error('无法安全创建私有凭据文件。');
  }
  try { await handle.writeFile(`${JSON.stringify(initial, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  return initial;
}

async function saveCredentials(credentials) {
  const current = await readCredentials();
  if (current.password !== credentials.password || (current.userId && current.userId !== credentials.userId)) {
    throw new Error('私有凭据在运行期间改变，停止更新。');
  }
  const temporary = `${credentialsFile}.${randomUUID()}.tmp`;
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  try { await rename(temporary, credentialsFile); }
  finally { await rm(temporary, { force: true }); }
}

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`${backendOrigin}/v1${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Origin: backendOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(temporaryCookie ? { Cookie: temporaryCookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('无法连接指定的生产业务 Worker。'); }
  const cookie = response.headers.get('set-cookie');
  if (cookie) temporaryCookie = cookie.split(';')[0];
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`业务 Worker 返回了无效响应（HTTP ${response.status}）。`); }
  return { status: response.status, data };
}

function checkedUser(response, credentials) {
  const user = response.data?.user;
  if (![200, 201].includes(response.status) || !user || user.email !== email || user.isGuest !== false
    || !uuidPattern.test(user.id ?? '') || !['user', 'super'].includes(user.role)
    || (credentials.userId && credentials.userId !== user.id)) {
    throw new Error('服务端账户身份或权限格式不匹配；请先完成迁移和部署。');
  }
  return user;
}

async function promoteExactAccount(userId) {
  if (!uuidPattern.test(userId)) throw new Error('拒绝无效的账户 ID。');
  const command = `UPDATE users SET role='super' WHERE id='${userId}' AND email='${email}' AND is_guest=0;
SELECT id,email,is_guest,role FROM users WHERE id='${userId}' AND email='${email}';`;
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)(process.execPath,
      [join(cwd, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--remote',
        '--config', configPath, '--command', command, '--json'], {
        cwd, timeout: 120_000, maxBuffer: 1024 * 1024,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: expectedAccountId, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
      }));
  } catch { throw new Error('Cloudflare 指定账户的权限提升未完成；原始命令输出未公开。'); }
  let result;
  try { result = JSON.parse(stdout); }
  catch { throw new Error('无法核对 Cloudflare 的权限提升结果。'); }
  const rows = Array.isArray(result) ? result.flatMap(item => item.results ?? []) : [];
  if (rows.length !== 1 || rows[0].id !== userId || rows[0].email !== email
    || rows[0].is_guest !== 0 || rows[0].role !== 'super') {
    throw new Error('指定账户的权限提升结果未通过核对。');
  }
}

async function provision() {
  const credentials = await loadOrCreateCredentials();
  let authenticated = await api('/auth/login', 'POST', { email, password: credentials.password });
  if (authenticated.status === 401) {
    authenticated = await api('/auth/register', 'POST', { email, password: credentials.password, nickname });
    if (authenticated.status === 409) authenticated = await api('/auth/login', 'POST', { email, password: credentials.password });
  }
  if (![200, 201].includes(authenticated.status)) {
    throw new Error(`正常注册或登录未完成（HTTP ${authenticated.status}）；不会重置已有账户密码。`);
  }
  const user = checkedUser(authenticated, credentials);
  credentials.userId = user.id;
  await saveCredentials(credentials);
  if (user.role !== 'super') await promoteExactAccount(user.id);
  const verified = checkedUser(await api('/session'), credentials);
  if (verified.role !== 'super') throw new Error('登录会话尚未返回 Super 权限。');
  credentials.role = 'super';
  credentials.verifiedAt = new Date().toISOString();
  await saveCredentials(credentials);
  return { provisioned: true, email, userId: user.id, role: 'super', credentialsFile, fileMode: '0600' };
}

try {
  await checkConfiguration();
  if (process.argv.length !== 3 || !['--check', '--provision'].includes(process.argv[2])) {
    throw new Error('请先用 --check 检查；生产迁移与部署完成后再显式执行 --provision。');
  }
  if (process.argv[2] === '--check') {
    console.log(JSON.stringify({ ready: true, productionMutation: false, backendOrigin, email, credentialsFile }));
  } else {
    const result = await provision();
    const logout = await api('/auth/logout', 'POST', {});
    temporaryCookie = '';
    if (logout.status !== 200) throw new Error('Super 已创建，但临时管理会话退出未完成。');
    console.log(JSON.stringify({ ...result, temporarySessionRevoked: true }));
  }
} catch (error) {
  // API bodies, command output, passwords, hashes, and cookies never reach logs.
  console.error(error instanceof Error ? error.message : 'Super 配置未完成。');
  process.exitCode = 1;
} finally {
  if (temporaryCookie) {
    try { await api('/auth/logout', 'POST', {}); } catch {}
    temporaryCookie = '';
  }
}
