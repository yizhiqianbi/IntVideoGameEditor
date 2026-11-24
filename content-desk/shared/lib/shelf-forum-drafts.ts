import { SHELF_FORUM_CATEGORIES, type ShelfForumCategory } from "./shelf-forum-types";

export type ShelfForumEditorInput = { title: string; body: string; category: ShelfForumCategory; tagsText: string; revision: string };
export type ShelfForumCreateIntent = { requestId: string; snapshot: ShelfForumEditorInput };
export type ShelfForumEditorDraft = ShelfForumEditorInput & { baseUpdatedAt?: number; createIntent?: ShelfForumCreateIntent };
export type ShelfForumReplyDraft = { text: string; revision: string };
export type ShelfForumDrafts = { editors: Record<string, ShelfForumEditorDraft>; replies: Record<string, ShelfForumReplyDraft> };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const MAX_BYTES = 2_000_000;
const MAX_DRAFTS = 200;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const fields = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const inputFields = ["title", "body", "category", "tagsText", "revision"];
const validInput = (value: Record<string, unknown>) => text(value.title, 120) && text(value.body, 12_000) && text(value.tagsText, 409)
  && SHELF_FORUM_CATEGORIES.some(item => item.id === value.category) && uuid(value.revision);
function validCreateIntent(value: unknown): value is ShelfForumCreateIntent {
  return record(value) && fields(value, ["requestId", "snapshot"]) && uuid(value.requestId) && record(value.snapshot)
    && fields(value.snapshot, inputFields) && validInput(value.snapshot)
    && Boolean((value.snapshot.title as string).trim() && (value.snapshot.body as string).trim());
}
const editVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export const shelfForumDraftStorageKey = (accountId: string) => `folio-forum-drafts-v1:${accountId}`;
export const shelfForumEditorDraftKey = (postId?: string) => postId ? `edit:${postId}` : "new";
export const emptyShelfForumDrafts = (): ShelfForumDrafts => ({ editors: {}, replies: {} });

/** Exact tab-local input, independent of public posts, votes and cloud state. */
export function parseShelfForumDrafts(raw: string | null, accountId: string): ShelfForumDrafts {
  if (raw === null) return emptyShelfForumDrafts();
  if (!text(accountId, 120) || !accountId.trim() || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("论坛草稿缓存过大或账号无效。");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !fields(value, ["version", "accountId", "editors", "replies"]) || value.version !== 1 || value.accountId !== accountId
    || !record(value.editors) || !record(value.replies) || Object.keys(value.editors).length + Object.keys(value.replies).length > MAX_DRAFTS) throw new Error("论坛草稿缓存格式无效。");
  const editors = Object.entries(value.editors).map(([key, draft]) => {
    if ((key !== "new" && (!key.startsWith("edit:") || !uuid(key.slice(5)))) || !record(draft)
      || !fields(draft, [...inputFields, ...(Object.hasOwn(draft, "baseUpdatedAt") ? ["baseUpdatedAt"] : []), ...(Object.hasOwn(draft, "createIntent") ? ["createIntent"] : [])])
      || (Object.hasOwn(draft, "baseUpdatedAt") && (key === "new" || !editVersion(draft.baseUpdatedAt))) || !validInput(draft) || (Object.hasOwn(draft, "createIntent") && (key !== "new" || !validCreateIntent(draft.createIntent)))) throw new Error("主题草稿缓存内容无效。");
    return [key, { title: draft.title as string, body: draft.body as string, category: draft.category as ShelfForumCategory, tagsText: draft.tagsText as string, revision: draft.revision as string,
      ...(Object.hasOwn(draft, "baseUpdatedAt") ? { baseUpdatedAt: draft.baseUpdatedAt as number } : {}),
      ...(Object.hasOwn(draft, "createIntent") ? { createIntent: structuredClone(draft.createIntent as ShelfForumCreateIntent) } : {}) }] as [string, ShelfForumEditorDraft];
  });
  const replies = Object.entries(value.replies).map(([id, draft]) => {
    if (!uuid(id) || !record(draft) || !fields(draft, ["text", "revision"]) || !text(draft.text, 4_000) || !uuid(draft.revision)) throw new Error("回复草稿缓存内容无效。");
    return [id, { text: draft.text, revision: draft.revision }] as [string, ShelfForumReplyDraft];
  });
  return { editors: Object.fromEntries(editors), replies: Object.fromEntries(replies) };
}

