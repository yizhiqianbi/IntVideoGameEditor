import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

// Exercise the complete web chat gateway with its real prompt/world protocol,
// real authenticated backend session, and disposable D1 billing facts. Only
// the upstream model transport and Cloudflare rate limiter are substituted.
const { fetchRequest: webFetch } = await tsImport('../../dzmm-web/src/worker.ts', import.meta.url);
const { fetchRequest: backendFetch } = await tsImport('../src/app.ts', import.meta.url);
const { requireUser } = await tsImport('../src/auth.ts', import.meta.url);
const { ApiError } = await tsImport('../src/http.ts', import.meta.url);
const { quoteCreditUsage, reserveCreditUsage, finalizeCreditUsage, getPendingCreditUsage, releaseExpiredCreditUsage,
  creditUsageBalanceStatement, CREDIT_RESERVATION_TTL_MS } = await tsImport('../src/credit-usage.ts', import.meta.url);
const { reconcileBillingGeneration } = await tsImport('../../dzmm-web/src/billing-maintenance.ts', import.meta.url);
const { validateDzmmChatInput, buildDzmmPromptPlan } = await tsImport('../../../src/lib/dzmm-chat.ts', import.meta.url);
const { readDzmmWorldResponse } = await tsImport('../../../src/lib/dzmm-world-stream.ts', import.meta.url);
const { chargeDzmmProviderCostUsd, reserveDzmmCreditCost } = await tsImport('../../../src/lib/dzmm-credit-pricing.ts', import.meta.url);

const origin = 'https://low-credit.example.test';
const now = Date.now();
const rates = { revision: 1, inputCreditsPer1000: 4.022753, outputCreditsPer1000: 12.068258 };
const policy = { version: 1, multiplier: 3, usdToCny: 6.704588, creditsPerCny: 100,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 };
const input = { character: { name: '原创图书管理员', description: '林舟管理港城书库，帮助来访者查找地图。',
  personality: '细心，依据书中记录回答问题。', scenario: '白天，港城书库的阅览室。' },
  messages: [{ role: 'user', content: '先介绍当前场景，并告诉我有哪些可以采取的行动。请帮我寻找旧灯塔的地图。' }],
  world: { clockMode: 'story' } };
const prose = '管理员把地图平放在阅览室的桌上。林舟指着旧灯塔的标记说：“可以先核对年代，也可以翻阅旁边的航海日志。”';
const patch = { version: 1, changes: [{ type: 'location', from: 'assistant',
  quote: '管理员把地图平放在阅览室的桌上', value: '港城阅览室' }] };
let store, database;

before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated low Credit test")}}', d1Databases: { DB: 'low-credit-chat-isolated' } }));
  database = await store.getD1Database('DB');
  const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  for (const file of migrations) {
    const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await database.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => database.prepare(sql)));
  }
});
after(async () => { await store?.dispose(); });

