import { CAST_PROFILES, companionProfile, type HostProfile } from './cast';
/** Durable coordination only. The native runtime owns character and memory logic. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDLE_MS = 10 * 60_000;
// A text-only history match is a compatibility fallback for native bridges
// that omit requestId metadata. Keep it bounded on both sides of the receipt
// timestamp so an old/repeated phrase cannot later unlock a different turn.
const TEXT_RECONCILIATION_WINDOW_MS = 2 * 60_000;
export const CONTAINER_INACTIVITY_MS = 6 * 60 * 60_000;
const JSON_LIMIT = 2 * 1024 * 1024;
const SNAPSHOT_LIMIT = 1024 * 1024 * 1024;

export interface HostEnv {
  COMPANION_OPENROUTER_API_KEY?: string;
  COMPANION_OPENROUTER_BASE_URL?: string;
  COMPANION_CHAT_MODEL?: string;
  COMPANION_FAST_MODEL?: string;
  COMPANION_EMBEDDING_MODEL?: string;
  COMPANION_EMBEDDING_DIMENSION?: string;
  COMPANION_IMAGE_MODEL?: string;
  COMPANION_IMAGE_RESOLUTION?: string;
  COMPANION_IMAGE_QUALITY?: string;
  COMPANION_TTS_MODEL?: string;
  COMPANION_TTS_VOICE?: string;
  COMPANION_BREEZE_API_KEY?: string;
  COMPANION_BREEZE_VOICE?: string;
  COMPANION_AGREEMENTS_ACCEPTED?: string;
  COMPANION_EULA_MD5?: string;
  COMPANION_PRIVACY_MD5?: string;
  COMPANION_BILLING_ENABLED?: string;
  COMPANION_POOL_ENABLED?: string;
  BILLING?: CompanionBillingBinding;
}
export interface CompanionBillingBinding {
  companionReserve(input: { sessionToken: string; accountId: string; requestId: string; sessionId: string; requestFingerprint: string }): Promise<any>;
  companionFinalize(input: { accountId: string; reservationId: string; claimToken: string; outcome: 'completed' | 'failed' }): Promise<any>;
  companionGet(input: { accountId: string; reservationId: string; claimToken: string }): Promise<any>;
}
export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
  setAlarm(time: number): Promise<void>;
  getAlarm(): Promise<number | null>;
}
export interface Snapshot {
  key: string; size: number; sha256: string; etag: string; savedAt: number;
}
export interface StoredObject {
  body: ReadableStream<Uint8Array>; size: number; etag: string;
  sha256?: string; metadata: Record<string, string>;
}
export interface Bucket {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: ReadableStream<Uint8Array> | string, options: {
    length?: number; sha256?: string; metadata: Record<string, string>; contentType: string;
  }): Promise<{ etag: string }>;
}
export interface Runtime {
  isRunning(): Promise<boolean>;
  start(env: Record<string, string>): Promise<void>;
  setInactivityTimeout(ms: number): Promise<void>;
  fetch(path: string, init: RequestInit): Promise<Response>;
  destroy(): Promise<void>;
}
/** Shared containers that each host several isolated native tenants. */
export interface RuntimePool {
  shards: number;
  runtime(shard: number, tenant: string): Runtime;
}
export class PoolFullError extends Error {}
interface RuntimeState {
  accountId: string; profile?: Exclude<HostProfile, 'classic'>; token: string; phase: 'new' | 'starting' | 'running' | 'stopped';
  dirty: boolean; bootId?: string; snapshot?: Snapshot; lastActivity: number;
  blocked?: string; checkpointError?: boolean; checkpointFailure?: string; restoreRequired?: boolean; restoreTemplate?: HostProfile; transcriptParked?: boolean;
  runtime?: 'pool'; tenant?: string; poolShard?: number;
}
type BootPhase = 'container' | 'controller' | 'restore' | 'native';
export interface BootMetrics {
  runtime: 'pool' | 'legacy'; profile: HostProfile; outcome: string; startedAt: number; totalMs: number;
  phases: Partial<Record<BootPhase, number>>; native?: Record<string, number>;
}
type ControllerHealth = { bootId: string; runtimeStarted: boolean };
class BootTracker {
  readonly startedAt: number;
  readonly phases: Partial<Record<BootPhase, number>> = {};
  native?: Record<string, number>;
  measured = false;
  private since = 0;
  constructor(private now: () => number, private onPhase: (phase: BootPhase) => void) { this.startedAt = now(); }
  enter(phase: BootPhase) { this.onPhase(phase); this.since = this.now(); }
  leave(phase: BootPhase) { this.phases[phase] = this.now() - this.since; }
}
const BOOT_WAIT_MS = 1_500;
const BOOT_METRICS_LIMIT = 20;
const SHARED_ENV_KEYS = ['COMPANION_OPENROUTER_API_KEY', 'COMPANION_CHAT_MODEL', 'COMPANION_EMBEDDING_MODEL',
  'COMPANION_EMBEDDING_DIMENSION', 'COMPANION_AGREEMENTS_ACCEPTED', 'COMPANION_EULA_MD5', 'COMPANION_PRIVACY_MD5'] as const;
const OPTIONAL_ENV_KEYS = ['COMPANION_FAST_MODEL', 'COMPANION_OPENROUTER_BASE_URL', 'COMPANION_IMAGE_MODEL', 'COMPANION_IMAGE_RESOLUTION',
  'COMPANION_IMAGE_QUALITY', 'COMPANION_TTS_MODEL', 'COMPANION_TTS_VOICE', 'COMPANION_BREEZE_API_KEY', 'COMPANION_BREEZE_VOICE'] as const;
