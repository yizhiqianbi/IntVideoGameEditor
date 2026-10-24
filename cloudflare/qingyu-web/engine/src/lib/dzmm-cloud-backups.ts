import { hydrateDzmmState, type DzmmSavedState } from "./dzmm-storage";

export type DzmmCloudBackup = { accountId: string; state: DzmmSavedState; version: number; updatedAt: number; dirty?: boolean };
export type DzmmCloudRecovery = DzmmCloudBackup & { key: string; raw: string; writerId: string | null; revision: string | null };
export type DzmmCloudBackupChoice = { key: string; updatedAt: number; messageCount: number; version: number };
type ReadStorage = Pick<Storage, "getItem" | "key" | "length">;
type JournalStorage = ReadStorage & Pick<Storage, "setItem" | "removeItem">;

export const DZMM_CLOUD_RECOVERY_MAX_ENTRIES = 20;
export const DZMM_CLOUD_RECOVERY_MAX_BYTES = 8_000_000;
export const DZMM_CLOUD_BACKUP_MAX_BYTES = 2_500_000;
export const dzmmCloudBackupKey = (id: string) => `qingyu-cloud-backup:${id}`;
export const dzmmCloudTabBackupKey = (id: string) => `qingyu-cloud-tab-backup:${id}`;
export const dzmmCloudRecoveryKey = (id: string) => `qingyu-cloud-recovery:${id}`;
export const dzmmCloudRecoveryPrefix = (id: string) => `${dzmmCloudRecoveryKey(id)}:`;
const journalKey = (id: string, writerId: string, revision: string) => `${dzmmCloudRecoveryPrefix(id)}${encodeURIComponent(writerId)}:${encodeURIComponent(revision)}`;
const bytes = (raw: string) => new TextEncoder().encode(raw).byteLength;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** Recovery must keep a complete snapshot, never the hydrator's partially repaired subset. */
export function parseDzmmCloudBackup(raw: string | null, accountId: string): DzmmCloudBackup | null {
  try {
    if (!raw || raw.length > DZMM_CLOUD_BACKUP_MAX_BYTES || bytes(raw) > DZMM_CLOUD_BACKUP_MAX_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.accountId !== accountId || !Number.isSafeInteger(value.version) || (value.version as number) < 0
      || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0 || (value.updatedAt as number) > 8_640_000_000_000_000
      || (value.dirty !== undefined && typeof value.dirty !== "boolean")
      || !record(value.state) || value.state.version !== 1 || !Array.isArray(value.state.favorites)
      || !Array.isArray(value.state.custom) || !Array.isArray(value.state.conversations) || !record(value.state.preferences)) return null;
    const validated = hydrateDzmmState(JSON.stringify(value.state));
    if (validated.warnings.length || JSON.stringify(canonical(value.state)) !== JSON.stringify(canonical(validated.state))) return null;
    // Hydration supplies a consistent property order for comparison with cloud
    // snapshots. Any actual repair, truncation or generated identity is rejected.
    return { accountId, state: validated.state, version: value.version as number, updatedAt: value.updatedAt as number,
      ...(value.dirty === undefined ? {} : { dirty: value.dirty as boolean }) };
  } catch { return null; }
}

export function shouldRecoverDzmmCloudBackup(backup: DzmmCloudBackup, cloudState: DzmmSavedState): boolean {
  // Only newly marked clean snapshots can yield to a newer cloud revision.
  // Unmarked legacy snapshots may contain the sole surviving unsynced branch.
  return backup.dirty !== false && JSON.stringify(canonical(backup.state)) !== JSON.stringify(canonical(cloudState));
}

