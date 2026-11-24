import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, prepareTurn, buildMessages, parseResponse, commitTurn } from '../engine.mjs';

const make = () => createSession({ characterId: 'yume', mode: 'ai' });
const complete = (session, text, reply = '这件事我们接着聊。') => {
  const proposal = parseResponse({ reply, emotion: 'friendly' }, { currentUserText: text });
  return commitTurn(prepareTurn(session, text), text, proposal);
};

test('authored examples are separately attributed and never persisted as actual history', () => {
  const current = make();
  const input = '随便聊点，你来选。';
  const messages = buildMessages(prepareTurn(current, input), input);
  const examples = messages.filter(message => message.name);
  assert.ok(examples.some(message => message.name === 'example_assistant'));
  assert.ok(examples.every(message => message.role === 'system'));
  assert.deepEqual(messages.filter(message => message.role === 'user').map(message => message.content), [input]);
  const saved = complete(current, input);
  assert.equal(saved.messages.length, 3);
  assert.equal(saved.memories.length, 0);
});

test('a sample nickname is excluded until the current user explicitly supplies an address', () => {
  for (const input of ['聊点轻松的。', '别叫我小禾。']) {
    const messages = buildMessages(prepareTurn(make(), input), input);
    assert.ok(messages.filter(message => message.name).every(message => !/阿舟|小禾/u.test(message.content)));
  }
  const named = complete(make(), '叫我阿明。');
  const messages = buildMessages(prepareTurn(named, '叫我阿明，聊点轻松的。'), '叫我阿明，聊点轻松的。');
  assert.ok(messages.some(message => message.name === 'example_assistant' && message.content.includes('阿明')));
  assert.ok(messages.filter(message => message.name).every(message => !message.content.includes('阿舟')));
});

test('minimal generation retains exact sourced identity, preference and future-plan memories', () => {
  const text = '我叫林舟，我喜欢慢节奏独立游戏。我明天要去杭州。';
  const saved = complete(make(), text);
  assert.deepEqual(saved.memories.map(memory => memory.category), ['profile', 'preference', 'plan']);
  for (const memory of saved.memories) {
    const message = saved.messages.find(item => item.id === memory.messageId);
    assert.equal(message.role, 'user');
    assert.ok(text.includes(memory.quote));
    assert.equal(memory.text, memory.quote);
  }
  const moved = complete(complete(saved, '我住在上海。'), '我现在住在杭州。');
  assert.equal(moved.memories.some(memory => memory.category === 'profile' && memory.text.includes('上海')), false);
});

test('local collection rejects mood, completed actions, quoted facts and conversational instructions', () => {
  for (const text of [
    '我今天有点累。', '我今天喝了绿茶。', '我今天参加了会议。', '我今天考试考砸了。', '我今天看见了彩虹。', '我是说你可以撒娇。',
    '我叫你别撒娇。', '我叫朋友来吃饭。', '我叫小王来吃饭。', '叫我阿舟。', '我喜欢你叫我阿舟。', '我姐姐喜欢独立游戏。',
    '她说“我住在上海”。', '如果我住在上海，我明天要去杭州。', '我住在上海吗？',
    'I am tired.', 'She said "I live in Shanghai".', 'Do I like tea?',
  ]) assert.equal(complete(make(), text).memories.length, 0, text);
  assert.equal(complete(make(), 'I like green tea.').memories[0].category, 'preference');
});

test('old conversation context preserves attributed dialogue beyond the recent window', () => {
  let saved = make();
  for (let i = 0; i < 14; i += 1) saved = complete(saved, `讨论片段${i}：给路边的小店起一个名字。`, `我给这个小店取名为「云团${i}」。`);
  assert.equal(saved.summaryKind, 'quoted-history');
  assert.ok(saved.summary.includes('用户 ('));
  assert.ok(saved.summary.includes('角色 ('));
  assert.ok(saved.summary.includes('云团0'));
  assert.ok(saved.summary.length <= 1500);
  assert.equal(saved.memories.length, 0, 'character contributions cannot become user facts');
  saved = complete(saved, '这个话题到此为止，换个话题。');
  assert.equal(saved.summary, '');
  assert.equal(JSON.stringify(buildMessages(prepareTurn(saved, '继续。'), '继续。')).includes('云团0'), false);
});

test('application relation events stay independent of message volume and style instructions', () => {
  let saved = make();
  for (const text of ['你好。', '叫我阿舟。', '以后黏一点。', '她说“我理解你”。', '如果我理解你，关系会更好吗？', '我理解你个头。', '我理解你，才怪。', '抱歉，今天太忙了。']) saved = complete(saved, text);
  assert.equal(saved.state.trust, 0);
  assert.equal(saved.state.closeness, 0);
  saved = complete(saved, '我理解你。');
  assert.equal(saved.state.trust, 1);
  assert.equal(saved.state.closeness, 1);
  saved = complete(saved, '我骗你。');
  assert.equal(saved.state.trust, 0);
  assert.equal(saved.state.closeness, 0);
});

test('calling someone to do something cannot overwrite the previously stated name', () => {
  const named = complete(make(), '我叫阿明。');
  const later = complete(named, '我叫朋友来吃饭。');
  assert.deepEqual(later.memories, named.memories);
});

test('switching topics preserves the just-declined exchange as attributed context', () => {
  const previous = '给饼干取名字叫「会议纪要味」。';
  const saved = complete(make(), '聊点轻松的。', previous);
  const input = '换个话题，不要提游戏。';
  const messages = buildMessages(prepareTurn(saved, input), input);
  const context = JSON.parse(messages[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1]);
  assert.ok(context.justClosedExchange.some(message => message.speaker === 'assistant' && message.text === previous));
  assert.ok(context.performanceGuide.some(facet => facet.situation === 'switch'));
  assert.equal(messages.filter(message => !message.name && message.role === 'assistant').length, 0, 'ended material must not remain the active continuation');
});

test('a named older exchange can be retrieved beyond the rolling excerpt window', () => {
  let saved = complete(make(), '我们给闹钟起名叫「睡过头委员会」。', '这个闹钟名字就叫「睡过头委员会」，听起来很有排面。');
  for (let i = 0; i < 20; i += 1) saved = complete(saved, `聊第${i}个不同的点心。`, `第${i}种点心选红豆口味。`);
  const input = '我们给闹钟起过什么名字？';
  const messages = buildMessages(prepareTurn(saved, input), input);
  const context = JSON.parse(messages[0].content.match(/<context_data>([\s\S]*)<\/context_data>/)[1]);
  assert.ok(context.earlierConversationSummary.text.includes('睡过头委员会'));
  assert.equal(context.earlierConversationSummary.kind, 'quoted-history');
  assert.ok(context.earlierConversationSummary.text.split('\n').every(line => /^(?:用户|角色) \(.+Z\)：/u.test(line)), 'timestamps and quotes retain their attribution');
  const closed = prepareTurn(saved, '别再提闹钟了。');
  const next = JSON.stringify(buildMessages(prepareTurn(complete(closed, '现在聊其他事。'), '聊点轻松的。'), '聊点轻松的。'));
  assert.equal(next.includes('睡过头委员会'), false);
});
