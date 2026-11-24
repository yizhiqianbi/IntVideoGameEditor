import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, providerConfig, normalizeReasoningEffort } from '../provider.mjs';
import { createSession, prepareTurn, commitTurn } from '../engine.mjs';

const KEY = 'test-only-private-provider-credential';
// Regression coverage for the optional one-stage compatibility path. The new
// two-stage path is exercised separately in planner-provider.test.mjs.
const ENV = { CHARACTER_CHAT_PLANNER_ENABLED: 'false', CHARACTER_CHAT_API_KEY: KEY, CHARACTER_CHAT_BASE_URL: 'https://provider.example/v1', CHARACTER_CHAT_MODEL: 'test/model' };
const prepared = () => prepareTurn(createSession({ characterId: 'yume', mode: 'ai' }), '我喜欢雨天读书。');
const conversation = () => {
  const text = '我们聊点轻松的。';
  return commitTurn(prepareTurn(createSession({ characterId: 'yume', mode: 'ai' }), text), text,
    { messages: ['好，我在听。'], emotion: 'friendly' });
};
const jsonReply = (reply = '雨声当背景，确实很适合读书。') => ({ choices: [{ message: { content: JSON.stringify({ reply, emotion: 'calm' }) } }] });

test('provider exposes model and availability but never credentials', () => {
  const provider = createProvider(ENV);
  assert.equal(provider.publicConfig.configured, true);
  assert.equal(provider.publicConfig.model, 'test/model');
  assert.equal(provider.publicConfig.defaultMode, 'ai');
  assert.equal(JSON.stringify(provider.publicConfig).includes(KEY), false);
  assert.deepEqual(Object.keys(provider.publicConfig).sort(), ['architecture', 'configured', 'defaultMode', 'model', 'plannerModel', 'reasoningEffort']);
  assert.equal(provider.publicConfig.reasoningEffort, null);
});

test('reasoning effort accepts the explicit provider override and ignores invalid values', () => {
  assert.equal(normalizeReasoningEffort(' HIGH '), 'high');
  assert.equal(normalizeReasoningEffort('unsupported'), null);
  assert.equal(providerConfig({ OPENROUTER_REASONING_EFFORT: 'medium' }).reasoningEffort, 'medium');
  assert.equal(providerConfig({ CHARACTER_CHAT_REASONING_EFFORT: 'unsupported' }).reasoningEffort, null);
});