/** Provider configuration shared by every runtime; contains no account identity. */
export function sharedEnvironment(source: HostEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SHARED_ENV_KEYS) {
    const value = source[key];
    if (!value) throw new HostError(503, 'CONFIGURATION_REQUIRED', '聊天服务尚未完成配置。');
    env[key] = value;
  }
  for (const key of OPTIONAL_ENV_KEYS) {
    const value = source[key];
    if (value) env[key] = value;
  }
  if (env.COMPANION_AGREEMENTS_ACCEPTED !== '1') throw new HostError(503, 'AGREEMENTS_REQUIRED', '聊天服务尚未完成配置。');
  return env;
}
interface Receipt {
  fingerprint: string; status: 'pending' | 'complete' | 'uncertain'; receivedAt: number;
  requestId: string; sessionId: string; text: string;
  response?: { status: number; body: string };
  billing?: { reservationId: string; claimToken: string; status: 'reserved' | 'settled' | 'released'; replyBaseline?: number };
}
interface PublicReceipt {
  requestId: string; status: Receipt['status']; receivedAt: number; confirmed: boolean;
}
type ReceiptSummary = { requestId: string; status: Receipt['status']; receivedAt: number; confirmed: boolean };
interface CompanionStyle { version: 1; personality: string; speakingStyle: string; relationshipStyle: string }
class HostError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}
export function problem(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  const retryAfter = status === 503 ? (code === 'CONTAINER_STARTING' || code === 'NATIVE_NOT_READY' ? '5' : '30') : undefined;
  return json({ error, code, ready: false, ...extra }, status, retryAfter ? { 'retry-after': retryAfter } : undefined);
}
function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}
async function limitedText(response: Response, limit = JSON_LIMIT): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new HostError(502, 'RESPONSE_TOO_LARGE', '聊天记录过大，需人工检查。'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(buffer);
}
async function hash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function route(path: string, method: string): boolean {
  if (method === 'GET' && (path === '/api/health' || path === '/api/sessions')) return true;
  if (method === 'POST' && (path === '/api/sessions' || path === '/api/reset')) return true;
  const style = /^\/api\/sessions\/([^/]+)\/style$/.exec(path);
  if (style) return method === 'PUT' && UUID.test(style[1]);
  const match = /^\/api\/sessions\/([^/]+)(\/messages|\/proactive|\/receipts\/([^/]+))?$/.exec(path);
  return !!match && UUID.test(match[1]) && (
    method === 'GET' && (!match[2] || (match[3] !== undefined && UUID.test(match[3])))
    || method === 'POST' && (match[2] === '/messages' || match[2] === '/proactive')
  );
}
function readStyle(value: unknown): CompanionStyle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || Object.keys(candidate).some(key => !['version', 'personality', 'speakingStyle', 'relationshipStyle'].includes(key))) return null;
  if (!['personality', 'speakingStyle', 'relationshipStyle'].every(key => typeof candidate[key] === 'string'
    && (candidate[key] as string).trim().length > 0 && (candidate[key] as string).length <= 600)) return null;
  return { version: 1, personality: (candidate.personality as string).trim(), speakingStyle: (candidate.speakingStyle as string).trim(), relationshipStyle: (candidate.relationshipStyle as string).trim() };
}
function chooseMemorySession(sessions: unknown): { id: string } | null {
  if (!Array.isArray(sessions)) return null;
  const valid = sessions.filter((item): item is { id: string; messages?: unknown[]; createdAt?: string } => {
    if (!item || typeof item !== 'object') return false;
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' && UUID.test(id);
  });
  if (!valid.length) return null;
  valid.sort((left, right) => {
    const byCount = (Array.isArray(right.messages) ? right.messages.length : 0) - (Array.isArray(left.messages) ? left.messages.length : 0);
    if (byCount) return byCount;
    return String(left.createdAt || '\uffff').localeCompare(String(right.createdAt || '\uffff'));
  });
  return { id: valid[0].id.toLowerCase() };
}
function openingPrefix(lines: readonly string[], text: string) {
  return `[XUMENG_OPENING v1]\n以下是你在对方开口之前已经发出的原话，按顺序，属于你说过的内容。接下去不要重复背诵：\n${lines.join('\n')}\n[/XUMENG_OPENING]\n${text}`;
}
function stripStyle(value: string) {
  return value
    .replace(/^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n/, '')
    .replace(/\[XUMENG_OPENING v1\][\s\S]*?\[\/XUMENG_OPENING\]\n?/g, '');
}
function readOpening(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const line = item.trim();
    if (!line || line.length > 160) return null;
    lines.push(line);
  }
  return lines;
}
function publicReceipt(value: unknown): PublicReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!UUID.test(String(candidate.requestId || ''))) return null;
  // Older native bridges call the positive acknowledgement `accepted` while
  // newer ones use `complete`. Normalize both to the same safe public state.
  if (candidate.status !== 'pending' && candidate.status !== 'accepted' && candidate.status !== 'complete' && candidate.status !== 'uncertain') return null;
  if (typeof candidate.receivedAt !== 'number' || !Number.isFinite(candidate.receivedAt)) return null;
  const status = candidate.status === 'accepted' ? 'complete' : candidate.status as Receipt['status'];
  return { requestId: String(candidate.requestId), status, receivedAt: candidate.receivedAt, confirmed: status === 'complete' };
}
function sanitizeSessionBody(body: string, receipts: PublicReceipt[] = [], title = '和林幺的聊天') {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    const sessions = value.session ? [value.session] : Array.isArray(value.sessions) ? value.sessions : [];
    for (const session of sessions) if (session && typeof session === 'object' && Array.isArray((session as any).messages)) {
      (session as any).messages = (session as any).messages.map((message: any) => message && typeof message.text === 'string' ? { ...message, text: stripStyle(message.text) } : message);
      if (typeof (session as any).title === 'string' && (session as any).title.includes('[XUMENG_PRIVATE_STYLE')) (session as any).title = title;
      const existing = Array.isArray((session as any).receipts) ? (session as any).receipts : [];
      const byRequest = new Map<string, PublicReceipt>();
      for (const receipt of existing) {
        const safe = publicReceipt(receipt);
        if (safe) byRequest.set(safe.requestId.toLowerCase(), safe);
      }
      for (const receipt of receipts) if (!byRequest.has(receipt.requestId.toLowerCase())) byRequest.set(receipt.requestId.toLowerCase(), receipt);
      if (byRequest.size > 0 || existing.length > 0 || receipts.length > 0) (session as any).receipts = [...byRequest.values()];
    }
    return JSON.stringify(value);
  } catch { return body; }
}

