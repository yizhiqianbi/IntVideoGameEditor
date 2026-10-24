import { parseXumengGameDraft, type XumengGameDraft } from "./xumeng-games";

// A recovery stores the draft plus a JSON snapshot of its saved baseline. A
// fully escaped 256 KiB inline source can occupy 6x here and 7x inside that
// snapshot. Larger games stay in cloud storage; this browser envelope does not
// grow with the 8 MB source cap.
export const XUMENG_GAME_MAX_RECOVERY_CHARS = 4 * 1024 * 1024;

export type XumengGameRecovery = {
  accountId: string; owner: string | null; game: XumengGameDraft; version: number | null;
  savedSnapshot: string; updatedAt: number; key: string; raw: string; legacy: boolean;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const legacyKey = (accountId: string) => `qingyu:game-draft:v1:${accountId}`;
const prefix = (accountId: string) => `qingyu:game-draft:v2:${encodeURIComponent(accountId)}:`;
const keyFor = (accountId: string, owner: string, gameId: string) => `${prefix(accountId)}${encodeURIComponent(owner)}:${encodeURIComponent(gameId)}`;

function parseRecovery(accountId: string, key: string, raw: string): XumengGameRecovery | null {
  try {
    if (raw.length > XUMENG_GAME_MAX_RECOVERY_CHARS) return null;
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.accountId !== accountId || typeof value.savedSnapshot !== "string"
      || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0
      || (value.version !== null && (!Number.isSafeInteger(value.version) || (value.version as number) < 1))) return null;
    const game = parseXumengGameDraft(value.game, false), legacy = key === legacyKey(accountId);
    const owner = legacy ? null : typeof value.owner === "string" && value.owner ? value.owner : null;
    if (!legacy && (!owner || key !== keyFor(accountId, owner, game.id))) return null;
    return { accountId, owner, game, version: value.version as number | null, savedSnapshot: value.savedSnapshot,
      updatedAt: value.updatedAt as number, key, raw, legacy };
  } catch { return null; }
}

/** Reading a clean cloud snapshot never acknowledges or deletes a local edit. */
export function readXumengGameRecoveries(accountId: string): XumengGameRecovery[] {
  const entries: XumengGameRecovery[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key || (key !== legacyKey(accountId) && !key.startsWith(prefix(accountId)))) continue;
    const raw = localStorage.getItem(key); if (!raw) continue;
    const entry = parseRecovery(accountId, key, raw); if (entry) entries.push(entry);
  }
  return entries.sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key));
}

export function writeXumengGameRecovery(accountId: string, owner: string, game: XumengGameDraft, version: number | null, savedSnapshot: string): XumengGameRecovery {
  if (!accountId || !owner || typeof savedSnapshot !== "string"
    || (version !== null && (!Number.isSafeInteger(version) || version < 1))) throw new Error("游戏恢复副本格式无效。");
  const draft = parseXumengGameDraft(game, false), key = keyFor(accountId, owner, draft.id);
  const value = { accountId, owner, game: draft, version, savedSnapshot, updatedAt: Date.now() }, raw = JSON.stringify(value);
  const entry = parseRecovery(accountId, key, raw);
  if (!entry) throw new Error("游戏恢复副本过大或格式无效，未覆盖已保留的修订。");
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error("浏览器未确认游戏恢复副本，原草稿仍保留。");
  return entry;
}

/** Clean installs are a no-op, including when a same-ID or legacy draft exists. */
export function persistXumengGameRecovery(accountId: string, owner: string, game: XumengGameDraft, version: number | null, savedSnapshot: string): XumengGameRecovery | null {
  if (version !== null && JSON.stringify(game) === savedSnapshot) return null;
  return writeXumengGameRecovery(accountId, owner, game, version, savedSnapshot);
}

function currentEntry(entry: XumengGameRecovery, accountId: string): boolean {
  return entry.accountId === accountId && parseRecovery(accountId, entry.key, entry.raw) !== null
    && localStorage.getItem(entry.key) === entry.raw;
}
/** Clone first. A failed write must leave the source revision untouched. */
export function restoreXumengGameRecovery(entry: XumengGameRecovery, accountId: string, newOwner: string): XumengGameRecovery {
  if (!newOwner || newOwner === entry.owner || !currentEntry(entry, accountId)) throw new Error("这份恢复副本已更新，请刷新后重新选择。当前源码仍保留。");
  return writeXumengGameRecovery(accountId, newOwner, entry.game, entry.version, entry.savedSnapshot);
}

/** Automatic save/delete cleanup is limited to this session's exact revision. */
export function clearXumengGameRecovery(entry: XumengGameRecovery, accountId: string, owner: string): boolean {
  if (entry.legacy || entry.owner !== owner || entry.key !== keyFor(accountId, owner, entry.game.id)) return false;
  return discardXumengGameRecovery(entry, accountId);
}
/** Only an explicit user discard may remove an older session or legacy slot. */
export function discardXumengGameRecovery(entry: XumengGameRecovery, accountId: string): boolean {
  if (!currentEntry(entry, accountId)) return false;
  localStorage.removeItem(entry.key); return true;
}
