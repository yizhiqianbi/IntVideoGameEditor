import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createSession, prepareTurn, parseResponse, commitTurn,
  initiativeEligibility, commitInitiative, setInitiative, buildInitiativeMessages,
  rearmInitiative, INITIATIVE_BUDGET, INITIATIVE_TTL_MS, INITIATIVE_QUESTION_GRACE_MS,
} from '../engine.mjs';

const NOW = '2026-10-07T08:00:00.000Z';
const READY = '2026-10-07T08:00:13.000Z';
const make = () => createSession({ characterId: 'yume', mode: 'ai', now: NOW });
const proposal = (messages = ['好，我在听。']) => ({ messages, emotion: 'friendly' });
const send = (current, text, messages = ['好，我在听。']) => commitTurn(
  prepareTurn(current, text, { now: NOW }), text,
  parseResponse(proposal(messages), { currentUserText: text }), { requestId: randomUUID(), now: NOW },
);
const eligible = () => send(make(), '我们聊点轻松的。');

test('message-array response preserves independently authored bubbles and legacy aggregate', () => {
  const messages = ['等一下，我刚想到一个点子。', '把周末安排得松一点，好像也不错。', '这次不急着做决定。'];
  const parsed = parseResponse({ messages, reply: 'obsolete legacy fallback', emotion: 'playful' });
  assert.deepEqual(parsed.messages, messages);
  for (const part of messages) assert.ok(parsed.reply.includes(part));
  assert.equal(parsed.reply.includes('obsolete legacy fallback'), false);
  assert.deepEqual(parseResponse({ reply: '原有单条回复也能读。', emotion: 'calm' }).messages, ['原有单条回复也能读。']);
});

test('foreground bubbles reject empty, oversized, non-string or more than three parts', () => {
  for (const messages of [[], [''], [' '.repeat(2)], ['字'.repeat(601)], ['第一句', null], ['一', '二', '三', '四']]) {
    assert.throws(() => parseResponse({ messages, emotion: 'calm' }), (error) => error.status === 502, JSON.stringify(messages));
  }
  const skipped = parseResponse({ messages: [], emotion: 'calm' }, { allowEmpty: true });
  assert.deepEqual(skipped.messages, []);
  assert.equal(skipped.reply, '');
});

test('three bubbles commit one turn, one memory event and one relationship event', () => {
  const current = make();
  const text = '我理解你。我喜欢羽毛球。';
  const parts = ['嗯，这句话我听进去了。', '羽毛球，我记住了。', '我们慢慢聊就好。'];
  const saved = send(current, text, parts);
  const added = saved.messages.slice(current.messages.length);
  const user = added[0];
  const assistants = added.slice(1);
  assert.equal(saved.revision, 1);
  assert.equal(saved.receipts.length, 1);
  assert.equal(added.length, 4);
  assert.equal(user.role, 'user');
  assert.deepEqual(assistants.map(message => message.text), parts);
  assert.ok(assistants.every(message => message.role === 'assistant'));
  assert.ok(added.every(message => typeof message.turnId === 'string' && message.turnId));
  assert.equal(new Set(added.map(message => message.turnId)).size, 1);
  assert.equal(new Set(added.map(message => message.id)).size, 4);
  assert.deepEqual(assistants.map(message => message.partIndex), [0, 1, 2]);
  assert.ok(assistants.every(message => message.partCount === 3));
  assert.equal(saved.memories.length, 1);
  assert.equal(saved.memories[0].messageId, user.id);
  assert.equal(saved.state.trust, 1);
  assert.equal(saved.state.closeness, 1);
  assert.equal(current.messages.length, 1);
});

test('initiative is enabled by default and an opening can anchor a due plan', () => {
  const current = make();
  assert.equal(current.initiative.enabled, true);
  assert.equal(initiativeEligibility(current, { now: READY }).eligible, true);
  assert.equal(initiativeEligibility(current, { now: READY }).anchorId, current.messages[0].id);
  assert.equal(initiativeEligibility(current, { now: NOW }).reason, 'waiting');
  assert.equal(buildInitiativeMessages(current, { now: READY }).some(message => message.role === 'user'), false);
});

