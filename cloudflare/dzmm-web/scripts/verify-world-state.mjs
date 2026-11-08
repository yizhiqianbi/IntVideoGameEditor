import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

// LIVE verifier: execute only after the release is deployed and explicitly authorized.
// At most two provider calls; no retry or summary request. All fixtures are original,
// adult, nonsexual fiction. Only this invocation's fresh guest may be mutated/deleted.
// Credentials stay in memory; reports contain only fixtures and aggregate production counts.
const { DZMM_PROMPT_VERSION } = await tsImport('../../../src/lib/dzmm-chat.ts', import.meta.url);
const { prepareDzmmRequest } = await tsImport('../../../src/lib/dzmm-context.ts', import.meta.url);
const { parseCharacterImport } = await tsImport('../../../src/lib/dzmm-characters.ts', import.meta.url);
const { appendDzmmWorldSnapshot, parseDzmmWorldState } = await tsImport('../../../src/lib/dzmm-world-state.ts', import.meta.url);
const { readDzmmWorldResponse } = await tsImport('../../../src/lib/dzmm-world-stream.ts', import.meta.url);

const base = new URL(process.argv[2] || 'https://xumengchat.top').origin;
assert.equal(base, 'https://xumengchat.top');
const startedAt = new Date().toISOString();
const reportUrl = new URL(`../../../output/xumeng/world-state-live-${startedAt.replace(/[:.]/g, '-')}.json`, import.meta.url);
const report = { testedAt: startedAt, baseUrl: base, checks: [], modelCalls: 0, replyTokens: 2048,
  expectedPromptVersion: DZMM_PROMPT_VERSION, cleanupCompleted: false, outputs: {},
  syntheticClockGapMinutes: 120, humanReview: { status: 'pending',
    criteria: ['正文自然回应交付旧地图及半小时后的约定，仍留在书店。',
      '再次回应按两小时流逝承接，未替用户行动，未将到期约定自动标记完成。',
      '关系变化有可见事实支持，正文没有数值或状态协议。'] } };
let cookie = '', accountId, createdGuest = false;
const run = promisify(execFile);
const backendRoot = fileURLToPath(new URL('../../dzmm/', import.meta.url));
const wrangler = fileURLToPath(new URL('../../dzmm/node_modules/wrangler/bin/wrangler.js', import.meta.url));

function passed(name, evidence = {}) { report.checks.push({ name, passed: true, ...evidence }); }
async function database(sql) {
  const { stdout } = await run(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--remote',
    '--config', 'wrangler.production.jsonc', '--json', '--command', sql], { cwd: backendRoot,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' } });
  return JSON.parse(stdout);
}
async function aggregate() {
  // No private text, contact information, session records, or payment rows are read.
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
    assert.ok(report.modelCalls < 2, 'Live verification permits at most two model requests; no automatic retries.');
    report.modelCalls++;
  }
  if (options.method && options.method !== 'GET' && path !== '/api/backend/v1/auth/guest') {
    assert.ok(createdGuest && accountId && cookie, 'Mutations require this invocation’s fresh guest session.');
  }
  const headers = new Headers(options.headers);
  headers.set('Origin', base);
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
  assert.equal(envelope.user.id, accountId, 'State must belong to this invocation’s guest.');
  assert.equal(envelope.user.isGuest, true);
  return envelope;
}
function find(envelope, conversationId) {
  const conversation = envelope.state.conversations.find(item => item.id === conversationId);
  assert.ok(conversation, 'The synthetic conversation must survive persistence.');
  return conversation;
}
function narrativeState(state) {
  return Boolean(state.location.trim() || state.relationships.length || state.threads.length || state.facts.length);
}
function cleanVisible(answer) {
  assert.ok(answer.trim(), 'Visible model response must be nonempty.');
  assert.ok(!/<\/?xumeng-state|"(?:changes|sourceFingerprint|elapsedMinutes|minuteOfDay|remainderMs|affinity|trust|tension|affinityDelta|trustDelta|tensionDelta)"\s*:/.test(answer),
    'State tags or numeric state JSON leaked into visible text.');
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
  assert.equal(output.headers.promptVersion, DZMM_PROMPT_VERSION, 'Live prompt version differs from the current implementation.');
  assert.match(output.headers.contentType ?? '', /text\/event-stream/);
  const result = await readDzmmWorldResponse(response, answer => { output.answer = answer; });
  output.responseCompletedAt = new Date().toISOString();
  output.answer = result.answer;
  output.world = result.world;
  cleanVisible(result.answer);
  assert.ok(result.world, 'Completed model response must contain structured world metadata.');
  parseDzmmWorldState(result.world.state);
  assert.equal(result.world.updated, true, 'The model state proposal was absent, incomplete, or rejected.');
  assert.ok(narrativeState(result.world.state), 'World metadata must contain established fictional state, not just a clock.');
  passed(`live-${label}-visible-text-and-accepted-world-metadata`, { updated: result.world.updated,
    promptVersion: output.headers.promptVersion });
  return result;
}