test('compatible provider request uses server-side bearer auth and structured chat messages', async () => {
  const calls = [];
  const provider = createProvider(ENV, { fetch: async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(jsonReply()), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await provider.generate(prepared(), '我喜欢雨天读书。');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://provider.example/v1/chat/completions');
  assert.equal(new Headers(calls[0].options.headers).get('authorization'), `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'test/model');
  assert.equal(body.stream, false);
  assert.ok(body.messages.some((message) => message.role === 'system'));
  assert.ok(JSON.stringify(body.messages).includes('我喜欢雨天读书。'));
  assert.equal(JSON.stringify(body).includes(KEY), false);
  assert.equal(result.emotion, 'calm');
  assert.equal(result.reply, '雨声当背景，确实很适合读书。');
  assert.deepEqual(result.memories, [{ text: '我喜欢雨天读书', quote: '我喜欢雨天读书', category: 'preference' }]);
});

test('OpenRouter fallback configuration remains server-side', async () => {
  const provider = createProvider({ OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: 'https://router.example/api/v1', OPENROUTER_MODEL: 'router/model' }, {
    fetch: async () => new Response(JSON.stringify(jsonReply()), { status: 200 }),
  });
  assert.equal(provider.publicConfig.configured, true);
  assert.equal(provider.publicConfig.model, 'router/model');
  assert.equal(JSON.stringify(provider.publicConfig).includes(KEY), false);
  assert.equal((await provider.generate(prepared(), '你好')).emotion, 'calm');
});

test('upstream errors are sanitized rather than leaking provider response or secrets', async () => {
  const provider = createProvider(ENV, { fetch: async () => new Response(JSON.stringify({ error: { message: `Internal upstream details ${KEY}` } }), { status: 401 }) });
  await assert.rejects(provider.generate(prepared(), '你好'), (error) => {
    assert.equal(error.message.includes(KEY), false);
    assert.equal(error.message.includes('Internal upstream details'), false);
    assert.ok(error.status >= 400 && error.status < 600);
    return true;
  });
});

test('malformed successful provider output is rejected without committing a fabricated fallback', async () => {
  const provider = createProvider(ENV, { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not a valid structured reply' } }] }), { status: 200 }) });
  await assert.rejects(provider.generate(prepared(), '你好'), (error) => error.status === 502);
});

test('demo mode is explicit and does not make upstream calls', async () => {
  let called = false;
  const provider = createProvider({}, { fetch: async () => { called = true; throw new Error('Demo should not fetch'); } });
  assert.equal(provider.publicConfig.configured, false);
  assert.equal(provider.publicConfig.defaultMode, 'demo');
  const current = prepareTurn(createSession({ characterId: 'nari', mode: 'demo' }), '你好');
  const result = await provider.generate(current, '你好');
  assert.ok(typeof result.reply === 'string' && result.reply.length > 0);
  assert.equal(called, false);
});

test('foreground and initiative Grok requests both use low excluded reasoning', async () => {
  const requests = [];
  const provider = createProvider({ ...ENV, CHARACTER_CHAT_MODEL: 'x-ai/grok-4.6' }, {
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages: ['嗯，我想起一个小话题。'], emotion: 'friendly' }) } }] }), { status: 200 });
    },
  });
  assert.equal(provider.publicConfig.reasoningEffort, 'low');
  await provider.generate(prepared(), '我喜欢雨天读书。');
  const text = '我们聊聊今天看的电影。';
  const current = commitTurn(prepareTurn(createSession({ characterId: 'yume', mode: 'ai' }), text), text, { messages: ['好，我在听。'], emotion: 'friendly' });
  await provider.generateInitiative(current);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.reasoning.effort, 'low');
    assert.equal(request.reasoning.exclude, true);
    assert.equal(request.stream, false);
    assert.equal(request.response_format.type, 'json_object');
    assert.equal(JSON.stringify(request).includes(KEY), false);
  }
  const actualUsers = current.messages.filter(message => message.role === 'user').map(message => message.text);
  const sentUsers = requests[1].messages.filter(message => message.role === 'user').map(message => message.content);
  assert.ok(sentUsers.length > 0);
  assert.ok(sentUsers.every(content => actualUsers.includes(content)), 'background scheduling must not fabricate a user message');
});

test('explicit high effort overrides Grok low default and applies to Gemini', async () => {
  const requests = [];
  const fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '收到。', emotion: 'friendly' }) } }] }), { status: 200 });
  };
  const grok = createProvider({ ...ENV, CHARACTER_CHAT_MODEL: 'x-ai/grok-4.6', CHARACTER_CHAT_REASONING_EFFORT: 'high' }, { fetch });
  const gemini = createProvider({ ...ENV, CHARACTER_CHAT_MODEL: 'google/gemini-2.5-pro', CHARACTER_CHAT_REASONING_EFFORT: 'high' }, { fetch });
  assert.equal(grok.publicConfig.reasoningEffort, 'high');
  assert.equal(gemini.publicConfig.reasoningEffort, 'high');
  await grok.generate(prepared(), '你好');
  await gemini.generate(prepared(), '你好');
  assert.deepEqual(requests[0].reasoning, { effort: 'high', exclude: true });
  assert.deepEqual(requests[1].reasoning, { effort: 'high' });
});

test('larger Gemini model without an override keeps Qwen-compatible no-reasoning request shape', async () => {
  let request;
  const provider = createProvider({ ...ENV, CHARACTER_CHAT_MODEL: 'google/gemini-2.5-pro' }, {
    fetch: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify(jsonReply()), { status: 200 });
    },
  });
  assert.equal(provider.publicConfig.reasoningEffort, null);
  await provider.generate(prepared(), '你好');
  assert.equal('reasoning' in request, false);
});

test('initiative accepts explicit silence while foreground rejects empty message arrays', async () => {
  const provider = createProvider(ENV, {
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages: [], emotion: 'calm' }) } }] }), { status: 200 }),
  });
  const skipped = await provider.generateInitiative(conversation());
  assert.deepEqual(skipped.messages, []);
  assert.equal(skipped.reply, '');
  await assert.rejects(provider.generate(prepared(), '你好'), (error) => error.status === 502);
});

test('DeepSeek-like plain initiative text is wrapped narrowly while foreground stays strict', async () => {
  const provider = createProvider({ ...ENV, CHARACTER_CHAT_MODEL: 'deepseek/deepseek-v4.1-flash' }, {
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '刚想到一件小事，等你有空再告诉你。' } }] }), { status: 200 }),
  });
  const result = await provider.generateInitiative(conversation());
  assert.deepEqual(result.messages, ['刚想到一件小事，等你有空再告诉你。']);
  assert.equal(result.emotion, 'friendly');
  await assert.rejects(provider.generate(prepared(), '你好'), error => error.status === 502);
});

test('initiative fallback does not accept JSON-looking malformed output', async () => {
  const provider = createProvider(ENV, {
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"messages":["未闭合"' } }] }), { status: 200 }),
  });
  await assert.rejects(provider.generateInitiative(conversation()), error => error.status === 502);
});

test('initiative forwards cancellation to the provider fetch request', { timeout: 3000 }, async () => {
  let entered;
  let requestSignal;
  const hasEntered = new Promise(resolve => { entered = resolve; });
  const provider = createProvider(ENV, {
    fetch: async (_url, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled fake request', 'AbortError')), { once: true });
        entered();
      });
    },
  });
  const controller = new AbortController();
  const pending = provider.generateInitiative(conversation(), { signal: controller.signal });
  await hasEntered;
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.equal(error.message.includes(KEY), false);
    return true;
  });
  assert.equal(requestSignal.aborted, true);
});

function modelStream(content, { failAfterPreview = false } = {}) {
  const cut = content.indexOf(',"emotion"');
  const pieces = [content.slice(0, cut), content.slice(cut)];
  const event = value => `data: ${JSON.stringify(value)}\n\n`;
  const text = pieces.map(part => event({ choices: [{ delta: { content: part }, finish_reason: null }] })).join('')
    + (failAfterPreview ? event({ error: { message: KEY } }) : event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 11) controller.enqueue(bytes.slice(index, index + 11));
    controller.close();
  } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('streaming foreground emits complete parts before final validation and retains low reasoning', async () => {
  const seen = [];
  let request;
  const raw = JSON.stringify({ messages: ['欸，来了。', '让我先开心一下。'], emotion: 'playful' });
  const provider = createProvider({ ...ENV, CHARACTER_CHAT_MODEL: 'x-ai/grok-4.6' }, {
    fetch: async (_url, options) => { request = JSON.parse(options.body); return modelStream(raw); },
  });
  const result = await provider.generate(prepared(), '我喜欢雨天读书。', { onMessage: part => { seen.push(part); } });
  assert.equal(request.stream, true);
  assert.deepEqual(request.reasoning, { effort: 'low', exclude: true });
  assert.deepEqual(seen, [{ index: 0, text: '欸，来了。' }, { index: 1, text: '让我先开心一下。' }]);
  assert.deepEqual(result.messages, seen.map(part => part.text));
  assert.equal(JSON.stringify(request).includes(KEY), false);
});

test('provider rejects invalid final streaming output and sanitized failure after a preview', async () => {
  for (const [raw, failAfterPreview] of [
    [JSON.stringify({ messages: ['一', '二', '三', '四'], emotion: 'calm' }), false],
    [JSON.stringify({ messages: ['先出现的预览'], emotion: 'calm' }), true],
    ['{"messages":["先出现的预览"],"emotion":"calm",', false],
  ]) {
    const seen = [];
    const provider = createProvider(ENV, { fetch: async () => modelStream(raw, { failAfterPreview }) });
    await assert.rejects(provider.generate(prepared(), '你好', { onMessage: part => { seen.push(part); } }), error => error.status === 502 && !error.message.includes(KEY));
    assert.ok(seen.length > 0, 'the failure happens after a completed preview, so the caller must withdraw it');
  }
});
