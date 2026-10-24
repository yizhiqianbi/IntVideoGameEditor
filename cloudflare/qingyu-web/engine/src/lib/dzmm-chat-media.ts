export type DzmmChatMediaKind = "audio" | "image";
export type DzmmChatMediaAsset = {
  id: string; conversationId: string; messageId: string; kind: DzmmChatMediaKind;
  url: string; sourceHash: string; createdAt: number; mimeType: string;
  audioTextChars?: number; totalTextChars?: number;
};
export type DzmmChatMediaTarget = { messageId: string; kind: DzmmChatMediaKind; sourceHash: string };
export type DzmmChatMediaPending = DzmmChatMediaTarget & { id: string; expiresAt: number };
export type DzmmChatMediaOverview = {
  accountId: string; conversationId: string;
  vip: { active: boolean; expiresAt: number | null; adminPreview: boolean; unlimited?: boolean };
  quotaUnlimited?: boolean;
  features: { audio: boolean; image: boolean };
  limits: { audio: number; image: number; maxVoiceChars: number };
  usage: { audio: number; image: number };
  assets: DzmmChatMediaAsset[];
  // Missing on older servers; absence is not confirmation that a submitted job ended.
  pending?: DzmmChatMediaPending[];
};

export class DzmmChatMediaError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmChatMediaError"; }
}
const API = "/api/backend/v1/chat-media";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 120 && !value.includes("\0");
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is number => count(value) && value <= 8_640_000_000_000_000;
const invalid = () => new DzmmChatMediaError(502, "消息素材返回格式无效，请刷新后重试。");
const DIRECTORY_PAGE_SIZE = 500;
const DIRECTORY_PAGE_BYTES = 2 * 1024 * 1024;
const DIRECTORY_TOTAL_BYTES = 16 * 1024 * 1024;
type DirectoryPoint = { createdAt: number; id: string };
const comparePoints = (left: DirectoryPoint, right: DirectoryPoint) =>
  left.createdAt === right.createdAt ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) : left.createdAt < right.createdAt ? -1 : 1;
const samePoint = (left: DirectoryPoint | null, right: DirectoryPoint | null) =>
  left === null || right === null ? left === right : comparePoints(left, right) === 0;
function parsePoint(value: unknown): DirectoryPoint {
  if (!record(value) || !timestamp(value.createdAt) || !id(value.id) || !/^[A-Za-z0-9_-]+$/.test(value.id)) throw invalid();
  return { createdAt: value.createdAt, id: value.id };
}

function parseDirectoryCursor(value: unknown, accountId: string, conversationId: string, upper: DirectoryPoint): DirectoryPoint {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw invalid();
  let parts: unknown;
  try { parts = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))); } catch { throw invalid(); }
  if (!Array.isArray(parts) || parts.length !== 8 || parts[0] !== 1 || parts[1] !== accountId
    || parts[2] !== conversationId || parts[3] !== DIRECTORY_PAGE_SIZE) throw invalid();
  const after = parsePoint({ createdAt: parts[4], id: parts[5] });
  const bound = parsePoint({ createdAt: parts[6], id: parts[7] });
  if (!samePoint(bound, upper) || comparePoints(after, upper) >= 0) throw invalid();
  return after;
}

function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener("abort", stop); reject(signal.reason); };
    signal.addEventListener("abort", stop, { once: true });
    // Retain rejection handlers on a late operation even after cancellation wins.
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(value => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => { signal.removeEventListener("abort", stop); reject(error); });
  });
}

async function readDirectoryJson(response: Response, signal: AbortSignal, bytes: { total: number }): Promise<unknown> {
  const oversized = () => new DzmmChatMediaError(502, "消息素材目录过大，请稍后重新加载。");
  if (Number(response.headers.get("Content-Length")) > DIRECTORY_PAGE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw oversized();
  }
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pageBytes = 0, source = "", finished = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const item = await abortable(() => reader.read(), signal);
      signal.throwIfAborted();
      if (item.done) { finished = true; break; }
      pageBytes += item.value.byteLength;
      bytes.total += item.value.byteLength;
      if (pageBytes > DIRECTORY_PAGE_BYTES || bytes.total > DIRECTORY_TOTAL_BYTES) throw oversized();
      source += decoder.decode(item.value, { stream: true });
    }
    source += decoder.decode();
    signal.throwIfAborted();
    try { return JSON.parse(source); } catch { throw invalid(); }
  } finally {
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function parseDzmmChatMediaAsset(value: unknown, conversationId: string): DzmmChatMediaAsset {
  if (!record(value) || !id(value.id) || !/^[A-Za-z0-9_-]+$/.test(value.id) || value.conversationId !== conversationId
    || !id(value.messageId) || (value.kind !== "audio" && value.kind !== "image")
    || value.url !== `${API}/assets/${value.id}` || typeof value.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceHash)
    || !timestamp(value.createdAt) || typeof value.mimeType !== "string"
    || !(value.kind === "audio" ? ["audio/mpeg", "audio/wav"] : ["image/jpeg", "image/png", "image/webp"]).includes(value.mimeType)
    || (value.audioTextChars !== undefined && !count(value.audioTextChars))
    || (value.totalTextChars !== undefined && !count(value.totalTextChars))) throw invalid();
  return { id: value.id, conversationId, messageId: value.messageId, kind: value.kind, url: value.url,
    sourceHash: value.sourceHash, createdAt: value.createdAt, mimeType: value.mimeType,
    ...(value.audioTextChars !== undefined ? { audioTextChars: value.audioTextChars as number } : {}),
    ...(value.totalTextChars !== undefined ? { totalTextChars: value.totalTextChars as number } : {}) };
}

