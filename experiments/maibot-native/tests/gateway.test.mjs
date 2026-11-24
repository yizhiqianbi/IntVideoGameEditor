import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeClient, createGateway, fromNative, mergeNativeHistory } from '../gateway.mjs';

class FakeNative {
  constructor() { this.connected = false; this.opened = new Set(); this.sent = []; this.history = new Map(); }
  async connect() { this.connected = true; }
  async open(id) {
    await this.connect();
    if (this.opened.has(id)) return;
    await this.onEvent(id, 'history', { messages: this.history.get(id) || [] });
    this.opened.add(id);
  }
  async send(id, text) {
    this.sent.push({ id, text });
    await this.onEvent(id, 'user_message', { content: text, message_id: randomUUID(), timestamp: Date.now() / 1000 });
    return { accepted: true };
  }
  async readHistory(id) { return this.history.get(id) || []; }
  close() { this.connected = false; }
}

async function fixture(t, native = new FakeNative(), options = {}) {
  const instanceDir = await mkdtemp(join(tmpdir(), 'maibot-gateway-test-'));
  const gateway = await createGateway({ instanceDir, nativeClient: native, ...options });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  t.after(async () => { await gateway.close(); await rm(instanceDir, { recursive: true, force: true }); });
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { gateway, native, instanceDir, base, post };
}

test('gateway accepts consecutive segments without waiting for any bot generation', async t => {
  const { gateway, native, post } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  const ids = [randomUUID(), randomUUID()];
  const responses = await Promise.all(['我今天有点累', '但想先听你讲'].map((text, index) => post(`/api/sessions/${session.id}/messages`, { text, requestId: ids[index] })));
  assert.deepEqual(responses.map(response => response.status), [202, 202]);
  assert.equal(native.sent.length, 2);
  assert.deepEqual((await gateway.read(session.id)).session.messages.map(item => item.role), ['user', 'user']);
  assert.deepEqual((await gateway.read(session.id)).session.messages.map(item => item.requestId), ids);
  await native.onEvent(session.id, 'bot_message', { content: '今天不用那么用力。', timestamp: Date.now() / 1000 });
  assert.equal((await gateway.read(session.id)).session.messages.at(-1).text, '今天不用那么用力。');
});

test('proactive trigger reaches native Maisaka without creating a fake user message', async t => {
  const { gateway, native, post } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  await gateway.send(session.id, { text: '我先停在这里', requestId: randomUUID() });
  const userMessageId = (await gateway.read(session.id)).session.messages[0].id;
  native.triggered = [];
  native.triggerProactive = async (id, intent, options) => {
    native.triggered.push({ id, intent, options });
    return { task_id: 'proactive:test' };
  };
  const response = await post(`/api/sessions/${session.id}/proactive`, {
    userMessageId,
    intent: '判断是否自然主动分享一件新鲜小事。',
    reason: 'private_chat_quiet_window',
  });
  assert.equal(response.status, 202);
  assert.deepEqual(native.triggered, [{
    id: session.id,
    intent: '判断是否自然主动分享一件新鲜小事。',
    options: { reason: 'private_chat_quiet_window', priority: '', metadata: {} },
  }]);
  assert.equal((await gateway.read(session.id)).session.messages.length, 1);
  const duplicate = await post(`/api/sessions/${session.id}/proactive`, {
    userMessageId,
    intent: '不应再次触发。',
  });
  assert.equal(duplicate.status, 202);
  assert.equal((await duplicate.json()).alreadyTriggered, true);
  assert.equal(native.triggered.length, 1);
});

test('request receipts prevent duplicate delivery and reject request ID reuse', async t => {
  const { gateway, native } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  const body = { text: '你好呀', requestId: randomUUID() };
  await Promise.all([gateway.send(session.id, body), gateway.send(session.id, body)]);
  assert.equal(native.sent.length, 1);
  await assert.rejects(gateway.send(session.id, { ...body, text: '另一条' }), { code: 'REQUEST_CONFLICT' });
});

