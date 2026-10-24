/**
 * Qingyu's native MaiBot WebUI adapter with a private proactive-task extension.
 * This module never calls a model or writes dialogue, plans, memory or prompts.
 * Native MaiBot owns cognition, message splitting, scheduling and durable chat.
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const MEDIA_KINDS = new Set(['emoji', 'image', 'voice']);
// Keep the browser transport bounded even when a plugin accidentally emits a
// very large binary segment. Normal emoji/voice/photo payloads are far below
// this limit, and rejected media remains visible through the text fallback.
const MAX_MEDIA_URL_LENGTH = 8 * 1024 * 1024;
const fail = (message, status = 503, code = 'NATIVE_OFFLINE') => Object.assign(new Error(message), { status, code });
const nativeUnavailable = () => fail('原生 MaiBot 尚未连接，请稍后重试。');
const iso = seconds => new Date(Number.isFinite(Number(seconds)) ? Number(seconds) * 1000 : Date.now()).toISOString();
const delayError = () => fail('原生服务未及时确认；请先查看聊天记录，避免重复发送。', 504, 'NATIVE_ACK_TIMEOUT');

// Public messages remain limited to 4000 characters by the host. Its private
// style envelope must not consume that allowance at the native boundary.
export function validNativeMessageText(value) {
  if (typeof value !== 'string' || value.length > 10_000) return false;
  const text = value.replace(/^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n/, '');
  return Boolean(text.trim()) && text.length <= 4_000;
}

function mediaUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MEDIA_URL_LENGTH) return null;
  if (/^data:(?:image|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function mediaMime(kind, url, provided) {
  const detected = detectDataMime(kind, url);
  if (detected) return detected;
  if (typeof provided === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(provided)) return provided.toLowerCase();
  const match = /^data:([^;,]+)/i.exec(url || '');
  if (match) return match[1].toLowerCase();
  return kind === 'voice' ? 'audio/wav' : kind === 'emoji' ? 'image/gif' : 'image/png';
}

function detectDataMime(kind, url) {
  if (kind !== 'voice' || typeof url !== 'string') return null;
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(url);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  } catch { /* Keep the declared/default MIME for malformed data. */ }
  return null;
}

/** Convert MaiBot's rich binary segments into the small public media shape. */
function normalizeMediaSegment(segment) {
  if (!segment || !MEDIA_KINDS.has(segment.type)) return null;
  const value = segment.data;
  const url = mediaUrl(typeof value === 'string' ? value : value?.url || value?.src || value?.data);
  if (!url) return null;
  const item = { kind: segment.type, url, mimeType: mediaMime(segment.type, url, value && typeof value === 'object' ? value.mimeType : undefined) };
  const alt = value && typeof value === 'object' && typeof value.alt === 'string' ? value.alt.trim().slice(0, 240) : '';
  const durationMs = value && typeof value === 'object' && Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.min(86_400_000, Number(value.durationMs))) : null;
  if (alt) item.alt = alt;
  if (durationMs !== null) item.durationMs = durationMs;
  return item;
}

function deferred(timeoutMs = 15_000) {
  let resolvePromise, rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => { resolvePromise = resolveValue; rejectPromise = rejectValue; });
  // The caller may still be waiting for another protocol event when this fails.
  promise.catch(() => {});
  const timer = setTimeout(() => rejectPromise(delayError()), timeoutMs);
  return {
    promise,
    resolve(value) { clearTimeout(timer); resolvePromise(value); },
    reject(error) { clearTimeout(timer); rejectPromise(error); },
  };
}

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Native WebUI must use a loopback HTTP origin.');
  return url;
}

/** One backend-only, authenticated connection can carry many private channels. */
export class NativeClient {
  constructor({ instanceDir, origin = 'http://127.0.0.1:18001', fetcher = fetch, WebSocketClass = WebSocket, timeoutMs = 15_000, onEvent = () => {}, onOffline = () => {} }) {
    this.instanceDir = instanceDir;
    this.origin = localOrigin(origin);
    this.fetcher = fetcher;
    this.WebSocketClass = WebSocketClass;
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.onOffline = onOffline;
    this.pending = new Map();
    this.opened = new Set();
    this.opening = new Map();
    this.histories = new Map();
    this.connected = false;
    this.connecting = null;
    this.socket = null;
    this.closed = false;
  }