async function snapshot(userId) {
  const balance = await creditUsageBalanceStatement({ DB: database }, userId).first();
  const facts = await database.prepare(`SELECT
    (SELECT COUNT(*) FROM credit_usage_requests WHERE user_id=?) AS requests,
    (SELECT COUNT(*) FROM credit_usage_ledger WHERE user_id=?) AS entries,
    (SELECT COUNT(*) FROM payment_credit_ledger WHERE user_id=?) AS grants`).bind(userId, userId, userId).first();
  return { balance, facts };
}
async function fixture() {
  const id = randomUUID(), token = randomBytes(32).toString('hex');
  const order = `pay_${randomUUID()}`, event = `evt_${randomUUID()}`;
  await database.batch([
    database.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)')
      .bind(id, `${randomUUID()}@low-credit.example.test`, '原创测试账户', now),
    database.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(token).digest('hex'), id, now + 86400000, now),
    database.prepare(`INSERT INTO payment_orders(id,user_id,request_id,package_id,amount_minor,credits,mode,status,created_at,updated_at,paid_at)
      VALUES(?,?,?,'usd_1',100,100,'live','paid',?,?,?)`).bind(order, id, randomUUID(), now, now, now),
    database.prepare("INSERT INTO payment_events VALUES(?,'checkout.session.completed',?,'isolated',?)").bind(event, order, now),
    database.prepare("INSERT INTO payment_credit_ledger(order_id,user_id,source_event_id,kind,credits,created_at) VALUES(?,?,?,'purchase',100,?)")
      .bind(order, id, event, now),
  ]);
  const backend = { DB: database, APP_ORIGINS: origin, CREDIT_BILLING_ENABLED: 'true', CREDIT_BILLING_RATES_JSON: JSON.stringify(rates),
    CREDIT_BILLING_COST_POLICY_JSON: JSON.stringify(policy) };
  const quotes = [], reserves = [], finalizations = [], receipts = [], quoteFacts = [];
  async function authenticatedPreflight(dto) {
    const request = new Request('https://billing.internal/isolated', { headers: { Cookie: `qingyu_session=${dto.sessionToken}` } });
    const user = await requireUser(request, backend);
    if (user.id !== dto.accountId) throw new ApiError(401, '账户已切换，请重新登录。');
    const { sessionToken: _token, accountId: _account, ...preflight } = dto;
    return { request, user, preflight };
  }
  async function guarded(action) {
    try { return await action(); }
    catch (error) {
      // Separate tsImport entrypoints may instantiate ApiError independently;
      // preserve its RPC facts rather than rely on loader object identity.
      if (error?.name !== 'ApiError' || ![400, 401, 402, 403, 409, 503].includes(error.status)) throw error;
      return { error: { status: error.status, message: error.message, ...(error.details?.code ? { code: error.details.code } : {}) } };
    }
  }
  const billing = {
    async quote(dto) {
      quotes.push(dto);
      return guarded(async () => {
        const { request, user, preflight } = await authenticatedPreflight(dto);
        const before = await snapshot(id);
        try { return await quoteCreditUsage(request, backend, user, preflight); }
        finally { const after = await snapshot(id); assert.deepEqual(after, before); quoteFacts.push({ before, after }); }
      });
    },
    async reserve(dto) {
      reserves.push(dto);
      return guarded(async () => {
        const { request, user, preflight } = await authenticatedPreflight(dto);
        const result = await reserveCreditUsage(request, backend, user, preflight);
        receipts.push(result.receipt); return { enabled: true, ...result };
      });
    },
    async finalize(dto) {
      finalizations.push(dto);
      return guarded(async () => ({ receipt: await finalizeCreditUsage(backend, dto) }));
    },
  };
  const env = { ASSETS: { fetch: async () => new Response('SPA') }, BACKEND: { fetch: request => backendFetch(request, backend) },
    BILLING: billing, CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }, DZMM_API_KEY: 'isolated-model-fixture',
    DZMM_BASE_URL: 'https://openrouter.ai/api/v1', DZMM_MODEL: 'provider/original-story-model',
    DZMM_PROVIDER_MAX_INPUT_USD_PER_MILLION: '4.4', DZMM_PROVIDER_MAX_OUTPUT_USD_PER_MILLION: '13.2' };
  return { id, token, env, backend, quotes, reserves, finalizations, receipts, quoteFacts };
}
function chatRequest(f, body = input) {
  return new Request(`${origin}/api/chat`, { method: 'POST', body: JSON.stringify(body), headers: {
    Origin: origin, 'Content-Type': 'application/json', Cookie: `qingyu_session=${f.token}`, 'X-Xumeng-Request-Id': randomUUID(),
  } });
}
function completion(content = prose + `<qingyu-state>${JSON.stringify(patch)}</qingyu-state>`) {
  const chunks = [content.slice(0, 23), content.slice(23, 65), content.slice(65)];
  return new Response(chunks.map(content => `data: ${JSON.stringify({ id: 'gen-low-credit-isolated', choices: [{ delta: { content } }] })}\n\n`).join('')
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 160, completion_tokens: 35,
      completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.00053 } })}\n\n` + 'data: [DONE]\n\n',
  { headers: { 'Content-Type': 'text/event-stream' } });
}

test('the real world-enabled chat can use 100 Credit, preserves the full prompt, and settles trusted cost at 2 Credit', async t => {
  const f = await fixture(), originalInput = JSON.stringify(input), waits = [];
  let providers = 0, metadata = 0, actualBody;
  const expected = buildDzmmPromptPlan(validateDzmmChatInput(input), now);
  const response = await webFetch(chatRequest(f), f.env, { now: () => now, waitUntil: promise => waits.push(promise),
    providerFetch: async (_url, options) => {
      providers++; actualBody = String(options.body); const body = JSON.parse(actualBody);
      assert.deepEqual(body.messages, expected.messages, 'budget limiting must retain every original/system/world prompt segment');
      assert.ok(body.messages.some(message => message.role === 'user' && message.content === input.messages[0].content));
      assert.ok(body.messages.some(message => message.role === 'system' && message.content.includes('<qingyu-state>')));
      assert.equal(body.max_tokens, f.reserves[0].maxOutputTokens);
      assert.equal(createHash('sha256').update(actualBody).digest('hex'), f.reserves[0].requestFingerprint);
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.deepEqual(body.provider.max_price, { prompt: 4.4, completion: 13.2 });
      const stored = await database.prepare('SELECT max_output_tokens,request_fingerprint,reserved_credits FROM credit_usage_requests WHERE id=?')
        .bind(f.receipts[0].id).first();
      assert.equal(stored.max_output_tokens, body.max_tokens); assert.equal(stored.request_fingerprint, f.reserves[0].requestFingerprint);
      assert.ok(stored.reserved_credits <= 100);
      assert.equal((await snapshot(f.id)).balance.reserved_credits, stored.reserved_credits);
      return completion();
    }, billingMetadataFetch: async () => { metadata++; throw new Error('trusted stream USD cost must settle without metadata recovery'); } });
  assert.equal(response.status, 200);
  const raw = await response.text();
  const received = await readDzmmWorldResponse(new Response(raw, { headers: response.headers }), () => {});
  await Promise.all(waits);
  assert.equal(received.answer, prose); assert.equal(received.world.updated, true); assert.equal(received.world.state.location, '港城阅览室');
  assert.ok(!received.answer.includes('<qingyu-state>') && !received.answer.includes('changes') && !received.answer.includes('"version"'));
  assert.ok(!raw.includes('<qingyu-state>') && !raw.includes('gen-low-credit-isolated') && !raw.includes(f.token));
  assert.equal(providers, 1); assert.equal(metadata, 0); assert.equal(f.quoteFacts.length, 1);
  assert.equal(f.quotes[0].maxOutputTokens, 2048); assert.ok(f.reserves[0].maxOutputTokens >= 128 && f.reserves[0].maxOutputTokens < 2048);
  assert.equal(f.reserves[0].inputTokenUpperBound, f.quotes[0].inputTokenUpperBound);
  assert.ok(reserveDzmmCreditCost(f.quotes[0].inputTokenUpperBound, 2048, policy) > 100);
  assert.notEqual(f.quotes[0].requestFingerprint, f.reserves[0].requestFingerprint);
  assert.equal(JSON.stringify(input), originalInput); assert.equal(chargeDzmmProviderCostUsd(0.00053, policy), 2);
  assert.deepEqual(f.finalizations[0].usage, { promptTokens: 160, completionTokens: 35, providerCostUsd: 0.00053 });
  const facts = await snapshot(f.id); assert.equal(facts.balance.balance, 98); assert.equal(facts.balance.total_spent, 2);
  assert.equal(facts.balance.reserved_credits, 0); assert.deepEqual(facts.facts, { requests: 1, entries: 1, grants: 1 });
  const stored = await database.prepare('SELECT status,charged_credits,provider_cost_usd,cost_policy_json FROM credit_usage_requests WHERE id=?').bind(f.receipts[0].id).first();
  assert.equal(stored.status, 'settled'); assert.equal(stored.charged_credits, 2); assert.equal(stored.provider_cost_usd, 0.00053);
  assert.deepEqual(JSON.parse(stored.cost_policy_json), policy);
  t.diagnostic(JSON.stringify({ isolatedMockProvider: true, inputTokenUpperBound: f.quotes[0].inputTokenUpperBound,
    requestedMaxOutputTokens: 2048, requestedReserveCredits: reserveDzmmCreditCost(f.quotes[0].inputTokenUpperBound, 2048, policy),
    actualProviderMaxOutputTokens: f.reserves[0].maxOutputTokens, reservedCredits: f.receipts[0].reservedCredits,
    mockCostUsd: 0.00053, chargedCredits: stored.charged_credits, walletBalance: facts.balance.balance, holds: facts.balance.reserved_credits }));
});

test('a failed model completion with no visible prose releases the real D1 reservation despite reported cost', async () => {
  const f = await fixture(), waits = []; let providers = 0;
  const response = await webFetch(chatRequest(f), f.env, { now: () => now, waitUntil: promise => waits.push(promise),
    providerFetch: async () => { providers++; return completion('  \n '); } });
  assert.equal(response.status, 502); await response.text(); await Promise.all(waits);
  assert.equal(providers, 1); assert.equal(f.reserves.length, 1); assert.equal(f.finalizations[0].hasValidOutput, false);
  assert.equal(f.finalizations[0].usage.providerCostUsd, 0.00053);
  const facts = await snapshot(f.id); assert.equal(facts.balance.balance, 100); assert.equal(facts.balance.reserved_credits, 0); assert.equal(facts.balance.total_spent, 0);
  const stored = await database.prepare('SELECT status,charged_credits,release_reason FROM credit_usage_requests WHERE id=?').bind(f.receipts[0].id).first();
  assert.deepEqual(stored, { status: 'released', charged_credits: 0, release_reason: 'no_valid_output' });
});

test('a context whose minimum reply exceeds 100 Credit returns 402 before any hold or model traffic', async () => {
  const f = await fixture(); let providers = 0;
  const longInput = { ...input, messages: [{ role: 'user', content: '请逐条核对港城档案中记录的旧灯塔年代。'.repeat(180) }] };
  const response = await webFetch(chatRequest(f, longInput), f.env, { now: () => now,
    providerFetch: async () => { providers++; throw new Error('an unaffordable context cannot start a model'); } });
  assert.equal(response.status, 402); const error = await response.json(); assert.equal(error.code, 'CREDIT_INSUFFICIENT');
  assert.ok(error.error.includes('当前可用 100 Credit') && error.error.includes('至少需要') && error.error.includes('缩短上下文'));
  assert.equal(providers, 0); assert.equal(f.quotes.length, 1); assert.equal(f.quoteFacts.length, 1);
  assert.equal(f.reserves.length, 0); assert.equal(f.finalizations.length, 0);
  const facts = await snapshot(f.id); assert.equal(facts.balance.balance, 100); assert.equal(facts.balance.reserved_credits, 0);
  assert.deepEqual(facts.facts, { requests: 0, entries: 0, grants: 1 });
});

// Values observed by a separate authorized read-only lookup; this test only
// returns a synthetic response and never contacts that real generation.
const requestedRecoveryModel = 'x-ai/grok-4.6';
const canonicalRecoveryModel = 'x-ai/grok-4.6-20260810';
const recoveryGenerationId = 'gen-1791381045-U6fOqdCEyg3KnjpiYUvi';
function recoveryMetadata(extra = {}) {
  return Response.json({ data: { id: recoveryGenerationId, model: canonicalRecoveryModel,
    native_tokens_prompt: 2247, native_tokens_completion: 964, native_tokens_reasoning: 768,
    tokens_completion: 303, total_cost: 0.010278, ...extra } });
}
async function pendingRecoveryFixture() {
  const f = await fixture();
  const requested = { sessionToken: f.token, accountId: f.id, requestId: randomUUID(), operation: 'chat', model: requestedRecoveryModel,
    inputTokenUpperBound: 10051, maxOutputTokens: 2048, requestFingerprint: createHash('sha256').update('isolated recovery request').digest('hex') };
  const quoted = await f.env.BILLING.quote(requested); assert.equal(quoted.requiredCredits, 100);
  const held = await f.env.BILLING.reserve({ ...requested, maxOutputTokens: quoted.maxOutputTokens,
    requestFingerprint: createHash('sha256').update('isolated budgeted recovery request').digest('hex') });
  assert.equal(held.receipt.reservedCredits, 100);
  const completion = { reservationId: held.receipt.id, accountId: f.id, claimToken: held.claimToken,
    outcome: 'completed', hasValidOutput: true, generationId: recoveryGenerationId };
  const result = await f.env.BILLING.finalize(completion); assert.equal(result.receipt.status, 'pending');
  assert.equal(result.receipt.chargedCredits, 0); assert.equal((await snapshot(f.id)).balance.balance, 0);
  const queued = await getPendingCreditUsage(f.backend, 50);
  const pending = queued.find(item => item.reservationId === held.receipt.id);
  assert.ok(pending); assert.equal(pending.model, requestedRecoveryModel); assert.equal(pending.generationId, recoveryGenerationId);
  assert.notEqual(pending.claimToken, held.claimToken); assert.deepEqual(pending.costPolicy, policy);
  return { f, held, pending };
}

test('verified canonical metadata settles a real D1 pending hold using actual USD cost once, including native reasoning', async t => {
  const { f, held, pending } = await pendingRecoveryFixture(); let lookups = 0;
  const metadataFetch = async (url, init) => {
    lookups++; const target = new URL(String(url));
    assert.equal(target.origin, 'https://openrouter.ai'); assert.equal(target.pathname, '/api/v1/generation');
    assert.deepEqual([...target.searchParams], [['id', recoveryGenerationId]]); assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error'); return recoveryMetadata();
  };
  const finalizedBefore = f.finalizations.length;
  assert.equal(await reconcileBillingGeneration(f.env, pending, { metadataFetch }), 'reconciled');
  assert.equal(f.finalizations.length, finalizedBefore + 1);
  assert.deepEqual(f.finalizations.at(-1).usage, { promptTokens: 2247, completionTokens: 964, providerCostUsd: 0.010278 });
  assert.equal(chargeDzmmProviderCostUsd(0.010278, policy), 21);
  const settled = await database.prepare('SELECT status,charged_credits,prompt_tokens,completion_tokens,provider_cost_usd FROM credit_usage_requests WHERE id=?')
    .bind(held.receipt.id).first();
  assert.deepEqual(settled, { status: 'settled', charged_credits: 21, prompt_tokens: 2247, completion_tokens: 964, provider_cost_usd: 0.010278 });
  const first = await snapshot(f.id); assert.equal(first.balance.balance, 79); assert.equal(first.balance.reserved_credits, 0);
  assert.equal(first.balance.total_spent, 21); assert.equal(first.facts.entries, 1);
  assert.equal(await reconcileBillingGeneration(f.env, pending, { metadataFetch }), 'reconciled');
  assert.equal(lookups, 2); assert.deepEqual(await snapshot(f.id), first, 'a duplicate verified lookup must not debit or add a ledger entry twice');
  assert.ok(!(await getPendingCreditUsage(f.backend, 50)).some(item => item.reservationId === held.receipt.id));
  t.diagnostic(JSON.stringify({ isolatedMetadataMock: true, requestedModel: pending.model, resolvedModel: canonicalRecoveryModel,
    reservedCredits: 100, nativePromptTokens: 2247, nativeCompletionTokens: 964, nativeReasoningTokens: 768,
    normalizedCompletionTokens: 303, actualUsdCost: 0.010278, chargedCredits: 21, walletBalance: 79, holds: 0, duplicateLedgerEntries: 0 }));
});

test('wrong generation ID, unknown dated aliases and wrong model families never finalize a real pending hold', async () => {
  const { f, held, pending } = await pendingRecoveryFixture();
  const first = await snapshot(f.id), finalizationsBefore = f.finalizations.length;
  for (const extra of [{ id: 'gen-unrelated-owned-elsewhere' }, { model: 'x-ai/grok-4.6-20260811' },
    { model: 'x-ai/grok-4.5-20260810' }, { model: 'other/grok-4.6-20260810' }]) {
    assert.equal(await reconcileBillingGeneration(f.env, pending, { metadataFetch: async () => recoveryMetadata(extra) }), 'unverified');
    assert.equal(f.finalizations.length, finalizationsBefore); assert.deepEqual(await snapshot(f.id), first);
  }
  const stored = await database.prepare('SELECT status,charged_credits,provider_cost_usd FROM credit_usage_requests WHERE id=?').bind(held.receipt.id).first();
  assert.deepEqual(stored, { status: 'pending', charged_credits: 0, provider_cost_usd: null });
});

test('a released expired hold cannot be charged retroactively by a later verified canonical lookup', async () => {
  const { f, held, pending } = await pendingRecoveryFixture();
  const expiredCreatedAt = Date.now() - CREDIT_RESERVATION_TTL_MS - 2000;
  await database.prepare('UPDATE credit_usage_requests SET created_at=?,expires_at=? WHERE id=?')
    .bind(expiredCreatedAt, expiredCreatedAt + CREDIT_RESERVATION_TTL_MS, held.receipt.id).run();
  assert.equal(await releaseExpiredCreditUsage(f.backend, f.id), 1);
  const released = await snapshot(f.id); assert.equal(released.balance.balance, 100); assert.equal(released.balance.reserved_credits, 0);
  assert.equal(released.balance.total_spent, 0); assert.equal(released.facts.entries, 1);
  let lookups = 0;
  assert.equal(await reconcileBillingGeneration(f.env, pending, { metadataFetch: async () => { lookups++; return recoveryMetadata(); } }), 'unavailable');
  assert.equal(lookups, 1); assert.deepEqual(await snapshot(f.id), released);
  const stored = await database.prepare('SELECT status,charged_credits,release_reason,provider_cost_usd FROM credit_usage_requests WHERE id=?')
    .bind(held.receipt.id).first();
  assert.deepEqual(stored, { status: 'released', charged_credits: 0, release_reason: 'usage_timeout', provider_cost_usd: null });
});
