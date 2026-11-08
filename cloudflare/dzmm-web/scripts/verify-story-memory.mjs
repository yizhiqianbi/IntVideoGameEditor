import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

// Original, nonsexual fixture. Only a newly-created guest is written and cleaned.
// Session credentials remain in memory; neither cookies nor provider secrets are exported.
const { prepareDzmmRememberedRequest } = await tsImport('../../../src/lib/dzmm-memory-client.ts', import.meta.url);
const { parseCharacterImport } = await tsImport('../../../src/lib/dzmm-characters.ts', import.meta.url);
const { prepareDzmmRequest } = await tsImport('../../../src/lib/dzmm-context.ts', import.meta.url);
const { DZMM_PROMPT_VERSION } = await tsImport('../../../src/lib/dzmm-chat.ts', import.meta.url);
const { createDzmmStoryMemory, selectDzmmMemoryUpdate } = await tsImport('../../../src/lib/dzmm-story-memory.ts', import.meta.url);
const base = new URL(process.argv[2] || 'https://xumengchat.top').origin;
assert.equal(base, 'https://xumengchat.top');
const reportUrl = new URL('../../../output/xumeng/story-memory-live-2026-10-05.json', import.meta.url);
const report = { testedAt: new Date().toISOString(), baseUrl: base, checks: [], summaryCalls: 0,
  promptVersion: DZMM_PROMPT_VERSION, replyTokens: 2048, cleanupCompleted: false, outputs: {} };
