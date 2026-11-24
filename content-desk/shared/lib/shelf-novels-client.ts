"use client";

import { SHELF_NOVEL_MAX_BACKUP_BYTES, SHELF_NOVEL_MAX_BODY_BYTES, SHELF_NOVEL_MAX_DRAFT_BYTES, shelfNovelDraftFromDetail, parseShelfNovelBackup, parseShelfNovelDetail, parseShelfNovelDraft,
  parseShelfNovelId, parseShelfNovelList, type ShelfNovelDetail, type ShelfNovelDraft, type ShelfNovelGenerationInput, type ShelfNovelList } from "./shelf-novels";

const API = "/api/backend/v1/novels";
export class ShelfNovelClientError extends Error {
  constructor(readonly status: number, message: string, readonly current?: ShelfNovelDetail) { super(message); this.name = "ShelfNovelClientError"; }
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function acknowledgementSnapshot(draft: ShelfNovelDraft): string {
  const { characters, ...manuscript } = draft;
  // Empty cast data is optional in legacy responses; nonempty profiles must
  // still match in full before a lost save acknowledgement can be adopted.
  return JSON.stringify({ ...manuscript, characters: characters ?? [] });
}

async function request(accountId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!accountId) throw new ShelfNovelClientError(401, "请先登录，再保存私人作品。");
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > SHELF_NOVEL_MAX_BODY_BYTES) throw new ShelfNovelClientError(413, "作品过大，尚未保存。请先导出备份后减少单部作品篇幅。");
  let response: Response;
  try { response = await fetch(`${API}${path}`, { method, credentials: "same-origin", cache: "no-store", signal,
    headers: serialized === undefined ? undefined : { "Content-Type": "application/json" }, body: serialized }); }
  catch (failure) {
    if (signal?.aborted) throw failure;
    throw new ShelfNovelClientError(503, "作品服务无法连接，正文已保留在编辑器中。请导出备份后重试。");
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (object(value) && value.accountId !== undefined && value.accountId !== accountId) throw new ShelfNovelClientError(401, "账号已切换，当前草稿仍保留在原账号的恢复副本中。");
    let current: ShelfNovelDetail | undefined;
    try { if (object(value) && value.current) current = parseShelfNovelDetail(value.current, accountId); } catch { /* Never expose unverified recovery data. */ }
    throw new ShelfNovelClientError(response.status, object(value) && typeof value.error === "string" ? value.error
      : response.status === 409 ? "其他设备已修改作品。当前正文已保留，请导出备份或另存为新作品。"
        : response.status === 401 ? "账号会话已失效，请重新登录。当前正文已保留。" : "保存失败，正文已保留，请稍后重试。", current);
  }
  if (!object(value) || value.accountId !== accountId) throw new ShelfNovelClientError(401, "账号已改变，请重新加载当前账号的作品。未保存的正文仍保留在恢复副本中。");
  return value;
}
export async function fetchShelfNovels(accountId: string, signal?: AbortSignal): Promise<ShelfNovelList> {
  return parseShelfNovelList(await request(accountId, "", "GET", undefined, signal), accountId);
}
export async function fetchShelfNovel(accountId: string, workId: string, signal?: AbortSignal): Promise<ShelfNovelDetail> {
  const detail = parseShelfNovelDetail(await request(accountId, `/${encodeURIComponent(workId)}`, "GET", undefined, signal), accountId);
  if (detail.work.id !== workId) throw new ShelfNovelClientError(502, "返回的作品编号无效，当前稿件已保留。");
  return detail;
}
export async function saveShelfNovel(accountId: string, draft: ShelfNovelDraft, version: number | null, signal?: AbortSignal): Promise<ShelfNovelDetail> {
  const work = parseShelfNovelDraft(draft);
  const body = { accountId, ...(version === null ? {} : { version }), work };
  let detail: ShelfNovelDetail;
  try {
    detail = parseShelfNovelDetail(await request(accountId, version === null ? "" : `/${encodeURIComponent(work.id)}`, version === null ? "POST" : "PUT", body, signal), accountId);
  } catch (failure) {
    // A committed save can lose its response. Only acknowledge the verified
    // server snapshot when every manuscript field, chapter ID and order still
    // matches the exact submitted snapshot; differing drafts stay conflicts.
    if (!(failure instanceof ShelfNovelClientError) || failure.status !== 409 || !failure.current || signal?.aborted
      || failure.current.accountId !== accountId || failure.current.work.id !== work.id
      || acknowledgementSnapshot(shelfNovelDraftFromDetail(failure.current)) !== acknowledgementSnapshot(work)) throw failure;
    detail = failure.current;
  }
  if (detail.work.id !== work.id) throw new ShelfNovelClientError(502, "保存结果对应的作品编号无效，当前稿件已保留。");
  return detail;
}
export async function deleteShelfNovel(accountId: string, workId: string, version: number, signal?: AbortSignal): Promise<void> {
  const value = await request(accountId, `/${encodeURIComponent(workId)}`, "DELETE", { accountId, version }, signal);
  if (!object(value) || value.deleted !== true) throw new ShelfNovelClientError(502, "作品删除结果无效，请重新加载列表。");
}

