import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyOpening, demoOpening, prepareAction } from '../narrative-engine.mjs';
import { createNarrativeAgent, directorMessages, parseProposal } from '../narrative-agent.mjs';

test('director carries facts, current goals and the exact free action as separate context', () => {
  const session = applyOpening(createSession({ mode: 'ai' }), demoOpening(createSession()));
  const prepared = prepareAction(session, { revision: session.revision, input: '我先找绝缘手套，切断电源，再和苏槐救人。' });
  const messages = directorMessages(session, prepared), context = JSON.parse(messages[1].content);
  assert.deepEqual(context.state, session.state);
  assert.deepEqual(context.canonicalFacts, session.canon.facts);
  assert.equal(context.submittedAction, prepared.action);
  assert.equal(context.selectedChoice, null);
  assert.equal(context.recent[0].title, session.nodes[0].title);
  assert.match(messages[0].content, /玩家 action 是尝试/);
  assert.match(messages[0].content, /本轮eventId/);
  assert.match(messages[0].content, /已完成奖励由引擎发放一次/);
});

test('provider preserves a complete event proposal and excludes reasoning from JSON', async () => {
  const session = createSession({ mode: 'ai' }), proposal = demoOpening(session);
  let request;
  const agent = createNarrativeAgent({ SYSTEM_STORY_API_KEY: 'private-test-token', SYSTEM_STORY_BASE_URL: 'https://model.test/v1', SYSTEM_STORY_MODEL: 'x-ai/grok-test' }, { fetch: async (url, options) => {
    request = { url, body: JSON.parse(options.body), headers: options.headers };
    return new Response(JSON.stringify({ choices: [{ message: { content: '<think>内部推演</think>\n```json\n' + JSON.stringify(proposal) + '\n```' } }] }));
  } });
  assert.deepEqual(await agent.generate(session), proposal);
  assert.equal(request.url, 'https://model.test/v1/chat/completions');
  assert.equal(request.body.response_format.type, 'json_object');
  assert.deepEqual(request.body.reasoning, { effort: 'low', exclude: true });
  assert.equal(agent.publicConfig.configured, true);
  assert.ok(!JSON.stringify(agent.publicConfig).includes('private-test-token'));
});

test('malformed, missing or oversized model prose fails without invented fallback', () => {
  for (const content of [undefined, '', '你直接获得了无限积分。', '[]', 'x'.repeat(80001)]) assert.throws(() => parseProposal(content), e => e.status === 502);
});

test('provider failures retain useful errors without exposing credentials', async () => {
  const env = { SYSTEM_STORY_API_KEY: 'private-test-token', SYSTEM_STORY_BASE_URL: 'https://model.test/v1' };
  for (const status of [401, 402, 429]) {
    const agent = createNarrativeAgent(env, { fetch: async () => new Response('{}', { status }) });
    await assert.rejects(agent.generate(createSession()), e => [502, 503].includes(e.status) && !e.message.includes(env.SYSTEM_STORY_API_KEY));
  }
  const timedOut = createNarrativeAgent(env, { fetch: async () => { throw new Error('provider secret'); } });
  await assert.rejects(timedOut.generate(createSession()), e => e.status === 504 && !e.message.includes('provider secret'));
  const unconfigured = createNarrativeAgent({});
  await assert.rejects(unconfigured.generate(createSession()), e => e.status === 503);
});
