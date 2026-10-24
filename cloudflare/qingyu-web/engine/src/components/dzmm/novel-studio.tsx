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
import Icon from "./icons";
import { QINGYU_EXTERNAL_CALLS_ENABLED } from "../../lib/xumeng-feature-availability";
import { XUMENG_SPEECH_VOICES, XUMENG_LIVE_VOICE_OPTIONS, type XumengSpeechVoiceId } from "../../lib/xumeng-voices";
import s from "./novel-studio.module.css";
import { xumengImageUrl } from "../../lib/xumeng-routes";

export type NovelStudioProps = {
  onSaved?: (id: string) => void;
  onNavigate?: (id: string | null, type?: "novel" | "story") => void;
  initialId?: string; initialType?: "novel" | "story";
  userId?: string; isGuest: boolean; onRequireAccount: () => void; onBack?: () => void;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
  characters?: Character[]; onPerformCharacter?: (profile: XumengPerformanceCharacter, target: "live" | "voice") => void;
};
type Editor = Omit<DzmmNovelRecovery, "updatedAt">;
type Section = "settings" | "outline" | "characters" | "chapter" | "read";
type Action = "load" | "save" | "delete" | "import" | "generate";
type Preview = { accountId: string; workId: string; chapterId: string | null; operation: "outline" | "continue"; text: string; state: "running" | "ready" | "stopped" | "failed" };
type PerformanceRequest = { id: string; target: "live" | "voice"; includeContext: boolean; accountId: string; workId: string; generation: number };
type Dialog = { type: "leave" | "preview"; action: () => void; label: string } | { type: "chapter" | "character"; id: string }
  | { type: "perform"; request: PerformanceRequest } | { type: "work" } | { type: "recovery"; entry: DzmmNovelRecoveryEntry };
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，当前正文已保留。";
const date = (timestamp: number) => new Date(timestamp).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const filename = (title: string) => (title.trim() || "未命名作品").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
function characterImage(value: string) {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? xumengImageUrl(value) : null; }
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