export type ShelfNovelRecovery = { accountId: string; draft: ShelfNovelDraft; baseVersion: number | null; selectedChapterId: string | null; updatedAt: number };
export type ShelfNovelRecoveryScope = { ownerId: string; workId: string };
export type ShelfNovelRecoveryEntry = ShelfNovelRecovery & { storageKey: string; raw: string; ownerId: string | null; revision: string | null };
type RecoveryReadStorage = Pick<Storage, "getItem" | "key" | "length">;
const recoveryKey = (accountId: string) => `folio-novel-recovery:${accountId}`;
const scopedRecoveryPrefix = (accountId: string) => `folio-novel-recovery-v2:${encodeURIComponent(accountId)}:`;
const scopedRecoveryKey = (accountId: string, scope: ShelfNovelRecoveryScope) => `${scopedRecoveryPrefix(accountId)}${encodeURIComponent(scope.ownerId)}:${encodeURIComponent(scope.workId)}`;
const scopedDismissKey = (entry: ShelfNovelRecoveryEntry) => `folio-novel-recovery-dismissed:${entry.storageKey}:${entry.revision}`;
const legacyDismissPrefix = (accountId: string) => `folio-novel-recovery-dismissed-legacy:${encodeURIComponent(accountId)}:`;
function storageKeys(storage: RecoveryReadStorage): string[] {
  const keys = new Set<string>();
  for (let index = 0, count = storage.length; index < count; index++) {
    const key = storage.key(index); if (key !== null) keys.add(key);
  }
  return [...keys];
}
export function writeShelfNovelRecovery(recovery: ShelfNovelRecovery, scope: ShelfNovelRecoveryScope, storage: Pick<Storage, "setItem"> = localStorage): ShelfNovelRecoveryEntry {
  const ownerId = parseShelfNovelId(scope.ownerId), workId = parseShelfNovelId(scope.workId);
  if (!recovery.accountId || recovery.draft.id !== workId) throw new Error("恢复副本的作品归属无效。");
  // Keep the raw editor snapshot even if it has crossed a server limit. A
  // fresh document owner writes only its own work slot, never another tab's.
  const revision = crypto.randomUUID();
  const value: ShelfNovelRecovery = { accountId: recovery.accountId, draft: recovery.draft, baseVersion: recovery.baseVersion,
    selectedChapterId: recovery.selectedChapterId, updatedAt: recovery.updatedAt };
  const raw = JSON.stringify({ ...value, recoveryVersion: 2, ownerId, workId, revision });
  const key = scopedRecoveryKey(recovery.accountId, { ownerId, workId });
  storage.setItem(key, raw);
  return { ...value, storageKey: key, raw, ownerId, revision };
}
function parseRecoveryEntry(accountId: string, key: string, raw: string): ShelfNovelRecoveryEntry | null {
  try {
    if (!raw || raw.length > SHELF_NOVEL_MAX_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > SHELF_NOVEL_MAX_BACKUP_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.accountId !== accountId || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0
      || (value.baseVersion !== null && (!Number.isSafeInteger(value.baseVersion) || (value.baseVersion as number) < 1))
      || (value.selectedChapterId !== null && typeof value.selectedChapterId !== "string")) return null;
    const draft = parseShelfNovelBackup(value.draft);
    let ownerId: string | null = null, revision: string | null = null;
    if (key !== recoveryKey(accountId)) {
      if (value.recoveryVersion !== 2 || value.workId !== draft.id) return null;
      ownerId = parseShelfNovelId(value.ownerId); revision = parseShelfNovelId(value.revision);
      if (key !== scopedRecoveryKey(accountId, { ownerId, workId: draft.id })) return null;
    }
    return { accountId, draft, baseVersion: value.baseVersion as number | null, storageKey: key, raw, ownerId, revision,
      selectedChapterId: draft.chapters.some(chapter => chapter.id === value.selectedChapterId) ? value.selectedChapterId as string : draft.chapters[0]?.id ?? null, updatedAt: value.updatedAt as number };
  } catch { return null; }
}
export function readShelfNovelRecoveries(accountId: string, storage: RecoveryReadStorage = localStorage): ShelfNovelRecoveryEntry[] {
  if (!accountId) return [];
  const keys = storageKeys(storage), legacyKey = recoveryKey(accountId), prefix = scopedRecoveryPrefix(accountId);
  const entries: ShelfNovelRecoveryEntry[] = [];
  for (const key of keys) {
    if (key !== legacyKey && !key.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    const entry = raw === null ? null : parseRecoveryEntry(accountId, key, raw);
    if (!entry) continue;
    if (entry.revision !== null) {
      if (storage.getItem(scopedDismissKey(entry)) === "1") continue;
    } else if (keys.some(candidate => candidate.startsWith(legacyDismissPrefix(accountId)) && storage.getItem(candidate) === raw)) continue;
    entries.push(entry);
  }
  return entries.sort((left, right) => right.updatedAt - left.updatedAt || left.storageKey.localeCompare(right.storageKey));
}
export function readShelfNovelRecovery(accountId: string, storage: RecoveryReadStorage = localStorage): ShelfNovelRecoveryEntry | null {
  try { return readShelfNovelRecoveries(accountId, storage)[0] ?? null; } catch { return null; }
}
export function clearShelfNovelRecovery(entry: ShelfNovelRecoveryEntry, ownerId: string, storage: Pick<Storage, "getItem" | "removeItem"> = localStorage): boolean {
  // Only the fresh document owner may physically remove its own work slot.
  // Comparing the captured raw also preserves a newer edit in this document.
  if (!entry.ownerId || entry.ownerId !== ownerId || entry.storageKey !== scopedRecoveryKey(entry.accountId, { ownerId, workId: entry.draft.id })
    || storage.getItem(entry.storageKey) !== entry.raw) return false;
  storage.removeItem(entry.storageKey);
  return true;
}
export function dismissShelfNovelRecovery(entry: ShelfNovelRecoveryEntry, storage: Pick<Storage, "setItem"> = localStorage): void {
  // Cross-document records are mutable. Hide exactly this revision instead of
  // using a non-atomic getItem/removeItem pair that could delete a newer edit.
  if (entry.revision !== null) storage.setItem(scopedDismissKey(entry), "1");
  else storage.setItem(`${legacyDismissPrefix(entry.accountId)}${crypto.randomUUID()}`, entry.raw);
}

export async function generateShelfNovel(input: ShelfNovelGenerationInput, options: {
  signal: AbortSignal; onDelta: (chunk: string) => void; requestId?: string;
}): Promise<void> {
  const response = await fetch("/api/novel-generation", { method: "POST", credentials: "same-origin", cache: "no-store", signal: options.signal,
    headers: { "Content-Type": "application/json", "X-内容台-Request-Id": options.requestId ?? crypto.randomUUID() }, body: JSON.stringify(input) });
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    throw new ShelfNovelClientError(response.status, object(value) && typeof value.error === "string" ? value.error : "创作生成失败，原稿未改变。请稍后重试。");
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/plain") || !response.body) throw new ShelfNovelClientError(502, "创作服务返回的格式无效，请稍后重试。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0;
  try {
    for (;;) {
      options.signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > SHELF_NOVEL_MAX_DRAFT_BYTES) throw new ShelfNovelClientError(413, "生成内容过长，已停止接收；已收到的内容保留在预览中。");
      const delta = decoder.decode(result.value, { stream: true });
      if (delta) options.onDelta(delta);
    }
    const tail = decoder.decode(); if (tail) options.onDelta(tail);
  } catch (failure) {
    await reader.cancel().catch(() => {});
    throw failure;
  } finally { reader.releaseLock(); }
}
