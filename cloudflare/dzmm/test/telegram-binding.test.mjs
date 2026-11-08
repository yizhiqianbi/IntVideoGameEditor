import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { configureTelegram, parseTelegramGroupInput, readPrivateJson, safeBindingFailure, sanitizeTelegramBindingResult,
  TELEGRAM_WEBHOOK_URL, uploadTelegramWorkerSecrets, validateTelegramConfiguration } from '../scripts/configure-telegram.mjs';
import { createTelegramLocalServer, runPrivateTelegramConfiguration } from '../scripts/configure-telegram-local.mjs';

// Ordinary synthetic values only. Every provider/Cloudflare boundary is injected.
const TOKEN = `123456789:${'synthetic_only_'.repeat(3)}`;
const SECRET = 'independent_synthetic_webhook_secret_123456';
const CHAT = '-1001234567890';
const ME = { id: 123456789, is_bot: true, username: 'xumeng_test_bot', can_read_all_group_messages: true };
const GROUP = { id: Number(CHAT), type: 'supergroup', username: 'synthetic_group' };
const MEMBER = { user: { id: ME.id, is_bot: true }, status: 'member' };
const success = () => ({ provider: 'telegram', configured: true, stage: 'complete', credentialsVerified: true,
  groupMembershipVerified: true, plainMentionsVerified: true, webhookVerified: true, webhookUrl: TELEGRAM_WEBHOOK_URL,
  botId: String(ME.id), botUsername: ME.username, allowedChatIds: [CHAT], workerSecretCount: 5, tokenStored: false,
  pendingUpdatesDropped: false, messagesSent: 0, deliveryTested: false, effects: { workerSecrets: 'uploaded', webhook: 'verified' } });

function scenario(overrides = {}) {
  const requests = [], uploads = []; let infoCount = 0;
  const fetchImpl = async (url, options) => {
    const method = url.slice(url.lastIndexOf('/') + 1), body = JSON.parse(options.body);
    requests.push({ url, method, options, body });
    assert.ok(url.startsWith(`https://api.telegram.org/bot${TOKEN}/`));
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    let result;
    if (method === 'getMe') result = overrides.me ?? ME;
    else if (method === 'getChat') result = overrides.chat ?? GROUP;
    else if (method === 'getChatMember') result = overrides.member ?? MEMBER;
    else if (method === 'getWebhookInfo') {
      infoCount++; result = overrides.infos?.[infoCount - 1] ?? (infoCount === 3
        ? { url: TELEGRAM_WEBHOOK_URL, allowed_updates: ['edited_message', 'message'] } : { url: '' });
    } else if (method === 'setWebhook') { if (overrides.setThrows) throw new Error(`Provider leaked ${TOKEN}`); result = overrides.setResult ?? true; }
    else assert.fail(`Unexpected method ${method}`);
    if (overrides.fetchError === method) throw new Error(`Provider leaked ${TOKEN}`);
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
  };
  const uploadSecrets = async (secrets, options) => { uploads.push({ secrets, options }); if (overrides.uploadThrows) throw new Error(`Upload leaked ${TOKEN}`); };
  return { requests, uploads, options: { fetchImpl, uploadSecrets, secretFactory: () => SECRET },
    configure: (input = { token: TOKEN, chat: CHAT }) => configureTelegram(input, { fetchImpl, uploadSecrets, secretFactory: () => SECRET }) };
}
async function failure(run, expectedCode, stage) {
  try { await run(); assert.fail('Expected safe rejection'); }
  catch (error) { const result = safeBindingFailure(error); assert.equal(result.code, expectedCode); if (stage) assert.equal(result.stage, stage);
    assert.equal(result.configured, false); assert.equal(JSON.stringify(result).includes(TOKEN), false); assert.equal(JSON.stringify(result).includes(SECRET), false); return result; }
}