/** Pure coordinator, with adapters so recovery ordering can be tested without AI. */
export class CompanionHost {
  private queue: Promise<unknown> = Promise.resolve();
  // A cold start runs outside the request queue so polling, receipt reads and
  // style saves are not held behind a multi-minute native boot.
  private boot: Promise<void> | null = null;
  private bootFailure: unknown = null;
  private bootPhase: BootPhase = 'container';
  private bootStartedAt = 0;
  constructor(private storage: Storage, private memory: Bucket, private runtime: Runtime,
    private env: HostEnv, private now = () => Date.now(),
    private delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    private pool?: RuntimePool, private log: (line: string) => void = line => console.log(line)) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(fn);
    this.queue = result.catch(() => {}); return result;
  }

  fetch(request: Request): Promise<Response> {
    return this.serialize(async () => {
      try { return await this.handle(request); }
      catch (error) {
        return error instanceof HostError ? problem(error.status, error.code, error.message, error.extra)
          : problem(503, 'COMPANION_UNAVAILABLE', '聊天服务暂不可用，记录保留中，请稍后查看。');
      }
    });
  }

  private rt(state: RuntimeState): Runtime {
    if (state.runtime === 'pool') {
      if (!this.pool || !state.tenant || state.poolShard === undefined) throw new HostError(503, 'COMPANION_UNAVAILABLE', '聊天服务暂不可用，记录保留中，请稍后查看。');
      return this.pool.runtime(state.poolShard, state.tenant);
    }
    return this.runtime;
  }
  private poolEnabled() { return this.env.COMPANION_POOL_ENABLED === 'true' && !!this.pool && this.pool.shards > 0; }
  private starting(): HostError {
    return new HostError(503, 'CONTAINER_STARTING', '聊天服务正在启动，请稍后查看。',
      { phase: this.bootPhase, elapsedMs: Math.max(0, this.now() - this.bootStartedAt) });
  }
  /** Run ready() in the background; answer within BOOT_WAIT_MS either way. */
  private async ensureReady(state: RuntimeState): Promise<void> {
    if (this.boot) throw this.starting();
    if (this.bootFailure) { const failure = this.bootFailure; this.bootFailure = null; throw failure; }
    // A running instance only needs its liveness check. Await it inline: in
    // pool mode that check crosses two objects and can exceed BOOT_WAIT_MS,
    // which must not turn a live chat into an endless "starting" answer.
    if (state.phase === 'running' && !state.blocked) return this.ready(state);
    let waiting = true;
    this.bootPhase = 'container'; this.bootStartedAt = this.now();
    const boot: Promise<void> = this.ready(state).catch(error => {
      if (!waiting) this.bootFailure = error;
      throw error;
    }).finally(() => { if (this.boot === boot) this.boot = null; });
    this.boot = boot;
    boot.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const elapsed = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), BOOT_WAIT_MS); });
    try {
      const finished = await Promise.race([boot.then(() => true as const), elapsed]);
      if (!finished) { waiting = false; throw this.starting(); }
    } finally { clearTimeout(timer); }
  }
  private async recordBoot(state: RuntimeState, tracker: BootTracker, outcome: string) {
    const metrics: BootMetrics = { runtime: state.runtime === 'pool' ? 'pool' : 'legacy', profile: state.profile ?? 'classic',
      outcome, startedAt: tracker.startedAt, totalMs: this.now() - tracker.startedAt, phases: tracker.phases,
      ...(tracker.native ? { native: tracker.native } : {}) };
    this.log(JSON.stringify({ event: 'companion_boot', ...metrics }));
    try {
      const previous = await this.storage.get<BootMetrics[]>('boot-metrics') || [];
      await this.storage.put('boot-metrics', [...previous, metrics].slice(-BOOT_METRICS_LIMIT));
    } catch { /* Metrics never block a chat. */ }
  }
  private async startRuntime(state: RuntimeState, env: Record<string, string>) {
    if (state.runtime !== 'pool') return this.runtime.start(env);
    const pool = this.pool!;
    const preferred = (state.poolShard ?? 0) % pool.shards;
    for (let offset = 0; offset < pool.shards; offset++) {
      state.poolShard = (preferred + offset) % pool.shards;
      // Persist the shard before creating the tenant so a restarted object finds it.
      await this.save(state);
      try { return await pool.runtime(state.poolShard, state.tenant!).start(env); }
      catch (error) { if (!(error instanceof PoolFullError)) throw error; }
    }
    throw new HostError(503, 'POOL_FULL', '聊天的人有点多，请稍后再试。');
  }
  /** A clean account (no live runtime, nothing unsaved) may move between modes. */
  private async chooseRuntime(state: RuntimeState) {
    if (this.poolEnabled() && state.runtime !== 'pool') {
      state.runtime = 'pool';
      state.tenant = await hash(`xumeng-companion-tenant:${state.profile ?? 'classic'}:${state.accountId}`);
      state.poolShard = parseInt(state.tenant.slice(0, 8), 16) % this.pool!.shards;
    } else if (!this.poolEnabled() && state.runtime === 'pool') {
      delete state.runtime; delete state.tenant; delete state.poolShard;
    }
  }

  private async getState(account: string, profile: HostProfile): Promise<RuntimeState> {
    let state = await this.storage.get<RuntimeState>('runtime');
    if (state && (state.accountId !== account || (state.profile ?? 'classic') !== profile)) throw new HostError(403, 'ACCOUNT_MISMATCH', '无法访问这段聊天。');
    if (!state) {
      state = { accountId: account, token: crypto.randomUUID() + crypto.randomUUID(), phase: 'new', dirty: false, lastActivity: this.now(), ...(profile === 'classic' ? {} : { profile }) };
      await this.save(state);
    }
    return state;
  }
  private archiveRoot(state: RuntimeState) {
    return state.profile ? `accounts/${state.accountId}/${state.profile}` : `accounts/${state.accountId}`;
  }
  private save(state: RuntimeState) { return this.storage.put('runtime', state); }
  private async blocked(state: RuntimeState, reason: string): Promise<never> {
    state.blocked = reason; await this.save(state);
    throw new HostError(503, 'RECOVERY_REVIEW_REQUIRED', '聊天实例异常中断，已保留备份和送达记录，需核查恢复后继续。');
  }
  private async resetEmptyLostInstance(state: RuntimeState): Promise<boolean> {
    if (!['unexpected-container-loss', 'unexpected-native-stop', 'unexpected-controller-restart'].includes(state.blocked || '') || state.snapshot) return false;
    // Only inspect durable key names. A runtime with no other durable key has
    // no recoverable conversation state to discard; a fresh runtime is safe.
    // Keep review for every unknown key as well, so a future state record does
    // not accidentally get treated as disposable by this recovery path.
    const keys = await this.storage.list();
    const hasData = [...keys.keys()].some(key => key !== 'runtime' && key !== 'boot-metrics');
    if (hasData) return false;
    // A failed native process can leave the controller/container alive but
    // unable to accept a new start. Destroy only this empty instance before
    // clearing the marker; never do this when durable state exists.
    const runtime = this.rt(state);
    if (await runtime.isRunning()) {
      try { await runtime.destroy(); } catch { return false; }
      if (await runtime.isRunning()) return false;
    }
    state.blocked = undefined; state.phase = 'new'; state.dirty = false;
    delete state.bootId; delete state.snapshot; delete state.restoreRequired; delete state.checkpointError;
    state.lastActivity = this.now(); await this.save(state); return true;
  }
  private async resetAbandonedInstance(state: RuntimeState): Promise<Response> {
    if (!state.blocked) throw new HostError(409, 'RESET_NOT_REQUIRED', '当前聊天不需要重建。');
    if (this.boot) throw new HostError(409, 'BOOT_IN_PROGRESS', '聊天正在启动，请稍后再重建。');
    const runtime = this.rt(state);
    if (await runtime.isRunning()) {
      try { await runtime.destroy(); } catch { throw new HostError(503, 'RESET_FAILED', '当前聊天仍在停止，暂时无法重建。'); }
      if (await runtime.isRunning()) throw new HostError(503, 'RESET_FAILED', '当前聊天仍在停止，暂时无法重建。');
    }
    // Keep request receipts and R2 observations for delivery/accounting audit,
    // but remove pointers that could make the abandoned native instance look
    // like a restorable conversation. A fresh token also invalidates an old
    // controller if it returns after the explicit reset.
    const keys = await this.storage.list();
    for (const key of keys.keys()) {
      if (key === 'send-window' || key === 'memory-session' || key.startsWith('session:') || key.startsWith('style:')) await this.storage.delete(key);
    }
    state.token = crypto.randomUUID() + crypto.randomUUID();
    state.phase = 'new'; state.dirty = false; state.lastActivity = this.now();
    delete state.blocked; delete state.bootId; delete state.snapshot; delete state.restoreRequired; delete state.checkpointError; delete state.transcriptParked;
    await this.save(state);
    await this.storage.setAlarm(state.lastActivity + IDLE_MS);
    return json({ reset: true, ready: false, message: '当前异常实例已放弃，旧审计记录保留，可以重新建立一段聊天。' });
  }
  /** A character has one memory. Another create reopens that session. */
  private async reuseMemorySession(state: RuntimeState): Promise<Response | null> {
    const listed = await this.call(state, '/api/sessions');
    let sessions: unknown[] = [];
    if (listed.ok) {
      try { sessions = JSON.parse(await limitedText(listed))?.sessions ?? []; } catch { sessions = []; }
    }
    const remembered = await this.storage.get<string>('memory-session');
    const fromList = chooseMemorySession(sessions)?.id || '';
    const memory = fromList || (remembered && UUID.test(remembered) ? remembered.toLowerCase() : '');
    if (!memory) return null;
    const full = await this.call(state, `/api/sessions/${memory}`);
    if (!full.ok) {
      if (full.status === 404) await this.storage.delete('memory-session');
      return null;
    }
    await this.storage.put('memory-session', memory);
    return new Response(await limitedText(full), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  private call(state: RuntimeState, path: string, init: RequestInit = {}, timeout = 30_000) {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${state.token}`);
    return this.rt(state).fetch(path, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  }
  private assistantCount(messages: unknown): number {
    if (!Array.isArray(messages)) return 0;
    return messages.filter((item: any) => item?.role === 'assistant' && typeof item.id === 'string'
      && ((typeof item.text === 'string' && item.text.trim()) || (Array.isArray(item.media) && item.media.length > 0))).length;
  }
  /** Charge a reserved turn once a new assistant reply exists. A slow reply is
   * not an undelivered message: the user text was already accepted. */
  private async settleReservedReplies(state: RuntimeState, body: string, sessionId: string): Promise<void> {
    if (this.env.COMPANION_BILLING_ENABLED !== 'true' || !this.env.BILLING) return;
    let messages: unknown = [];
    try { messages = JSON.parse(body)?.session?.messages; } catch { return; }
    let available = this.assistantCount(messages);
    const records = await this.storage.list<Receipt>({ prefix: 'request:', limit: 1000 });
    const reserved = [...records.entries()].filter(([, receipt]) => receipt?.sessionId === sessionId && receipt.billing?.status === 'reserved')
      .sort(([, left], [, right]) => left.receivedAt - right.receivedAt);
    for (const [key, receipt] of reserved) {
      const baseline = receipt.billing?.replyBaseline ?? 0;
      const replied = available > baseline;
      const givenUp = !replied && this.now() > receipt.receivedAt + 8 * 60_000;
      if (!replied && !givenUp) continue;
      try {
        const settled = await this.env.BILLING.companionFinalize({ accountId: state.accountId, reservationId: receipt.billing!.reservationId,
          claimToken: receipt.billing!.claimToken, outcome: replied ? 'completed' : 'failed' });
        if (settled?.error) continue;
        receipt.billing!.status = replied ? 'settled' : 'released';
        await this.storage.put(key, receipt);
        if (replied) available -= 1;
      } catch { /* The next session read can settle the same reservation. */ }
    }
  }
  private environment(state: RuntimeState): Record<string, string> {
    return { ...sharedEnvironment(this.env), COMPANION_CONTROL_TOKEN: state.token, COMPANION_ACCOUNT_ID: state.accountId,
      COMPANION_PERSONA: state.profile ?? 'classic', PORT: '8080' };
  }
  private async ambiguousReceipt(): Promise<boolean> {
    const records = await this.storage.list<Receipt>({ prefix: 'request:', limit: 1000 });
    for (const receipt of records.values()) {
      if (receipt?.status === 'pending' || receipt?.status === 'uncertain') return true;
    }
    return false;
  }
  /** Metadata only. The body is cancelled so a later restore can read the object again. */
  private async verifiedSnapshot(state: RuntimeState): Promise<boolean> {
    const pointer = state.snapshot;
    if (!pointer?.key.startsWith(`${this.archiveRoot(state)}/snapshots/`)) return false;
    const saved = await this.memory.get(pointer.key);
    if (!saved) return false;
    const matches = saved.metadata.accountId === state.accountId && saved.size === pointer.size
      && saved.etag === pointer.etag && saved.sha256 === pointer.sha256;
    await saved.body.cancel();
    return matches;
  }
  /** The container is already gone. Blocking cannot bring back turns that never
   * left that process. A verified snapshot is the last durable memory, and it
   * is safe to restore only when no send is still pending or uncertain. */
  private async releaseLostContainer(state: RuntimeState): Promise<boolean> {
    if (await this.ambiguousReceipt() || !(await this.verifiedSnapshot(state))) return false;
    state.blocked = undefined; state.dirty = false; state.phase = 'stopped'; state.restoreRequired = true;
    delete state.checkpointError; delete state.checkpointFailure; delete state.restoreTemplate; state.lastActivity = this.now();
    await this.save(state);
    return true;
  }
  /** No verified personal disk. Keep journals and receipts, and start from this character's empty factory disk. */
  private adoptTemplate(state: RuntimeState): void {
    delete state.snapshot; delete state.blocked; delete state.checkpointError; delete state.checkpointFailure; delete state.restoreRequired;
    state.dirty = false; state.phase = 'stopped'; state.restoreTemplate = state.profile ?? 'classic'; state.lastActivity = this.now();
  }
  private async health(state: RuntimeState, timeout = 5_000): Promise<ControllerHealth> {
    const response = await this.call(state, '/health', {}, timeout);
    if (!response.ok) throw new Error('Controller not ready');
    const value = JSON.parse(await limitedText(response, 16_384));
    if (!UUID.test(value.bootId || '') || typeof value.runtimeStarted !== 'boolean') throw new Error('Invalid controller health');
    return value;
  }
  private async ready(state: RuntimeState): Promise<void> {
    let recoveredHealth: ControllerHealth | undefined;
    if (state.blocked) {
      // A Durable Object can be reconstructed while the platform keeps the
      // same container alive. In that case the old conservative block is
      // stale: verify the live controller/native process before clearing it.
      // The still-running check below only clears a stale block when that same
      // controller is already healthy. It does not start a container. A dead
      // container is handled afterwards and may restore a verified snapshot.
      if (['unexpected-container-loss', 'unexpected-native-stop', 'unexpected-controller-restart'].includes(state.blocked) && await this.rt(state).isRunning()) {
        try {
          const health = await this.health(state);
          if (!health.runtimeStarted) throw new Error('Native runtime is not ready');
          // A genuinely lost container may be replaced with a fresh empty one.
          // Only the same controller identity may self-clear a loss/native-stop
          // block; controller restarts remain the separately reviewed branch.
          if (['unexpected-container-loss', 'unexpected-native-stop'].includes(state.blocked)
            && (!state.bootId || health.bootId !== state.bootId)) throw new Error('Container identity changed');
          state.blocked = undefined; state.phase = 'running'; state.dirty = true;
          state.bootId = health.bootId; state.lastActivity = this.now(); await this.save(state);
          recoveredHealth = health;
        } catch {
          // If this was an actually empty instance, the controller may be in a
          // failed lifecycle state. The reset helper will destroy only that
          // empty container and let the normal first-start path recreate it.
        }
      }
      if (!recoveredHealth) {
        // A still-running container is handled above and must not be replaced.
        // Once that container is gone, a native stop or controller restart has
        // the same outcome as container loss: the unsaved delta left with the
        // process. A verified snapshot can resume when no delivery is ambiguous.
        const loss = ['unexpected-container-loss', 'unexpected-native-stop', 'unexpected-controller-restart'].includes(state.blocked || '');
        const running = await this.rt(state).isRunning();
        const resumed = loss && !running && await this.releaseLostContainer(state);
        if (!resumed && !(await this.resetEmptyLostInstance(state))) {
          const ambiguous = await this.ambiguousReceipt();
          const verified = await this.verifiedSnapshot(state);
          if (loss && !running && !ambiguous && !verified) {
            this.adoptTemplate(state);
            await this.save(state);
          } else {
            throw new HostError(503, 'RECOVERY_REVIEW_REQUIRED', '聊天恢复需要核查，暂时不能发送新消息。', {
              recovery: state.blocked || 'unspecified',
              containerRunning: running,
              deliveryAmbiguous: ambiguous,
              snapshotVerified: verified,
            });
          }
        }
      }
    }
    const wasRunning = await this.rt(state).isRunning();
    const tracker = new BootTracker(this.now, phase => { this.bootPhase = phase; });
    try {
      await this.bringUp(state, wasRunning, recoveredHealth, tracker);
      if (tracker.measured) await this.recordBoot(state, tracker, 'ready');
    } catch (error) {
      if (tracker.measured) await this.recordBoot(state, tracker, error instanceof HostError ? error.code : 'error');
      throw error;
    }
  }
  private async bringUp(state: RuntimeState, wasRunning: boolean, recoveredHealth: ControllerHealth | undefined, tracker: BootTracker): Promise<void> {
    if (!wasRunning) {
      // Native RAM, SQLite and vector indexes may have changed after the last snapshot.
      // Never silently roll back while a send is still ambiguous, and never resend it.
      // If the container is already gone, the uncheckpointed delta is gone with it:
      // resume the last verified snapshot instead of blocking every future open.
      if (state.dirty && !(await this.releaseLostContainer(state))) {
        if (await this.ambiguousReceipt() || await this.verifiedSnapshot(state)) return this.blocked(state, 'unexpected-container-loss');
        this.adoptTemplate(state);
        await this.save(state);
      }
      await this.chooseRuntime(state);
      const env = this.environment(state);
      // A fresh process can diverge from the parked transcript immediately.
      delete state.transcriptParked;
      state.phase = 'starting'; state.restoreRequired = !!state.snapshot; await this.save(state);
      tracker.measured = true;
      tracker.enter('container');
      await this.startRuntime(state, env);
      tracker.leave('container');
    }
    if (state.phase !== 'running') tracker.measured = true;
    await this.rt(state).setInactivityTimeout(CONTAINER_INACTIVITY_MS);
    let health = recoveredHealth;
    // This runs in the background (ensureReady), so a cold controller may take
    // its time; a warm one gets two quick probes.
    const attempts = wasRunning && !health ? 2 : 90;
    tracker.enter('controller');
    if (!health) for (let attempt = 0; attempt < attempts; attempt++) {
      try { health = await this.health(state, wasRunning ? 5_000 : 1_500); break; }
      catch { if (attempt + 1 < attempts) await this.delay(wasRunning ? 400 : 1_000); }
    }
    if (!health) throw new HostError(503, 'CONTAINER_STARTING', '聊天服务正在启动，请稍后查看。');
    tracker.leave('controller');
    if (state.dirty && state.bootId !== health.bootId) return this.blocked(state, 'unexpected-controller-restart');
    // A platform restart may already have a new controller running before this DO wakes.
    // A clean checkpoint still needs restoration when the process identity changed.
    if (!state.dirty && state.snapshot && state.bootId !== health.bootId) {
      state.restoreRequired = true; await this.save(state);
    }
    if (wasRunning && state.phase === 'running') {
      if (!health.runtimeStarted) return this.blocked(state, 'unexpected-native-stop');
      return;
    }
    if (state.restoreRequired && state.snapshot) {
      tracker.enter('restore');
      const pointer = state.snapshot;
      const owned = pointer.key.startsWith(`${this.archiveRoot(state)}/snapshots/`);
      const saved = owned ? await this.memory.get(pointer.key) : null;
      const matches = Boolean(saved) && saved!.metadata.accountId === state.accountId && saved!.size === pointer.size
        && saved!.etag === pointer.etag && saved!.sha256 === pointer.sha256;
      if (!matches) {
        if (saved) await saved.body.cancel();
        if (await this.ambiguousReceipt()) return this.blocked(state, owned ? 'snapshot-missing-or-mismatched' : 'invalid-snapshot-owner');
        this.adoptTemplate(state);
        await this.save(state);
        tracker.leave('restore');
      } else {
        const restored = await this.call(state, '/internal/restore', { method: 'POST', body: saved!.body,
          headers: { 'content-type': 'application/gzip', 'content-length': String(pointer.size), 'x-snapshot-sha256': pointer.sha256 } }, 90_000);
        // 409 means the controller is still busy with a restore begun by an
        // earlier object incarnation; that is not evidence of a bad snapshot.
        if (restored.status === 409) throw new HostError(503, 'CONTAINER_STARTING', '聊天服务正在启动，请稍后查看。');
        if (!restored.ok) return this.blocked(state, 'snapshot-restore-failed');
        state.restoreRequired = false; await this.save(state);
        tracker.leave('restore');
      }
    }
    if (state.restoreTemplate) {
      tracker.enter('restore');
      const persona = state.restoreTemplate;
      const restored = await this.call(state, '/internal/restore-template', { method: 'POST',
        body: JSON.stringify({ persona }), headers: { 'content-type': 'application/json' } }, 90_000);
      delete state.restoreTemplate; await this.save(state);
      if (!restored.ok) await restored.body?.cancel();
      tracker.leave('restore');
    }
    // Persist the conservative dirty marker before allowing any native process to run.
    state.dirty = true; state.bootId = health.bootId; state.phase = 'starting'; state.lastActivity = this.now(); await this.save(state);
    await this.storage.setAlarm(state.lastActivity + IDLE_MS);
    tracker.enter('native');
    const started = await this.call(state, '/internal/start', { method: 'POST' }, 120_000);
    if (started.status === 409) throw new HostError(503, 'CONTAINER_STARTING', '聊天服务正在启动，请稍后查看。');
    if (!started.ok) throw new HostError(503, 'NATIVE_START_FAILED', '聊天引擎未成功启动，已有记录保留。');
    try {
      const value = JSON.parse(await limitedText(started, 16_384));
      if (value?.timings && typeof value.timings === 'object') {
        tracker.native = Object.fromEntries(Object.entries(value.timings).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])));
      }
    } catch { /* Timings are diagnostic only. */ }
    const native = await this.call(state, '/api/health');
    const nativeHealth = native.ok ? JSON.parse(await limitedText(native, 16_384)) : null;
    if (nativeHealth?.ready !== true) throw new HostError(503, 'NATIVE_NOT_READY', '聊天引擎尚未连接。');
    tracker.leave('native');
    state.phase = 'running'; state.lastActivity = this.now(); await this.save(state);
  }

  private async audit(state: RuntimeState, path: string, body: string): Promise<void> {
    const value = JSON.parse(body);
    const sessions = value.session ? [value.session] : Array.isArray(value.sessions) ? value.sessions : [];
    for (const session of sessions) {
      if (!UUID.test(session?.id || '') || !Array.isArray(session.messages)) continue;
      const digest = await hash(JSON.stringify(session));
      const previous = await this.storage.get<{ sha256: string }>(`session:${session.id}`);
      if (previous?.sha256 === digest) continue;
      const serialized = JSON.stringify({ accountId: state.accountId, observedAt: this.now(), session });
      const key = `${this.archiveRoot(state)}/observations/${session.id}/${this.now()}-${crypto.randomUUID()}.json`;
      await this.memory.put(key, serialized, { metadata: { accountId: state.accountId, sessionId: session.id, sha256: digest }, contentType: 'application/json' });
      await this.storage.put(`session:${session.id}`, { key, sha256: digest, observedAt: this.now(), source: path });
    }
  }
  /**
   * Durable request receipts are the only authoritative delivery signal after
   * a browser/network timeout.  Native session history does not always retain
   * the request id, so attach account-scoped, redacted summaries to the
   * authenticated session response.  Never expose message text, fingerprints,
   * response bodies, or billing claim tokens to the browser.
   */
  private async withReceiptSummaries(body: string, sessionId: string): Promise<string> {
    const value = JSON.parse(body) as Record<string, any>;
    const session = value?.session;
    if (!session || typeof session !== 'object' || typeof session.id !== 'string' || session.id.toLowerCase() !== sessionId) return body;
    const records = await this.storage.list<Receipt>({ prefix: 'request:', limit: 1000 });
    const durable = [...records.values()]
      .filter(receipt => receipt && receipt.sessionId === sessionId && UUID.test(receipt.requestId))
      .map(receipt => ({ requestId: receipt.requestId, status: receipt.status,
        receivedAt: receipt.receivedAt, confirmed: receipt.status === 'complete' } satisfies ReceiptSummary))
      .sort((a, b) => a.receivedAt - b.receivedAt);
    const native = Array.isArray(session.receipts) ? session.receipts : [];
    const merged = new Map<string, PublicReceipt>();
    for (const receipt of native) {
      const safe = publicReceipt(receipt);
      if (safe) merged.set(safe.requestId.toLowerCase(), safe);
    }
    for (const receipt of durable) merged.set(receipt.requestId.toLowerCase(), receipt);
    session.receipts = [...merged.values()];
    return JSON.stringify(value);
  }

  /**
   * A browser timeout leaves a durable receipt in `uncertain`.  The native
   * history is the only safe source that can turn that state into a positive
   * delivery acknowledgement.  On every authenticated session read, inspect
   * the already fetched history and reconcile only when the native bridge
   * carries the original request id (or its explicit receipt).  The text
   * fallback is deliberately strict and time bounded: it is only used for
   * bridges that drop requestId metadata, and never treats an old duplicate as
   * a new delivery.  This path is read-only with respect to the native
   * runtime; it never posts a message, starts a container, or touches billing.
   */
  private async reconcileReceipts(body: string, sessionId: string): Promise<void> {
    let value: Record<string, any>;
    try { value = JSON.parse(body) as Record<string, any>; }
    catch { return; }
    const session = value?.session;
    if (!session || typeof session !== 'object' || typeof session.id !== 'string' || session.id.toLowerCase() !== sessionId) return;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const nativeReceipts = Array.isArray(session.receipts) ? session.receipts : [];
    const records = await this.storage.list<Receipt>({ prefix: 'request:', limit: 1000 });
    for (const [key, receipt] of records) {
      if (!receipt || receipt.sessionId !== sessionId || receipt.status !== 'uncertain' || !UUID.test(receipt.requestId)) continue;
      const requestId = receipt.requestId.toLowerCase();
      const explicit = nativeReceipts.some((candidate: unknown) => {
        const safe = publicReceipt(candidate);
        return !!safe && safe.requestId.toLowerCase() === requestId && safe.confirmed;
      });
      const metadataMatch = messages.some((message: any) => {
        if (!message || typeof message !== 'object') return false;
        return [message.requestId, message.id].some(value => typeof value === 'string' && value.toLowerCase() === requestId);
      });
      // MaiBot versions that omit requestId still persist the user's text.
      // Require a timestamp at or after receipt creation to avoid confirming
      // an earlier repeated phrase from the same conversation.
      const textMatch = messages.some((message: any) => {
        if (!message || typeof message !== 'object' || message.role !== 'user' || typeof message.text !== 'string') return false;
        if (stripStyle(message.text).trim() !== receipt.text.trim()) return false;
        const rawTime = typeof message.createdAt === 'number' ? message.createdAt
          : typeof message.createdAt === 'string' ? Date.parse(message.createdAt) : NaN;
        // Native bridges normally use epoch milliseconds. Accept a numeric
        // epoch in seconds as well, while keeping the bounded reconciliation
        // window that prevents an earlier duplicate phrase from unlocking a
        // later uncertain request.
        const createdAt = typeof message.createdAt === 'number' && Number.isFinite(rawTime)
          && rawTime > 0 && rawTime < 1_000_000_000_000 ? rawTime * 1000 : rawTime;
        return Number.isFinite(createdAt)
          && createdAt >= receipt.receivedAt - 5_000
          && createdAt <= receipt.receivedAt + TEXT_RECONCILIATION_WINDOW_MS
          && this.now() <= receipt.receivedAt + TEXT_RECONCILIATION_WINDOW_MS;
      });
      if (explicit || metadataMatch || textMatch) {
        await this.storage.put(key, { ...receipt, status: 'complete' });
      }
    }
  }
  private async handle(request: Request): Promise<Response> {
    const account = request.headers.get('x-xumeng-account-id');
    if (!account || !UUID.test(account)) throw new HostError(403, 'AUTHENTICATED_ACCOUNT_REQUIRED', '请先登录后使用聊天。');
    const profile = companionProfile(request.headers.get('x-xumeng-companion-profile'));
    if (!profile) throw new HostError(403, 'ACCOUNT_MISMATCH', '无法访问这段聊天。');
    const url = new URL(request.url);
    if (url.search || !route(url.pathname, request.method)) throw new HostError(404, 'NOT_FOUND', '找不到这个操作。');
    const state = await this.getState(account.toLowerCase(), profile);
    // A durable receipt is the only authoritative answer after the browser
    // loses the POST response. Read it without starting the native container,
    // and expose only safe delivery fields (never text, fingerprint or billing
    // claim tokens). The frontend can then distinguish a completed request
    // from an actually ambiguous one without re-posting or charging again.
    const receiptRoute = /^\/api\/sessions\/([^/]+)\/receipts\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && receiptRoute) {
      const requestId = receiptRoute[2].toLowerCase();
      const value = await this.storage.get<Receipt>(`request:${requestId}`);
      if (!value || value.sessionId !== receiptRoute[1].toLowerCase() || value.requestId !== requestId) {
        throw new HostError(404, 'RECEIPT_NOT_FOUND', '找不到这条送达记录。');
      }
      return new Response(JSON.stringify({ receipt: {
        requestId, sessionId: value.sessionId, status: value.status,
        confirmed: value.status === 'complete',
        ...(value.billing?.status ? { billingStatus: value.billing.status } : {}),
      } }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const styleRoute = /^\/api\/sessions\/([^/]+)\/style$/.exec(url.pathname);
    if (styleRoute) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HostError(415, 'INVALID_CONTENT_TYPE', '请提交 JSON。');
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(await limitedText(new Response(request.body), 24_000)); }
      catch (error) { throw error instanceof HostError ? error : new HostError(400, 'INVALID_JSON', '消息格式有误。'); }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new HostError(400, 'INVALID_JSON', '消息格式有误。');
      const style = readStyle(parsed.style);
      if (Object.keys(parsed).some(key => key !== 'style') || !style) throw new HostError(400, 'INVALID_STYLE', '女友设定格式无效。');
      await this.storage.put(`style:${styleRoute[1].toLowerCase()}`, style);
      return new Response(JSON.stringify({ style }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    let body: string | undefined, receiptKey: string | undefined, receipt: Receipt | undefined, pendingStyle: CompanionStyle | null = null;
    let pendingOpening: string[] = [];
    let resetRequested = false;
    let nextSendWindow: number[] | undefined;
    if (request.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HostError(415, 'INVALID_CONTENT_TYPE', '请提交 JSON。');
      body = await limitedText(new Response(request.body), 24_000);
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(body); } catch { throw new HostError(400, 'INVALID_JSON', '消息格式有误。'); }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new HostError(400, 'INVALID_JSON', '消息格式有误。');
      if (url.pathname === '/api/reset') {
        if (Object.keys(parsed).length !== 1 || parsed.confirmation !== 'discard-current-instance') throw new HostError(400, 'RESET_CONFIRMATION_REQUIRED', '请确认放弃当前异常实例后再重建。');
        resetRequested = true;
      } else if (url.pathname.endsWith('/proactive')) {
        const intent = typeof parsed.intent === 'string' ? parsed.intent.trim() : '';
        if (!intent || intent.length > 2000) throw new HostError(400, 'INVALID_INTENT', '主动触发需要一段有效的意图说明。');
        const userMessageId = typeof parsed.userMessageId === 'string' ? parsed.userMessageId.trim().slice(0, 240) : '';
        const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : '';
        const priority = typeof parsed.priority === 'string' ? parsed.priority.slice(0, 80) : '';
        const metadata = parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata) ? parsed.metadata : undefined;
        body = JSON.stringify({ intent, ...(userMessageId ? { userMessageId } : {}), ...(reason ? { reason } : {}), ...(priority ? { priority } : {}), ...(metadata ? { metadata } : {}) });
      } else if (url.pathname.endsWith('/messages')) {
        if (typeof parsed.requestId !== 'string' || !UUID.test(parsed.requestId)
          || typeof parsed.text !== 'string' || !parsed.text.trim() || parsed.text.length > 4000) throw new HostError(400, 'INVALID_MESSAGE', '消息内容或请求编号有误。');
        const opening = readOpening(parsed.opening);
        if (opening === null) throw new HostError(400, 'INVALID_OPENING', '开场白格式有误。');
        pendingOpening = opening;
        if ('opening' in parsed) {
          delete parsed.opening;
          body = JSON.stringify(parsed);
        }
        receiptKey = `request:${parsed.requestId.toLowerCase()}`;
        const fingerprint = await hash(url.pathname + '\n' + parsed.text.trim());
        const prior = await this.storage.get<Receipt>(receiptKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new HostError(409, 'REQUEST_CONFLICT', '同一请求编号不能用于不同消息。');
          if (prior.status === 'complete' && prior.response) return new Response(prior.response.body, { status: prior.response.status,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-companion-replayed': 'true' } });
          throw new HostError(409, 'DELIVERY_UNCERTAIN', '这条消息的送达结果尚未确认，请查看聊天记录；不会重复发送。');
        }
        receipt = { fingerprint, status: 'pending', receivedAt: this.now(), requestId: parsed.requestId.toLowerCase(),
          sessionId: url.pathname.split('/')[3].toLowerCase(), text: parsed.text.trim() };
      } else if (url.pathname === '/api/sessions') {
        const style = parsed.style === undefined ? null : readStyle(parsed.style);
        if (parsed.style !== undefined && !style) throw new HostError(400, 'INVALID_STYLE', '女友设定格式无效。');
        pendingStyle = style;
      }
    }
    if (resetRequested) return await this.resetAbandonedInstance(state);
    if (request.method === 'GET') {
      const parked = await this.parkedTranscript(state, url.pathname);
      if (parked) return parked;
    }
    await this.ensureReady(state);
    // Reads keep the open tab in sync. A desk or reply nudge can also arrive
    // on its own. Neither one is the person typing, so neither may push the
    // ten-minute checkpoint back.
    if (request.method !== 'GET' && !url.pathname.endsWith('/proactive')) {
      state.lastActivity = this.now(); await this.save(state);
      await this.storage.setAlarm(state.lastActivity + IDLE_MS);
    }
    await this.ensureIdleAlarm(state);
    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const reused = await this.reuseMemorySession(state);
      if (reused) {
        if (pendingStyle) {
          try {
            const created = JSON.parse(await reused.clone().text()) as { session?: { id?: string } };
            if (created.session?.id && UUID.test(created.session.id)) await this.storage.put(`style:${created.session.id.toLowerCase()}`, pendingStyle);
          } catch { /* The existing session is still this character's only memory. */ }
        }
        return reused;
      }
    }
    // Intent is durable before invoking the upstream. Network loss is ambiguous.
    if (receiptKey && receipt) {
      const attempts = (await this.storage.get<number[]>('send-window') || []).filter(at => at > this.now() - 60_000);
      if (attempts.length >= 6) throw new HostError(429, 'SEND_RATE_LIMIT', '消息发送较快，请稍后再发。');
      // Keep the rate-limit candidate in memory until billing preflight has
      // succeeded. An insufficient balance must not leave a pending receipt
      // that turns a retry into a false delivery-uncertain conflict.
      nextSendWindow = [...attempts, this.now()];
    }
    let forwardBody = body;
    // Style stays in host storage. The instance config carries the persona, so
    // it is not pasted onto the user line.
    if (pendingStyle && body && url.pathname === '/api/sessions') {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        delete parsed.style;
        forwardBody = JSON.stringify(parsed);
      } catch { /* the request was already validated above */ }
    }
    if (receipt && body) {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (typeof parsed.text === 'string') {
          let text = parsed.text;
          if (pendingOpening.length && !(await this.storage.get(`opening:${receipt.sessionId}`))) {
            text = openingPrefix(pendingOpening, text);
          }
          if (text !== parsed.text) forwardBody = JSON.stringify({ ...parsed, text });
        }
      } catch { /* the request was already validated above */ }
    }
    let replyBaseline = 0;
    if (receipt && this.env.COMPANION_BILLING_ENABLED === 'true') {
      const token = request.headers.get('x-xumeng-session-token');
      if (!token || !/^[a-f0-9]{64}$/.test(token) || !this.env.BILLING) throw new HostError(401, 'BILLING_AUTH_REQUIRED', '登录状态已失效，请重新登录。');
      const existing = await this.call(state, `/api/sessions/${receipt.sessionId}`, {}, 15_000);
      try {
        const current = JSON.parse(await limitedText(existing, 512 * 1024));
        replyBaseline = this.assistantCount(current?.session?.messages);
      } catch { replyBaseline = 0; }
      const reserved = await this.env.BILLING.companionReserve({ sessionToken: token, accountId: state.accountId,
        requestId: receipt.requestId, sessionId: receipt.sessionId, requestFingerprint: receipt.fingerprint });
      if (reserved?.error) throw new HostError(reserved.error.status || 503, reserved.error.code || 'BILLING_UNAVAILABLE', reserved.error.message || '女友聊天计费服务暂时不可用。');
      if (reserved?.created !== true || typeof reserved?.receipt?.id !== 'string' || typeof reserved?.claimToken !== 'string')
        throw new HostError(409, 'BILLING_REQUEST_USED', '这条消息已经处理，请刷新聊天记录。');
      receipt.billing = { reservationId: reserved.receipt.id, claimToken: reserved.claimToken, status: 'reserved', replyBaseline };
    }
    if (receiptKey && receipt && nextSendWindow) {
      await this.storage.put('send-window', nextSendWindow);
      await this.storage.put(receiptKey, receipt);
    }
    let response: Response, responseBody: string;
    try {
      response = await this.call(state, url.pathname, { method: request.method, body: forwardBody,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' } }, 120_000);
      responseBody = await limitedText(response);
      JSON.parse(responseBody);
      // A non-2xx native response is not proof that the request was delivered.
      // Keep the durable receipt ambiguous so the browser stays read-only and
      // cannot clear the pending bubble or accidentally send a second request.
      if (!response.ok) throw new HostError(503, 'NATIVE_RESPONSE_UNCONFIRMED', '上游未确认消息送达，请查看记录。');
      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        const created = JSON.parse(responseBody);
        const createdId = created?.session?.id;
        if (typeof createdId === 'string' && UUID.test(createdId)) {
          await this.storage.put('memory-session', createdId.toLowerCase());
          if (pendingStyle) await this.storage.put(`style:${createdId.toLowerCase()}`, pendingStyle);
        }
      }
      const personTitle = state.profile === 'intimate' ? '和宁宁的聊天' : state.profile === 'sales' ? '和Eva的聊天' : state.profile ? `和${CAST_PROFILES[state.profile].name}的聊天` : '和林幺的聊天';
      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        try {
          const value = JSON.parse(responseBody) as { sessions?: unknown };
          const chosen = chooseMemorySession(value.sessions);
          if (chosen && Array.isArray(value.sessions)) {
            await this.storage.put('memory-session', chosen.id);
            value.sessions = value.sessions.filter((item) => item && typeof item === 'object' && (item as { id?: string }).id?.toLowerCase() === chosen.id);
            responseBody = JSON.stringify(value);
          }
        } catch { /* Keep the native list when it is not session JSON. */ }
        responseBody = sanitizeSessionBody(responseBody, [], personTitle);
      }
      if (url.pathname.startsWith('/api/sessions/') && request.method === 'GET') {
        const sessionId = url.pathname.split('/')[3].toLowerCase();
        await this.reconcileReceipts(responseBody, sessionId);
        await this.settleReservedReplies(state, responseBody, sessionId);
        responseBody = await this.withReceiptSummaries(responseBody, sessionId);
        responseBody = sanitizeSessionBody(responseBody, [], personTitle);
        if (!url.pathname.includes('/receipts/')) {
          const stored = readStyle(await this.storage.get(`style:${sessionId}`));
          if (stored) {
            try {
              const value = JSON.parse(responseBody) as { session?: Record<string, unknown> };
              if (value.session && typeof value.session === 'object') {
                value.session.style = stored;
                responseBody = JSON.stringify(value);
              }
            } catch { /* Keep the sanitized transcript when it is not session JSON. */ }
          }
        }
      }
      if (receiptKey && receipt) {
        if (responseBody.length > 64_000) throw new Error('Receipt too large');
        receipt.status = 'complete'; receipt.response = { status: response.status, body: responseBody };
        await this.storage.put(receiptKey, receipt);
        if (pendingOpening.length) await this.storage.put(`opening:${receipt.sessionId}`, 1);
      }
    } catch (error) {
      if (receiptKey && receipt) {
        if (receipt.billing && this.env.COMPANION_BILLING_ENABLED === 'true' && !receipt.billing.status.includes('settled')) {
          try {
            await this.env.BILLING?.companionFinalize({ accountId: state.accountId, reservationId: receipt.billing.reservationId,
              claimToken: receipt.billing.claimToken, outcome: 'failed' });
            receipt.billing.status = 'released';
          } catch { /* keep the reserved hold; expiry is a safe zero-charge release */ }
        }
        receipt.status = 'uncertain'; await this.storage.put(receiptKey, receipt);
      }
      throw new HostError(503, receiptKey ? 'DELIVERY_UNCERTAIN' : 'COMPANION_UNAVAILABLE', receiptKey
        ? '这条消息的送达结果尚未确认，请查看记录，暂勿重复发送。' : '聊天服务暂不可用，请稍后查看。');
    }
    if (response.ok && url.pathname !== '/api/health') await this.audit(state, url.pathname, responseBody);
    if (response.ok && url.pathname === '/api/health') {
      const lastBoot = (await this.storage.get<BootMetrics[]>('boot-metrics'))?.at(-1);
      const alarmAt = await this.storage.getAlarm();
      const knownFailure = state.checkpointFailure === 'Transcript journal failed' || state.checkpointFailure === 'Native stop failed' || state.checkpointFailure === 'Invalid snapshot'
        ? state.checkpointFailure : undefined;
      responseBody = JSON.stringify({ ...JSON.parse(responseBody), clientScope: await hash(state.profile ? `xumeng-companion:${state.accountId}:${state.profile}` : `xumeng-companion:${state.accountId}`),
        recoveryScope: 'native-checkpoint-on-idle; observed-messages-journaled; abnormal-restart-requires-review',
        checkpoint: {
          dirty: state.dirty, phase: state.phase, error: state.checkpointError === true,
          ...(knownFailure ? { failure: knownFailure } : state.checkpointError ? { failure: 'checkpoint-failed' } : {}),
          idleMs: Math.max(0, this.now() - state.lastActivity),
          alarmInMs: typeof alarmAt === 'number' ? alarmAt - this.now() : null,
        },
        ...(lastBoot ? { lastBoot: { runtime: lastBoot.runtime, outcome: lastBoot.outcome, totalMs: lastBoot.totalMs, phases: lastBoot.phases } } : {}) });
    }
    return new Response(responseBody, { status: response.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  /** Session ids already observed for this account. Newest journal first. */
  private async knownSessionIds(): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      const key = id.toLowerCase();
      if (!UUID.test(key) || seen.has(key)) return;
      seen.add(key);
      ids.push(key);
    };
    const remembered = await this.storage.get<string>('memory-session');
    if (remembered) add(remembered);
    const pointers = await this.storage.list<{ observedAt?: number }>({ prefix: 'session:' });
    const extra = [...pointers.entries()]
      .map(([key, value]) => ({ id: key.slice('session:'.length), at: value?.observedAt ?? 0 }))
      .filter(item => UUID.test(item.id))
      .sort((left, right) => right.at - left.at);
    for (const item of extra) add(item.id);
    return ids.slice(0, 4);
  }
  /** Refresh the durable transcript from the still-running process. A failed
   * read aborts the checkpoint so the container is not destroyed early. */
  private async journalKnownTranscript(state: RuntimeState): Promise<boolean> {
    const ids = await this.knownSessionIds();
    if (!ids.length) return false;
    for (const id of ids) {
      const full = await this.call(state, `/api/sessions/${id}`, {}, 20_000);
      if (!full.ok) throw new Error('Transcript journal failed');
      await this.audit(state, `/api/sessions/${id}`, await limitedText(full, 512 * 1024));
    }
    return true;
  }
  private async loadJournal(state: RuntimeState, sessionId: string): Promise<Record<string, unknown> | null> {
    const pointer = await this.storage.get<{ key?: string; sha256?: string }>(`session:${sessionId}`);
    if (!pointer?.key?.startsWith(`${this.archiveRoot(state)}/observations/`) || !pointer.sha256) return null;
    const saved = await this.memory.get(pointer.key);
    if (!saved || saved.metadata.accountId !== state.accountId) {
      if (saved) await saved.body.cancel();
      return null;
    }
    let parsed: { accountId?: string; session?: Record<string, unknown> };
    try { parsed = JSON.parse(await limitedText(new Response(saved.body), 512 * 1024)); }
    catch { return null; }
    const session = parsed.session;
    if (parsed.accountId !== state.accountId || !session || typeof session !== 'object') return null;
    if (String(session.id || '').toLowerCase() !== sessionId) return null;
    if (await hash(JSON.stringify(session)) !== pointer.sha256) return null;
    return session;
  }
  /** A clean checkpoint already has the transcript. Reading it must not boot. */
  private async parkedTranscript(state: RuntimeState, path: string): Promise<Response | null> {
    const detail = /^\/api\/sessions\/([^/]+)$/.exec(path);
    const detailId = detail && UUID.test(detail[1]) ? detail[1].toLowerCase() : '';
    if (path !== '/api/health' && path !== '/api/sessions' && !detailId) return null;
    if (!state.transcriptParked || state.blocked || state.dirty || state.checkpointError || state.phase !== 'stopped' || !state.snapshot) return null;
    if (await this.rt(state).isRunning() || await this.ambiguousReceipt()) return null;
    const ids = detailId ? [detailId] : await this.knownSessionIds();
    const sessions: Record<string, unknown>[] = [];
    for (const id of ids) {
      const session = await this.loadJournal(state, id);
      if (session) sessions.push(session);
      else if (detailId) return null;
    }
    if (!sessions.length) return null;
    if (path === '/api/health') {
      const lastBoot = (await this.storage.get<BootMetrics[]>('boot-metrics'))?.at(-1);
      return json({ runtime: 'maibot-native', ready: true, parked: true,
        clientScope: await hash(state.profile ? `xumeng-companion:${state.accountId}:${state.profile}` : `xumeng-companion:${state.accountId}`),
        recoveryScope: 'native-checkpoint-on-idle; observed-messages-journaled; abnormal-restart-requires-review',
        ...(lastBoot ? { lastBoot: { runtime: lastBoot.runtime, outcome: lastBoot.outcome, totalMs: lastBoot.totalMs, phases: lastBoot.phases } } : {}) });
    }
    const title = state.profile === 'intimate' ? '和宁宁的聊天' : state.profile === 'sales' ? '和Eva的聊天' : state.profile ? `和${CAST_PROFILES[state.profile].name}的聊天` : '和林幺的聊天';
    let body = JSON.stringify(path === '/api/sessions' ? { sessions } : { session: sessions[0] });
    if (detailId) {
      body = await this.withReceiptSummaries(body, detailId);
      const stored = readStyle(await this.storage.get(`style:${detailId}`));
      if (stored) {
        try {
          const value = JSON.parse(body) as { session?: Record<string, unknown> };
          if (value.session && typeof value.session === 'object') {
            value.session.style = stored;
            body = JSON.stringify(value);
          }
        } catch { /* Keep the journaled transcript when it is not session JSON. */ }
      }
    }
    return new Response(sanitizeSessionBody(body, [], title), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  /** A live engine with no alarm never reaches the idle checkpoint. Reads must put it back. */
  private async ensureIdleAlarm(state: RuntimeState): Promise<void> {
    if (!state.dirty || state.blocked || state.phase !== 'running') return;
    if (typeof await this.storage.getAlarm() === 'number') return;
    const due = state.lastActivity + IDLE_MS;
    await this.storage.setAlarm(due > this.now() ? due : this.now() + 1_000);
  }
  alarm(): Promise<void> {
    return this.serialize(async () => {
      // Never checkpoint underneath a background start; look again shortly.
      if (this.boot) { await this.storage.setAlarm(this.now() + 60_000); return; }
      const state = await this.storage.get<RuntimeState>('runtime');
      if (!state || state.blocked) return;
      const runtime = this.rt(state);
      if (!state.dirty) {
        if (state.phase === 'stopped' && await runtime.isRunning()) {
          try { await runtime.destroy(); }
          catch { await this.storage.setAlarm(this.now() + 60_000); }
        }
        return;
      }
      if (this.now() < state.lastActivity + IDLE_MS) { await this.storage.setAlarm(state.lastActivity + IDLE_MS); return; }
      // The container is already gone, so there is nothing left to checkpoint.
      // The next open decides between a verified snapshot and recovery review.
      if (!(await runtime.isRunning())) return;
      try {
        const health = await this.health(state);
        if (health.bootId !== state.bootId) { await this.blocked(state, 'unexpected-controller-restart').catch(() => {}); return; }
        // Read the transcript while the process still has it. A later open can
        // show that copy without booting; the snapshot remains the memory restore.
        const journaled = await this.journalKnownTranscript(state);
        if (journaled) state.transcriptParked = true;
        else delete state.transcriptParked;
        const stopped = await this.call(state, '/internal/stop', { method: 'POST' }, 95_000);
        if (!stopped.ok) throw new Error('Native stop failed');
        state.phase = 'stopped'; await this.save(state);
        const exported = await this.call(state, '/internal/snapshot', { method: 'GET' }, 90_000);
        const size = Number(exported.headers.get('content-length'));
        const sha256 = exported.headers.get('x-snapshot-sha256') || '';
        if (!exported.ok || !exported.body || !Number.isSafeInteger(size) || size < 1 || size > SNAPSHOT_LIMIT
          || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid snapshot');
        const key = `${this.archiveRoot(state)}/snapshots/${this.now()}-${crypto.randomUUID()}.tar.gz`;
        const uploaded = await this.memory.put(key, exported.body, { length: size, sha256,
          metadata: { accountId: state.accountId, format: 'xumeng-native-v1', sha256 }, contentType: 'application/gzip' });
        // Only a successful durable upload may advance the authoritative pointer.
        state.snapshot = { key, size, sha256, etag: uploaded.etag, savedAt: this.now() };
        state.dirty = false; delete state.checkpointError; delete state.checkpointFailure; await this.save(state);
        await runtime.destroy();
      } catch (error) {
        state.checkpointError = true;
        state.checkpointFailure = error instanceof Error ? error.message.slice(0, 160) : 'error';
        await this.save(state);
        // Keep the stopped container/files intact; never destroy on checkpoint failure.
        await this.storage.setAlarm(this.now() + 60_000);
      }
    });
  }
}

export function authorizeService(request: Request, env: HostEnv): string | Response {
  const account = request.headers.get('x-xumeng-account-id');
  if (!account || !UUID.test(account)) return problem(403, 'AUTHENTICATED_ACCOUNT_REQUIRED', '请先登录后使用聊天。');
  return account.toLowerCase();
}
