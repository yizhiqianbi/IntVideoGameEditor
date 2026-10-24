"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { DZMM_LISTED_CHARACTERS, type Character } from "./dzmm-characters";
import { mergeDzmmSharedCatalog } from "./dzmm-catalog";
import { DZMM_INITIAL_STATE, hydrateDzmmState, type DzmmSavedState } from "./dzmm-storage";
import { fetchDzmmPublicCharacters } from "./dzmm-publishing";
import { xumengShelfStat } from "./xumeng-homepage-stats";
import { xumengImageUrl } from "./xumeng-routes";
import { DzmmEmailAuthError, resetDzmmPassword, verifyDzmmEmailCode, type DzmmEmailCodeValues, type DzmmPasswordResetValues } from "./dzmm-email-auth";
import { clearOwnDzmmCloudRecovery, discardDzmmCloudRecovery, dzmmCloudBackupChoice, dzmmCloudBackupKey, dzmmCloudTabBackupKey,
  parseDzmmCloudBackup, readDzmmCloudRecoveries, shouldRecoverDzmmCloudBackup, writeDzmmCloudRecovery,
  type DzmmCloudBackup, type DzmmCloudBackupChoice, type DzmmCloudRecovery } from "./dzmm-cloud-backups";
import { dzmmExplicitSaveStopMessage, planDzmmExplicitSave } from "./dzmm-explicit-save";

export type DzmmCloudUser = { id: string; email: string | null; nickname: string; isGuest: boolean; role: "user" | "super"; passwordSetupRequired?: boolean };
export type DzmmCloudSession = { user: DzmmCloudUser; authenticated: boolean };
export type DzmmCloudSnapshot = { state: DzmmSavedState; version: number; initialized: boolean; user: DzmmCloudUser };
export type DzmmSyncStatus = "loading" | "synced" | "pending" | "saving" | "offline" | "conflict" | "error";
export type DzmmAccountValues = { email: string; password: string; nickname?: string; referralCode?: string };

const API_BASE = "/api/backend/v1";
const LEGACY_KEY = "qingyu-full-v2";
const OWNER_KEY = "qingyu-cloud-local-owner";
const MIGRATION_KEY = "qingyu-cloud-migration-completed";
const initialState = (): DzmmSavedState => ({ ...DZMM_INITIAL_STATE, favorites: [], custom: [], conversations: [], preferences: { ...DZMM_INITIAL_STATE.preferences } });
const serialize = (state: DzmmSavedState) => JSON.stringify(state);

export class DzmmCloudError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); this.name = "DzmmCloudError"; }
}

export async function dzmmCloudRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new DzmmCloudError(503, "数据库连接失败，当前内容已保存在本地备份中。");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 409 ? "其他设备已修改数据，请加载云端版本后再同步。" : response.status === 401 ? "账号会话已失效，请重新登录。" : response.status === 503 ? "数据库暂时无法连接，当前使用本地离线记录。" : "请求失败，请稍后重试。";
    throw new DzmmCloudError(response.status, typeof data?.error === "string" ? data.error : fallback, data);
  }
  return data as T;
}

export async function uploadDzmmCover(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("封面仅支持 PNG、JPEG 或 WebP 图片。");
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("封面图片不能超过 5 MB。");
  let response: Response;
  try { response = await fetch(`${API_BASE}/media`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file }); }
  catch { throw new Error("封面上传无法连接，请稍后重试。"); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : response.status === 503 ? "图片存储尚未连接，暂时无法上传封面。" : "封面上传失败，请重试。");
  if (typeof data?.url !== "string" || !xumengImageUrl(data.url).startsWith(`${API_BASE}/media/`)) throw new Error("图片存储返回的地址无效。");
  return data.url;
}

function validateSession(value: DzmmCloudSession): DzmmCloudSession {
  // The Worker represents an absent cookie as a successful, anonymous session
  // response. Only the initial bootstrap may turn this into a new guest.
  if (value?.user === null && value.authenticated === false) throw new DzmmCloudError(401, "当前没有有效账号会话，请重新登录。");
  if (!value?.user || typeof value.user.id !== "string" || typeof value.user.nickname !== "string" || typeof value.user.isGuest !== "boolean" || typeof value.authenticated !== "boolean" || (value.user.role !== "user" && value.user.role !== "super")
    || (value.user.passwordSetupRequired !== undefined && typeof value.user.passwordSetupRequired !== "boolean")
    || (value.user.passwordSetupRequired === true && (value.user.isGuest || !value.authenticated))) {
    throw new DzmmCloudError(502, "账号服务返回的数据无效。");
  }
  return value;
}

