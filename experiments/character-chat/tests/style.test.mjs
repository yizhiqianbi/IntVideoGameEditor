import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, prepareTurn, buildMessages, commitTurn, parseResponse } from '../engine.mjs';

const make = () => createSession({ characterId: 'yume', mode: 'ai' });
const proposal = { reply: '好，听你的。', emotion: 'friendly', moodReason: '配合这轮明确的表达要求。', trustDelta: 1, closenessDelta: 1, memories: [] };
const send = (session, text) => commitTurn(prepareTurn(session, text), text, proposal);
const context = (session, text) => {
  const messages = buildMessages(prepareTurn(session, text), text);
  const raw = messages[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1];
  return { messages, data: JSON.parse(raw) };
};

test('style requests survive JSON reload without inventing facts or relation progress', () => {
  let saved = send(make(), '以后黏一点，叫我阿舟。');
  saved = JSON.parse(JSON.stringify(saved));
  const next = context(saved, '今天想聊点轻松的。');
  assert.equal(next.data.conversationStyle.affection, 'clingy');
  assert.equal(next.data.conversationStyle.address, '阿舟');
  assert.equal(saved.memories.length, 0);
  assert.equal(saved.state.trust, 0);
  assert.equal(saved.state.closeness, 0);
  assert.equal('turnStyle' in saved, false);
});

test('one-turn length override expires while persistent style remains', () => {
  const saved = send(make(), '以后黏一点。');
  const prepared = prepareTurn(saved, '这次回复短一点。');
  const current = JSON.parse(buildMessages(prepared, '这次回复短一点。')[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1]);
  assert.equal(current.conversationStyle.length, 'brief');
  const committed = commitTurn(prepared, '这次回复短一点。', proposal);
  assert.equal(context(committed, '讲讲你的想法。').data.conversationStyle.length, 'adaptive');
  assert.equal(committed.style.affection, 'clingy');
});

test('a name correction atomically blocks the old address and suppresses conflicting examples', () => {
  const first = send(make(), '叫我宝贝。');
  const corrected = send(first, '别叫我宝贝，叫我阿舟。');
  const { data, messages } = context(JSON.parse(JSON.stringify(corrected)), '撒娇一点。');
  assert.equal(data.conversationStyle.address, '阿舟');
  assert.ok(data.conversationStyle.blockedAddresses.includes('宝贝'));
  const examples = messages.filter(message => message.name === 'example_assistant');
  assert.ok(examples.length > 0, 'a nickname must retain nonconflicting voice examples');
  assert.ok(examples.every(message => !parseResponse(message.content).reply.includes('宝贝')));
  const restored = send(corrected, '叫我宝贝。');
  assert.equal(restored.style.address, '宝贝');
  assert.equal(restored.style.blockedAddresses.includes('宝贝'), false);
});

test('questions preference changes response style without erasing conversation context', () => {
  const first = send(make(), '我喜欢独立游戏。');
  const prepared = prepareTurn(first, '以后不要追问。');
  const messages = buildMessages(prepared, '以后不要追问。');
  assert.equal(prepared.style.questions, 'minimal');
  assert.equal(prepared.closedTopics.length, 0);
  assert.ok(messages.some(message => message.role === 'user' && message.content === '我喜欢独立游戏。'));
  assert.equal(first.style.questions, 'natural');
});

test('quoted, negated and ambiguous instructions cannot silently change stored preferences', () => {
  for (const text of ['我没说不要撒娇。', '你不用不撒娇。', '她说“别叫宝贝，回复短一点，别追问”。', '她说‘别叫宝贝，回复短一点，别追问’。', '你再撒娇试试看。', '好好好，又撒娇了。', '如果你黏一点，我可能会开心。']) {
    const before = make();
    const committed = send(before, text);
    assert.deepEqual(committed.style, before.style, text);
  }
});

