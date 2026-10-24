import assert from 'node:assert/strict';
import { test } from 'node:test';
import module from './dzmm-forum-drafts';
import type { DzmmForumDrafts, DzmmForumEditorDraft } from './dzmm-forum-drafts';
const { acknowledgeDzmmForumEditor, acknowledgeDzmmForumReply, dzmmForumDraftStorageKey, emptyDzmmForumDrafts, exportDzmmForumDrafts, parseDzmmForumDrafts, rebaseDzmmForumEditor, writeDzmmForumDrafts } = module as typeof import('./dzmm-forum-drafts');

const owner = 'fixture-forum-owner';
const id = '65656565-6565-4656-8656-656565656565';
const revision = '75757575-7575-4757-8757-757575757575';
const editor: DzmmForumEditorDraft = { title: 'A map', body: '  Original\ntext  ', category: 'life', tagsText: 'map', revision };
const state = () => ({ editors: { new: { ...editor } }, replies: { [id]: { text: '  Reply\ntext  ', revision } } });
const encode = (drafts: DzmmForumDrafts = state(), accountId = owner) => JSON.stringify({ version: 1, accountId, ...drafts });

test('forum drafts preserve literal input and reject a different owner', () => {
  assert.deepEqual(parseDzmmForumDrafts(encode(), owner), state());
  assert.throws(() => parseDzmmForumDrafts(encode(), 'other-owner'));
});
test('invalid slots and extra fields cannot enter a draft snapshot', () => {
  const payload = JSON.parse(encode());
  payload.editors.__proto__ = { title: 'bad' };
  payload.editors['constructor'] = editor;
  assert.throws(() => parseDzmmForumDrafts(JSON.stringify(payload), owner));
  assert.throws(() => parseDzmmForumDrafts(JSON.stringify({ ...JSON.parse(encode()), extra: true }), owner));
});
test('editor acknowledgements clear only the submitted revision and content', () => {
  const original = state();
  const edited = { ...original, editors: { new: { ...editor, body: 'New unsent text' } } };
  assert.equal(acknowledgeDzmmForumEditor(edited, 'new', editor).cleared, false);
  assert.deepEqual(acknowledgeDzmmForumEditor(original, 'new', editor).drafts.replies, original.replies);
  assert.deepEqual(acknowledgeDzmmForumEditor(original, 'new', editor).drafts.editors, {});
});
test('reply acknowledgements retain a later draft and unrelated editor', () => {
  const original = state();
  const edited = { ...original, replies: { [id]: { text: 'A later reply', revision } } };
  assert.equal(acknowledgeDzmmForumReply(edited, id, original.replies[id]), edited);
  const next = acknowledgeDzmmForumReply(original, id, original.replies[id]);
  assert.deepEqual(next.replies, {});
  assert.deepEqual(next.editors, original.editors);
});
test('validation and storage failure preserve the previous cache', () => {
  let cache = encode();
  const store = { getItem: () => cache, setItem: () => { throw new Error('quota'); }, removeItem: () => { cache = ''; } };
  assert.throws(() => writeDzmmForumDrafts(store, owner, state()));
  assert.equal(cache, encode());
  assert.throws(() => writeDzmmForumDrafts(store, owner, { ...state(), replies: { [id]: { text: 'x'.repeat(4001), revision } } }));
  assert.equal(cache, encode());
});
test('empty cleanup removes only the current owner key', () => {
  const removed: string[] = [];
  writeDzmmForumDrafts({ getItem: () => null, setItem: () => { throw new Error('unexpected write'); }, removeItem: key => removed.push(key) }, owner, emptyDzmmForumDrafts());
  assert.deepEqual(removed, [dzmmForumDraftStorageKey(owner)]);
});
test('export preserves unreadable original cache alongside current exact text', () => {
  const value = JSON.parse(exportDzmmForumDrafts(owner, state(), '{invalid'));
  assert.equal(value.originalCache, '{invalid');
  assert.equal(value.editors.new.body, editor.body);
  assert.equal(value.accountId, owner);
});

const editKey = `edit:${id}`;
const otherId = '86868686-8686-4868-8868-868686868686';
const literalEditor: DzmmForumEditorDraft = { title: '  航标🌊\t', body: ' \n原稿🧭\r\n\t下一页  \n',
  category: 'characters', tagsText: '  原创，\t海图  ', revision };

test('legacy five-field editor caches retain exact whitespace and emoji without inventing a base version', () => {
  const legacy = { editors: { new: { ...literalEditor }, [editKey]: { ...literalEditor } }, replies: state().replies };
  const restored = parseDzmmForumDrafts(encode(legacy), owner);
  assert.deepEqual(restored, legacy);
  for (const draft of Object.values(restored.editors)) {
    assert.equal(Object.hasOwn(draft, 'baseUpdatedAt'), false);
    assert.deepEqual(Object.keys(draft).sort(), ['body', 'category', 'revision', 'tagsText', 'title']);
  }
  const exported = JSON.parse(exportDzmmForumDrafts(owner, restored));
  assert.deepEqual(exported.editors[editKey], literalEditor);
});