test('old stored sessions without initiative metadata adopt compatible defaults', () => {
  const current = eligible();
  delete current.initiative;
  assert.equal(initiativeEligibility(current, { now: READY }).eligible, true);
  const saved = send(current, '我们接着聊。');
  assert.equal(saved.initiative.enabled, true);
});

test('initiative waits at least twelve seconds after the latest assistant reply', () => {
  const current = eligible();
  const waiting = initiativeEligibility(current, { now: '2026-10-07T08:00:11.999Z' });
  assert.equal(waiting.eligible, false);
  assert.equal(waiting.reason, 'waiting');
  assert.ok(waiting.waitMs > 0);
  const ready = initiativeEligibility(current, { now: '2026-10-07T08:00:12.000Z' });
  assert.equal(ready.eligible, true);
  assert.equal(ready.anchorId, current.messages.findLast(message => message.role === 'user').id);
});

test('an unanswered question gets one delayed grace check-in, then waits for the user', () => {
  const current = send(make(), '你是谁？', ['我是 Yume。你叫什么？']);
  const grace = initiativeEligibility(current, { now: READY });
  assert.equal(grace.eligible, false);
  assert.equal(grace.reason, 'waiting');
  assert.equal(grace.waitMs, INITIATIVE_QUESTION_GRACE_MS - 13000, 'a question should leave a longer breathing space');
  assert.equal(Date.parse(current.initiative.pending.notBefore) - Date.parse(NOW), INITIATIVE_QUESTION_GRACE_MS);
  const prompt = buildInitiativeMessages(current, { now: current.initiative.pending.notBefore }).at(-1).content;
  assert.match(prompt, /刚才是不是忙着呀/);
  assert.match(prompt, /不要说“你怎么不理我”/);

  const dueAt = new Date(Date.parse(current.initiative.pending.notBefore) + 1).toISOString();
  assert.equal(initiativeEligibility(current, { now: dueAt }).eligible, true);
  const nudged = commitInitiative(current, {
    messages: ['怎么啦？我还在呀。'], emotion: 'friendly',
    followUp: { intent: '等你有空再接着聊', delaySeconds: 60 },
  }, { requestId: randomUUID(), now: dueAt });
  assert.equal(nudged.initiative.noReplyNudgeUsed, true);
  const afterNudge = initiativeEligibility(nudged, { now: new Date(Date.parse(nudged.initiative.pending.notBefore) + 1).toISOString() });
  assert.equal(afterNudge.eligible, false);
  assert.equal(afterNudge.reason, 'awaiting-user-reply');
});

test('a quiet user after a complete character statement can receive a light initiative nudge', () => {
  const current = send(make(), '我今天有点累。', ['那就先歇一会儿，我在这儿。']);
  const result = initiativeEligibility(current, { now: READY });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'ready');
  assert.ok(buildInitiativeMessages(current, { now: READY }).some(message => message.role === 'system'));
});

test('initiative appends assistant bubbles without invented user facts or relationship progress', () => {
  const current = send(make(), '我理解你。');
  const requestId = randomUUID();
  const parts = ['我刚想到一个轻松的小话题。', '你有空的时候再接着说就好。'];
  const saved = commitInitiative(current, {
    messages: parts, emotion: 'playful', moodReason: '一个跟进想法', trustDelta: 1, closenessDelta: 1,
    memories: [{ text: '我住在上海', quote: '我住在上海', category: 'profile' }], summary: '不要采用的模型摘要。',
  }, { requestId, now: READY });
  const added = saved.messages.slice(current.messages.length);
  assert.deepEqual(added.map(message => message.text), parts);
  assert.ok(added.every(message => message.role === 'assistant' && message.kind === 'initiative'));
  assert.equal(saved.messages.filter(message => message.role === 'user').length, current.messages.filter(message => message.role === 'user').length);
  assert.equal(new Set(added.map(message => message.turnId)).size, 1);
  assert.deepEqual(added.map(message => message.partIndex), [0, 1]);
  assert.ok(added.every(message => message.partCount === 2));
  assert.deepEqual(saved.memories, current.memories);
  assert.deepEqual(saved.style, current.style);
  assert.equal(saved.state.trust, current.state.trust);
  assert.equal(saved.state.closeness, current.state.closeness);
  assert.equal(saved.state.relationship, current.state.relationship);
  assert.equal(saved.summary, current.summary);
  assert.equal(saved.revision, current.revision + 1);
  assert.ok(saved.receipts.some(receipt => receipt.requestId === requestId && receipt.revision === saved.revision));
  assert.equal(saved.initiative.budgetUsed, 1);
  assert.notEqual(saved.initiative.pending.id, current.initiative.pending.id);
  assert.equal(initiativeEligibility(saved, { now: '2026-10-07T08:01:00.000Z' }).eligible, true);
});