test('accepted-but-unconfirmed input is exposed as a receipt, then confirmed by official history without resend', async t => {
  const { gateway, native } = await fixture(t, new FakeNative(), { historyRefreshMs: 0 });
  const { session } = await gateway.create({ characterId: 'yume' });
  let sends = 0, reads = 0;
  native.send = async () => { sends += 1; return { accepted: true }; };
  native.readHistory = async id => { reads += 1; return native.history.get(id) || []; };
  const requestId = randomUUID();
  await gateway.send(session.id, { text: '我还有一句', requestId });
  const pending = (await gateway.read(session.id)).session;
  assert.equal(pending.messages.length, 0);
  assert.deepEqual(pending.receipts, [{ requestId, status: 'accepted', confirmed: false }]);
  assert.deepEqual(Object.keys(pending.receipts[0]).sort(), ['confirmed', 'requestId', 'status']);
  native.history.set(session.id, [{ id: 'persisted-user', type: 'user', content: '我还有一句', timestamp: Date.now() / 1000 + 1 }]);
  const synced = (await gateway.read(session.id)).session;
  assert.deepEqual(synced.receipts, [{ requestId, status: 'accepted', confirmed: true }]);
  assert.equal(synced.messages[0].requestId, requestId);
  await gateway.send(session.id, { text: '我还有一句', requestId });
  assert.equal(sends, 1);
  assert.equal(reads, 2);
});

test('an empty session read pulls database history that the websocket snapshot missed', async t => {
  const { gateway, native } = await fixture(t, new FakeNative(), { historyRefreshMs: 0 });
  const { session } = await gateway.create({ characterId: 'yume' });
  assert.equal((await gateway.read(session.id)).session.messages.length, 0);
  native.history.set(session.id, [{ id: 'old', type: 'user', content: '不聊这个，停', timestamp: Date.now() / 1000 }]);
  assert.equal((await gateway.read(session.id)).session.messages.at(-1).text, '不聊这个，停');
});

test('unconfirmed-history recovery is throttled and failures never fabricate messages', async t => {
  const { gateway, native } = await fixture(t, new FakeNative(), { historyRefreshMs: 60_000 });
  const { session } = await gateway.create({ characterId: 'yume' });
  native.send = async () => ({ accepted: true });
  let reads = 0;
  native.readHistory = async () => { reads += 1; throw new Error('temporary history outage'); };
  const requestId = randomUUID();
  await gateway.send(session.id, { text: '等等', requestId });
  const states = await Promise.all([gateway.read(session.id), gateway.read(session.id), gateway.read(session.id)]);
  assert.equal(reads, 1);
  for (const { session: current } of states) {
    assert.equal(current.messages.length, 0);
    assert.deepEqual(current.receipts, [{ requestId, status: 'accepted', confirmed: false }]);
  }
});

test('first accepted input assigns the title once even before native echoes arrive', async t => {
  const { gateway, native } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  native.send = async () => ({ accepted: true });
  await gateway.send(session.id, { text: '第一条作标题', requestId: randomUUID() });
  await gateway.send(session.id, { text: '第二条不覆盖', requestId: randomUUID() });
  assert.equal((await gateway.read(session.id)).session.title, '第一条作标题');
});

test('uncertain native delivery never automatically resends a potentially accepted input', async t => {
  const { gateway, native } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  let count = 0;
  native.send = async () => { count += 1; throw new Error('lost ack'); };
  const body = { text: '晚安', requestId: randomUUID() };
  await assert.rejects(gateway.send(session.id, body));
  await assert.rejects(gateway.send(session.id, body), { code: 'DELIVERY_UNCERTAIN' });
  assert.equal(count, 1);
});

