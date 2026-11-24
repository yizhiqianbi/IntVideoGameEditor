import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDirectDialogue } from '../dialogue-contract.mjs';
import { createProvider } from '../provider.mjs';
import { createApplication } from '../server.mjs';
import { createSession, prepareTurn, buildMessages, buildInitiativeMessages, parseResponse, commitTurn } from '../engine.mjs';

const NOW = '2026-10-14T02:00:00.000Z';
const READY = '2026-10-14T02:00:13.000Z';
const make = (characterId = 'yume') => createSession({ characterId, mode: 'ai', now: NOW });
const proposal = messages => ({ messages, emotion: 'friendly', followUp: null });
const formatError = error => error.status === 502 && error.code === 'DIALOGUE_FORMAT';
const context = messages => JSON.parse(messages[0].content.match(/<context_data>([\s\S]*)<\/context_data>/u)[1]);

const delta = content => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`;
const stop = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function modelStream(chunks) {
  return new Response(new ReadableStream({ start(controller) {
    const encoder = new TextEncoder();
    for (const chunk of chunks) controller.enqueue(encoder.encode(delta(chunk)));
    controller.enqueue(encoder.encode(stop));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const mockProvider = chunks => createProvider({
  // Isolate the low-level streaming contract; two-stage repair is covered in
  // planner-provider.test.mjs with stage-aware responses.
  CHARACTER_CHAT_PLANNER_ENABLED: 'false',
  CHARACTER_CHAT_API_KEY: 'companion-contract-test-only',
  CHARACTER_CHAT_BASE_URL: 'https://provider.example/v1',
  CHARACTER_CHAT_MODEL: 'test/model',
}, { fetch: async () => modelStream(chunks) });

test('speaker labels are rejected in message arrays and legacy replies', () => {
  for (const text of ['Yume：你来了呀。', 'Nari: 我刚到家。', '你好。\nYume：今天过得怎么样？']) {
    assert.throws(() => parseResponse(proposal([text])), formatError, text);
    assert.throws(() => parseResponse({ reply: text, emotion: 'friendly' }), formatError, text);
  }
});

test('wrapped stage actions are rejected rather than becoming spoken chat', () => {
  for (const text of ['（轻轻抱住你）今天辛苦了。', '*脸红着低下头* 你别逗我。', '(gently hugs you) You made it home.', '好呀。**慢慢靠近你**']) {
    assert.throws(() => parseResponse(proposal([text])), formatError, text);
  }
});

test('her actual first-person actions and feelings remain ordinary dialogue', () => {
  const messages = ['我刚到家。外面风好大。', '我把门推开了，猫先挤进去，比我还着急。', '刚才有一点紧张，现在好多了。'];
  assert.deepEqual(parseResponse(proposal(messages)).messages, messages);
  for (const message of messages) assert.equal(assertDirectDialogue(message), message);
});

test('useful parentheses, multiplication and textual emphasis retain their exact text', () => {
  for (const text of ['我刚到家（还没吃饭）。', '明天（周三）我想早点出门。', '2 * 3 = 6，先乘再加。', '**这个办法很省事**，我想试试。', 'I *love* how that sounds.']) {
    assert.deepEqual(parseResponse(proposal([text])).messages, [text], text);
  }
});

test('quotation, code and third-person reported speech are not mistaken for self narration', () => {
  for (const text of [
    '你那句“*轻轻抱住*”看起来像剧本，我会直接说话。',
    '她说‘（轻轻靠近你）’，这个格式有点奇怪。',
    '这个例子 `Nari: hello` 用了角色标签。',
    '示例可以写成：\n```text\nYume：你好。\n*轻轻抱住*\n```\n实际聊天不用这层标签。',
    '我同学说她刚到家，还问我要不要一起吃饭。',
  ]) assert.deepEqual(parseResponse(proposal([text])).messages, [text], text);
});

test('accepted dialogue keeps the original life source through parsing and committing', () => {
  const text = '你现在想做什么？';
  const spoken = '我准备把这段旋律从头唱一遍。先轻一点，唱顺了再大声。';
  const life = { scope: 'fictional-character', subject: '练唱一段旋律', state: '我准备把这段旋律从头唱一遍',
    nextStep: '先轻声唱完第一遍，再决定要不要大声唱', feeling: '有点害羞，也很想试', status: 'active', delaySeconds: 180 };
  const output = { ...proposal([spoken]), life };
  const before = structuredClone(output);
  const result = parseResponse(output);
  assert.deepEqual(output, before);
  assert.deepEqual(result.messages, [spoken]);
  assert.equal(result.life.state, life.state);
  const saved = commitTurn(prepareTurn(make(), text, { now: NOW }), text, result, { now: NOW });
  assert.equal(saved.agency.threads.length, 1);
  assert.equal(saved.agency.threads[0].currentState, life.state);
  assert.ok(saved.messages.at(-1).text.includes(saved.agency.threads[0].currentState));
});

test('a forbidden action with a life source rejects the whole turn without silent edits', () => {
  const session = make();
  const before = structuredClone(session);
  const output = { ...proposal(['*轻轻抱住你* 我就待在这儿。']), life: {
    scope: 'fictional-character', subject: '陪伴', state: '*轻轻抱住你*',
    nextStep: '继续说一句', feeling: '安心', status: 'active', delaySeconds: 180,
  } };
  const raw = structuredClone(output);
  assert.throws(() => parseResponse(output), formatError);
  assert.throws(() => commitTurn(session, '抱抱我。', output, { now: NOW }), formatError);
  assert.deepEqual(output, raw);
  assert.deepEqual(session, before);
});

test('a forbidden first streaming bubble never reaches the preview callback', async () => {
  const seen = [];
  const provider = mockProvider([JSON.stringify(proposal(['（轻轻抱住你）今天累了吧。']))]);
  await assert.rejects(provider.generate(prepareTurn(make(), '抱抱我。'), '抱抱我。', {
    onMessage: part => seen.push(part),
  }), formatError);
  assert.deepEqual(seen, []);
});

test('a valid preview followed by a forbidden bubble cannot commit any part of the HTTP turn', async t => {
  const first = '你来了呀。';
  const provider = mockProvider(['{"messages":["你来了呀。",', '"*轻轻抱住你*"],"emotion":"friendly"}']);
  const dataDir = await mkdtemp(join(tmpdir(), 'companion-contract-'));
  const { server } = await createApplication({ env: {}, dataDir, provider });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ characterId: 'yume' }) });
  assert.equal(created.status, 201);
  const { session } = await created.json();
  const diskBefore = await readFile(join(dataDir, 'sessions', `${session.id}.json`), 'utf8');
  const response = await fetch(`${baseUrl}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Speak English. 我住在上海。', revision: session.revision, requestId: randomUUID(), stream: true }) });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.filter(event => event.type === 'message'), [{ type: 'message', index: 0, text: first }]);
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.some(event => event.type === 'done'), false);
  assert.equal(await readFile(join(dataDir, 'sessions', `${session.id}.json`), 'utf8'), diskBefore);
  const loaded = await (await fetch(`${baseUrl}/api/sessions/${session.id}`)).json();
  assert.deepEqual(loaded.session, session);
});