test('group inputs resolve only canonical IDs/usernames and source message links', () => {
  assert.equal(parseTelegramGroupInput(CHAT), CHAT);
  assert.equal(parseTelegramGroupInput('@synthetic_group'), '@synthetic_group');
  assert.equal(parseTelegramGroupInput('https://t.me/synthetic_group/45'), '@synthetic_group');
  assert.equal(parseTelegramGroupInput('t.me/synthetic_group/12/45?single'), '@synthetic_group');
  assert.equal(parseTelegramGroupInput('https://t.me/c/1234567890/45'), CHAT);
  assert.equal(parseTelegramGroupInput('https://t.me/c/1234567890/12/45'), CHAT);
  for (const invalid of ['123', '-01', '-9007199254740992', 'https://evil.test/synthetic_group', 'https://t.me.evil.test/a',
    'https://user:pass@t.me/synthetic_group', 'http://t.me/synthetic_group', 'https://t.me/c/1/0', 'https://t.me/synthetic_group?token=secret']) {
    assert.throws(() => parseTelegramGroupInput(invalid));
  }
  for (const invite of ['https://t.me/+syntheticInvite', 'https://t.me/joinchat/syntheticInvite']) {
    assert.throws(() => parseTelegramGroupInput(invite), error => error.code === 'INVITE_LINK');
  }
});

test('configuration is one group only and never accepts secrets in extra fields', () => {
  assert.deepEqual(validateTelegramConfiguration({ token: TOKEN, chats: [CHAT] }), { token: TOKEN, chats: [CHAT] });
  for (const value of [{ token: TOKEN, chats: [CHAT, '-123'] }, { token: TOKEN, chat: CHAT, url: 'https://evil.test' },
    { token: TOKEN, chat: CHAT, chats: [CHAT] }, { token: 'bad', chat: CHAT }, { token: TOKEN, chat: '' }]) assert.throws(() => validateTelegramConfiguration(value));
});