export function hasShelfForumDrafts(drafts: ShelfForumDrafts): boolean {
  return Object.values(drafts.editors).some(draft => Boolean(draft.title.length || draft.body.length || draft.tagsText.length))
    || Object.values(drafts.replies).some(draft => Boolean(draft.text.length));
}

export function writeShelfForumDrafts(storage: DraftStorage, accountId: string, drafts: ShelfForumDrafts): void {
  const raw = JSON.stringify({ version: 1, accountId, ...drafts });
  // Whole-record validation happens before any mutation. Never truncate input or
  // evict another draft to fit a full/failed browser store.
  parseShelfForumDrafts(raw, accountId);
  if (Object.keys(drafts.editors).length || Object.keys(drafts.replies).length) storage.setItem(shelfForumDraftStorageKey(accountId), raw);
  else storage.removeItem(shelfForumDraftStorageKey(accountId));
}

export function acknowledgeShelfForumEditor(drafts: ShelfForumDrafts, key: string, submitted: ShelfForumEditorDraft): { drafts: ShelfForumDrafts; cleared: boolean } {
  const current = drafts.editors[key];
  if (current && (current.revision !== submitted.revision || current.title !== submitted.title || current.body !== submitted.body
    || current.category !== submitted.category || current.tagsText !== submitted.tagsText || current.baseUpdatedAt !== submitted.baseUpdatedAt
    || current.createIntent?.requestId !== submitted.createIntent?.requestId)) return { drafts, cleared: false };
  const editors = { ...drafts.editors }; delete editors[key];
  return { drafts: { ...drafts, editors }, cleared: true };
}

/** Rebinding is explicit: preserve all current input, including edits made while comparing. */
export function rebaseShelfForumEditor(drafts: ShelfForumDrafts, key: string, baseUpdatedAt: number): ShelfForumDrafts {
  const current = drafts.editors[key];
  if (!key.startsWith("edit:") || !current || !editVersion(baseUpdatedAt)) return drafts;
  return { ...drafts, editors: { ...drafts.editors, [key]: { ...current, baseUpdatedAt, revision: crypto.randomUUID() } } };
}

export function acknowledgeShelfForumReply(drafts: ShelfForumDrafts, id: string, submitted: ShelfForumReplyDraft): ShelfForumDrafts {
  const current = drafts.replies[id];
  if (!current || current.revision !== submitted.revision || current.text !== submitted.text) return drafts;
  const replies = { ...drafts.replies }; delete replies[id];
  return { ...drafts, replies };
}

/** Also exports unreadable original bytes and quota-failed complete input. */
export function exportShelfForumDrafts(accountId: string, drafts: ShelfForumDrafts, originalCache?: string): string {
  return JSON.stringify({ version: 1, accountId, ...drafts, ...(originalCache === undefined ? {} : { originalCache }) }, null, 2);
}

/** One durable intent survives both edits and reloads until its original result is resolved. */
export function prepareShelfForumCreate(draft: ShelfForumEditorDraft): ShelfForumEditorDraft {
  if (draft.createIntent) return draft;
  const { title, body, category, tagsText, revision } = draft;
  return { ...draft, createIntent: { requestId: crypto.randomUUID(), snapshot: { title, body, category, tagsText, revision } } };
}
export function submittedShelfForumCreate(draft: ShelfForumEditorDraft): ShelfForumEditorDraft {
  if (!draft.createIntent) throw new Error("主题发布请求尚未保存。");
  return { ...draft.createIntent.snapshot, createIntent: draft.createIntent };
}
/** Only an explicit user action moves changed text to an acknowledged topic. Never replace an existing edit draft. */
export function adoptShelfForumCreatedPost(drafts: ShelfForumDrafts, requestId: string, postId: string, baseUpdatedAt: number): ShelfForumDrafts {
  const current = drafts.editors.new, key = shelfForumEditorDraftKey(postId);
  if (!current?.createIntent || current.createIntent.requestId !== requestId || !uuid(postId) || !editVersion(baseUpdatedAt) || drafts.editors[key]) return drafts;
  const { title, body, category, tagsText } = current;
  const editors = { ...drafts.editors, [key]: { title, body, category, tagsText, baseUpdatedAt, revision: crypto.randomUUID() } };
  delete editors.new;
  return { ...drafts, editors };
}