test('equal user messages get distinct ordered request IDs and event replay does not consume the next receipt', async t => {
  const { gateway, native, instanceDir } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  native.send = async (id, text) => { native.sent.push({ id, text }); return { accepted: true }; };
  const requests = [randomUUID(), randomUUID()];
  for (const requestId of requests) await gateway.send(session.id, { text: '好呀', requestId });
  const messages = [
    { message_id: 'native-first', content: '好呀', timestamp: Date.now() / 1000 },
    { message_id: 'native-second', content: '好呀', timestamp: Date.now() / 1000 + 0.01 },
  ];
  await native.onEvent(session.id, 'user_message', messages[0]);
  await native.onEvent(session.id, 'user_message', messages[0]);
  await native.onEvent(session.id, 'user_message', messages[1]);
  const current = (await gateway.read(session.id)).session;
  assert.deepEqual(current.messages.map(item => [item.id, item.requestId]), [['native-first', requests[0]], ['native-second', requests[1]]]);
  const secondNative = new FakeNative();
  secondNative.history.set(session.id, messages.map(item => ({ ...item, id: item.message_id, type: 'user' })));
  const restored = await createGateway({ instanceDir, nativeClient: secondNative });
  t.after(() => restored.close());
  assert.deepEqual((await restored.read(session.id)).session.messages.map(item => item.requestId), requests);
});

test('a user echo confirms delivery when the ACK is lost, retaining request ID without resend', async t => {
  const { gateway, native } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  let count = 0;
  native.send = async (id, text) => {
    count += 1;
    await native.onEvent(id, 'user_message', { content: text, message_id: 'delivered-despite-lost-ack', timestamp: Date.now() / 1000 });
    throw new Error('ACK lost');
  };
  const body = { text: '等一下', requestId: randomUUID() };
  assert.equal((await gateway.send(session.id, body)).accepted, true);
  assert.equal((await gateway.send(session.id, body)).accepted, true);
  assert.equal(count, 1);
  assert.equal((await gateway.read(session.id)).session.messages[0].requestId, body.requestId);
});

test('history resolves lost-ACK receipts but an older equal message cannot consume one', async t => {
  const { gateway, native, instanceDir } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  native.send = async () => { throw new Error('ACK and echo lost'); };
  const body = { text: '想你了', requestId: randomUUID() };
  await assert.rejects(gateway.send(session.id, body));
  const afterSubmission = Date.now() / 1000 + 1;
  const secondNative = new FakeNative();
  secondNative.history.set(session.id, [
    { id: 'old-equal', type: 'user', content: body.text, timestamp: 100 },
    { id: 'new-delivered', type: 'user', content: body.text, timestamp: afterSubmission },
  ]);
  const restored = await createGateway({ instanceDir, nativeClient: secondNative });
  t.after(() => restored.close());
  const messages = (await restored.read(session.id)).session.messages;
  assert.equal(messages[0].requestId, undefined);
  assert.equal(messages[1].requestId, body.requestId);
  assert.equal((await restored.send(session.id, body)).accepted, true);
  assert.equal(secondNative.sent.length, 0);
});

test('ACK native IDs take precedence over arrival order when the protocol supplies them', async t => {
  const { gateway, native } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  const requests = [randomUUID(), randomUUID()];
  let nextId = 0;
  native.send = async () => ({ accepted: true, message_id: `native-${++nextId}` });
  for (const requestId of requests) await gateway.send(session.id, { text: '好呀', requestId });
  await native.onEvent(session.id, 'user_message', { message_id: 'native-2', content: '好呀', timestamp: Date.now() / 1000 });
  await native.onEvent(session.id, 'user_message', { message_id: 'native-1', content: '好呀', timestamp: Date.now() / 1000 });
  const messages = (await gateway.read(session.id)).session.messages;
  assert.deepEqual(messages.map(item => item.requestId), [requests[1], requests[0]]);
});

test('native private channels keep incoming events separate', async t => {
  const { gateway, native } = await fixture(t);
  const first = (await gateway.create({ characterId: 'yume' })).session;
  const second = (await gateway.create({ characterId: 'yume' })).session;
  await native.onEvent(first.id, 'bot_message', { content: '只给第一段会话', timestamp: Date.now() / 1000 });
  assert.equal((await gateway.read(first.id)).session.messages.length, 1);
  assert.equal((await gateway.read(second.id)).session.messages.length, 0);
  await assert.rejects(gateway.read(randomUUID()), { code: 'SESSION_NOT_FOUND' });
});