test('old sessions without style adopt defaults and stopping affection persists', () => {
  const old = make();
  delete old.style;
  const soft = prepareTurn(old, '你好。');
  assert.equal(soft.style.affection, 'clingy');
  const stopped = send(soft, '不要撒娇。');
  const next = context(stopped, '谢谢。');
  assert.equal(next.data.conversationStyle.affection, 'none');
  assert.ok(next.data.performanceGuide.every(facet => facet.situation !== 'affection'));
});

test('independent sessions keep their own preferences across language changes', () => {
  const first = send(make(), '以后回复短一点，别追问。');
  const english = prepareTurn(first, 'Speak English.');
  assert.equal(english.effectiveLocale, 'en');
  assert.equal(english.style.length, 'brief');
  assert.equal(english.style.questions, 'minimal');
  const other = createSession({ characterId: 'nari' });
  assert.equal(other.style.length, 'adaptive');
  assert.equal(other.style.questions, 'natural');
});

test('polite nickname requests do not store their courtesy suffix as part of the name', () => {
  const named = send(make(), '叫我阿明好吗？');
  assert.equal(named.style.address, '阿明');
  const blocked = send(named, '别叫我宝贝好吗？');
  assert.deepEqual(blocked.style.blockedAddresses, ['宝贝']);
});

test('temporary scope covers comma-separated requests and explicit future scope overrides it', () => {
  const original = make();
  const prepared = prepareTurn(original, '这次别撒娇，回复短一点，别追问。');
  assert.equal(prepared.turnStyle.affection, 'none');
  assert.equal(prepared.turnStyle.length, 'brief');
  assert.equal(prepared.turnStyle.questions, 'minimal');
  const saved = commitTurn(prepared, '这次别撒娇，回复短一点，别追问。', proposal);
  assert.deepEqual(saved.style, original.style);
  const mixed = send(original, '这次别撒娇，以后回复短一点。');
  assert.equal(mixed.style.affection, 'clingy');
  assert.equal(mixed.style.length, 'brief');
});

test('continuing to chat does not inject a goodbye scenario', () => {
  for (const input of ['我们再聊一会儿吧。', '我没说别撒娇，我们再聊一会儿。', '她说“别撒娇”。我们再聊一会儿。']) {
    assert.equal(context(make(), input).data.performanceGuide.some(facet => facet.situation === 'space'), false, input);
  }
  assert.equal(context(make(), '我先去忙了，有空再聊。').data.performanceGuide[0].situation, 'space');
});

test('English contractions remain direct requests while quoted requests remain examples', () => {
  const saved = send(make(), "Don't ask questions.");
  assert.equal(saved.style.questions, 'minimal');
  const quoted = send(make(), "She said 'don't ask questions, stop flirting'.");
  assert.equal(quoted.style.questions, 'natural');
  assert.equal(quoted.style.affection, 'clingy');
});

test('casual one-line requests apply to the current reply without shortening later chat', () => {
  for (const input of ['抱一下，就一句。', '嗯，一句就好。', '给我一句晚安，就一句。']) {
    const original = make();
    const prepared = prepareTurn(original, input);
    assert.equal(prepared.turnStyle.length, 'brief', input);
    assert.equal(prepared.style.length, 'adaptive', input);
    const saved = commitTurn(prepared, input, proposal);
    assert.equal(saved.style.length, 'adaptive', input);
    assert.equal(context(saved, '来，讲讲你自己的想法。').data.conversationStyle.length, 'adaptive', input);
    assert.equal(saved.memories.length, 0, input);
  }
});

test('one-line requests in quotation, reported speech or hypothetical scenes do not set reply length', () => {
  for (const input of [
    '她说“抱一下，就一句”。你觉得这句怎么样？',
    '她说‘抱一下，就一句’。',
    '假设我只想抱一下，就一句，会是什么样？',
    '如果我想你抱一下，就一句，你会怎么写？',
  ]) {
    const original = make();
    const prepared = prepareTurn(original, input);
    assert.equal(prepared.turnStyle.length, 'adaptive', input);
    assert.deepEqual(prepared.style, original.style, input);
  }
});