  async connect() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    if (this.closed) throw nativeUnavailable();
    this.connecting = this.establish().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async establish() {
    let token;
    try {
      const credentials = JSON.parse(await readFile(join(this.instanceDir, 'data', 'webui.json'), 'utf8'));
      if (typeof credentials.access_token !== 'string' || !credentials.access_token) throw nativeUnavailable();
      const response = await this.fetcher(new URL('/api/webui/ws-token', this.origin), {
        headers: { Cookie: `maibot_session=${credentials.access_token}` },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
      });
      const result = await response.json();
      if (!response.ok || result.success !== true || typeof result.token !== 'string') throw nativeUnavailable();
      token = result.token;
    } catch { throw nativeUnavailable(); }
    const url = new URL('/api/webui/ws', this.origin);
    url.protocol = 'ws:';
    url.searchParams.set('token', token);
    const ready = deferred(this.timeoutMs);
    const socket = new this.WebSocketClass(url.href);
    this.socket = socket;
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      let packet;
      try { packet = JSON.parse(String(event.data)); } catch { return; }
      if (packet.op === 'event' && packet.domain === 'system' && packet.event === 'ready') {
        this.connected = true;
        ready.resolve();
      } else if (packet.op === 'response' && this.pending.has(packet.id)) {
        const waiter = this.pending.get(packet.id);
        this.pending.delete(packet.id);
        if (packet.ok) waiter.resolve(packet.data);
        else waiter.reject(fail('原生 MaiBot 拒绝了这次聊天操作。', 502, 'NATIVE_REQUEST_REJECTED'));
      } else if (packet.op === 'event' && packet.domain === 'chat' && UUID.test(packet.session || '')) {
        // Persistence handlers complete before the history barrier is released.
        Promise.resolve(this.onEvent(packet.session, packet.event, packet.data || {})).then(() => {
          if (packet.event === 'history') this.histories.get(packet.session)?.resolve();
        }, () => this.histories.get(packet.session)?.reject(fail('无法保存原生聊天记录。', 500, 'STORAGE_ERROR')));
      }
    });
    const offline = () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.opened.clear();
      ready.reject(nativeUnavailable());
      for (const waiter of this.pending.values()) waiter.reject(nativeUnavailable());
      this.pending.clear();
      for (const waiter of this.histories.values()) waiter.reject(nativeUnavailable());
      this.histories.clear();
      this.onOffline();
    };
    socket.addEventListener('error', offline);
    socket.addEventListener('close', offline);
    try { await ready.promise; }
    catch (error) { socket.close(); throw error; }
  }

  async call(method, session, data) {
    await this.connect();
    const id = randomUUID();
    const reply = deferred(this.timeoutMs);
    this.pending.set(id, reply);
    try {
      this.socket.send(JSON.stringify({ op: 'call', id, domain: 'chat', method, session, data }));
      return await reply.promise;
    } finally { this.pending.delete(id); }
  }

  async open(id) {
    await this.connect();
    if (this.opened.has(id)) return;
    if (this.opening.has(id)) return this.opening.get(id);
    const opening = (async () => {
      const history = deferred(this.timeoutMs);
      this.histories.set(id, history);
      try {
        await this.call('session.open', id, {
          user_id: `webui_user_${id}`, user_name: '你', restore: true,
          client: { type: 'webui', name: 'XUMENG Companion', version: '1' },
        });
        await history.promise;
        this.opened.add(id);
      } finally { this.histories.delete(id); }
    })().finally(() => this.opening.delete(id));
    this.opening.set(id, opening);
    return opening;
  }

  async send(id, text) {
    await this.open(id);
    return this.call('message.send', id, { content: text, user_name: '你' });
  }

  async proactive(id) {
    await this.open(id);
    return this.call('session.proactive', id, {});
  }

  async setStyle(id, style) {
    if (!style) return true;
    try {
      const credentials = JSON.parse(await readFile(join(this.instanceDir, 'data', 'webui.json'), 'utf8'));
      if (typeof credentials.access_token !== 'string' || !credentials.access_token) throw nativeUnavailable();
      const response = await this.fetcher(new URL(`/api/chat/sessions/${id}/xumeng-style`, this.origin), {
        method: 'PUT', headers: { Cookie: `maibot_session=${credentials.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify(style), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
      });
      // A fresh WebUI session may not have a database ChatSession row yet;
      // retrying after the first user message is safe and keeps style private.
      return response.ok || response.status === 404;
    } catch { return false; }
  }

  async readHistory(id) {
    if (!UUID.test(id)) throw fail('找不到这段对话。', 404, 'SESSION_NOT_FOUND');
    // History is an official authenticated REST route, not a WS call method.
    // It can recover an accepted input whose user_message event was missed.
    try {
      const credentials = JSON.parse(await readFile(join(this.instanceDir, 'data', 'webui.json'), 'utf8'));
      if (typeof credentials.access_token !== 'string' || !credentials.access_token) throw nativeUnavailable();
      const url = new URL('/api/chat/history', this.origin);
      url.searchParams.set('user_id', `webui_user_${id}`);
      url.searchParams.set('limit', '200');
      const response = await this.fetcher(url, {
        headers: { Cookie: `maibot_session=${credentials.access_token}` },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
      });
      const result = await response.json();
      if (!response.ok || result.success !== true || !Array.isArray(result.messages)) throw nativeUnavailable();
      return result.messages;
    } catch { throw fail('暂时无法同步原生聊天记录。', 503, 'NATIVE_HISTORY_UNAVAILABLE'); }
  }

  close() {
    this.closed = true;
    this.socket?.close();
  }
}

export function fromNative(message, event) {
  const role = event === 'bot_message' || message.is_bot === true || message.type === 'bot' ? 'assistant' : 'user';
  const nativeContent = typeof message.content === 'string' ? message.content : '';
  // processed_plain_text includes ReplyComponent's quoted source text. The
  // official rich segments distinguish a quote from the actual authored body.
  const segments = Array.isArray(message.segments) ? message.segments : null;
  const text = segments ? segments.filter(item => item?.type === 'text' && typeof item.data === 'string').map(item => item.data).join('') : nativeContent;
  const media = segments ? segments.map(normalizeMediaSegment).filter(Boolean) : [];
  // A binary-only message is a real message too. Previously these were
  // discarded, which made native emoji, photos and voice replies disappear
  // from both the live stream and the persisted session archive.
  if (!text.trim() && !media.length) return null;
  const quote = segments?.find(item => item?.type === 'reply' && item.data && typeof item.data === 'object')?.data;
  const replyTo = quote ? {
    messageId: typeof quote.target_message_id === 'string' ? quote.target_message_id : null,
    text: typeof quote.target_message_content === 'string' ? quote.target_message_content : '',
    senderName: typeof quote.target_message_sender_nickname === 'string' ? quote.target_message_sender_nickname : '',
  } : null;
  return {
    id: String(message.message_id || message.id || randomUUID()), role, text,
    createdAt: iso(message.timestamp), nativeId: message.message_id || message.id || null,
    ...(segments && nativeContent !== text ? { nativeContent } : {}),
    ...(media.length ? { media } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
}

// Native live bot events omit the stored message ID; reconcile them once with
// the DB-backed history snapshot on reconnect, preserving actual repetitions.
export function mergeNativeHistory(existing, history) {
  const merged = [...existing];
  const consumed = new Set();
  const removed = new Set();
  for (const message of history) {
    let index = merged.findIndex(item => item.id === message.id);
    const liveIndex = merged.findIndex((item, candidate) => {
      // Native creates the stored message before its simulated typing delay;
      // the live event is timestamped at delivery (observed > 6 seconds later).
      // Match one outstanding event to one DB record, never deduplicate text.
      const deliveryDelay = Date.parse(item.createdAt) - Date.parse(message.createdAt);
      const mediaPlaceholder = item.media?.length && item.nativeContent === message.text && !message.media?.length;
      return !removed.has(candidate) && !consumed.has(candidate) && !item.nativeId && item.role === message.role
        && (item.text === message.text || message.nativeContent && item.text === message.nativeContent || mediaPlaceholder)
        && deliveryDelay >= -1_000 && deliveryDelay <= (mediaPlaceholder ? 2_000 : 120_000);
    });
    if (index < 0) index = liveIndex;
    if (index >= 0) {
      const prior = liveIndex >= 0 ? merged[liveIndex] : merged[index];
      const requestId = message.requestId || prior.requestId;
      const media = message.media?.length ? message.media : prior.media;
      const placeholder = media?.length && !message.media?.length && prior.nativeContent === message.text;
      merged[index] = { ...message, ...(media?.length ? { media } : {}),
        ...(placeholder ? { text: prior.text, nativeContent: message.text } : {}), ...(requestId ? { requestId } : {}) };
      consumed.add(index);
      if (liveIndex >= 0 && liveIndex !== index) { consumed.add(liveIndex); removed.add(liveIndex); }
    }
    else { consumed.add(merged.length); merged.push(message); }
  }
  return merged.filter((_item,index) => !removed.has(index)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function associateRequest(session, message, { live = false } = {}) {
  if (message.role !== 'user' || !message.nativeId) return message;
  // First resolve stable native IDs. Replaying an existing event must never
  // consume the next pending receipt, even when both user messages are equal.
  const existing = session.messages.find(item => item.nativeId === message.nativeId);
  const receipts = Object.entries(session.receipts);
  let match = receipts.find(([requestId, receipt]) => receipt.nativeMessageId === message.nativeId
    || requestId === existing?.requestId);
  if (!match && !existing) {
    // The official ACK currently lacks message_id, so associate the first
    // still-unmatched send in this private session. Submission order is stored
    // by the per-session send queue. A DB history record predating that send
    // cannot consume its receipt merely because it has the same text.
    match = receipts.find(([, receipt]) => !receipt.nativeMessageId
      && ['sending', 'accepted', 'uncertain'].includes(receipt.status)
      && receipt.text === message.text && (live || Date.parse(message.createdAt) >= Date.parse(receipt.createdAt)));
  }
  if (!match) return existing?.requestId ? { ...message, requestId: existing.requestId } : message;
  const [requestId, receipt] = match;
  receipt.nativeMessageId = message.nativeId;
  receipt.status = 'accepted';
  return { ...message, requestId };
}

export async function createGateway({ instanceDir = resolve(ROOT, 'instance'), origin = 'http://127.0.0.1:18001', nativeClient, nativeOptions = {}, historyRefreshMs = 3_000, now = Date.now, profile = 'classic' } = {}) {
  const companionName = {classic:'陆时予',intimate:'沈聿',traveler:'季临川'}[profile];
  if (!companionName) throw new Error('Invalid Qingyu companion profile');
  const sessionsDir = join(instanceDir, 'gateway-sessions');
  await mkdir(sessionsDir, { recursive: true, mode: 0o700 });
  const sessions = new Map();
  const writes = new Map();
  const sends = new Map();
  const historyReads = new Map();
  const historyAttempts = new Map();
  let lastError = null;
  for (const name of await readdir(sessionsDir)) {
    if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) continue;
    const value = JSON.parse(await readFile(join(sessionsDir, name), 'utf8'));
    if (value.id === name.slice(0, -5) && Array.isArray(value.messages)) {
      value.receipts ??= {};
      // Existing titles are preserved; only newly created sessions assign one.
      value.titleAssigned ??= true;
      for (const receipt of Object.values(value.receipts)) {
        if (receipt.status === 'sending') receipt.status = 'uncertain';
      }
      value.typing = false;
      sessions.set(value.id, value);
    }
  }
  const persist = session => {
    const snapshot = JSON.stringify(session);
    const job = (writes.get(session.id) || Promise.resolve()).catch(() => {}).then(async () => {
      const path = join(sessionsDir, `${session.id}.json`);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, path);
    });
    writes.set(session.id, job);
    return job;
  };
  const attachSpeechReview = async message => {
    if (message?.role !== 'assistant' || !Array.isArray(message.media)) return message;
    for (const media of message.media) {
      if (media.kind !== 'voice' || typeof media.url !== 'string') continue;
      const match = /^data:audio\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(media.url);
      if (!match) continue;
      const sha256 = createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex');
      try {
        const proof = JSON.parse(await readFile(join(instanceDir, 'data', 'qingyu-reviewed-speech', `${sha256}.json`), 'utf8'));
        if (proof.sha256 === sha256) media.qingyuSpeechReview = proof;
      } catch { /* Unreviewed audio remains untrusted at the public boundary. */ }
    }
    return message;
  };
  const onEvent = async (id, event, data) => {
    const session = sessions.get(id);
    if (!session) return;
    if (event === 'history' && Array.isArray(data.messages)) {
      const history = data.messages.map(item => fromNative(item)).filter(Boolean)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map(item => associateRequest(session, item));
      await Promise.all(history.map(attachSpeechReview));
      session.messages = mergeNativeHistory(session.messages, history);
      session.historySyncedAt = new Date().toISOString();
    } else if (event === 'user_message' || event === 'bot_message') {
      const incoming = fromNative(data, event);
      const message = incoming && associateRequest(session, incoming, { live: true });
      await attachSpeechReview(message);
      if (message && !session.messages.some(item => item.id === message.id)) session.messages.push(message);
      if (event === 'bot_message') session.typing = false;
    } else if (event === 'typing') session.typing = data.is_typing === true;
    else if (event === 'error') session.error = '原生 MaiBot 处理这条消息时遇到问题。';
    else return;
    session.updatedAt = session.messages.at(-1)?.createdAt || session.updatedAt;
    await persist(session);
  };
  const native = nativeClient || new NativeClient({ instanceDir, origin, ...nativeOptions });
  native.onEvent = onEvent;
  native.onOffline = () => { for (const session of sessions.values()) session.typing = false; };

  const confirmed = (session, requestId) => session.messages.some(item => item.role === 'user' && item.requestId === requestId);
  const refreshPendingHistory = async session => {
    const pending = Object.entries(session.receipts).some(([requestId, receipt]) =>
      ['accepted', 'uncertain'].includes(receipt.status) && !confirmed(session, requestId));
    if (!pending || !native.connected) return;
    if (historyReads.has(session.id)) return historyReads.get(session.id);
    if (Date.now() - (historyAttempts.get(session.id) || 0) < historyRefreshMs) return;
    historyAttempts.set(session.id, Date.now());
    const reading = (async () => {
      try { await onEvent(session.id, 'history', { messages: await native.readHistory(session.id) }); }
      catch { /* Keep the receipt unconfirmed. An ACK is never a synthetic message. */ }
    })().finally(() => historyReads.delete(session.id));
    historyReads.set(session.id, reading);
    return reading;
  };

  const view = session => ({
    id: session.id, title: session.title, characterId: 'yume', createdAt: session.createdAt, updatedAt: session.updatedAt,
    messages: session.messages.map(({ id, role, text, createdAt, requestId, media }) => ({ id, role, text, createdAt,
      ...(requestId ? { requestId } : {}), ...(Array.isArray(media) && media.length ? { media } : {}) })),
    receipts: Object.entries(session.receipts).map(([requestId, receipt]) => ({
      requestId, status: receipt.status, confirmed: confirmed(session, requestId),
    })),
    connection: native.connected && native.opened.has(session.id) ? 'connected' : native.connecting ? 'connecting' : 'offline',
    status: session.typing ? 'thinking' : 'idle',
    ...(session.error ? { error: session.error } : {}),
  });
  const publicInfo = async () => {
    try {
      const info = JSON.parse(await readFile(join(instanceDir, 'runtime-info.json'), 'utf8'));
      return {
        version: typeof info.version === 'string' ? info.version : null,
        provider: { configured: info.provider?.configured === true, model: typeof info.provider?.model === 'string' ? info.provider.model : null },
        memory: { implementation: 'A_Memorix', enabled: info.memory?.enabled === true },
        plugins: { implementation: 'MaiBot native plugin runtime', enabled: info.plugins?.enabled === true },
      };
    } catch { return { version: null, provider: { configured: false, model: null }, memory: { implementation: 'A_Memorix', enabled: false }, plugins: { implementation: 'MaiBot native plugin runtime', enabled: false } }; }
  };
  const health = async () => {
    try { await native.connect(); lastError = null; } catch { lastError = 'NATIVE_OFFLINE'; }
    return { runtime: 'maibot-native', ready: native.connected, transportReady: native.connected, readinessScope: 'native-webui-transport', ...await publicInfo(), ...(lastError ? { code: lastError, reason: '原生 MaiBot 尚未连接。' } : {}) };
  };
  const find = id => {
    const session = sessions.get(id);
    if (!session) throw fail('找不到这段对话。', 404, 'SESSION_NOT_FOUND');
    return session;
  };
  const create = async body => {
    if (body.characterId !== 'yume') throw fail(`当前原生实例提供${companionName}。`, 400, 'CHARACTER_UNAVAILABLE');
    if (body.style && (!body.style.version || typeof body.style.personality !== 'string' || typeof body.style.speakingStyle !== 'string' || typeof body.style.relationshipStyle !== 'string'))
      throw fail('陪伴设定格式无效。', 400, 'INVALID_STYLE');
    await native.connect();
    const id = randomUUID(), now = new Date().toISOString();
    const session = { id, title: `和${companionName}的聊天`, titleAssigned: false, characterId: 'yume', style: body.style || null, createdAt: now, updatedAt: now, messages: [], receipts: {} };
    sessions.set(id, session);
    await persist(session);
    await native.open(id);
    if (session.style) await native.setStyle(id, session.style);
    return { session: view(session) };
  };
  const read = async id => {
    const session = find(id);
    try { await native.open(id); } catch { /* Expose saved history and offline state; never fabricate a reply. */ }
    await refreshPendingHistory(session);
    return { session: view(session) };
  };
  const send = async (id, body) => {
    const session = find(id);
    if (!validNativeMessageText(body.text)
      || !UUID.test(body.requestId || '')) throw fail('消息需为 1–4000 字，并包含有效的请求编号。', 400, 'INVALID_MESSAGE');
    const requestId = body.requestId, text = body.text.trim();
    const task = (sends.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      const prior = session.receipts[requestId];
      if (prior) {
        if (prior.text !== text) throw fail('同一个请求编号不能用于不同消息。', 409, 'REQUEST_CONFLICT');
        try { await native.open(id); } catch { /* A known accepted request is never sent a second time. */ }
        await refreshPendingHistory(session);
        if (prior.status === 'accepted') return { accepted: true, requestId };
        throw fail('这条消息的送达状态未确认，请先查看聊天记录。', 409, 'DELIVERY_UNCERTAIN');
      }
      // Connect before recording intent. Connection failures are safe to retry.
      await native.open(id);
      session.receipts[requestId] = { status: 'sending', text, createdAt: new Date().toISOString() };
      await persist(session);
      try {
        if (session.style && !(await native.setStyle(id, session.style))) throw fail('当前聊天设定尚未保存，请稍后重试。', 503, 'STYLE_UNAVAILABLE');
        const ack = await native.send(id, text);
        if (typeof ack?.message_id === 'string' && ack.message_id) session.receipts[requestId].nativeMessageId ??= ack.message_id;
        session.receipts[requestId].status = 'accepted';
        delete session.error;
        if (!session.titleAssigned) { session.title = text.slice(0, 28); session.titleAssigned = true; }
        await persist(session);
        return { accepted: true, requestId };
      } catch (error) {
        // A user_message echo is positive evidence even if its earlier ACK was
        // lost. Do not turn confirmed delivery into a retryable duplicate.
        if (session.messages.some(item => item.requestId === requestId)) {
          session.receipts[requestId].status = 'accepted';
          if (!session.titleAssigned) { session.title = text.slice(0, 28); session.titleAssigned = true; }
          await persist(session);
          return { accepted: true, requestId };
        }
        session.receipts[requestId].status = 'uncertain';
        await persist(session);
        throw error;
      }
    });
    sends.set(id, task);
    return task;
  };

  const proactive = async (id, body) => {
    if (Object.keys(body).some(key => key !== 'userMessageId') || typeof body.userMessageId !== 'string'
      || !body.userMessageId.trim() || body.userMessageId.length > 160 || /[\u0000-\u001f\u007f]/.test(body.userMessageId)) {
      throw fail('主动消息的上下文编号无效。', 400, 'INVALID_MESSAGE');
    }
    const task = (sends.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      const session = find(id);
      await native.open(id);
      const user = [...session.messages].reverse().find(item => item.role === 'user');
      const assistant = [...session.messages].reverse().find(item => item.role === 'assistant');
      if (!user || user.id !== body.userMessageId || !assistant || session.typing
        || !Number.isFinite(Date.parse(user.createdAt)) || !Number.isFinite(Date.parse(assistant.createdAt))
        || Date.parse(assistant.createdAt) < Date.parse(user.createdAt)
        || now() - Math.max(Date.parse(user.createdAt), Date.parse(assistant.createdAt)) < 45_000) {
        return { queued: false, reason: 'not-idle' };
      }
      if (/晚安|先忙|不想聊|别发|不要发|停止|停下|good\s*night|leave me alone/i.test(user.text)) {
        return { queued: false, reason: 'quiet-requested' };
      }
      session.proactiveRequests ??= {};
      const anchorKey = `message:${user.id}`;
      const prior = session.proactiveRequests[anchorKey];
      if (prior) return { queued: prior.status === 'queued', replayed: true,
        ...(prior.status === 'uncertain' ? { reason: 'delivery-uncertain' } : {}) };
      // Intent is durable before the native planner is awakened. A lost ACK
      // never grants a second wake-up or creates a synthetic user message.
      session.proactiveRequests[anchorKey] = { status: 'uncertain', requestedAt: now() };
      await persist(session);
      try {
        const result = await native.proactive(id);
        if (result?.queued !== true) throw nativeUnavailable();
        session.proactiveRequests[anchorKey].status = 'queued';
        await persist(session);
        return { queued: true };
      } catch {
        return { queued: false, reason: 'delivery-uncertain' };
      }
    });
    sends.set(id, task);
    return task;
  };

  const server = createServer(async (req, res) => {
    const answer = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const requestOrigin = `http://${req.headers.host}`;
      if (!LOOPBACK.has(new URL(requestOrigin).hostname) || req.headers['sec-fetch-site'] === 'cross-site'
        || (req.headers.origin && req.headers.origin !== requestOrigin)) throw fail('请从本机晴屿页面访问。', 403, 'ORIGIN_REJECTED');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(302, { Location: 'http://127.0.0.1:5186/#chat', 'Cache-Control': 'no-store' });
        return res.end();
      }
      let body;
      if (req.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail('请提交 JSON。', 415, 'INVALID_CONTENT_TYPE');
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 24_000) throw fail('消息太长。', 413, 'BODY_TOO_LARGE'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail('消息格式有误。', 400, 'INVALID_JSON'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw fail('消息格式有误。', 400, 'INVALID_JSON');
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return answer(200, await health());
      if (url.pathname === '/api/sessions') {
        if (req.method === 'GET') return answer(200, { sessions: [...sessions.values()].map(view).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        if (req.method === 'POST') return answer(201, await create(body));
      }
      const match = /^\/api\/sessions\/([^/]+)(?:\/(messages|proactive))?$/.exec(url.pathname);
      if (match && UUID.test(match[1])) {
        if (req.method === 'GET' && !match[2]) return answer(200, await read(match[1]));
        if (req.method === 'POST' && match[2] === 'messages') return answer(202, await send(match[1], body));
        if (req.method === 'POST' && match[2] === 'proactive') return answer(202, await proactive(match[1], body));
      }
      throw fail('找不到这个操作。', 404, 'NOT_FOUND');
    } catch (error) {
      const known = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) && error.status;
      answer(known ? error.status : 500, { error: known ? error.message : '聊天服务遇到了问题。', code: known ? error.code : 'GATEWAY_ERROR' });
    }
  });
  return { server, native, health, create, read, send, proactive, sessions, async close() { native.close(); await Promise.allSettled([...writes.values()]); await new Promise(resolveClose => server.close(resolveClose)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = await createGateway({ instanceDir: resolve(process.env.MAIBOT_INSTANCE_DIR || join(ROOT, 'instance')), origin: process.env.MAIBOT_WEBUI_URL || 'http://127.0.0.1:18001', profile: process.env.COMPANION_PROFILE || 'classic' });
  const port = Number(process.env.MAIBOT_GATEWAY_PORT || 3227);
  gateway.server.listen(port, '127.0.0.1', () => console.log(`MaiBot native companion gateway: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => gateway.close().then(() => process.exit(0)));
}