test('a later user turn creates a new eligible initiative anchor', () => {
  const current = eligible();
  const initiated = commitInitiative(current, proposal(), { requestId: randomUUID(), now: READY });
  const text = '我想到一个新的周末安排。';
  const at = '2026-10-07T08:00:30.000Z';
  const resumed = commitTurn(prepareTurn(initiated, text, { now: at }), text, proposal(), { requestId: randomUUID(), now: at });
  const ready = initiativeEligibility(resumed, { now: '2026-10-07T08:00:43.000Z' });
  assert.equal(ready.eligible, true);
  assert.equal(ready.anchorId, resumed.messages.findLast(message => message.role === 'user').id);
});

test('choosing silence consumes one plan budget without appending messages', () => {
  const current = eligible();
  const saved = commitInitiative(current, proposal([]), { requestId: randomUUID(), now: READY });
  assert.deepEqual(saved.messages, current.messages);
  assert.deepEqual(saved.memories, current.memories);
  assert.deepEqual(saved.state, current.state);
  assert.equal(saved.revision, current.revision + 1);
  assert.equal(saved.initiative.budgetUsed, 1);
  assert.equal(initiativeEligibility(saved, { now: READY }).reason, 'waiting');
  assert.notEqual(saved.initiative.pending.id, current.initiative.pending.id);
});

test('goodbye, going away and requests not to initiate pause until a new user turn', () => {
  for (const text of ['再见。', '我先去忙了，有空再聊。', '别主动发消息。']) {
    const paused = send(make(), text);
    assert.equal(initiativeEligibility(paused, { now: READY }).eligible, false, text);
    assert.equal(initiativeEligibility(paused, { now: READY }).reason, 'paused', text);
    const resumed = send(paused, '我回来了，我们接着聊。');
    assert.equal(initiativeEligibility(resumed, { now: READY }).eligible, true, text);
  }
});

test('quoted goodbye text does not count as the user ending the conversation', () => {
  const current = send(make(), '故事里的她说“再见”，你觉得这个结尾怎么样？');
  assert.equal(initiativeEligibility(current, { now: READY }).eligible, true);
});

test('direct rest and goodnight closings pause initiative until the user returns', () => {
  for (const text of ['我先去睡了。', '我先睡了。', '我先躺一会儿。', '我去休息了。', '晚安。', '睡啦。', 'Goodnight.']) {
    const paused = send(make(), text);
    assert.equal(initiativeEligibility(paused, { now: READY }).reason, 'paused', text);
    const resumed = send(paused, '我回来了，接着聊吧。');
    assert.equal(initiativeEligibility(resumed, { now: READY }).eligible, true, text);
  }
});

test('listening, requesting a farewell phrase and hypothetical rest do not pause initiative', () => {
  for (const text of [
    '我躺着听你讲。', '给我一句晚安。', '假设我先去睡了，你会怎么接这个故事？',
    '如果我说晚安，你会怎么回答？', '她说“晚安”，你觉得这个结尾怎么样？',
    'I want you to say goodnight.', 'She said "goodnight".',
  ]) {
    const current = send(make(), text);
    assert.equal(initiativeEligibility(current, { now: READY }).eligible, true, text);
  }
});

