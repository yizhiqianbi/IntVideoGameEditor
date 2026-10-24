/** Cloudflare-native, per-account Vidu studio. Provider keys never leave Env. */
import { getXumengLiveVoice } from "../../../src/lib/xumeng-voices";
import { buildXumengLiveInteractionPrompt, parseXumengLiveInteraction } from "../../../src/lib/xumeng-live-scene";
type DurableObjectId = { toString(): string };
type DurableObjectStub = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type DurableObjectState = {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    setAlarm(at: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  waitUntil(promise: Promise<unknown>): void;
};
export interface ViduStudioEnvironment { VIDU_API_KEY?: string; VIDU_REGION?: string; GENERATION_ENABLED?: string }
export interface LiveStudiosBinding {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): Pick<DurableObjectStub, "fetch">;
}
type Identity = { id: string; role: "user" | "super" };
type Termination = "confirmed" | "requested" | "unknown";
type Session = {
  // Rehearsal remains readable only for cleanup of leases written by older versions.
  id: string; mode: "real" | "rehearsal"; control: "performance";
  status: "connecting" | "ready" | "ended"; startedAt: number; reason?: string;
};
type Event = { id: string; type: string; time: number; data: unknown; sessionId?: string; revision?: number };
type Task = { id: string; kind: "image" | "video"; state: string; createdAt: number; prompt?: string; error?: string; creations: { url: string }[] };
type StartError = { message: string; time: number; source?: "start" | "initialization" | "websocket"; code?: string; providerDetail?: string; traceId?: string; dependencyCode?: "QWEN_REALTIME_CONNECT_FAILED" };
type ControlClose = { code: number | null; wasClean: boolean | null; message: string; time: number };
type StoredLease = {
  id: string; cleanupHash: string; expiresAt: number; lastAccess: number; closed: boolean;
  session: Session | null; connId: string; seq: number; heartbeatAt: number;
  termination: Termination | null; terminationAttempts: number; retryAt: number;
  providerStatus?: string; providerTraceId?: string; billedSeconds?: number; creditsCost?: number;
  lastStartError?: StartError | null; providerEndReason?: string; controlClose?: ControlClose;
  creationUncertain: boolean;
};
type Lease = StoredLease & {
  ws?: WebSocket; events: Event[]; tasks: Map<string, Task>; starting: boolean;
  tail: Promise<void>; lastStartError: StartError | null;
  initAttempts: number; initTimer?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setTimeout>; aborts: Set<AbortController>;
  // Exact content/credential redaction targets are transient, never stored.
  redactionTargets: Set<string>;
  terminating?: Promise<void>; receipt?: Promise<void>;
  transcripts?: Map<string, { id: string; text: string; revision: number; seen: Set<string> }>;
};
type StoredState = { owner: string; leases: StoredLease[] };
type Options = { fetch?: typeof fetch; now?: () => number; timers?: boolean };
const LEASE_TTL = 600_000, HEARTBEAT_TTL = 90_000, INITIAL_TTL = 60_000, CALL_LIMIT = 3_600_000, IDLE_TIMEOUT_SECONDS = 1_800;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTIONS = new Set(["start", "stop", "heartbeat", "interaction", "execute", "danmaku", "interrupt", "references", "generate", "task", "recording"]);
const SESSION_ACTIONS = new Set(["stop", "heartbeat", "interaction", "execute", "danmaku", "interrupt", "references"]);
const MAX_BODY = 20 * 1024 * 1024;
const HANGUP_REASONS: Readonly<Record<string, string>> = Object.freeze({
  prepared_sip_disconnected: "渲染端在准备阶段断开", owner_taken_over: "直播处理节点被接管", owner_lease_lost: "直播处理节点租约丢失", ai_output_closed: "平台 AI 输出通道关闭",
  user_end: "用户请求结束", timeout: "平台超时", audit_violation: "平台审核终止", credit_insufficient: "Vidu 账户额度不足",
  sip_closed: "直播媒体连接关闭", provider_closed: "渲染服务连接关闭", sip_reconnect_timeout: "直播媒体重连超时",
  client_reconnect_timeout: "控制客户端重连超时", external: "外部请求结束",
});
const INIT_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  NOT_READY: "S2 渲染端尚未就绪", SIP_READY_TIMEOUT: "S2 渲染端准备超时", LIVE_ENDED: "Vidu 场次在控制初始化前已结束",
  LIVE_CONN_INIT_FAILED: "S2 控制初始化失败；请核对 Vidu 平台记录，本次未自动重新开播",
});
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function providerAmount(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : undefined;
}
function response(status: number, value: unknown) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
class StudioError extends Error { constructor(public status: number, message: string) { super(message); } }
function text(value: unknown, label: string, limit: number, required = true) {
  if (typeof value !== "string" || value.length > limit || value.includes("\0") || required && !value.trim()) throw new StudioError(400, `${label}无效。`);
  return value.trim();
}
function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""); }
async function hash(value: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
async function equalHash(token: string, expected: string) {
  const presented = await hash(token); let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}
export async function viduStudioOwnerPrefix(accountId: string) { return (await hash(accountId)).slice(0, 16); }
export function viduStudioLeasePrefix(leaseId: string) { return leaseId.replaceAll("-", "").slice(0, 16); }
function image(value: unknown): string {
  const candidate = text(value, "图片", 7 * 1024 * 1024);
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidate)) return candidate;
  try { const url = new URL(candidate); if (url.protocol === "https:" && !url.username && !url.password) return candidate; } catch {}
  throw new StudioError(400, "图片须为 PNG/JPEG/WebP 或 HTTPS 地址。");
}
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 12_000) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
async function jsonBody(request: Request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY) throw new StudioError(413, "请求体超过 20 MB。");
  const reader = request.body?.getReader(); const parts: Uint8Array[] = []; let size = 0;
  if (reader) try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) { await reader.cancel(); throw new StudioError(413, "请求体超过 20 MB。"); } parts.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) || "{}"); if (record(value)) return value; } catch {}
  throw new StudioError(400, "无效 JSON 请求。");
}