function validateSnapshot(value: DzmmCloudSnapshot, accountId?: string): DzmmCloudSnapshot {
  if (!value || !Number.isInteger(value.version) || value.version < 0 || typeof value.initialized !== "boolean") throw new DzmmCloudError(502, "数据库返回的版本信息无效。");
  if (!value.user || value.user.id !== accountId) throw new DzmmCloudError(401, "账号已在其他窗口改变，请重新加载当前账号的记录。");
  const result = hydrateDzmmState(JSON.stringify(value.state));
  if (result.warnings.length) throw new DzmmCloudError(502, "云端记录的格式无效，已保留本地备份。请导出备份后重试。");
  return { ...value, state: result.state };
}

function readBackup(id: string): DzmmCloudBackup | null {
  // sessionStorage is tab-local and survives reload. A duplicated tab receives
  // an independent copy, while its new document owns a fresh recovery writer.
  try { const own = parseDzmmCloudBackup(sessionStorage.getItem(dzmmCloudTabBackupKey(id)), id); if (own) return own; }
  catch { /* The persistent account cache can still be read. */ }
  try { return parseDzmmCloudBackup(localStorage.getItem(dzmmCloudBackupKey(id)), id); }
  catch { return null; }
}

export function useDzmmCloud({ busy, onNotice }: { busy: boolean; onNotice: (message: string) => void }) {
  const [state, rawSetState] = useState<DzmmSavedState>(initialState);
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState<DzmmCloudUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [catalog, setCatalog] = useState<Character[]>(DZMM_LISTED_CHARACTERS);
  const [suppressedPrivateIds, setSuppressedPrivateIds] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<DzmmSyncStatus>("loading");
  const [syncMessage, setSyncMessage] = useState("正在连接数据库…");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const authenticating = useRef(false);
  const [backupChoices, setBackupChoices] = useState<DzmmCloudBackupChoice[]>([]);
  const recoveryEntries = useRef<DzmmCloudRecovery[]>([]);
  const writerId = useRef<string | null>(null);
  if (writerId.current === null) writerId.current = crypto.randomUUID();
  const ownJournal = useRef<DzmmCloudRecovery | null>(null);
  const stateRef = useRef(state);
  const busyRef = useRef(busy);
  const userRef = useRef<DzmmCloudUser | null>(null);
  const versionRef = useRef(0);
  const savedRef = useRef(serialize(state));
  const ready = useRef(false);
  const paused = useRef(false);
  const conflicted = useRef(false);
  const epoch = useRef(0);
  const desired = useRef<{ state: DzmmSavedState; serialized: string } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const bootstrapPromise = useRef<Promise<void> | null>(null);
  const guestCreationUsed = useRef(false);
  const legacyCandidate = useRef<DzmmSavedState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageWarning = useRef(false);
  const lastSyncError = useRef<unknown>(null);
  const catalogGeneration = useRef(0);
  const loadingAccount = useRef(false);
  const backupOwner = useRef("offline");
  const onNoticeRef = useRef(onNotice);
  useEffect(() => { onNoticeRef.current = onNotice; busyRef.current = busy; }, [onNotice, busy]);

  const setState: Dispatch<SetStateAction<DzmmSavedState>> = useCallback((update) => {
    // Update the queue's snapshot synchronously, including batched React updates.
    const next = typeof update === "function" ? update(stateRef.current) : update;
    stateRef.current = next;
    rawSetState(next);
  }, []);

  const status = useCallback((next: DzmmSyncStatus, message: string) => { setSyncStatus(next); setSyncMessage(message); }, []);

  const assertAccount = useCallback((accountId: string) => {
    if (userRef.current?.id !== accountId || authenticating.current || loadingAccount.current) {
      throw new DzmmCloudError(401, "账号已改变或正在切换，当前草稿仍保留。请先导出草稿再重新登录。");
    }
  }, []);

  const refreshBackups = useCallback((id = userRef.current?.id ?? backupOwner.current) => {
    try {
      recoveryEntries.current = readDzmmCloudRecoveries(id, localStorage);
      setBackupChoices(recoveryEntries.current.map(dzmmCloudBackupChoice));
    } catch { recoveryEntries.current = []; setBackupChoices([]); }
  }, []);

  const persist = useCallback((snapshot: DzmmSavedState, id = userRef.current?.id ?? backupOwner.current,
    recovery = false, acknowledged?: DzmmSavedState) => {
    const dirty = serialize(snapshot) !== savedRef.current;
    const backup: DzmmCloudBackup = { accountId: id, state: snapshot, version: versionRef.current, updatedAt: Date.now(), dirty };
    let preserved = true;
    let failure: unknown;
    try {
      if (dirty || recovery) ownJournal.current = writeDzmmCloudRecovery(backup, writerId.current!, localStorage, ownJournal.current);
      else if (ownJournal.current?.accountId === id) {
        clearOwnDzmmCloudRecovery(ownJournal.current, writerId.current!, localStorage);
        ownJournal.current = null;
      }
    } catch (error) { preserved = false; failure = error; }
    // Even if persistent storage is full, keep this tab reloadable where the
    // independent session store remains available. Destructive operations abort.
    try { sessionStorage.setItem(dzmmCloudTabBackupKey(id), JSON.stringify(backup)); }
    catch (error) { preserved = false; failure ??= error; }
    try {
      if (acknowledged) localStorage.setItem(dzmmCloudBackupKey(id), JSON.stringify({ ...backup, state: acknowledged, dirty: false }));
      localStorage.setItem(OWNER_KEY, id);
    } catch (error) { if (acknowledged) { preserved = false; failure ??= error; } }
    if (!preserved) {
      if (!storageWarning.current) onNoticeRef.current(failure instanceof Error && failure.message.includes("容量已满")
        ? failure.message : "浏览器备份无法完整保存，请先导出记录；加载云端或恢复操作已暂停。");
      storageWarning.current = true;
    } else storageWarning.current = false;
    refreshBackups(id);
    return preserved;
  }, [refreshBackups]);

  const archiveCurrent = useCallback(() => {
    if (serialize(stateRef.current) !== savedRef.current && !persist(stateRef.current, undefined, true)) return false;
    // The displaced branch keeps its former writer key. The next state can
    // never overwrite that archive, including after another storage event.
    writerId.current = crypto.randomUUID();
    ownJournal.current = null;
    return true;
  }, [persist]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("qingyu-cloud-recovery:")) refreshBackups();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refreshBackups]);

  const handleError = useCallback((error: unknown) => {
    lastSyncError.current = error;
    paused.current = true;
    // A local edit during the read is not another device's version. Keep that
    // retryable. A real version conflict must be loaded before any push.
    if (error instanceof DzmmCloudError && error.status === 409 && !error.message.includes("发生了变化")) conflicted.current = true;
    const message = error instanceof Error ? error.message : "同步失败，已保留本地备份。";
    status(conflicted.current ? "conflict" : error instanceof DzmmCloudError && error.status === 503 ? "offline" : "error", message);
    persist(stateRef.current, userRef.current?.id ?? backupOwner.current, true);
  }, [persist, status]);

  const drain = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const operationEpoch = epoch.current;
    const operation = (async () => {
      while (desired.current && ready.current && !paused.current && !busyRef.current) {
        const next = desired.current;
        desired.current = null;
        status("saving", "正在保存到数据库…");
        try {
          const accountId = userRef.current?.id;
          if (!accountId) throw new DzmmCloudError(401, "当前账号会话无效，请重新登录。");
          const result = validateSnapshot(await dzmmCloudRequest<DzmmCloudSnapshot>("/state", "PUT", { state: next.state, version: versionRef.current, accountId }), accountId);
          if (operationEpoch !== epoch.current) return;
          versionRef.current = result.version;
          // Never replace newer UI edits with the response to an older snapshot.
          savedRef.current = next.serialized;
          persist(stateRef.current, accountId, false, next.state);
          setLastSyncedAt(Date.now());
          status(serialize(stateRef.current) === savedRef.current ? "synced" : "pending", serialize(stateRef.current) === savedRef.current ? "已同步到数据库" : busyRef.current ? "对话结束后同步" : "有更改等待同步");
        } catch (error) {
          if (operationEpoch !== epoch.current) return;
          if (!desired.current) desired.current = next;
          handleError(error);
          return;
        }
      }
    })();
    inFlight.current = operation;
    await operation;
    if (inFlight.current === operation) inFlight.current = null;
  }, [handleError, persist, status]);

  const applySnapshot = useCallback((session: DzmmCloudSession, snapshot: DzmmCloudSnapshot, force = false) => {
    const priorBackup = readBackup(session.user.id);
    userRef.current = session.user;
    backupOwner.current = session.user.id;
    setUser(session.user);
    setAuthenticated(session.authenticated);
    versionRef.current = snapshot.version;
    savedRef.current = serialize(snapshot.state);
    desired.current = null;
    paused.current = false;
    conflicted.current = false;
    refreshBackups(session.user.id);
    if (!force && priorBackup && shouldRecoverDzmmCloudBackup(priorBackup, snapshot.state)) {
      setState(priorBackup.state);
      if (priorBackup.version !== snapshot.version) {
        paused.current = true;
        conflicted.current = true;
        persist(priorBackup.state, session.user.id, true);
        status("conflict", "云端已有其他修改，本地备份已保留。请先加载云端版本。");
      } else {
        status("pending", "本地备份等待重新同步");
      }
    } else {
      setState(snapshot.state);
      status("synced", "已同步到数据库");
      setLastSyncedAt(Date.now());
      persist(snapshot.state, session.user.id, false, snapshot.state);
    }
    ready.current = true;
  }, [persist, refreshBackups, setState, status]);

  const loadCatalog = useCallback(async () => {
    const generation = ++catalogGeneration.current;
    setSuppressedPrivateIds([]);
    try {
      const response = await dzmmCloudRequest<{ characters: Character[]; suppressedPrivateIds?: unknown } | Character[]>("/characters");
      if (generation !== catalogGeneration.current) return;
      const cards = Array.isArray(response) ? response : response.characters;
      const suppressed = Array.isArray(response) || !Array.isArray(response.suppressedPrivateIds) ? []
        : response.suppressedPrivateIds.filter((id): id is string => typeof id === "string");
      setSuppressedPrivateIds(suppressed);
      // Private cards already come from the account snapshot and must never enter
      // the shared fallback catalog or survive an account switch.
      const shared = mergeDzmmSharedCatalog(DZMM_LISTED_CHARACTERS, cards);
      setCatalog(shared);
      const published: Character[] = [];
      let offset = 0;
      for (;;) {
        const page = await fetchDzmmPublicCharacters(offset);
        if (generation !== catalogGeneration.current) return;
        published.push(...page.characters.map(character => {
          const heat = xumengShelfStat(character.id, "heat", character.heat, character.heat);
          const likes = xumengShelfStat(character.id, "likes", character.likes, character.likes);
          return heat === character.heat && likes === character.likes ? character : { ...character, heat, likes };
        }));
        if (!page.hasMore) break;
        if (!page.characters.length) throw new Error("公开目录分页无效。");
        offset = page.offset + page.characters.length;
      }
      if (generation !== catalogGeneration.current) return;
      setCatalog([...shared, ...published]);
    } catch { /* The bundled public catalog remains available offline. */ }
  }, []);

  const bootstrap = useCallback(async () => {
    const migrationCandidate = legacyCandidate.current ? stateRef.current : null;
    try {
      let session: DzmmCloudSession;
      try { session = validateSession(await dzmmCloudRequest<DzmmCloudSession>("/session")); }
      catch (error) {
        if (!(error instanceof DzmmCloudError) || error.status !== 401 || guestCreationUsed.current) throw error;
        guestCreationUsed.current = true;
        try { session = validateSession(await dzmmCloudRequest<DzmmCloudSession>("/auth/guest", "POST", {})); }
        catch (guestError) {
          // A failed creation has no known account to protect. An explicit retry
          // may try once again; a successfully established guest is never swapped.
          guestCreationUsed.current = false;
          throw guestError;
        }
      }
      userRef.current = session.user;
      backupOwner.current = session.user.id;
      setUser(session.user);
      setAuthenticated(session.authenticated);
      void loadCatalog();
      const snapshot = validateSnapshot(await dzmmCloudRequest<DzmmCloudSnapshot>("/state"), session.user.id);
      let migrated = false;
      try { migrated = Boolean(localStorage.getItem(MIGRATION_KEY)); } catch { /* Migration remains guarded by guest state. */ }
      if (session.user.isGuest && !snapshot.initialized && !migrated && migrationCandidate) {
        const candidate = migrationCandidate;
        versionRef.current = snapshot.version;
        savedRef.current = serialize(snapshot.state);
        setState(candidate);
        persist(candidate, session.user.id);
        ready.current = true;
        paused.current = false;
        // Record ownership before attempting the write, so another guest cannot inherit it.
        try { localStorage.setItem(MIGRATION_KEY, session.user.id); } catch { /* Storage failure is surfaced by persist. */ }
        desired.current = { state: candidate, serialized: serialize(candidate) };
        status("pending", "正在迁移原有浏览器记录…");
        await drain();
      } else applySnapshot(session, snapshot);
    } catch (error) {
      const accountBackup = userRef.current ? readBackup(userRef.current.id) : null;
      if (accountBackup) { setState(accountBackup.state); versionRef.current = accountBackup.version; }
      else if (userRef.current) setState(initialState());
      handleError(error);
    } finally { setLoaded(true); }
  }, [applySnapshot, drain, handleError, loadCatalog, persist, setState, status]);

  useEffect(() => {
    if (!bootstrapPromise.current) {
      try {
        const owner = localStorage.getItem(OWNER_KEY);
        if (owner) backupOwner.current = owner;
        const oldRaw = localStorage.getItem(LEGACY_KEY);
        if (oldRaw && !localStorage.getItem(`${LEGACY_KEY}-migration-backup`)) localStorage.setItem(`${LEGACY_KEY}-migration-backup`, oldRaw);
        if ((!owner || owner === "offline") && !localStorage.getItem(MIGRATION_KEY) && oldRaw) {
          const offline = owner === "offline" ? readBackup("offline") : null;
          const hydrated = offline ? { state: offline.state, warnings: [] } : hydrateDzmmState(oldRaw);
          legacyCandidate.current = hydrated.state;
          setState(hydrated.state);
          if (hydrated.warnings.length) onNoticeRef.current("已修复部分浏览器记录，原始记录已保留在迁移备份中。");
        } else if (owner) {
          const local = readBackup(owner);
          if (local) { setState(local.state); versionRef.current = local.version; }
        }
      } catch { onNoticeRef.current("原始浏览器记录无法读取，请从备份恢复。当前使用默认数据。"); }
      bootstrapPromise.current = bootstrap();
    }
  }, [bootstrap, loadCatalog, setState]);

  useEffect(() => {
    if (!loaded) return;
    if (loadingAccount.current) return;
    persist(state);
    if (timer.current) clearTimeout(timer.current);
    if (!ready.current || paused.current || serialize(state) === savedRef.current) return;
    status("pending", busy ? "对话结束后同步" : "有更改等待同步");
    if (!busy) timer.current = setTimeout(() => {
      desired.current = { state: stateRef.current, serialized: serialize(stateRef.current) };
      void drain();
    }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [state, busy, loaded, persist, drain, status]);

  const reloadCloud = useCallback(async () => {
    if (busyRef.current) { onNoticeRef.current("请先停止当前回复，再加载云端记录。"); return false; }
    const operationEpoch = epoch.current;
    const originalState = serialize(stateRef.current);
    ready.current = false;
    if (timer.current) clearTimeout(timer.current);
    await inFlight.current;
    if (operationEpoch !== epoch.current) return false;
    if (!archiveCurrent()) { ready.current = !paused.current; return false; }
    try {
      const session = validateSession(await dzmmCloudRequest<DzmmCloudSession>("/session"));
      const snapshot = validateSnapshot(await dzmmCloudRequest<DzmmCloudSnapshot>("/state"), session.user.id);
      if (operationEpoch !== epoch.current) return false;
      if (busyRef.current || serialize(stateRef.current) !== originalState) {
        throw new DzmmCloudError(409, "读取云端期间本地记录发生了变化，已保留当前内容。请停止回复后重新加载云端版本。");
      }
      epoch.current++;
      applySnapshot(session, snapshot, true);
      onNoticeRef.current("已加载云端版本，之前的本地内容仍保留在恢复备份中。");
      return true;
    } catch (error) {
      if (operationEpoch === epoch.current) {
        handleError(error);
        if (!authenticating.current && !loadingAccount.current && userRef.current) ready.current = true;
      }
      return false;
    }
  }, [applySnapshot, archiveCurrent, handleError]);

  const retrySync = useCallback(async (expectedAccountId?: string) => {
    if (busyRef.current) {
      if (expectedAccountId) throw new Error("请先停止当前回复，再重新同步草稿。");
      onNoticeRef.current("对话结束后才能重新同步。"); return;
    }
    const operationEpoch = epoch.current;
    // Editor recovery may only save into the account that owns its draft. The
    // normal profile retry can still discover and load a changed session.
    const checkOwner = () => {
      if (expectedAccountId) {
        assertAccount(expectedAccountId);
        if (operationEpoch !== epoch.current) throw new DzmmCloudError(401, "账号操作已改变，已停止旧草稿同步。请先导出当前草稿。");
      }
    };
    checkOwner();
    if (!userRef.current) { await bootstrap(); return; }
    const originalState = serialize(stateRef.current);
    ready.current = false;
    if (timer.current) clearTimeout(timer.current);
    await inFlight.current;
    checkOwner();
    if (operationEpoch !== epoch.current) return;
    try {
      const session = validateSession(await dzmmCloudRequest<DzmmCloudSession>("/session"));
      checkOwner();
      if (expectedAccountId && session.user.id !== expectedAccountId) {
        throw new DzmmCloudError(401, "登录会话已切换，当前草稿仍保留。请先导出草稿，再重新登录原账号。");
      }
      const snapshot = validateSnapshot(await dzmmCloudRequest<DzmmCloudSnapshot>("/state"), session.user.id);
      checkOwner();
      if (operationEpoch !== epoch.current) return;
      if (busyRef.current || serialize(stateRef.current) !== originalState) {
        throw new DzmmCloudError(409, "读取云端期间本地记录发生了变化，已保留当前内容。请停止回复后重新同步。");
      }
      if (session.user.id !== userRef.current.id) {
        if (!archiveCurrent()) return;
        epoch.current++;
        applySnapshot(session, snapshot);
        onNoticeRef.current("账号已改变，已加载该账号的记录。");
        return;
      }
      // applySnapshot adopts the cloud version before pausing, so a version
      // comparison alone cannot tell a conflict from a connection retry.
      if (conflicted.current || (snapshot.version !== versionRef.current && (expectedAccountId || serialize(stateRef.current) !== savedRef.current))) {
        throw new DzmmCloudError(409, "其他设备已修改数据，请先加载云端版本。当前本地内容已保留。");
      }
      userRef.current = session.user;
      setUser(session.user);
      setAuthenticated(session.authenticated);
      paused.current = false;
      conflicted.current = false;
      ready.current = true;
      if (serialize(stateRef.current) === savedRef.current) applySnapshot(session, snapshot, true);
      else {
        versionRef.current = snapshot.version;
        desired.current = { state: stateRef.current, serialized: serialize(stateRef.current) };
        await drain();
        checkOwner();
        if (expectedAccountId && (paused.current || savedRef.current !== serialize(stateRef.current))) {
          throw lastSyncError.current ?? new Error("草稿仍保留，云端保存未完成。请重试重新同步并保存。");
        }
      }
    } catch (error) {
      if (operationEpoch === epoch.current && (!expectedAccountId || !authenticating.current && !loadingAccount.current)
        && (!paused.current || lastSyncError.current !== error)) handleError(error);
      // A failed resume must leave explicit saves able to try again. Drain
      // failures already keep ready set; errors before that used to clear it.
      if (operationEpoch === epoch.current && !authenticating.current && !loadingAccount.current && userRef.current) ready.current = true;
      if (expectedAccountId) throw error;
    }
  }, [applySnapshot, archiveCurrent, assertAccount, bootstrap, drain, handleError]);

  const authenticateAccount = useCallback(async (loadSession: () => Promise<{ session: DzmmCloudSession; registered: boolean }>, preserveGuest: boolean) => {
    if (busyRef.current) throw new Error("请先停止当前回复，再切换账号。");
    if (authenticating.current) throw new Error("正在处理登录，请稍候。");
    authenticating.current = true;
    setAuthBusy(true);
    setAuthError(null);
    if (timer.current) clearTimeout(timer.current);
    let accountChanged = false;
    try {
      if (preserveGuest && userRef.current?.isGuest && serialize(stateRef.current) !== savedRef.current) {
        if (!ready.current || paused.current) throw new Error("请先重新同步游客记录，再注册以保留当前数据。");
        desired.current = { state: stateRef.current, serialized: serialize(stateRef.current) };
        await drain();
        if (paused.current || serialize(stateRef.current) !== savedRef.current) throw new Error("游客数据尚未同步，请重试同步后再注册。");
      }
      ready.current = false;
      loadingAccount.current = true;
      await inFlight.current;
      if (!archiveCurrent()) throw new Error("当前未同步记录尚未完整备份，请先导出后再切换账号。");
      const { session, registered } = await loadSession();
      accountChanged = true;
      epoch.current++;
      desired.current = null;
      userRef.current = session.user;
      backupOwner.current = session.user.id;
      setUser(session.user);
      setAuthenticated(session.authenticated);
      versionRef.current = 0;
      savedRef.current = serialize(initialState());
      // Clear the previous account immediately; failed account loads cannot mix records.
      setState(initialState());
      const snapshot = validateSnapshot(await dzmmCloudRequest<DzmmCloudSnapshot>("/state"), session.user.id);
      applySnapshot(session, snapshot, registered);
      void loadCatalog();
      const notice = registered ? "账号已注册，游客记录已保留。" : "已登录并加载该账号的记录。";
      onNoticeRef.current(session.user.passwordSetupRequired ? `${notice} 如需密码登录，可在设置的账号安全中设置密码。` : notice);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const message = aborted ? "登录请求已取消，请重新核对登录状态。" : error instanceof Error ? error.message : "账号操作失败，请重试。";
      setAuthError(message);
      if (accountChanged || (error instanceof DzmmCloudError || error instanceof DzmmEmailAuthError) && error.status >= 500 || aborted) {
        const ownBackup = userRef.current ? readBackup(userRef.current.id) : null;
        if (ownBackup) { setState(ownBackup.state); versionRef.current = ownBackup.version; }
        handleError(aborted ? new DzmmCloudError(503, message) : error);
      }
      else ready.current = Boolean(userRef.current) && !paused.current;
      throw error;
    } finally { authenticating.current = false; loadingAccount.current = false; setAuthBusy(false); }
  }, [applySnapshot, archiveCurrent, drain, handleError, loadCatalog, setState]);

  const authenticate = useCallback((mode: "login" | "register", values: DzmmAccountValues) => authenticateAccount(async () => ({
    session: validateSession(await dzmmCloudRequest<DzmmCloudSession>(`/auth/${mode}`, "POST", values)), registered: mode === "register",
  }), mode === "register"), [authenticateAccount]);

  const authenticateEmailCode = useCallback((values: DzmmEmailCodeValues, signal?: AbortSignal) => {
    const accountId = userRef.current?.id;
    return authenticateAccount(async () => {
      signal?.throwIfAborted();
      const result = await verifyDzmmEmailCode({ ...values, accountId }, signal);
      const session = validateSession({ user: { ...result.user, passwordSetupRequired: result.passwordSetupRequired ?? result.user.passwordSetupRequired }, authenticated: result.authenticated });
      return { session, registered: result.registered };
    }, true);
  }, [authenticateAccount]);

  const resetPassword = useCallback((values: DzmmPasswordResetValues, signal?: AbortSignal) => {
    return authenticateAccount(async () => {
      signal?.throwIfAborted();
      const result = await resetDzmmPassword(values, signal);
      const session = validateSession({ user: result.user, authenticated: result.authenticated });
      return { session, registered: false };
    }, false);
  }, [authenticateAccount]);

  const passwordConfigured = useCallback((accountId: string) => {
    if (!userRef.current || userRef.current.isGuest || userRef.current.id !== accountId) return;
    const updated = { ...userRef.current, passwordSetupRequired: false };
    userRef.current = updated; setUser(updated);
  }, []);

  const logout = useCallback(async () => {
    if (busyRef.current) { onNoticeRef.current("请先停止当前回复，再退出账号。"); return; }
    setAuthBusy(true);
    loadingAccount.current = true;
    ready.current = false;
    if (timer.current) clearTimeout(timer.current);
    try {
      await inFlight.current;
      if (!archiveCurrent()) { ready.current = !paused.current; return; }
      await dzmmCloudRequest("/auth/logout", "POST", {});
      epoch.current++;
      desired.current = null;
      userRef.current = null;
      backupOwner.current = "offline";
      setUser(null);
      setAuthenticated(false);
      setState(initialState());
      versionRef.current = 0;
      savedRef.current = serialize(initialState());
      persist(initialState(), "offline");
      legacyCandidate.current = null;
      try { localStorage.setItem(MIGRATION_KEY, "logged-out"); } catch { /* Never re-use the prior account's state. */ }
      const session = validateSession(await dzmmCloudRequest<DzmmCloudSession>("/auth/guest", "POST", {}));
      const snapshot = validateSnapshot(await dzmmCloudRequest<DzmmCloudSnapshot>("/state"), session.user.id);
      applySnapshot(session, snapshot, true);
      onNoticeRef.current("已退出账号，当前是新的游客会话。");
    } catch (error) { handleError(error); }
    finally { loadingAccount.current = false; setAuthBusy(false); }
  }, [applySnapshot, archiveCurrent, handleError, persist, setState]);

  const selectedBackup = useCallback((key?: string) => {
    const id = userRef.current?.id ?? backupOwner.current;
    const entry = key ? recoveryEntries.current.find(candidate => candidate.key === key) : recoveryEntries.current[0];
    if (!entry || entry.accountId !== id) { onNoticeRef.current("当前账号没有所选恢复备份，请刷新列表。"); return null; }
    try {
      if (localStorage.getItem(entry.key) !== entry.raw || !parseDzmmCloudBackup(entry.raw, id)) {
        refreshBackups(id); onNoticeRef.current("所选备份已改变，请重新选择当前恢复版本。"); return null;
      }
      return entry;
    } catch { onNoticeRef.current("浏览器备份无法读取，请先导出当前记录。"); return null; }
  }, [refreshBackups]);

  const restoreBackup = useCallback((key?: string) => {
    if (busyRef.current) { onNoticeRef.current("请先停止当前回复，再恢复备份。"); return; }
    const backup = selectedBackup(key);
    if (!backup || !archiveCurrent()) return;
    setState(structuredClone(backup.state));
    onNoticeRef.current(paused.current ? "已恢复本地备份；请先解决云端版本冲突再同步。" : "已恢复本地备份，将按当前云端版本重新同步。");
  }, [archiveCurrent, selectedBackup, setState]);

  const readBackupForExport = useCallback((key?: string) => selectedBackup(key)?.state ?? null, [selectedBackup]);
  const discardBackup = useCallback((key?: string) => {
    const backup = selectedBackup(key);
    if (!backup) return false;
    if (backup.key === ownJournal.current?.key && serialize(stateRef.current) !== savedRef.current) {
      onNoticeRef.current("这是当前页面的未同步记录，请先同步或导出，不能删除正在使用的备份。"); return false;
    }
    try {
      if (!discardDzmmCloudRecovery(backup, localStorage)) { refreshBackups(); onNoticeRef.current("所选备份已改变，请重新选择。"); return false; }
      refreshBackups(); onNoticeRef.current("已删除所选恢复副本，当前页面记录保持不变。"); return true;
    } catch { onNoticeRef.current("恢复副本删除失败，记录仍保留。"); return false; }
  }, [refreshBackups, selectedBackup]);

  const clearAuthError = useCallback(() => setAuthError(null), []);
  const saveNow = useCallback(async (expectedAccountId?: string) => {
    if (busyRef.current) throw new Error("请先停止当前回复，再保存角色。");
    if (expectedAccountId) assertAccount(expectedAccountId);
    if (timer.current) clearTimeout(timer.current);
    const accountId = userRef.current?.id;
    const persisted = persist(stateRef.current);
    const gate = () => ({
      accountId: accountId ?? null, ready: ready.current, paused: paused.current, conflicted: conflicted.current,
      persisted, storageWarning: storageWarning.current, switchingAccount: authenticating.current || loadingAccount.current,
    });
    let action = planDzmmExplicitSave(gate());
    if (action === "resume") {
      await retrySync(expectedAccountId ?? accountId);
      if (expectedAccountId) assertAccount(expectedAccountId);
      if (accountId !== userRef.current?.id) throw new Error("账号已切换，请在当前账号中重新保存。");
      if (!paused.current && !conflicted.current && ready.current && savedRef.current === serialize(stateRef.current)) return;
      action = planDzmmExplicitSave(gate());
    }
    if (action !== "write") throw new Error(dzmmExplicitSaveStopMessage(action === "resume" ? "unsynced" : action));
    desired.current = { state: stateRef.current, serialized: serialize(stateRef.current) };
    await drain();
    if (expectedAccountId) assertAccount(expectedAccountId);
    if (accountId !== userRef.current?.id) throw new Error("账号已切换，请在当前账号中重新保存。");
    if (paused.current || conflicted.current || savedRef.current !== serialize(stateRef.current)) {
      const after = planDzmmExplicitSave(gate());
      throw new Error(dzmmExplicitSaveStopMessage(after === "write" || after === "resume" ? "unsynced" : after));
    }
  }, [assertAccount, drain, persist, retrySync]);
  return { state, setState, loaded, user, authenticated, catalog, suppressedPrivateIds, syncStatus, syncMessage, lastSyncedAt, authBusy, authError, clearAuthError,
    backupAvailable: backupChoices.length > 0, backupChoices, readBackupForExport, discardBackup,
    assertAccount, authenticate, authenticateEmailCode, resetPassword, passwordConfigured, logout, retrySync, reloadCloud, restoreBackup, saveNow, refreshCatalog: loadCatalog };
}