test('initiative preference can be disabled and restored without dropping other settings', () => {
  const current = eligible();
  const off = setInitiative(current, false, { now: READY });
  assert.equal(off.revision, current.revision + 1);
  assert.equal(initiativeEligibility(off, { now: READY }).reason, 'disabled');
  assert.deepEqual(off.style, current.style);
  assert.equal(off.locale, current.locale);
  const laterUser = send(off, '我们接着聊。');
  assert.equal(initiativeEligibility(laterUser, { now: READY }).reason, 'disabled');
  const on = setInitiative(off, true, { now: READY });
  assert.equal(initiativeEligibility(on, { now: READY }).reason, 'waiting');
  assert.equal(initiativeEligibility(on, { now: '2026-10-07T08:00:25.000Z' }).eligible, true);
  assert.throws(() => setInitiative(current, 'false'), (error) => error.status === 400);
});

test('initiative prompt includes actual history without inventing a user turn', () => {
  const current = eligible();
  const messages = buildInitiativeMessages(current, { now: READY });
  const actual = current.messages.filter(message => message.role === 'user').map(message => message.text);
  const modelUsers = messages.filter(message => message.role === 'user').map(message => message.content);
  assert.ok(messages.some(message => message.role === 'system'));
  assert.ok(modelUsers.length > 0);
  assert.ok(modelUsers.every(text => actual.includes(text)));
  assert.ok(modelUsers.length <= actual.length);
  assert.deepEqual(current.messages.filter(message => message.role === 'user').map(message => message.text), actual);
});

const beat = { focus: '还想把刚才那句说完', feeling: '有一点开心', want: '再靠近一点聊' };
const followUp = { intent: '补一个自己刚想到的小心思', delaySeconds: 20 };
const due = current => new Date(Date.parse(current.initiative.pending.notBefore) + 1).toISOString();

test('beat and follow-up metadata round-trip with limits while old replies remain readable', () => {
  const parsed = parseResponse({ messages: ['欸。'], emotion: 'playful', beat, followUp });
  assert.deepEqual(parsed.beat, beat);
  assert.deepEqual(parsed.followUp, followUp);
  assert.deepEqual(parseResponse(parsed).beat, beat);
  assert.equal(parseResponse({ messages: ['嗯。'], followUp: null }).followUp, null);
  assert.equal(Object.hasOwn(parseResponse({ reply: '旧回复。' }), 'beat'), false);
  assert.equal(parseResponse({ messages: ['嗯。'], followUp: { ...followUp, delaySeconds: -5 } }).followUp.delaySeconds, 12);
  assert.equal(parseResponse({ messages: ['嗯。'], followUp: { ...followUp, delaySeconds: 500 } }).followUp.delaySeconds, 120);
  for (const invalid of [[], {}, false, 'not-a-character-state', { ...beat, want: '' }, { ...beat, focus: '字'.repeat(121) }, { focus: '只有一项' }]) {
    assert.throws(() => parseResponse({ messages: ['嗯。'], beat: invalid }), error => error.status === 502);
  }
  for (const invalid of [[], {}, { ...followUp, intent: '' }, { ...followUp, intent: '字'.repeat(141) }, { ...followUp, delaySeconds: '20' }, { ...followUp, delaySeconds: Infinity }]) {
    assert.throws(() => parseResponse({ messages: ['嗯。'], followUp: invalid }), error => error.status === 502);
  }
});