test('edit base timestamps round-trip through actual storage while other drafts and replies remain exact', () => {
  for (const baseUpdatedAt of [0, 1791597000000, Number.MAX_SAFE_INTEGER - 1]) {
    const original = { editors: { new: { ...literalEditor }, [editKey]: { ...literalEditor, baseUpdatedAt } }, replies: state().replies };
    const cache = new Map<string, string>();
    writeDzmmForumDrafts({ getItem: key => cache.get(key) ?? null, setItem: (key, raw) => { cache.set(key, raw); }, removeItem: key => { cache.delete(key); } }, owner, original);
    assert.deepEqual([...cache.keys()], [dzmmForumDraftStorageKey(owner)]);
    const restored = parseDzmmForumDrafts(cache.get(dzmmForumDraftStorageKey(owner))!, owner);
    assert.deepEqual(restored, original);
    assert.equal(restored.editors[editKey].baseUpdatedAt, baseUpdatedAt);
  }
});

test('invalid edit versions, versioned new-post slots and extra editor fields cannot overwrite an existing cache', () => {
  const original = { editors: { [editKey]: { ...literalEditor, baseUpdatedAt: 10 } }, replies: state().replies };
  let raw = encode(original);
  const previous = raw;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } };
  const invalid: unknown[] = [null, -1, 1.5, '10', {}, [], Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];
  for (const baseUpdatedAt of invalid) {
    const value = { editors: { [editKey]: { ...literalEditor, baseUpdatedAt } }, replies: state().replies };
    assert.throws(() => parseDzmmForumDrafts(encode(value as typeof original), owner));
    assert.throws(() => writeDzmmForumDrafts(storage, owner, value as typeof original));
    assert.equal(raw, previous);
  }
  for (const editors of [{ new: { ...literalEditor, baseUpdatedAt: 10 } }, { [editKey]: { ...literalEditor, baseUpdatedAt: 10, futureField: true } }]) {
    assert.throws(() => writeDzmmForumDrafts(storage, owner, { editors, replies: {} }));
    assert.equal(raw, previous);
  }
});

