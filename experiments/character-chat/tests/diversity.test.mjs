import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHARACTERS } from '../characters.mjs';
import { createSession, prepareTurn, commitTurn, buildMessages, buildInitiativeMessages, rearmInitiative } from '../engine.mjs';
import { chooseConversationDirection, recentAssistantTurns } from '../conversation-direction.mjs';
import { parseArguments, runEvaluation, REPEATED_INPUT } from '../evaluations/diversity.mjs';

const NOW = '2026-10-11T10:00:00.000Z';
const profile = id => CHARACTERS.find(character => character.id === id);
const make = characterId => createSession({ characterId, mode: 'ai', now: NOW });
const add = (session, input, messages) => commitTurn(prepareTurn(session, input, { now: NOW }), input,
  { messages, emotion: 'friendly' }, { requestId: randomUUID(), now: NOW });
const choose = (session, scope, text = '你自己说点', extra = {}) => chooseConversationDirection({
  profile: profile(session.characterId), session, text, scope, questions: 'natural', ...extra,
});
function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freezeDeep(item); }
  return value;
}

test('renamed Nari scenes stay in the same broad domain and open chat can leave the repeated domain', () => {
  let session = make('nari');
  session = add(session, '你说点自己的想法', ['我想出去散步。', '梧桐下面的风有点凉。']);
  session = add(session, '然后呢', ['出门只带一本薄书。', '树叶的影子落在外套上。']);
  session = add(session, '嗯', ['走走停停也挺好。', '风把叶子推到脚边，好像还舍不得我回去。']);
  const before = structuredClone(session);
  for (const scope of ['open', 'switch', 'initiative']) {
    const direction = choose(session, scope, scope === 'switch' ? '换个话题吧' : '你自己说点');
    assert.ok(direction.recentPatterns.frequentDomains.includes('everyday'), scope);
    assert.notEqual(direction.topic?.domain, 'everyday', `a repeatedly used scene family should be downweighted in ${scope}`);
  }
  const renamed = structuredClone(session);
  renamed.characterBeat = { ...renamed.characterBeat, focus: '一条完全不同名字的新路，换了一棵树' };
  assert.deepEqual(choose(renamed, 'open'), choose(session, 'open'), 'changing beat focus cannot erase actual assistant replies');
  assert.deepEqual(session, before);
});

test('repeated requests for praise lower that speech act without changing character emotion or forcing a topic', () => {
  for (const characterId of ['yume', 'nari']) {
    let session = make(characterId);
    for (const messages of [['再夸我一句嘛。'], ['还没夸我呢，再陪我一下。'], ['那你再夸一下我。']]) session = add(session, '嘿嘿', messages);
    const before = structuredClone(session);
    const direction = choose(session, 'affection', '今天想听你撒娇');
    assert.ok(direction.recentPatterns.repeatedSpeechActs.includes('small-wish'));
    assert.notEqual(direction.speechAct.id, 'small-wish');
    assert.equal(direction.topic, undefined, 'affection may change delivery without an unrelated new subject');
    assert.deepEqual(session, before);
    assert.equal(direction.emotion, undefined);
  }
});

test('a concrete requested subject remains available even after that domain was recently discussed', () => {
  let yume = make('yume');
  yume = add(yume, '聊游戏', ['我更喜欢队友配合好的局。']);
  yume = add(yume, '嗯', ['排位输赢不全是一个人的问题。']);
  const game = choose(yume, 'open', '还想聊竞技游戏里队友配合的打法');
  assert.equal(game.topic.domain, 'play');
  let nari = make('nari');
  nari = add(nari, '说说设计', ['我觉得指路牌让人看得懂比看起来高级更重要。']);
  nari = add(nari, '嗯', ['有些招牌的字体很漂亮，离远一点就认不出来了。']);
  const design = choose(nari, 'switch', '换到设计话题，聊招牌字体和指路');
  assert.equal(design.topic.id, 'design-stance');
  for (const session of [yume, nari]) for (const scope of ['grounded', 'extend']) {
    assert.equal(choose(session, scope, '接着谈刚才的具体内容').topic, undefined, 'a live continuation does not mandate replacing its subject');
  }
});