test('character beat remains attributed fictional state and never becomes a user fact', () => {
  const current = make();
  const text = '叫我阿舟。我喜欢喝乌龙茶。';
  const saved = commitTurn(prepareTurn(current, text, { now: NOW }), text,
    { messages: ['阿舟。', '好，我记住这两点了。'], emotion: 'playful', beat, followUp }, { requestId: randomUUID(), now: NOW });
  assert.equal(saved.characterBeat.scope, 'fictional-character');
  for (const key of ['focus', 'feeling', 'want']) assert.equal(saved.characterBeat[key], beat[key]);
  assert.equal(saved.characterBeat.updatedAt, NOW);
  assert.equal(saved.characterBeat.sourceMessageId, saved.messages.at(-1).id);
  assert.equal(saved.messages.find(message => message.id === saved.characterBeat.sourceMessageId).role, 'assistant');
  assert.ok(saved.memories.every(memory => saved.messages.find(message => message.id === memory.messageId)?.role === 'user'));
  assert.equal(saved.memories.some(memory => memory.text.includes(beat.want) || memory.text.includes(beat.focus)), false);
  assert.equal(saved.style.address, '阿舟');
  const messages = buildInitiativeMessages(saved, { now: due(saved) });
  assert.ok(JSON.stringify(messages).includes(beat.focus));
  assert.equal(messages.filter(message => message.role === 'user').some(message => message.content.includes(beat.focus)), false);
  const silence = commitInitiative(saved, { messages: [], emotion: 'hurt', beat: { ...beat, feeling: '不应写入的变化' }, followUp: null }, { now: due(saved), requestId: randomUUID() });
  assert.deepEqual(silence.characterBeat, saved.characterBeat);
  assert.deepEqual(silence.memories, saved.memories);
  assert.deepEqual(silence.state, saved.state);
});

test('active chains are bounded to three model attempts including silent attempts', () => {
  let current = eligible();
  for (let index = 0; index < INITIATIVE_BUDGET; index += 1) {
    const oldPlanId = current.initiative.pending.id;
    const at = due(current);
    current = commitInitiative(current, { messages: index === 1 ? [] : [`自己的第 ${index + 1} 个小想法。`], emotion: 'playful', followUp }, { now: at, requestId: randomUUID() });
    assert.equal(current.initiative.budgetUsed, index + 1);
    assert.equal(current.receipts.at(-1).planId, oldPlanId);
    if (index + 1 < INITIATIVE_BUDGET) {
      assert.notEqual(current.initiative.pending.id, oldPlanId);
      assert.ok(Date.parse(current.initiative.pending.notBefore) - Date.parse(at) >= 35000);
    }
  }
  assert.equal(current.initiative.pending, null);
  assert.equal(initiativeEligibility(current, { now: '2026-10-07T09:00:00.000Z' }).reason, 'budget');
  assert.throws(() => commitInitiative(current, proposal(), { now: '2026-10-07T09:00:00.000Z' }), error => error.status === 409);
  assert.deepEqual(rearmInitiative(current, { now: '2026-10-07T09:00:00.000Z', force: true }), current);
});

test('explicit followUp null stops the active chain and a new user creates a fresh plan', () => {
  const current = eligible();
  const stopped = commitInitiative(current, { messages: ['说完啦。'], emotion: 'calm', followUp: null }, { now: READY, requestId: randomUUID() });
  assert.equal(stopped.initiative.pending, null);
  assert.equal(stopped.initiative.budgetUsed, 1);
  assert.equal(initiativeEligibility(stopped, { now: READY }).reason, 'no-plan');
  const resumed = send(stopped, '来，聊点新的。');
  assert.equal(resumed.initiative.budgetUsed, 0);
  assert.ok(resumed.initiative.pending);
  assert.notEqual(resumed.initiative.anchorId, stopped.initiative.anchorId);
});

test('expired intents cannot execute and rearming replaces the intent without resetting spent budget', () => {
  const current = commitInitiative(eligible(), { messages: ['第一个自己的小想法。'], emotion: 'playful', followUp }, { now: READY, requestId: randomUUID() });
  const expiredAt = new Date(Date.parse(current.initiative.pending.createdAt) + INITIATIVE_TTL_MS).toISOString();
  assert.equal(initiativeEligibility(current, { now: expiredAt }).reason, 'expired');
  assert.throws(() => commitInitiative(current, proposal(), { now: expiredAt }), error => error.status === 409);
  const renewed = rearmInitiative(current, { now: expiredAt });
  assert.equal(renewed.revision, current.revision + 1);
  assert.equal(renewed.initiative.budgetUsed, 1);
  assert.notEqual(renewed.initiative.pending.id, current.initiative.pending.id);
  assert.notEqual(renewed.initiative.pending.intent, followUp.intent);
  assert.equal(initiativeEligibility(renewed, { now: expiredAt }).reason, 'waiting');
  assert.equal(initiativeEligibility(renewed, { now: due(renewed) }).eligible, true);
  assert.deepEqual(rearmInitiative(renewed, { now: expiredAt }), renewed, 'a fresh plan is a no-op');
  assert.deepEqual(renewed.memories, current.memories);
  assert.deepEqual(renewed.characterBeat, current.characterBeat);
});