export function parseDzmmChatMediaOverview(value: unknown, accountId: string, conversationId: string): DzmmChatMediaOverview {
  if (!record(value) || value.accountId !== accountId || value.conversationId !== conversationId || !record(value.vip)
    || typeof value.vip.active !== "boolean" || typeof value.vip.adminPreview !== "boolean"
    || (value.vip.unlimited !== undefined && typeof value.vip.unlimited !== "boolean")
    || (value.quotaUnlimited !== undefined && typeof value.quotaUnlimited !== "boolean")
    || (value.quotaUnlimited === true && value.vip.unlimited !== true)
    || (value.vip.expiresAt !== null && !timestamp(value.vip.expiresAt))
    || !record(value.features) || typeof value.features.audio !== "boolean" || typeof value.features.image !== "boolean"
    || !record(value.limits) || !count(value.limits.audio) || !count(value.limits.image) || !count(value.limits.maxVoiceChars)
    || !record(value.usage) || !count(value.usage.audio) || !count(value.usage.image)
    || !Array.isArray(value.assets) || value.assets.length > 500) throw invalid();
  const assets = value.assets.map(asset => parseDzmmChatMediaAsset(asset, conversationId));
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) throw invalid();
  let pending: DzmmChatMediaPending[] | undefined;
  if (value.pending !== undefined) {
    if (!Array.isArray(value.pending)) throw invalid();
    pending = value.pending.map(item => {
      if (!record(item) || !id(item.id) || !/^[A-Za-z0-9_-]+$/.test(item.id) || !id(item.messageId)
        || (item.kind !== "audio" && item.kind !== "image") || typeof item.sourceHash !== "string"
        || !/^[a-f0-9]{64}$/.test(item.sourceHash) || !timestamp(item.expiresAt)) throw invalid();
      return { id: item.id, messageId: item.messageId, kind: item.kind, sourceHash: item.sourceHash, expiresAt: item.expiresAt };
    });
    if (new Set(pending.map(item => item.id)).size !== pending.length) throw invalid();
  }
  return { accountId, conversationId, vip: { active: value.vip.active, expiresAt: value.vip.expiresAt as number | null,
    adminPreview: value.vip.adminPreview, ...(value.vip.unlimited !== undefined ? { unlimited: value.vip.unlimited } : {}) },
    ...(value.quotaUnlimited !== undefined ? { quotaUnlimited: value.quotaUnlimited } : {}), features: { audio: value.features.audio, image: value.features.image },
    limits: { audio: value.limits.audio, image: value.limits.image, maxVoiceChars: value.limits.maxVoiceChars },
    usage: { audio: value.usage.audio, image: value.usage.image }, assets, ...(pending !== undefined ? { pending } : {}) };
}

export function resolveDzmmChatMediaResult(overview: DzmmChatMediaOverview, target: DzmmChatMediaTarget):
  { state: "ready"; asset: DzmmChatMediaAsset } | { state: "pending"; pending: DzmmChatMediaPending } | { state: "absent" | "unknown" } {
  const matches = (item: DzmmChatMediaTarget) => item.messageId === target.messageId && item.kind === target.kind && item.sourceHash === target.sourceHash;
  const asset = overview.assets.find(matches);
  if (asset) return { state: "ready", asset };
  const pending = overview.pending?.find(matches);
  // Only the server can decide expiry; a client's clock never releases a reservation.
  if (pending) return { state: "pending", pending };
  return { state: overview.pending === undefined ? "unknown" : "absent" };
}

