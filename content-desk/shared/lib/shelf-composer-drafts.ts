export type ShelfComposerDraft = { text: string; failed: string[]; pending?: { requestId: string; text: string } };
export type ShelfComposerDrafts = Record<string, ShelfComposerDraft>;
export const shelfComposerStorageKey = (accountId: string) => `folio-composer-drafts-v1:${accountId}`;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const MAX_BYTES = 2_000_000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 12_000 && !value.includes("\0");

/** Tab-local input is separate from story history and never enters the model or cloud state. */
export function parseShelfComposerDrafts(raw: string | null, accountId: string): ShelfComposerDrafts {
  if (raw === null) return {};
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("输入草稿缓存过大。");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1 || value.accountId !== accountId || !record(value.drafts)) throw new Error("输入草稿缓存格式无效。");
  const entries = Object.entries(value.drafts).map(([id, draft]) => {
    if (!id.trim() || id.length > 120 || id.includes("\0") || !record(draft) || !text(draft.text)
      || !Array.isArray(draft.failed) || !draft.failed.every(text)) throw new Error("输入草稿缓存内容无效。");
    let pending: ShelfComposerDraft["pending"];
    if (draft.pending !== undefined) {
      if (!record(draft.pending) || typeof draft.pending.requestId !== "string" || !draft.pending.requestId.trim()
        || draft.pending.requestId.length > 120 || !text(draft.pending.text)) throw new Error("未确认的输入草稿无效。");
      pending = { requestId: draft.pending.requestId, text: draft.pending.text };
    }
    return [id, { text: draft.text, failed: [...draft.failed], ...(pending ? { pending } : {}) }] as [string, ShelfComposerDraft];
  });
  return Object.fromEntries(entries);
}

export function readShelfComposerDrafts(storage: DraftStorage, accountId: string): ShelfComposerDrafts {
  return parseShelfComposerDrafts(storage.getItem(shelfComposerStorageKey(accountId)), accountId);
}

export function serializeShelfComposerDrafts(accountId: string, drafts: ShelfComposerDrafts): string {
  const raw = JSON.stringify({ version: 1, accountId, drafts });
  parseShelfComposerDrafts(raw, accountId);
  return raw;
}

export function writeShelfComposerDrafts(storage: DraftStorage, accountId: string, drafts: ShelfComposerDrafts) {
  // Validate the complete draft first: do not truncate user text or overwrite an old cache on failure.
  const raw = serializeShelfComposerDrafts(accountId, drafts);
  if (Object.values(drafts).some(draft => draft.text.length || draft.failed.length || draft.pending)) storage.setItem(shelfComposerStorageKey(accountId), raw);
  else storage.removeItem(shelfComposerStorageKey(accountId));
}