test('reconnect reconciles DB message IDs without collapsing actual repeated dialogue', () => {
  const existing = [
    { id: 'live1', nativeId: null, role: 'assistant', text: '好呀', createdAt: '2026-10-18T10:00:01.000Z' },
    { id: 'live2', nativeId: null, role: 'assistant', text: '好呀', createdAt: '2026-10-18T10:00:02.000Z' },
  ];
  const history = [
    { id: 'stored1', nativeId: 'stored1', role: 'assistant', text: '好呀', createdAt: '2026-10-18T10:00:01.000Z' },
    { id: 'stored2', nativeId: 'stored2', role: 'assistant', text: '好呀', createdAt: '2026-10-18T10:00:02.000Z' },
  ];
  assert.deepEqual(mergeNativeHistory(existing, history).map(item => item.id), ['stored1', 'stored2']);
});

// Captured from the real native /api/chat/history response for the isolated
// root-agent acceptance chat on 2026-10-18. It contains no credentials.
const nativeRichHistoryPacket = {
  id: 'send_api_1792299339857', type: 'bot',
  content: '你好呀，我是阿舟 阿舟你好呀～这名字听着就像要划船去哪儿似的',
  timestamp: 1792299339.857034, sender_name: 'Yume', sender_id: 'bot', is_bot: true, message_type: 'rich',
  segments: [
    { type: 'reply', data: { target_message_id: '7b062dc1-2411-49bd-becf-c00601fda1d4', target_message_content: '你好呀，我是阿舟', target_message_sender_id: 'webui_user_300da27b-9134-4139-8359-0ed5f42333cc', target_message_sender_nickname: '你', target_message_sender_cardname: '你' } },
    { type: 'text', data: '阿舟你好呀～这名字听着就像要划船去哪儿似的' },
  ],
};

test('real native rich packet separates quoted user text from authored body for live and history', () => {
  const live = fromNative(nativeRichHistoryPacket, 'bot_message');
  const stored = fromNative(nativeRichHistoryPacket);
  assert.equal(live.text, '阿舟你好呀～这名字听着就像要划船去哪儿似的');
  assert.equal(stored.text, live.text);
  assert.equal(live.replyTo.text, '你好呀，我是阿舟');
  assert.equal(fromNative({ ...nativeRichHistoryPacket, segments: [nativeRichHistoryPacket.segments[0]] }), null);
  // A real text segment repeating the user's words is still real dialogue.
  assert.equal(fromNative({ ...nativeRichHistoryPacket, segments: [{ type: 'text', data: '你好呀，我是阿舟' }] }).text, '你好呀，我是阿舟');
});