test('quiet, short, practical and simple arrival scopes suppress optional conversation direction', () => {
  const inputs = { quiet: '你安静陪我就好', brief: '抱一下，只回一句', task: '帮我把我晚点到改得礼貌点', arrival: '来啦' };
  for (const characterId of ['yume', 'nari']) for (const [scope, input] of Object.entries(inputs)) {
    const session = make(characterId);
    assert.equal(choose(session, scope, input), null, `${characterId}: ${scope}`);
  }
});

test('direction is deterministic for the same request and leaves all source data untouched', () => {
  let session = make('yume');
  session = add(session, '我叫林舟，喜欢乌龙茶', ['阿舟，我记下了。']);
  session = add(session, '你讲点', ['我对大家都这样这句话有点意见。']);
  const before = structuredClone(session);
  freezeDeep(session);
  for (const scope of ['open', 'switch', 'choice', 'extend', 'affection', 'initiative', 'grounded']) {
    const first = choose(session, scope);
    assert.deepEqual(choose(session, scope), first, scope);
    assert.deepEqual(choose(session, scope), first, scope);
  }
  assert.deepEqual(session, before, 'memory, relation, style, history, beat and source IDs must not be mutated');
  assert.equal(Object.hasOwn(session, 'conversationDirection'), false);
});

test('real multi-message assistant turns count once and quoted repetitions remain attributable to those turns', () => {
  let session = make('nari');
  const turnTexts = [];
  for (let index = 0; index < 7; index += 1) {
    const messages = [`想法 ${index}`, `补充 ${index}`];
    turnTexts.push(messages.join('\n'));
    session = add(session, `输入 ${index}`, messages);
  }
  const turns = recentAssistantTurns(session);
  assert.equal(turns.length, 6);
  assert.deepEqual(turns.map(turn => turn.text), turnTexts.slice(-6));
  assert.equal(turns.every(turn => turn.parts.length === 2 && turn.messageIds.length === 2), true);
  assert.equal(turns.some(turn => turn.text === session.messages[0].text), false, 'the authored opening is excluded');
  const direction = choose(session, 'open');
  assert.deepEqual(direction.recentPatterns.recentPartCounts, [2, 2, 2]);
  assert.notEqual(direction.cadence.id, 'reaction-and-content', 'a repeated two-part presentation is not actively encouraged again');
  assert.deepEqual(direction.recentPatterns.avoidRephrasing.map(item => item.messageIds), turns.slice(-3).map(turn => turn.messageIds));
});

test('a minimal-question preference prevents the curiosity direction without imposing silence', () => {
  for (const characterId of ['yume', 'nari']) for (const scope of ['open', 'switch', 'extend', 'grounded', 'initiative']) {
    const direction = choose(make(characterId), scope, '你说点', { questions: 'minimal' });
    assert.ok(direction.speechAct.guidance);
    assert.notEqual(direction.speechAct.id, 'curiosity');
  }
});

test('user quotations and authored opening do not count as repeated assistant habits', () => {
  let session = make('nari');
  for (const input of ['你别老说散步和风了', '你之前不是说风吹梧桐叶吗', '你还说带书出门，散步，风很凉']) {
    session = add(session, input, ['这句我听明白了。']);
  }
  const direction = choose(session, 'open', '你自己说点');
  assert.equal(direction.recentPatterns.frequentDomains.includes('everyday'), false);
  assert.equal(direction.recentPatterns.avoidRephrasing.every(item => item.quote === '这句我听明白了。'), true);
});