/** This class is callable only through the private namespace binding. */
export class ViduLiveStudio {
  private owner = "";
  private leases = new Map<string, Lease>();
  private initialized: Promise<void>;
  private persistence: Promise<void> = Promise.resolve();
  private creatingLease: Promise<void> = Promise.resolve();
  constructor(private ctx: DurableObjectState, private env: ViduStudioEnvironment, private options: Options = {}) {
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<StoredState>("studio");
      if (!stored) return;
      if (!record(stored) || typeof stored.owner !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(stored.owner) || !Array.isArray(stored.leases) || stored.leases.length > 8) throw new Error("Invalid private studio metadata");
      this.owner = stored.owner;
      for (const item of stored.leases) {
        if (!UUID.test(item.id) || !/^[a-f0-9]{64}$/.test(item.cleanupHash) || !Number.isSafeInteger(item.expiresAt) || !Number.isSafeInteger(item.retryAt)) throw new Error("Invalid lease metadata");
        const lease: Lease = { ...item, creationUncertain: item.creationUncertain === true, providerTraceId: this.diagnosticTraceId(item.providerTraceId), events: [], tasks: new Map(), starting: false, tail: Promise.resolve(), lastStartError: this.restoreStartError(item.lastStartError), initAttempts: 0, aborts: new Set(), redactionTargets: new Set() };
        this.leases.set(item.id, lease);
        // RTC and content cannot be recovered. Terminate the same upstream live
        // after a restart; never create a replacement implicitly.
        if (lease.session && lease.session.status !== "ended") {
          lease.session.status = "ended"; lease.session.reason = "工作台重启，正在请求结束旧直播";
          lease.termination = lease.session.mode === "real" ? "unknown" : "confirmed";
          lease.retryAt = this.now();
        }
      }
      await this.persist();
    });
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private base() { return this.env.VIDU_REGION === "global" ? "https://api.vidu.com" : "https://api.vidu.cn"; }
  private configured() { return typeof this.env.VIDU_API_KEY === "string" && this.env.VIDU_API_KEY.length > 0; }
  private redact(value: unknown, limit = 1000) {
    let result = typeof value === "string" ? value : "实时服务返回错误。";
    if (this.env.VIDU_API_KEY) result = result.split(this.env.VIDU_API_KEY).join("[redacted]");
    return result.replace(/Token\s+\S+/gi, "Token [redacted]").slice(0, limit);
  }
  private secretFree(value: string) { return !this.env.VIDU_API_KEY || !value.includes(this.env.VIDU_API_KEY); }
  private diagnosticCode(value: unknown) { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) && this.secretFree(value) ? value : undefined; }
  private diagnosticTraceId(value: unknown, lease?: Lease) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) || !this.secretFree(value)
      || /vda_|token|secret|cookie|authorization|bearer|^eyJ/i.test(value)) return undefined;
    if (lease && [...lease.redactionTargets].some(target => target && value.includes(target))) return undefined;
    return value;
  }
  private providerDetail(value: unknown, lease?: Lease) {
    if (typeof value !== "string" || !value.trim() || value.length > 16_000) return undefined;
    let detail = value;
    // Remove whole credentials/content before limiting the diagnostic. Truncating
    // first could retain a credential prefix which an exact replacement misses.
    for (const target of [this.env.VIDU_API_KEY, ...(lease?.redactionTargets ?? [])].filter((item): item is string => typeof item === "string" && item.length > 0).sort((a, b) => b.length - a.length)) {
      detail = detail.split(target).join("[redacted]");
    }
    detail = detail.replace(/data:[^\s<>"']+/gi, "[redacted-data]")
      .replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, "[redacted-url]")
      .replace(/\b(?:Token|Bearer)\s+[^\s,;<>"']+/gi, "[redacted-credential]")
      .replace(/\bvda_[A-Za-z0-9_-]+/g, "[redacted-credential]")
      .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-credential]")
      .replace(/\b[A-Za-z0-9_+\/-]{64,}={0,2}\b/g, "[redacted-long-value]");
    // Unrecognized credential-labelled formats fail closed instead of attempting
    // to parse arbitrary headers, JSON or query strings reflected by upstream.
    if (/\b(?:api[_ -]?key|authorization|access[_ -]?token|rtc[_ -]?(?:token|credential)|client[_ -]?secret|cookie|password|token|bearer|secret)\b/i.test(detail)
      || /(?:^|[?&\s])(?:key|auth|signature|credential)\s*[:=]/i.test(detail)) return undefined;
    detail = detail.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    return detail ? detail.slice(0, 400) : undefined;
  }
  private dependencyCode(detail?: string): StartError["dependencyCode"] {
    return detail && /failed to connect qwen realtime websocket/i.test(detail) ? "QWEN_REALTIME_CONNECT_FAILED" : undefined;
  }
  private restoreStartError(value: unknown): StartError | null {
    if (!record(value) || typeof value.message !== "string" || value.message.length > 600 || !Number.isSafeInteger(value.time) || (value.time as number) < 0) return null;
    const providerDetail = this.providerDetail(value.providerDetail), traceId = this.diagnosticTraceId(value.traceId), dependencyCode = this.dependencyCode(providerDetail);
    return { message: this.redact(value.message, 600), time: value.time as number,
      ...(typeof value.source === "string" && ["start", "initialization", "websocket"].includes(value.source) ? { source: value.source as StartError["source"] } : {}),
      ...(this.diagnosticCode(value.code) ? { code: this.diagnosticCode(value.code) } : {}),
      ...(providerDetail ? { providerDetail } : {}), ...(traceId ? { traceId } : {}), ...(dependencyCode ? { dependencyCode } : {}) };
  }
  private diagnosticError(lease: Lease, message: string, source: NonNullable<StartError["source"]>, code?: string, detail?: unknown, trace?: unknown) {
    const providerDetail = this.providerDetail(detail, lease), traceId = this.diagnosticTraceId(trace, lease) ?? lease.providerTraceId, dependencyCode = this.dependencyCode(providerDetail);
    const explanation = dependencyCode ? "；上游 Qwen 实时语音依赖连接失败" : "";
    lease.lastStartError = { message: this.redact(message + explanation + (providerDetail ? `；平台原因：${providerDetail}` : ""), 600), time: this.now(), source, ...(code ? { code } : {}),
      ...(providerDetail ? { providerDetail } : {}), ...(traceId ? { traceId } : {}), ...(dependencyCode ? { dependencyCode } : {}) };
    this.emit(lease, "start_error", lease.lastStartError);
  }
  private emit(lease: Lease, type: string, data: unknown) {
    lease.events.push({ id: crypto.randomUUID(), type, time: this.now(), data, ...(lease.session ? { sessionId: lease.session.id } : {}) });
    lease.events = lease.events.slice(-150);
  }
  private async transcript(lease: Lease, type: 9 | 10, message: Record<string, unknown>) {
    const sessionId = lease.session?.id;
    const content = this.redact(message.content, 8000);
    if (typeof message.content !== "string" || !content.trim()) return;
    const messageId = typeof message.msg_id === "string" && /^[A-Za-z0-9._:-]{1,300}$/.test(message.msg_id) && this.secretFree(message.msg_id) ? message.msg_id : null;
    if (!messageId) { this.emit(lease, "transcript", { role: type === 10 ? "主播" : "语音", text: content }); return; }
    const fingerprint = await hash(content);
    if (lease.closed || lease.session?.id !== sessionId || lease.session?.status === "ended") return;
    const key = `${type}:${messageId}`, transcripts = lease.transcripts ??= new Map(), previous = transcripts.get(key);
    if (previous?.seen.has(fingerprint)) return;
    const seen = previous?.seen ?? new Set<string>(); seen.add(fingerprint);
    const value = { id: previous?.id ?? crypto.randomUUID(), text: content, revision: (previous?.revision ?? -1) + 1, seen };
    transcripts.set(key, value);
    if (transcripts.size > 150) transcripts.delete(transcripts.keys().next().value!);
    const event: Event = { id: value.id, type: "transcript", time: this.now(), sessionId: lease.session!.id, revision: value.revision, data: { role: type === 10 ? "主播" : "语音", text: content } };
    const index = lease.events.findIndex(item => item.id === event.id);
    if (index >= 0) lease.events[index] = event; else lease.events.push(event);
    lease.events = lease.events.slice(-150);
  }
  private publicStatus(lease: Lease) {
    const session = lease.session ? { ...lease.session } : null;
    if (session?.mode === "real" && session.status === "ended") {
      const cause = lease.lastStartError?.message ?? (lease.providerEndReason ? `平台结束原因：${(HANGUP_REASONS[lease.providerEndReason] ?? "未识别的平台结束原因")}（${lease.providerEndReason}）` : session.reason !== "已手动结束" ? session.reason : "");
      session.reason = this.redact((lease.termination === "confirmed" ? "Vidu 已确认结束" : "已停止工作台；Vidu 结束状态尚未确认，请核对平台记录") + (cause ? `；${cause}` : ""));
    }
    return { configured: this.configured(), region: this.env.VIDU_REGION === "global" ? "global" : "cn", session,
      events: lease.events, tasks: [...lease.tasks.values()], lastStartError: lease.lastStartError,
      providerTermination: lease.termination, creationUncertain: lease.creationUncertain,
      ...(lease.providerEndReason ? { providerEndReason: lease.providerEndReason } : {}), ...(lease.controlClose ? { controlClose: lease.controlClose } : {}),
      ...(lease.providerStatus ? { providerStatus: lease.providerStatus } : {}),
      ...(lease.providerTraceId ? { providerTraceId: lease.providerTraceId } : {}),
      ...(lease.billedSeconds !== undefined ? { billedSeconds: lease.billedSeconds } : {}), ...(lease.creditsCost !== undefined ? { creditsCost: lease.creditsCost } : {}) };
  }
  private sessionDeadline(lease: Lease) {
    const session = lease.session;
    if (!session || session.status === "ended") return lease.expiresAt;
    // An open call follows the browser heartbeat and a one-hour cap. The
    // ten-minute workbench lease must not hang up a conversation in progress.
    const caps = [lease.heartbeatAt + HEARTBEAT_TTL, session.startedAt + CALL_LIMIT];
    if (session.status === "connecting") caps.push(session.startedAt + INITIAL_TTL);
    return Math.min(...caps);
  }
  private async persist() {
    const operation = this.persistence.then(async () => {
      // An anonymous cleanup miss must not poison a future account object.
      if (!this.owner && !this.leases.size) return;
      const stored: StoredState = { owner: this.owner, leases: [...this.leases.values()].map(lease => ({ id: lease.id, cleanupHash: lease.cleanupHash, expiresAt: lease.expiresAt,
        lastAccess: lease.lastAccess, closed: lease.closed, session: lease.session ? { ...lease.session } : null, connId: lease.connId, seq: lease.seq,
        heartbeatAt: lease.heartbeatAt, termination: lease.termination, terminationAttempts: lease.terminationAttempts, retryAt: lease.retryAt,
        creationUncertain: lease.creationUncertain,
        lastStartError: lease.lastStartError, ...(lease.providerEndReason ? { providerEndReason: lease.providerEndReason } : {}), ...(lease.controlClose ? { controlClose: lease.controlClose } : {}),
        ...(lease.providerStatus ? { providerStatus: lease.providerStatus } : {}),
        ...(lease.providerTraceId ? { providerTraceId: lease.providerTraceId } : {}),
        ...(lease.billedSeconds !== undefined ? { billedSeconds: lease.billedSeconds } : {}), ...(lease.creditsCost !== undefined ? { creditsCost: lease.creditsCost } : {}) })) };
      await this.ctx.storage.put("studio", stored);
      const times = [...this.leases.values()].flatMap(lease => {
        const due: number[] = [];
        const live = Boolean(lease.session && lease.session.status !== "ended");
        if (!lease.closed && !live) due.push(lease.expiresAt);
        if (live) due.push(this.sessionDeadline(lease));
        if ((lease.termination === "unknown" || lease.termination === "requested") && lease.terminationAttempts < 6) due.push(lease.retryAt);
        return due;
      });
      if (times.length) await this.ctx.storage.setAlarm(Math.max(this.now() + 1, Math.min(...times)));
      else await this.ctx.storage.deleteAlarm();
    });
    this.persistence = operation.catch(() => {});
    return operation;
  }
  private async api(lease: Lease, path: string, body?: unknown, timeoutMs = 45_000) {
    if (!this.configured()) throw new StudioError(503, "Vidu 服务尚未配置。");
    const abort = new AbortController(); lease.aborts.add(abort);
    try {
      const result = await (this.options.fetch ?? fetch)(this.base() + path, { method: body === undefined ? "GET" : "POST", redirect: "manual",
        headers: { Authorization: `Token ${this.env.VIDU_API_KEY}`, "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]) });
      const raw = await result.text();
      if (raw.length > 2_000_000) throw new StudioError(502, "Vidu 响应过大；请先核对平台记录，本次未重试。");
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new StudioError(502, `Vidu 返回空响应或非 JSON（HTTP ${result.status}）；无法确认创建结果，请先核对平台记录，勿重复提交。`); }
      if (!record(value)) throw new StudioError(502, "Vidu 响应无效；无法确认创建结果，请先核对平台记录，勿重复提交。");
      if (!result.ok) throw new StudioError(502, `Vidu HTTP ${result.status}：${this.redact(value.message ?? (record(value.error) ? value.error.message : value.reason), 400)}`);
      return value;
    } catch (error) {
      if (error instanceof StudioError) throw error;
      // A local deadline means no HTTP body came back. Keep it distinct from a
      // provider 502, which may already have opened a billable live.
      if (error instanceof Error && error.name === "TimeoutError") throw new StudioError(504, "Vidu 创建等待超时，未收到场次 ID。");
      throw new StudioError(503, "Vidu 请求结果未确认；请先核对状态与平台记录，勿重复创建。");
    } finally { lease.aborts.delete(abort); }
  }
  private send(lease: Lease, type: number, payload: unknown = {}) {
    const session = lease.session;
    if (!session || (session.status === "ended" && type !== 5)) throw new StudioError(409, "直播已结束。");
    if (![1, 5].includes(type) && session.status !== "ready") throw new StudioError(409, "控制通道尚未就绪。");
    const frame = { type, live_id: session.id, conn_id: lease.connId, seq_id: ++lease.seq, payload };
    if (session.mode === "real") {
      if (!lease.ws || lease.ws.readyState !== 1) throw new StudioError(503, "直播控制连接已断开。");
      lease.ws.send(JSON.stringify(frame));
    }
  }
  private clearTimers(lease: Lease) {
    if (lease.initTimer) clearTimeout(lease.initTimer); if (lease.watchdog) clearTimeout(lease.watchdog);
    lease.initTimer = lease.watchdog = undefined;
  }
  private watchdog(lease: Lease) {
    if (this.options.timers === false) return;
    if (lease.watchdog) clearTimeout(lease.watchdog);
    const deadline = this.sessionDeadline(lease);
    lease.watchdog = setTimeout(() => { this.ctx.waitUntil(this.expire()); }, Math.max(1, deadline - this.now()));
  }
  private async connect(lease: Lease, stopping = false) {
    const session = lease.session; if (!session || session.mode !== "real") return;
    // The deadline belongs to the HTTP handshake. A timeout signal that survives
    // the 101 upgrade aborts the established WebSocket at 20 seconds in workerd.
    const handshake = new AbortController(); lease.aborts.add(handshake);
    const deadline = setTimeout(() => handshake.abort(), 20_000);
    let result: Response & { webSocket?: WebSocket | null };
    try {
      result = await (this.options.fetch ?? fetch)(`${this.base()}/live/ws/live/connect?live_id=${encodeURIComponent(session.id)}&conn_id=${encodeURIComponent(lease.connId)}`, {
        headers: { Upgrade: "websocket", Authorization: `Token ${this.env.VIDU_API_KEY}` }, redirect: "manual", signal: handshake.signal,
      });
    } finally { clearTimeout(deadline); lease.aborts.delete(handshake); }
    const ws = result.webSocket;
    if (result.status !== 101 || !ws) { await result.body?.cancel(); throw new StudioError(502, "Vidu 控制连接未建立。"); }
    lease.ws = ws;
    ws.addEventListener("message", event => {
      if (lease.ws !== ws) return;
      this.ctx.waitUntil(this.message(lease, event.data));
    });
    const disconnected = (event: globalThis.Event) => {
      if (lease.ws !== ws) return;
      lease.ws = undefined;
      if (lease.session?.status !== "ended") {
        const close = event as CloseEvent;
        const code = event.type === "close" && Number.isInteger(close.code) && close.code >= 1000 && close.code <= 4999 ? close.code : null;
        // Arbitrary close reasons can reflect content or credentials. Keep
        // only the protocol code and a fixed explanation, never that text.
        const message = event.type === "error" ? "Vidu 控制 WebSocket 发生连接错误，已请求结束场次"
          : `Vidu 控制连接在场次结束前关闭${code !== null ? `（WS ${code}）` : ""}，已请求结束场次`;
        lease.controlClose = { code, wasClean: event.type === "close" && typeof close.wasClean === "boolean" ? close.wasClean : null, message, time: this.now() };
        this.diagnosticError(lease, message, "websocket", code !== null ? `WS_${code}` : undefined);
        this.ctx.waitUntil(this.end(lease, message));
      }
    };
    ws.addEventListener("error", disconnected); ws.addEventListener("close", disconnected);
    ws.accept();
    if (stopping || lease.closed || session.status === "ended") {
      this.send(lease, 5, { hangup: { hangup_reason: "user_end" } });
      lease.termination = "requested";
      lease.retryAt = this.now() + 5000;
      ws.close(1000, "studio ended");
      lease.ws = undefined;
      await this.persist();
      return;
    }
    this.initialize(lease); this.watchdog(lease);
  }
  private initialize(lease: Lease) {
    if (lease.closed || lease.session?.status !== "connecting") return;
    if (++lease.initAttempts > 25) { this.ctx.waitUntil(this.end(lease, "S2 初始化超时")); return; }
    try { this.send(lease, 1, { conn_init: { version: 1 } }); }
    catch { this.ctx.waitUntil(this.end(lease, "S2 初始化连接失败")); }
  }
  private async message(lease: Lease, raw: unknown) {
    if (typeof raw !== "string" || raw.length > 65_536) { this.emit(lease, "error", "收到无效直播消息。"); return; }
    let value: unknown; try { value = JSON.parse(raw); } catch { this.emit(lease, "error", "收到无法解析的直播消息。"); return; }
    if (!record(value) || !record(value.payload) || value.live_id !== undefined && value.live_id !== lease.session?.id || value.conn_id !== undefined && value.conn_id !== lease.connId) return;
    const payload = value.payload;
    if (value.type === 6) {
      const reason = record(payload.hangup) && typeof payload.hangup.hangup_reason === "string" ? payload.hangup.hangup_reason : "";
      lease.providerEndReason = Object.hasOwn(HANGUP_REASONS, reason) && this.secretFree(reason) ? reason : undefined;
      lease.termination = "confirmed";
      await this.end(lease, lease.providerEndReason ? `平台已结束直播：${(HANGUP_REASONS[lease.providerEndReason] ?? "未识别的平台结束原因")}（${lease.providerEndReason}）` : "平台已结束直播，未提供可识别的结束原因", false);
      await this.confirmTermination(lease); await this.persist(); return;
    }
    if (lease.closed || lease.session?.status === "ended") return;
    if (value.type === 2) {
      const ack = payload.conn_init_ack;
      if (!record(ack)) return;
      if (ack.success === true) { lease.session!.status = "ready"; lease.heartbeatAt = this.now(); this.emit(lease, "session", { ...lease.session! }); this.watchdog(lease); await this.persist(); }
      else if (ack.error_code === "NOT_READY" && lease.initAttempts < 25 && this.options.timers !== false) {
        if (lease.initTimer) clearTimeout(lease.initTimer);
        lease.initTimer = setTimeout(() => this.initialize(lease), 2000);
      } else {
        const code = this.diagnosticCode(ack.error_code);
        const message = (code && Object.hasOwn(INIT_ERRORS, code) ? INIT_ERRORS[code] : "S2 控制初始化失败，需核对 Vidu 平台记录") + (code ? `（${code}）` : "");
        // Only a bounded, redacted detail and strict trace ID can survive.
        // Raw upstream frames and exact redaction targets never persist.
        const trace = this.diagnosticTraceId(ack.trace_id, lease) ?? this.diagnosticTraceId(value.trace_id, lease)
          ?? this.diagnosticTraceId(record(ack.metadata) ? ack.metadata.trace_id : undefined, lease);
        if (trace) lease.providerTraceId = trace;
        this.diagnosticError(lease, message, "initialization", code, ack.error_msg, trace);
        const safeMessage = lease.lastStartError?.message ?? message;
        this.emit(lease, "error", safeMessage); await this.end(lease, safeMessage);
      }
    } else if (value.type === 12 && record(payload.prompt_operation_ack)) {
      const ack = payload.prompt_operation_ack;
      this.emit(lease, "reference", { success: ack.success === true, ...(typeof ack.error_code === "string" ? { error_code: this.redact(ack.error_code, 100) } : {}), ...(typeof ack.error_msg === "string" ? { error_msg: this.redact(ack.error_msg) } : {}) });
    } else if ((value.type === 9 || value.type === 10) && record(payload.text_msg)) {
      await this.transcript(lease, value.type, payload.text_msg);
    }
  }
  private async requestTermination(lease: Lease) {
    if (!lease.session || lease.session.mode !== "real" || lease.termination === "confirmed") return;
    if (lease.terminating) return lease.terminating;
    const pending = (async () => {
      lease.terminationAttempts++;
      // The active connection can send hangup immediately. Status lookup must
      // never keep the live running while a slow query completes.
      if (lease.termination !== "requested" && lease.ws?.readyState === 1) {
        try {
          this.send(lease, 5, { hangup: { hangup_reason: "user_end" } }); lease.termination = "requested";
          lease.retryAt = this.now() + 5000; lease.ws.close(1000, "studio ended"); lease.ws = undefined;
        } catch { lease.termination = "unknown"; }
      }
      // Recreated instances may find the provider has already ended the live.
      try { await this.confirmTermination(lease); } catch { /* Still try hangup when metadata storage is unavailable. */ }
      if (lease.termination === "confirmed") return;
      try {
        if (lease.termination !== "requested") {
          if (lease.ws?.readyState === 1) {
            this.send(lease, 5, { hangup: { hangup_reason: "user_end" } }); lease.termination = "requested";
            lease.retryAt = this.now() + 5000;
            lease.ws.close(1000, "studio ended"); lease.ws = undefined;
          } else await this.connect(lease, true);
          await this.confirmTermination(lease);
        }
      } catch {
        lease.termination = "unknown"; lease.retryAt = this.now() + Math.min(300_000, 5000 * 2 ** Math.min(lease.terminationAttempts, 6));
        this.emit(lease, "error", "旧直播结束请求未送达；请核对 Vidu 后台，自动重试最多六次。");
      }
      await this.persist();
    })();
    lease.terminating = pending;
    try { await pending; } finally { lease.terminating = undefined; }
  }
  private async confirmTermination(lease: Lease) {
    if (!lease.session || lease.session.mode !== "real" || lease.termination === "confirmed" && lease.providerStatus === "ended" && lease.billedSeconds !== undefined && lease.creditsCost !== undefined) return;
    if (lease.receipt) return lease.receipt;
    const sessionId = lease.session.id;
    const pending = (async () => {
    try {
      const result = await this.api(lease, `/live/v1/lives/${encodeURIComponent(sessionId)}`, undefined, 3000), live = result.live;
      if (!record(live) || live.id !== sessionId || !["waiting", "prepared", "on_live", "ending", "ended"].includes(String(live.status))) throw new Error("Invalid live status");
      if (lease.session?.id !== sessionId) return;
      lease.providerStatus = live.status as string;
      const trace = this.diagnosticTraceId(live.trace_id, lease); if (trace) {
        lease.providerTraceId = trace;
        if (lease.lastStartError && !lease.lastStartError.traceId) lease.lastStartError.traceId = trace;
      }
      const seconds = providerAmount(live.billed_seconds), credits = providerAmount(live.credits_cost);
      if (seconds !== undefined) lease.billedSeconds = seconds;
      if (credits !== undefined) lease.creditsCost = credits;
      if (live.status === "ended") lease.termination = "confirmed";
      // A force-hangup acknowledgement is authoritative even while metadata lags.
      // Retry only the receipt; never reconnect an already confirmed live.
      if (live.status !== "ended" || seconds === undefined || credits === undefined) lease.retryAt = this.now() + 5000;
    } catch { if (lease.session?.id === sessionId) lease.retryAt = this.now() + 30_000; }
      if (lease.session?.id === sessionId) await this.persist();
    })();
    lease.receipt = pending;
    try { await pending; } finally { lease.receipt = undefined; }
  }
  private async end(lease: Lease, reason: string, sendHangup = true) {
    this.clearTimers(lease);
    const session = lease.session;
    if (!session) return;
    const changed = session.status !== "ended";
    session.status = "ended"; if (changed || !session.reason) session.reason = this.redact(reason);
    if (session.mode === "rehearsal") lease.termination = "confirmed";
    else if (sendHangup && lease.termination !== "confirmed" && lease.termination !== "requested") {
      lease.termination = "unknown"; lease.retryAt = this.now();
      // A storage outage must not prevent the best-effort provider hangup.
      // The final persist still fails the request instead of claiming cleanup.
      try { await this.persist(); } finally { await this.requestTermination(lease); }
    }
    if (lease.ws) { try { lease.ws.close(1000, "studio ended"); } catch {} lease.ws = undefined; }
    if (changed) this.emit(lease, "session", { ...session });
    await this.persist();
  }
  private async expire(background = false) {
    await this.initialized;
    const work: Promise<void>[] = [];
    for (const lease of this.leases.values()) {
      const live = Boolean(lease.session && lease.session.status !== "ended");
      if (!lease.closed && !live && lease.expiresAt <= this.now()) { lease.closed = true; for (const controller of lease.aborts) controller.abort(); work.push(this.end(lease, "工作台十分钟期限已到")); }
      else if (live && this.now() >= this.sessionDeadline(lease)) {
        const session = lease.session!;
        const capped = this.now() >= session.startedAt + CALL_LIMIT;
        if (capped) lease.expiresAt = this.now() + 120_000;
        work.push(this.end(lease, session.status === "connecting" ? "S2 初始化超时" : capped ? "通话已到一小时上限" : "控制台心跳超时"));
      }
      if ((lease.termination === "unknown" || lease.termination === "requested") && lease.terminationAttempts < 6 && lease.retryAt <= this.now()) work.push(this.requestTermination(lease));
    }
    const completion = Promise.all(work).then(() => this.persist());
    if (background) this.ctx.waitUntil(completion); else await completion;
  }
  async alarm() { await this.expire(); }
  private async locked<T>(lease: Lease, operation: () => Promise<T>) {
    const previous = lease.tail; let release!: () => void;
    lease.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { if (lease.closed) throw new StudioError(404, "工作台已结束。"); return await operation(); } finally { release(); }
  }
  private releaseUnconfirmedCreates() {
    let released = false;
    for (const lease of this.leases.values()) {
      if (!lease.creationUncertain || lease.session) continue;
      const message = lease.lastStartError?.message ?? "";
      // A 4xx is a rejected create, so Vidu did not open a billable live.
      // An expired workbench with no session id is past the 60s idle cap.
      if (/Vidu HTTP 4\d\d/.test(message) || lease.expiresAt <= this.now()) {
        this.leases.delete(lease.id); released = true;
      }
    }
    return released;
  }
  private async create(identity: Identity) {
    if (!this.owner) this.owner = identity.id;
    if (this.owner !== identity.id) throw new StudioError(403, "工作台归属不匹配。");
    // Resolve a previous lost cleanup before allowing another billable session.
    for (const lease of this.leases.values()) if (lease.termination === "unknown" || lease.termination === "requested") await this.requestTermination(lease);
    if ([...this.leases.values()].some(lease => lease.termination === "unknown" || lease.termination === "requested")) throw new StudioError(503, "旧直播结束未确认，请先核对平台记录再打开新工作台。");
    if (this.releaseUnconfirmedCreates()) await this.persist();
    const unconfirmed = [...this.leases.values()].find(lease => lease.creationUncertain);
    if (unconfirmed) {
      const reason = unconfirmed.lastStartError?.message;
      throw new StudioError(503, reason
        ? `有开播请求未返回可核对的场次 ID。${reason}`
        : "有开播请求未返回可核对的场次 ID；需人工核对 Vidu 平台记录后解除，不能继续创建。");
    }
    if ([...this.leases.values()].some(lease => lease.closed && lease.starting)) throw new StudioError(503, "旧开播请求仍在收尾，请先刷新状态。");
    if ([...this.leases.values()].filter(lease => !lease.closed).length >= 2) throw new StudioError(429, "最多同时打开两个工作台，请先结束另一个。");
    for (const lease of this.leases.values()) if (lease.closed && !lease.creationUncertain && lease.termination !== "unknown" && lease.termination !== "requested") this.leases.delete(lease.id);
    if (this.leases.size >= 8) throw new StudioError(503, "旧工作台正在确认结束，请稍后重试。");
    const prefix = await viduStudioOwnerPrefix(identity.id), random = hex(crypto.getRandomValues(new Uint8Array(8)).buffer);
    const all = prefix + random, id = `${all.slice(0, 8)}-${all.slice(8, 12)}-${all.slice(12, 16)}-${all.slice(16, 20)}-${all.slice(20)}`;
    const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer), now = this.now();
    const lease: Lease = { id, cleanupHash: await hash(token), expiresAt: now + LEASE_TTL, lastAccess: now, closed: false, session: null,
      connId: "", seq: 0, heartbeatAt: now, termination: null, terminationAttempts: 0, retryAt: 0, creationUncertain: false,
      events: [], tasks: new Map(), starting: false, tail: Promise.resolve(), lastStartError: null, initAttempts: 0, aborts: new Set(), redactionTargets: new Set([token]) };
    this.leases.set(id, lease); await this.persist();
    return { leaseId: id, accountId: identity.id, cleanupToken: token };
  }
  private releaseStaleUnconfirmed() {
    for (const lease of this.leases.values()) {
      if (!lease.creationUncertain || lease.session) continue;
      const message = lease.lastStartError?.message ?? "";
      const age = this.now() - (lease.lastStartError?.time ?? 0);
      // A local create deadline has no live id. Wait a minute so a slow provider
      // response cannot overlap a second billable POST. A stored generic
      // unconfirmed error with no session is the same situation after that wait.
      if (/创建等待超时/.test(message) && age >= 60_000 || /开播结果无法确认/.test(message) && age >= 60_000) {
        lease.creationUncertain = false; lease.lastStartError = null;
      }
    }
  }
  private async start(lease: Lease, body: Record<string, unknown>, request: Request) {
    if (body.mode !== "real") throw new StudioError(400, "仅支持 Vidu S2 实时直播，请刷新页面后开播。");
    if (lease.starting || lease.session && lease.session.status !== "ended") throw new StudioError(409, "已有直播，请先结束。");
    if ([...this.leases.values()].some(item => item.termination === "unknown" || item.termination === "requested" || item.closed && item.starting)) throw new StudioError(409, "上一轮直播结束尚未确认，请先核对平台记录。");
    this.releaseStaleUnconfirmed();
    if ([...this.leases.values()].some(item => item.creationUncertain)) throw new StudioError(409, "有开播请求结果不明；需人工核对 Vidu 平台记录后解除，不能重复开播。");
    const avatar = image(body.avatar), persona = text(body.persona || "你是一位自然、友善的中文主播。", "主播设定", 5000);
    const voiceProvider = body.voiceProvider === undefined ? "qwen_omni" : body.voiceProvider;
    if (voiceProvider !== "qwen_omni" && voiceProvider !== "doubao") throw new StudioError(400, "请选择支持的语音线路：qwen_omni 或 doubao。");
    const expectedVoice = voiceProvider === "doubao" ? "zh_female_liuchangnv_uranus_bigtts" : "Tina";
    const voice = body.voice === undefined ? expectedVoice : text(body.voice, "声音", 100);
    if (getXumengLiveVoice(voice)?.provider !== voiceProvider) throw new StudioError(400, "声音与语音线路不匹配，请重新选择。");
    lease.starting = true; lease.lastStartError = null; lease.providerEndReason = undefined; lease.controlClose = undefined; lease.providerTraceId = undefined;
    // Keep the original cleanup capability (first target) across starts, then
    // replace the previous session's transient content/credential targets.
    lease.redactionTargets = new Set([...lease.redactionTargets].slice(0, 1));
    lease.redactionTargets.add(avatar); lease.redactionTargets.add(persona);
    let createSent = false;
    try {
      lease.creationUncertain = true; await this.persist(); createSent = true;
      const result = await this.api(lease, "/live/s_avatar/realtime", { model: "vidu-s2", call_mode: "video",
        avatar: { image_uri: avatar, persona: persona + "\n收到【表演指令】时，将其作为导演给出的回应方向、情绪和动作。按意图用自己的话自然回应，配合动作；不要朗读指令或解释执行过程。没有给出明确台词时，自行组织简短中文表达。", voice },
        voice_model: voiceProvider === "doubao" ? { provider: "doubao", doubao: { voice } } : { provider: "qwen_omni", qwen: { voice } },
        action: { enabled: true }, audio: { enable_transcription: true }, enable_recording: true, idle_timeout_seconds: IDLE_TIMEOUT_SECONDS }, 90_000);
      const live = result.live;
      if (!record(live) || typeof live.id !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(live.id) || !this.secretFree(live.id)) throw new StudioError(502, "Vidu 未返回有效场次 ID；请核对平台记录，勿重复创建。");
      const rtc = result.rtc;
      for (const credential of [record(rtc) ? rtc.token : undefined, record(rtc) ? rtc.user_id : undefined, result.client_secret, live.client_secret]) {
        if (typeof credential === "string" && credential) lease.redactionTargets.add(credential);
      }
      lease.providerTraceId = this.diagnosticTraceId(live.trace_id, lease) ?? this.diagnosticTraceId(result.trace_id, lease)
        ?? this.diagnosticTraceId(record(result.metadata) ? result.metadata.trace_id : undefined, lease);
      lease.providerStatus = undefined; lease.billedSeconds = undefined; lease.creditsCost = undefined; lease.retryAt = 0;
      lease.session = { id: live.id, mode: "real", control: "performance", status: "connecting", startedAt: this.now() };
      lease.events = []; lease.transcripts = new Map();
      lease.creationUncertain = false;
      lease.connId = crypto.randomUUID(); lease.seq = 0; lease.heartbeatAt = this.now(); lease.termination = null; lease.terminationAttempts = 0;
      // Save the only information needed to end this live before opening WS.
      await this.persist();
      if (lease.closed || request.signal.aborted || lease.expiresAt <= this.now()) { await this.end(lease, "开播请求已取消，正在请求结束直播"); throw new StudioError(409, "开播请求已取消，结束状态请查看工作台。"); }
      if (!record(rtc) || typeof rtc.token !== "string" || rtc.token.length < 1 || rtc.token.length > 20_000 || !this.secretFree(rtc.token) || typeof rtc.user_id !== "string" || rtc.user_id.length < 1 || rtc.user_id.length > 300 || !this.secretFree(rtc.user_id)) {
        await this.end(lease, "平台播放器凭证无效，正在请求结束直播"); throw new StudioError(502, "Vidu 播放器凭证无效；已请求结束场次，请先核对状态。");
      }
      await this.connect(lease);
      if (lease.closed || request.signal.aborted || lease.session.status === "ended") { await this.end(lease, "开播请求已取消"); throw new StudioError(409, "直播已结束。"); }
      this.emit(lease, "session", { ...lease.session });
      return { session: { ...lease.session }, rtc: { token: rtc.token, user_id: rtc.user_id } };
    } catch (error) {
      if (!createSent) lease.creationUncertain = false;
      if (lease.session && lease.session.status !== "ended") await this.end(lease, "开播连接失败，正在请求结束直播");
      if (error instanceof StudioError && /创建等待超时/.test(error.message)) this.diagnosticError(lease, error.message, "start", "CREATE_TIMEOUT");
      else if (!lease.lastStartError) this.diagnosticError(lease, lease.creationUncertain ? "开播结果无法确认，请先核对 Vidu 平台记录，勿重复创建。"
        : "开播控制连接失败，已请求结束本次场次；请核对 Vidu 平台记录。", "start");
      await this.persist(); throw error;
    } finally { lease.starting = false; }
  }
  private async control(lease: Lease, action: string, body: Record<string, unknown>, request: Request, _identity: Identity) {
    if (action === "start") return this.start(lease, body, request);
    if (SESSION_ACTIONS.has(action)) {
      if (!lease.session || body.id !== lease.session.id) throw new StudioError(409, "直播场次已变化，请刷新状态。");
    }
    if (action === "stop") { await this.end(lease, "已手动结束"); return { providerTermination: lease.termination }; }
    if (action === "heartbeat") {
      if (lease.session && lease.session.status !== "ended") {
        const now = this.now();
        lease.heartbeatAt = now;
        lease.expiresAt = Math.min(lease.session.startedAt + CALL_LIMIT, Math.max(lease.expiresAt, now + LEASE_TTL));
        this.watchdog(lease);
        await this.persist();
      }
      return {};
    }
    if (action === "interaction") {
      let interaction;
      try { interaction = parseXumengLiveInteraction(body); } catch (error) { throw new StudioError(400, error instanceof Error ? error.message : "玩家互动格式无效。"); }
      const content = buildXumengLiveInteractionPrompt(interaction);
      this.send(lease, 99, { text_msg: { msg_id: crypto.randomUUID(), content, timestamp: this.now() } });
      this.emit(lease, "interaction", { kind: interaction.kind, name: interaction.name, text: interaction.text, delivery: "已发送至 S2，等待人物回应" });
      return { sent: true };
    }
    if (action === "execute") {
      const intent = body.intent ? text(body.intent, "回应方向", 1000) : "", emotion = body.emotion ? text(body.emotion, "情绪", 100) : "", motion = body.motion ? text(body.motion, "动作", 500) : "";
      if (!intent && !emotion && !motion) throw new StudioError(400, "至少填写回应方向、情绪或动作。");
      const content = ["【表演指令】", intent && `回应方向：${intent}`, emotion && `情绪：${emotion}`, motion && `动作：${motion}`, "请理解以上意图，自行组织简短自然的中文表达并表演。不要朗读这些指令。"].filter(Boolean).join("\n");
      this.send(lease, 99, { text_msg: { msg_id: crypto.randomUUID(), content, timestamp: this.now() } });
      this.emit(lease, "direction", { intent, emotion, motion, rehearsal: lease.session?.mode === "rehearsal" }); return { sent: true };
    }
    if (action === "danmaku") {
      const content = text(body.text, "弹幕", 500), name = text(body.name || "观众", "昵称", 40);
      this.send(lease, 99, { text_msg: { msg_id: crypto.randomUUID(), content: `${name}说：${content}`, timestamp: this.now() } });
      this.emit(lease, "danmaku", { name, text: content, delivery: lease.session?.mode === "real" ? "已发送至 S2" : "本地演练 · 未调用模型" }); return { sent: true };
    }
    if (action === "interrupt") { this.send(lease, 7); return {}; }
    if (action === "references") {
      let payload: unknown = { prompt_operation: { op_type: "remove" } };
      if (body.remove !== true) {
        if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 3) throw new StudioError(400, "动态参考图需要 1–3 张。");
        payload = { prompt_operation: { op_type: "switch", images: body.images.map(candidate => {
          if (!record(candidate) || !["object", "garment", "background"].includes(String(candidate.kind))) throw new StudioError(400, "参考图类型无效。");
          return { image_uri: image(candidate.url), image_id: crypto.randomUUID(), kind: candidate.kind, user_text: text(candidate.description ?? "", "图片说明", 2000, false) };
        }) } };
        if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 15 * 1024 * 1024) throw new StudioError(413, "参考图合计过大。");
      }
      this.send(lease, 11, payload); this.emit(lease, "reference", { pending: true, message: "参考图已提交，等待确认" }); return {};
    }
    if (action === "generate") {
      if (body.kind !== "image" && body.kind !== "video") throw new StudioError(400, "生成类型无效。");
      if (!Array.isArray(body.images) || body.images.length > 3) throw new StudioError(400, "最多三张参考图。");
      const prompt = text(body.prompt, "提示词", 2000), images = body.images.map(image);
      const path = body.kind === "image" ? "/ent/v2/reference2image" : images.length ? "/ent/v2/reference2video" : "/ent/v2/text2video";
      const result = await this.api(lease, path, { model: body.kind === "image" ? "viduq2" : "viduq3-turbo", prompt, images, aspect_ratio: "16:9", resolution: body.kind === "image" ? "1080p" : "720p", ...(body.kind === "video" ? { duration: 5, audio: true } : {}) });
      if (typeof result.task_id !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(result.task_id) || !this.secretFree(result.task_id)) throw new StudioError(502, "平台未返回有效任务 ID；请先核对后台，不要重复提交。");
      if (lease.closed) throw new StudioError(409, "工作台已结束；请在平台核对已提交素材。");
      const task: Task = { id: result.task_id, kind: body.kind, state: typeof result.state === "string" ? this.redact(result.state, 64) : "created", createdAt: this.now(), prompt, creations: [] };
      lease.tasks.set(task.id, task); if (lease.tasks.size > 100) lease.tasks.delete(lease.tasks.keys().next().value!); this.emit(lease, "task", { ...task }); return task;
    }
    if (action === "task") {
      const task = typeof body.id === "string" ? lease.tasks.get(body.id) : undefined; if (!task) throw new StudioError(404, "当前工作台没有该素材任务。");
      const result = await this.api(lease, `/ent/v2/tasks/${encodeURIComponent(task.id)}/creations`);
      if (lease.closed) throw new StudioError(404, "工作台已结束。");
      task.state = typeof result.state === "string" ? this.redact(result.state, 64) : task.state;
      task.creations = Array.isArray(result.creations) ? result.creations.slice(0, 20).flatMap(item => record(item) && safeUrl(item.url) && this.secretFree(item.url as string) ? [{ url: safeUrl(item.url)! }] : []) : [];
      const error = result.err_code ?? result.error_message; if (typeof error === "string") task.error = this.redact(error);
      this.emit(lease, "task", { ...task }); return task;
    }
    if (action === "recording") {
      if (!lease.session || lease.session.mode !== "real") throw new StudioError(409, "没有真实直播录制可查询。");
      const result = await this.api(lease, `/live/v1/lives/${encodeURIComponent(lease.session.id)}/recording`);
      const url = safeUrl(record(result.recording) ? result.recording.video_url : undefined);
      return { recording: url && this.secretFree(url) ? { video_url: url } : {}, ...(typeof result.state === "string" ? { state: this.redact(result.state, 64) } : {}) };
    }
    throw new StudioError(404, "直播接口不存在。");
  }
  async fetch(request: Request): Promise<Response> {
    try {
      await this.initialized;
      const url = new URL(request.url), route = /^\/leases\/([a-f0-9-]{36})(?:\/([a-z]+))?$/.exec(url.pathname);
      if (url.origin !== "https://live-studio.internal" || url.search || !(url.pathname === "/status" || url.pathname === "/leases" || route && UUID.test(route[1]))) throw new StudioError(404, "工作台接口不存在。");
      const expected = url.pathname === "/status" || route?.[2] === "status" ? "GET" : url.pathname === "/leases" ? "POST" : route && !route[2] ? "DELETE" : "POST";
      if (request.method !== expected) throw new StudioError(405, "请求方法无效。");
      const id = request.headers.get("X-Xumeng-Live-User"), role = request.headers.get("X-Xumeng-Live-Role");
      if (!id || !/^[A-Za-z0-9_-]{1,120}$/.test(id) || role !== "user" && role !== "super" || id === "lease_cleanup" && request.method !== "DELETE") throw new StudioError(401, "内部账户身份无效。");
      const identity: Identity = { id, role };
      const body = request.method === "GET" ? {} : await jsonBody(request);
      if (url.pathname === "/status") {
        if (this.owner && this.owner !== id) throw new StudioError(404, "工作台归属不匹配。");
        if (!this.owner) { this.owner = id; await this.persist(); }
        await this.expire(true);
        return response(200, { available: true, configured: this.configured(), realAllowed: true, region: this.env.VIDU_REGION === "global" ? "global" : "cn", accountId: id });
      }
      if (url.pathname === "/leases") {
        if (this.owner && this.owner !== id) throw new StudioError(404, "工作台归属不匹配。");
        await this.expire(true);
        const previous = this.creatingLease; let release!: () => void;
        this.creatingLease = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try { return response(201, await this.create(identity)); } finally { release(); }
      }
      const lease = this.leases.get(route![1]), action = route![2];
      if (!lease) throw new StudioError(404, "工作台不存在或已过期。");
      if (request.method === "DELETE") {
        const validToken = typeof body.cleanupToken === "string" && /^[a-f0-9]{64}$/.test(body.cleanupToken) && await equalHash(body.cleanupToken, lease.cleanupHash);
        if (identity.id !== this.owner && !validToken) throw new StudioError(404, "工作台不存在或已过期。");
        lease.closed = true; for (const abort of lease.aborts) abort.abort();
        await this.end(lease, "晴屿工作台已结束");
        return response(200, { ended: true, providerTermination: lease.termination });
      }
      if (this.owner !== id || lease.closed) throw new StudioError(404, "工作台不存在或已结束。");
      // Enforce the pause inside the private object too, even if a caller skips
      // the public gateway. Do not block existing tasks, recordings or calls.
      if (action === "generate" && this.env.GENERATION_ENABLED === "false") throw new StudioError(503, "生图和生视频已暂停，请稍后再试。");
      await this.expire(true);
      if (lease.closed) throw new StudioError(404, "工作台不存在或已结束。");
      lease.lastAccess = this.now();
      if (action === "status") {
        // Hangup confirms transport termination, but its frame has no usage.
        // Recovered old ended leases may not yet have the final platform receipt.
        if (lease.session?.mode === "real" && lease.session.status === "ended" && (lease.providerStatus !== "ended" || lease.billedSeconds === undefined || lease.creditsCost === undefined) && lease.retryAt <= this.now()) await this.confirmTermination(lease);
        return response(200, { ...this.publicStatus(lease), accountId: id });
      }
      if (!action || !ACTIONS.has(action)) throw new StudioError(404, "直播接口不存在。");
      if (action === "start" && body.mode !== "real") throw new StudioError(400, "仅支持 Vidu S2 实时直播，请刷新页面后开播。");
      if (role !== "super" && ["generate", "task"].includes(action)) throw new StudioError(403, "素材生成暂未向当前账号开放。");
      // Stop and heartbeat must not wait for long create/material network I/O.
      const value = ["heartbeat", "stop", "generate", "task", "recording"].includes(action)
        ? await this.control(lease, action, body, request, identity)
        : await this.locked(lease, () => this.control(lease, action, body, request, identity));
      return response(200, { ...value, accountId: id });
    } catch (error) {
      return response(error instanceof StudioError ? error.status : 503, { error: this.redact(error instanceof StudioError ? error.message : "工作台暂不可用，请先刷新状态后重试。") });
    }
  }
}