test('native binary segments survive as bounded public media and pure media is not discarded', () => {
  const packet = {
    id: 'media-only', type: 'bot', is_bot: true, timestamp: 1792299339.857034,
    content: '[表情][语音][照片]',
    segments: [
      { type: 'emoji', data: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' },
      { type: 'voice', data: { url: 'data:audio/wav;base64,UklGRg==', mimeType: 'audio/wav', durationMs: 640 } },
      { type: 'image', data: 'https://cdn.example.test/yume.png' },
    ],
  };
  const normalized = fromNative(packet, 'bot_message');
  assert.equal(normalized.text, '');
  assert.deepEqual(normalized.media, [
    { kind: 'emoji', url: packet.segments[0].data, mimeType: 'image/gif' },
    { kind: 'voice', url: packet.segments[1].data.url, mimeType: 'audio/wav', durationMs: 640 },
    { kind: 'image', url: packet.segments[2].data, mimeType: 'image/png' },
  ]);
  assert.equal(fromNative({ ...packet, segments: [{ type: 'image', data: 'http://insecure.example.test/yume.png' }] }), null);
  assert.equal(fromNative({ ...packet, segments: [{ type: 'image', data: 'https://user:secret@cdn.example.test/yume.png' }] }), null);
  assert.equal(fromNative({ ...packet, segments: [{ type: 'image', data: `data:image/png;base64,${'a'.repeat(8 * 1024 * 1024)}` }] }), null);
});

test('voice media MIME is inferred from an MP3 frame when native serialization labels it wav', () => {
  const mp3 = Buffer.from([0xff, 0xf3, 0xc4, 0xc4]).toString('base64');
  const packet = { id: 'voice-mime', is_bot: true, segments: [{ type: 'voice', data: `data:audio/wav;base64,${mp3}` }] };
  const normalized = fromNative(packet, 'bot_message');
  assert.equal(normalized.media[0].mimeType, 'audio/mpeg');
  assert.match(normalized.media[0].url, /^data:audio\/mpeg;base64,/);
});

test('emoji SVG MIME is inferred from the payload instead of native gif labels', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>🥺</text></svg>').toString('base64');
  const packet = { id: 'emoji-svg', is_bot: true, segments: [{ type: 'emoji', data: `data:image/gif;base64,${svg}` }] };
  const normalized = fromNative(packet, 'bot_message');
  assert.equal(normalized.media[0].mimeType, 'image/svg+xml');
  assert.match(normalized.media[0].url, /^data:image\/svg\+xml;base64,/);
});

test('gateway persists and exposes media-only native events', async t => {
  const { gateway, native } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  await native.onEvent(session.id, 'bot_message', {
    id: 'persisted-emoji', type: 'bot', timestamp: Date.now() / 1000,
    segments: [{ type: 'emoji', data: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }],
  });
  const current = (await gateway.read(session.id)).session;
  assert.equal(current.messages.length, 1);
  assert.equal(current.messages[0].text, '');
  assert.equal(current.messages[0].media[0].kind, 'emoji');
});

test('legacy quoted-body archive migrates from the same native packet without removing repeated real replies', () => {
  const old = {
    id: '6c8af3e7-3174-4237-a2b0-43fcd3c3f8d4', nativeId: null, role: 'assistant',
    text: nativeRichHistoryPacket.content, createdAt: '2026-10-18T04:55:39.858Z',
  };
  const oldSecond = { ...old, id: 'second-live-message', createdAt: '2026-10-18T04:55:40.858Z' };
  const normalized = fromNative(nativeRichHistoryPacket);
  const normalizedSecond = fromNative({ ...nativeRichHistoryPacket, id: 'second-stored-message', timestamp: nativeRichHistoryPacket.timestamp + 1 });
  const messages = mergeNativeHistory([old, oldSecond], [normalized, normalizedSecond]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(item => item.id), [nativeRichHistoryPacket.id, 'second-stored-message']);
  assert.equal(messages[0].text, normalized.text);
  assert.equal(messages[1].text, normalized.text);
});

test('DB history reconciles a native message created before its simulated typing delay', () => {
  const live = { id: 'defe6859-eb6a-467f-92de-65343356939f', nativeId: null, role: 'assistant', text: '我今天中午吃了碗面然后就瘫床上了，撑得不想动', createdAt: '2026-10-18T04:58:00.994Z' };
  const stored = { ...live, id: 'send_api_1792299474544', nativeId: 'send_api_1792299474544', createdAt: '2026-10-18T04:57:54.544Z' };
  assert.deepEqual(mergeNativeHistory([live], [stored]), [stored]);
});

test('restart restores local archive and pulls native history for the same private identity', async t => {
  const { gateway, native, instanceDir } = await fixture(t);
  const { session } = await gateway.create({ characterId: 'yume' });
  await native.onEvent(session.id, 'bot_message', { content: '之前的消息', timestamp: 100 });
  const secondNative = new FakeNative();
  secondNative.history.set(session.id, [{ id: 'native-new', content: '断线期间的新消息', is_bot: true, timestamp: 200 }]);
  const restored = await createGateway({ instanceDir, nativeClient: secondNative });
  t.after(() => restored.close());
  const result = (await restored.read(session.id)).session;
  assert.equal(secondNative.opened.has(session.id), true);
  assert.deepEqual(result.messages.map(item => item.text), ['之前的消息', '断线期间的新消息']);
});