test('new user input replaces a pending plan and resets budget exactly once', () => {
  const current = commitInitiative(eligible(), { messages: ['刚才的一个想法。'], emotion: 'playful', followUp }, { now: READY, requestId: randomUUID() });
  const oldPlan = structuredClone(current.initiative.pending);
  const resumed = send(current, '现在聊这个新的话题。');
  assert.equal(resumed.initiative.budgetUsed, 0);
  assert.notEqual(resumed.initiative.pending.id, oldPlan.id);
  assert.notEqual(resumed.initiative.pending.intent, oldPlan.intent);
  assert.equal(resumed.initiative.lastAnchor, null);
  assert.equal(resumed.revision, current.revision + 1);
});

test('quiet and disabled sessions cannot be rearmed even after expiry or force', () => {
  const at = '2026-10-07T09:00:00.000Z';
  for (const current of [send(make(), '我先去睡了。'), setInitiative(eligible(), false, { now: NOW })]) {
    const renewed = rearmInitiative(current, { now: at, force: true });
    assert.deepEqual(renewed, current);
    assert.equal(renewed.initiative.pending, null);
    assert.equal(initiativeEligibility(renewed, { now: at }).eligible, false);
  }
});

test('legacy initiative records retain already-spent turns instead of granting a new full budget', () => {
  let current = eligible();
  for (let index = 0; index < INITIATIVE_BUDGET; index += 1) current = commitInitiative(current, { messages: [`第 ${index} 条旧主动消息。`], emotion: 'friendly' }, { requestId: randomUUID(), now: due(current) });
  current.initiative = { enabled: true, lastAnchor: current.initiative.anchorId, lastAt: current.updatedAt, pausedUntilUser: false };
  const first = initiativeEligibility(current, { now: '2026-10-07T09:00:00.000Z' });
  assert.equal(first.reason, 'budget');
  assert.deepEqual(initiativeEligibility(current, { now: '2026-10-07T09:00:00.000Z' }), first);
  const migrated = rearmInitiative(current, { now: '2026-10-07T09:00:00.000Z' });
  assert.equal(migrated.initiative.budgetUsed, INITIATIVE_BUDGET);
  assert.equal(migrated.initiative.pending, null);
  assert.equal(migrated.revision, current.revision);
  assert.deepEqual(migrated.messages, current.messages);
  assert.deepEqual(migrated.memories, current.memories);
});

const writingBeat = { focus: '商业课笔记最后两行还没写完', feeling: '有点想偷懒', want: '把最后两行写完' };
function respondWithBeat(current, input, nextBeat, parts = ['欸，听到了。']) {
  return commitTurn(prepareTurn(current, input, { now: NOW }), input,
    { messages: parts, emotion: 'playful', ...(nextBeat ? { beat: nextBeat } : {}) }, { requestId: randomUUID(), now: NOW });
}

test('runtime ages a repeated focus once per nonempty turn regardless of model age or changed wording', () => {
  let current = respondWithBeat(make(), '来啦。', { ...writingBeat, age: 900, sourceMessageId: 'forged-model-source' });
  assert.equal(current.characterBeat.age, 0, 'a new focus starts a runtime-owned lifetime');
  current = respondWithBeat(current, '嘿嘿。', { ...writingBeat, focus: '商业课的笔记最后两行还没写完', feeling: '有点开心', want: '等一会儿再写两行', age: 0 }, ['嗯哼。', '听见啦。', '让我开心一下。']);
  assert.equal(current.characterBeat.age, 1, 'three bubbles are still one committed turn');
  assert.equal(current.characterBeat.sourceMessageId, current.messages.at(-1).id);
  assert.notEqual(current.characterBeat.sourceMessageId, 'forged-model-source');
  current = respondWithBeat(current, '然后呢？', { ...writingBeat, feeling: '偷偷得意', want: '先把笔放下', age: 0 });
  assert.equal(current.characterBeat.age, 2, 'changing only feeling or want cannot rejuvenate an old focus');
  const prepared = prepareTurn(current, '接着讲。', { now: NOW });
  const data = JSON.parse(buildInitiativeMessages(prepared, { now: READY })[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1]);
  assert.equal(data.characterBeat.age, 2);
});