test('explicit rebase preserves later unsent input and unrelated drafts while issuing a fresh revision', () => {
  const current = { ...literalEditor, body: `${literalEditor.body}\n比对期间补写的正文🙂  `, baseUpdatedAt: 10 };
  const original = { editors: { [editKey]: current, new: { ...editor }, [`edit:${otherId}`]: { ...editor, baseUpdatedAt: 50 } }, replies: state().replies };
  const before = structuredClone(original);
  const rebound = rebaseDzmmForumEditor(original, editKey, 20);
  assert.deepEqual(original, before);
  const { revision: freshRevision, baseUpdatedAt } = rebound.editors[editKey];
  assert.deepEqual({ ...rebound.editors[editKey], revision: current.revision, baseUpdatedAt: current.baseUpdatedAt }, current);
  assert.equal(baseUpdatedAt, 20);
  assert.notEqual(freshRevision, revision);
  assert.match(freshRevision, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(rebound.editors.new, original.editors.new);
  assert.equal(rebound.editors[`edit:${otherId}`], original.editors[`edit:${otherId}`]);
  assert.equal(rebound.replies, original.replies);
  for (const invalidBase of [-1, 1.5, Number.MAX_SAFE_INTEGER]) assert.equal(rebaseDzmmForumEditor(original, editKey, invalidBase), original);
  assert.equal(rebaseDzmmForumEditor(original, 'new', 20), original);
  assert.equal(rebaseDzmmForumEditor(original, `edit:${revision}`, 20), original);
});

test('an old ACK cannot clear a rebased version or later text, and a matching ACK clears only that slot', () => {
  const submitted = { ...literalEditor, baseUpdatedAt: 10 };
  const original = { editors: { [editKey]: submitted, new: { ...editor } }, replies: state().replies };
  const rebound = rebaseDzmmForumEditor(original, editKey, 20);
  assert.deepEqual(acknowledgeDzmmForumEditor(rebound, editKey, submitted), { drafts: rebound, cleared: false });
  const baseOnlyChange = { ...original, editors: { ...original.editors, [editKey]: { ...submitted, baseUpdatedAt: 20 } } };
  assert.equal(acknowledgeDzmmForumEditor(baseOnlyChange, editKey, submitted).cleared, false);
  const newerText = { ...rebound, editors: { ...rebound.editors, [editKey]: { ...rebound.editors[editKey], body: 'Another unsent paragraph\n  🌊' } } };
  assert.equal(acknowledgeDzmmForumEditor(newerText, editKey, rebound.editors[editKey]).cleared, false);
  const acknowledged = acknowledgeDzmmForumEditor(newerText, editKey, newerText.editors[editKey]);
  assert.equal(acknowledged.cleared, true);
  assert.deepEqual(acknowledged.drafts.editors, { new: editor });
  assert.equal(acknowledged.drafts.replies, original.replies);
});

const { prepareDzmmForumCreate, submittedDzmmForumCreate, adoptDzmmForumCreatedPost } = module as typeof import('./dzmm-forum-drafts');
test('a create intent freezes exact input and survives edits, persistence and reload without issuing another key', () => {
  const prepared = prepareDzmmForumCreate(literalEditor);
  assert.deepEqual(prepared.createIntent!.snapshot, literalEditor);
  const changed = { ...prepared, body: '后来补写\n  🌊', title: '', revision: crypto.randomUUID() };
  const restored = parseDzmmForumDrafts(encode({ editors: { new: changed }, replies: state().replies }), owner).editors.new;
  assert.deepEqual(prepareDzmmForumCreate(restored), changed);
  assert.deepEqual(submittedDzmmForumCreate(restored), { ...literalEditor, createIntent: prepared.createIntent });
  assert.equal(restored.body, changed.body);
  assert.equal(restored.createIntent!.requestId, prepared.createIntent!.requestId);
});
test('create ACK clears matching intent only, preserving later text, revisions and another request', () => {
  const prepared = prepareDzmmForumCreate(editor), submitted = submittedDzmmForumCreate(prepared);
  const original = { editors: { new: prepared }, replies: state().replies };
  assert.equal(acknowledgeDzmmForumEditor(original, 'new', submitted).cleared, true);
  for (const changed of [{ ...prepared, body: 'Later' }, { ...prepared, revision: crypto.randomUUID() },
    { ...prepared, createIntent: { ...prepared.createIntent!, requestId: crypto.randomUUID() } }]) {
    const drafts = { ...original, editors: { new: changed } };
    assert.deepEqual(acknowledgeDzmmForumEditor(drafts, 'new', submitted), { drafts, cleared: false });
  }
});
test('explicit adoption preserves all current new input and unrelated slots without modifying the acknowledged snapshot', () => {
  const prepared = prepareDzmmForumCreate(literalEditor);
  const changed = { ...prepared, body: literalEditor.body + '\n补写🙂', title: '改稿', category: 'help' as const, tagsText: ' 新标签 ' };
  const original = { editors: { new: changed, [`edit:${otherId}`]: editor }, replies: state().replies };
  const adopted = adoptDzmmForumCreatedPost(original, prepared.createIntent!.requestId, id, 100);
  assert.equal(adopted.editors.new, undefined);
  assert.deepEqual({ ...adopted.editors[editKey], revision: changed.revision, baseUpdatedAt: undefined },
    { title: changed.title, body: changed.body, category: changed.category, tagsText: changed.tagsText, revision: changed.revision, baseUpdatedAt: undefined });
  assert.equal(adopted.editors[editKey].baseUpdatedAt, 100);
  assert.equal(adopted.editors[editKey].createIntent, undefined);
  assert.deepEqual(original.editors.new.createIntent!.snapshot, literalEditor);
  assert.equal(adopted.editors[`edit:${otherId}`], editor);
  assert.equal(adopted.replies, original.replies);
  const occupied = { ...original, editors: { ...original.editors, [editKey]: editor } };
  assert.equal(adoptDzmmForumCreatedPost(occupied, prepared.createIntent!.requestId, id, 100), occupied);
  assert.equal(adoptDzmmForumCreatedPost(original, crypto.randomUUID(), id, 100), original);
});
test('malformed, nested, empty or edit-slot create intents cannot overwrite a valid legacy cache', () => {
  const prepared = prepareDzmmForumCreate(editor), intent = prepared.createIntent!;
  let raw = encode(); const prior = raw;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } };
  for (const bad of [null, { ...intent, requestId: 'invalid' }, { ...intent, extra: true }, { ...intent, snapshot: { ...editor, body: '' } },
    { ...intent, snapshot: { ...editor, createIntent: intent } }]) {
    assert.throws(() => writeDzmmForumDrafts(storage, owner, { editors: { new: { ...editor, createIntent: bad as typeof intent } }, replies: {} }));
    assert.equal(raw, prior);
  }
  assert.throws(() => writeDzmmForumDrafts(storage, owner, { editors: { [editKey]: prepared }, replies: {} }));
  assert.equal(raw, prior);
});