export function readDzmmCloudRecoveries(accountId: string, storage: ReadStorage): DzmmCloudRecovery[] {
  const keys = new Set<string>();
  for (let index = 0, count = storage.length; index < count; index++) {
    const key = storage.key(index);
    if (key === dzmmCloudRecoveryKey(accountId) || key?.startsWith(dzmmCloudRecoveryPrefix(accountId))) keys.add(key);
  }
  const entries: DzmmCloudRecovery[] = [];
  for (const key of keys) {
    const raw = storage.getItem(key), value = parseDzmmCloudBackup(raw, accountId);
    if (!raw || !value) continue;
    let writerId: string | null = null, revision: string | null = null;
    if (key !== dzmmCloudRecoveryKey(accountId)) {
      const wrapper: unknown = JSON.parse(raw);
      if (!record(wrapper) || wrapper.recoveryVersion !== 2 || typeof wrapper.writerId !== "string"
        || !wrapper.writerId || wrapper.writerId.length > 120 || wrapper.writerId.includes("\0")
        || typeof wrapper.revision !== "string" || !wrapper.revision || wrapper.revision.length > 120 || wrapper.revision.includes("\0")
        || journalKey(accountId, wrapper.writerId, wrapper.revision) !== key) continue;
      writerId = wrapper.writerId;
      revision = wrapper.revision;
    }
    entries.push({ ...value, key, raw, writerId, revision });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

/** Independent writer keys avoid a shared read/modify/write branch-list race. */
export function writeDzmmCloudRecovery(backup: DzmmCloudBackup, writerId: string, storage: JournalStorage, previous?: DzmmCloudRecovery | null): DzmmCloudRecovery {
  if (!writerId || writerId.length > 120 || writerId.includes("\0")) throw new Error("本地备份归属无效。");
  const revision = crypto.randomUUID();
  const raw = JSON.stringify({ ...backup, recoveryVersion: 2, writerId, revision });
  if (!parseDzmmCloudBackup(raw, backup.accountId)) throw new Error("本地备份格式或大小无效，请先导出记录。");
  const key = journalKey(backup.accountId, writerId, revision);
  const replacing = previous?.accountId === backup.accountId && previous.writerId === writerId && previous.revision
    && previous.key === journalKey(backup.accountId, writerId, previous.revision)
    && storage.getItem(previous.key) === previous.raw ? previous : null;
  let count = 0, totalBytes = bytes(raw);
  for (let index = 0, length = storage.length; index < length; index++) {
    const existingKey = storage.key(index);
    if (existingKey === replacing?.key || (existingKey !== dzmmCloudRecoveryKey(backup.accountId)
      && !existingKey?.startsWith(dzmmCloudRecoveryPrefix(backup.accountId)))) continue;
    count++;
    totalBytes += bytes(storage.getItem(existingKey) ?? "");
  }
  if (count >= DZMM_CLOUD_RECOVERY_MAX_ENTRIES || totalBytes > DZMM_CLOUD_RECOVERY_MAX_BYTES) {
    throw new Error("本地恢复备份容量已满，请先导出记录；其他页面的未同步备份会保留。");
  }
  storage.setItem(key, raw);
  // Keys are immutable. A selected archived revision can be removed safely
  // without racing another document replacing that key with newer contents.
  if (replacing) clearOwnDzmmCloudRecovery(replacing, writerId, storage);
  return { ...backup, key, raw, writerId, revision };
}

export function clearOwnDzmmCloudRecovery(entry: DzmmCloudRecovery, writerId: string, storage: Pick<Storage, "getItem" | "removeItem">): boolean {
  if (!entry.revision || entry.writerId !== writerId || entry.key !== journalKey(entry.accountId, writerId, entry.revision)
    || storage.getItem(entry.key) !== entry.raw) return false;
  storage.removeItem(entry.key);
  return true;
}

/** An explicit user discard is bound to the selected exact revision. */
export function discardDzmmCloudRecovery(entry: DzmmCloudRecovery, storage: Pick<Storage, "getItem" | "removeItem">): boolean {
  if (storage.getItem(entry.key) !== entry.raw) return false;
  storage.removeItem(entry.key);
  return true;
}

export function dzmmCloudBackupChoice(entry: DzmmCloudRecovery): DzmmCloudBackupChoice {
  return { key: entry.key, updatedAt: entry.updatedAt, version: entry.version,
    messageCount: entry.state.conversations.reduce((count, conversation) => count + conversation.messages.length, 0) };
}
