import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Credentials enter via private stdin only. This script never charges a card,
// changes business verification data, or replaces the retained test secrets.
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedAccount = 'acct_1UM3rVGsmSdUNsEh';
const webhookUrl = 'https://qingyu.invalid/api/payments/stripe/webhook';
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded',
  'refund.created', 'refund.updated', 'refund.failed'];

async function configure() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 16384) throw new Error('Credential input exceeds the expected size.');
  }
  let credentials;
  try { credentials = JSON.parse(input); }
  catch { throw new Error('Expected credential JSON on stdin.'); }
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Expected credential JSON on stdin.');
  const key = credentials.secretKey;
  if (typeof key !== 'string' || !/^sk_live_[A-Za-z0-9]{20,}$/.test(key)) {
    throw new Error('A Stripe live secret key is required; test keys are not accepted.');
  }
  if (credentials.action !== undefined && !['check', 'configure'].includes(credentials.action)) throw new Error('Unknown configuration action.');
  async function stripe(path, parameters, idempotencyKey) {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method: parameters ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json',
        ...(parameters ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: parameters?.toString(),
    });
    if (!response.ok) throw new Error(`Stripe configuration request failed (${response.status}); credentials were not printed.`);
    try { return await response.json(); }
    catch { throw new Error('Stripe returned invalid configuration data; credentials were not printed.'); }
  }
  const account = await stripe('/account');
  if (account.id !== expectedAccount || account.object !== 'account') throw new Error('The live key belongs to a different account. No webhook was changed.');
  const readiness = { accountId: account.id, mode: 'live', detailsSubmitted: account.details_submitted === true,
    chargesEnabled: account.charges_enabled === true, payoutsEnabled: account.payouts_enabled === true };
  if (credentials.action === 'check') {
    console.log(JSON.stringify({ ...readiness, ready: readiness.detailsSubmitted && readiness.chargesEnabled, mutations: 0 }));
    return;
  }
  if (!readiness.detailsSubmitted || !readiness.chargesEnabled) {
    throw new Error('Stripe has not enabled live charges for this account. Complete account activation first; no webhook or Worker secret was changed.');
  }
  const listed = await stripe('/webhook_endpoints?limit=100');
  if (listed.object !== 'list' || !Array.isArray(listed.data) || listed.has_more !== false) throw new Error('The complete live webhook list could not be verified. No webhook was changed.');
  const matching = listed.data.filter(endpoint => endpoint.url === webhookUrl && endpoint.livemode === true);
  if (matching.length > 1) throw new Error('Multiple matching live webhooks exist. Select the correct endpoint before configuring credentials.');
  let endpoint = matching[0];
  let signingSecret = credentials.webhookSecret;
  if (endpoint) {
    if (typeof signingSecret !== 'string' || !/^whsec_[A-Za-z0-9]{20,}$/.test(signingSecret)) throw new Error('The existing live endpoint signing secret is required; no duplicate endpoint was created.');
    const parameters = new URLSearchParams({ disabled: 'false' });
    for (const event of events) parameters.append('enabled_events[]', event);
    endpoint = await stripe(`/webhook_endpoints/${endpoint.id}`, parameters);
  } else {
    const parameters = new URLSearchParams({ url: webhookUrl, description: '晴屿充值到账通知' });
    for (const event of events) parameters.append('enabled_events[]', event);
    endpoint = await stripe('/webhook_endpoints', parameters, `qingyu-live-webhook-${expectedAccount}-v1`);
    signingSecret = endpoint.secret;
  }
  if (endpoint.livemode !== true || endpoint.url !== webhookUrl || typeof signingSecret !== 'string'
    || !/^whsec_[A-Za-z0-9]{20,}$/.test(signingSecret) || !Array.isArray(endpoint.enabled_events)
    || !events.every(event => endpoint.enabled_events.includes(event))) throw new Error('Stripe returned an invalid live webhook configuration.');
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const child = spawn(process.execPath, [wrangler, 'secret', 'bulk', '--config', 'wrangler.production.jsonc'], {
    cwd: backendRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.resume(); child.stderr.resume();
  child.stdin.end(JSON.stringify({ STRIPE_LIVE_SECRET_KEY: key, STRIPE_LIVE_WEBHOOK_SECRET: signingSecret }));
  const code = await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start Cloudflare secret configuration.')));
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Cloudflare rejected the live secret upload. Retry with the same endpoint signing secret.');
  console.log(JSON.stringify({ ...readiness, configured: true, webhookId: endpoint.id, webhookUrl,
    enabledEvents: events, credentialsStored: 'Cloudflare Worker Secrets only', testCredentialsPreserved: true }));
}

configure().catch(error => { console.error(error.message); process.exitCode = 1; });