export default function NovelStudio({ onSaved, onNavigate, initialId, initialType, userId, isGuest, onRequireAccount, onBack, onDirtyChange, onBusyChange, characters = [], onPerformCharacter }: NovelStudioProps) {
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
      .catch(failure => { if (valid() && !abort.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (valid()) { actionRef.current = null; setAction(null); } });
    return () => abort.abort();
  }, [userId, isGuest, initialId, initialType]);
  useEffect(() => {
    if (!userId || isGuest) return;
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("qingyu-novel-recovery")) syncRecoveries(userId);
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
      if (!latest) { syncRecoveries(entry.accountId); setNotice("这份恢复副本已更新或被放弃，请选择当前显示的版本。"); return; }
      copySources.current.delete(latest.draft.id);
      replaceEditor({ accountId: latest.accountId, draft: latest.draft, baseVersion: latest.baseVersion, selectedChapterId: latest.selectedChapterId }, true);
      callbacks.current.onNavigate?.(latest.baseVersion === null ? "new" : latest.draft.id, latest.draft.type);
      setNotice("已载入恢复稿。原恢复副本仍保留，需要时可单独放弃。");
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
      if (valid()) { setError(errorText(failure)); if (failure instanceof DzmmNovelClientError && failure.status === 409) setConflict(true); }
      return false;
    } finally { if (valid()) { actionRef.current = null; controller.current = null; setAction(null); callbacks.current.onBusyChange?.(false); } }
  }
  function create(type: "novel" | "story") {
    const accountId = activeAccount.current; if (!accountId || guestRef.current) { onRequireAccount(); return; }
    guardNavigation(() => {
      const draft = createDzmmNovelDraft(type);
      replaceEditor({ accountId, draft, baseVersion: null, selectedChapterId: draft.chapters[0]?.id ?? null }, true);
      callbacks.current.onNavigate?.("new", type);
    }, "创建新作品");
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
      const draft = { ...cloneDzmmNovelDraft(snapshot.draft), title: `${snapshot.draft.title.slice(0, 116)}（副本）` };
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
      setConflict(false); setNotice("私人作品已保存。"); saved = true; callbacks.current.onSaved?.(detail.work.id);
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
      if (file.size > 1_500_000) throw new Error("导入文件不能超过 1.5 MB。");
      const format = /\.json$/i.test(file.name) ? "json" : /\.txt$/i.test(file.name) ? "txt" : null;
      if (!format) throw new Error("请选择 TXT 故事或晴屿导出的 JSON 作品。");
      const draft = parseDzmmNovelImport(decodeDzmmNovelImportBytes(await file.arrayBuffer()), { format, filename: file.name });
      if (valid()) { replaceEditor({ accountId, draft, baseVersion: null, selectedChapterId: draft.chapters[0]?.id ?? null }, true); callbacks.current.onNavigate?.("new", draft.type); setNotice("已载入编辑器。保存后成为新的私人作品。"); }
    });
  }
  function exportWork(format: "json" | "txt") {
    const snapshot = editorRef.current; if (!snapshot || snapshot.accountId !== activeAccount.current) return;
    try {
      download(`${filename(snapshot.draft.title)}.${format}`, format === "json" ? exportDzmmNovelJson(snapshot.draft) : exportDzmmNovelText(snapshot.draft), format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8");
      setNotice("已导出当前稿件，包含尚未保存的修改。");
    } catch (failure) { setError(errorText(failure)); }
  }
  function addChapter() {
    if (!current || current.draft.chapters.length >= 100) return;
    const added = { id: crypto.randomUUID(), title: `第${current.draft.chapters.length + 1}章`, content: "" };
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
      id: crypto.randomUUID(), name: imported.name.trim() || "导入人物", avatar: imported.avatar,
      description: imported.description, personality: imported.personality, scenario: imported.scenario,
      dialogue: imported.dialogue, liveVoice: imported.liveVoice, speechVoice: imported.speechVoice ?? "melotts",
    } : { id: crypto.randomUUID(), name: `人物 ${(snapshot.draft.characters?.length ?? 0) + 1}`, avatar: "",
      description: "", personality: "", scenario: "", dialogue: "", liveVoice: "zh_female_liuchangnv_uranus_bigtts", speechVoice: "melotts" };
    updateDraft(draft => ({ ...draft, characters: [...(draft.characters ?? []), profile] }));
    setSelectedCharacterId(profile.id); setIncludeChapterContext(false); setSection("characters");
    if (card) { setImportCharacterId(""); setNotice("已复制角色卡的形象与人物设定。可在这部作品中独立修改。"); }
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
    } catch (failure) { setError(errorText(failure)); }
  }
  function requestPerformance(id: string, target: "live" | "voice") {
    const snapshot = editorRef.current;
    if (!snapshot || !callbacks.current.onPerformCharacter || snapshot.accountId !== activeAccount.current || guestRef.current || actionRef.current) return;
    if (previewRef.current?.text) {
      setError("请先把 AI 预览插入稿件，或手动放弃预览，再给人物打电话或生成语音。");
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
        setNotice("已放弃所选恢复版本。其他页面继续编辑后，新版本仍会显示。");
      } catch { setStorageError(true); setError("无法放弃这份恢复副本，内容仍保留。请先导出备份后重试。"); }
    } else if (dialog?.type === "character") {
      const id = dialog.id;
      if (actionRef.current || !editorRef.current) return;
      updateDraft(draft => ({ ...draft, characters: (draft.characters ?? []).filter(item => item.id !== id) }));
      setDialog(null); setIncludeChapterContext(false); setNotice("人物档案已移除，保存后生效。");
    } else if (dialog?.type === "chapter") {
      const id = dialog.id, snapshot = editorRef.current;
      if (snapshot && !actionRef.current) {
        const chapters = snapshot.draft.chapters.filter(item => item.id !== id);
        commit({ ...snapshot, draft: { ...snapshot.draft, chapters }, selectedChapterId: snapshot.selectedChapterId === id ? chapters[0]?.id ?? null : snapshot.selectedChapterId }, true);
        setIncludeChapterContext(false);
        const preservesPreview = previewRef.current?.chapterId === id && Boolean(previewRef.current.text);
        setDialog(null); setNotice(preservesPreview ? "章节已从草稿移除，保存后生效。AI 预览仍保留，可导出或插入新章节。" : "章节已从草稿移除，保存后生效。");
      }
    } else if (dialog?.type === "work") {
      const snapshot = editorRef.current; if (!snapshot || snapshot.baseVersion === null) return;
      const deletingRecovery = ownRecovery.current?.draft.id === snapshot.draft.id ? ownRecovery.current : null;
      await run("delete", async (accountId, signal, valid) => {
        await deleteDzmmNovel(accountId, snapshot.draft.id, snapshot.baseVersion!, signal);
        if (valid()) { forgetRecovery(deletingRecovery); editorRef.current = null; dirtyRef.current = false; setEditor(null); setDirty(false); clearPreview(); setDialog(null); setConflict(false); setNotice("私人作品已删除。");
          try { const value = await fetchDzmmNovels(accountId, signal); if (valid()) setLibrary(value); } catch { if (valid()) setLibrary(previous => previous ? { ...previous, works: previous.works.filter(item => item.id !== snapshot.draft.id) } : null); }
        }
      });
    }
  }
  async function generate(operation: "outline" | "continue") {
    const snapshot = editorRef.current; if (!snapshot || snapshot.accountId !== activeAccount.current) return;
    if (!snapshot.draft.title.trim()) { setSection("settings"); setError("请先填写作品标题，再开始 AI 创作。"); return; }
    const target = snapshot.draft.chapters.find(item => item.id === snapshot.selectedChapterId);
    if (operation === "continue" && !target) { setError("请先创建并选择一个章节。"); return; }
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
        if (valid()) { const value = previewRef.current!; const next = { ...value, state: "ready" as const }; previewRef.current = next; setPreview(next); if (!value.text.trim()) throw new Error("本次生成没有正文，原稿未改变。"); }
      } catch (failure) {
        if (valid() && previewRef.current) { const next = { ...previewRef.current, state: signal.aborted ? "stopped" as const : "failed" as const }; previewRef.current = next; setPreview(next);
          if (signal.aborted) { setNotice("已停止生成，收到的内容仍保留在预览中。"); return; }
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
      if (value.text.length > 20000) { setError("预览大纲超过 20,000 字，请复制后缩短，再填写到大纲中。"); return; }
      updateDraft(draft => ({ ...draft, outline: value.text })); setSection("outline");
    } else {
      const target = snapshot.draft.chapters.find(item => item.id === value.chapterId);
      if (!target) {
        if (snapshot.draft.chapters.length >= 100) { setError("作品已达到 100 章，预览仍保留。请先导出预览，或移除一个章节后重试。"); return; }
        if (value.text.length > 50000) { setError("预览超过 50,000 字，无法插入新章节。请先导出预览并拆分正文。"); return; }
        const added = { id: crypto.randomUUID(), title: `第${snapshot.draft.chapters.length + 1}章`, content: value.text };
        commit({ ...snapshot, selectedChapterId: added.id, draft: { ...snapshot.draft, chapters: [...snapshot.draft.chapters, added] } }, true);
      } else {
        const content = target.content + (target.content ? "\n\n" : "") + value.text;
        if (content.length > 50000) { setError("追加后章节超过 50,000 字。请复制预览内容并创建新章节。"); return; }
        updateDraft(draft => ({ ...draft, chapters: draft.chapters.map(item => item.id === target.id ? { ...item, content } : item) }));
        const next = editorRef.current!; commit({ ...next, selectedChapterId: target.id }, true);
      }
      setSection("chapter");
    }
    clearPreview(); setNotice("预览内容已加入稿件，请保存作品。");
  }
  function requestGenerate(operation: "outline" | "continue") {
    if (actionRef.current) return;
    if (previewRef.current?.text) setDialog({ type: "preview", action: () => { void generate(operation); }, label: "生成新的 AI 预览" });
    else void generate(operation);
  }
  function renderCharacters() {
    if (!current) return null;
    return <>
      <div className={s.sectionHead}><div><p className={s.eyebrow}>作品人物</p><h2>人物 <span>{cast.length} / 30</span></h2></div><button type="button" className={s.primary} disabled={busy || cast.length >= 30} onClick={() => addCharacter()}><Icon name="plus" size={15} />新建人物</button></div>
      <p className={s.help}>人物档案随作品保存。可以手动填写，也可以复制已有角色卡的设定。</p>
      {characters.length > 0 && <div className={s.castImport}><label htmlFor="novel-import-character">从角色卡导入<select id="novel-import-character" value={importCharacterId} disabled={busy || cast.length >= 30} onChange={event => setImportCharacterId(event.target.value)}><option value="">选择已有角色卡</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}{item.author ? ` · ${item.author}` : ""}</option>)}</select></label><button type="button" className={s.secondary} disabled={busy || cast.length >= 30 || !characters.some(item => item.id === importCharacterId)} onClick={() => { const card = characters.find(item => item.id === importCharacterId); if (card) addCharacter(card); }}><Icon name="upload" size={15} />导入人物</button></div>}
      {cast.length >= 30 && <p className={s.help}>已达到 30 位人物。移除一位后可以继续添加。</p>}
      {selectedCharacter ? <div className={s.castWorkspace}>
        <nav className={s.castList} aria-label="作品人物列表">{cast.map(item => <button key={item.id} type="button" className={item.id === selectedCharacter.id ? s.selectedCharacter : ""} aria-pressed={item.id === selectedCharacter.id} disabled={busy} onClick={() => selectCharacter(item.id)}><CharacterAvatar profile={item} /><span><strong>{item.name || "未命名人物"}</strong><small>{item.description || "尚未填写人物描述"}</small></span></button>)}</nav>
        <div className={s.castInspector}>
          <div className={s.castIdentity}><CharacterAvatar profile={selectedCharacter} large /><div><p className={s.eyebrow}>人物档案</p><h3>{selectedCharacter.name || "未命名人物"}</h3></div><div className={s.castTools}><button type="button" className={s.iconButton} aria-label="复制当前人物" title="复制人物" disabled={busy || cast.length >= 30} onClick={() => addCharacter(undefined, selectedCharacter)}><Icon name="copy" size={16} /></button><button type="button" className={s.iconButton} aria-label="删除当前人物" title="删除人物" disabled={busy} onClick={() => setDialog({ type: "character", id: selectedCharacter.id })}><Icon name="close" size={16} /></button></div></div>
          <label className={s.field}><span>姓名 <small>{selectedCharacter.name.length} / 120</small></span><input value={selectedCharacter.name} maxLength={120} disabled={busy} placeholder="人物姓名" onChange={event => updateCharacter(selectedCharacter.id, "name", event.target.value)} /></label>
          <label className={s.field}><span>形象图片 <small>选填</small></span><input value={selectedCharacter.avatar} maxLength={2048} disabled={busy} placeholder="HTTPS 图片地址或本站图片路径" onChange={event => updateCharacter(selectedCharacter.id, "avatar", event.target.value)} /><em>导入角色卡会带入封面，也可以填写自己的图片地址。</em></label>
          <label className={s.field}><span>人物描述 <small>{selectedCharacter.description.length} / 2,000</small></span><textarea value={selectedCharacter.description} maxLength={2000} disabled={busy} rows={4} placeholder="身份、背景、外貌，以及人物当前的目标。" onChange={event => updateCharacter(selectedCharacter.id, "description", event.target.value)} /></label>
          <label className={s.field}><span>性格与表达 <small>{selectedCharacter.personality.length} / 2,000</small></span><textarea value={selectedCharacter.personality} maxLength={2000} disabled={busy} rows={4} placeholder="人物如何待人、面对冲突、表达情绪？有什么说话习惯？" onChange={event => updateCharacter(selectedCharacter.id, "personality", event.target.value)} /></label>
          <label className={s.field}><span>初始场景 <small>{selectedCharacter.scenario.length} / 2,000</small></span><textarea value={selectedCharacter.scenario} maxLength={2000} disabled={busy} rows={4} placeholder="人物在哪里？正面对什么处境？与观众从什么关系开始？" onChange={event => updateCharacter(selectedCharacter.id, "scenario", event.target.value)} /></label>
          <label className={s.field}><span>台词示例 <small>{selectedCharacter.dialogue.length} / 2,000</small></span><textarea value={selectedCharacter.dialogue} maxLength={2000} disabled={busy} rows={5} placeholder="写下能体现人物口吻的台词，也可以作为生成语音的起点。" onChange={event => updateCharacter(selectedCharacter.id, "dialogue", event.target.value)} /></label>
          <label className={s.field}><span>通话音色</span><select aria-label="人物通话音色" value={selectedCharacter.liveVoice} disabled={busy} onChange={event => updateCharacter(selectedCharacter.id, "liveVoice", event.target.value as XumengLiveVoice)}>{["默认", "女声", "男声"].map(group => <optgroup key={group} label={group}>{XUMENG_LIVE_VOICE_OPTIONS.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
          <label className={s.field}><span>朗读音色</span><select aria-label="人物朗读音色" value={selectedCharacter.speechVoice ?? "melotts"} disabled={busy} onChange={event => updateCharacter(selectedCharacter.id, "speechVoice", event.target.value as XumengSpeechVoiceId)}>{["默认", "女声", "男声"].map(group => <optgroup key={group} label={group}>{XUMENG_SPEECH_VOICES.filter(voice => voice.group === group).map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</optgroup>)}</select></label>
          {onPerformCharacter && <div className={s.castHandoff}><p className={s.help}>用这位人物的设定生成角色语音。</p><label className={s.castContext}><input type="checkbox" checked={includeChapterContext && Boolean(chapter?.content.trim())} disabled={busy || !chapter?.content.trim()} onChange={event => setIncludeChapterContext(event.target.checked)} /><span>{chapter?.content.trim() ? <>附带「{chapter.title || "当前章节"}」章末最多 2,000 字作为剧情参考</> : "选择有正文的章节后，可附带章末剧情参考"}</span></label><div className={s.castHandoffActions}>{QINGYU_EXTERNAL_CALLS_ENABLED && <button type="button" className={s.primary} disabled={busy} onClick={() => requestPerformance(selectedCharacter.id, "live")}><Icon name="video" size={16} />打电话</button>}<button type="button" className={s.secondary} disabled={busy} onClick={() => requestPerformance(selectedCharacter.id, "voice")}><Icon name="volume" size={16} />生成语音</button></div></div>}
        </div>
      </div> : <section className={s.castEmpty}><Icon name="users" size={30} /><h3>还没有人物档案</h3><p>新建人物，或从已有角色卡导入。</p><button type="button" className={s.secondary} disabled={busy} onClick={() => addCharacter()}><Icon name="plus" size={15} />添加第一位人物</button></section>}
    </>;
  }

  if (!userId || isGuest) return <main className={s.studio}><header className={s.header}><div><p className={s.eyebrow}>晴屿 · 私人创作</p><h1>小说工作台</h1></div>{onBack && <button type="button" className={s.quiet} onClick={onBack}>返回创作中心</button>}</header><section className={s.empty}><Icon name="book" size={42} /><h2>把你的故事写成作品</h2><p>登录后保存小说、章节和大纲，随时回来继续写。</p><button type="button" className={s.primary} onClick={onRequireAccount}>注册或登录</button></section></main>;
  return <main className={s.studio} aria-label="小说私人工作台">
    <input ref={importInput} type="file" accept=".txt,.json,text/plain,application/json" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importFile(file); }} />
    <header className={s.header}>
      <div className={s.heading}>{(current || onBack) && <button type="button" className={s.back} disabled={busy} aria-label={current ? "返回作品列表" : "返回创作中心"} onClick={() => guardNavigation(current ? libraryView : () => onBack?.(), current ? "返回作品列表" : "返回创作中心")}><Icon name="back" size={20} /></button>}
        <div><p className={s.eyebrow}>晴屿 · 私人创作</p><h1>{current ? current.draft.title || "未命名作品" : "小说工作台"}</h1><p className={s.status} role="status">{current ? `${action === "save" ? "正在保存…" : dirty ? "有未保存的修改" : "已保存"} · ${totalWords.toLocaleString()} 字${current.baseVersion === null ? " · 新作品" : ` · v${current.baseVersion}`}` : "仅自己可见 · 小说与故事"}</p></div>
      </div>
      <div className={s.headerActions}><button type="button" className={s.quiet} disabled={busy} onClick={() => guardNavigation(() => importInput.current?.click(), "导入新作品")}><Icon name="upload" size={15} />导入</button>
        {current ? <><button type="button" className={s.secondary} disabled={busy} onClick={() => exportWork("txt")}>导出 TXT</button><button type="button" className={s.secondary} disabled={busy} onClick={() => exportWork("json")}>导出 JSON</button><button type="button" className={s.primary} disabled={busy || (!dirty && current.baseVersion !== null)} onClick={() => void save()}><Icon name="check" size={16} />{action === "save" ? "正在保存…" : "保存作品"}</button></>
          : <><button type="button" className={s.secondary} disabled={busy} onClick={() => create("story")}>创作故事</button><button type="button" className={s.primary} disabled={busy} onClick={() => create("novel")}><Icon name="plus" size={16} />开始创作</button></>}
      </div>
    </header>
    <div className={s.messages}>
      <p className={s.help}>导入支持 UTF-8 编码的 TXT 或晴屿 JSON，每个文件不超过 1.5 MB。</p>
      {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.notice} role="status">{notice}</p>}
      {storageError && <p className={s.error} role="alert">浏览器无法保存恢复副本，请及时导出 JSON 备份。</p>}
      {conflict && current && <div className={s.recovery}><div><strong>当前稿件已保留</strong><p>云端版本已改变。可先导出备份，或将当前稿件另存为新作品。</p></div><button type="button" className={s.secondary} disabled={busy} onClick={() => void save(true)}>另存为新作品</button><button type="button" className={s.quiet} disabled={busy} onClick={() => guardNavigation(() => { void open(current.draft.id); }, "加载云端版本")}>加载云端版本</button></div>}
      {!current && recoveries.length > 0 && <section aria-label="小说恢复副本"><p className={s.help}>恢复副本分别保留。继续编辑会载入一份独立稿件；原副本可单独导出或放弃。</p>{recoveries.filter(entry => entry.accountId === userId).map((entry, index) => <div className={s.recovery} key={entry.storageKey} role="region" aria-label={`恢复草稿：${entry.draft.title || "未命名作品"}（${date(entry.updatedAt)}，${index + 1}）`}><div><strong>{entry.draft.title || "未命名作品"}</strong><p>{date(entry.updatedAt)} · 恢复副本</p></div><button type="button" className={s.secondary} disabled={busy} onClick={() => resumeRecovery(entry)}>继续编辑</button><button type="button" className={s.quiet} disabled={busy} onClick={() => { try { download(`${filename(entry.draft.title)}.json`, exportDzmmNovelJson(entry.draft), "application/json;charset=utf-8"); } catch (failure) { setError(errorText(failure)); } }}>导出备份</button><button type="button" className={s.quiet} disabled={busy} onClick={() => setDialog({ type: "recovery", entry })}>放弃此恢复版本</button></div>)}</section>}
    </div>
    {!current ? <section className={s.library} aria-label="我的私人作品"><div className={s.sectionHead}><h2>我的作品 <span>{works.length}</span></h2><button type="button" className={s.quiet} disabled={busy} onClick={() => void refresh()}><Icon name="refresh" size={14} />{action === "load" ? "加载中…" : "刷新"}</button></div>
      {action === "load" && !library ? <p className={s.loading} role="status">正在加载私人作品…</p> : !works.length ? <div className={s.empty}><Icon name="book" size={42} /><h2>还没有作品</h2><p>先写一个故事，或从章节开始一部小说。</p><button type="button" className={s.primary} disabled={busy} onClick={() => create("novel")}>创建第一部作品</button><small>也可以导入 TXT 或晴屿 JSON 备份。</small></div>
        : <div className={s.workList}>{works.map(work => <button type="button" key={work.id} className={s.workRow} disabled={busy} onClick={() => guardNavigation(() => { void open(work.id); }, "打开其他作品")}><span className={s.bookMark}><Icon name="book" size={22} /></span><div><div className={s.workTitle}><h3>{work.title}</h3><span>{work.type === "novel" ? "小说" : "故事"}</span></div><p>{work.synopsis || "尚未填写简介"}</p><div className={s.workMeta}><span>{work.chapterCount} 章 · {work.wordCount.toLocaleString()} 字</span><span>{date(work.updatedAt)}</span>{work.tags.length > 0 && <span>{work.tags.slice(0, 3).join(" · ")}</span>}</div></div><Icon name="chevron" size={18} /></button>)}</div>}
    </section> : <div className={s.workspace}>
      <aside className={s.sidebar} aria-label="作品目录"><p>作品</p><button type="button" className={section === "settings" ? s.active : ""} disabled={busy} onClick={() => setSection("settings")}><Icon name="sliders" size={16} />作品设置</button><button type="button" className={section === "outline" ? s.active : ""} disabled={busy} onClick={() => setSection("outline")}><Icon name="sparkles" size={16} />大纲与创作指令</button><button type="button" className={section === "characters" ? s.active : ""} disabled={busy} onClick={() => setSection("characters")}><Icon name="users" size={16} />人物{cast.length > 0 && <span className={s.castNavCount}>{cast.length}</span>}</button><button type="button" className={section === "read" ? s.active : ""} disabled={busy} onClick={() => setSection("read")}><Icon name="book" size={16} />阅读作品</button>
        <div className={s.chapterHead}><p>章节 <span>{current.draft.chapters.length}</span></p><button type="button" className={s.iconButton} aria-label="添加章节" title="添加章节" disabled={busy || current.draft.chapters.length >= 100} onClick={addChapter}><Icon name="plus" size={16} /></button></div>
        <ol className={s.chapterList}>{current.draft.chapters.map((item, index) => <li key={item.id} className={section === "chapter" && chapter?.id === item.id ? s.selectedChapter : ""}><button type="button" className={s.chapterLink} disabled={busy} onClick={() => selectChapter(item.id)}><span>{String(index + 1).padStart(2, "0")}</span><span>{item.title || "未命名章节"}</span></button><div className={s.chapterControls}><button type="button" aria-label={`上移${item.title || `第${index + 1}章`}`} title="上移章节" disabled={busy || index === 0} onClick={() => moveChapter(item.id, -1)}>↑</button><button type="button" aria-label={`下移${item.title || `第${index + 1}章`}`} title="下移章节" disabled={busy || index === current.draft.chapters.length - 1} onClick={() => moveChapter(item.id, 1)}>↓</button><button type="button" aria-label={`删除${item.title || `第${index + 1}章`}`} title="删除章节" disabled={busy} onClick={() => setDialog({ type: "chapter", id: item.id })}><Icon name="close" size={12} /></button></div></li>)}</ol>
        {!current.draft.chapters.length && <p className={s.help}>尚无章节，点击 + 开始写。</p>}
      </aside>
      <section className={s.editor} aria-label={section === "read" ? "作品阅读" : "作品编辑"}>
        {section === "settings" && <><div className={s.sectionHead}><div><p className={s.eyebrow}>作品设置</p><h2>给故事一个名字</h2></div><span className={s.privateLabel}>私人作品</span></div><div className={s.fields}><label className={s.field}><span>作品标题 <small>{current.draft.title.length} / 120</small></span><input value={current.draft.title} maxLength={120} disabled={busy} placeholder="输入作品标题" onChange={event => updateDraft(draft => ({ ...draft, title: event.target.value }))} /></label><label className={s.field}><span>作品类型</span><select value={current.draft.type} disabled={busy} onChange={event => updateDraft(draft => ({ ...draft, type: event.target.value as "novel" | "story" }))}><option value="novel">小说 · 按章节创作</option><option value="story">故事 · 短篇或片段</option></select></label><label className={s.field}><span>作品简介 <small>{current.draft.synopsis.length} / 4,000</small></span><textarea value={current.draft.synopsis} maxLength={4000} disabled={busy} rows={5} placeholder="故事发生在哪里？主角要面对什么？" onChange={event => updateDraft(draft => ({ ...draft, synopsis: event.target.value }))} /></label><label className={s.field}><span>标签 <small>最多 20 个，每个 40 字</small></span><input value={tagText} disabled={busy} placeholder="用逗号分隔，例如：悬疑，成长，奇幻" onChange={event => { const value = event.target.value; setTagText(value); updateDraft(draft => ({ ...draft, tags: [...new Set(value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] })); }} /></label></div><div className={s.settingsEnd}><button type="button" className={s.primary} disabled={busy} onClick={() => setSection("outline")}>完善大纲与指令<Icon name="chevron" size={14} /></button>{current.baseVersion !== null && <button type="button" className={s.danger} disabled={busy} onClick={() => guardNavigation(() => setDialog({ type: "work" }), "删除作品")}>删除作品</button>}</div></>}
        {section === "outline" && <><div className={s.sectionHead}><div><p className={s.eyebrow}>大纲与创作指令</p><h2>安排故事的走向</h2></div></div><label className={s.field}><span>创作指令 <small>{current.draft.notes.length} / 8,000</small></span><textarea value={current.draft.notes} maxLength={8000} disabled={busy} rows={5} placeholder="记录视角、节奏、人物目标、世界规则和写作要求。" onChange={event => updateDraft(draft => ({ ...draft, notes: event.target.value }))} /></label><div className={s.aiToolbar}><label>创作模型<select aria-label="小说大纲模型" disabled={busy} value={model} onChange={event => setModel(event.target.value as DzmmModelPreset)}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className={s.secondary} disabled={busy} onClick={() => requestGenerate("outline")}><Icon name="sparkles" size={15} />AI 生成大纲</button><p>生成按实际用量扣除 Credit，结果先显示预览。</p></div><label className={s.field}><span>作品大纲 <small>{current.draft.outline.length} / 20,000</small></span><textarea value={current.draft.outline} maxLength={20000} disabled={busy} rows={15} placeholder="世界观、角色、关键情节和章节安排。也可以先生成一个大纲，再由你修改。" onChange={event => updateDraft(draft => ({ ...draft, outline: event.target.value }))} /></label><button type="button" className={s.primary} disabled={busy} onClick={() => { if (current.draft.chapters.length) { selectChapter(current.draft.chapters[0].id); } else addChapter(); }}>开始写正文<Icon name="chevron" size={14} /></button></>}
        {section === "characters" && renderCharacters()}
        {section === "chapter" && (chapter ? <><div className={s.sectionHead}><div><p className={s.eyebrow}>章节正文</p><h2>{chapter.title || "未命名章节"}</h2></div><span className={s.count}>{countDzmmNovelWords(chapter.content).toLocaleString()} 字</span></div><label className={s.field}><span>章节标题</span><input value={chapter.title} maxLength={120} disabled={busy} onChange={event => updateDraft(draft => ({ ...draft, chapters: draft.chapters.map(item => item.id === chapter.id ? { ...item, title: event.target.value } : item) }))} /></label><label className={`${s.field} ${s.manuscript}`}><span>正文 <small>{chapter.content.length.toLocaleString()} / 50,000</small></span><textarea value={chapter.content} maxLength={50000} disabled={busy} rows={22} placeholder="从第一句话开始。" onChange={event => updateDraft(draft => ({ ...draft, chapters: draft.chapters.map(item => item.id === chapter.id ? { ...item, content: event.target.value } : item) }))} /></label><div className={s.aiToolbar}><label>创作模型<select aria-label="小说章节模型" disabled={busy} value={model} onChange={event => setModel(event.target.value as DzmmModelPreset)}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className={s.secondary} disabled={busy} onClick={() => requestGenerate("continue")}><Icon name="sparkles" size={15} />AI 续写当前章节</button><p>续写参考大纲和创作指令、当前章末 12,000 字，以及前两章各末 3,000 字。先预览，再插入。</p></div></> : <div className={s.empty}><h2>选择或创建一个章节</h2><button type="button" className={s.primary} disabled={busy} onClick={addChapter}>添加章节</button></div>)}
        {section === "read" && <article className={s.reading}><p className={s.eyebrow}>阅读作品 · 当前稿件</p><h2>{current.draft.title || "未命名作品"}</h2>{dirty && <p className={s.readingNote}>包含尚未保存的修改。</p>}{current.draft.synopsis && <p className={s.synopsis}>{current.draft.synopsis}</p>}<nav aria-label="阅读章节目录">{current.draft.chapters.map((item, index) => <a key={item.id} href={`#novel-reading-${item.id}`} onClick={event => { event.preventDefault(); document.getElementById(`novel-reading-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{item.title || `第${index + 1}章`}</a>)}</nav>{current.draft.chapters.map((item, index) => <section key={item.id} id={`novel-reading-${item.id}`}><h3>{item.title || `第${index + 1}章`}</h3><p>{item.content || "这一章还没有正文。"}</p></section>)}{!current.draft.chapters.length && <p className={s.help}>尚未添加章节。</p>}</article>}
        {currentPreview && <section id="novel-ai-preview" className={s.preview} aria-label="AI 创作预览"><div className={s.sectionHead}><div><p className={s.eyebrow}>AI 创作预览</p><h2>{currentPreview.operation === "outline" ? "大纲建议" : "续写建议"}</h2></div>{currentPreview.state === "running" ? <button type="button" className={s.secondary} onClick={() => controller.current?.abort()}><Icon name="stop" size={14} />停止生成</button> : <span className={s.count}>{currentPreview.state === "stopped" ? "已停止" : currentPreview.state === "failed" ? "生成中断" : "等待插入"}</span>}</div><p className={s.help}>{orphanedPreview ? "原章节已删除，AI 预览仍保留。可导出预览，或插入为新章节。" : <>原稿尚未改变。{currentPreview.operation === "outline" && current.draft.outline ? "点击替换会更新当前大纲。" : "你可以检查、复制，再决定是否插入。"}</>}</p><textarea aria-label="AI 预览正文" value={currentPreview.text} readOnly rows={12} placeholder="正在生成…" /><div className={s.previewActions}><button type="button" className={s.primary} disabled={busy || !currentPreview.text.trim()} onClick={insertPreview}>{currentPreview.operation === "outline" ? current.draft.outline ? "替换当前大纲" : "插入大纲" : orphanedPreview ? "插入新章节" : "追加到原章节"}</button><button type="button" className={s.secondary} disabled={!currentPreview.text} onClick={() => download(`${filename(current.draft.title)}-AI预览.txt`, currentPreview.text, "text/plain;charset=utf-8")}>导出预览</button><button type="button" className={s.quiet} disabled={busy} onClick={() => setDialog({ type: "preview", action: clearPreview, label: "放弃 AI 预览" })}>放弃预览</button></div></section>}
      </section>
    </div>}
    {dialog && <div className={s.overlay}><div className={s.dialog} ref={dialogElement} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="novel-confirm-title">
      <h2 id="novel-confirm-title">{dialog.type === "preview" ? "放弃当前 AI 预览？" : dialog.type === "leave" ? "有未保存的内容" : dialog.type === "perform" ? "先保存人物与作品" : dialog.type === "recovery" ? "放弃这份恢复副本？" : dialog.type === "character" ? "删除这个人物？" : dialog.type === "chapter" ? "删除这个章节？" : "删除这部私人作品？"}</h2>
      <p>{dialog.type === "preview" ? "已编辑的稿件会保留。继续操作将放弃当前预览内容。" : dialog.type === "leave" ? `保存作品后再${dialog.label}，或放弃本次未保存的内容。${currentPreview?.text ? "AI 预览尚未插入，继续操作会放弃预览。" : ""}` : dialog.type === "perform" ? `作品有未保存的修改。保存成功后，再${dialog.request.target === "live" ? "给所选人物打电话" : "带所选人物到语音工作台"}。` : dialog.type === "recovery" ? "只放弃所选恢复版本。其他作品和其他页面的修改会保留；来源继续编辑后，新版本仍可恢复。" : dialog.type === "character" ? "人物档案会从当前草稿移除，章节正文会保留，保存后生效。" : dialog.type === "chapter" ? "正文会从当前草稿移除，保存后生效。未插入的 AI 预览会保留。" : "作品及所有章节将一并删除，请先导出需要保留的内容。"}</p>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.dialogActions}>{dialog.type === "preview" ? <>
        <button type="button" className={s.primary} disabled={busy} onClick={() => { if (dialog.type !== "preview") return; const pending = dialog; clearPreview(); setDialog(null); pending.action(); }}>继续操作</button><button type="button" className={s.secondary} disabled={busy} onClick={() => setDialog(null)}>保留预览</button>
      </> : dialog.type === "leave" ? <>
        {current && <button type="button" className={s.primary} disabled={busy} onClick={() => void saveAndLeave()}>{action === "save" ? "正在保存…" : currentPreview?.text ? "保存原稿并继续" : "保存并继续"}</button>}<button type="button" className={s.secondary} disabled={busy} onClick={discardAndLeave}>放弃未保存内容</button><button type="button" className={s.quiet} disabled={busy} onClick={() => setDialog(null)}>继续编辑</button>
      </> : dialog.type === "perform" ? <>
        <button type="button" className={s.primary} disabled={busy} onClick={() => void saveAndPerform()}>{action === "save" ? "正在保存…" : dialog.request.target === "live" ? "保存并打电话" : "保存并生成语音"}</button><button type="button" className={s.secondary} disabled={busy} onClick={() => setDialog(null)}>继续编辑</button>
      </> : <>
        <button type="button" className={s.dangerButton} disabled={busy} onClick={() => void confirmDelete()}>{action === "delete" ? "正在删除…" : dialog.type === "recovery" ? "确认放弃恢复版本" : "确认删除"}</button><button type="button" className={s.secondary} disabled={busy} onClick={() => setDialog(null)}>取消</button>
      </>}</div>
    </div></div>}
  </main>;
}