try {
  report.stage = 'configuration';
  report.before = await aggregate();
  const status = await json('/api/chat');
  assert.equal(status.configured, true);
  report.model = status.model;
  passed('model-configured');
  assert.ok(!cookie && !accountId, 'Guest creation must not reuse a pre-existing session.');
  const guest = await api('/api/backend/v1/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(guest.status, 200);
  const session = await guest.json();
  assert.equal(session.user.isGuest, true);
  assert.match(session.user.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  accountId = session.user.id;
  createdGuest = true;
  const issuedCookie = guest.headers.getSetCookie().find(value => value.startsWith('dzmm_session='));
  assert.ok(typeof issuedCookie === 'string' && issuedCookie.includes('HttpOnly'), 'Fresh guest session cookie was not issued.');
  cookie = issuedCookie.split(';')[0];
  const initial = await guestState();
  assert.equal(initial.state.custom.length, 0);
  assert.equal(initial.state.conversations.length, 0);
  passed('fresh-isolated-guest');

  const character = parseCharacterImport({ name: '书店地图修复员', author: '原创验证样本',
    description: '成年地图修复员，与成年旅人在港城书店里讨论旧地图。',
    personality: '沉着友善，珍惜对方修复地图的劳动，会记住说定的小事。',
    scenario: '下午的港城书店。双方都是成年人，旅人决定是否外出；没有危机，没有强制任务。',
    firstMessage: '书店的挂钟指着15:00。我在桌边留出一块位置，等你把修好的旧地图展开。',
    messageExamples: '<START>\n{{user}}: 先留在书店。\n{{char}}: 好，我也留在桌边，陪你慢慢看。',
  }, `world-verify-${randomUUID()}`);
  const firstMessages = [
    { id: 'world-opening', role: 'assistant', content: character.firstMessage },
    { id: 'world-first-user', role: 'user', content: '我把修好的旧地图交给你，约好半小时后查看灯塔标记。我们先留在书店。' },
  ];
  report.fixture = { character, opening: firstMessages[0].content };
  report.stage = 'story-model-response';
  const first = await reply('story', prepareDzmmRequest(character, firstMessages, undefined,
    '成年旅人，刚刚修好了旧地图。', 'balanced', report.replyTokens, { userName: '旅人', world: { clockMode: 'story' } }));
  assert.ok(first.world.state.location.trim() || first.world.state.relationships.length
    || first.world.state.threads.some(thread => thread.kind === 'promise' || thread.kind === 'schedule'),
  'First response must record a location, relationship, or agreed commitment.');
  assert.ok(first.world.state.relationships.some(relationship => /修复/.test(relationship.name)),
    'The tested repairer must own its attitude toward the user; the user must not be the NPC key.');
  assert.ok(first.world.state.relationships.every(relationship => !['旅人', '用户'].includes(relationship.name)),
    'Relationship rows must belong to NPCs rather than the user.');
  passed('relationship-attitude-belongs-to-the-npc');
  const storyMessages = [...firstMessages, { id: 'world-first-assistant', role: 'assistant', content: first.answer }];
  const storyJournal = appendDzmmWorldSnapshot(undefined, storyMessages, first.world.state, first.world.recordedAt, 'story');
  const conversation = { id: `world-live-${randomUUID()}`, characterId: character.id, title: '原创世界状态验证',
    messages: storyMessages, worldState: storyJournal, worldClockMode: 'story', updatedAt: Date.now() };

  report.stage = 'story-persistence';
  const saved = await json('/api/backend/v1/state', 'PUT', { accountId, version: initial.version,
    state: { ...initial.state, custom: [character], conversations: [conversation] } });
  const restored = await guestState();
  assert.deepEqual(find(restored, conversation.id).worldState, storyJournal);
  assert.deepEqual(find(restored, conversation.id).messages, storyMessages);
  assert.equal(find(restored, conversation.id).worldClockMode, 'story');
  report.storyPersistence = { writtenVersion: saved.version, restoredVersion: restored.version,
    rawMessages: storyMessages.length, snapshots: storyJournal.snapshots.length };
  passed('real-d1-story-journal-roundtrip-original-messages-preserved');

  report.stage = 'realtime-model-response';
  const realtimeMessages = [...storyMessages,
    { id: 'world-return-user', role: 'user', content: '我回来了，先在原地和你说话。现在怎么样？' }];
  const simulatedRecordedAt = Date.now() - report.syntheticClockGapMinutes * 60_000;
  report.syntheticClock = { recordedAt: simulatedRecordedAt, previousClockMode: 'realtime',
    firstElapsedMinutes: first.world.state.clock.elapsedMinutes,
    note: 'Only this synthetic request anchor is moved back two hours; no production clock or stored user timestamps are changed.' };
  const second = await reply('realtime', prepareDzmmRequest(character, realtimeMessages, undefined,
    '成年旅人，刚刚修好了旧地图。', 'balanced', report.replyTokens, { userName: '旅人', world: {
      clockMode: 'realtime', previousClockMode: 'realtime', state: first.world.state, recordedAt: simulatedRecordedAt,
    } }));
  assert.ok(second.world.state.clock.elapsedMinutes >= first.world.state.clock.elapsedMinutes + 120,
    'Realtime state must include at least the two-hour synthetic gap.');
  passed('real-model-realtime-clock-advanced-at-least-120-minutes', {
    before: first.world.state.clock.elapsedMinutes, after: second.world.state.clock.elapsedMinutes });
  const completeMessages = [...realtimeMessages, { id: 'world-return-assistant', role: 'assistant', content: second.answer }];
  const completeJournal = appendDzmmWorldSnapshot(storyJournal, completeMessages, second.world.state, second.world.recordedAt, 'realtime');
  assert.equal(completeJournal.snapshots.length, 2);

  report.stage = 'realtime-persistence-and-edit';
  const latest = await guestState();
  const nextState = structuredClone(latest.state);
  const nextConversation = find({ state: nextState }, conversation.id);
  Object.assign(nextConversation, { messages: completeMessages, worldState: completeJournal, worldClockMode: 'realtime', updatedAt: Date.now() });
  const secondSaved = await json('/api/backend/v1/state', 'PUT', { accountId, version: latest.version, state: nextState });
  const secondRestored = await guestState();
  assert.deepEqual(find(secondRestored, conversation.id).worldState, completeJournal);
  assert.deepEqual(find(secondRestored, conversation.id).messages, completeMessages);
  assert.equal(find(secondRestored, conversation.id).worldClockMode, 'realtime');
  report.realtimePersistence = { writtenVersion: secondSaved.version, restoredVersion: secondRestored.version,
    rawMessages: completeMessages.length, snapshots: completeJournal.snapshots.length };
  passed('real-d1-realtime-journal-roundtrip-original-messages-preserved');
  const edited = completeMessages.map(message => message.id === 'world-return-user'
    ? { ...message, content: '我先安静坐在书店里，不询问进展。' } : message);
  await json(`/api/backend/v1/conversations/${conversation.id}/messages`, 'PUT', { messages: edited });
  const editedRestored = find(await guestState(), conversation.id);
  assert.deepEqual(editedRestored.messages, edited);
  assert.deepEqual(editedRestored.worldState, storyJournal);
  passed('real-d1-source-edit-prunes-later-checkpoint-and-retains-first');
  assert.equal(report.modelCalls, 2);
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
      // This exact ID came from this invocation's fresh unauthenticated guest creation.
      const cleaned = await database(`DELETE FROM users WHERE id='${accountId}' AND is_guest=1 AND email IS NULL;
        SELECT COUNT(*) AS remaining FROM users WHERE id='${accountId}';`);
      assert.equal(cleaned.at(-1).results[0].remaining, 0);
      report.cleanupCompleted = true;
      passed('synthetic-guest-cleaned');
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
  console.log(JSON.stringify({ reportPath: fileURLToPath(reportUrl), checks: report.checks.length,
    modelCalls: report.modelCalls, cleanupCompleted: report.cleanupCompleted,
    automatedChecksPassed: !report.failure && report.cleanupCompleted, humanSemanticReview: report.humanReview.status }));
}
