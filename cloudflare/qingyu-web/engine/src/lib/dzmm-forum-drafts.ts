import { DZMM_FORUM_CATEGORIES, type DzmmForumCategory } from "./dzmm-forum-types";

export type DzmmForumEditorInput = { title: string; body: string; category: DzmmForumCategory; tagsText: string; revision: string };
export type DzmmForumCreateIntent = { requestId: string; snapshot: DzmmForumEditorInput };
export type DzmmForumEditorDraft = DzmmForumEditorInput & { baseUpdatedAt?: number; createIntent?: DzmmForumCreateIntent };
export type DzmmForumReplyDraft = { text: string; revision: string };
export type DzmmForumDrafts = { editors: Record<string, DzmmForumEditorDraft>; replies: Record<string, DzmmForumReplyDraft> };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const MAX_BYTES = 2_000_000;
const MAX_DRAFTS = 200;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const fields = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const inputFields = ["title", "body", "category", "tagsText", "revision"];
const validInput = (value: Record<string, unknown>) => text(value.title, 120) && text(value.body, 12_000) && text(value.tagsText, 409)
  && DZMM_FORUM_CATEGORIES.some(item => item.id === value.category) && uuid(value.revision);
function validCreateIntent(value: unknown): value is DzmmForumCreateIntent {
  return record(value) && fields(value, ["requestId", "snapshot"]) && uuid(value.requestId) && record(value.snapshot)
    && fields(value.snapshot, inputFields) && validInput(value.snapshot)
    && Boolean((value.snapshot.title as string).trim() && (value.snapshot.body as string).trim());
}
const editVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export const dzmmForumDraftStorageKey = (accountId: string) => `qingyu-forum-drafts-v1:${accountId}`;
export const dzmmForumEditorDraftKey = (postId?: string) => postId ? `edit:${postId}` : "new";
export const emptyDzmmForumDrafts = (): DzmmForumDrafts => ({ editors: {}, replies: {} });

/** Exact tab-local input, independent of public posts, votes and cloud state. */
export function parseDzmmForumDrafts(raw: string | null, accountId: string): DzmmForumDrafts {
  if (raw === null) return emptyDzmmForumDrafts();
  if (!text(accountId, 120) || !accountId.trim() || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("论坛草稿缓存过大或账号无效。");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !fields(value, ["version", "accountId", "editors", "replies"]) || value.version !== 1 || value.accountId !== accountId
    || !record(value.editors) || !record(value.replies) || Object.keys(value.editors).length + Object.keys(value.replies).length > MAX_DRAFTS) throw new Error("论坛草稿缓存格式无效。");
  const editors = Object.entries(value.editors).map(([key, draft]) => {
    if ((key !== "new" && (!key.startsWith("edit:") || !uuid(key.slice(5)))) || !record(draft)
      || !fields(draft, [...inputFields, ...(Object.hasOwn(draft, "baseUpdatedAt") ? ["baseUpdatedAt"] : []), ...(Object.hasOwn(draft, "createIntent") ? ["createIntent"] : [])])
      || (Object.hasOwn(draft, "baseUpdatedAt") && (key === "new" || !editVersion(draft.baseUpdatedAt))) || !validInput(draft) || (Object.hasOwn(draft, "createIntent") && (key !== "new" || !validCreateIntent(draft.createIntent)))) throw new Error("主题草稿缓存内容无效。");
    return [key, { title: draft.title as string, body: draft.body as string, category: draft.category as DzmmForumCategory, tagsText: draft.tagsText as string, revision: draft.revision as string,
      ...(Object.hasOwn(draft, "baseUpdatedAt") ? { baseUpdatedAt: draft.baseUpdatedAt as number } : {}),
      ...(Object.hasOwn(draft, "createIntent") ? { createIntent: structuredClone(draft.createIntent as DzmmForumCreateIntent) } : {}) }] as [string, DzmmForumEditorDraft];
  });
  const replies = Object.entries(value.replies).map(([id, draft]) => {
    if (!uuid(id) || !record(draft) || !fields(draft, ["text", "revision"]) || !text(draft.text, 4_000) || !uuid(draft.revision)) throw new Error("回复草稿缓存内容无效。");
    return [id, { text: draft.text, revision: draft.revision }] as [string, DzmmForumReplyDraft];
  });
  return { editors: Object.fromEntries(editors), replies: Object.fromEntries(replies) };
}

