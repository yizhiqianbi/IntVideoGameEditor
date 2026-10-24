"use client";

/* eslint-disable @next/next/no-img-element -- Local and account-owned images are shared with the Vite frontend. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_DZMM_CHARACTER_COVER, parseCharacterImport, parsePrivateCharacter, parseCharacterDraftImport, decodeDzmmCharacterImportBytes, exportCharacterJson, exportCharacterDraftJson, type Character } from "../../lib/dzmm-characters";
import { DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH, parseDzmmImageUrl, type DzmmCharacterBook, type DzmmCharacterBookEntry, type DzmmCharacterContext } from "../../lib/dzmm-character-context";
import { uploadDzmmCover } from "../../lib/dzmm-cloud";
import { authoringEntryToBookEntry, compileDzmmPrivateWorldBook, omitBlankDzmmBookDraftEntries, type DzmmCharacterAuthoringDraft } from "../../lib/dzmm-character-draft";
import { analyzeDzmmAuthoringReview } from "../../lib/dzmm-authoring-review";
import { xumengImageUrl } from "../../lib/xumeng-routes";
import { applyDzmmReaderNames } from "@/lib/dzmm-character-presentation";
import CharacterIntroduction from "./character-introduction";
import Icon from "./icons";
import styles from "./character-studio.module.css";

export type CharacterStudioProps = {
  character: Character | null;
  nickname: string;
  user: { id: string; isGuest: boolean } | null;
  onClose: () => void;
  onSave: (character: Character) => Promise<void> | void;
  onRetrySave?: (character: Character) => Promise<void>;
  onTest: (character: Character, openingIndex?: number) => Promise<void> | void;
  onSubmit: (character: Character) => Promise<void>;
  onLoadCloud?: () => Promise<void>;
  onRequireAccount?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  submission?: { status: "pending" | "approved" | "rejected" | "withdrawn"; reason?: string } | null;
};
type Step = "identity" | "opening" | "book" | "voice" | "preview";
type MessageDraft = { key: string; role: "user" | "assistant"; content: string };
type TextDraft = { key: string; value: string };
type EntryDraft = { key: string; entry: DzmmCharacterBookEntry; keysText: string; secondaryText: string };
type Draft = {
  name: string; cover: string; tags: string; introduction: string; creatorNotes: string; description: string; personality: string;
  scenario: string; firstMessage: string; systemPrompt: string; postHistoryInstructions: string; messageExamples: string;
  messages: MessageDraft[]; greetings: TextDraft[]; replies: TextDraft[]; gallery: TextDraft[];
  book: Omit<DzmmCharacterBook, "entries"> | null; entries: EntryDraft[];
};
type ExtendedCharacter = Character & DzmmCharacterContext & { gallery?: string[]; introduction?: string; suggestedReplies?: string[] };
type ImportCandidate = { card: Character; scope: string };
const STEPS: { id: Step; name: string }[] = [{ id: "identity", name: "核心身份" }, { id: "opening", name: "开场对话" }, { id: "book", name: "世界书" }, { id: "voice", name: "声优设置" }, { id: "preview", name: "预览发布" }];
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const split = (value: string) => [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];
const withKey = (value: string): TextDraft => ({ key: uid(), value });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试。";
const previewImage = (value: string) => { try { return xumengImageUrl(parseDzmmImageUrl(value)); } catch { return null; } };
function createDraft(character: Character | null): Draft {
  const card = character as ExtendedCharacter | null;
  const book = card?.authoringDraft?.characterBook ?? card?.characterBook;
  const messages = card?.openingMessages?.length ? card.openingMessages : card?.firstMessage ? [{ role: "assistant" as const, content: card.firstMessage }] : [{ role: "assistant" as const, content: "" }];
  return {
    name: card?.name ?? "", cover: card?.cover === DEFAULT_DZMM_CHARACTER_COVER ? "" : card?.cover ?? "", tags: card?.tags.join("，") ?? "一般向",
    introduction: card?.introduction ?? "", creatorNotes: card?.creatorNotes ?? "", description: card?.description ?? "", personality: card?.personality ?? "", scenario: card?.scenario ?? "", firstMessage: card?.firstMessage ?? "",
    systemPrompt: card?.systemPrompt ?? "", postHistoryInstructions: card?.postHistoryInstructions ?? "", messageExamples: card?.messageExamples ?? "",
    messages: messages.map((message) => ({ ...message, key: uid() })), greetings: (card?.alternateGreetings ?? []).map(withKey),
    replies: (card?.suggestedReplies ?? []).map(withKey), gallery: (card?.gallery ?? []).map(withKey),
    book: book ? { name: book.name, description: book.description, scanDepth: book.scanDepth } : null,
    entries: card?.authoringDraft
      ? card.authoringDraft.characterBook.entries.map(entry => ({ key: uid(), entry: authoringEntryToBookEntry(entry), keysText: entry.keysText, secondaryText: entry.secondaryText }))
      : (card?.characterBook?.entries ?? []).map((entry) => ({ key: uid(), entry: { ...entry }, keysText: entry.keys.join("，"), secondaryText: (entry.secondaryKeys ?? []).join("，") })),
  };
}
function Field({ title, hint, count, children }: { title: string; hint?: string; count?: string; children: ReactNode }) {
  return <label className={styles.field}><span>{title}{count && <small>{count}</small>}</span>{children}{hint && <em>{hint}</em>}</label>;
}
function transfer<T>(items: T[], index: number, change: number) {
  const target = index + change;
  if (target < 0 || target >= items.length) return items;
  const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next;
}
function readiness(draft: Draft): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("填写角色名称。");
  if (!draft.messages.some((message) => message.role === "assistant" && message.content.trim())) issues.push("主开场至少需要一条角色消息。");
  if (![draft.description, draft.personality, draft.scenario, draft.systemPrompt].some((value) => value.trim())) issues.push("详细描述、性格、场景或系统指令至少填写一项。");
  if (draft.messages.length > 1) draft.messages.forEach((message, position) => { if (!message.content.trim()) issues.push(`填写或移除第 ${position + 1} 条开场消息。`); });
  draft.greetings.forEach((greeting, position) => { if (!greeting.value.trim()) issues.push(`填写或移除备选开场 ${position + 1}。`); });
  if (draft.book?.scanDepth !== undefined && (!Number.isInteger(draft.book.scanDepth) || draft.book.scanDepth < 1 || draft.book.scanDepth > 40)) issues.push("世界书扫描范围需要为 1–40 条消息。");
  draft.entries.forEach((item, position) => {
    const title = item.entry.name || `词条 ${position + 1}`;
    if (!item.entry.content.trim()) issues.push(`${title}：填写词条内容，或删除空词条。`);
    const keys = split(item.keysText), secondaryKeys = split(item.secondaryText);
    if (!item.entry.constant && !keys.length) issues.push(`${title}：填写触发关键词，或设为常驻词条。`);
    if (keys.length > 20 || secondaryKeys.length > 20 || [...keys, ...secondaryKeys].some((key) => key.length > 120)) issues.push(`${title}：关键词每组最多 20 个，每个不超过 120 字。`);
    if (item.entry.insertionOrder !== undefined && (!Number.isInteger(item.entry.insertionOrder) || item.entry.insertionOrder < 0 || item.entry.insertionOrder > 100000)) issues.push(`${title}：插入顺序需要为 0–100000 的整数。`);
  });
  return issues;
}

export default function CharacterStudio({ character, nickname, user, onClose, onSave, onRetrySave, onTest, onSubmit, onLoadCloud, onRequireAccount, onDirtyChange, onBusyChange, submission }: CharacterStudioProps) {
  const [draft, setDraft] = useState<Draft>(() => createDraft(character));
  const [professional, setProfessional] = useState(Boolean(character));
  const [step, setStep] = useState<Step>(character ? "identity" : "opening");
  const [operation, setOperation] = useState<"save" | "test" | "submit" | "upload" | "import" | "sync" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [retrySaveAvailable, setRetrySaveAvailable] = useState(false);
  const [conflictRecovery, setConflictRecovery] = useState(false);
  const [selectedOpening, setSelectedOpening] = useState(0);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [submissionDone, setSubmissionDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [importCandidate, setImportCandidate] = useState<ImportCandidate | null>(null);
  const id = useRef(character?.sourceKind === "original" ? character.id : `local-${uid()}`);
  const createdAt = useRef(character?.sourceKind === "original" ? character.createdAt : new Date().toISOString());
  const importInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const candidateRef = useRef<ImportCandidate | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const instance = useRef<string | null>(null);
  if (instance.current === null) instance.current = uid();
  const editorScope = `${user?.id ?? "offline"}:${instance.current}`;
  const scopeRef = useRef(editorScope);
  scopeRef.current = editorScope;
  const main = useRef<HTMLDivElement>(null);
  const errorFeedback = useRef<HTMLParagraphElement>(null);
  const leaveDialog = useRef<HTMLDivElement>(null);
  const reviewDestination = useRef<string | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  const busyCallback = useRef(onBusyChange);
  const working = operation !== null;
  const busy = working || importCandidate !== null;
  const steps = professional ? STEPS : STEPS.filter((item) => item.id === "opening" || item.id === "preview");
  const index = steps.findIndex((item) => item.id === step);
  const registered = Boolean(user && !user.isGuest);
  const issues = readiness(draft);
  const review = useMemo(() => analyzeDzmmAuthoringReview({ ...draft, greetings: draft.greetings.map(item => item.value), selectedOpening }), [draft, selectedOpening]);
  useEffect(() => {
    if (!reviewDestination.current) return;
    const target = main.current?.querySelector<HTMLElement>(`[data-studio-field="${reviewDestination.current}"]`);
    if (!target) return;
    const details = target.closest("details");
    if (details) details.open = true;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    reviewDestination.current = null;
  }, [step, professional]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => () => { dirtyCallback.current?.(false); }, []);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  useEffect(() => () => { busyCallback.current?.(false); }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!leaving && !importCandidate) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveDialog.current?.querySelector<HTMLElement>('[data-continue="true"]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending.current) { event.preventDefault(); if (candidateRef.current) cancelImport(); else setLeaving(false); return; }
      if (event.key !== "Tab") return;
      const buttons = leaveDialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!buttons?.length) { event.preventDefault(); leaveDialog.current?.focus(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !leaveDialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !leaveDialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [leaving, importCandidate]);
  useEffect(() => {
    if (!leaving && !importCandidate) return;
    const dialog = leaveDialog.current;
    if (!dialog) return;
    const focused = document.activeElement;
    if (focused !== dialog && dialog.contains(focused) && !(focused instanceof HTMLButtonElement && focused.disabled)) return;
    // Disabling the clicked save button can move native focus to the page body.
    (dialog.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? dialog).focus();
  }, [leaving, importCandidate, working]);
  useEffect(() => {
    if (!error || busy || leaving || importCandidate) return;
    // The save action is fixed at the bottom; errors can be below a long editor.
    // Open confirmation dialogs retain their own focus and feedback.
    errorFeedback.current?.focus({ preventScroll: true });
    errorFeedback.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [error, busy, leaving, importCandidate]);

  function update(change: Partial<Draft>) { setDraft((previous) => ({ ...previous, ...change })); dirtyRef.current = true; setDirty(true); setNotice(""); setError(""); setSubmissionDone(false); }
  function selectStep(next: Step) { setStep(next); setError(""); main.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function editReview(next: "identity" | "opening" | "book", field?: string) {
    reviewDestination.current = field ?? "step-heading";
    setProfessional(true);
    selectStep(next);
  }
  function toggleMode() { if (!professional && step !== "opening" && step !== "preview") setStep("identity"); if (professional && step !== "opening" && step !== "preview") setStep("opening"); setProfessional((value) => !value); }
  function requestClose() { if (pending.current) return; if (dirty) setLeaving(true); else onClose(); }
  function discard() { if (pending.current) return; setDirty(false); dirtyCallback.current?.(false); setLeaving(false); onClose(); }
  async function saveAndClose() {
    const saved = await run("save", onSave);
    if (saved && mounted.current) { dirtyCallback.current?.(false); setLeaving(false); onClose(); }
  }
  async function retrySaveAndClose() {
    if (!onRetrySave) return;
    const saved = await run("save", onRetrySave);
    if (saved && mounted.current) { dirtyCallback.current?.(false); setLeaving(false); onClose(); }
  }
  async function requestAccount() {
    if (!onRequireAccount || pending.current) return;
    if (dirty) {
      const saved = await run("save", onSave);
      if (!saved || !mounted.current) return;
      // The account guard reads refs before React's save effects have run.
      dirtyCallback.current?.(false);
      busyCallback.current?.(false);
    }
    if (mounted.current) onRequireAccount();
  }
  function buildCharacter(privateDraft = false): Character {
    if (!draft.name.trim()) { setStep(professional ? "identity" : "opening"); throw new Error("请填写角色名称。"); }
    const openingDraft = privateDraft ? draft.messages.filter(message => message.content.trim()) : draft.messages;
    const greetingDraft = privateDraft ? draft.greetings.filter(greeting => greeting.value.trim()) : draft.greetings;
    const messages = openingDraft.length === 1 && !openingDraft[0].content.trim() ? [] : openingDraft.map(({ role, content }, position) => {
      if (!content.trim()) { setStep("opening"); throw new Error(`第 ${position + 1} 条开场消息不能为空，请填写或移除。`); }
      return { role, content };
    });
    const greetings = greetingDraft.map(({ value }, position) => { if (!value.trim()) { setStep("opening"); throw new Error(`备选开场 ${position + 1} 不能为空，请填写或移除。`); } return value; });
    const original = character as ExtendedCharacter | null;
    const bookDraft = privateDraft ? omitBlankDzmmBookDraftEntries(draft.entries) : draft.entries;
    const entries = bookDraft.map(({ entry, keysText, secondaryText }) => ({ ...entry, keys: split(keysText), ...(secondaryText.trim() || entry.secondaryKeys !== undefined ? { secondaryKeys: split(secondaryText) } : {}) }));
    const input: Record<string, unknown> = {
      name: draft.name, author: nickname, cover: draft.cover, tags: split(draft.tags), description: draft.description, personality: draft.personality, scenario: draft.scenario,
      firstMessage: messages.find((message) => message.role === "assistant")?.content ?? "",
    };
    for (const field of ["systemPrompt", "postHistoryInstructions", "messageExamples", "introduction", "creatorNotes"] as const) if (draft[field] || original?.[field] !== undefined) input[field] = draft[field];
    if (messages.length || original?.openingMessages !== undefined) input.openingMessages = messages;
    if (greetings.length || original?.alternateGreetings !== undefined) input.alternateGreetings = greetings;
    const gallery = draft.gallery.map((image) => image.value.trim()).filter(Boolean);
    if (gallery.length || original?.gallery !== undefined) input.gallery = gallery;
    const replies = draft.replies.map((reply) => reply.value.trim()).filter(Boolean);
    if (replies.length || original?.suggestedReplies !== undefined) input.suggestedReplies = replies;
    let authoringDraft: DzmmCharacterAuthoringDraft | null = null;
    if (draft.book) {
      if (privateDraft) {
        const compiled = compileDzmmPrivateWorldBook({ version: 1, characterBook: { ...draft.book, entries: bookDraft.map(({ entry, keysText, secondaryText }) => {
          const { keys, secondaryKeys, ...authored } = entry;
          void keys; void secondaryKeys;
          return { ...authored, keysText, secondaryText };
        }) } });
        input.characterBook = compiled.characterBook; authoringDraft = compiled.authoringDraft;
      } else input.characterBook = { ...draft.book, entries };
    }
    try {
      const result = privateDraft ? parsePrivateCharacter({ ...input, authoringDraft }, id.current) : parseCharacterImport(input, id.current);
      return { ...result, authoringDraft: privateDraft ? result.authoringDraft : null, createdAt: createdAt.current, author: nickname };
    } catch (failure) {
      const message = errorMessage(failure);
      if (message.includes("世界书")) { setProfessional(true); setStep("book"); }
      else if (message.includes("openingMessages") || message.includes("开场")) setStep("opening");
      else if (message.includes("图片") || message.includes("introduction") || message.includes("作者备注") || message.includes("systemPrompt") || message.includes("postHistoryInstructions") || message.includes("messageExamples")) { setProfessional(true); setStep("identity"); }
      throw failure;
    }
  }
  async function run(kind: "save" | "test" | "submit", action: (card: Character) => Promise<void> | void) {
    if (pending.current) return false;
    const scope = scopeRef.current;
    setError(""); setNotice("");
    if (kind !== "save" && issues.length) { setStep("preview"); setError("请先完善下方列出的内容，再试聊或提交。"); return false; }
    let card: Character;
    try { card = buildCharacter(kind === "save"); } catch (failure) { setError(errorMessage(failure)); return false; }
    pending.current = true; setOperation(kind);
    try {
      await action(card);
      if (!mounted.current || scopeRef.current !== scope) return false;
      setRetrySaveAvailable(false);
      setConflictRecovery(false);
      if (kind === "save") {
        const messages = draft.messages.filter(message => message.content.trim());
        const greetings = draft.greetings.filter(greeting => greeting.value.trim());
        const entries = omitBlankDzmmBookDraftEntries(draft.entries);
        const omittedOpenings = messages.length !== draft.messages.length || greetings.length !== draft.greetings.length;
        const omittedEntries = entries.length !== draft.entries.length;
        const selectedKey = selectedOpening > 0 ? draft.greetings[selectedOpening - 1]?.key : undefined;
        setSelectedOpening(selectedKey ? Math.max(0, greetings.findIndex(greeting => greeting.key === selectedKey) + 1) : 0);
        setDraft(previous => ({ ...previous, messages: messages.length ? messages : [{ key: uid(), role: "assistant", content: "" }], greetings, entries }));
        if (expandedEntry && !entries.some(item => item.key === expandedEntry)) setExpandedEntry(null);
        const omitted = [omittedOpenings ? "空白开场项" : "", omittedEntries ? "空白世界书词条" : ""].filter(Boolean);
        setDirty(false); setNotice(card.authoringDraft ? "私人草稿已保存，未完成的世界书已保留，完善后可试聊和提交。" : omitted.length ? `私人草稿已保存，${omitted.join("和")}已略过。` : "私人草稿已保存。");
      }
      if (kind === "submit") { setDirty(false); setSubmissionDone(true); setNotice("已提交审核，审核通过后会显示在公开角色广场。"); }
      return true;
    } catch (failure) {
      if (mounted.current && scopeRef.current === scope) {
        const message = errorMessage(failure);
        setError(message);
        setRetrySaveAvailable(Boolean(onRetrySave));
        setConflictRecovery(/加载云端版本|云端已有其他修改/.test(message));
      }
      return false;
    }
    finally { pending.current = false; if (mounted.current && scopeRef.current === scope) setOperation(null); }
  }
  async function importCard(file?: File) {
    if (!file || pending.current || candidateRef.current) return;
    const scope = scopeRef.current;
    pending.current = true; setOperation("import"); setError(""); setNotice("");
    try {
      if (file.size > 256 * 1024) throw new Error("角色卡文件不能超过 256 KB。");
      const imported = parseCharacterDraftImport(decodeDzmmCharacterImportBytes(await file.arrayBuffer()));
      if (!mounted.current || scopeRef.current !== scope) return;
      const candidate = { card: imported, scope };
      if (dirtyRef.current) { candidateRef.current = candidate; setImportCandidate(candidate); setLeaving(false); }
      else applyImportedCard(candidate);
    } catch (failure) { if (mounted.current && scopeRef.current === scope) setError(errorMessage(failure)); }
    finally { pending.current = false; if (mounted.current && scopeRef.current === scope) setOperation(null); if (importInput.current) importInput.current.value = ""; }
  }
  function applyImportedCard(candidate: ImportCandidate) {
    if (!mounted.current || candidate.scope !== scopeRef.current) return;
    id.current = candidate.card.id; createdAt.current = candidate.card.createdAt;
    candidateRef.current = null; setImportCandidate(null);
    setDraft(createDraft(candidate.card)); setProfessional(true); setStep("identity"); setSelectedOpening(0); setExpandedEntry(null); dirtyRef.current = true; setDirty(true); setRetrySaveAvailable(false); setConflictRecovery(false); setSubmissionDone(false); setError(""); setNotice("角色卡已载入编辑器，保存后成为你的私人草稿。");
  }
  function cancelImport() {
    if (pending.current) return;
    candidateRef.current = null; setImportCandidate(null); setError("");
  }
  function discardAndImport() {
    const candidate = candidateRef.current;
    if (!candidate || pending.current) return;
    applyImportedCard(candidate);
  }
  async function loadCloudVersion() {
    if (!onLoadCloud || pending.current) return;
    const scope = scopeRef.current;
    pending.current = true; setOperation("sync"); setError(""); setNotice("");
    try {
      await onLoadCloud();
      if (!mounted.current || scopeRef.current !== scope) return;
      setRetrySaveAvailable(false); setConflictRecovery(false);
      setNotice("已加载云端版本。当前页面的编辑内容还在，可以再次保存或提交审核。");
    } catch (failure) {
      if (mounted.current && scopeRef.current === scope) { setError(errorMessage(failure)); setConflictRecovery(true); setRetrySaveAvailable(Boolean(onRetrySave)); }
    } finally { pending.current = false; if (mounted.current && scopeRef.current === scope) setOperation(null); }
  }
  async function saveAndImport() {
    const candidate = candidateRef.current;
    if (!candidate || pending.current || !mounted.current || candidate.scope !== scopeRef.current) return;
    const saved = await run("save", retrySaveAvailable && onRetrySave ? onRetrySave : onSave);
    if (saved && mounted.current && candidateRef.current === candidate && candidate.scope === scopeRef.current) applyImportedCard(candidate);
  }
  function exportCard() {
    if (pending.current) return;
    try {
      const card = buildCharacter(true);
      const payload = card.authoringDraft ? exportCharacterDraftJson(card) : JSON.stringify({ ...JSON.parse(exportCharacterJson(card)), id: card.id }, null, 2);
      if (new TextEncoder().encode(payload).byteLength > 256 * 1024) throw new Error("导出角色卡不能超过 256 KB，请减少设定内容。");
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `${card.name.replace(/[\\/:*?"<>|]/g, "-")}${card.authoringDraft ? ".draft" : ""}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(card.authoringDraft ? "私人创作草稿已导出，未完成词条已保留；导入后可继续编辑。" : "当前角色卡已导出。"); setError("");
    } catch (failure) { setError(errorMessage(failure)); }
  }
  async function upload(files: FileList | null, gallery = false) {
    if (!files?.length || pending.current) return;
    const selected = Array.from(files);
    if (gallery && draft.gallery.length + selected.length > 20) { setError("画廊最多保存 20 张图片。"); return; }
    pending.current = true; setOperation("upload"); setError(""); setNotice("");
    try {
      if (gallery) {
        for (const file of selected) {
          const path = await uploadDzmmCover(file);
          if (!mounted.current) return;
          setDraft((previous) => ({ ...previous, gallery: [...previous.gallery, withKey(path)] }));
          setDirty(true); setSubmissionDone(false);
        }
      } else {
        const path = await uploadDzmmCover(selected[0]);
        if (!mounted.current) return;
        setDraft((previous) => ({ ...previous, cover: path }));
      }
      if (mounted.current) { setDirty(true); setSubmissionDone(false); setNotice(gallery ? "画廊图片已上传，保存草稿后保留。" : "封面已上传，保存草稿后保留。"); }
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { pending.current = false; if (mounted.current) setOperation(null); if (coverInput.current) coverInput.current.value = ""; if (galleryInput.current) galleryInput.current.value = ""; }
  }
  function addEntry() {
    const key = uid();
    update({ book: draft.book ?? { scanDepth: DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH }, entries: [...draft.entries, { key, entry: { id: key, name: "", keys: [], content: "", enabled: true, constant: false }, keysText: "", secondaryText: "" }] });
    setExpandedEntry(key);
  }
  function updateEntry(key: string, value: Partial<DzmmCharacterBookEntry>, fields: Partial<Pick<EntryDraft, "keysText" | "secondaryText">> = {}) { update({ entries: draft.entries.map((item) => item.key === key ? { ...item, ...fields, entry: { ...item.entry, ...value } } : item) }); }
  const previewMessages = selectedOpening > 0 && draft.greetings[selectedOpening - 1] ? [{ role: "assistant" as const, content: draft.greetings[selectedOpening - 1].value, key: "alternate-preview" }] : draft.messages;
  const coverPreview = previewImage(draft.cover);
  const textField = (field: "introduction" | "creatorNotes" | "description" | "personality" | "scenario" | "systemPrompt" | "postHistoryInstructions" | "messageExamples", title: string, hint: string, limit = 12000, rows = 5) => <Field title={title} hint={hint} count={`${draft[field].length} / ${limit}`}><textarea data-studio-field={field} rows={rows} maxLength={limit} disabled={busy} value={draft[field]} onChange={(event) => update({ [field]: event.target.value })} /></Field>;
  const basicFields = <><Field title="角色名称 *"><input autoComplete="off" maxLength={120} disabled={busy} value={draft.name} placeholder="为角色或故事命名" onChange={(event) => update({ name: event.target.value })} /></Field>{textField("introduction", "角色卡介绍", "展示在角色卡上，AI 不会看到这段介绍。", 12000, professional ? 4 : 3)}{textField("creatorNotes", "作者备注", "给玩家的致谢、玩法提示和更新说明；单独展示，不会发送给 AI。", 12000, 3)}</>;

  return <main className={styles.studio}>
    <header className={styles.header}><div className={styles.heading}><button type="button" className={styles.back} aria-label="返回" disabled={busy} onClick={requestClose}><Icon name="back" size={19} /></button><div><h1>{character?.sourceKind === "original" ? "编辑角色" : character ? "创建角色副本" : "创建角色"}</h1><p>{dirty ? "有未保存的修改" : "私人草稿 · 仅自己可见"}</p></div></div><div className={styles.headerActions}><button type="button" className={styles.textButton} disabled={busy} onClick={() => importInput.current?.click()}><Icon name="upload" size={15} />导入</button><button type="button" className={styles.textButton} disabled={busy} onClick={exportCard}><Icon name="download" size={15} />导出</button><span className={styles.modeLabel}>专业模式<button type="button" role="switch" aria-label="专业模式" aria-checked={professional} disabled={busy} className={`${styles.switch} ${professional ? styles.switchOn : ""}`} onClick={toggleMode}><span /></button></span></div></header>
    <nav className={styles.steps} aria-label="角色创作步骤">{steps.map((item, position) => <button type="button" key={item.id} aria-current={step === item.id ? "step" : undefined} disabled={busy} className={step === item.id ? styles.activeStep : ""} onClick={() => selectStep(item.id)}><span>{String(position + 1).padStart(2, "0")}</span>{item.name}</button>)}</nav>
    <div className={styles.workspace} ref={main}>
      <div className={styles.editor}>
        <div className={styles.sectionHeading}><span>{String(index + 1).padStart(2, "0")}</span><div><h2 tabIndex={-1} data-studio-field="step-heading">{STEPS.find((item) => item.id === step)?.name}</h2><p>{step === "identity" ? "定义人物、背景与叙事方式" : step === "opening" ? "写下第一次相遇，让故事有一个起点" : step === "book" ? "关键词出现时，相关设定会加入对话上下文" : step === "voice" ? "当前使用文字对话" : "检查角色，试聊后提交审核"}</p></div></div>
        {step === "identity" && <>
          {basicFields}
          <div className={styles.coverRow}><div className={styles.coverPreview}>{coverPreview ? <img src={coverPreview} alt="角色封面预览" /> : <Icon name="user" size={36} />}</div><div><Field title="封面图片"><input maxLength={2048} disabled={busy} value={draft.cover} placeholder="图片地址，或上传封面" onChange={(event) => update({ cover: event.target.value })} /></Field><button type="button" className={styles.secondary} disabled={busy} onClick={() => coverInput.current?.click()}><Icon name="upload" size={14} />{operation === "upload" ? "正在上传…" : "上传封面"}</button><p className={styles.help}>PNG、JPEG、WebP，最大 5 MB</p></div></div>
          <Field title="题材标签" hint="用逗号或换行分隔，最多 20 个。"><input maxLength={819} disabled={busy} value={draft.tags} placeholder="一般向，剧情，奇幻" onChange={(event) => update({ tags: event.target.value })} /></Field>
          <div className={styles.divider} />
          {textField("description", "详细描述", "AI 会看到：人物背景、行为动机、世界与关系。", 12000, 7)}
          {textField("personality", "性格与说话方式", "人物的习惯、态度和说话风格。", 12000, 4)}
          {textField("scenario", "故事场景", "故事发生在哪里，当前局势是什么。", 12000, 4)}
          <details className={styles.advanced}><summary>高级提示设置</summary>{textField("systemPrompt", "系统指令", "补充角色扮演与叙事规则。", 12000, 5)}{textField("postHistoryInstructions", "后置指令", "放在聊天历史之后的补充要求。", 8000, 4)}{textField("messageExamples", "对话示例", "用人物对话展示语气和互动方式。", 12000, 5)}</details>
          <div className={styles.divider} /><div className={styles.groupHeading}><h3>角色画廊 <small>{draft.gallery.length} / 20</small></h3><button type="button" disabled={busy || draft.gallery.length >= 20} onClick={() => galleryInput.current?.click()}><Icon name="upload" size={14} />上传图片</button></div>
          {draft.gallery.length ? <div className={styles.gallery}>{draft.gallery.map((image) => <div key={image.key}>{previewImage(image.value) ? <img src={previewImage(image.value)!} alt="画廊图片" /> : <div className={styles.galleryPlaceholder}><Icon name="grid" size={24} /></div>}<button type="button" disabled={busy} aria-label="移除画廊图片" onClick={() => update({ gallery: draft.gallery.filter((item) => item.key !== image.key) })}><Icon name="close" size={13} /></button><input aria-label="画廊图片地址" maxLength={2048} disabled={busy} value={image.value} onChange={(event) => update({ gallery: draft.gallery.map((item) => item.key === image.key ? { ...item, value: event.target.value } : item) })} /></div>)}</div> : <p className={styles.help}>用图片补充人物和故事的氛围。</p>}<button type="button" className={styles.inlineAdd} disabled={busy || draft.gallery.length >= 20} onClick={() => update({ gallery: [...draft.gallery, withKey("")] })}><Icon name="plus" size={14} />添加图片地址</button>
        </>}
        {step === "opening" && <>
          {!professional && <div className={styles.quickBasics}>{basicFields}{textField("description", "详细描述", "角色的背景、经历和回应方式；AI 会看到这段设定。", 12000, 4)}<Field title="封面图片"><input maxLength={2048} disabled={busy} value={draft.cover} placeholder="图片地址" onChange={(event) => update({ cover: event.target.value })} /></Field><button type="button" className={styles.secondary} disabled={busy} onClick={() => coverInput.current?.click()}><Icon name="upload" size={14} />上传封面</button><div className={styles.divider} /></div>}
          <div className={styles.groupHeading}><h3>主开场 <small>{draft.messages.length} / 20 条</small></h3><button type="button" disabled={busy || draft.messages.length >= 20} onClick={() => update({ messages: [...draft.messages, { key: uid(), role: "assistant", content: "" }] })}><Icon name="plus" size={14} />添加消息</button></div><p className={styles.help}>按顺序进入新会话，可以交替使用角色消息和用户消息。</p>
          <div className={styles.messageList}>{draft.messages.map((message, position) => <div className={styles.messageEditor} key={message.key}><header><span>{String(position + 1).padStart(2, "0")}</span><select aria-label={`第 ${position + 1} 条消息的身份`} disabled={busy} value={message.role} onChange={(event) => update({ messages: draft.messages.map((item) => item.key === message.key ? { ...item, role: event.target.value as MessageDraft["role"] } : item) })}><option value="assistant">角色消息</option><option value="user">用户消息</option></select><div><button type="button" disabled={busy || position === 0} aria-label={`上移第 ${position + 1} 条消息`} onClick={() => update({ messages: transfer(draft.messages, position, -1) })}>↑</button><button type="button" disabled={busy || position === draft.messages.length - 1} aria-label={`下移第 ${position + 1} 条消息`} onClick={() => update({ messages: transfer(draft.messages, position, 1) })}>↓</button><button type="button" disabled={busy} aria-label={`删除第 ${position + 1} 条消息`} onClick={() => update({ messages: draft.messages.filter((item) => item.key !== message.key) })}><Icon name="close" size={14} /></button></div></header><textarea aria-label={`第 ${position + 1} 条开场消息`} rows={5} maxLength={12000} disabled={busy} placeholder={message.role === "assistant" ? "角色会说什么？故事从这里开始…" : "在角色回应前，用户已经做了什么或说了什么？"} value={message.content} onChange={(event) => update({ messages: draft.messages.map((item) => item.key === message.key ? { ...item, content: event.target.value } : item) })} /><footer>{message.content.length} / 12000</footer></div>)}</div>
          <div className={styles.divider} /><div className={styles.groupHeading}><h3>备选开场 <small>{draft.greetings.length} / 20</small></h3><button type="button" disabled={busy || draft.greetings.length >= 20} onClick={() => update({ greetings: [...draft.greetings, withKey("")] })}><Icon name="plus" size={14} />添加开场</button></div><p className={styles.help}>每段备选开场开启另一种初次相遇，试聊时可以选择。</p>
          {draft.greetings.map((greeting, position) => <div className={styles.alternate} key={greeting.key}><header><strong>备选开场 {position + 1}</strong><button type="button" disabled={busy} aria-label={`删除备选开场 ${position + 1}`} onClick={() => { update({ greetings: draft.greetings.filter((item) => item.key !== greeting.key) }); setSelectedOpening(0); }}><Icon name="close" size={14} /></button></header><textarea aria-label={`备选开场 ${position + 1}`} rows={4} maxLength={12000} disabled={busy} value={greeting.value} onChange={(event) => update({ greetings: draft.greetings.map((item) => item.key === greeting.key ? { ...item, value: event.target.value } : item) })} /></div>)}
          <div className={styles.divider} /><div className={styles.groupHeading}><h3>建议回复 <small>{draft.replies.length} / 12</small></h3><button type="button" disabled={busy || draft.replies.length >= 12} onClick={() => update({ replies: [...draft.replies, withKey("")] })}><Icon name="plus" size={14} />添加回复</button></div><p className={styles.help}>供玩家选择的开场回应，点击后填入输入框，确认后发送。</p>{draft.replies.map((reply, position) => <div className={styles.replyInput} key={reply.key}><input aria-label={`建议回复 ${position + 1}`} maxLength={500} disabled={busy} value={reply.value} placeholder="一种可能的回应…" onChange={(event) => update({ replies: draft.replies.map((item) => item.key === reply.key ? { ...item, value: event.target.value } : item) })} /><button type="button" disabled={busy} aria-label={`删除建议回复 ${position + 1}`} onClick={() => update({ replies: draft.replies.filter((item) => item.key !== reply.key) })}><Icon name="close" size={14} /></button></div>)}
        </>}
        {step === "book" && <>
          <p className={styles.bookDescription}>把地点、组织、人物关系和规则拆成词条。对话出现关键词时，相关词条会加入上下文；常驻词条每次都会加入。</p>
          {draft.book && <div className={styles.bookMetadata}><Field title="世界书名称"><input maxLength={120} disabled={busy} value={draft.book.name ?? ""} onChange={(event) => update({ book: { ...draft.book, name: event.target.value } })} /></Field><Field title="扫描最近消息数" hint="1–40 条，用于匹配关键词。"><input type="number" min={1} max={40} disabled={busy} value={draft.book.scanDepth ?? DEFAULT_DZMM_CHARACTER_BOOK_SCAN_DEPTH} onChange={(event) => update({ book: { ...draft.book, scanDepth: Number(event.target.value) } })} /></Field></div>}
          <div className={styles.groupHeading}><h3>世界书词条 <small>{draft.entries.length} / 200</small></h3><button type="button" disabled={busy || draft.entries.length >= 200} onClick={addEntry}><Icon name="plus" size={14} />添加词条</button></div>
          {!draft.entries.length ? <div className={styles.empty}><Icon name="book" size={34} /><h3>还没有世界书词条</h3><p>添加一个地点或规则，让角色记住你的世界。</p><button type="button" className={styles.secondary} disabled={busy} onClick={addEntry}>添加第一个词条</button></div> : <div className={styles.entries}>{draft.entries.map((item, position) => <section className={styles.entry} key={item.key}><header><button type="button" className={styles.entryTitle} aria-expanded={expandedEntry === item.key} onClick={() => setExpandedEntry(expandedEntry === item.key ? null : item.key)}><span>{String(position + 1).padStart(2, "0")}</span><strong>{item.entry.name || split(item.keysText)[0] || "未命名词条"}</strong><small>{item.entry.enabled === false ? "已停用" : item.entry.constant ? "常驻" : "关键词"}</small><Icon name="chevron" size={14} /></button><button type="button" disabled={busy} aria-label={`删除词条 ${position + 1}`} onClick={() => update({ entries: draft.entries.filter((entry) => entry.key !== item.key) })}><Icon name="close" size={14} /></button></header>{expandedEntry === item.key && <div className={styles.entryBody}><Field title="词条名称"><input maxLength={120} disabled={busy} value={item.entry.name ?? ""} onChange={(event) => updateEntry(item.key, { name: event.target.value })} /></Field><div className={styles.entrySwitches}><label><input type="checkbox" checked={item.entry.enabled !== false} disabled={busy} onChange={(event) => updateEntry(item.key, { enabled: event.target.checked })} />启用词条</label><label><input type="checkbox" checked={item.entry.constant === true} disabled={busy} onChange={(event) => updateEntry(item.key, { constant: event.target.checked })} />常驻上下文</label><label><input type="checkbox" checked={item.entry.caseSensitive === true} disabled={busy} onChange={(event) => updateEntry(item.key, { caseSensitive: event.target.checked })} />区分大小写</label><label><input type="checkbox" checked={item.entry.selective === true} disabled={busy} onChange={(event) => updateEntry(item.key, { selective: event.target.checked })} />同时匹配辅助词</label></div><Field title="触发关键词" hint={item.entry.constant ? "常驻词条不依赖关键词触发。" : "逗号或换行分隔，最多 20 个关键词。"}><textarea rows={2} maxLength={2419} disabled={busy} value={item.keysText} onChange={(event) => updateEntry(item.key, {}, { keysText: event.target.value })} /></Field>{(item.entry.selective || item.secondaryText) && <Field title="辅助关键词" hint="开启同时匹配时，需要命中一个主关键词和一个辅助关键词。"><input maxLength={2419} disabled={busy} value={item.secondaryText} onChange={(event) => updateEntry(item.key, {}, { secondaryText: event.target.value })} /></Field>}<Field title="词条内容" count={`${item.entry.content.length} / 8000`}><textarea rows={6} maxLength={8000} disabled={busy} value={item.entry.content} onChange={(event) => updateEntry(item.key, { content: event.target.value })} /></Field><Field title="插入位置" hint="选择词条放在人物设定的前面或后面。"><select aria-label="世界书插入位置" disabled={busy} value={item.entry.position ?? ""} onChange={(event) => updateEntry(item.key, { position: event.target.value ? event.target.value as DzmmCharacterBookEntry["position"] : undefined })}><option value="">默认（人物设定之后）</option><option value="before_char">人物设定之前</option><option value="after_char">人物设定之后</option></select></Field><Field title="插入顺序" hint="数值较小的词条优先插入。"><input type="number" min={0} max={100000} disabled={busy} value={item.entry.insertionOrder ?? position} onChange={(event) => updateEntry(item.key, { insertionOrder: Number(event.target.value) })} /></Field></div>}</section>)}</div>}
          {draft.book && <Field title="世界书说明"><textarea rows={3} maxLength={2000} disabled={busy} value={draft.book.description ?? ""} onChange={(event) => update({ book: { ...draft.book, description: event.target.value } })} /></Field>}
        </>}
        {step === "voice" && <section className={styles.voice}><div className={styles.voiceIcon}><Icon name="volume" size={32} /></div><h3>中文角色语音</h3><p>VIP 可在聊天消息的“更多”菜单生成语音，播放结果会随消息保存。文字回复完成后即可使用。</p><div><span>对话输出</span><strong>文字 · 按需生成语音</strong></div><div><span>角色声音</span><strong>默认中文朗读</strong></div><div><span>每日额度</span><strong>20 条 · 每段最多 800 字</strong></div></section>}
        {step === "preview" && <>
          {issues.length > 0 && <section className={styles.readiness} aria-label="待完善内容"><h3>还有 {issues.length} 项待完善</h3><ul>{issues.map((issue, position) => <li key={`${position}:${issue}`}>{issue}</li>)}</ul><p>可以先保存私人草稿，完善后再试聊和提交。</p></section>}
          <section className={styles.previewDetails}><h3>{draft.name || "未命名角色"}</h3><CharacterIntroduction text={draft.introduction || draft.description} creatorNotes={draft.creatorNotes} characterName={draft.name} userName={nickname} fallback="还没有填写角色卡介绍。" /><div className={styles.previewSummary}><span><Icon name="chat" size={15} />{draft.messages.filter((message) => message.content.trim()).length} 条主开场消息</span><span><Icon name="book" size={15} />{draft.entries.filter((entry) => entry.entry.enabled !== false).length} 个启用词条</span><span><Icon name="grid" size={15} />{draft.gallery.filter((image) => image.value.trim()).length} 张画廊图片</span></div></section>
          <Field title="预览开场"><select disabled={busy} value={selectedOpening} onChange={(event) => setSelectedOpening(Number(event.target.value))}><option value={0}>主开场</option>{draft.greetings.map((greeting, position) => <option key={greeting.key} value={position + 1}>备选开场 {position + 1}</option>)}</select></Field>
          <div className={styles.chatPreview}>{previewMessages.filter((message) => message.content.trim()).length ? previewMessages.filter((message) => message.content.trim()).map((message) => <div key={message.key} className={message.role === "user" ? styles.userMessage : styles.characterMessage}><span>{message.role === "user" ? nickname || "玩家" : draft.name || "角色"}</span><p>{applyDzmmReaderNames(message.content, { characterName: draft.name, userName: nickname })}</p></div>) : <div className={styles.empty}><p>填写开场对话后，这里会显示初次相遇的预览。</p></div>}</div>
          <button type="button" className={styles.secondary} disabled={busy || issues.length > 0} onClick={() => void run("test", (card) => onTest(card, selectedOpening))}><Icon name="sparkles" size={15} />{operation === "test" ? "正在准备…" : "开始试聊"}</button>
          <section className={styles.authoringReview} aria-label="创作检查">
            <div className={styles.reviewHeading}><h3>创作检查</h3><span>待作者复核</span></div>
            <p className={styles.reviewIntro}>根据当前填写内容列出复核方向；实际剧情表现需试聊确认。</p>
            <article aria-label="人物与目标检查">
              <h4>人物与目标</h4>
              <p className={styles.reviewFacts}>{review.modelFields.length ? `已填写：${review.modelFields.join("、")}` : "模型设定尚未填写。角色卡介绍用于展示，不能代替设定。"}</p>
              <p><strong>角色辨识性</strong> 遇到不同处境时，人物怎样判断和行动？让特点超出外貌与口头禅。</p>
              <p><strong>动机与行动</strong> 眼前要完成什么，为什么，现在能主动做什么？</p>
              <button type="button" className={styles.textButton} disabled={busy} onClick={() => editReview("identity", "description")}>编辑人物与目标<Icon name="chevron" size={13} /></button>
            </article>
            <article aria-label="开场与场景检查">
              <h4>开场与场景</h4>
              <p className={styles.reviewFacts}>当前预览：角色 {review.assistantMessages} 条 · 玩家 {review.userMessages} 条</p>
              <p><strong>玩家可影响性</strong> 玩家能怎样介入，选择会带来什么后果？预写的玩家行动是否属于已约定背景？</p>
              <p className={styles.reviewFacts}>{review.hasScenario ? "故事场景已单独填写。" : "故事场景未单独填写，也可在人物设定或开场说明。"}</p>
              <p><strong>场景连续性</strong> 这幕何时结束？离开或跳时后，哪些道具与临时限制应失效？</p>
              <div className={styles.reviewActions}><button type="button" className={styles.textButton} disabled={busy} onClick={() => editReview("opening")}>编辑开场<Icon name="chevron" size={13} /></button><button type="button" className={styles.textButton} disabled={busy} onClick={() => editReview("identity", "scenario")}>编辑场景与结束条件<Icon name="chevron" size={13} /></button></div>
            </article>
            <article aria-label="关系与世界检查">
              <h4>关系与世界</h4>
              <p><strong>关系因果</strong> 哪件事影响了谁的信任、合作或戒备？之后会出现什么行为变化？不涉及关系变化的题材可略过。</p>
              <p className={styles.reviewFacts}>关系数值由会话更新；写在卡片里的初值不会设置会话数值。</p>
              <p><strong>世界一致性</strong> 人物知道哪些事实、受什么规则限制？区分已发生的事件、未知信息与未来可能性。</p>
              <p className={styles.reviewFacts}>世界书：{review.enabledBookEntries} 个启用 · {review.constantBookEntries} 个常驻</p>
              <div className={styles.reviewActions}><button type="button" className={styles.textButton} disabled={busy} onClick={() => editReview("identity", "personality")}>编辑关系依据<Icon name="chevron" size={13} /></button><button type="button" className={styles.textButton} disabled={busy} onClick={() => editReview("book")}>编辑世界知识<Icon name="chevron" size={13} /></button></div>
            </article>
            {review.warnings.length > 0 && <div className={styles.reviewWarnings} aria-label="创作兼容提醒"><h4>兼容提醒</h4><ul>{review.warnings.map(warning => <li key={warning.id}><span>{warning.message}</span><button type="button" className={styles.textButton} disabled={busy} onClick={() => editReview(warning.target)}>修改相关内容</button></li>)}</ul><p>这些提醒不阻止保存私人草稿。</p></div>}
          </section>
          <div className={styles.divider} /><section className={styles.publish}><h3>提交公开角色</h3><p>私人草稿不会自动公开。提交审核后，审核通过的版本会进入角色广场。</p>{submission && <div className={styles.submissionStatus}><strong>{submission.status === "pending" ? "审核中" : submission.status === "approved" ? "已有公开版本" : submission.status === "rejected" ? "需要修改" : "已撤回"}</strong>{submission.reason && <p>{submission.reason}</p>}</div>}{submissionDone && <p className={styles.submitted}>本次版本已提交审核。</p>}{registered ? <button type="button" className={styles.primary} disabled={busy || submissionDone || issues.length > 0} onClick={() => void run("submit", onSubmit)}>{operation === "submit" ? "正在提交…" : !conflictRecovery && retrySaveAvailable ? "重新同步并提交" : "提交审核"}<Icon name="send" size={15} /></button> : <div className={styles.guest}><p>注册或登录前会先保存当前草稿。新注册保留游客记录；登录已有账号前，请用顶部“导出”带走角色卡，登录后导入继续创作。</p>{onRequireAccount ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void requestAccount()}>注册或登录</button> : <span>请先注册或登录账号。</span>}</div>}</section>
        </>}
        {error && <p ref={errorFeedback} className={styles.error} role="alert" tabIndex={-1}>{error}</p>}
        {conflictRecovery && onLoadCloud && !leaving && <div className={styles.field}><p className={styles.help}>加载云端版本后，这次编辑仍留在页面上，可以再次保存或提交。加载前的本地记录会留在恢复备份里。</p><button type="button" className={styles.secondary} disabled={busy} onClick={() => void loadCloudVersion()}>{operation === "sync" ? "正在加载…" : "加载云端版本"}</button></div>}
        {retrySaveAvailable && onRetrySave && !conflictRecovery && !leaving && <div className={styles.field}><p className={styles.help}>可在这里重新同步并保存当前草稿，无需离开编辑器。云端有其他修改时会保留两边记录。</p><button type="button" className={styles.secondary} disabled={busy} onClick={() => void run("save", onRetrySave)}>重新同步并保存</button></div>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
      <aside className={styles.inspector}><div className={styles.inspectorHeading}>角色预览<span>私人草稿</span></div><div className={styles.rolePreview}>{coverPreview ? <img src={coverPreview} alt={draft.name || "角色封面"} /> : <div className={styles.blankCover}><Icon name="user" size={45} /><span>添加角色封面</span></div>}<div><h3>{draft.name || "未命名角色"}</h3><span>由 {nickname} 创作</span><CharacterIntroduction text={draft.introduction || draft.description} creatorNotes={draft.creatorNotes} characterName={draft.name} userName={nickname} fallback="角色卡介绍会展示在这里" /><div className={styles.tags}>{split(draft.tags).slice(0, 6).map((tag) => <span key={tag}>#{tag}</span>)}</div></div></div><p className={styles.previewHelp}>这里展示玩家看到的角色卡。人物设定和系统指令会随试聊生效。</p></aside>
    </div>
    <footer className={styles.footer}><div className={styles.progress}>{steps.map((item) => <span key={item.id} className={item.id === step ? styles.currentDot : ""} />)}<span>{index + 1} / {steps.length}</span></div><div className={styles.footerActions}><button type="button" className={`${styles.secondary} ${styles.save}`} disabled={busy} onClick={() => void run("save", onSave)}><Icon name="check" size={14} />{operation === "save" ? "正在保存…" : "保存草稿"}</button>{index > 0 && <button type="button" className={styles.secondary} disabled={busy} onClick={() => selectStep(steps[index - 1].id)}>上一步</button>}{index < steps.length - 1 && <button type="button" className={styles.primary} disabled={busy} onClick={() => selectStep(steps[index + 1].id)}>下一步<Icon name="chevron" size={14} /></button>}{index === steps.length - 1 && <button type="button" className={`${styles.secondary} ${styles.finish}`} disabled={busy} onClick={requestClose}>返回</button>}</div></footer>
    {leaving && <div className={styles.leaveOverlay} onClick={(event) => { if (event.target === event.currentTarget && !busy) setLeaving(false); }}><div className={styles.leaveDialog} ref={leaveDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="studio-leave-title" aria-describedby="studio-leave-description"><h2 id="studio-leave-title">有未保存的修改</h2><p id="studio-leave-description">保存草稿后再退出，或放弃本次修改。</p>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.leaveActions}>{retrySaveAvailable && onRetrySave ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void retrySaveAndClose()}>{operation === "save" ? "正在保存…" : "重新同步并保存后退出"}</button> : <button type="button" className={styles.primary} disabled={busy} onClick={() => void saveAndClose()}>{operation === "save" ? "正在保存…" : "保存并退出"}</button>}<button type="button" className={styles.secondary} disabled={busy} onClick={discard}>放弃修改</button><button type="button" className={styles.textButton} disabled={busy} data-continue="true" onClick={() => setLeaving(false)}>继续编辑</button></div></div></div>}
    {importCandidate && <div className={styles.leaveOverlay}><div className={styles.leaveDialog} ref={leaveDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="studio-import-title" aria-describedby="studio-import-description"><h2 id="studio-import-title">导入前保留当前修改</h2><p id="studio-import-description">当前草稿有未保存的修改。已读取“{importCandidate.card.name}”，请选择怎样继续。保存失败时，当前草稿和待导入角色都会保留。</p>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.leaveActions}><button type="button" className={styles.primary} disabled={working} onClick={() => void saveAndImport()}>{operation === "save" ? "正在保存…" : retrySaveAvailable && onRetrySave ? "重新同步保存当前草稿并导入" : "保存当前草稿并导入"}</button><button type="button" className={styles.secondary} disabled={working} onClick={discardAndImport}>放弃当前修改并导入</button><button type="button" className={styles.textButton} disabled={working} data-continue="true" onClick={cancelImport}>继续编辑当前草稿</button></div></div></div>}
    <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => void importCard(event.target.files?.[0])} /><input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void upload(event.target.files)} /><input ref={galleryInput} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void upload(event.target.files, true)} />
  </main>;
}
