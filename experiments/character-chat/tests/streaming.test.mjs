import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCompletedMessages, readModelStream } from '../streaming.mjs';

const delta = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\r\n\r\n`;
const stop = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function fragmentedResponse(text, width = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += width) controller.enqueue(bytes.slice(index, index + width));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

test('JSON-prefix extraction exposes only complete top-level message strings', () => {
  assert.deepEqual(extractCompletedMessages('{"messages":["未写完'), []);
  assert.deepEqual(extractCompletedMessages('{"messages":["还没分隔符"'), []);
  assert.deepEqual(extractCompletedMessages('{"messages":["第一条", "第二条还没写'), ['第一条']);
  assert.deepEqual(extractCompletedMessages('{"messages":["第一条", "第二条"]'), ['第一条', '第二条']);
  const content = JSON.stringify({ beat: { messages: ['隐藏元数据'] }, note: '"messages":["伪造"]', messages: ['真实对话', '有“引号”和\\反斜线'] });
  assert.deepEqual(extractCompletedMessages(content), ['真实对话', '有“引号”和\\反斜线']);
  assert.deepEqual(extractCompletedMessages(JSON.stringify({ beat: { messages: ['隐藏元数据'] } })), []);
  assert.deepEqual(extractCompletedMessages('[{"messages":["非对象顶层"]}]'), []);
  assert.deepEqual(extractCompletedMessages('{"messages":["' + '字'.repeat(601) + '"]}'), []);
});

test('SSE reader preserves fragmented UTF-8, escaped JSON and ordered message callbacks', async () => {
  const raw = JSON.stringify({ messages: ['欸，来啦。', '先让我说一句："想你了"。'], emotion: 'playful', beat: { focus: '眼前对话', feeling: '开心', want: '聊天' } });
  const stream = ': heartbeat\n\n' + delta(raw.slice(0, 19)) + delta(raw.slice(19, 43)) + delta(raw.slice(43)) + stop;
  const seen = [];
  const completed = await readModelStream(fragmentedResponse(stream, 1), { onMessage: async part => { seen.push(part); } });
  assert.equal(completed, raw);
  assert.deepEqual(seen, [{ index: 0, text: '欸，来啦。' }, { index: 1, text: '先让我说一句："想你了"。' }]);
});

test('SSE errors, truncation and output limits reject rather than manufacturing a completion', async () => {
  for (const stream of [
    delta('{"messages":["完整但连接未结束"],"emotion":"calm"}'),
    delta('{"messages":["超出输出预算"') + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' + stop,
    'data: {"error":{"message":"internal private detail"}}\n\n',
    'data: invalid JSON\n\n',
    delta('x'.repeat(80001)) + stop,
  ]) {
    await assert.rejects(readModelStream(fragmentedResponse(stream, 8192)), error => error.status === 502 && !error.message.includes('internal private detail'));
  }
});

test('SSE abort stops previews and reports cancellation', async () => {
  const controller = new AbortController();
  const seen = [];
  const stream = delta('{"messages":["第一条",') + delta('"第二条"],"emotion":"calm"}') + stop;
  await assert.rejects(readModelStream(fragmentedResponse(stream), {
    signal: controller.signal, onMessage: part => { seen.push(part); controller.abort(); },
  }), error => error.code === 'CANCELLED');
  assert.deepEqual(seen, [{ index: 0, text: '第一条' }]);
});
