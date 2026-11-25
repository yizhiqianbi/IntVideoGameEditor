/**
 * Local crash-recovery draft storage for CharacterStudio.
 * Mirrors novel/scenario/game recovery semantics: scoped per account + characterId,
 * size-bounded to protect browser localStorage quota, and cleared on cloud save/discard.
 */

const PREFIX = "xumeng-character-recovery:v1:";
const MAX_ENTRY_CHARS = 240_000;
const MAX_ENTRIES_PER_ACCOUNT = 8;

export type XumengCharacterRecoveryEntry<T = unknown> = {
  storageKey: string;
  accountId: string;
  characterId: string;
  name: string;
  updatedAt: number;
  draft: T;
};

function keyFor(accountId: string, characterId: string): string {
  return `${PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(characterId)}`;
}

function accountPrefix(accountId: string): string {
  return `${PREFIX}${encodeURIComponent(accountId)}:`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readXumengCharacterRecovery<T = unknown>(
  accountId: string,
  characterId: string,
): XumengCharacterRecoveryEntry<T> | null {
  const storage = safeStorage();
  if (!storage || !accountId || !characterId) return null;
  const storageKey = keyFor(accountId, characterId);
  try {
    const raw = storage.getItem(storageKey);
    if (!raw || raw.length > MAX_ENTRY_CHARS) return null;
    const parsed = JSON.parse(raw) as Partial<XumengCharacterRecoveryEntry<T>> | null;
    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.accountId !== accountId
      || parsed.characterId !== characterId
      || typeof parsed.updatedAt !== "number"
      || !Number.isFinite(parsed.updatedAt)
      || !parsed.draft
      || typeof parsed.draft !== "object"
    ) {
      return null;
    }
    return {
      storageKey,
      accountId,
      characterId,
      name: typeof parsed.name === "string" ? parsed.name : "",
      updatedAt: parsed.updatedAt,
      draft: parsed.draft as T,
    };
  } catch {
    return null;
  }
}

export function writeXumengCharacterRecovery<T extends { name?: string }>(
  accountId: string,
  characterId: string,
  draft: T,
  now = Date.now(),
): boolean {
  const storage = safeStorage();
  if (!storage || !accountId || !characterId) return false;
  const storageKey = keyFor(accountId, characterId);
  const payload = JSON.stringify({
    accountId,
    characterId,
    name: typeof draft.name === "string" ? draft.name.slice(0, 120) : "",
    updatedAt: now,
    draft,
  });
  if (payload.length > MAX_ENTRY_CHARS) return false;
  try {
    // Prune oldest entries for this account if over cap before writing.
    const prefix = accountPrefix(accountId);
    const existing: Array<{ key: string; updatedAt: number }> = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith(prefix) || k === storageKey) continue;
      try {
        const parsed = JSON.parse(storage.getItem(k) ?? "null") as { updatedAt?: number } | null;
        existing.push({ key: k, updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : 0 });
      } catch {
        existing.push({ key: k, updatedAt: 0 });
      }
    }
    if (existing.length >= MAX_ENTRIES_PER_ACCOUNT) {
      existing.sort((a, b) => a.updatedAt - b.updatedAt);
      for (const stale of existing.slice(0, existing.length - MAX_ENTRIES_PER_ACCOUNT + 1)) {
        storage.removeItem(stale.key);
      }
    }
    storage.setItem(storageKey, payload);
    return true;
  } catch {
    return false;
  }
}

export function clearXumengCharacterRecovery(accountId: string, characterId: string): void {
  const storage = safeStorage();
  if (!storage || !accountId || !characterId) return;
  try {
    storage.removeItem(keyFor(accountId, characterId));
  } catch {
    /* Ignore storage access failures. */
  }
}