test('a stagnant focus retires and cannot be reseeded by a superficial paraphrase', () => {
  let current = respondWithBeat(make(), '来啦。', writingBeat);
  for (const input of ['嘿嘿。', '然后呢？', '嗯，听着。']) current = respondWithBeat(current, input, { ...writingBeat, age: 0 });
  assert.equal(current.characterBeat, null);
  const archived = current.characterBeatArchive.find(item => item.focus === writingBeat.focus);
  assert.ok(archived);
  assert.equal(archived.status, 'retired');
  assert.equal(archived.scope, 'fictional-character');
  assert.equal(current.messages.find(message => message.id === archived.sourceMessageId)?.role, 'assistant');
  const recycled = respondWithBeat(current, '再聊一会儿。', { ...writingBeat, focus: '商业课的笔记最后两行还没写完', feeling: '心情不一样了', want: '继续聊', age: 0 });
  assert.equal(recycled.characterBeat, null, 'a new age field or minor paraphrase must not restart the retired beat');
  const different = respondWithBeat(recycled, '说点新的。', { focus: '想把新买的明信片挂到墙上', feeling: '有点期待', want: '先挑一个角落' });
  assert.equal(different.characterBeat.focus, '想把新买的明信片挂到墙上');
  assert.equal(different.characterBeat.age, 0);
  assert.equal(different.memories.length, 0);
});

test('silent initiative cannot rejuvenate a beat or change its attributed source', () => {
  let current = respondWithBeat(make(), '来啦。', writingBeat);
  current = respondWithBeat(current, '嘿嘿。', writingBeat);
  const before = structuredClone(current.characterBeat);
  const saved = commitInitiative(current, { messages: [], emotion: 'calm', beat: { ...writingBeat, age: 0, feeling: '不应被采纳' } }, { now: due(current), requestId: randomUUID() });
  assert.deepEqual(saved.characterBeat, before);
  assert.deepEqual(saved.characterBeatArchive, current.characterBeatArchive);
  assert.equal(saved.initiative.budgetUsed, 1);
});

test('omitting optional beat metadata cannot keep an unchanged background focus alive indefinitely', () => {
  let current = respondWithBeat(make(), '来啦。', writingBeat);
  const source = current.characterBeat.sourceMessageId;
  current = respondWithBeat(current, '嗯，我在听。');
  assert.equal(current.characterBeat.age, 1);
  assert.equal(current.characterBeat.sourceMessageId, source, 'the unchanged fictional state keeps its actual original source');
  current = respondWithBeat(current, '再说点。');
  assert.equal(current.characterBeat.age, 2);
  current = respondWithBeat(current, '嘿嘿。');
  assert.equal(current.characterBeat, null);
  assert.equal(current.characterBeatArchive.find(item => item.focus === writingBeat.focus)?.status, 'retired');
});

test('closing a topic archives its beat and prevents the model from bringing it into active context again', () => {
  const current = respondWithBeat(make(), '来啦。', writingBeat);
  const input = '这个话题算了，别继续。换题。';
  const prepared = prepareTurn(current, input, { now: NOW });
  assert.equal(prepared.characterBeat, null);
  assert.equal(prepared.initiative.pending, null);
  assert.equal(prepared.characterBeatArchive.find(item => item.focus === writingBeat.focus)?.status, 'closed');
  const saved = commitTurn(prepared, input, { messages: ['好，换一个。'], emotion: 'friendly', beat: { ...writingBeat, age: 0 } }, { requestId: randomUUID(), now: NOW });
  assert.equal(saved.characterBeat, null);
  const messages = buildInitiativeMessages(saved, { now: due(saved) });
  const data = JSON.parse(messages[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1]);
  assert.equal(data.characterBeat, null);
  assert.equal(saved.memories.length, current.memories.length);
  assert.equal(saved.state.trust, current.state.trust);
  assert.equal(saved.state.closeness, current.state.closeness);
});

