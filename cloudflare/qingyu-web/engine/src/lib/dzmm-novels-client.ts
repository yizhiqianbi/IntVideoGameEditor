"use client";

import { DZMM_NOVEL_MAX_BACKUP_BYTES, DZMM_NOVEL_MAX_BODY_BYTES, DZMM_NOVEL_MAX_DRAFT_BYTES, dzmmNovelDraftFromDetail, parseDzmmNovelBackup, parseDzmmNovelDetail, parseDzmmNovelDraft,
  parseDzmmNovelId, parseDzmmNovelList, type DzmmNovelDetail, type DzmmNovelDraft, type DzmmNovelGenerationInput, type DzmmNovelList } from "./dzmm-novels";

const API = "/api/backend/v1/novels";
export class DzmmNovelClientError extends Error {
  constructor(readonly status: number, message: string, readonly current?: DzmmNovelDetail) { super(message); this.name = "DzmmNovelClientError"; }
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function acknowledgementSnapshot(draft: DzmmNovelDraft): string {
  const { characters, ...manuscript } = draft;
  // Empty cast data is optional in legacy responses; nonempty profiles must
  // still match in full before a lost save acknowledgement can be adopted.
  return JSON.stringify({ ...manuscript, characters: characters ?? [] });
}

async function request(accountId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!accountId) throw new DzmmNovelClientError(401, "请先登录，再保存私人作品。");
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > DZMM_NOVEL_MAX_BODY_BYTES) throw new DzmmNovelClientError(413, "作品过大，尚未保存。请先导出备份后减少单部作品篇幅。");
  let response: Response;
  try { response = await fetch(`${API}${path}`, { method, credentials: "same-origin", cache: "no-store", signal,
    headers: serialized === undefined ? undefined : { "Content-Type": "application/json" }, body: serialized }); }
  catch (failure) {
    if (signal?.aborted) throw failure;
    throw new DzmmNovelClientError(503, "作品服务无法连接，正文已保留在编辑器中。请导出备份后重试。");
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (object(value) && value.accountId !== undefined && value.accountId !== accountId) throw new DzmmNovelClientError(401, "账号已切换，当前草稿仍保留在原账号的恢复副本中。");
    let current: DzmmNovelDetail | undefined;
    try { if (object(value) && value.current) current = parseDzmmNovelDetail(value.current, accountId); } catch { /* Never expose unverified recovery data. */ }
    throw new DzmmNovelClientError(response.status, object(value) && typeof value.error === "string" ? value.error
      : response.status === 409 ? "其他设备已修改作品。当前正文已保留，请导出备份或另存为新作品。"
        : response.status === 401 ? "账号会话已失效，请重新登录。当前正文已保留。" : "保存失败，正文已保留，请稍后重试。", current);
  }
  if (!object(value) || value.accountId !== accountId) throw new DzmmNovelClientError(401, "账号已改变，请重新加载当前账号的作品。未保存的正文仍保留在恢复副本中。");
  return value;
}
export async function fetchDzmmNovels(accountId: string, signal?: AbortSignal): Promise<DzmmNovelList> {
  return parseDzmmNovelList(await request(accountId, "", "GET", undefined, signal), accountId);
}
export async function fetchDzmmNovel(accountId: string, workId: string, signal?: AbortSignal): Promise<DzmmNovelDetail> {
  const detail = parseDzmmNovelDetail(await request(accountId, `/${encodeURIComponent(workId)}`, "GET", undefined, signal), accountId);
  if (detail.work.id !== workId) throw new DzmmNovelClientError(502, "返回的作品编号无效，当前稿件已保留。");
  return detail;
}
export async function saveDzmmNovel(accountId: string, draft: DzmmNovelDraft, version: number | null, signal?: AbortSignal): Promise<DzmmNovelDetail> {
  const work = parseDzmmNovelDraft(draft);
  const body = { accountId, ...(version === null ? {} : { version }), work };
  let detail: DzmmNovelDetail;
  try {
    detail = parseDzmmNovelDetail(await request(accountId, version === null ? "" : `/${encodeURIComponent(work.id)}`, version === null ? "POST" : "PUT", body, signal), accountId);
  } catch (failure) {
    // A committed save can lose its response. Only acknowledge the verified
    // server snapshot when every manuscript field, chapter ID and order still
    // matches the exact submitted snapshot; differing drafts stay conflicts.
    if (!(failure instanceof DzmmNovelClientError) || failure.status !== 409 || !failure.current || signal?.aborted
      || failure.current.accountId !== accountId || failure.current.work.id !== work.id
      || acknowledgementSnapshot(dzmmNovelDraftFromDetail(failure.current)) !== acknowledgementSnapshot(work)) throw failure;
    detail = failure.current;
  }
  if (detail.work.id !== work.id) throw new DzmmNovelClientError(502, "保存结果对应的作品编号无效，当前稿件已保留。");
  return detail;
}
export async function deleteDzmmNovel(accountId: string, workId: string, version: number, signal?: AbortSignal): Promise<void> {
  const value = await request(accountId, `/${encodeURIComponent(workId)}`, "DELETE", { accountId, version }, signal);
  if (!object(value) || value.deleted !== true) throw new DzmmNovelClientError(502, "作品删除结果无效，请重新加载列表。");
}

