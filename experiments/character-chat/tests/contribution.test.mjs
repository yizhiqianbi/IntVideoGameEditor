import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CHARACTERS } from '../characters.mjs';
import { createSession, prepareTurn, buildMessages, parseResponse, commitTurn, buildInitiativeMessages, initiativeEligibility } from '../engine.mjs';

const NOW = '2026-10-11T08:00:00.000Z';
const make = characterId => createSession({ characterId, mode: 'ai', now: NOW });
function prompt(session, input) {
  const prepared = prepareTurn(session, input, { now: NOW });
  const messages = buildMessages(prepared, input);
  const data = JSON.parse(messages[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1]);
  return { prepared, messages, data };
}

test('open chat selects self-choice, continuation and new-topic writing directions for both characters', () => {
  const cases = [
    ['你自己想做什么？为什么？', 'own-choice'],
    ['如果我现在不说话，你会想做点什么？', 'own-choice'],
    ['嗯', 'extend'], ['然后呢？', 'extend'],
    ['有一点无聊诶', 'fresh-topic'], ['你自己先讲点自己的小事吧。', 'fresh-topic'],
  ];
  for (const characterId of ['yume', 'nari']) for (const [input, kind] of cases) {
    const { data } = prompt(make(characterId), input);
    assert.equal(data.contentContribution?.kind, kind, `${characterId}: ${input}`);
    assert.equal(typeof data.contentContribution.guidance, 'string');
    assert.ok(data.contentContribution.guidance.trim());
    const compiled = data.performanceGuide.filter(facet => facet.situation === 'contribute');
    assert.equal(compiled.length, 1);
    assert.equal(compiled[0].guidance, data.contentContribution.guidance);
  }
});

test('quiet, goodbye, brief replies, simple arrivals and practical tasks take priority over adding chat material', () => {
  const cases = [
    '来啦', '我回来了。', '有点无聊，我先去忙了。', '晚安，我先睡了。',
    '有点无聊，你安静陪我一下就好。', '无聊，抱一下，就一句。',
    '无聊，帮我写一封请假邮件。', '然后呢？帮我翻译这段文字。',
    '你讲点自己的事之前，先帮我改这段代码。',
  ];
  for (const characterId of ['yume', 'nari']) for (const input of cases) {
    const { data } = prompt(make(characterId), input);
    assert.equal(Object.hasOwn(data, 'contentContribution'), false, `${characterId}: ${input}`);
    assert.equal(data.performanceGuide.some(facet => facet.situation === 'contribute'), false, `${characterId}: ${input}`);
  }
});

test('the selected contribution example matches its category and remains authored prompt material only', () => {
  for (const characterId of ['yume', 'nari']) for (const [input, kind] of [['你自己想做什么？', 'own-choice'], ['然后呢？', 'extend'], ['有一点无聊诶', 'fresh-topic']]) {
    const session = make(characterId);
    const before = structuredClone(session);
    const { prepared, messages } = prompt(session, input);
    const authored = CHARACTERS.find(character => character.id === characterId).card.contributionExamples;
    const selected = messages.filter(message => message.name === 'example_assistant').map(message => parseResponse(message.content).messages)
      .map(parts => authored.find(example => JSON.stringify(example.messages ?? [example.assistant]) === JSON.stringify(parts))).filter(Boolean);
    assert.equal(selected.length, 1, `${characterId}: ${kind}`);
    assert.equal(selected[0].kind, kind);
    const actualBoundary = messages.findIndex(message => message.role === 'system' && message.content.includes('[实际会话开始]'));
    assert.ok(messages.findIndex(message => message.name === 'example_assistant') < actualBoundary);
    assert.deepEqual(session, before, 'prompt assembly must not mutate saved conversation data');
    const saved = commitTurn(prepared, input, { messages: ['我想到一点自己的小事。'], emotion: 'friendly' }, { requestId: randomUUID(), now: NOW });
    assert.equal(Object.hasOwn(saved, 'contentContribution'), false);
    assert.equal(saved.memories.length, 0);
    assert.deepEqual(saved.style, before.style);
    assert.equal(saved.state.trust, before.state.trust);
    assert.equal(saved.state.closeness, before.state.closeness);
    assert.deepEqual(saved.messages.filter(message => message.role === 'user').map(message => message.text), [input]);
    assert.equal(prompt(saved, '我去忙了。').data.contentContribution, undefined, 'the writing hint is recalculated, rather than becoming a persistent user preference');
  }
});

test('follow-up guidance permits a new idea after a complete reply while preserving explicit silence and stopping', () => {
  const { prepared, messages } = prompt(make('yume'), '你自己先讲点小事吧。');
  const normalTail = messages.at(-1).content;
  assert.match(normalTail, /(?:说完整|说完|完整回复)[^。\n]{0,40}(?:不等于|不意味着)[^。\n]{0,40}(?:结束|停止)/u);
  assert.match(normalTail, /(?:真正想结束|要求安静|没有值得再说)[^。\n]{0,80}null/u);
  const result = { messages: ['我把那首歌听完了，最喜欢的还是开头。'], emotion: 'friendly', followUp: { intent: '想讲换闹钟时间时一个新想到的小失误', delaySeconds: 35 } };
  const saved = commitTurn(prepared, '你自己先讲点小事吧。', result, { requestId: randomUUID(), now: NOW });
  assert.equal(saved.initiative.pending.intent, result.followUp.intent);
  assert.equal(initiativeEligibility(saved, { now: saved.initiative.pending.notBefore }).eligible, true);
  const proactiveTail = buildInitiativeMessages(saved, { now: saved.initiative.pending.notBefore }).at(-1).content;
  assert.match(proactiveTail, /(?:说完整|说完|完整回复)[^。\n]{0,40}(?:仍可以|仍可|不等于|不意味着)/u);
  assert.match(proactiveTail, /(?:真正想结束|没有值得再说)[^。\n]{0,80}null/u);
  const stopped = commitTurn(prepared, '你自己先讲点小事吧。', { messages: ['这句就说到这里。'], emotion: 'calm', followUp: null }, { requestId: randomUUID(), now: NOW });
  assert.equal(stopped.initiative.pending, null);
});