test('an explicit user request to revisit a closed subject permits a fresh beat for that subject', () => {
  let current = respondWithBeat(make(), '来啦。', writingBeat);
  current = respondWithBeat(current, '这个话题算了，换题。');
  assert.equal(current.characterBeat, null);
  const reopened = respondWithBeat(current, '我们重新聊商业课笔记最后两行吧。', writingBeat);
  assert.equal(reopened.characterBeat?.focus, writingBeat.focus);
  assert.equal(reopened.characterBeat?.age, 0);
  assert.equal(reopened.memories.length, 0);
});

test('fictional beat archives have a fixed budget and keep assistant attribution', () => {
  const focuses = [
    '商业课笔记最后两行还没写完', '想把新买的明信片挂到墙上', '认真挑明天出门穿哪件外套',
    '练琴时总弹错副歌前的小节', '旧耳机一边又听不见声音了', '窗台上的薄荷忽然发出新叶',
    '洗衣服时袜子总剩单只',
  ];
  let current = make();
  for (const focus of focuses) {
    current = respondWithBeat(current, '来聊一点新的小事。', { focus, feeling: '有点好奇', want: '看看下一步会怎样' });
    assert.equal(current.characterBeat?.focus, focus);
    current = respondWithBeat(current, '这个话题算了，换题。');
  }
  assert.equal(current.characterBeatArchive.length, 6);
  assert.equal(current.characterBeatArchive.some(item => item.focus === focuses[0]), false);
  assert.equal(current.characterBeatArchive.some(item => item.focus === focuses.at(-1)), true);
  assert.ok(current.characterBeatArchive.every(item => item.scope === 'fictional-character' && current.messages.find(message => message.id === item.sourceMessageId)?.role === 'assistant'));
  assert.equal(current.memories.length, 0);
});

test('foreground nullable beat means no new state and cannot clear or rejuvenate the existing background', () => {
  let current = respondWithBeat(make(), '来啦。', writingBeat);
  const source = current.characterBeat.sourceMessageId;
  for (const age of [1, 2]) {
    const input = '嘿嘿，接着聊。';
    const parsed = parseResponse({ messages: ['嗯哼。'], emotion: 'playful', beat: null });
    current = commitTurn(prepareTurn(current, input, { now: NOW }), input, parsed, { requestId: randomUUID(), now: NOW });
    assert.equal(current.characterBeat.focus, writingBeat.focus);
    assert.equal(current.characterBeat.age, age);
    assert.equal(current.characterBeat.sourceMessageId, source);
  }
  const input = '嗯。';
  current = commitTurn(prepareTurn(current, input, { now: NOW }), input,
    { messages: ['听见啦。'], emotion: 'friendly', beat: null }, { requestId: randomUUID(), now: NOW });
  assert.equal(current.characterBeat, null);
  assert.equal(current.characterBeatArchive.find(item => item.focus === writingBeat.focus)?.status, 'retired');
  assert.equal(current.memories.length, 0);
});

test('an empty initiative with nullable beat preserves age, state and source exactly', () => {
  let current = respondWithBeat(make(), '来啦。', writingBeat);
  current = respondWithBeat(current, '嘿嘿。', writingBeat);
  const result = parseResponse({ messages: [], emotion: 'calm', beat: null, followUp: null }, { allowEmpty: true });
  const saved = commitInitiative(current, result, { requestId: randomUUID(), now: due(current) });
  assert.deepEqual(saved.characterBeat, current.characterBeat);
  assert.deepEqual(saved.characterBeatArchive, current.characterBeatArchive);
  assert.deepEqual(saved.state, current.state);
  assert.equal(saved.initiative.budgetUsed, current.initiative.budgetUsed + 1);
});