test('complete setup verifies before mutations, stores five non-Token secrets and preserves pending updates', async () => {
  const s = scenario(); const input = { token: TOKEN, chat: '@synthetic_group' }; const result = await s.configure(input);
  assert.deepEqual(result, success()); assert.equal(input.token, '');
  assert.deepEqual(s.requests.map(item => item.method), ['getMe', 'getChat', 'getChatMember', 'getWebhookInfo', 'getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
  assert.deepEqual(s.requests[2].body, { chat_id: CHAT, user_id: ME.id });
  assert.equal(s.uploads.length, 1);
  assert.deepEqual(s.uploads[0].secrets, { TELEGRAM_FEEDBACK_ENABLED: 'true', TELEGRAM_FEEDBACK_BOT_ID: String(ME.id),
    TELEGRAM_FEEDBACK_BOT_USERNAME: ME.username, TELEGRAM_FEEDBACK_ALLOWED_CHAT_IDS: CHAT, TELEGRAM_FEEDBACK_WEBHOOK_SECRET: SECRET });
  assert.equal(JSON.stringify(s.uploads).includes(TOKEN), false);
  assert.deepEqual(s.requests[5].body, { url: TELEGRAM_WEBHOOK_URL, allowed_updates: ['message', 'edited_message'], drop_pending_updates: false, secret_token: SECRET });
  assert.equal(JSON.stringify(result).includes(TOKEN), false); assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('administrator verifies plain mentions even with privacy enabled', async () => {
  const s = scenario({ me: { ...ME, can_read_all_group_messages: false }, member: { ...MEMBER, status: 'administrator' } });
  assert.equal((await s.configure()).plainMentionsVerified, true);
});

test('privacy-enabled ordinary membership stops before configuration with exact BotFather advice', async () => {
  const s = scenario({ me: { ...ME, can_read_all_group_messages: false } });
  const result = await failure(() => s.configure(), 'PRIVACY_REQUIRED', 'groups');
  assert.match(result.error, /\/setprivacy/); assert.match(result.error, /Disable/); assert.match(result.error, /重新加入/);
  assert.equal(s.uploads.length, 0); assert.equal(s.requests.some(item => item.method === 'setWebhook'), false);
});

test('private/channel targets, identity mismatch and departed bots cannot configure', async () => {
  for (const type of ['private', 'channel']) { const s = scenario({ chat: { ...GROUP, type } }); await failure(() => s.configure(), 'NOT_A_GROUP', 'groups'); assert.equal(s.uploads.length, 0); }
  const mismatch = scenario({ chat: { ...GROUP, id: -10011111 } }); await failure(() => mismatch.configure(), 'GROUP_MISMATCH');
  for (const status of ['left', 'kicked', 'restricted']) { const s = scenario({ member: { ...MEMBER, status, is_member: false } }); await failure(() => s.configure(), 'BOT_NOT_MEMBER'); assert.equal(s.uploads.length, 0); }
  const wrongBot = scenario({ member: { ...MEMBER, user: { id: 999, is_bot: true } } }); await failure(() => wrongBot.configure(), 'BOT_NOT_MEMBER');
});

test('existing other-project webhook is never overridden or deleted', async () => {
  const s = scenario({ infos: [{ url: 'https://other-project.example/webhook' }] });
  const result = await failure(() => s.configure(), 'WEBHOOK_CONFLICT', 'webhook-preflight');
  assert.deepEqual(result.effects, { workerSecrets: 'not-attempted', webhook: 'not-attempted' }); assert.equal(s.uploads.length, 0);
  assert.equal(s.requests.some(item => !['getMe', 'getChat', 'getChatMember', 'getWebhookInfo'].includes(item.method)), false);
});

test('existing own webhook is allowed, but ownership change during secret upload stops safely', async () => {
  const own = scenario({ infos: [{ url: TELEGRAM_WEBHOOK_URL }, { url: TELEGRAM_WEBHOOK_URL }] }); assert.equal((await own.configure()).configured, true);
  const race = scenario({ infos: [{ url: '' }, { url: 'https://other-project.example/new' }] });
  const result = await failure(() => race.configure(), 'WEBHOOK_CONFLICT', 'webhook-recheck');
  assert.deepEqual(result.effects, { workerSecrets: 'uploaded', webhook: 'not-attempted' });
  assert.equal(race.requests.some(item => item.method === 'setWebhook'), false);
});

test('partial Worker failure reports unknown upload and never attempts setWebhook', async () => {
  const s = scenario({ uploadThrows: true }); const result = await failure(() => s.configure(), 'SECRET_UPLOAD_FAILED', 'worker-secrets');
  assert.deepEqual(result.effects, { workerSecrets: 'unknown', webhook: 'not-attempted' }); assert.equal(s.requests.some(item => item.method === 'setWebhook'), false);
});

test('lost setWebhook response and final verification mismatch report exact partial stages', async () => {
  const lost = scenario({ setThrows: true }); const a = await failure(() => lost.configure(), 'WEBHOOK_SET_FAILED', 'webhook-set');
  assert.deepEqual(a.effects, { workerSecrets: 'uploaded', webhook: 'unknown' });
  const changed = scenario({ infos: [{ url: '' }, { url: '' }, { url: TELEGRAM_WEBHOOK_URL, allowed_updates: ['message'] }] });
  const b = await failure(() => changed.configure(), 'WEBHOOK_VERIFY_FAILED', 'webhook-verify');
  assert.deepEqual(b.effects, { workerSecrets: 'uploaded', webhook: 'set' });
  assert.equal(changed.requests.filter(item => item.method === 'setWebhook').length, 1);
});

test('provider error text, bad JSON and oversized responses never escape the safe metadata boundary', async () => {
  for (const body of [`broken ${TOKEN}`, JSON.stringify({ ok: false, description: TOKEN }), 'x'.repeat(65_537)]) {
    const error = await failure(() => configureTelegram({ token: TOKEN, chat: CHAT }, { fetchImpl: async () => new Response(body), uploadSecrets: () => assert.fail('Must not upload') }), 'TELEGRAM_REQUEST_FAILED', 'bot');
    assert.equal(error.error.includes('synthetic'), false);
  }
});

test('bounded private stdin rejects malformed/oversized UTF-8 without echoing input', async () => {
  assert.deepEqual(await readPrivateJson(Readable.from([Buffer.from(JSON.stringify({ token: TOKEN, chat: CHAT }))])), { token: TOKEN, chat: CHAT });
  for (const bytes of [Buffer.from(`invalid ${TOKEN}`), Buffer.from([0xff]), Buffer.alloc(16_385, 97)]) await assert.rejects(readPrivateJson(Readable.from([bytes])), error => error.code === 'INVALID_INPUT' && !error.message.includes(TOKEN));
});

function fakeChild(output, code = 0, capture = {}) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { capture.killed = true; }; let input = '';
  child.stdin.on('data', chunk => { input += chunk.toString(); });
  child.stdin.on('finish', () => { capture.input = input; queueMicrotask(() => { child.stderr.end(`never relay ${TOKEN}`); if (output) child.stdout.end(output); child.emit('close', code); }); });
  return child;
}

test('Cloudflare spawn uses fixed argv and private JSON stdin without token or raw output', async () => {
  const capture = {}; const secrets = { TELEGRAM_FEEDBACK_ENABLED: 'true', TELEGRAM_FEEDBACK_WEBHOOK_SECRET: SECRET };
  await uploadTelegramWorkerSecrets(secrets, { spawnImpl: (file, args, options) => { capture.file = file; capture.args = args; capture.options = options; return fakeChild('', 0, capture); } });
  assert.deepEqual(JSON.parse(capture.input), secrets); assert.ok(capture.args.includes('wrangler.production.jsonc'));
  assert.equal(JSON.stringify(capture.args).includes(SECRET), false); assert.equal(JSON.stringify(capture.args).includes(TOKEN), false);
  assert.deepEqual(capture.options.stdio, ['pipe', 'pipe', 'pipe']); assert.equal(capture.options.shell, undefined);
  assert.equal(capture.options.env.WRANGLER_WRITE_LOGS, 'false'); assert.equal(capture.options.env.WRANGLER_SEND_METRICS, 'false');
});

test('local child gets token only through private stdin and sanitizes both success and partial errors', async () => {
  const capture = {}; const output = { ...success(), rawToken: TOKEN, rawSecret: SECRET };
  const result = await runPrivateTelegramConfiguration({ token: TOKEN, chats: [CHAT] }, { spawnImpl: (file, args, options) => {
    capture.args = args; capture.options = options; return fakeChild(JSON.stringify(output), 0, capture); } });
  assert.deepEqual(JSON.parse(capture.input), { token: TOKEN, chats: [CHAT] }); assert.equal(JSON.stringify(capture.args).includes(TOKEN), false);
  assert.deepEqual(result, success()); assert.equal(JSON.stringify(result).includes(TOKEN), false);
  const partial = { ...safeBindingFailure(Object.assign(new Error(), { dummy: TOKEN })), rawToken: TOKEN };
  assert.equal((await runPrivateTelegramConfiguration({ token: TOKEN, chats: [CHAT] }, { spawnImpl: () => fakeChild(JSON.stringify(partial), 1) })).configured, false);
  await assert.rejects(runPrivateTelegramConfiguration({ token: TOKEN, chats: [CHAT] }, { spawnImpl: () => fakeChild(TOKEN, 1) }), error => !error.message.includes(TOKEN));
  assert.throws(() => sanitizeTelegramBindingResult({ ...success(), pendingUpdatesDropped: true }));
});

async function localForm(local) {
  const response = await fetch(local.readyUrl); const html = await response.text();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script); new Script(script);
  const nonce = script.match(/nonce:"([a-f0-9]{64})"/)?.[1]; assert.ok(nonce);
  return { response, html, nonce, origin: new URL(local.readyUrl).origin };
}
const post = (local, form, overrides = {}, headers = {}) => fetch(local.readyUrl, { method: 'POST', headers: { Origin: form.origin, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ token: TOKEN, chat: CHAT, nonce: form.nonce, ...overrides }) });

test('native localhost UI masks token and enforces CSP/no-store/random path and strict Host/Origin/nonce', async () => {
  let calls = 0; const local = await createTelegramLocalServer({ runner: async () => { calls++; return success(); } });
  try {
    const form = await localForm(local); assert.match(form.html, /id="token" type="password"/); assert.equal(form.html.includes(TOKEN), false);
    assert.match(form.response.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(form.response.headers.get('cache-control'), 'no-store');
    assert.match(new URL(local.readyUrl).pathname, /^\/bind\/[a-f0-9]{64}$/);
    const wrongHost = await new Promise((resolveResult, reject) => {
      const request = httpRequest(local.readyUrl, { headers: { Host: 'attacker.example' } }, response => {
        response.resume(); response.on('end', () => resolveResult(response.statusCode)); });
      request.on('error', reject); request.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await post(local, form, {}, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await fetch(local.readyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await post(local, form, { nonce: '0'.repeat(64) })).status, 403);
    assert.equal((await post(local, form, { token: 'bad' })).status, 400);
    assert.equal((await post(local, form, { chat: 'x'.repeat(17_000) })).status, 413);
    assert.equal((await fetch(`${form.origin}/bind/not-the-page`)).status, 404);
    assert.equal(calls, 0);
    const response = await post(local, form); assert.equal(response.status, 200); assert.deepEqual(await response.json(), success()); assert.equal(calls, 1);
    assert.equal((await post(local, form)).status, 409); assert.equal(calls, 1);
    const status = await (await fetch(local.statusUrl)).json(); assert.equal(status.configured, true); assert.equal(status.consumed, true); assert.equal(JSON.stringify(status).includes(TOKEN), false);
  } finally { await local.close(); }
});

test('duplicate Host/Origin headers are rejected by native server before runner', async () => {
  let calls = 0; const local = await createTelegramLocalServer({ runner: async () => { calls++; return success(); } });
  try {
    const form = await localForm(local), url = new URL(local.readyUrl);
    const response = await new Promise((resolveResult, reject) => {
      const req = httpRequest(url, { method: 'POST', headers: ['Host', url.host, 'Host', url.host, 'Origin', form.origin, 'Origin', form.origin, 'Content-Type', 'application/json'] }, res => {
        res.resume(); res.on('end', () => resolveResult(res.statusCode)); }); req.on('error', reject); req.end('{}');
    });
    assert.equal(response, 403); assert.equal(calls, 0);
  } finally { await local.close(); }
});

test('simultaneous valid submissions run once and partial result remains explicit without retry', async () => {
  let release; const gate = new Promise(resolveGate => { release = resolveGate; }); let calls = 0;
  const partial = { ...safeBindingFailure(Object.assign(new Error(), {})), effects: { workerSecrets: 'unknown', webhook: 'unknown' } };
  const local = await createTelegramLocalServer({ runner: async () => { calls++; await gate; return partial; } });
  try {
    const form = await localForm(local), first = post(local, form);
    while (!calls) await new Promise(resolveWait => setTimeout(resolveWait, 5));
    const second = await post(local, form); assert.equal(second.status, 409); release();
    const response = await first; assert.equal(response.status, 502); assert.equal((await response.json()).configured, false);
    assert.equal(calls, 1); assert.equal((await post(local, form)).status, 409);
    const status = await (await fetch(local.statusUrl)).json(); assert.equal(status.effects.workerSecrets, 'unknown'); assert.equal(status.effects.webhook, 'unknown');
  } finally { release(); await local.close(); }
});

test('local page expiration cannot start configuration and reports expiry', async () => {
  let calls = 0; const local = await createTelegramLocalServer({ lifetimeMs: 30, runner: async () => { calls++; return success(); } });
  try { const form = await localForm(local); await new Promise(resolveWait => setTimeout(resolveWait, 40));
    const response = await post(local, form); assert.equal(response.status, 410); assert.match((await response.json()).error, /过期/); assert.equal(calls, 0);
    assert.equal((await (await fetch(local.statusUrl)).json()).expired, true);
  } finally { await local.close(); }
});

test('abort during secret upload reports unknown partial stage without webhook mutation', async () => {
  const s = scenario(), controller = new AbortController();
  const result = await failure(() => configureTelegram({ token: TOKEN, chat: CHAT }, { ...s.options, signal: controller.signal,
    uploadSecrets: async () => { controller.abort(); throw new Error(TOKEN); } }), 'INTERRUPTED', 'worker-secrets');
  assert.deepEqual(result.effects, { workerSecrets: 'unknown', webhook: 'not-attempted' });
  assert.equal(s.requests.some(item => item.method === 'setWebhook'), false);
});

test('raw local runner failures report unknown effects and emit only safe terminal metadata', async () => {
  const reported = []; const local = await createTelegramLocalServer({ runner: async () => { throw new Error(`unsafe ${TOKEN}`); }, onResult: value => reported.push(value) });
  try {
    const form = await localForm(local), response = await post(local, form), result = await response.json();
    assert.equal(response.status, 502); assert.equal(result.configured, false); assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.deepEqual(result.effects, { workerSecrets: 'unknown', webhook: 'unknown' }); assert.deepEqual(reported, [result]);
    assert.equal((await post(local, form)).status, 409);
  } finally { await local.close(); }
});

test('local expiry aborts a running private operation and cannot report false success', async () => {
  const local = await createTelegramLocalServer({ lifetimeMs: 80, runner: async (_credentials, { signal }) => {
    await new Promise((resolveAbort, reject) => { if (signal.aborted) reject(new Error(TOKEN));
      else signal.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true }); });
    return success();
  } });
  try {
    const form = await localForm(local), response = await post(local, form), result = await response.json();
    assert.equal(response.status, 502); assert.equal(result.configured, false); assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.deepEqual(result.effects, { workerSecrets: 'unknown', webhook: 'unknown' });
    assert.equal((await (await fetch(local.statusUrl)).json()).expired, true);
  } finally { await local.close(); }
});