test('normal and proactive prompts receive the same authoritative relationship stage without upgrading it', () => {
  for (const stage of ['初次见面', '聊得来', '渐渐熟悉', '愿意分享近况']) {
    const session = make();
    session.state = { ...session.state, relationship: stage, trust: 4, closeness: 3 };
    const before = structuredClone(session);
    const normal = buildMessages(prepareTurn(session, '你今天想聊什么？', { now: NOW }), '你今天想聊什么？');
    const initiative = buildInitiativeMessages(session, { now: READY });
    for (const messages of [normal, initiative]) {
      assert.deepEqual(context(messages).relationship, { stage, trust: 4, closeness: 3, source: 'application-state' });
      assert.ok(messages[0].content.includes('不能由你的台词或作者示例自行升级'));
      assert.ok(messages[0].content.includes('不写第三人称旁白'));
    }
    assert.deepEqual(session, before);
  }
  const initial = buildMessages(prepareTurn(make(), '你好。'), '你好。')[0].content;
  assert.ok(initial.includes('不必故意冷淡'));
  assert.ok(initial.includes('不要自称已是恋人'));
});

test('an affectionate nickname request does not make the user a confirmed spouse', () => {
  const text = '叫我老婆。';
  const saved = commitTurn(prepareTurn(make(), text, { now: NOW }), text, proposal(['好，按你喜欢的称呼来。']), { now: NOW });
  assert.equal(saved.style.address, '老婆');
  assert.equal(saved.state.relationship, '初次见面');
  assert.equal(saved.state.trust, 0);
  assert.equal(saved.state.closeness, 0);
  assert.deepEqual(saved.memories, []);
  const messages = buildMessages(prepareTurn(saved, '你在吗？'), '你在吗？');
  assert.equal(context(messages).conversationStyle.address, '老婆');
  assert.equal(context(messages).relationship.stage, '初次见面');
  assert.ok(messages[0].content.includes('一个称呼不等于确认婚恋身份'));
});

test('both cards supply spoken-only hugging examples instead of teaching action wrappers', () => {
  for (const characterId of ['yume', 'nari']) {
    const text = '抱抱我，今天不想说话。';
    const messages = buildMessages(prepareTurn(make(characterId), text), text);
    const examples = messages.filter(message => message.name === 'example_assistant').map(message => JSON.parse(message.content));
    assert.ok(examples.length > 0);
    for (const example of examples) assert.doesNotThrow(() => parseResponse(example), characterId);
    assert.ok(examples.some(example => example.messages.join('').includes('抱')), 'a relevant gentle example should remain');
  }
});

test('a vague hurt or quiet request cannot seed a return greeting or a coworker incident', () => {
  for (const characterId of ['yume', 'nari']) {
    const text = '*走过来抱住你* 我今天有点委屈，接下来你会怎样？';
    const examples = buildMessages(prepareTurn(make(characterId), text), text).filter(message => message.name === 'example_user');
    assert.ok(examples.length > 0);
    assert.ok(examples.some(example => example.content.includes('抱抱')));
    assert.ok(examples.every(example => !example.content.includes('回来了') && !example.content.includes('抢功')));
    assert.deepEqual(prepareTurn(make(characterId), '抱抱我，今天不想说话。').closedTopics, []);
  }
  const named = '今天不顺心，被同事抢功了，不想听大道理。';
  const examples = buildMessages(prepareTurn(make(), named), named).filter(message => message.name === 'example_user');
  assert.ok(examples.some(example => example.content.includes('抢功')), 'the specific example remains available when the actual event is stated');
});