test('offline health is truthful and neither secrets nor native errors reach the browser', async t => {
  const native = new FakeNative();
  native.connect = async () => { throw new Error('secret-token-do-not-expose'); };
  const { gateway, base } = await fixture(t, native);
  const response = await fetch(`${base}/api/health`);
  const result = await response.json();
  assert.equal(result.ready, false);
  assert.equal(result.transportReady, false);
  assert.equal(result.readinessScope, 'native-webui-transport');
  assert.equal(result.runtime, 'maibot-native');
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
  await assert.rejects(gateway.create({ characterId: 'nari' }), { code: 'CHARACTER_UNAVAILABLE' });
});

test('HTTP rejects cross-origin writes, invalid payloads and unknown routes', async t => {
  const { post, base } = await fixture(t);
  assert.equal((await post('/api/sessions', { characterId: 'yume' }, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('/api/sessions', null)).status, 400);
  assert.equal((await fetch(`${base}/api/admin/secrets`)).status, 404);
  const legacyLink = await fetch(base, { redirect: 'manual' });
  assert.equal(legacyLink.status, 302);
  assert.equal(legacyLink.headers.get('location'), 'http://127.0.0.1:3010/xumeng/girlfriend');
});

test('NativeClient uses official WebUI authentication and isolated chat calls, never user-visible credentials', async t => {
  const instanceDir = await mkdtemp(join(tmpdir(), 'maibot-native-protocol-'));
  await mkdir(join(instanceDir, 'data'));
  await writeFile(join(instanceDir, 'data', 'webui.json'), JSON.stringify({ access_token: 'private-backend-token' }));
  t.after(() => rm(instanceDir, { recursive: true, force: true }));
  const calls = [], events = [];
  class MockSocket extends EventTarget {
    constructor(url) { super(); this.url = url; queueMicrotask(() => this.packet({ op: 'event', domain: 'system', event: 'ready' })); }
    packet(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
    send(raw) {
      const request = JSON.parse(raw); calls.push(request);
      queueMicrotask(() => {
        this.packet({ op: 'response', id: request.id, ok: true, data: { accepted: true } });
        if (request.method === 'session.open') this.packet({ op: 'event', domain: 'chat', event: 'history', session: request.session, data: { messages: [] } });
      });
    }
    close() { this.dispatchEvent(new Event('close')); }
  }
  const client = new NativeClient({ instanceDir, WebSocketClass: MockSocket, onEvent: async (...args) => events.push(args), fetcher: async (url, options) => {
    assert.equal(options.headers.Cookie, 'maibot_session=private-backend-token');
    if (url.pathname === '/api/chat/history') {
      assert.equal(url.searchParams.get('user_id'), `webui_user_${id}`);
      assert.equal(url.searchParams.get('limit'), '200');
      return Response.json({ success: true, messages: [nativeRichHistoryPacket] });
    }
    assert.equal(url.pathname, '/api/webui/ws-token');
    return Response.json({ success: true, token: 'one-time-handshake' });
  } });
  t.after(() => client.close());
  const id = randomUUID();
  await client.send(id, '你好');
  assert.equal(client.socket.url, 'ws://127.0.0.1:18001/api/webui/ws?token=one-time-handshake');
  assert.deepEqual(calls.map(call => call.method), ['session.open', 'message.send']);
  assert.equal(calls[0].data.user_id, `webui_user_${id}`);
  assert.equal(calls[0].data.restore, true);
  assert.equal(calls[1].data.content, '你好');
  assert.equal(events[0][1], 'history');
  assert.equal(JSON.stringify(calls).includes('private-backend-token'), false);
  assert.deepEqual(await client.readHistory(id), [nativeRichHistoryPacket]);
});
