import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../provider.mjs';
import { createSession, prepareTurn, commitTurn, commitInitiative } from '../engine.mjs';
import { recordDecision, applyInitiativeDecision } from '../companion-runtime.mjs';

const env = { CHARACTER_CHAT_API_KEY: 'test-secret', CHARACTER_CHAT_BASE_URL: 'https://model.example/v1',
  CHARACTER_CHAT_MODEL: 'test/replyer', CHARACTER_CHAT_PLANNER_MODEL: 'test/planner' };
const plan = (action = 'reply') => ({ action, replyReference: action === 'reply' ? '接住用户当前亲近的邀请，有一点害羞但别回避。' : '',
  focus: '眼前的亲近邀请', tone: '轻甜', avoid: ['我在这里陪着你'], memoryIds: [], waitSeconds: action === 'wait' ? 60 : 0,
  decisionReason: '当前消息直接邀请亲近。' });
const answer = { messages: ['有一点想你。刚才还在犹豫要不要先说。'], emotion: 'playful', followUp: null };
const response = value => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
const fresh = () => prepareTurn(createSession({ characterId: 'yume' }), '有想我吗');
const ongoing = () => commitTurn(fresh(), '有想我吗', answer, { now: '2026-10-18T04:00:00Z' });

test('configured companion uses separate Planner and Replyer model routes', async () => {
  const calls = [];
  const provider = createProvider(env, { fetch: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return response(calls.length === 1 ? plan() : answer);
  } });
  const result = await provider.generate(fresh(), '有想我吗');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.model), ['test/planner', 'test/replyer']);
  assert.equal(calls[0].stream, false);
  assert.equal(result.control.trace.fallback, false);
  assert.deepEqual(result.messages, answer.messages);
  assert.ok(JSON.stringify(calls[1].messages).includes('眼前的亲近邀请'));
  assert.ok(!JSON.stringify(provider.publicConfig).includes('test-secret'));
});

test('initiative wait and silence skip the visible-language model', async () => {
  for (const action of ['wait', 'silent']) {
    let calls = 0;
    const provider = createProvider(env, { fetch: async () => { calls++; return response(plan(action)); } });
    const result = await provider.generateInitiative(ongoing());
    assert.equal(calls, 1);
    assert.deepEqual(result.messages, []);
    assert.equal(result.control.plan.action, action);
  }
});

test('bad Planner output falls back for foreground, stays silent for proactive', async () => {
  for (const initiative of [false, true]) {
    let calls = 0;
    const provider = createProvider(env, { fetch: async () => response(++calls === 1 ? { invalid: true } : answer) });
    const result = initiative ? await provider.generateInitiative(ongoing()) : await provider.generate(fresh(), '有想我吗');
    assert.equal(calls, initiative ? 1 : 2);
    assert.equal(result.control.trace.fallback, true);
    assert.deepEqual(result.messages, initiative ? [] : answer.messages);
  }
});

test('foreground wait cannot silently consume a real user message', async () => {
  let calls = 0;
  const provider = createProvider(env, { fetch: async () => response(++calls === 1 ? plan('wait') : answer) });
  const result = await provider.generate(fresh(), '有想我吗');
  assert.equal(calls, 2);
  assert.equal(result.control.trace.fallback, true);
  assert.deepEqual(result.messages, answer.messages);
});

test('cancellation during planning never starts a Replyer call', async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = createProvider(env, { fetch: async (_url, options) => {
    calls++;
    controller.abort();
    options.signal.throwIfAborted();
  } });
  await assert.rejects(provider.generate(fresh(), '有想我吗', { signal: controller.signal }), error => error.code === 'CANCELLED');
  assert.equal(calls, 1);
});

test('Planner metadata is not sent as a chat preview', async () => {
  const seen = [];
  let calls = 0;
  const provider = createProvider(env, { fetch: async () => response(++calls === 1 ? plan() : answer) });
  await provider.generate(fresh(), '有想我吗', { onMessage: part => seen.push(part.text) });
  assert.deepEqual(seen, answer.messages);
});

test('malformed dialogue is repaired once without replanning or fabricating a local reply', async () => {
  const calls = [];
  const provider = createProvider(env, { fetch: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return response(calls.length === 1 ? plan() : calls.length === 2 ? { messages: 'wrong type' } : answer);
  } });
  const result = await provider.generate(fresh(), '有想我吗');
  assert.deepEqual(calls.map(call => call.model), ['test/planner', 'test/replyer', 'test/replyer']);
  assert.deepEqual(result.messages, answer.messages);
  assert.equal(result.control.trace.formatRepaired, true);
  let invalidCalls = 0;
  const invalidProvider = createProvider(env, { fetch: async () => response(++invalidCalls === 1 ? plan() : { messages: 'wrong type' }) });
  await assert.rejects(invalidProvider.generate(fresh(), '有想我吗'), error => error.code === 'INVALID_MODEL_OUTPUT');
  assert.equal(invalidCalls, 3);
});

test('streamed forbidden speaker labels use the same bounded format repair', async () => {
  let calls = 0;
  const seen = [];
  const provider = createProvider(env, { fetch: async () => {
    calls++;
    if (calls === 1) return response(plan());
    if (calls === 3) return response(answer);
    const data = JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ messages: ['Yume：你好呀。'], emotion: 'friendly' }) } }] });
    return new Response(`data: ${data}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await provider.generate(fresh(), '有想我吗', { onMessage: part => seen.push(part.text) });
  assert.equal(calls, 3);
  assert.deepEqual(seen, []);
  assert.deepEqual(result.messages, answer.messages);
  assert.equal(result.control.trace.formatRepaired, true);
});

test('initiative wait persists a bounded timer and receipt without fabricating speech', () => {
  const session = ongoing();
  session.initiative.pending = { id: session.id, kind: 'reconsider', intent: '有新的想法再说',
    createdAt: '2026-10-18T04:00:00.000Z', notBefore: '2026-10-18T04:00:12.000Z', expiresAt: '2026-10-18T04:05:00.000Z' };
  const now = '2026-10-18T04:01:00.000Z';
  const control = { plan: plan('wait'), trace: { action: 'wait', plannerModel: 'test/planner', replyerModel: 'test/replyer' } };
  const result = applyInitiativeDecision(commitInitiative(session, { messages: [], emotion: 'calm', followUp: null }, { now }), session, control, { now });
  assert.equal(result.messages.length, session.messages.length);
  assert.equal(result.initiative.pending.notBefore, '2026-10-18T04:02:00.000Z');
  assert.equal(result.initiative.budgetUsed, 1);
  assert.equal(result.aiRuntime.lastDecision.action, 'wait');
  assert.equal(result.aiRuntime.consecutiveWaits, 1);
  assert.deepEqual(result.agency, session.agency);
});

test('decision ledger is bounded and does not persist hidden reasoning or credentials', () => {
  const s = fresh();
  for (let index = 0; index < 20; index++) recordDecision(s, { trace: {
    action: 'reply', plannerModel: 'test/planner', reasoning: 'not-a-persisted-field', apiKey: 'test-secret',
  } });
  assert.equal(s.aiRuntime.decisions.length, 12);
  assert.ok(!JSON.stringify(s.aiRuntime).includes('not-a-persisted-field'));
  assert.ok(!JSON.stringify(s.aiRuntime).includes('test-secret'));
});