test('production prompt assembly applies the direction gate and keeps writing hints out of persisted facts', () => {
  const context = messages => JSON.parse(messages[0].content.match(/<context_data>([\s\S]*?)<\/context_data>/u)[1]);
  for (const characterId of ['yume', 'nari']) {
    const session = make(characterId);
    const before = structuredClone(session);
    for (const input of [
      '来啦', '无聊，抱一下，就一句', '安静陪我一下，不用说话', '帮我把“我晚点到”改得礼貌点',
      '如果我们开一家奇怪的小店，你会怎么设计？', '今天组队总甩锅你怎么看？',
      '我搞砸项目很烦', '别讲笑话认真问看法', '帮我算一下3+4',
    ]) {
      assert.equal(context(buildMessages(prepareTurn(session, input, { now: NOW }), input)).conversationDirection, undefined, input);
    }
    const input = '有点无聊，你讲点自己的想法';
    const prepared = prepareTurn(session, input, { now: NOW });
    const data = context(buildMessages(prepared, input));
    assert.ok(['open', 'choice'].includes(data.conversationDirection.scope), 'open-ended own thoughts may be guided as open chat or her choice');
    assert.ok(data.conversationDirection.speechAct.guidance);
    assert.deepEqual(session, before);
    const saved = commitTurn(prepared, input, { messages: ['我对这件事有点自己的想法。'], emotion: 'friendly' }, { requestId: randomUUID(), now: NOW });
    assert.equal(Object.hasOwn(saved, 'conversationDirection'), false);
    assert.deepEqual(saved.memories, before.memories);
    assert.deepEqual(saved.style, before.style);
    assert.equal(saved.state.trust, before.state.trust);
    assert.equal(saved.state.closeness, before.state.closeness);
    assert.deepEqual(saved.messages.filter(message => message.role === 'user').map(message => message.text), [input]);
    const idle = rearmInitiative(session, { now: NOW });
    const idleBefore = structuredClone(idle);
    const initiativeMessages = buildInitiativeMessages(idle, { now: idle.initiative.pending.notBefore });
    assert.equal(context(initiativeMessages).conversationDirection.scope, 'initiative');
    assert.equal(initiativeMessages.some(message => message.role === 'user' && message.name !== 'example_user'), false);
    assert.deepEqual(idle, idleBefore);
  }
});

const KEY = 'synthetic-diversity-evaluation-key';
const environment = { CHARACTER_CHAT_API_KEY: KEY, CHARACTER_CHAT_BASE_URL: 'https://evaluation.example/v1', CHARACTER_CHAT_MODEL: 'x-ai/grok-4.6' };
const mockReply = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages: ['我对这件事有自己的一个想法。'], emotion: 'friendly', followUp: null }), finish_reason: 'stop' } }], usage: { prompt_tokens: 15, completion_tokens: 12 } }), { status: 200 });
const isPlanner = request => new Headers(request.headers).get('X-Title') === 'XUMENG Companion Planner';
const mockPlan = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'reply',
  replyReference: '接住用户最新的邀请，贡献一个具体想法', focus: '当前话题', tone: '轻快自然', avoid: [], memoryIds: [], waitSeconds: 0,
  decisionReason: '用户发来了新的消息' }), finish_reason: 'stop' } }], usage: { prompt_tokens: 10, completion_tokens: 8 } }), { status: 200 });
