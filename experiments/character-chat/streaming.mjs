// Read complete dialogue strings from a JSON prefix. Unfinished strings and
// metadata never become visible messages; the full response is validated later.
import { assertDirectDialogue } from './dialogue-contract.mjs';
function stringEnd(text, start) {
  if (text[start] !== '"') return -1;
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === '"') return i + 1;
  }
  return -1;
}

const whitespace = (text, start) => { let i = start; while (/\s/u.test(text[i] || '') && i < text.length) i += 1; return i; };

function valueEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '"') { const end = stringEnd(text, i); if (end < 0) return -1; i = end - 1; continue; }
    if (text[i] === '{' || text[i] === '[') depth += 1;
    else if (text[i] === '}' || text[i] === ']') { if (!depth) return i; depth -= 1; }
    else if (text[i] === ',' && !depth) return i;
  }
  return -1;
}

export function extractCompletedMessages(text) {
  const parts = [];
  let i = whitespace(text, 0);
  if (text[i++] !== '{') return parts;
  while (i < text.length) {
    i = whitespace(text, i);
    const end = stringEnd(text, i);
    if (end < 0) return parts;
    let key;
    try { key = JSON.parse(text.slice(i, end)); } catch { return parts; }
    i = whitespace(text, end);
    if (text[i++] !== ':') return parts;
    i = whitespace(text, i);
    if (key !== 'messages') {
      i = valueEnd(text, i);
      if (i < 0 || text[i] !== ',') return parts;
      i += 1; continue;
    }
    if (text[i++] !== '[') return parts;
    while (i < text.length && parts.length < 3) {
      i = whitespace(text, i);
      if (text[i] === ']') return parts;
      const end = stringEnd(text, i);
      if (end < 0) return parts;
      const delimiter = whitespace(text, end);
      if (![',', ']'].includes(text[delimiter])) return parts;
      let value;
      try { value = JSON.parse(text.slice(i, end)); } catch { return parts; }
      if (typeof value !== 'string' || !value.trim() || value.length > 600) return parts;
      assertDirectDialogue(value);
      parts.push(value.trim());
      if (text[delimiter] === ']') return parts;
      i = delimiter + 1;
    }
    return parts;
  }
  return parts;
}

const fail = message => Object.assign(new Error(message), { status: 502 });
const cancelled = () => Object.assign(new Error('这次生成已取消。'), { status: 409, code: 'CANCELLED' });

export async function readModelStream(response, { onMessage, signal } = {}) {
  if (!response.body) throw fail('模型没有返回聊天内容，请重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let buffer = '', dataLines = [], content = '', delivered = 0, finished = false, stop = false;
  const event = async () => {
    if (!dataLines.length) return;
    const data = dataLines.join('\n'); dataLines = [];
    if (data === '[DONE]') { finished = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw fail('模型响应格式无效，请重试。'); }
    if (chunk.error) throw fail('模型服务中断了这次回复，请重试。');
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason === 'length') throw fail('模型回复没有完成，请重试。');
    if (choice?.finish_reason === 'stop') stop = true;
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (content.length > 80000) throw fail('模型回复过长，请重试。');
    const parts = extractCompletedMessages(content);
    while (delivered < parts.length) {
      if (signal?.aborted) throw cancelled();
      const index = delivered++;
      await onMessage?.({ index, text: parts[index] });
    }
  };
  const line = async value => {
    value = value.replace(/\r$/u, '');
    if (!value) await event();
    else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /u, ''));
    if (dataLines.join('\n').length > 100000) throw fail('模型响应过长，请重试。');
  };
  try {
    while (!finished) {
      if (signal?.aborted) throw cancelled();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 200000) throw fail('模型响应过长，请重试。');
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { const value = buffer.slice(0, end); buffer = buffer.slice(end + 1); await line(value); }
      if (done) { if (buffer) await line(buffer); await event(); break; }
    }
    if (signal?.aborted) throw cancelled();
    if (!finished && !stop) throw fail('模型连接中断，回复还没完成，请重试。');
    return content;
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