export type DzmmNovelRecovery = { accountId: string; draft: DzmmNovelDraft; baseVersion: number | null; selectedChapterId: string | null; updatedAt: number };
export type DzmmNovelRecoveryScope = { ownerId: string; workId: string };
export type DzmmNovelRecoveryEntry = DzmmNovelRecovery & { storageKey: string; raw: string; ownerId: string | null; revision: string | null };
type RecoveryReadStorage = Pick<Storage, "getItem" | "key" | "length">;
const recoveryKey = (accountId: string) => `qingyu-novel-recovery:${accountId}`;
const scopedRecoveryPrefix = (accountId: string) => `qingyu-novel-recovery-v2:${encodeURIComponent(accountId)}:`;
const scopedRecoveryKey = (accountId: string, scope: DzmmNovelRecoveryScope) => `${scopedRecoveryPrefix(accountId)}${encodeURIComponent(scope.ownerId)}:${encodeURIComponent(scope.workId)}`;
const scopedDismissKey = (entry: DzmmNovelRecoveryEntry) => `qingyu-novel-recovery-dismissed:${entry.storageKey}:${entry.revision}`;
const legacyDismissPrefix = (accountId: string) => `qingyu-novel-recovery-dismissed-legacy:${encodeURIComponent(accountId)}:`;
function storageKeys(storage: RecoveryReadStorage): string[] {
  const keys = new Set<string>();
  for (let index = 0, count = storage.length; index < count; index++) {
    const key = storage.key(index); if (key !== null) keys.add(key);
  }
  return [...keys];
}
export function writeDzmmNovelRecovery(recovery: DzmmNovelRecovery, scope: DzmmNovelRecoveryScope, storage: Pick<Storage, "setItem"> = localStorage): DzmmNovelRecoveryEntry {
  const ownerId = parseDzmmNovelId(scope.ownerId), workId = parseDzmmNovelId(scope.workId);
  if (!recovery.accountId || recovery.draft.id !== workId) throw new Error("恢复副本的作品归属无效。");
  // Keep the raw editor snapshot even if it has crossed a server limit. A
  // fresh document owner writes only its own work slot, never another tab's.
  const revision = crypto.randomUUID();
  const value: DzmmNovelRecovery = { accountId: recovery.accountId, draft: recovery.draft, baseVersion: recovery.baseVersion,
    selectedChapterId: recovery.selectedChapterId, updatedAt: recovery.updatedAt };
  const raw = JSON.stringify({ ...value, recoveryVersion: 2, ownerId, workId, revision });
  const key = scopedRecoveryKey(recovery.accountId, { ownerId, workId });
  storage.setItem(key, raw);
  return { ...value, storageKey: key, raw, ownerId, revision };
}
function parseRecoveryEntry(accountId: string, key: string, raw: string): DzmmNovelRecoveryEntry | null {
  try {
    if (!raw || raw.length > DZMM_NOVEL_MAX_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > DZMM_NOVEL_MAX_BACKUP_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.accountId !== accountId || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0
      || (value.baseVersion !== null && (!Number.isSafeInteger(value.baseVersion) || (value.baseVersion as number) < 1))
      || (value.selectedChapterId !== null && typeof value.selectedChapterId !== "string")) return null;
    const draft = parseDzmmNovelBackup(value.draft);
    let ownerId: string | null = null, revision: string | null = null;
    if (key !== recoveryKey(accountId)) {
      if (value.recoveryVersion !== 2 || value.workId !== draft.id) return null;
      ownerId = parseDzmmNovelId(value.ownerId); revision = parseDzmmNovelId(value.revision);
      if (key !== scopedRecoveryKey(accountId, { ownerId, workId: draft.id })) return null;
    }
    return { accountId, draft, baseVersion: value.baseVersion as number | null, storageKey: key, raw, ownerId, revision,
      selectedChapterId: draft.chapters.some(chapter => chapter.id === value.selectedChapterId) ? value.selectedChapterId as string : draft.chapters[0]?.id ?? null, updatedAt: value.updatedAt as number };
  } catch { return null; }
}
export function readDzmmNovelRecoveries(accountId: string, storage: RecoveryReadStorage = localStorage): DzmmNovelRecoveryEntry[] {
  if (!accountId) return [];
  const keys = storageKeys(storage), legacyKey = recoveryKey(accountId), prefix = scopedRecoveryPrefix(accountId);
  const entries: DzmmNovelRecoveryEntry[] = [];
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
export function readDzmmNovelRecovery(accountId: string, storage: RecoveryReadStorage = localStorage): DzmmNovelRecoveryEntry | null {
  try { return readDzmmNovelRecoveries(accountId, storage)[0] ?? null; } catch { return null; }
}
export function clearDzmmNovelRecovery(entry: DzmmNovelRecoveryEntry, ownerId: string, storage: Pick<Storage, "getItem" | "removeItem"> = localStorage): boolean {
  // Only the fresh document owner may physically remove its own work slot.
  // Comparing the captured raw also preserves a newer edit in this document.
  if (!entry.ownerId || entry.ownerId !== ownerId || entry.storageKey !== scopedRecoveryKey(entry.accountId, { ownerId, workId: entry.draft.id })
    || storage.getItem(entry.storageKey) !== entry.raw) return false;
  storage.removeItem(entry.storageKey);
  return true;
}
export function dismissDzmmNovelRecovery(entry: DzmmNovelRecoveryEntry, storage: Pick<Storage, "setItem"> = localStorage): void {
  // Cross-document records are mutable. Hide exactly this revision instead of
  // using a non-atomic getItem/removeItem pair that could delete a newer edit.
  if (entry.revision !== null) storage.setItem(scopedDismissKey(entry), "1");
  else storage.setItem(`${legacyDismissPrefix(entry.accountId)}${crypto.randomUUID()}`, entry.raw);
}

export async function generateDzmmNovel(input: DzmmNovelGenerationInput, options: {
  signal: AbortSignal; onDelta: (chunk: string) => void; requestId?: string;
}): Promise<void> {
  const response = await fetch("/api/novel-generation", { method: "POST", credentials: "same-origin", cache: "no-store", signal: options.signal,
    headers: { "Content-Type": "application/json", "X-Xumeng-Request-Id": options.requestId ?? crypto.randomUUID() }, body: JSON.stringify(input) });
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    throw new DzmmNovelClientError(response.status, object(value) && typeof value.error === "string" ? value.error : "创作生成失败，原稿未改变。请稍后重试。");
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/plain") || !response.body) throw new DzmmNovelClientError(502, "创作服务返回的格式无效，请稍后重试。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0;
  try {
    for (;;) {
      options.signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > DZMM_NOVEL_MAX_DRAFT_BYTES) throw new DzmmNovelClientError(413, "生成内容过长，已停止接收；已收到的内容保留在预览中。");
      const delta = decoder.decode(result.value, { stream: true });
      if (delta) options.onDelta(delta);
    }
    const tail = decoder.decode(); if (tail) options.onDelta(tail);
  } catch (failure) {
    await reader.cancel().catch(() => {});
    throw failure;
  } finally { reader.releaseLock(); }
}
