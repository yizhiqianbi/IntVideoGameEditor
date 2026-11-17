"use client";

/* eslint-disable @next/next/no-img-element -- Character images are shared with the Vite frontend. */

import { DZMM_DEFAULT_MODEL, DZMM_OFFERED_MODEL_OPTIONS, type DzmmModelPreset } from "../../lib/dzmm-models";

import { useEffect, useRef, useState } from "react";
import { cloneDzmmNovelDraft, countDzmmNovelWords, createDzmmNovelDraft, decodeDzmmNovelImportBytes, dzmmNovelDraftFromDetail, exportDzmmNovelJson, exportDzmmNovelText,
  parseDzmmNovelImport, type DzmmNovelDraft, type DzmmNovelWorkSummary } from "../../lib/dzmm-novels";
import { clearDzmmNovelRecovery, deleteDzmmNovel, dismissDzmmNovelRecovery, DzmmNovelClientError, fetchDzmmNovel, fetchDzmmNovels, generateDzmmNovel,
  readDzmmNovelRecoveries, saveDzmmNovel, writeDzmmNovelRecovery, type DzmmNovelRecovery, type DzmmNovelRecoveryEntry } from "../../lib/dzmm-novels-client";
import type { Character } from "../../lib/dzmm-characters";
import { parseXumengNovelCharacters, xumengPerformanceFromCard, xumengPerformanceFromNovel,
  type XumengLiveVoice, type XumengNovelCharacter, type XumengPerformanceCharacter } from "../../lib/xumeng-performance-character";
import { XUMENG_CALLS_ENABLED, XUMENG_CALLS_LOCKED_MESSAGE } from "../../lib/xumeng-feature-availability";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengStudio, xumengStudioFill } from "../../lib/xumeng-studio-copy";
import Icon from "./icons";
import { XUMENG_DEFAULT_SPEECH_VOICE, XUMENG_SPEECH_VOICE_GROUPS, XUMENG_SPEECH_VOICES, XUMENG_LIVE_VOICE_OPTIONS, type XumengSpeechVoiceId } from "../../lib/xumeng-voices";
import s from "./novel-studio.module.css";

