import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArguments, runEvaluation } from '../evaluations/cute-presence.mjs';

const KEY = 'synthetic-evaluation-only-key';
const environment = { CHARACTER_CHAT_API_KEY: KEY, CHARACTER_CHAT_BASE_URL: 'https://evaluation.example/v1', CHARACTER_CHAT_MODEL: 'x-ai/grok-4.6' };
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages: ['嗯，听见啦。'], emotion: 'friendly',
  beat: { focus: '刚才的对话', feeling: '开心', want: '再说一点自己的想法' }, followUp: { intent: '继续一点小心思', delaySeconds: 20 } }), finish_reason: 'stop' } }], usage: { prompt_tokens: 12, completion_tokens: 9 } }), { status: 200 });
const isPlanner = request => new Headers(request.headers).get('X-Title') === 'XUMENG Companion Planner';
const plan = (action = 'reply') => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action,
  replyReference: '接住当前内容，贡献一个具体想法', focus: '当前话题', tone: '轻快自然', avoid: [], memoryIds: [],
  waitSeconds: action === 'wait' ? 30 : 0, decisionReason: action === 'reply' ? '当前有值得回应的具体内容' : '还没有值得打断的新内容' }), finish_reason: 'stop' } }],
  usage: { prompt_tokens: 10, completion_tokens: 8 } }), { status: 200 });
async function outputPath(t) {
  const directory = await mkdtemp(join(tmpdir(), 'character-cute-evaluation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'report.json');
}

test('cute evaluation defaults to a no-call plan with explicit argument validation', async () => {
  const options = parseArguments([]);
  assert.equal(options.live, false);
  const report = await runEvaluation(options, { fetch: () => { throw new Error('A plan must not request a model'); } });
  assert.equal(report.status, 'planned');
  assert.equal(report.model, null);
  assert.equal(report.actualCalls, 0);
  assert.equal(report.plannedTurns, 12);
  assert.equal(report.plannedCalls, 24);
  assert.equal(report.steps.length, 0);
  assert.ok(report.version.files['engine.mjs']);
  assert.ok(report.version.files['provider.mjs']);
  assert.ok(report.version.files['planner.mjs']);
  assert.ok(report.version.files['replyer-context.mjs']);
  for (const args of [['--character', 'invalid'], ['--scenario', 'invalid'], ['--out'], ['--unknown']]) assert.throws(() => parseArguments(args), error => error.evaluationCode === 'INVALID_ARGUMENT');
});

test('live synthetic evaluation separates Planner and Replyer requests without credentials', async (t) => {
  const out = await outputPath(t);
  const options = parseArguments(['--live', '--character', 'nari', '--out', out]);
  let requests = 0;
  const report = await runEvaluation(options, { environment, fetch: async (_url, request) => {
    requests += 1;
    const body = JSON.parse(request.body);
    assert.deepEqual(body.reasoning, { effort: isPlanner(request) ? 'none' : 'low', exclude: true });
    assert.equal(body.stream, false);
    return isPlanner(request) ? plan() : reply();
  } });
  assert.equal(requests, 16);
  assert.equal(report.status, 'complete');
  assert.equal(report.actualCalls, 16);
  assert.deepEqual(report.callsByStage, { planner: 8, replyer: 8 });
  assert.equal(report.steps.every(step => step.calls.map(call => call.stage).join(',') === 'planner,replyer'), true);
  assert.equal(report.steps.every(step => JSON.parse(step.rawContent).messages && !JSON.parse(step.rawContent).action), true);
  assert.equal(report.steps.every(step => step.status === 'complete' && step.rawContent && step.usage && step.requestBody && Number.isInteger(step.latencyMs)), true);
  assert.equal(report.finalSession.messages.filter(message => message.role === 'user').length, 8);
  const saved = await readFile(out, 'utf8');
  assert.equal(saved.includes(KEY), false);
  assert.equal(saved.includes('Authorization'), false);
  assert.equal(JSON.parse(saved).status, 'complete');
});

test('initiative evaluation advances real plans without synthetic user turns or fact changes', async (t) => {
  const out = await outputPath(t);
  const options = parseArguments(['--live', '--scenario', 'initiative', '--out', out]);
  const report = await runEvaluation(options, { environment, fetch: async (_url, request) => isPlanner(request) ? plan() : reply() });
  assert.equal(report.status, 'complete');
  assert.equal(report.actualCalls, 10);
  assert.deepEqual(report.callsByStage, { planner: 5, replyer: 5 });
  const initiatives = report.steps.filter(step => step.kind === 'initiative');
  assert.equal(initiatives.length, 4);
  assert.equal(initiatives.every(step => Object.values(step.checks).every(Boolean)), true);
  assert.equal(report.steps[0].requestBody.messages.some(message => message.role === 'user'), false);
  assert.equal(report.finalSession.messages.filter(message => message.role === 'user').length, 1);
  const checks = report.checks.find(check => check.phase === 'synthetic-stop-and-replacement');
  for (const key of ['quietStayedPaused', 'quietHasNoPlan', 'userResetBudget', 'newPlanReplacedOld']) assert.equal(checks[key], true, key);
  assert.equal(JSON.stringify(report).includes(KEY), false);
});

test('failed model evaluation atomically retains completed steps and sanitized error', async (t) => {
  const out = await outputPath(t);
  let replies = 0;
  await assert.rejects(runEvaluation(parseArguments(['--live', '--character', 'nari', '--out', out]), { environment, fetch: async (_url, request) => {
    if (isPlanner(request)) return plan();
    replies += 1;
    if (replies === 1) return reply();
    return new Response(JSON.stringify({ error: { message: KEY } }), { status: 401 });
  } }), error => error.evaluationCode === 'EVALUATION_FAILED' && error.output === out);
  const text = await readFile(out, 'utf8');
  const report = JSON.parse(text);
  assert.equal(report.status, 'failed');
  assert.equal(report.actualCalls, 4);
  assert.deepEqual(report.callsByStage, { planner: 2, replyer: 2 });
  assert.equal(report.steps[0].status, 'complete');
  assert.equal(report.steps[1].status, 'failed');
  assert.equal(text.includes(KEY), false);
});

for (const action of ['wait', 'silent']) test(`initiative evaluation records ${action} plans without mislabeling planner JSON as dialogue`, async t => {
  const out = await outputPath(t);
  const report = await runEvaluation(parseArguments(['--live', '--scenario', 'initiative', '--out', out]), { environment,
    fetch: async (_url, request) => {
      if (!isPlanner(request)) return reply();
      const body = JSON.parse(request.body);
      const data = JSON.parse(/<planner_context>([\s\S]*?)<\/planner_context>/.exec(body.messages[1].content)[1]);
      return plan(data.turn.kind === 'initiative' ? action : 'reply');
    },
  });
  const initiatives = report.steps.filter(step => step.kind === 'initiative');
  assert.equal(initiatives.length, action === 'wait' ? 4 : 2);
  for (const step of initiatives) {
    assert.deepEqual(step.calls.map(call => call.stage), ['planner']);
    assert.equal(step.rawContent, undefined);
    assert.equal(step.requestBody, undefined);
    assert.deepEqual(step.result.messages, []);
    assert.equal(step.session.aiRuntime.lastDecision.action, action);
  }
  assert.deepEqual(report.callsByStage, { planner: action === 'wait' ? 5 : 3, replyer: 1 });
  assert.equal(report.finalSession.messages.filter(message => message.role === 'assistant' && message.kind === 'initiative').length, 0);
});