async function outputPath(t) {
  const directory = await mkdtemp(join(tmpdir(), 'character-diversity-evaluation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'report.json');
}

test('diversity evaluation defaults to a no-call plan and records the new direction module hash', async () => {
  const options = parseArguments([]);
  assert.equal(options.live, false);
  const report = await runEvaluation(options, { fetch: () => { throw new Error('An offline plan must not call a model'); } });
  assert.equal(report.status, 'planned');
  assert.equal(report.actualCalls, 0);
  assert.equal(report.model, null);
  assert.equal(report.plannedTurns, 9);
  assert.equal(report.plannedCalls, 18);
  assert.equal(report.plan.conversation.length, 6);
  assert.equal(report.plan.independentRepeat.runs, 3);
  assert.equal(report.steps.length, 0);
  assert.ok(report.version.files['conversation-direction.mjs']);
  for (const file of ['planner.mjs', 'replyer-context.mjs', 'companion-runtime.mjs']) assert.ok(report.version.files[file]);
  for (const args of [['--character', 'invalid'], ['--out'], ['--unknown']]) assert.throws(() => parseArguments(args), error => error.evaluationCode === 'INVALID_ARGUMENT');
});

test('mocked live diversity evaluation records both stages and truly independent repeated openings', async t => {
  const out = await outputPath(t);
  let requests = 0;
  const report = await runEvaluation(parseArguments(['--live', '--character', 'nari', '--out', out]), { environment,
    fetch: async (_url, request) => {
      requests += 1;
      const body = JSON.parse(request.body);
      assert.deepEqual(body.reasoning, { effort: isPlanner(request) ? 'none' : 'low', exclude: true });
      assert.equal(body.stream, false);
      return isPlanner(request) ? mockPlan() : mockReply();
    },
  });
  assert.equal(requests, 18);
  assert.equal(report.actualCalls, 18);
  assert.deepEqual(report.callsByStage, { planner: 9, replyer: 9 });
  assert.equal(report.steps.every(step => step.calls.map(call => call.stage).join(',') === 'planner,replyer'), true);
  assert.equal(report.steps.every(step => JSON.parse(step.rawContent).messages && !JSON.parse(step.rawContent).action), true);
  assert.equal(report.parametersByStage.planner.reasoning.effort, 'none');
  assert.equal(report.parameters.reasoning.effort, 'low');
  assert.equal(report.status, 'complete');
  assert.equal(report.conversations.length, 4);
  assert.equal(report.conversations[0].finalSession.messages.filter(message => message.role === 'user').length, 6);
  const repeats = report.conversations.filter(conversation => conversation.kind === 'independent-same-input');
  assert.equal(repeats.length, 3);
  assert.equal(new Set(repeats.map(conversation => conversation.initialSession.id)).size, 3);
  for (const conversation of repeats) {
    assert.equal(conversation.initialSession.messages.filter(message => message.role === 'user').length, 0);
    assert.deepEqual(conversation.finalSession.messages.filter(message => message.role === 'user').map(message => message.text), [REPEATED_INPUT]);
  }
  assert.equal(report.steps.every(step => step.rawContent && step.requestBody && step.usage && step.session && Number.isInteger(step.latencyMs)), true);
  const saved = await readFile(out, 'utf8');
  assert.equal(saved.includes(KEY), false);
  assert.equal(saved.includes('Authorization'), false);
  assert.equal(JSON.parse(saved).status, 'complete');
});

test('failed diversity generation saves the raw malformed output and earlier turns with a sanitized error', async t => {
  const out = await outputPath(t);
  let replies = 0;
  await assert.rejects(runEvaluation(parseArguments(['--live', '--out', out]), { environment, fetch: async (_url, request) => {
    if (isPlanner(request)) return mockPlan();
    replies += 1;
    if (replies === 1) return mockReply();
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 15, completion_tokens: 2 } }), { status: 200 });
  } }), error => error.evaluationCode === 'EVALUATION_FAILED' && error.output === out);
  const saved = await readFile(out, 'utf8');
  const report = JSON.parse(saved);
  assert.equal(report.status, 'failed');
  assert.equal(report.actualCalls, 5, 'two Planner calls and three Replyer calls including one format repair');
  assert.deepEqual(report.callsByStage, { planner: 2, replyer: 3 });
  assert.equal(report.steps[0].status, 'complete');
  assert.equal(report.steps[1].status, 'failed');
  assert.equal(report.steps[1].rawContent, '{"messages":[]}');
  assert.deepEqual(report.steps[1].calls.map(call => call.stage), ['planner', 'replyer', 'replyer']);
  assert.ok(report.steps[1].usage);
  assert.equal(saved.includes(KEY), false);
});
