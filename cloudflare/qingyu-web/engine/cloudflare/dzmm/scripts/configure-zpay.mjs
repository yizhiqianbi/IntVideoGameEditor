import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Private stdin -> provider verification -> existing Worker Secrets. No
// credentials, signed checkout data or provider balances are written to disk.
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
async function configure() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 8192) throw new Error('Credential input is too large.');
  }
  let values;
  try { values = JSON.parse(input); } catch { throw new Error('Provide credential JSON through private stdin.'); }
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Credential object required.');
  const { pid, key, alipayChannelId, wxpayChannelId } = values;
  if (typeof pid !== 'string' || !/^[A-Za-z0-9]{1,120}$/.test(pid)
    || typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(key)) {
    throw new Error('A valid Z-Pay merchant ID and API key are required.');
  }
  if (values.action !== undefined && !['check', 'configure'].includes(values.action)) throw new Error('Unknown configuration action.');
  for (const channel of [alipayChannelId, wxpayChannelId]) {
    if (channel !== undefined && (typeof channel !== 'string' || !/^[1-9]\d{0,29}$/.test(channel))) throw new Error('Invalid channel ID.');
  }
  const url = new URL('https://zpayz.cn/api.php');
  url.search = new URLSearchParams({ act: 'balance', pid, key }).toString();
  let result;
  try {
    // Z-Pay currently returns a different, non-API envelope for application/json.
    // Accept its normal response, then still require the documented JSON schema.
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Accept: '*/*' } });
    if (!response.ok || Number(response.headers.get('Content-Length')) > 32768) throw new Error();
    const body = await response.text();
    if (Buffer.byteLength(body) > 32768) throw new Error();
    result = JSON.parse(body);
  } catch { throw new Error('Z-Pay credential verification failed; private request details were not printed.'); }
  if (result?.code !== 1 || typeof result.balance !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(result.balance)) {
    throw new Error('Z-Pay did not verify these merchant credentials.');
  }
  const readiness = { provider: 'zpay', credentialsVerified: true, channelApprovalVerifiedByScript: false,
    alipayChannelSpecified: Boolean(alipayChannelId), wxpayChannelSpecified: Boolean(wxpayChannelId),
    ordersCreated: 0, paymentsPerformed: 0 };
  if (values.action === 'check') { console.log(JSON.stringify({ ...readiness, mutations: 0 })); return; }
  if (!alipayChannelId && !wxpayChannelId) throw new Error('Specify at least one approved merchant channel before storing credentials.');
  const secrets = { ZPAY_PID: pid, ZPAY_KEY: key };
  if (alipayChannelId) secrets.ZPAY_ALIPAY_CHANNEL_ID = alipayChannelId;
  if (wxpayChannelId) secrets.ZPAY_WXPAY_CHANNEL_ID = wxpayChannelId;
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const child = spawn(process.execPath, [wrangler, 'secret', 'bulk', '--config', 'wrangler.production.jsonc'], {
    cwd: backendRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.resume(); child.stderr.resume();
  child.stdin.end(JSON.stringify(secrets));
  const code = await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start Worker secret configuration.')));
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Cloudflare rejected the Z-Pay secret upload.');
  console.log(JSON.stringify({ ...readiness, configured: true, credentialsStored: 'Cloudflare Worker Secrets only',
    paymentEnablementChanged: false, stripeCredentialsPreserved: true }));
}
configure().catch(error => { console.error(error.message); process.exitCode = 1; });
