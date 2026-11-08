// Private stdin/stdout bridge for scoped integration verification. Never run
// with inherited stdout: provider data may include a usable Checkout URL.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk.toString();
  if (input.length > 32768) throw new Error('Input exceeds the expected size.');
}
try {
  const { secretKey, path, parameters, idempotencyKey } = JSON.parse(input);
  if (typeof secretKey !== 'string' || !/^sk_test_[A-Za-z0-9]{20,}$/.test(secretKey)) throw new Error();
  if (typeof path !== 'string' || !/^\/(?:account|checkout\/sessions(?:\/[A-Za-z0-9_]+(?:\/expire)?)?|events(?:\/[A-Za-z0-9_]+)?|refunds(?:\/[A-Za-z0-9_]+)?|webhook_endpoints(?:\/[A-Za-z0-9_]+)?)(?:\?[^#]*)?$/.test(path)) throw new Error();
  async function stripe(apiPath, body, key) {
    const response = await fetch(`https://api.stripe.com/v1${apiPath}`, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? new URLSearchParams(body).toString() : undefined });
    return { ok: response.ok, status: response.status, data: await response.json() };
  }
  const account = await stripe('/account');
  if (!account.ok || account.data.id !== 'acct_1ULLC6Gopt0xfgLI') throw new Error();
  console.log(JSON.stringify(await stripe(path, parameters, idempotencyKey)));
} catch {
  console.error('Scoped Stripe test request failed; credentials were not printed.');
  process.exitCode = 1;
}
