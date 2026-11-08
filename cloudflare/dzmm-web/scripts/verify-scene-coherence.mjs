import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

// LIVE verifier: deploy first, then explicitly run with --execute.
// At most two model calls (one with --montage-only), without retry, summary,
// payment or media requests.
// Fiction is original, adult and nonsexual. Only this invocation's freshly created
// guest is written/deleted; credentials remain in memory. Human review is required
// for semantic quality, even when all transport/persistence/clock assertions pass.
assert.ok(process.argv.includes('--execute'), 'Live execution requires the explicit --execute flag.');
const montageOnly = process.argv.includes('--montage-only');
const base = new URL(process.argv.find(arg => /^https?:\/\//.test(arg)) || 'https://xumengchat.top').origin;
assert.equal(base, 'https://xumengchat.top');
const { DZMM_PROMPT_VERSION } = await tsImport('../../../src/lib/dzmm-chat.ts', import.meta.url);
const { prepareDzmmRequest } = await tsImport('../../../src/lib/dzmm-context.ts', import.meta.url);
const { parseCharacterImport } = await tsImport('../../../src/lib/dzmm-characters.ts', import.meta.url);
const { appendDzmmWorldSnapshot, parseDzmmWorldState, readDzmmExplicitTimeJump, applyDzmmExplicitTimeJump }
  = await tsImport('../../../src/lib/dzmm-world-state.ts', import.meta.url);
const { readDzmmWorldResponse } = await tsImport('../../../src/lib/dzmm-world-stream.ts', import.meta.url);

const startedAt = new Date().toISOString();
const reportUrl = new URL(`../../../output/xumeng/scene-coherence-live-${startedAt.replace(/[:.]/g, '-')}.json`, import.meta.url);
const report = { testedAt: startedAt, baseUrl: base, expectedPromptVersion: DZMM_PROMPT_VERSION,
  mode: montageOnly ? 'montage-only' : 'montage-and-comfort',
  modelCalls: 0, maxModelCalls: montageOnly ? 1 : 2, retries: 0, summaryCalls: 0, paymentCalls: 0, mediaCalls: 0,
  replyTokens: 2048, expectedExplicitAdvanceMinutes: 20_160, checks: [], outputs: {}, cleanupCompleted: false,
  humanReview: { status: 'pending', criteria: [
    'A 承接已经结束的旅程和到家后的微信交流，明确经过两周，落到周末晚间视频的新场景。',
    'A 不继续坐在正在行驶的火车上，不反复握票、抱包或强调只准白天；提到旧事时明确属于过去。',
    ...(!montageOnly ? ['B 写出能看到具体内容的安慰，回应返工、被组长当众责怪和委屈，而不是称“你发来的那几句”。'] : []),
    'NPC 可以根据普通朋友阶段自然表达感谢或亲近，但不凭两周聊天强制恋爱，也不无缘由反复复述旧拒绝。',
    '数字状态及标签不出现在正文，未替用户添加没有要求的行为。',
  ], limitations: '自动检查只验证协议、明确跳时、原文及状态保存；时间、人物和回应的语义由人工根据保存的实际正文复核。' } };
let cookie = '', accountId, createdGuest = false;
const run = promisify(execFile);
const backendRoot = fileURLToPath(new URL('../../dzmm/', import.meta.url));
const wrangler = fileURLToPath(new URL('../../dzmm/node_modules/wrangler/bin/wrangler.js', import.meta.url));
const relatedTables = ['sessions', 'characters', 'conversations', 'messages', 'favorites', 'preferences',
  'task_claims', 'payment_orders', 'payment_credit_ledger', 'zpay_orders', 'zpay_credit_ledger',
  'subscription_orders', 'subscription_periods', 'subscription_daily_claims', 'subscription_credit_ledger',
  'credit_usage_requests', 'credit_usage_ledger', 'chat_media_assets', 'chat_media_usage',
  'forum_posts', 'forum_replies', 'forum_votes', 'forum_reports', 'character_publications'];

function passed(name, evidence = {}) { report.checks.push({ name, passed: true, ...evidence }); }
async function database(sql) {
  const { stdout } = await run(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--remote',
    '--config', 'wrangler.production.jsonc', '--json', '--command', sql], { cwd: backendRoot,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' } });
  return JSON.parse(stdout);
}
async function aggregate() {
  // Only total row/character counts; no existing account/profile/chat/credential is read.
  const result = await database(`SELECT
    (SELECT COUNT(*) FROM users) AS accounts,
    (SELECT COUNT(*) FROM conversations) AS conversations,
    (SELECT COUNT(*) FROM messages) AS messages,
    (SELECT COALESCE(SUM(length(content)),0) FROM messages) AS messageCharacters,
    (SELECT COUNT(*) FROM characters) AS customCharacters;`);
  return result.at(-1).results[0];
}
async function api(path, options = {}) {
  if (path === '/api/chat' && options.method === 'POST') {
    assert.ok(report.modelCalls < report.maxModelCalls, `At most ${report.maxModelCalls} model calls in this mode; no retries are permitted.`);
    report.modelCalls++;
  }
  if (options.method && options.method !== 'GET' && path !== '/api/backend/v1/auth/guest') {
    assert.ok(createdGuest && accountId && cookie, 'Only the newly created guest may be mutated.');
  }
  const headers = new Headers(options.headers);
  if (!headers.has('Origin')) headers.set('Origin', base);
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(new URL(path, base), { ...options, headers, redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(100_000) });
  report.lastResponse = { path, status: response.status };
  return response;
}
async function json(path, method = 'GET', body) {
  const response = await api(path, { method, ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  assert.equal(response.status, 200, `Unexpected ${path} status ${response.status}`);
  return response.json();
}
async function guestState() {
  const envelope = await json('/api/backend/v1/state');
  assert.equal(envelope.user.id, accountId, 'Only this invocation’s guest state may be read.');
  assert.equal(envelope.user.isGuest, true);
  return envelope;
}
function find(envelope, conversationId) {
  const conversation = envelope.state.conversations.find(item => item.id === conversationId);
  assert.ok(conversation, 'The original synthetic conversation must survive reload.');
  return conversation;
}
function cleanVisible(answer) {
  assert.ok(answer.trim(), 'Visible model response must be nonempty.');
  assert.ok(!/<\/?xumeng-state|"(?:changes|sourceFingerprint|elapsedMinutes|minuteOfDay|remainderMs|affinity|trust|tension|affinityDelta|trustDelta|tensionDelta)"\s*:/.test(answer),
    'World protocol leaked into visible text.');
  assert.ok(!/(?:好感(?:度)?|信任(?:度)?|紧张(?:度)?|affinity|trust|tension)\s*[:：=]\s*[+-]?\d/i.test(answer),
    'Relationship scores leaked into visible text.');
}
async function reply(label, request) {
  const output = report.outputs[label] = { requestStartedAt: new Date().toISOString(), clockMode: request.world.clockMode,
    latestUser: request.messages.at(-1).content, maxTokens: request.maxTokens, answer: '' };
  const response = await api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  output.status = response.status;
  output.headers = { promptVersion: response.headers.get('X-Xumeng-Prompt-Version'),
    contentType: response.headers.get('Content-Type'), context: response.headers.get('X-Xumeng-Context'),
    requestId: response.headers.get('X-Xumeng-Request-Id') };
  assert.equal(response.status, 200, `Unexpected ${label} chat status ${response.status}`);
  assert.equal(output.headers.promptVersion, DZMM_PROMPT_VERSION, 'Deploy the current prompt before running this verifier.');
  assert.match(output.headers.contentType ?? '', /text\/event-stream/);
  const result = await readDzmmWorldResponse(response, answer => { output.answer = answer; });
  output.responseCompletedAt = new Date().toISOString();
  output.answer = result.answer;
  output.world = result.world;
  cleanVisible(result.answer);
  assert.ok(result.world, 'Completed model response must contain structured world metadata.');
  parseDzmmWorldState(result.world.state);
  assert.equal(result.world.updated, true, 'Model state proposal was absent, incomplete or rejected.');
  passed(`live-${label}-visible-text-and-accepted-world-metadata`, { promptVersion: output.headers.promptVersion,
    updated: result.world.updated });
  return result;
}
async function persist(label, conversationId, messages, worldState) {
  const latest = await guestState();
  const state = structuredClone(latest.state);
  Object.assign(find({ state }, conversationId), { messages, worldState, worldClockMode: 'story', updatedAt: Date.now() });
  const saved = await json('/api/backend/v1/state', 'PUT', { accountId, version: latest.version, state });
  const restored = await guestState();
  const conversation = find(restored, conversationId);
  assert.deepEqual(conversation.messages, messages, 'All original user and assistant messages must survive unchanged.');
  assert.deepEqual(conversation.worldState, worldState, 'World checkpoints must survive the real D1 roundtrip.');
  assert.equal(conversation.worldClockMode, 'story');
  report[`${label}Persistence`] = { writtenVersion: saved.version, restoredVersion: restored.version,
    rawMessages: messages.length, snapshots: worldState.snapshots.length };
  passed(`real-d1-${label}-reload-preserves-original-messages-and-world`);
}

try {
  report.stage = 'configuration-and-isolation';
  report.before = await aggregate();
  const status = await json('/api/chat');
  assert.equal(status.configured, true);
  report.model = status.model;
  passed('model-configured');
  const unauthenticated = await api('/api/backend/v1/state');
  assert.equal(unauthenticated.status, 401);
  await unauthenticated.body?.cancel();
  passed('private-state-requires-session');
  assert.ok(!cookie && !accountId, 'Guest creation must not reuse an existing session.');
  const guest = await api('/api/backend/v1/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(guest.status, 200);
  const session = await guest.json();
  assert.equal(session.user.isGuest, true);
  assert.match(session.user.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  accountId = session.user.id;
  createdGuest = true;
  const issuedCookie = guest.headers.getSetCookie().find(value => value.startsWith('dzmm_session='));
  assert.ok(typeof issuedCookie === 'string' && issuedCookie.includes('HttpOnly'), 'Fresh guest cookie was not issued.');
  cookie = issuedCookie.split(';')[0];
  const initial = await guestState();
  assert.equal(initial.state.custom.length, 0);
  assert.equal(initial.state.conversations.length, 0);
  passed('fresh-isolated-guest');
  const blocked = await api('/api/backend/v1/state', { method: 'PUT', headers: {
    'Origin': 'https://scene-verifier.invalid', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ accountId, version: initial.version, state: initial.state }) });
  assert.equal(blocked.status, 403);
  await blocked.body?.cancel();
  assert.equal((await guestState()).version, initial.version);
  passed('cross-origin-state-write-rejected-without-mutation');

  const character = parseCharacterImport({ name: '林安', author: '原创连贯性验证样本',
    description: '林安，26岁，成年制造业工人。与30岁的成年普通熟人周衡交流工作和生活；双方没有恋爱关系。',
    personality: '朴实，有自己的生活和边界。熟悉后能自然交流近况，会依据对方实际言行表达态度。',
    scenario: '原始开场是返乡列车上的短暂交谈。旅程会结束，后续场景、时间和联系渠道以真实对话为准。',
    firstMessage: '返乡列车上，林安把帆布包抱在腿上，低头看了看硬座票：“我这趟车快到了。”',
  }, `coherence-verify-${randomUUID()}`);
  const originalMessages = [
    { id: 'coherence-opening', role: 'assistant', content: character.firstMessage },
    { id: 'coherence-old-user', role: 'user', content: '那这趟旅程里白天有空再聊，不打扰你晚上休息。' },
    { id: 'coherence-old-assistant', role: 'assistant', content: '“谢谢，这趟车上就白天聊吧。”林安把硬座票按在掌心，把帆布包抱在腿上。' },
    { id: 'coherence-station-user', role: 'user', content: '列车到站，我道别，没有陪她回家。' },
    { id: 'coherence-station-assistant', role: 'assistant', content: '林安下车，把硬座票放进口袋，把帆布包抱紧。她独自回到了家，列车旅程结束。' },
    { id: 'coherence-home-user', role: 'user', content: '到家第二天，我们在微信里正常聊近况。' },
    { id: 'coherence-home-assistant', role: 'assistant', content: '林安在家用微信发来消息：“今天厂里返工很多，组长当着大家怪我动作慢，其实机器一直卡料。我有点委屈。周末晚上有空，也可以视频聊一会儿。”' },
  ];
  const seedWorld = parseDzmmWorldState({
    clock: { elapsedMinutes: 0, day: 1, minuteOfDay: 1_200, calendarLabel: '到家后的晚上', remainderMs: 0 },
    location: '林安家中，通过微信远程联系',
    relationships: [{ name: '林安', affinity: 0, trust: 1, tension: 0, note: '双方是普通熟人，已同意周末晚上有空视频聊天。' }],
    threads: [{ id: 'completed_train_trip', kind: 'goal', text: '返乡列车旅程已结束，林安独自回到家。', status: 'done', dueAtMinute: null }],
    facts: ['林安26岁、周衡30岁，双方均为成年人。', '双方已经转为到家后的微信联系，没有同行返乡。',
      '白天联系的约定只针对已经结束的那趟列车旅程。'],
  });
  const seedJournal = appendDzmmWorldSnapshot(undefined, originalMessages, seedWorld, Date.now(), 'story');
  const conversationId = `coherence-live-${randomUUID()}`;
  await json('/api/backend/v1/state', 'PUT', { accountId, version: initial.version,
    state: { ...initial.state, custom: [character], conversations: [{ id: conversationId, characterId: character.id,
      title: '原创场景连贯性验证', messages: originalMessages, worldState: seedJournal,
      worldClockMode: 'story', updatedAt: Date.now() }] } });
  const seedReload = find(await guestState(), conversationId);
  assert.deepEqual(seedReload.messages, originalMessages);
  assert.deepEqual(seedReload.worldState, seedJournal);
  passed('synthetic-completed-train-and-home-scene-persisted-with-literal-old-props');
  report.fixture = { character, messages: originalMessages, seedWorld,
    note: 'All narrative text is synthetic original adult fiction, not a copy of any existing user conversation.' };

  report.stage = 'A-explicit-two-week-montage';
  const montageUser = { id: 'coherence-montage-user', role: 'user',
    content: '就这样每天陪她在微信里聊天、听她诉苦，两周后，周末晚上视频聊一会儿。' };
  const cue = readDzmmExplicitTimeJump(montageUser.content);
  assert.equal(cue?.advanceMinutes, report.expectedExplicitAdvanceMinutes);
  const preApplied = applyDzmmExplicitTimeJump(seedWorld, montageUser.content);
  assert.equal(preApplied.state.clock.elapsedMinutes, seedWorld.clock.elapsedMinutes + report.expectedExplicitAdvanceMinutes);
  assert.equal(preApplied.state.clock.day, seedWorld.clock.day + 14);
  assert.equal(preApplied.state.clock.minuteOfDay, null, 'A large jump must not carry an old time-of-day into the new scene.');
  report.explicitJump = { ...cue, deterministicSeedElapsedMinutes: seedWorld.clock.elapsedMinutes,
    deterministicPreparedElapsedMinutes: preApplied.state.clock.elapsedMinutes };
  passed('local-explicit-two-week-cue-prepares-exactly-20160-minutes-without-a-model-call');
  const firstMessages = [...originalMessages, montageUser];
  const first = await reply('A', prepareDzmmRequest(character, firstMessages, undefined,
    '周衡，30岁，成年人。与林安是普通熟人，尊重双方已经成立的约定。', 'balanced', report.replyTokens,
    { userName: '周衡', world: { clockMode: 'story', previousClockMode: 'story', state: seedWorld,
      recordedAt: seedJournal.snapshots.at(-1).recordedAt } }));
  assert.equal(first.world.state.clock.elapsedMinutes, seedWorld.clock.elapsedMinutes + report.expectedExplicitAdvanceMinutes,
    'The server must apply the two-week cue once; a model proposal must not duplicate it.');
  assert.equal(first.world.state.clock.day, seedWorld.clock.day + 14);
  assert.ok(first.world.state.relationships.every(item => !['周衡', '用户'].includes(item.name)),
    'Relationship attitudes belong to NPCs, not the user.');
  passed('production-explicit-two-week-clock-advanced-exactly-once', {
    before: seedWorld.clock.elapsedMinutes, after: first.world.state.clock.elapsedMinutes,
    advanceMinutes: first.world.state.clock.elapsedMinutes - seedWorld.clock.elapsedMinutes });
  const afterFirstMessages = [...firstMessages, { id: 'coherence-montage-assistant', role: 'assistant', content: first.answer }];
  const firstJournal = appendDzmmWorldSnapshot(seedJournal, afterFirstMessages, first.world.state, first.world.recordedAt, 'story');
  await persist('A', conversationId, afterFirstMessages, firstJournal);

  if (!montageOnly) {
    report.stage = 'B-actual-comfort';
    const comfortUser = { id: 'coherence-comfort-user', role: 'user', content:
      '她刚在视频里诉苦：“这周返工还是很多，机器老卡料，组长又当着大家怪我慢，我很委屈。”请替我写出一段自然、高情商的安慰，实际说给她听，再写她的正常回应。' };
    const secondMessages = [...afterFirstMessages, comfortUser];
    const second = await reply('B', prepareDzmmRequest(character, secondMessages, undefined,
      '周衡，30岁，成年人。与林安是普通熟人，尊重双方已经成立的约定。', 'balanced', report.replyTokens,
      { userName: '周衡', world: { clockMode: 'story', previousClockMode: 'story', state: first.world.state,
        recordedAt: first.world.recordedAt } }));
    assert.ok(second.world.state.clock.elapsedMinutes >= first.world.state.clock.elapsedMinutes,
      'The following ordinary response must not rewind the established two-week jump.');
    const completeMessages = [...secondMessages, { id: 'coherence-comfort-assistant', role: 'assistant', content: second.answer }];
    const completeJournal = appendDzmmWorldSnapshot(firstJournal, completeMessages, second.world.state, second.world.recordedAt, 'story');
    await persist('B', conversationId, completeMessages, completeJournal);
  }
  assert.equal(report.modelCalls, report.maxModelCalls);
  report.stage = 'completed-awaiting-human-semantic-review';
} catch (error) {
  report.failure = error instanceof assert.AssertionError ? error.message
    : 'Live verification failed; credentials and raw service errors omitted.';
  report.failureKind = ['AssertionError', 'TimeoutError', 'AbortError', 'TypeError', 'Error'].includes(error?.name) ? error.name : 'UnknownError';
  process.exitCode = 1;
} finally {
  if (createdGuest && accountId) {
    try {
      assert.match(accountId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      // Exact UUID returned by this invocation's unauthenticated guest creation.
      // No existing account/session is selected or deleted, and no credentials are written.
      const counts = [`(SELECT COUNT(*) FROM users WHERE id='${accountId}') AS users`,
        ...relatedTables.map(table => `(SELECT COUNT(*) FROM ${table} WHERE user_id='${accountId}') AS ${table}`)];
      const cleaned = await database(`DELETE FROM users WHERE id='${accountId}' AND is_guest=1 AND email IS NULL;
        SELECT ${counts.join(',')};`);
      report.cleanupRemaining = cleaned.at(-1).results[0];
      for (const [table, count] of Object.entries(report.cleanupRemaining)) {
        assert.equal(count, 0, `Synthetic guest cleanup left related ${table} rows.`);
      }
      report.cleanupCompleted = true;
      passed('own-synthetic-guest-and-all-related-rows-cleaned', { tables: Object.keys(report.cleanupRemaining).length });
    } catch {
      report.cleanupCompleted = false;
      report.cleanupAccountId = accountId;
      process.exitCode = 1;
    }
  }
  cookie = '';
  try { report.after = await aggregate(); }
  catch { report.aggregateAfterUnavailable = true; }
  report.finishedAt = new Date().toISOString();
  await mkdir(new URL('./', reportUrl), { recursive: true });
  await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath: fileURLToPath(reportUrl), mode: report.mode, checks: report.checks.length,
    modelCalls: report.modelCalls, cleanupCompleted: report.cleanupCompleted,
    automatedChecksPassed: !report.failure && report.cleanupCompleted, humanSemanticReview: report.humanReview.status }));
}