async function request(path: string, signal?: AbortSignal, body?: unknown, directoryBytes?: { total: number }): Promise<unknown> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, body === undefined ? 15_000 : 125_000);
  try {
    abort.signal.throwIfAborted();
    const response = await abortable(() => fetch(`${API}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      cache: "no-store", redirect: "error", signal: abort.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(response => {
        if (abort.signal.aborted) void response.body?.cancel().catch(() => undefined);
        return response;
      }), abort.signal);
    abort.signal.throwIfAborted();
    const value: unknown = directoryBytes ? await readDirectoryJson(response, abort.signal, directoryBytes)
      : await abortable(() => response.json().catch(() => null), abort.signal);
    abort.signal.throwIfAborted();
    if (!response.ok) throw new DzmmChatMediaError(response.status,
      record(value) && typeof value.error === "string" && value.error.length <= 500 ? value.error : "消息素材暂时不可用，请稍后重试。");
    return value;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); abort.abort(); }
}

export async function fetchDzmmChatMedia(accountId: string, conversationId: string, signal?: AbortSignal): Promise<DzmmChatMediaOverview> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
  // One deadline covers the whole directory, including decoding and all pages.
  const timer = setTimeout(stop, 30_000);
  const bytes = { total: 0 }, assets: DzmmChatMediaAsset[] = [], pending: DzmmChatMediaPending[] = [];
  const identities = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null, after: DirectoryPoint | null = null, upper: DirectoryPoint | null | undefined;
  let pendingKnown = true;
  try {
    while (true) {
      abort.signal.throwIfAborted();
      const params = new URLSearchParams({ conversationId, pagination: "1", limit: String(DIRECTORY_PAGE_SIZE) });
      if (cursor !== null) params.set("cursor", cursor);
      const value = await request(`?${params}`, abort.signal, undefined, bytes);
      abort.signal.throwIfAborted();
      const page = parseDzmmChatMediaOverview(value, accountId, conversationId);
      if (!record(value) || !record(value.directory)) throw invalid();
      const directory = value.directory;
      if (directory.version !== 1 || directory.limit !== DIRECTORY_PAGE_SIZE || !count(directory.scannedRows)
        || directory.scannedRows > DIRECTORY_PAGE_SIZE || page.assets.length + (page.pending?.length ?? 0) > directory.scannedRows) throw invalid();
      const pageUpper = directory.upper === null ? null : parsePoint(directory.upper);
      const pageAfter = directory.after === null ? null : parsePoint(directory.after);
      if (!samePoint(pageAfter, after) || (upper !== undefined && !samePoint(upper, pageUpper))) throw invalid();
      upper = pageUpper;
      if (upper === null && (after !== null || directory.scannedRows !== 0 || directory.nextCursor !== null)) throw invalid();
      if (after !== null && (upper === null || comparePoints(after, upper) > 0)) throw invalid();
      let next: DirectoryPoint | null = null;
      if (directory.nextCursor !== null) {
        if (upper === null || directory.scannedRows !== DIRECTORY_PAGE_SIZE) throw invalid();
        next = parseDirectoryCursor(directory.nextCursor, accountId, conversationId, upper);
        if ((after !== null && comparePoints(next, after) <= 0) || cursors.has(directory.nextCursor as string)) throw invalid();
        cursors.add(directory.nextCursor as string);
      }
      let previous = after;
      for (const item of page.assets) {
        const point = { createdAt: item.createdAt, id: item.id };
        if (upper === null || (previous !== null && comparePoints(point, previous) <= 0) || comparePoints(point, next ?? upper) > 0) throw invalid();
        previous = point;
      }
      for (const item of [...page.assets, ...(page.pending ?? [])]) {
        if (identities.has(item.id)) throw invalid();
        identities.add(item.id);
      }
      assets.push(...page.assets);
      if (page.pending === undefined) pendingKnown = false; else pending.push(...page.pending);
      if (directory.nextCursor === null) {
        abort.signal.throwIfAborted();
        // Only a complete traversal becomes visible. Quotas are global counters, not page totals.
        const { pending: _pagePending, ...metadata } = page;
        return { ...metadata, assets, ...(pendingKnown ? { pending } : {}) };
      }
      cursor = directory.nextCursor as string;
      after = next;
    }
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
}

export async function generateDzmmChatMedia(accountId: string, conversationId: string, messageId: string,
  kind: DzmmChatMediaKind, signal?: AbortSignal): Promise<DzmmChatMediaAsset> {
  const value = await request("/generate", signal, { accountId, conversationId, messageId, kind });
  if (!record(value) || value.accountId !== accountId) throw invalid();
  const asset = parseDzmmChatMediaAsset(value.asset, conversationId);
  if (asset.messageId !== messageId || asset.kind !== kind) throw invalid();
  return asset;
}

export async function fingerprintDzmmMediaText(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
