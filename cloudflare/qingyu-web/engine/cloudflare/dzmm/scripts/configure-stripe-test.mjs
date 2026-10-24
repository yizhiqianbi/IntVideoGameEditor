import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Receive credentials only through stdin; never place them in CLI arguments,
// source files, reports, or terminal output. Live keys are rejected.
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedAccount = 'acct_1ULLC6Gopt0xfgLI';
const webhookUrl = 'https://qingyu.invalid/api/payments/stripe/webhook';
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded',
  'refund.created', 'refund.updated', 'refund.failed'];

async function input() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error('Credential input exceeds the expected size.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Expected credential JSON on stdin.'); }
}

async function configure() {
  const credentials = await input();
  const key = credentials.secretKey;
  if (typeof key !== 'string' || !/^sk_test_[A-Za-z0-9]{20,}$/.test(key)) {
    throw new Error('A Stripe test secret key is required; live keys are not accepted.');
  }
  async function stripe(path, parameters, idempotencyKey) {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method: parameters ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(parameters ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: parameters,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Stripe configuration request failed (${response.status}); credentials were not printed.`);
    try { return await response.json(); }
    catch { throw new Error('Stripe returned invalid configuration data; credentials were not printed.'); }
  }
  const account = await stripe('/account');
  if (account.id !== expectedAccount) throw new Error('The Stripe key belongs to a different account. No webhook was changed.');
  const listed = await stripe('/webhook_endpoints?limit=100');
  if (!Array.isArray(listed.data) || listed.has_more !== false) {
    throw new Error('The complete test webhook list could not be verified. No webhook was changed.');
  }
  const matching = listed.data.filter(endpoint => endpoint.url === webhookUrl && endpoint.livemode === false);
  if (matching.length > 1) throw new Error('Multiple matching test webhooks exist. Select the correct endpoint before configuring credentials.');
  let endpoint = matching[0];
  let signingSecret = credentials.webhookSecret;
  if (endpoint) {
    if (typeof signingSecret !== 'string' || !/^whsec_[A-Za-z0-9]{20,}$/.test(signingSecret)) {
      throw new Error(`Test endpoint ${endpoint.id} already exists; its signing secret must be supplied from Stripe. No duplicate was created.`);
    }
    const parameters = new URLSearchParams({ disabled: 'false' });
    for (const event of events) parameters.append('enabled_events[]', event);
    endpoint = await stripe(`/webhook_endpoints/${endpoint.id}`, parameters);
  } else {
    const parameters = new URLSearchParams({ url: webhookUrl, description: '晴屿测试充值到账通知' });
    for (const event of events) parameters.append('enabled_events[]', event);
    endpoint = await stripe('/webhook_endpoints', parameters, `qingyu-test-webhook-${expectedAccount}-v1`);
    signingSecret = endpoint.secret;
  }
  if (endpoint.livemode !== false || endpoint.url !== webhookUrl || typeof signingSecret !== 'string' || !/^whsec_[A-Za-z0-9]{20,}$/.test(signingSecret)) {
    throw new Error('Stripe returned an invalid test webhook configuration.');
  }
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const child = spawn(process.execPath, [wrangler, 'secret', 'bulk', '--config', 'wrangler.production.jsonc'], {
    cwd: backendRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Deliberately omit captured CLI output from both success and failure reports.
  // Wrangler receives the key and endpoint secret directly in memory.
  child.stdout.resume(); child.stderr.resume();
  child.stdin.end(JSON.stringify({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: signingSecret }));
  const code = await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start Cloudflare secret configuration.')));
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Cloudflare rejected the secret upload. Retry with the existing endpoint signing secret; no duplicate webhook is needed.');
  console.log(JSON.stringify({ configured: true, mode: 'test', accountId: account.id, webhookId: endpoint.id,
    webhookUrl, enabledEvents: events, credentialsStored: 'Cloudflare Worker Secrets only' }));
}

configure().catch(error => { console.error(error.message); process.exitCode = 1; });