let cookie = '', accountId;
const run = promisify(execFile);
async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Origin', base);
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(new URL(path, base), { ...options, headers, signal: options.signal ?? AbortSignal.timeout(100000) });
  report.lastResponse = { path, status: response.status };
  if (path === '/api/memory' && options.method === 'POST' && !response.ok) {
    const body = await response.clone().json().catch(() => null);
    report.memoryFailure = { status: response.status, error: typeof body?.error === 'string' ? body.error.slice(0, 200) : 'No JSON error' };
  }
  return response;
}
async function json(path, method = 'GET', body) {
  const response = await api(path, { method, ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  assert.equal(response.status, 200, `Unexpected ${path} status ${response.status}`);
  return response.json();
}
function passed(name) { report.checks.push({ name, passed: true }); }
try {
  report.stage = 'configuration';
  const status = await json('/api/chat');
  assert.equal(status.configured, true); report.model = status.model;
  passed('model-configured');
  assert.equal((await api('/api/memory')).status, 405);
  passed('memory-post-only');
  const guest = await api('/api/backend/v1/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(guest.status, 200);
  const session = await guest.json();
  assert.equal(session.user.isGuest, true);
  accountId = session.user.id;
  assert.match(accountId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  cookie = guest.headers.getSetCookie().find(value => value.startsWith('dzmm_session=')).split(';')[0];
  const character = parseCharacterImport({ name: '港城档案员', description: '成年档案员与成年旅人一起查阅旧地图。',
    personality: '沉着，落实承诺，说话简短。', scenario: '书库里寻找旧灯塔地图。旅人决定是否外出。',
    firstMessage: '旧灯塔的地图还没找到，我们先在书库查查。',
    messageExamples: '<START>\n{{user}}: 先别出发。\n{{char}}: 好，我把地图摊平，先在这里看。',
  }, `roleplay-verify-${randomUUID()}`);
  const messages = [
    { id: 'opening', role: 'assistant', content: character.firstMessage },
    { id: 'found-user', role: 'user', content: '旧灯塔地图已经找到，我把它放在桌上，暂时留在书库。' },
    { id: 'found-assistant', role: 'assistant', content: '地图已找到，现在展开在桌上。我在书库和你一起辨认图上的路线，不再寻找地图。' },
    ...Array.from({ length: 58 }, (_, index) => ({ id: `recent-${index}`, role: index % 2 ? 'assistant' : 'user',
      content: index % 2 ? `窗外的雨声持续，书库第${index}排架子旁十分安静。` : `我留在书库，慢慢观察第${index}排书架。` })),
    { id: 'latest-user', role: 'user', content: '继续，承接刚才的进度。' },
  ];
  report.stage = 'summarization';
  let previousMemory;
  if (process.argv.includes('--resume-successful-summary')) {
    const previous = JSON.parse(await readFile(new URL('../../../output/xumeng/story-memory-live-first-attempt-2026-10-05.json', import.meta.url), 'utf8'));
    assert.ok(previous.checks.some(check => check.name === 'completed-map-in-old-history-memory' && check.passed));
    previousMemory = createDzmmStoryMemory(previous.outputs.memory, selectDzmmMemoryUpdate(messages).sourcePrefix);
    report.reusedSummary = 'story-memory-live-first-attempt-2026-10-05.json';
  }
  const prepared = await prepareDzmmRememberedRequest({ character, messages, model: 'balanced', maxTokens: report.replyTokens,
    memoryFetch: api, userName: '旅人', memory: previousMemory });
  report.summaryCalls = prepared.summaryCalls;
  assert.ok(prepared.memory);
  assert.equal(prepared.memory.sourceCount + prepared.request.messages.length, messages.length);
  assert.ok(prepared.memory.state.completed.some(item => /地图/.test(item)), 'Map completion must survive summarization');
  report.outputs.memory = prepared.memory.state;
  report.memorySourceCount = prepared.memory.sourceCount;
  passed('completed-map-in-old-history-memory'); passed('complete-prefix-and-raw-tail-coverage');

  report.stage = 'persistence';
  const initial = await json('/api/backend/v1/state');
  const conversation = { id: `roleplay-test-${randomUUID()}`, characterId: character.id, title: '原创剧情记忆验证',
    messages, storyMemory: prepared.memory, updatedAt: Date.now() };
  const state = { ...initial.state, custom: [character], conversations: [conversation] };
  await json('/api/backend/v1/state', 'PUT', { state, version: initial.version, accountId });
  const restored = await json('/api/backend/v1/state');
  assert.deepEqual(restored.state.conversations[0].storyMemory, prepared.memory);
  assert.deepEqual(restored.state.conversations[0].messages, messages);
  passed('real-d1-memory-roundtrip-original-history-unchanged');
  const edited = messages.map(message => message.id === 'found-user' ? { ...message, content: '地图还没找到，我留在书库。' } : message);
  const changed = await json(`/api/backend/v1/conversations/${conversation.id}/messages`, 'PUT', { messages: edited });
  assert.equal(changed.state.conversations[0].storyMemory, undefined);
  assert.deepEqual(changed.state.conversations[0].messages, edited);
  passed('real-d1-source-edit-invalidates-old-memory');
  async function reply(request) {
    const response = await api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    assert.equal(response.status, 200, `Unexpected chat status ${response.status}`);
    assert.equal(response.headers.get('X-Xumeng-Prompt-Version'), report.promptVersion);
    const text = await response.text(); assert.ok(text.trim());
    return { text, diagnostics: JSON.parse(response.headers.get('X-Xumeng-Context')) };
  }
  report.stage = 'continuation';
  report.outputs.continue = await reply(prepared.request);
  assert.equal(report.outputs.continue.diagnostics.hasMemory, true);
  assert.ok(report.outputs.continue.diagnostics.exampleMessages > 0);
  passed('live-story-response-with-memory-and-examples');
  const paused = [...messages, { id: 'live-reply', role: 'assistant', content: report.outputs.continue.text },
    { id: 'pause-user', role: 'user', content: '停一下，我想想。请先不要安排新事件，也不要离开书库。' }];
  report.stage = 'pause';
  report.outputs.pause = await reply(prepareDzmmRequest(character, paused, undefined, undefined, 'balanced', 1024,
    { storyMemory: prepared.memory, userName: '旅人' }));
  passed('live-pause-response');

  report.stage = 'completed';
} catch (error) {
  report.failure = error instanceof assert.AssertionError ? error.message : 'Live verification failed; credentials and raw service errors omitted.';
  report.failureKind = ['AssertionError', 'TimeoutError', 'AbortError', 'TypeError', 'Error'].includes(error?.name) ? error.name : 'UnknownError';
  process.exitCode = 1;
} finally {
  if (accountId) {
    try {
      const backendRoot = fileURLToPath(new URL('../../dzmm/', import.meta.url));
      const wrangler = fileURLToPath(new URL('../../dzmm/node_modules/wrangler/bin/wrangler.js', import.meta.url));
      const sql = `DELETE FROM users WHERE id='${accountId}' AND is_guest=1 AND email IS NULL; SELECT COUNT(*) AS remaining FROM users WHERE id='${accountId}';`;
      const { stdout } = await run(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--remote', '--config', 'wrangler.production.jsonc', '--json', '--command', sql],
        { cwd: backendRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' } });
      const results = JSON.parse(stdout);
      assert.equal(results.at(-1).results[0].remaining, 0);
      report.cleanupCompleted = true; passed('synthetic-guest-cleaned');
    } catch { report.cleanupCompleted = false; report.cleanupAccountId = accountId; process.exitCode = 1; }
  }
  cookie = '';
  await mkdir(new URL('./', reportUrl), { recursive: true });
  await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath: fileURLToPath(reportUrl), checks: report.checks.length,
    summaryCalls: report.summaryCalls, cleanupCompleted: report.cleanupCompleted, success: !report.failure && report.cleanupCompleted }));
}