export function hasDzmmForumDrafts(drafts: DzmmForumDrafts): boolean {
  return Object.values(drafts.editors).some(draft => Boolean(draft.title.length || draft.body.length || draft.tagsText.length))
    || Object.values(drafts.replies).some(draft => Boolean(draft.text.length));
}

export function writeDzmmForumDrafts(storage: DraftStorage, accountId: string, drafts: DzmmForumDrafts): void {
  const raw = JSON.stringify({ version: 1, accountId, ...drafts });
  // Whole-record validation happens before any mutation. Never truncate input or
  // evict another draft to fit a full/failed browser store.
  parseDzmmForumDrafts(raw, accountId);
  if (Object.keys(drafts.editors).length || Object.keys(drafts.replies).length) storage.setItem(dzmmForumDraftStorageKey(accountId), raw);
  else storage.removeItem(dzmmForumDraftStorageKey(accountId));
}

export function acknowledgeDzmmForumEditor(drafts: DzmmForumDrafts, key: string, submitted: DzmmForumEditorDraft): { drafts: DzmmForumDrafts; cleared: boolean } {
  const current = drafts.editors[key];
  if (current && (current.revision !== submitted.revision || current.title !== submitted.title || current.body !== submitted.body
    || current.category !== submitted.category || current.tagsText !== submitted.tagsText || current.baseUpdatedAt !== submitted.baseUpdatedAt
    || current.createIntent?.requestId !== submitted.createIntent?.requestId)) return { drafts, cleared: false };
  const editors = { ...drafts.editors }; delete editors[key];
  return { drafts: { ...drafts, editors }, cleared: true };
}

/** Rebinding is explicit: preserve all current input, including edits made while comparing. */
export function rebaseDzmmForumEditor(drafts: DzmmForumDrafts, key: string, baseUpdatedAt: number): DzmmForumDrafts {
  const current = drafts.editors[key];
  if (!key.startsWith("edit:") || !current || !editVersion(baseUpdatedAt)) return drafts;
  return { ...drafts, editors: { ...drafts.editors, [key]: { ...current, baseUpdatedAt, revision: crypto.randomUUID() } } };
}

export function acknowledgeDzmmForumReply(drafts: DzmmForumDrafts, id: string, submitted: DzmmForumReplyDraft): DzmmForumDrafts {
  const current = drafts.replies[id];
  if (!current || current.revision !== submitted.revision || current.text !== submitted.text) return drafts;
  const replies = { ...drafts.replies }; delete replies[id];
  return { ...drafts, replies };
}

/** Also exports unreadable original bytes and quota-failed complete input. */
export function exportDzmmForumDrafts(accountId: string, drafts: DzmmForumDrafts, originalCache?: string): string {
  return JSON.stringify({ version: 1, accountId, ...drafts, ...(originalCache === undefined ? {} : { originalCache }) }, null, 2);
}

/** One durable intent survives both edits and reloads until its original result is resolved. */
export function prepareDzmmForumCreate(draft: DzmmForumEditorDraft): DzmmForumEditorDraft {
  if (draft.createIntent) return draft;
  const { title, body, category, tagsText, revision } = draft;
  return { ...draft, createIntent: { requestId: crypto.randomUUID(), snapshot: { title, body, category, tagsText, revision } } };
}
export function submittedDzmmForumCreate(draft: DzmmForumEditorDraft): DzmmForumEditorDraft {
  if (!draft.createIntent) throw new Error("主题发布请求尚未保存。");
  return { ...draft.createIntent.snapshot, createIntent: draft.createIntent };
}
/** Only an explicit user action moves changed text to an acknowledged topic. Never replace an existing edit draft. */
export function adoptDzmmForumCreatedPost(drafts: DzmmForumDrafts, requestId: string, postId: string, baseUpdatedAt: number): DzmmForumDrafts {
  const current = drafts.editors.new, key = dzmmForumEditorDraftKey(postId);
  if (!current?.createIntent || current.createIntent.requestId !== requestId || !uuid(postId) || !editVersion(baseUpdatedAt) || drafts.editors[key]) return drafts;
  const { title, body, category, tagsText } = current;
  const editors = { ...drafts.editors, [key]: { title, body, category, tagsText, baseUpdatedAt, revision: crypto.randomUUID() } };
  delete editors.new;
  return { ...drafts, editors };
}
