import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This stores credentials only. It never creates payments, changes a wallet,
// accepts merchant terms or enables collection. Input and child output are not logged.
export async function configureNowpayments(input, upload = uploadSecrets) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['apiKey', 'ipnSecret'].includes(key))
    || !['apiKey', 'ipnSecret'].every(key => typeof input[key] === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(input[key]))) {
    throw new Error('需要通过私有 stdin 提供 API Key 和 IPN Secret；输入未保存。');
  }
  await upload({ NOWPAYMENTS_API_KEY: input.apiKey, NOWPAYMENTS_IPN_SECRET: input.ipnSecret });
  return { configured: true, credentialsStored: 'Cloudflare backend Worker Secrets only',
    paymentEnablementChanged: false, credentialValidityVerified: false, ordersCreated: 0, paymentsPerformed: 0 };
}
function uploadSecrets(values) {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, 'secret', 'bulk', '--config', 'wrangler.production.jsonc'], {
      cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('密钥配置程序未能启动。')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('服务器未确认密钥写入完成；请核对后重试。')); });
    child.stdin.on('error', () => { /* Child exit owns the safe failure message. */ });
    child.stdin.end(JSON.stringify(values));
  });
}
async function main() {
  if (process.argv.length !== 2) throw new Error('不接受命令行凭据。请使用私有 stdin。');
  let bytes = 0, source = '';
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 4096) throw new Error('凭据输入超出限制；未保存。');
    source += chunk.toString('utf8');
  }
  let input; try { input = JSON.parse(source); } catch { throw new Error('凭据 JSON 无效；未保存。'); }
  console.log(JSON.stringify(await configureNowpayments(input)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  // No raw provider, child-process or credential error is ever emitted.
  const messages = ['不接受命令行凭据。请使用私有 stdin。', '凭据输入超出限制；未保存。', '凭据 JSON 无效；未保存。',
    '需要通过私有 stdin 提供 API Key 和 IPN Secret；输入未保存。', '密钥配置程序未能启动。', '服务器未确认密钥写入完成；请核对后重试。'];
  console.error(messages.includes(error.message) ? error.message : '密钥配置失败；私有输出未打印。'); process.exitCode = 1;
});