export type NovelStudioProps = {
  onSaved?: (id: string) => void;
  onNavigate?: (id: string | null, type?: "novel" | "story") => void;
  initialId?: string; initialType?: "novel" | "story";
  userId?: string; isGuest: boolean; onRequireAccount: () => void; onBack?: () => void;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
  characters?: Character[]; onPerformCharacter?: (profile: XumengPerformanceCharacter, target: "live" | "voice") => void;
  locale?: XumengLocale;
};
type Editor = Omit<DzmmNovelRecovery, "updatedAt">;
type Section = "settings" | "outline" | "characters" | "chapter" | "read";
type Action = "load" | "save" | "delete" | "import" | "generate";
type Preview = { accountId: string; workId: string; chapterId: string | null; operation: "outline" | "continue"; text: string; state: "running" | "ready" | "stopped" | "failed" };
type PerformanceRequest = { id: string; target: "live" | "voice"; includeContext: boolean; accountId: string; workId: string; generation: number };
type Dialog = { type: "leave" | "preview"; action: () => void; label: string } | { type: "chapter" | "character"; id: string }
  | { type: "perform"; request: PerformanceRequest } | { type: "work" } | { type: "recovery"; entry: DzmmNovelRecoveryEntry };
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const filename = (title: string, untitled: string) => (title.trim() || untitled).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
function characterImage(value: string) {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? value : null; }
  catch { return null; }
}
function CharacterAvatar({ profile, large = false }: { profile: XumengNovelCharacter; large?: boolean }) {
  const image = characterImage(profile.avatar);
  return <span className={`${s.characterAvatar} ${large ? s.largeAvatar : ""}`} aria-hidden="true"><Icon name="user" size={large ? 30 : 18} />{image && <img key={image} src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</span>;
}
function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function NovelStudio({ onSaved, onNavigate, initialId, initialType, userId, isGuest, locale = "zh-Hans", onRequireAccount, onBack, onDirtyChange, onBusyChange, characters = [], onPerformCharacter }: NovelStudioProps) {
  const c = xumengStudio(locale);
  const stamp = (timestamp: number) => new Date(timestamp).toLocaleString(locale === "zh-Hans" ? "zh-CN" : locale === "zh-Hant" ? "zh-TW" : locale === "ja" ? "ja" : locale === "ko" ? "ko" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const [library, setLibrary] = useState<{ accountId: string; works: DzmmNovelWorkSummary[] } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [section, setSection] = useState<Section>("settings");
  const [tagText, setTagText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [recoveries, setRecoveries] = useState<DzmmNovelRecoveryEntry[]>([]);
  const [recoveryOwnerId] = useState(() => crypto.randomUUID());
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [model, setModel] = useState<DzmmModelPreset>(DZMM_DEFAULT_MODEL);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [importCharacterId, setImportCharacterId] = useState("");
  const [includeChapterContext, setIncludeChapterContext] = useState(false);
  const editorRef = useRef<Editor | null>(null), savedEditor = useRef<Editor | null>(null), dirtyRef = useRef(false), previewRef = useRef<Preview | null>(null);
  const activeAccount = useRef(userId), guestRef = useRef(isGuest), epoch = useRef(0), mounted = useRef(true);
  const actionRef = useRef<Action | null>(null), controller = useRef<AbortController | null>(null);
  const callbacks = useRef({ onDirtyChange, onBusyChange, onPerformCharacter, onSaved, onNavigate });
  const ownRecovery = useRef<DzmmNovelRecoveryEntry | null>(null);
  const copySources = useRef(new Map<string, DzmmNovelRecoveryEntry[]>());
  const importInput = useRef<HTMLInputElement>(null), dialogElement = useRef<HTMLDivElement>(null);
  activeAccount.current = userId; guestRef.current = isGuest; callbacks.current = { onDirtyChange, onBusyChange, onPerformCharacter, onSaved, onNavigate };
  const current = editor?.accountId === userId && !isGuest ? editor : null;
  const works = library && library.accountId === userId && !isGuest ? library.works : [];
  const currentPreview = preview && preview.accountId === userId && preview.workId === current?.draft.id ? preview : null;
  const orphanedPreview = Boolean(currentPreview?.operation === "continue" && !current?.draft.chapters.some(item => item.id === currentPreview.chapterId));
  const busy = action !== null;
  const guarded = dirty || Boolean(currentPreview?.text);
  const chapter = current?.draft.chapters.find(item => item.id === current.selectedChapterId);
  const cast = current?.draft.characters ?? [];
  const selectedCharacter = cast.find(item => item.id === selectedCharacterId) ?? cast[0];
  const totalWords = current?.draft.chapters.reduce((sum, item) => sum + countDzmmNovelWords(item.content), 0) ?? 0;

  useEffect(() => { const accountEpoch = epoch; mounted.current = true; return () => { mounted.current = false; accountEpoch.current++; controller.current?.abort(); callbacks.current.onDirtyChange?.(false); callbacks.current.onBusyChange?.(false); }; }, []);
  useEffect(() => { callbacks.current.onDirtyChange?.(guarded); }, [guarded]);
  useEffect(() => { callbacks.current.onBusyChange?.(busy); }, [busy]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || previewRef.current?.text || actionRef.current === "save") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    const generation = ++epoch.current, accountId = userId;
    controller.current?.abort(); controller.current = null; actionRef.current = null;
    editorRef.current = null; savedEditor.current = null; dirtyRef.current = false; previewRef.current = null; ownRecovery.current = null; copySources.current.clear();
    setEditor(null); setLibrary(null); setDirty(false); setAction(null); setPreview(null); setDialog(null);
    setError(""); setNotice(""); setConflict(false); setStorageError(false); setSection("settings"); setTagText(""); setRecoveries([]);
    setSelectedCharacterId(null); setImportCharacterId(""); setIncludeChapterContext(false);
    if (!accountId || isGuest) return;
    syncRecoveries(accountId);
    const abort = new AbortController(); controller.current = abort; actionRef.current = "load"; setAction("load");
    const valid = () => mounted.current && epoch.current === generation && activeAccount.current === accountId && !guestRef.current;
    void fetchDzmmNovels(accountId, abort.signal).then(async value => {
      if (!valid()) return;
      setLibrary(value);
      if (initialId) {
        const detail = await fetchDzmmNovel(accountId, initialId, abort.signal);
        if (valid()) replaceEditor({ accountId, draft: dzmmNovelDraftFromDetail(detail), baseVersion: detail.work.version, selectedChapterId: detail.chapters[0]?.id ?? null }, false);
      } else if (initialType) {
        const draft = createDzmmNovelDraft(initialType);
        if (valid()) replaceEditor({ accountId, draft, baseVersion: null, selectedChapterId: draft.chapters[0]?.id ?? null }, true);
      }
    })
      .catch(failure => { if (valid() && !abort.signal.aborted) setError(errorText(failure, c.nvFailed)); })
      .finally(() => { if (valid()) { actionRef.current = null; setAction(null); } });
    return () => abort.abort();
  }, [userId, isGuest, initialId, initialType]);
  useEffect(() => {
    if (!userId || isGuest) return;
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("xumeng-novel-recovery")) syncRecoveries(userId);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [userId, isGuest]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogElement.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionRef.current) { event.preventDefault(); setDialog(null); }
      if (event.key !== "Tab") return;
      const items = dialogElement.current?.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]");
      if (!items?.length) { event.preventDefault(); dialogElement.current?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (document.activeElement === dialogElement.current || !dialogElement.current?.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [dialog]);

  function syncRecoveries(accountId: string) {
    if (accountId !== activeAccount.current || guestRef.current || !mounted.current) return;
    try { setRecoveries(readDzmmNovelRecoveries(accountId)); }
    catch { setStorageError(true); }
  }
  function stash(value: Editor): DzmmNovelRecoveryEntry | null {
    try {
      const entry = writeDzmmNovelRecovery({ ...value, updatedAt: Date.now() }, { ownerId: recoveryOwnerId, workId: value.draft.id });
      ownRecovery.current = entry; setStorageError(false); return entry;
    } catch { setStorageError(true); return null; }
  }
  function commit(value: Editor, changed: boolean) {
    if (value.accountId !== activeAccount.current || guestRef.current || !mounted.current) return;
    const previous = editorRef.current;
    // After a failed copy save, editing that copy can remove text still held
    // only in its original recovery. Keep that original until explicit discard.
    if (changed && previous?.draft.id === value.draft.id && previous.draft !== value.draft) copySources.current.delete(value.draft.id);
    editorRef.current = value; dirtyRef.current = changed; setEditor(value); setDirty(changed);
    callbacks.current.onDirtyChange?.(changed || Boolean(previewRef.current?.text));
    if (changed) stash(value);
  }
  function updateDraft(update: (draft: DzmmNovelDraft) => DzmmNovelDraft) {
    const value = editorRef.current;
    if (!value || value.accountId !== activeAccount.current || actionRef.current) return;
    commit({ ...value, draft: update(value.draft) }, true); setNotice("");
  }
  function forgetRecovery(entry: DzmmNovelRecoveryEntry | null) {
    if (!entry) return;
    try {
      clearDzmmNovelRecovery(entry, recoveryOwnerId);
      if (ownRecovery.current?.storageKey === entry.storageKey && ownRecovery.current.raw === entry.raw) ownRecovery.current = null;
    } catch { setStorageError(true); }
    syncRecoveries(entry.accountId);
  }
  function resumeRecovery(entry: DzmmNovelRecoveryEntry) {
    if (entry.accountId !== activeAccount.current || guestRef.current || !mounted.current || actionRef.current) return;
    try {
      const latest = readDzmmNovelRecoveries(entry.accountId).find(candidate => candidate.storageKey === entry.storageKey);
      if (!latest) { syncRecoveries(entry.accountId); setNotice(c.nvRecoveryStale); return; }
      copySources.current.delete(latest.draft.id);
      replaceEditor({ accountId: latest.accountId, draft: latest.draft, baseVersion: latest.baseVersion, selectedChapterId: latest.selectedChapterId }, true);
      callbacks.current.onNavigate?.(latest.baseVersion === null ? "new" : latest.draft.id, latest.draft.type);
      setNotice(c.nvRecoveryLoaded);
    } catch { setStorageError(true); }
  }
  function clearPreview() { previewRef.current = null; setPreview(null); callbacks.current.onDirtyChange?.(dirtyRef.current); }
  function replaceEditor(value: Editor, changed: boolean, retainedPreview?: Preview) {
    if (retainedPreview?.accountId === value.accountId && retainedPreview.workId === value.draft.id) {
      previewRef.current = retainedPreview; setPreview(retainedPreview);
    } else clearPreview();
    setTagText(value.draft.tags.join("，")); setConflict(false); setError(""); setNotice("");
    setSelectedCharacterId(null); setImportCharacterId(""); setIncludeChapterContext(false);
    if (!changed) { ownRecovery.current = null; copySources.current.delete(value.draft.id); }
    savedEditor.current = changed ? null : value; commit(value, changed); setSection("settings");
  }
  function guardNavigation(proceed: () => void, label: string) {
    if (actionRef.current) return;
    if (dirtyRef.current || previewRef.current?.text) setDialog({ type: "leave", action: proceed, label });
    else proceed();
  }
  async function run(kind: Action, task: (accountId: string, signal: AbortSignal, valid: () => boolean) => Promise<void>): Promise<boolean> {
    const accountId = activeAccount.current, generation = epoch.current;
    if (!accountId || guestRef.current) { onRequireAccount(); return false; }
    if (actionRef.current) return false;
    const abort = new AbortController(); controller.current = abort; actionRef.current = kind; setAction(kind); callbacks.current.onBusyChange?.(true); setError(""); setNotice("");
    const valid = () => mounted.current && generation === epoch.current && accountId === activeAccount.current && !guestRef.current;
    try { await task(accountId, abort.signal, valid); return valid(); }
    catch (failure) {
      if (valid()) { setError(errorText(failure, c.nvFailed)); if (failure instanceof DzmmNovelClientError && failure.status === 409) setConflict(true); }
      return false;
    } finally { if (valid()) { actionRef.current = null; controller.current = null; setAction(null); callbacks.current.onBusyChange?.(false); } }
  }
  function create(type: "novel" | "story") {
    const accountId = activeAccount.current; if (!accountId || guestRef.current) { onRequireAccount(); return; }
    guardNavigation(() => {
      const draft = createDzmmNovelDraft(type);
      replaceEditor({ accountId, draft, baseVersion: null, selectedChapterId: draft.chapters[0]?.id ?? null }, true);
      callbacks.current.onNavigate?.("new", type);
    }, c.nvCreateWork);
  }
  async function open(workId: string) {
    await run("load", async (accountId, signal, valid) => {
      const detail = await fetchDzmmNovel(accountId, workId, signal);
      if (valid()) { replaceEditor({ accountId, draft: dzmmNovelDraftFromDetail(detail), baseVersion: detail.work.version, selectedChapterId: detail.chapters[0]?.id ?? null }, false); callbacks.current.onNavigate?.(detail.work.id); }
    });
  }
  async function refresh() { await run("load", async (accountId, signal, valid) => { const value = await fetchDzmmNovels(accountId, signal); if (valid()) setLibrary(value); }); }
  function libraryView() {
    if (editorRef.current) copySources.current.delete(editorRef.current.draft.id);
    editorRef.current = null; savedEditor.current = null; ownRecovery.current = null; dirtyRef.current = false; setEditor(null); setDirty(false); clearPreview(); setError(""); setNotice(""); setConflict(false);
    if (activeAccount.current) syncRecoveries(activeAccount.current); void refresh();
    callbacks.current.onNavigate?.(null);
  }
  async function save(copy = false): Promise<boolean> {
    const snapshot = editorRef.current;
    if (!snapshot || snapshot.accountId !== activeAccount.current || guestRef.current || !mounted.current || actionRef.current) return false;
    const originalRecovery = ownRecovery.current;
    if (copy) {
      const draft = { ...cloneDzmmNovelDraft(snapshot.draft), title: xumengStudioFill(c.nvCopySuffix, { title: snapshot.draft.title.slice(0, 116) }) };
      const sourcePreview = previewRef.current;
      // A copy has new chapter IDs. Keep an uninserted preview attached to the
      // corresponding copied chapter, even when the save fails. A deleted
      // target stays orphaned so insertion creates a chapter instead.
      const targetIndex = snapshot.draft.chapters.findIndex(chapter => chapter.id === sourcePreview?.chapterId);
      const retainedPreview = sourcePreview?.accountId === snapshot.accountId && sourcePreview.workId === snapshot.draft.id
        ? { ...sourcePreview, workId: draft.id, chapterId: draft.chapters[targetIndex]?.id ?? null } : undefined;
      const sources = [...(copySources.current.get(snapshot.draft.id) ?? [])];
      if (originalRecovery?.draft.id === snapshot.draft.id) sources.push(originalRecovery);
      copySources.current.set(draft.id, sources);
      replaceEditor({ ...snapshot, draft, baseVersion: null, selectedChapterId: draft.chapters[0]?.id ?? null }, true, retainedPreview);
    }
    const saving = editorRef.current!, savingRecovery = stash(saving);
    const migratedRecoveries = copySources.current.get(saving.draft.id) ?? [];
    let saved = false;
    const currentAction = await run("save", async (accountId, signal, valid) => {
      const detail = await saveDzmmNovel(accountId, saving.draft, saving.baseVersion, signal);
      if (!valid()) return;
      const value = { accountId, draft: dzmmNovelDraftFromDetail(detail), baseVersion: detail.work.version,
        selectedChapterId: detail.chapters.some(item => item.id === saving.selectedChapterId) ? saving.selectedChapterId : detail.chapters[0]?.id ?? null };
      savedEditor.current = value; commit(value, false); forgetRecovery(savingRecovery);
      for (const entry of migratedRecoveries) forgetRecovery(entry);
      copySources.current.delete(saving.draft.id);
      if (copy) copySources.current.delete(snapshot.draft.id);
      setConflict(false); setNotice(c.nvWorkSaved); saved = true; callbacks.current.onSaved?.(detail.work.id);
      // A list refresh failure must never turn a confirmed save into a failed save.
      try { const page = await fetchDzmmNovels(accountId, signal); if (valid()) setLibrary(page); } catch { /* The saved detail remains authoritative. */ }
    });
    // A confirmed save may finish its list refresh after the account or page
    // changes. That old success must not authorize the next navigation.
    return saved && currentAction;
  }
  async function saveAndLeave() {
    if (dialog?.type !== "leave") return;
    const pending = dialog, accountId = activeAccount.current, generation = epoch.current;
    if (await save() && mounted.current && epoch.current === generation
      && activeAccount.current === accountId && !guestRef.current) {
      clearPreview(); setDialog(null); pending.action();
    }
  }
  function discardAndLeave() {
    if (dialog?.type !== "leave" || actionRef.current) return;
    const pending = dialog, accountId = activeAccount.current;
    if (editorRef.current) copySources.current.delete(editorRef.current.draft.id);
    if (accountId && ownRecovery.current?.accountId === accountId && ownRecovery.current.draft.id === editorRef.current?.draft.id) forgetRecovery(ownRecovery.current);
    const previous = savedEditor.current;
    if (previous && previous.accountId === accountId && previous.draft.id === editorRef.current?.draft.id) {
      editorRef.current = previous; setEditor(previous); setTagText(previous.draft.tags.join("，"));
    } else { editorRef.current = null; setEditor(null); }
    dirtyRef.current = false; setDirty(false); clearPreview(); setDialog(null); pending.action();
  }
  async function importFile(file?: File) {
    if (!file) return;
    await run("import", async (accountId, _signal, valid) => {
      if (file.size > 1_500_000) throw new Error(c.nvImportBig);
      const format = /\.json$/i.test(file.name) ? "json" : /\.txt$/i.test(file.name) ? "txt" : null;
      if (!format) throw new Error(c.nvImportType);
      const draft = parseDzmmNovelImport(decodeDzmmNovelImportBytes(await file.arrayBuffer()), { format, filename: file.name });
      if (valid()) { replaceEditor({ accountId, draft, baseVersion: null, selectedChapterId: draft.chapters[0]?.id ?? null }, true); callbacks.current.onNavigate?.("new", draft.type); setNotice(c.nvImported); }
    });
  }
  function exportWork(format: "json" | "txt") {
    const snapshot = editorRef.current; if (!snapshot || snapshot.accountId !== activeAccount.current) return;
    try {
      download(`${filename(snapshot.draft.title, c.nvUntitled)}.${format}`, format === "json" ? exportDzmmNovelJson(snapshot.draft) : exportDzmmNovelText(snapshot.draft), format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8");
      setNotice(c.nvExported);
    } catch (failure) { setError(errorText(failure, c.nvFailed)); }
  }
  function addChapter() {
    if (!current || current.draft.chapters.length >= 100) return;
    const added = { id: crypto.randomUUID(), title: xumengStudioFill(c.nvChapterN, { n: current.draft.chapters.length + 1 }), content: "" };
    commit({ ...current, selectedChapterId: added.id, draft: { ...current.draft, chapters: [...current.draft.chapters, added] } }, true); setIncludeChapterContext(false); setSection("chapter");
  }
  function selectChapter(id: string) {
    const value = editorRef.current; if (!value || actionRef.current) return;
    commit({ ...value, selectedChapterId: id }, dirtyRef.current); setIncludeChapterContext(false); setSection("chapter");
  }
  function moveChapter(id: string, direction: -1 | 1) {
    updateDraft(draft => { const chapters = [...draft.chapters], index = chapters.findIndex(item => item.id === id), to = index + direction;
      if (index < 0 || to < 0 || to >= chapters.length) return draft;
      [chapters[index], chapters[to]] = [chapters[to], chapters[index]]; return { ...draft, chapters }; });
  }
  function selectCharacter(id: string) {
    if (actionRef.current) return;
    setSelectedCharacterId(id); setIncludeChapterContext(false);
  }
  function addCharacter(card?: Character, copy?: XumengNovelCharacter) {
    const snapshot = editorRef.current;
    if (!snapshot || snapshot.accountId !== activeAccount.current || guestRef.current || actionRef.current || (snapshot.draft.characters?.length ?? 0) >= 30) return;
    const imported = card ? xumengPerformanceFromCard(card) : copy;
    const profile: XumengNovelCharacter = imported ? {
      id: crypto.randomUUID(), name: imported.name.trim() || c.nvImportPerson, avatar: imported.avatar,
      description: imported.description, personality: imported.personality, scenario: imported.scenario,
      dialogue: imported.dialogue, liveVoice: imported.liveVoice, speechVoice: imported.speechVoice ?? XUMENG_DEFAULT_SPEECH_VOICE,
    } : { id: crypto.randomUUID(), name: xumengStudioFill(c.nvPersonIndex, { n: (snapshot.draft.characters?.length ?? 0) + 1 }), avatar: "",
      description: "", personality: "", scenario: "", dialogue: "", liveVoice: "zh_female_liuchangnv_uranus_bigtts", speechVoice: XUMENG_DEFAULT_SPEECH_VOICE };
    updateDraft(draft => ({ ...draft, characters: [...(draft.characters ?? []), profile] }));
    setSelectedCharacterId(profile.id); setIncludeChapterContext(false); setSection("characters");
    if (card) { setImportCharacterId(""); setNotice(c.nvPersonCopied); }
  }
  function updateCharacter(id: string, field: Exclude<keyof XumengNovelCharacter, "id">, value: string) {
    updateDraft(draft => ({ ...draft, characters: (draft.characters ?? []).map(item => item.id === id ? { ...item, [field]: value } : item) }));
  }
  function finishPerformance(request: PerformanceRequest) {
    const snapshot = editorRef.current;
    if (!mounted.current || activeAccount.current !== request.accountId || guestRef.current || epoch.current !== request.generation
      || actionRef.current || dirtyRef.current || previewRef.current?.text || snapshot?.draft.id !== request.workId
      || snapshot.accountId !== request.accountId || !callbacks.current.onPerformCharacter) return;
    const profile = snapshot.draft.characters?.find(item => item.id === request.id);
    if (!profile) return;
    try {
      const [validated] = parseXumengNovelCharacters([profile]);
      const context = request.includeContext ? snapshot.draft.chapters.find(item => item.id === snapshot.selectedChapterId)?.content ?? "" : "";
      const performance = xumengPerformanceFromNovel(validated, snapshot.draft, context);
      setDialog(null); callbacks.current.onPerformCharacter(performance, request.target);
    } catch (failure) { setError(errorText(failure, c.nvFailed)); }
  }
  function requestPerformance(id: string, target: "live" | "voice") {
    if (target === "live" && !XUMENG_CALLS_ENABLED) { setNotice(XUMENG_CALLS_LOCKED_MESSAGE); return; }
    const snapshot = editorRef.current;
    if (!snapshot || !callbacks.current.onPerformCharacter || snapshot.accountId !== activeAccount.current || guestRef.current || actionRef.current) return;
    if (previewRef.current?.text) {
      setError(c.nvPreviewBeforeCall);
      document.getElementById("novel-ai-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    }
    const request: PerformanceRequest = { id, target, includeContext: includeChapterContext, accountId: snapshot.accountId,
      workId: snapshot.draft.id, generation: epoch.current };
    if (dirtyRef.current || snapshot.baseVersion === null) setDialog({ type: "perform", request });
    else finishPerformance(request);
  }
  async function saveAndPerform() {
    if (dialog?.type !== "perform") return;
    const pending = dialog.request;
    if (await save()) finishPerformance(pending);
  }
  async function confirmDelete() {
    if (dialog?.type === "recovery") {
      const entry = dialog.entry;
      if (entry.accountId !== activeAccount.current || guestRef.current || !mounted.current || actionRef.current) return;
      try {
        dismissDzmmNovelRecovery(entry); syncRecoveries(entry.accountId); setDialog(null);
        setNotice(c.nvRecoveryDropped);
      } catch { setStorageError(true); setError(c.nvRecoveryDropFailed); }
    } else if (dialog?.type === "character") {
      const id = dialog.id;
      if (actionRef.current || !editorRef.current) return;
      updateDraft(draft => ({ ...draft, characters: (draft.characters ?? []).filter(item => item.id !== id) }));
      setDialog(null); setIncludeChapterContext(false); setNotice(c.nvPersonRemoved);
    } else if (dialog?.type === "chapter") {
      const id = dialog.id, snapshot = editorRef.current;
      if (snapshot && !actionRef.current) {
        const chapters = snapshot.draft.chapters.filter(item => item.id !== id);
        commit({ ...snapshot, draft: { ...snapshot.draft, chapters }, selectedChapterId: snapshot.selectedChapterId === id ? chapters[0]?.id ?? null : snapshot.selectedChapterId }, true);
        setIncludeChapterContext(false);
        const preservesPreview = previewRef.current?.chapterId === id && Boolean(previewRef.current.text);
        setDialog(null); setNotice(preservesPreview ? c.nvChapterRemovedPreview : c.nvChapterRemoved);
      }
    } else if (dialog?.type === "work") {
      const snapshot = editorRef.current; if (!snapshot || snapshot.baseVersion === null) return;
      const deletingRecovery = ownRecovery.current?.draft.id === snapshot.draft.id ? ownRecovery.current : null;
      await run("delete", async (accountId, signal, valid) => {
        await deleteDzmmNovel(accountId, snapshot.draft.id, snapshot.baseVersion!, signal);
        if (valid()) { forgetRecovery(deletingRecovery); editorRef.current = null; dirtyRef.current = false; setEditor(null); setDirty(false); clearPreview(); setDialog(null); setConflict(false); setNotice(c.nvWorkDeleted);
          try { const value = await fetchDzmmNovels(accountId, signal); if (valid()) setLibrary(value); } catch { if (valid()) setLibrary(previous => previous ? { ...previous, works: previous.works.filter(item => item.id !== snapshot.draft.id) } : null); }
        }
      });
    }
  }
  async function generate(operation: "outline" | "continue") {
    const snapshot = editorRef.current; if (!snapshot || snapshot.accountId !== activeAccount.current) return;
    if (!snapshot.draft.title.trim()) { setSection("settings"); setError(c.nvNeedTitle); return; }
    const target = snapshot.draft.chapters.find(item => item.id === snapshot.selectedChapterId);
    if (operation === "continue" && !target) { setError(c.nvNeedChapter); return; }
    await run("generate", async (accountId, signal, valid) => {
      const initial: Preview = { accountId, workId: snapshot.draft.id, chapterId: operation === "continue" ? target!.id : null, operation, text: "", state: "running" };
      previewRef.current = initial; setPreview(initial);
      const { id: _id, chapters, ...work } = snapshot.draft; void _id;
      const index = chapters.findIndex(item => item.id === target?.id);
      const recentContext = operation === "continue" ? chapters.slice(Math.max(0, index - 2), Math.max(0, index)).map(item => `${item.title}\n${item.content.slice(-3000)}`).join("\n\n") : "";
      try {
        await generateDzmmNovel({ operation, work, model, maxTokens: 2048,
          ...(operation === "continue" ? { chapter: { title: target!.title, content: target!.content.slice(-12000) }, ...(recentContext ? { recentContext } : {}) } : {}) },
        { signal, onDelta: delta => { if (!valid()) return; const value = previewRef.current; if (!value || value.accountId !== accountId) return; const next = { ...value, text: value.text + delta }; previewRef.current = next; setPreview(next); } });
        if (valid()) { const value = previewRef.current!; const next = { ...value, state: "ready" as const }; previewRef.current = next; setPreview(next); if (!value.text.trim()) throw new Error(c.nvNoGenerated); }
      } catch (failure) {
        if (valid() && previewRef.current) { const next = { ...previewRef.current, state: signal.aborted ? "stopped" as const : "failed" as const }; previewRef.current = next; setPreview(next);
          if (signal.aborted) { setNotice(c.nvStoppedNotice); return; }
        }
        throw failure;
      }
    });
  }
  function insertPreview() {
    const value = previewRef.current, snapshot = editorRef.current;
    if (!value?.text.trim() || !snapshot || actionRef.current || guestRef.current || !mounted.current
      || value.accountId !== activeAccount.current || snapshot.accountId !== activeAccount.current || value.workId !== snapshot.draft.id) return;
    if (value.operation === "outline") {
      if (value.text.length > 20000) { setError(c.nvOutlineLong); return; }
      updateDraft(draft => ({ ...draft, outline: value.text })); setSection("outline");
    } else {
      const target = snapshot.draft.chapters.find(item => item.id === value.chapterId);
      if (!target) {
        if (snapshot.draft.chapters.length >= 100) { setError(c.nvChapterLimit); return; }
        if (value.text.length > 50000) { setError(c.nvPreviewLong); return; }
        const added = { id: crypto.randomUUID(), title: xumengStudioFill(c.nvChapterN, { n: snapshot.draft.chapters.length + 1 }), content: value.text };
        commit({ ...snapshot, selectedChapterId: added.id, draft: { ...snapshot.draft, chapters: [...snapshot.draft.chapters, added] } }, true);
      } else {
        const content = target.content + (target.content ? "\n\n" : "") + value.text;
        if (content.length > 50000) { setError(c.nvAppendLong); return; }
        updateDraft(draft => ({ ...draft, chapters: draft.chapters.map(item => item.id === target.id ? { ...item, content } : item) }));
        const next = editorRef.current!; commit({ ...next, selectedChapterId: target.id }, true);
      }
      setSection("chapter");
    }
    clearPreview(); setNotice(c.nvPreviewInserted);
  }
  function requestGenerate(operation: "outline" | "continue") {
    if (actionRef.current) return;
    if (previewRef.current?.text) setDialog({ type: "preview", action: () => { void generate(operation); }, label: c.nvNewPreview });
    else void generate(operation);
  }
  function renderCharacters() {
    if (!current) return null;
    return <>
      <div className={s.sectionHead}><div><p className={s.eyebrow}>{c.nvPeopleEyebrow}</p><h2>{c.nvPeople} <span>{cast.length} / 30</span></h2></div><button type="button" className={s.primary} disabled={busy || cast.length >= 30} onClick={() => addCharacter()}><Icon name="plus" size={15} />{c.nvNewPerson}</button></div>
      <p className={s.help}>{c.nvPeopleHelp}</p>
      {characters.length > 0 && <div className={s.castImport}><label htmlFor="novel-import-character">{c.nvImportCard}<select id="novel-import-character" value={importCharacterId} disabled={busy || cast.length >= 30} onChange={event => setImportCharacterId(event.target.value)}><option value="">{c.nvPickCard}</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}{item.author ? ` · ${item.author}` : ""}</option>)}</select></label><button type="button" className={s.secondary} disabled={busy || cast.length >= 30 || !characters.some(item => item.id === importCharacterId)} onClick={() => { const card = characters.find(item => item.id === importCharacterId); if (card) addCharacter(card); }}><Icon name="upload" size={15} />{c.nvImportPerson}</button></div>}
      {cast.length >= 30 && <p className={s.help}>{c.nvPeopleLimit}</p>}
      {selectedCharacter ? <div className={s.castWorkspace}>
        <nav className={s.castList} aria-label={c.nvPeopleList}>{cast.map(item => <button key={item.id} type="button" className={item.id === selectedCharacter.id ? s.selectedCharacter : ""} aria-pressed={item.id === selectedCharacter.id} disabled={busy} onClick={() => selectCharacter(item.id)}><CharacterAvatar profile={item} /><span><strong>{item.name || c.nvUnnamedPerson}</strong><small>{item.description || c.nvNoPersonDesc}</small></span></button>)}</nav>
        <div className={s.castInspector}>
          <div className={s.castIdentity}><CharacterAvatar profile={selectedCharacter} large /><div><p className={s.eyebrow}>{c.nvProfile}</p><h3>{selectedCharacter.name || c.nvUnnamedPerson}</h3></div><div className={s.castTools}><button type="button" className={s.iconButton} aria-label={c.nvCopyPerson} title={c.nvCopyPersonTitle} disabled={busy || cast.length >= 30} onClick={() => addCharacter(undefined, selectedCharacter)}><Icon name="copy" size={16} /></button><button type="button" className={s.iconButton} aria-label={c.nvDeletePersonAria} title={c.nvDeletePersonTitle} disabled={busy} onClick={() => setDialog({ type: "character", id: selectedCharacter.id })}><Icon name="close" size={16} /></button></div></div>
          <label className={s.field}><span>{c.nvName} <small>{selectedCharacter.name.length} / 120</small></span><input value={selectedCharacter.name} maxLength={120} disabled={busy} placeholder={c.nvNamePh} onChange={event => updateCharacter(selectedCharacter.id, "name", event.target.value)} /></label>
          <label className={s.field}><span>{c.nvAvatar} <small>{c.nvOptional}</small></span><input value={selectedCharacter.avatar} maxLength={2048} disabled={busy} placeholder={c.nvAvatarPh} onChange={event => updateCharacter(selectedCharacter.id, "avatar", event.target.value)} /><em>{c.nvAvatarHint}</em></label>
          <label className={s.field}><span>{c.nvDescription} <small>{selectedCharacter.description.length} / 2,000</small></span><textarea value={selectedCharacter.description} maxLength={2000} disabled={busy} rows={4} placeholder={c.nvDescPh} onChange={event => updateCharacter(selectedCharacter.id, "description", event.target.value)} /></label>
          <label className={s.field}><span>{c.nvPersonality} <small>{selectedCharacter.personality.length} / 2,000</small></span><textarea value={selectedCharacter.personality} maxLength={2000} disabled={busy} rows={4} placeholder={c.nvPersonalityPh} onChange={event => updateCharacter(selectedCharacter.id, "personality", event.target.value)} /></label>
          <label className={s.field}><span>{c.nvScenario} <small>{selectedCharacter.scenario.length} / 2,000</small></span><textarea value={selectedCharacter.scenario} maxLength={2000} disabled={busy} rows={4} placeholder={c.nvScenarioPh} onChange={event => updateCharacter(selectedCharacter.id, "scenario", event.target.value)} /></label>
          <label className={s.field}><span>{c.nvDialogue} <small>{selectedCharacter.dialogue.length} / 2,000</small></span><textarea value={selectedCharacter.dialogue} maxLength={2000} disabled={busy} rows={5} placeholder={c.nvDialoguePh} onChange={event => updateCharacter(selectedCharacter.id, "dialogue", event.target.value)} /></label>
          <label className={s.field}><span>{c.nvCallVoice}</span><select aria-label={c.nvLiveVoiceAria} value={selectedCharacter.liveVoice} disabled={busy} onChange={event => updateCharacter(selectedCharacter.id, "liveVoice", event.target.value as XumengLiveVoice)}>{([["默认", c.nvVoiceDefault], ["女声", c.nvVoiceFemale], ["男声", c.nvVoiceMale]] as const).map(([group, label]) => <optgroup key={group} label={label}>{XUMENG_LIVE_VOICE_OPTIONS.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
          <label className={s.field}><span>{c.nvSpeechVoice}</span><select aria-label={c.nvSpeechAria} value={selectedCharacter.speechVoice ?? XUMENG_DEFAULT_SPEECH_VOICE} disabled={busy} onChange={event => updateCharacter(selectedCharacter.id, "speechVoice", event.target.value as XumengSpeechVoiceId)}>{XUMENG_SPEECH_VOICE_GROUPS.map(group => <optgroup key={group} label={group === "默认" ? c.nvVoiceDefault : group === "女声" ? c.nvVoiceFemale : group === "男声" ? c.nvVoiceMale : c.nvVoiceSuccubus}>{XUMENG_SPEECH_VOICES.filter(voice => voice.group === group).map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</optgroup>)}</select></label>
          {onPerformCharacter && <div className={s.castHandoff}><p className={s.help}>{c.nvPerformHelp}</p><label className={s.castContext}><input type="checkbox" checked={includeChapterContext && Boolean(chapter?.content.trim())} disabled={busy || !chapter?.content.trim()} onChange={event => setIncludeChapterContext(event.target.checked)} /><span>{chapter?.content.trim() ? xumengStudioFill(c.nvAttachChapter, { title: chapter.title || c.nvCurrentChapter }) : c.nvNoAttach}</span></label><div className={s.castHandoffActions}><button type="button" className={s.primary} disabled={busy} title={XUMENG_CALLS_ENABLED ? c.nvCallTitle : XUMENG_CALLS_LOCKED_MESSAGE} onClick={() => requestPerformance(selectedCharacter.id, "live")}><Icon name={XUMENG_CALLS_ENABLED ? "video" : "lock"} size={16} />{XUMENG_CALLS_ENABLED ? c.nvCall : c.nvCallLocked}</button><button type="button" className={s.secondary} disabled={busy} onClick={() => requestPerformance(selectedCharacter.id, "voice")}><Icon name="volume" size={16} />{c.nvMakeVoice}</button></div></div>}
        </div>
      </div> : <section className={s.castEmpty}><Icon name="users" size={30} /><h3>{c.nvNoPeople}</h3><p>{c.nvNoPeopleBody}</p><button type="button" className={s.secondary} disabled={busy} onClick={() => addCharacter()}><Icon name="plus" size={15} />{c.nvAddFirst}</button></section>}
    </>;
  }

  if (!userId || isGuest) return <main className={s.studio}><header className={s.header}><div><p className={s.eyebrow}>{c.nvEyebrow}</p><h1>{c.nvTitle}</h1></div>{onBack && <button type="button" className={s.quiet} onClick={onBack}>{c.nvBackCenter}</button>}</header><section className={s.empty}><Icon name="book" size={42} /><h2>{c.nvGuestTitle}</h2><p>{c.nvGuestBody}</p><button type="button" className={s.primary} onClick={onRequireAccount}>{c.nvLogin}</button></section></main>;
  return <main className={s.studio} aria-label={c.nvWorkspace}>
    <input ref={importInput} type="file" accept=".txt,.json,text/plain,application/json" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importFile(file); }} />
    <header className={s.header}>
      <div className={s.heading}>{(current || onBack) && <button type="button" className={s.back} disabled={busy} aria-label={current ? c.nvBackList : c.nvBackCenter} onClick={() => guardNavigation(current ? libraryView : () => onBack?.(), current ? c.nvBackList : c.nvBackCenter)}><Icon name="back" size={20} /></button>}
        <div><p className={s.eyebrow}>{c.nvEyebrow}</p><h1>{current ? current.draft.title || c.nvUntitled : c.nvTitle}</h1><p className={s.status} role="status">{current ? `${action === "save" ? c.nvSaving : dirty ? c.nvUnsaved : c.nvSaved} · ${xumengStudioFill(c.nvWordCount, { count: totalWords.toLocaleString() })}${current.baseVersion === null ? ` · ${c.nvNewBadge}` : ` · ${xumengStudioFill(c.nvVersion, { version: current.baseVersion })}`}` : c.nvPrivateNote}</p></div>
      </div>
      <div className={current ? `${s.headerActions} ${s.editorTools}` : s.headerActions}><button type="button" className={s.quiet} disabled={busy} onClick={() => guardNavigation(() => importInput.current?.click(), c.nvImportWork)}><Icon name="upload" size={15} />{c.nvImport}</button>
        {current ? <><button type="button" className={s.tool} aria-label={c.nvExportTxt} title={c.nvExportTxt} disabled={busy} onClick={() => exportWork("txt")}><Icon name="fileText" size={16} /></button><button type="button" className={s.tool} aria-label={c.nvExportJson} title={c.nvExportJson} disabled={busy} onClick={() => exportWork("json")}><Icon name="braces" size={16} /></button><button type="button" className={`${s.tool} ${s.toolSave}`} aria-label={action === "save" ? c.nvSaving : c.nvSave} title={action === "save" ? c.nvSaving : c.nvSave} disabled={busy || (!dirty && current.baseVersion !== null)} onClick={() => void save()}><Icon name="check" size={16} /></button></>
          : <><button type="button" className={s.secondary} disabled={busy} onClick={() => create("story")}>{c.nvWriteStory}</button><button type="button" className={s.primary} disabled={busy} onClick={() => create("novel")}><Icon name="plus" size={16} />{c.nvStart}</button></>}
      </div>
    </header>
    <div className={s.messages}>
      <p className={s.help}>{c.nvImportHelp}</p>
      {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.notice} role="status">{notice}</p>}
      {storageError && <p className={s.error} role="alert">{c.nvStorageError}</p>}
      {conflict && current && <div className={s.recovery}><div><strong>{c.nvConflictTitle}</strong><p>{c.nvConflictBody}</p></div><button type="button" className={s.tool} aria-label={c.nvSaveAsNew} title={c.nvSaveAsNew} disabled={busy} onClick={() => void save(true)}><Icon name="copy" size={16} /></button><button type="button" className={s.quiet} disabled={busy} onClick={() => guardNavigation(() => { void open(current.draft.id); }, c.nvLoadCloud)}>{c.nvLoadCloud}</button></div>}
      {!current && recoveries.length > 0 && <section aria-label={c.nvRecovery}><p className={s.help}>{c.nvRecoveryHelp}</p>{recoveries.filter(entry => entry.accountId === userId).map((entry, index) => <div className={s.recovery} key={entry.storageKey} role="region" aria-label={xumengStudioFill(c.nvRecoveryLabel, { title: entry.draft.title || c.nvUntitled, time: stamp(entry.updatedAt), index: index + 1 })}><div><strong>{entry.draft.title || c.nvUntitled}</strong><p>{stamp(entry.updatedAt)} · {c.nvRecoveryCopy}</p></div><button type="button" className={s.secondary} disabled={busy} onClick={() => resumeRecovery(entry)}>{c.nvResume}</button><button type="button" className={s.quiet} disabled={busy} onClick={() => { try { download(`${filename(entry.draft.title, c.nvUntitled)}.json`, exportDzmmNovelJson(entry.draft), "application/json;charset=utf-8"); } catch (failure) { setError(errorText(failure, c.nvFailed)); } }}>{c.nvExportBackup}</button><button type="button" className={s.quiet} disabled={busy} onClick={() => setDialog({ type: "recovery", entry })}>{c.nvDropRecovery}</button></div>)}</section>}
    </div>
    {!current ? <section className={s.library} aria-label={c.nvLibrary}><div className={s.sectionHead}><h2>{c.nvMyWorks} <span>{works.length}</span></h2><button type="button" className={s.quiet} disabled={busy} onClick={() => void refresh()}><Icon name="refresh" size={14} />{action === "load" ? c.nvLoading : c.nvRefresh}</button></div>
      {action === "load" && !library ? <p className={s.loading} role="status">{c.nvLoadingWorks}</p> : !works.length ? <div className={s.empty}><Icon name="book" size={42} /><h2>{c.nvNoWorks}</h2><p>{c.nvNoWorksBody}</p><button type="button" className={s.primary} disabled={busy} onClick={() => create("novel")}>{c.nvFirstWork}</button><small>{c.nvImportSmall}</small></div>
        : <div className={s.workList}>{works.map(work => <button type="button" key={work.id} className={s.workRow} disabled={busy} onClick={() => guardNavigation(() => { void open(work.id); }, c.nvOpenOther)}><span className={s.bookMark}><Icon name="book" size={22} /></span><div><div className={s.workTitle}><h3>{work.title}</h3><span>{work.type === "novel" ? c.nvNovel : c.nvStory}</span></div><p>{work.synopsis || c.nvNoBlurb}</p><div className={s.workMeta}><span>{xumengStudioFill(c.nvChapterMeta, { chapters: work.chapterCount, words: work.wordCount.toLocaleString() })}</span><span>{stamp(work.updatedAt)}</span>{work.tags.length > 0 && <span>{work.tags.slice(0, 3).join(" · ")}</span>}</div></div><Icon name="chevron" size={18} /></button>)}</div>}
    </section> : <div className={s.workspace}>
      <aside className={s.sidebar} aria-label={c.nvCatalog}><p>{c.nvWork}</p><button type="button" className={section === "settings" ? s.active : ""} disabled={busy} onClick={() => setSection("settings")}><Icon name="sliders" size={16} />{c.nvSettings}</button><button type="button" className={section === "outline" ? s.active : ""} disabled={busy} onClick={() => setSection("outline")}><Icon name="sparkles" size={16} />{c.nvOutlineNav}</button><button type="button" className={section === "characters" ? s.active : ""} disabled={busy} onClick={() => setSection("characters")}><Icon name="users" size={16} />{c.nvPeople}{cast.length > 0 && <span className={s.castNavCount}>{cast.length}</span>}</button><button type="button" className={section === "read" ? `${s.tool} ${s.active}` : s.tool} aria-label={c.nvRead} title={c.nvRead} aria-pressed={section === "read"} disabled={busy} onClick={() => setSection("read")}><Icon name="book" size={16} /></button>
        <div className={s.chapterHead}><p>{c.nvChapters} <span>{current.draft.chapters.length}</span></p><button type="button" className={s.iconButton} aria-label={c.nvAddChapter} title={c.nvAddChapter} disabled={busy || current.draft.chapters.length >= 100} onClick={addChapter}><Icon name="plus" size={16} /></button></div>
        <ol className={s.chapterList}>{current.draft.chapters.map((item, index) => <li key={item.id} className={section === "chapter" && chapter?.id === item.id ? s.selectedChapter : ""}><button type="button" className={s.chapterLink} disabled={busy} onClick={() => selectChapter(item.id)}><span>{String(index + 1).padStart(2, "0")}</span><span>{item.title || c.nvUntitledChapter}</span></button><div className={s.chapterControls}><button type="button" aria-label={xumengStudioFill(c.nvMoveUp, { name: item.title || xumengStudioFill(c.nvChapterN, { n: index + 1 }) })} title={c.nvMoveUpTitle} disabled={busy || index === 0} onClick={() => moveChapter(item.id, -1)}>↑</button><button type="button" aria-label={xumengStudioFill(c.nvMoveDown, { name: item.title || xumengStudioFill(c.nvChapterN, { n: index + 1 }) })} title={c.nvMoveDownTitle} disabled={busy || index === current.draft.chapters.length - 1} onClick={() => moveChapter(item.id, 1)}>↓</button><button type="button" aria-label={xumengStudioFill(c.nvDeleteNamed, { name: item.title || xumengStudioFill(c.nvChapterN, { n: index + 1 }) })} title={c.nvDeleteChapterTitle} disabled={busy} onClick={() => setDialog({ type: "chapter", id: item.id })}><Icon name="close" size={12} /></button></div></li>)}</ol>
        {!current.draft.chapters.length && <p className={s.help}>{c.nvNoChapterYet}</p>}
      </aside>
      <section className={s.editor} aria-label={section === "read" ? c.nvReading : c.nvEditing}>
        {section === "settings" && <><div className={s.sectionHead}><div><p className={s.eyebrow}>{c.nvSettings}</p><h2>{c.nvNameStory}</h2></div><span className={s.privateLabel}>{c.nvPrivateWork}</span></div><div className={s.fields}><label className={s.field}><span>{c.nvWorkTitle} <small>{current.draft.title.length} / 120</small></span><input value={current.draft.title} maxLength={120} disabled={busy} placeholder={c.nvTitlePh} onChange={event => updateDraft(draft => ({ ...draft, title: event.target.value }))} /></label><label className={s.field}><span>{c.nvWorkType}</span><select value={current.draft.type} disabled={busy} onChange={event => updateDraft(draft => ({ ...draft, type: event.target.value as "novel" | "story" }))}><option value="novel">{c.nvTypeNovel}</option><option value="story">{c.nvTypeStory}</option></select></label><label className={s.field}><span>{c.nvSynopsis} <small>{current.draft.synopsis.length} / 4,000</small></span><textarea value={current.draft.synopsis} maxLength={4000} disabled={busy} rows={5} placeholder={c.nvSynopsisPh} onChange={event => updateDraft(draft => ({ ...draft, synopsis: event.target.value }))} /></label><label className={s.field}><span>{c.nvTags} <small>{c.nvTagsHint}</small></span><input value={tagText} disabled={busy} placeholder={c.nvTagsPh} onChange={event => { const value = event.target.value; setTagText(value); updateDraft(draft => ({ ...draft, tags: [...new Set(value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] })); }} /></label></div><div className={s.settingsEnd}><button type="button" className={s.primary} disabled={busy} onClick={() => setSection("outline")}>{c.nvNextOutline}<Icon name="chevron" size={14} /></button>{current.baseVersion !== null && <button type="button" className={`${s.tool} ${s.toolDanger}`} aria-label={c.nvDeleteWork} title={c.nvDeleteWork} disabled={busy} onClick={() => guardNavigation(() => setDialog({ type: "work" }), c.nvDeleteWork)}><Icon name="trash" size={16} /></button>}</div></>}
        {section === "outline" && <><div className={s.sectionHead}><div><p className={s.eyebrow}>{c.nvOutlineNav}</p><h2>{c.nvPlotHeading}</h2></div></div><label className={s.field}><span>{c.nvNotes} <small>{current.draft.notes.length} / 8,000</small></span><textarea value={current.draft.notes} maxLength={8000} disabled={busy} rows={5} placeholder={c.nvNotesPh} onChange={event => updateDraft(draft => ({ ...draft, notes: event.target.value }))} /></label><div className={s.aiToolbar}><label>{c.nvModel}<select aria-label={c.nvOutlineModel} disabled={busy} value={model} onChange={event => setModel(event.target.value as DzmmModelPreset)}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className={`${s.tool} ${s.toolGenerate}`} aria-label={c.nvGenerateOutline} title={c.nvGenerateOutline} disabled={busy} onClick={() => requestGenerate("outline")}><Icon name="sparkles" size={16} /></button><p>{c.nvPreviewFirst}</p></div><label className={s.field}><span>{c.nvOutline} <small>{current.draft.outline.length} / 20,000</small></span><textarea value={current.draft.outline} maxLength={20000} disabled={busy} rows={15} placeholder={c.nvOutlinePh} onChange={event => updateDraft(draft => ({ ...draft, outline: event.target.value }))} /></label><button type="button" className={s.primary} disabled={busy} onClick={() => { if (current.draft.chapters.length) { selectChapter(current.draft.chapters[0].id); } else addChapter(); }}>{c.nvStartBody}<Icon name="chevron" size={14} /></button></>}
        {section === "characters" && renderCharacters()}
        {section === "chapter" && (chapter ? <><div className={s.sectionHead}><div><p className={s.eyebrow}>{c.nvChapterBody}</p><h2>{chapter.title || c.nvUntitledChapter}</h2></div><span className={s.count}>{xumengStudioFill(c.nvWordCount, { count: countDzmmNovelWords(chapter.content).toLocaleString() })}</span></div><label className={s.field}><span>{c.nvChapterTitle}</span><input value={chapter.title} maxLength={120} disabled={busy} onChange={event => updateDraft(draft => ({ ...draft, chapters: draft.chapters.map(item => item.id === chapter.id ? { ...item, title: event.target.value } : item) }))} /></label><label className={`${s.field} ${s.manuscript}`}><span>{c.nvBody} <small>{chapter.content.length.toLocaleString()} / 50,000</small></span><textarea value={chapter.content} maxLength={50000} disabled={busy} rows={22} placeholder={c.nvBodyPh} onChange={event => updateDraft(draft => ({ ...draft, chapters: draft.chapters.map(item => item.id === chapter.id ? { ...item, content: event.target.value } : item) }))} /></label><div className={s.aiToolbar}><label>{c.nvModel}<select aria-label={c.nvModel} disabled={busy} value={model} onChange={event => setModel(event.target.value as DzmmModelPreset)}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className={`${s.tool} ${s.toolGenerate}`} aria-label={c.nvContinue} title={c.nvContinue} disabled={busy} onClick={() => requestGenerate("continue")}><Icon name="sparkles" size={16} /></button><p>{c.nvContinueHelp}</p></div></> : <div className={s.empty}><h2>{c.nvPickChapter}</h2><button type="button" className={s.primary} disabled={busy} onClick={addChapter}>{c.nvAddChapter}</button></div>)}
        {section === "read" && <article className={s.reading}><p className={s.eyebrow}>{c.nvReadingNow}</p><h2>{current.draft.title || c.nvUntitled}</h2>{dirty && <p className={s.readingNote}>{c.nvIncludesUnsaved}</p>}{current.draft.synopsis && <p className={s.synopsis}>{current.draft.synopsis}</p>}<nav aria-label={c.nvReadingNav}>{current.draft.chapters.map((item, index) => <a key={item.id} href={`#novel-reading-${item.id}`} onClick={event => { event.preventDefault(); document.getElementById(`novel-reading-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{item.title || xumengStudioFill(c.nvChapterN, { n: index + 1 })}</a>)}</nav>{current.draft.chapters.map((item, index) => <section key={item.id} id={`novel-reading-${item.id}`}><h3>{item.title || xumengStudioFill(c.nvChapterN, { n: index + 1 })}</h3><p>{item.content || c.nvEmptyChapter}</p></section>)}{!current.draft.chapters.length && <p className={s.help}>{c.nvNoChaptersRead}</p>}</article>}
        {currentPreview && <section id="novel-ai-preview" className={s.preview} aria-label={c.nvPreview}><div className={s.sectionHead}><div><p className={s.eyebrow}>{c.nvPreview}</p><h2>{currentPreview.operation === "outline" ? c.nvOutlineSuggest : c.nvContinueSuggest}</h2></div>{currentPreview.state === "running" ? <button type="button" className={s.secondary} onClick={() => controller.current?.abort()}><Icon name="stop" size={14} />{c.nvStop}</button> : <span className={s.count}>{currentPreview.state === "stopped" ? c.nvStopped : currentPreview.state === "failed" ? c.nvInterrupted : c.nvWaiting}</span>}</div><p className={s.help}>{orphanedPreview ? c.nvOrphan : <>{c.nvUnchanged}{currentPreview.operation === "outline" && current.draft.outline ? c.nvReplaceNote : c.nvCheckInsert}</>}</p><textarea aria-label={c.nvPreviewBody} value={currentPreview.text} readOnly rows={12} placeholder={c.nvGenerating} /><div className={s.previewActions}><button type="button" className={s.primary} disabled={busy || !currentPreview.text.trim()} onClick={insertPreview}>{currentPreview.operation === "outline" ? current.draft.outline ? c.nvReplaceOutline : c.nvInsertOutline : orphanedPreview ? c.nvInsertChapter : c.nvAppend}</button><button type="button" className={s.tool} aria-label={c.nvExportPreview} title={c.nvExportPreview} disabled={!currentPreview.text} onClick={() => download(`${filename(current.draft.title, c.nvUntitled)}-preview.txt`, currentPreview.text, "text/plain;charset=utf-8")}><Icon name="download" size={16} /></button><button type="button" className={`${s.tool} ${s.toolDanger}`} aria-label={c.nvDropPreview} title={c.nvDropPreview} disabled={busy} onClick={() => setDialog({ type: "preview", action: clearPreview, label: c.nvDropPreviewLabel })}><Icon name="trash" size={16} /></button></div></section>}
      </section>
    </div>}
    {dialog && <div className={s.overlay}><div className={s.dialog} ref={dialogElement} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="novel-confirm-title">
      <h2 id="novel-confirm-title">{dialog.type === "preview" ? c.nvDropPreviewQ : dialog.type === "leave" ? c.nvUnsavedQ : dialog.type === "perform" ? c.nvSaveFirstQ : dialog.type === "recovery" ? c.nvDropRecoveryQ : dialog.type === "character" ? c.nvDeletePersonQ : dialog.type === "chapter" ? c.nvDeleteChapterQ : c.nvDeleteWorkQ}</h2>
      <p>{dialog.type === "preview" ? c.nvPreviewKept : dialog.type === "leave" ? `${xumengStudioFill(c.nvLeaveBody, { action: dialog.label })}${currentPreview?.text ? c.nvLeavePreview : ""}` : dialog.type === "perform" ? xumengStudioFill(c.nvPerformBody, { action: dialog.request.target === "live" ? c.nvCallPerson : c.nvVoicePerson }) : dialog.type === "recovery" ? c.nvRecoveryBody : dialog.type === "character" ? c.nvPersonBody : dialog.type === "chapter" ? c.nvChapterBodyConfirm : c.nvWorkBody}</p>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.dialogActions}>{dialog.type === "preview" ? <>
        <button type="button" className={s.primary} disabled={busy} onClick={() => { if (dialog.type !== "preview") return; const pending = dialog; clearPreview(); setDialog(null); pending.action(); }}>{c.nvContinueAction}</button><button type="button" className={s.secondary} disabled={busy} onClick={() => setDialog(null)}>{c.nvKeepPreview}</button>
      </> : dialog.type === "leave" ? <>
        {current && <button type="button" className={s.primary} disabled={busy} onClick={() => void saveAndLeave()}>{action === "save" ? c.nvSaving : currentPreview?.text ? c.nvSaveOriginal : c.nvSaveContinue}</button>}<button type="button" className={s.secondary} disabled={busy} onClick={discardAndLeave}>{c.nvDiscard}</button><button type="button" className={s.quiet} disabled={busy} onClick={() => setDialog(null)}>{c.nvResume}</button>
      </> : dialog.type === "perform" ? <>
        <button type="button" className={s.primary} disabled={busy} onClick={() => void saveAndPerform()}>{action === "save" ? c.nvSaving : dialog.request.target === "live" ? c.nvSaveCall : c.nvSaveVoice}</button><button type="button" className={s.secondary} disabled={busy} onClick={() => setDialog(null)}>{c.nvResume}</button>
      </> : <>
        <button type="button" className={s.dangerButton} disabled={busy} onClick={() => void confirmDelete()}>{action === "delete" ? c.nvDeleting : dialog.type === "recovery" ? c.nvConfirmDrop : c.nvConfirmDelete}</button><button type="button" className={s.secondary} disabled={busy} onClick={() => setDialog(null)}>{c.nvCancel}</button>
      </>}</div>
    </div></div>}
  </main>;
}
