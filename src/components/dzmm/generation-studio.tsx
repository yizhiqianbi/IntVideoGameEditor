"use client";
/* eslint-disable @next/next/no-img-element -- private R2 media is rendered by the standalone Vite client. */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDzmmBillingUsage } from "../../lib/dzmm-billing-client";
import { createGeneration, deleteGeneration, fetchGenerationConfig, fetchGenerationJobs, GenerationError, quoteGeneration, recoverGeneration, refreshGeneration,
  parseGenerationReference, type GenerationReference, type GenerationConfig, type GenerationInput, type GenerationJob, type GenerationKind, type GenerationQuote } from "../../lib/xumeng-generation";
import { recoverGenerationReferenceWithDeadline } from "../../lib/xumeng-reference-recovery";
import { prepareReferenceImage } from "../../lib/xumeng-reference-file";
import { getGenerationTemplate, type GenerationTemplate } from "../../lib/xumeng-generation-templates";
import { requestKrea2Still } from "../../lib/xumeng-krea2-bridge";
import { requestH3ReferenceVideo } from "../../lib/xumeng-h3-r2v";
import { requestAiapiStill, requestAiapiVideo } from "../../lib/xumeng-aiapi-bridge";
import { KREA2_STYLES, type Krea2StyleId } from "../../lib/xumeng-krea2-styles";
import { STUDIO_STILL_CREDITS } from "../../lib/xumeng-studio-still-billing";
import { compileGenerationTemplateDraft, createGenerationTemplateDraft, restoreGenerationTemplateDrafts, restoreGenerationWorkspaceDraft,
  type GenerationTemplateDrafts } from "../../lib/xumeng-generation-draft";
import GenerationTemplateLibrary from "./generation-template-library";
import GenerationReferenceInput from "./generation-reference";
import GenerationActionPreview from "./generation-action-preview";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengStudio, xumengStudioFill } from "../../lib/xumeng-studio-copy";
import Icon from "./icons";
import s from "./generation-studio.module.css";

type Props = { userId: string; isGuest: boolean; locale?: XumengLocale; onRequireAccount: () => void; onRecharge?: () => void; onBack?: () => void };
const running = (job: GenerationJob) => job.finalizedAt === null;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const points = (value: number) => value.toLocaleString("zh-CN");
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const jobTemplateLabel = (job: GenerationJob) => { const template = getGenerationTemplate(job.templateId); return template?.kind === job.kind ? template.label : null; };
type Submission = { fingerprint: string; requestId: string; expectedMaxCredits?: number; status: "submitted" | "awaiting_confirmation" };

export default function GenerationStudio({ userId, isGuest, locale = "zh-Hans", onRequireAccount, onRecharge, onBack }: Props) {
  const c = xumengStudio(locale);
  const jobName = (status: GenerationJob["status"]) => ({ pending: c.gsSubmitted, processing: c.gsProcessing, ready: c.gsReady, failed: c.gsFailedStatus, unknown: c.gsUnknownStatus }[status]);
  const [kind, setKind] = useState<GenerationKind>(() => {
    try {
      const saved = sessionStorage.getItem("xumeng-aigen-kind");
      sessionStorage.removeItem("xumeng-aigen-kind");
      return saved === "video" ? "video" : "image";
    } catch { return "image"; }
  });
  const [useReferenceImage, setUseReferenceImage] = useState(true);
  const [referenceImage, setReferenceImage] = useState<GenerationReference | null>(null);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [checkingReference, setCheckingReference] = useState(false);
  const [referenceRecoveryError, setReferenceRecoveryError] = useState("");
  const [config, setConfig] = useState<GenerationConfig | null>(null);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [modelId, setModelId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [duration, setDuration] = useState(5);
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [editorMode, setEditorMode] = useState<"template" | "legacy">("template");
  const [templateDrafts, setTemplateDrafts] = useState<GenerationTemplateDrafts>({});
  const [pendingTemplate, setPendingTemplate] = useState<GenerationTemplate | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"templates" | "create">("templates");
  const [quote, setQuote] = useState<{ input: GenerationInput; value: GenerationQuote } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draftReady, setDraftReady] = useState<{ key: string; epoch: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [gpuPreview, setGpuPreview] = useState("");
  const [gpuResultKind, setGpuResultKind] = useState<"image" | "video">("image");
  const [gpuReference, setGpuReference] = useState<{ name: string; url: string; width: number; height: number; byteLength: number } | null>(null);
  const [styleId, setStyleId] = useState<Krea2StyleId>("photo");
  const [channelEngine, setChannelEngine] = useState<"local" | "channel">("local");
  const [channelTemplate, setChannelTemplate] = useState(templateId);
  if (channelTemplate !== templateId) {
    setChannelTemplate(templateId);
    setChannelEngine("local");
  }
  const mounted = useRef(false);
  const draftHydrationEpoch = useRef(0);
  const action = useRef<AbortController | null>(null);
  const referenceAction = useRef<AbortController | null>(null);
  const refreshing = useRef(false);
  const creating = useRef(false);
  const gpuPreviewUrl = useRef<string | null>(null);
  const gpuReferenceImage = useRef("");
  const referencePick = useRef(0);
  const revealReference = useRef(false);
  const compare = useRef<HTMLDivElement | null>(null);
  const collectionEpoch = useRef(0);
  const requestIds = useRef(new Map<string, Submission>());
  const results = useRef<HTMLElement | null>(null);
  const promptInput = useRef<HTMLTextAreaElement | null>(null);
  const templateHeading = useRef<HTMLHeadingElement | null>(null);
  const replacementDialog = useRef<HTMLDialogElement | null>(null);
  const selected = jobs.find(job => job.id === selectedId);
  const models = config?.models.filter(model => model.kind === kind) ?? [];
  const model = models.find(item => item.id === modelId) ?? models[0];
  const aspect = model?.aspectRatios.includes(aspectRatio) ? aspectRatio : model?.aspectRatios[0] ?? "1:1";
  const seconds = model?.durations.includes(duration) ? duration : model?.durations[0] ?? 5;
  const candidateTemplate = getGenerationTemplate(templateId);
  const template = editorMode === "template" && candidateTemplate?.kind === kind ? candidateTemplate : null;
  const actionTemplate = template?.demoVideoUrl ? template : null;
  const stillTemplate = template?.kind === "image" && template.demoPosterUrl ? template : null;
  const imagePending = template?.imageProvider === "unfiltered-pending";
  const freeStill = Boolean(template?.studioFree);
  const gpuStill = Boolean(template?.krea2Lora) || freeStill;
  const h3Video = Boolean(template?.id.startsWith("h3-") && template.demoVideoUrl);
  const studioStillShort = gpuStill && !isGuest && balance !== null && balance < STUDIO_STILL_CREDITS;
  const stillBlocked = imagePending && !gpuStill && !h3Video;
  // Templates start from an image. Explicit text-only legacy drafts keep their
  // saved mode, and original submitted requests still recover independently.
  // Studio stills and H3 videos upload the reference in the page, then call the connected GPU.
  const needsReference = (Boolean(template) || useReferenceImage) && !gpuStill && !h3Video;
  const templateDraft = template ? templateDrafts[template.id] ?? createGenerationTemplateDraft(template) : null;
  let compiledPrompt = prompt;
  let templateError = "";
  if (template && templateDraft) {
    try { compiledPrompt = compileGenerationTemplateDraft(template, templateDraft); }
    catch (failure) { compiledPrompt = ""; templateError = message(failure, c.gsDisconnect); }
  }
  const hasLegacyDraft = editorMode === "legacy";
  const draftKey = `xumeng-generation-draft:${userId}`;
  const submitKey = `xumeng-generation-request:${userId}`;
  const input: GenerationInput = { accountId: userId, kind, modelId: model?.id ?? "", prompt: compiledPrompt.trim(), aspectRatio: aspect,
    ...(kind === "video" ? { duration: seconds } : {}), ...(needsReference && referenceImage ? { referenceImageId: referenceImage.id } : {}), ...(templateId ? { templateId } : {}) };
  const fingerprint = JSON.stringify(input);
  const currentQuote = quote && JSON.stringify(quote.input) === fingerprint ? quote.value : null;
  const previousSubmission = submission?.status === "submitted" || submission?.fingerprint === fingerprint ? submission : requestIds.current.get(fingerprint);
  const recovering = previousSubmission?.status === "submitted";

  const restoreReference = useCallback(async (savedReference: GenerationReference, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    referenceAction.current?.abort();
    const controller = new AbortController();
    referenceAction.current = controller;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const active = () => mounted.current && !signal?.aborted && !controller.signal.aborted && referenceAction.current === controller;
    setCheckingReference(true); setReferenceRecoveryError("");
    try {
      const reference = await recoverGenerationReferenceWithDeadline(userId, savedReference.id, controller.signal);
      if (active()) setReferenceImage(reference);
    } catch (failure) {
      if (active()) {
        if (failure instanceof GenerationError && failure.status === 404 && failure.code === "generation_reference_missing") {
          setReferenceImage(null);
          setError(c.gsRefExpired);
        } else {
          // A failed lookup does not prove deletion. Preserve the saved identity
          // so the draft can recover after a temporary service/network failure.
          setReferenceRecoveryError(failure instanceof GenerationError && failure.code === "generation_reference_timeout"
            ? c.gsRefTimeout
            : c.gsRefUnknown);
        }
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (active()) { setCheckingReference(false); referenceAction.current = null; }
    }
  }, [userId]);

  const refresh = useCallback(async (poll = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    const epoch = ++collectionEpoch.current;
    try {
      let list = await fetchGenerationJobs(userId);
      if (poll) {
        const pending = list.filter(running).slice(0, 5);
        const updated = await Promise.allSettled(pending.map(job => refreshGeneration(userId, job.id)));
        updated.forEach((result, index) => { if (result.status === "fulfilled") list = list.map(job => job.id === pending[index].id ? result.value : job); });
      }
      const usage = !isGuest ? await fetchDzmmBillingUsage(userId).catch(() => null) : null;
      if (!mounted.current || collectionEpoch.current !== epoch) return;
      setJobs(list); setBalance(usage?.availableBalance ?? null);
    } catch (failure) { if (mounted.current) setError(message(failure, c.gsDisconnect)); }
    finally { refreshing.current = false; }
  }, [userId, isGuest]);

  useEffect(() => {
    mounted.current = true;
    const hydrationEpoch = ++draftHydrationEpoch.current;
    const controller = new AbortController();
    requestIds.current.clear(); setSubmission(null);
    try {
      const value = JSON.parse(sessionStorage.getItem(submitKey) ?? "null");
      if (value && typeof value.fingerprint === "string" && value.fingerprint.length <= 12000
        && JSON.parse(value.fingerprint).accountId === userId && typeof value.requestId === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
        && (value.expectedMaxCredits === undefined || (Number.isSafeInteger(value.expectedMaxCredits) && value.expectedMaxCredits > 0 && value.expectedMaxCredits <= 1e9))
        && (value.status === undefined || value.status === "submitted" || value.status === "awaiting_confirmation")) {
        // Old records without a frozen maximum can still recover with GET.
        const restored: Submission = { ...value, status: value.status ?? "submitted" };
        requestIds.current.set(restored.fingerprint, restored); setSubmission(restored);
      }
    } catch { /* Invalid or unavailable storage cannot authorize a request. */ }
    try {
      let library: unknown = null;
      try { library = JSON.parse(sessionStorage.getItem(`xumeng-generation-library:${userId}`) ?? "null"); } catch { /* Optional earlier parameter drafts. */ }
      let raw: unknown = null;
      try { raw = JSON.parse(sessionStorage.getItem(draftKey) ?? "null"); } catch { /* Earlier library parameters remain available even if the main draft is malformed. */ }
      const value = restoreGenerationWorkspaceDraft(raw, library);
      setTemplateDrafts(value?.templateDrafts ?? restoreGenerationTemplateDrafts(null, library));
      if (value) {
        setUseReferenceImage(value.useReferenceImage === true);
        if (value.referenceImage) { try {
          const savedReference = parseGenerationReference(value.referenceImage);
          setReferenceImage(savedReference);
          void restoreReference(savedReference, controller.signal);
        } catch { setReferenceImage(null); setError(c.gsSavedRefGone); } }
        setKind(value.kind); setPrompt(value.prompt); setModelId(typeof value.modelId === "string" ? value.modelId : "");
        setAspectRatio(typeof value.aspectRatio === "string" ? value.aspectRatio : "1:1"); setDuration(Number.isInteger(value.duration) ? value.duration : 5);
        setTemplateId(value.templateId); setEditorMode(value.editorMode);
        setWorkspaceMode(value.workspaceMode);
      }
    } catch { /* Storage failures do not discard the visible prompt. */ }
    // Restored fields become writable together, independently of model config.
    // The epoch excludes stale renders during a same-account rehydration.
    setDraftReady({ key: draftKey, epoch: hydrationEpoch });
    void fetchGenerationConfig(userId, controller.signal).then(value => { if (mounted.current) setConfig(value); })
      .catch(failure => { if (!controller.signal.aborted && mounted.current) setError(message(failure, c.gsDisconnect)); })
      .finally(() => { if (mounted.current) setLoading(false); });
    void refresh();
    return () => { mounted.current = false; controller.abort(); action.current?.abort(); referenceAction.current?.abort(); };
  }, [draftKey, submitKey, refresh, restoreReference, userId]);

  useEffect(() => {
    if (draftReady?.key !== draftKey || draftReady.epoch !== draftHydrationEpoch.current) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ schemaVersion: 2, kind, prompt: compiledPrompt, modelId, aspectRatio, duration, templateId,
      editorMode, templateDrafts, workspaceMode, useReferenceImage, referenceImage })); } catch { /* Optional local draft. */ }
  }, [draftReady, draftKey, kind, compiledPrompt, modelId, aspectRatio, duration, templateId, editorMode, templateDrafts, workspaceMode, useReferenceImage, referenceImage]);
  useEffect(() => {
    const element = replacementDialog.current;
    if (!element) return;
    if (pendingTemplate && !element.open) element.showModal();
    else if (!pendingTemplate && element.open) element.close();
  }, [pendingTemplate]);
  useEffect(() => {
    if (!jobs.some(running)) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(true); }, 30000);
    return () => clearInterval(timer);
  }, [jobs, refresh]);
  useEffect(() => {
    if (gpuPreviewUrl.current) URL.revokeObjectURL(gpuPreviewUrl.current);
    gpuPreviewUrl.current = null;
    setGpuPreview("");
  }, [templateId]);
  useEffect(() => () => { if (gpuPreviewUrl.current) URL.revokeObjectURL(gpuPreviewUrl.current); }, []);

  function chooseReference(reference: boolean) {
    if (busy || uploadingReference || checkingReference) return;
    setUseReferenceImage(reference); setQuote(null); setError("");
  }
  function retryReference() {
    if (busy || uploadingReference || checkingReference || !referenceImage) return;
    void restoreReference(referenceImage);
  }
  useEffect(() => {
    if (!revealReference.current || workspaceMode !== "create") return;
    revealReference.current = false;
    const node = templateHeading.current;
    if (!node) return;
    node.scrollIntoView({ block: "start" });
    const sticky = [...document.querySelectorAll("header")].find(item => {
      const position = getComputedStyle(item).position;
      return position === "sticky" || position === "fixed";
    });
    const cover = (sticky?.getBoundingClientRect().bottom ?? 0) + 12 - node.getBoundingClientRect().top;
    if (cover > 0) window.scrollBy(0, -cover);
    node.focus({ preventScroll: true });
  }, [workspaceMode, templateId]);
  function applyTemplate(value: GenerationTemplate) {
    if (busy || uploadingReference || checkingReference) return;
    if (kind !== value.kind) setModelId("");
    setTemplateDrafts(previous => previous[value.id] ? previous : { ...previous, [value.id]: createGenerationTemplateDraft(value) });
    setKind(value.kind); setTemplateId(value.id); setEditorMode("template"); setAspectRatio(value.aspectRatio); setUseReferenceImage(true);
    if (value.kind === "video") setDuration(5);
    replaceGpuPreview(""); setGpuResultKind("image");
    setQuote(null); setError(""); setNotice(""); setSelectedId(""); setWorkspaceMode("create");
    setPendingTemplate(null);
    revealReference.current = true;
  }
  function selectTemplate(value: GenerationTemplate) {
    if (busy || uploadingReference || checkingReference) return;
    if (template?.id === value.id) { revealReference.current = true; setWorkspaceMode("create"); return; }
    if (template || hasLegacyDraft) setPendingTemplate(value);
    else applyTemplate(value);
  }
  function changeTemplateField(id: string, value: string) {
    if (!template || !templateDraft || busy) return;
    setTemplateDrafts(previous => ({ ...previous, [template.id]: { ...templateDraft,
      values: { ...templateDraft.values, [id]: value } } }));
    setQuote(null); setError("");
  }
  function changeAdditionalRequirements(value: string) {
    if (!template || !templateDraft || busy) return;
    setTemplateDrafts(previous => ({ ...previous, [template.id]: { ...templateDraft, additionalRequirements: value } }));
    setQuote(null); setError("");
  }
  async function getQuote() {
    if (creating.current || busy) return;
    if (isGuest) { onRequireAccount(); return; }
    if (!template && !hasLegacyDraft) { setWorkspaceMode("templates"); setError(c.gsNeedTemplate); return; }
    if (templateError) { setError(templateError); return; }
    if (uploadingReference || checkingReference || (needsReference && referenceRecoveryError)) return;
    if (needsReference && !referenceImage) { setError(c.gsNeedUpload); return; }
    if (needsReference && !model?.supportsReferenceImage) { setError(c.gsModelRef); return; }
    if (!input.prompt) { setError(needsReference ? c.gsNeedEdit : c.gsNeedScene); return; }
    creating.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); action.current = controller;
    try { const value = await quoteGeneration(input, controller.signal); if (mounted.current) setQuote({ input, value }); }
    catch (failure) { if (!controller.signal.aborted && mounted.current) setError(message(failure, c.gsDisconnect)); }
    finally { creating.current = false; if (mounted.current) setBusy(false); }
  }
  function rememberSubmission(value: Submission) {
    requestIds.current.set(value.fingerprint, value); setSubmission(value);
    try { sessionStorage.setItem(submitKey, JSON.stringify(value)); } catch { /* Keep the in-memory identity. */ }
  }
  async function recoverSubmission() {
    if (creating.current || busy || !previousSubmission) return;
    creating.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); action.current = controller;
    try {
      const job = await recoverGeneration(userId, previousSubmission.requestId, controller.signal);
      if (!mounted.current) return;
      collectionEpoch.current++;
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); setSelectedId(job.id); setQuote(null);
      setNotice(c.gsFoundJob);
      await refresh();
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        if (failure instanceof GenerationError && failure.code === "generation_request_missing") {
          rememberSubmission({ fingerprint, requestId: previousSubmission.requestId, status: "awaiting_confirmation" });
          setQuote(null); setNotice(c.gsMissingJob);
        } else setError(message(failure, c.gsDisconnect));
      }
    } finally { creating.current = false; if (mounted.current) setBusy(false); }
  }
  async function generate() {
    if (creating.current || busy || !currentQuote || uploadingReference || checkingReference || (needsReference && (!referenceImage || !model?.supportsReferenceImage || referenceRecoveryError))) return;
    creating.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); action.current = controller;
    const requestId = previousSubmission?.requestId ?? crypto.randomUUID();
    rememberSubmission({ fingerprint, requestId, expectedMaxCredits: currentQuote.maxCredits, status: "submitted" });
    try {
      const job = await createGeneration(input, requestId, currentQuote.maxCredits, controller.signal);
      if (!mounted.current) return;
      collectionEpoch.current++;
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); setSelectedId(job.id); setQuote(null);
      // Keep the ID until this result is acknowledged. Explicit new generation
      // clears it; lost responses can recover the original job without a second submission.
      setNotice(job.status === "ready" ? c.gsDoneSaved : c.gsJobSaved);
      await refresh();
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        if (failure instanceof GenerationError && failure.code === "generation_quote_changed") {
          rememberSubmission({ fingerprint, requestId, status: "awaiting_confirmation" });
          setQuote(null); setError(message(failure, c.gsDisconnect));
        } else setError(`${message(failure, c.gsDisconnect)} ${c.gsRetryNote}`);
        void refresh();
      }
    } finally { creating.current = false; if (mounted.current) setBusy(false); }
  }
  function replaceGpuPreview(url: string) {
    if (gpuPreviewUrl.current) URL.revokeObjectURL(gpuPreviewUrl.current);
    gpuPreviewUrl.current = url || null;
    setGpuPreview(url);
  }
  function chooseGpuReference(file: File | undefined) {
    if (!file || busy) return;
    const pick = ++referencePick.current;
    setError("");
    void prepareReferenceImage(file).then(prepared => {
      if (!mounted.current || referencePick.current !== pick) return;
      gpuReferenceImage.current = prepared.dataUrl.slice(prepared.dataUrl.indexOf(",") + 1);
      setGpuReference({ name: prepared.file.name, url: prepared.dataUrl, width: prepared.width, height: prepared.height, byteLength: prepared.file.size });
    }).catch(failure => {
      if (mounted.current && referencePick.current === pick) setError(failure instanceof Error ? failure.message : c.gsBadRef);
    });
  }
  async function generateOnGpu() {
    if (!template || !gpuStill || busy) return;
    if (!gpuReferenceImage.current) { setError(c.gsNeedUpload); return; }
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setError(""); setNotice(""); setSelectedId("");
    try {
      const still = channelEngine === "channel"
        ? await requestAiapiStill({ templateId: template.id, prompt: compiledPrompt, image: gpuReferenceImage.current, ratio: template.aspectRatio }, controller.signal)
        : await requestKrea2Still({ templateId: template.id, prompt: compiledPrompt, image: gpuReferenceImage.current, style: styleId }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setGpuResultKind("image");
      replaceGpuPreview(URL.createObjectURL(still.image));
      setNotice(xumengStudioFill(c.gsCharged, { credits: points(still.chargedCredits) }));
      const usage = await fetchDzmmBillingUsage(userId).catch(() => null);
      if (mounted.current && usage && usage.accountId === userId) setBalance(usage.availableBalance);
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(message(failure, c.gsDisconnect));
    } finally { if (action.current === controller && mounted.current) setBusy(false); }
  }
  async function generateOnH3() {
    if (!h3Video || !template || busy) return;
    if (!gpuReferenceImage.current) { setError(c.gsNeedUpload); return; }
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setError(""); setNotice(c.gsRendering); setSelectedId("");
    try {
      const video = channelEngine === "channel"
        ? await requestAiapiVideo({ templateId: template.id, prompt: compiledPrompt, image: gpuReferenceImage.current, ratio: "9:16" }, controller.signal)
        : await requestH3ReferenceVideo({ templateId: template.id, prompt: compiledPrompt, image: gpuReferenceImage.current }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setGpuResultKind("video");
      replaceGpuPreview(URL.createObjectURL(video));
      setNotice(c.gsFilmReady);
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) { setNotice(""); setError(message(failure, c.gsDisconnect)); }
    } finally { if (action.current === controller && mounted.current) setBusy(false); }
  }
  function playTogether() {
    for (const node of compare.current?.querySelectorAll("video") ?? []) {
      node.currentTime = 0;
      void node.play();
    }
  }
  async function remove(id: string) {
    if (creating.current || busy) return;
    creating.current = true; setBusy(true); setError("");
    try {
      await deleteGeneration(userId, id);
      if (!mounted.current) return;
      collectionEpoch.current++;
      setJobs(previous => previous.filter(item => item.id !== id)); setSelectedId(""); setConfirmDelete("");
    } catch (failure) { if (mounted.current) setError(message(failure, c.gsDisconnect)); }
    finally { creating.current = false; if (mounted.current) setBusy(false); }
  }
  function newGeneration() { requestIds.current.clear(); setSubmission(null); try { sessionStorage.removeItem(submitKey); } catch {} setQuote(null); setSelectedId("");
    setWorkspaceMode(template || hasLegacyDraft ? "create" : "templates"); setNotice(template ? c.gsNewFromTemplate : hasLegacyDraft ? c.gsOldKept : c.gsPickThenQuote); }
  const actionLabel = busy && h3Video ? c.gsMakingVideo : busy && gpuStill ? c.gsMakingImage : busy ? c.gsWorking : h3Video ? (isGuest ? c.gsLoginGenerate : !gpuReference ? c.gsNeedRef : c.gsMakeVideo) : gpuStill ? (isGuest ? c.gsLoginGenerate : !gpuReference ? c.gsNeedRef : xumengStudioFill(c.gsMakeImage, { credits: points(STUDIO_STILL_CREDITS) })) : stillBlocked && !recovering ? c.gsCannot : isGuest ? c.gsLoginStart : recovering ? c.gsCheckJob : uploadingReference ? c.gsUploading : checkingReference ? c.gsRestoring : needsReference && !referenceImage ? c.gsNeedRef : currentQuote ? xumengStudioFill(c.gsConfirm, { credits: points(currentQuote.maxCredits) }) : c.gsSeeQuote;
  const quotedConfirm = currentQuote ? xumengStudioFill(c.gsConfirm, { credits: points(currentQuote.maxCredits) }) : "";
  const chargesCredit = actionLabel === c.gsMakeVideo || actionLabel === c.gsMakingVideo || actionLabel === c.gsMakingImage || actionLabel === xumengStudioFill(c.gsMakeImage, { credits: points(STUDIO_STILL_CREDITS) }) || actionLabel === quotedConfirm || (busy && !h3Video && !gpuStill && Boolean(currentQuote) && !isGuest && !recovering && actionLabel === c.gsWorking);

  return <main className={s.workspace}>
    <header className={s.header}><div>{onBack && <button type="button" className={s.backLink} onClick={onBack}><Icon name="back" size={15} />{c.gsCreate}</button>}<span className={s.eyebrow}>叙梦</span><h1>{c.gsImageVideo}</h1><p>{c.gsLead}</p></div>{isGuest ? <button className={s.wallet} onClick={onRequireAccount}>{c.gsLoginUse}<Icon name="chevron" size={14} /></button> : onRecharge ? <button className={s.wallet} onClick={onRecharge}>{balance === null ? c.gsWallet : `${points(balance)} 金币`}<Icon name="chevron" size={14} /></button> : <span className={s.wallet}>{c.gsPaymentsClosed}</span>}</header>
    {error && <div className={s.error} role="alert">{error}<button onClick={() => setError("")} aria-label={c.gsCloseError}><Icon name="close" size={16} /></button></div>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {recovering && workspaceMode === "templates" && <div className={s.recoveryBanner} role="status"><p>{c.gsRecoverBanner}</p><button type="button" className={s.secondary} disabled={busy || loading} onClick={() => { setWorkspaceMode("create"); void recoverSubmission(); }}>{c.gsCheckJob}</button></div>}
    <div className={s.workspaceNav}><div role="group" aria-label={c.gsViews}><button type="button" aria-pressed={workspaceMode === "templates"} disabled={busy || uploadingReference || checkingReference} onClick={() => setWorkspaceMode("templates")}><Icon name="grid" size={16}/>{c.gsTemplateSquare}</button><button type="button" aria-pressed={workspaceMode === "create"} disabled={busy || uploadingReference || checkingReference || (!template && !hasLegacyDraft && !recovering)} onClick={() => setWorkspaceMode("create")}><Icon name="sparkles" size={16}/>{hasLegacyDraft ? c.gsSavedPrompt : c.gsFromTemplate}</button></div><button type="button" className={`${s.historyLink} ${s.tool}`} aria-label={c.gsHistory} title={c.gsHistory} disabled={busy || uploadingReference || checkingReference} onClick={() => { setWorkspaceMode("create"); requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: "instant", block: "start" })); }}><Icon name="book" size={16}/></button></div>
    <GenerationTemplateLibrary locale={locale} userId={userId} visible={workspaceMode === "templates"} busy={busy || uploadingReference || checkingReference} onSelect={selectTemplate}/>
    {workspaceMode === "create" && <div className={s.layout}><section className={s.controls} aria-label={c.gsSettings}>
      <div className={s.templateHeading}><div><span>{kind === "image" ? c.gsImage : c.gsVideo}</span><h2 ref={templateHeading} tabIndex={-1}>{template?.label ?? (hasLegacyDraft ? c.gsSavedPrompt : c.gsPickFirst)}</h2><p>{template?.description ?? (hasLegacyDraft ? c.gsLegacyKept : c.gsPickUse)}</p></div><button className={s.tool} type="button" aria-label={template ? c.gsChangeTemplate : c.gsChooseTemplate} title={template ? c.gsChangeTemplate : c.gsChooseTemplate} disabled={busy || uploadingReference || checkingReference} onClick={() => setWorkspaceMode("templates")}><Icon name="grid" size={16} /></button></div>
      {hasLegacyDraft && <div className={s.creationModes} role="group" aria-label={c.gsMaterial}>{([
        { reference: true, label: kind === "image" ? c.gsRefImage : c.gsRefVideo },
        { reference: false, label: kind === "image" ? c.gsTextImage : c.gsTextVideo },
      ] as const).map(value => <button key={value.label} type="button" aria-pressed={useReferenceImage === value.reference} disabled={busy || uploadingReference || checkingReference} onClick={() => chooseReference(value.reference)}><Icon name={value.reference ? "image" : kind} size={17}/>{value.label}</button>)}</div>}
      {gpuStill && <section className={s.styleChoices} aria-label={c.gsStyle}>
        <div className={s.referenceHeading}><strong>{c.gsStyle}</strong></div>
        <div role="group">{KREA2_STYLES.map(item => <button type="button" key={item.id} aria-pressed={styleId === item.id} disabled={busy} onClick={() => setStyleId(item.id)}>{item.label}</button>)}</div>
      </section>}
      {(gpuStill || h3Video) && <section className={s.reference} aria-label={c.gsReference}>
        <div className={s.referenceHeading}><strong>{c.gsReference}</strong><span>{c.gsRequiredOne}</span>{!gpuReference && <label className={s.tool} title={c.gsUploadRef}><input className={s.fileCover} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" aria-label={c.gsPickFile} title={c.gsUploadRef} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; chooseGpuReference(file); }} /><Icon name="upload" size={16} /></label>}</div>
        {gpuReference && <div className={s.referenceSelected}><img src={gpuReference.url} alt={xumengStudioFill(c.gsRefAlt, { name: gpuReference.name })} /><div><strong>{gpuReference.name}</strong><span>{gpuReference.width} × {gpuReference.height} · {(gpuReference.byteLength / 1024).toFixed(0)} KB</span><div className={s.referenceTools}><label className={s.tool} title={c.gsReplaceImage}><input className={s.fileCover} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" aria-label={c.gsReplaceFile} title={c.gsReplaceImage} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; chooseGpuReference(file); }} /><Icon name="upload" size={16} /></label><button type="button" className={s.tool} aria-label={c.gsRemove} title={c.gsRemove} disabled={busy} onClick={() => { gpuReferenceImage.current = ""; setGpuReference(null); }}><Icon name="close" size={16} /></button></div></div></div>}
        <p>{h3Video ? c.gsH3Help : freeStill ? c.gsFreeHelp : c.gsStillHelp}{!gpuReference && <span className={s.formatHint}> · PNG / JPG / WebP</span>}</p>
      </section>}
      {(gpuStill || h3Video) && <div className={s.options}><label>{h3Video ? c.gsVideoChannel : c.gsImageChannel}<select aria-label={h3Video ? c.gsVideoChannel : c.gsImageChannel} disabled={busy} value={channelEngine} onChange={event => setChannelEngine(event.target.value === "channel" ? "channel" : "local")}><option value="local">{c.gsLocalChannel}</option><option value="channel">{h3Video ? c.gsH3Trial : c.gsQwenTrial}</option></select></label></div>}
      {needsReference && <GenerationReferenceInput locale={locale} accountId={userId} value={referenceImage} required={Boolean(template)} actionParticipants={actionTemplate?.actionParticipants} disabled={busy || checkingReference} isGuest={isGuest} video={kind === "video"} onRequireAccount={onRequireAccount} onUploading={setUploadingReference} onError={setError} onChange={value => { setReferenceImage(value); setReferenceRecoveryError(""); setQuote(null); }} />}
      {checkingReference && <p className={s.fine} role="status">{c.gsRestoring}</p>}
      {needsReference && referenceRecoveryError && <div className={s.error} role="alert"><span>{referenceRecoveryError}</span><button type="button" disabled={busy || uploadingReference || checkingReference} onClick={retryReference}>{c.gsRetryRef}</button></div>}
      {template && templateDraft && <div className={s.parameterFields} role="group" aria-label={c.gsParams}>
        {template.fields.map((field, index) => <label key={`${template.id}-${field.id}`}>{field.label}<span>{(templateDraft.values[field.id] ?? "").length} / 1,000</span><textarea ref={index === 0 ? promptInput : undefined} rows={2} maxLength={1000} required disabled={busy} placeholder={field.placeholder} value={templateDraft.values[field.id] ?? ""} onChange={event => changeTemplateField(field.id, event.target.value)}/>{field.description && <small>{field.description}</small>}</label>)}
        <label>{actionTemplate ? c.gsMotionExtra : c.gsExtra} <em>{c.gsOptionalMark}</em><span>{templateDraft.additionalRequirements.length} / 1,000</span><textarea rows={2} maxLength={1000} disabled={busy} placeholder={actionTemplate ? c.gsMotionPh : c.gsExtraPh} value={templateDraft.additionalRequirements} onChange={event => changeAdditionalRequirements(event.target.value)}/></label>
        {templateError && <p className={s.parameterError} role="status">{templateError}</p>}
        <details className={s.descriptionPreview}><summary>{c.gsViewPrompt}<span>{compiledPrompt.length} / 4,000</span></summary><p>{compiledPrompt || c.gsPromptEmpty}</p></details>
      </div>}
      {hasLegacyDraft && <label className={s.prompt}>{c.gsOldPrompt}<span>{prompt.length} / 4,000</span><textarea ref={promptInput} rows={7} maxLength={4000} disabled={busy} value={prompt} onChange={event => { setPrompt(event.target.value); setQuote(null); }} /></label>}
      {!gpuStill && !h3Video && <div className={s.options}><label>{c.gsModel}<select disabled={busy || loading} value={model?.id ?? ""} onChange={event => { setModelId(event.target.value); setQuote(null); }}>{models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>{c.gsRatio}<select disabled={busy || loading} value={aspect} onChange={event => { setAspectRatio(event.target.value); setQuote(null); }}>{model?.aspectRatios.map(value => <option key={value}>{value}</option>)}</select></label>{kind === "video" && <label>{c.gsDuration}<select disabled={busy || loading} value={seconds} onChange={event => { setDuration(Number(event.target.value)); setQuote(null); }}>{model?.durations.map(value => <option key={value} value={value}>{xumengStudioFill(c.gsSeconds, { n: value })}</option>)}</select></label>}</div>}
      {needsReference && model && !model.supportsReferenceImage && <p className={s.error}>{c.gsModelNoRef}</p>}
      {!gpuStill && !h3Video && template && aspect !== aspectRatio && <p className={s.fine}>{xumengStudioFill(c.gsAspectNote, { current: aspect, suggested: aspectRatio })}</p>}
      <p className={s.fine}>{channelEngine === "channel" && h3Video ? c.gsH3Fine : channelEngine === "channel" && gpuStill ? xumengStudioFill(c.gsQwenFine, { credits: points(STUDIO_STILL_CREDITS) }) : h3Video ? c.gsH3Together : gpuStill ? xumengStudioFill(c.gsStillFine, { parts: freeStill ? c.gsFreeParts : c.gsStillParts, credits: points(STUDIO_STILL_CREDITS) }) : stillBlocked ? c.gsBlocked : xumengStudioFill(c.gsSkuFine, { size: model?.resolutions[0] ?? (kind === "image" ? "1K" : "720p"), kind: kind === "image" ? c.gsPicture : c.gsSilentVideo })}</p>
      {gpuStill && <div className={s.quote}><strong>{xumengStudioFill(c.gsEachCredits, { credits: points(STUDIO_STILL_CREDITS) })}</strong><span>{c.gsStillSettle}</span></div>}
      {gpuStill && studioStillShort && <p className={s.error}>{xumengStudioFill(c.gsShort, { credits: points(STUDIO_STILL_CREDITS) })}{onRecharge ? <button onClick={onRecharge}>{c.gsTopUp}</button> : <span>{c.gsPayLater}</span>}</p>}
      {!gpuStill && !h3Video && !recovering && currentQuote && <div className={s.quote}><strong>{xumengStudioFill(c.gsEstimate, { credits: points(currentQuote.estimatedCredits) })}</strong><span>{xumengStudioFill(c.gsReserveNote, { credits: points(currentQuote.maxCredits) })}</span></div>}
      {!gpuStill && !h3Video && !recovering && balance !== null && currentQuote && balance < currentQuote.maxCredits && <p className={s.error}>{c.gsNeedReserve}{onRecharge ? <button onClick={onRecharge}>{c.gsTopUp}</button> : <span>{c.gsPayLater}</span>}</p>}
      <button className={`${s.primary} ${s.decision}${chargesCredit ? ` ${s.submit}` : ""}`} disabled={busy || loading || (h3Video ? Boolean(templateError) || (!isGuest && !gpuReference) : gpuStill ? Boolean(templateError) || (!isGuest && !gpuReference) || studioStillShort : (stillBlocked && !recovering) || (!recovering && (uploadingReference || checkingReference || (!template && !hasLegacyDraft) || Boolean(templateError) || (!isGuest && needsReference && (!referenceImage || !model?.supportsReferenceImage || Boolean(referenceRecoveryError))) || (!isGuest && !config?.enabled) || (currentQuote !== null && balance !== null && balance < currentQuote.maxCredits))))} onClick={h3Video ? (isGuest ? onRequireAccount : () => void generateOnH3()) : gpuStill ? (isGuest ? onRequireAccount : () => void generateOnGpu()) : isGuest ? onRequireAccount : recovering ? recoverSubmission : currentQuote ? generate : getQuote}><Icon name={busy || recovering ? "refresh" : chargesCredit ? "sparkles" : actionLabel === c.gsSeeQuote ? "quote" : "sparkles"} size={17} />{actionLabel}</button>
      {recovering && <p className={s.fine}>{xumengStudioFill(c.gsRecoverFine, { cap: previousSubmission.expectedMaxCredits ? xumengStudioFill(c.gsOldCap, { credits: points(previousSubmission.expectedMaxCredits) }) : "" })}</p>}
      {!gpuStill && !h3Video && !loading && config && !config.enabled && <p className={s.fine}>{c.gsNotConnected}</p>}
    </section><section ref={results} className={s.results} aria-label={c.gsResults}>
      <div className={s.sectionTitle}><h2>{selected ? jobName(selected.status) : h3Video && actionTemplate ? (gpuPreview ? c.gsResults : c.gsDemo) : gpuStill && stillTemplate ? c.gsCompare : gpuPreview ? c.gsResults : actionTemplate ? c.gsDemo : stillTemplate ? c.gsFrameTemplate : c.gsPreview}</h2><button className={s.tool} type="button" aria-label={c.gsNewJob} title={c.gsNewJob} disabled={busy} onClick={newGeneration}><Icon name="plus" size={16} /></button></div>
      {!selected && h3Video && actionTemplate ? <div className={s.r2vCompare} ref={compare}><figure><figcaption>{c.gsRefCaption}</figcaption>{gpuReference ? <img src={gpuReference.url} alt={xumengStudioFill(c.gsRefAlt, { name: gpuReference.name })} /> : <div className={s.empty}><p>{c.gsUploadShows}</p></div>}</figure><figure><figcaption>{c.gsTemplateCaption}</figcaption><video src={actionTemplate.demoVideoUrl} controls muted playsInline preload="metadata" /></figure><figure><figcaption>{c.gsFilm}</figcaption>{gpuPreview && gpuResultKind === "video" ? <video src={gpuPreview} controls playsInline preload="metadata" /> : <div className={s.empty}><p>{busy ? c.gsMakingVideo : c.gsShowsHere}</p></div>}</figure><button type="button" className={s.tool} aria-label={c.gsPlayTogether} title={c.gsPlayTogether} onClick={playTogether}><Icon name="play" size={16} /></button></div> : !selected && gpuStill && stillTemplate ? <div className={s.r2vCompare}><figure><figcaption>{c.gsRefCaption}</figcaption>{gpuReference ? <img src={gpuReference.url} alt={xumengStudioFill(c.gsRefAlt, { name: gpuReference.name })} /> : <div className={s.empty}><p>{c.gsUploadShows}</p></div>}</figure><figure><figcaption>{c.gsTemplateCaption}</figcaption><img src={stillTemplate.demoPosterUrl} alt={xumengStudioFill(c.gsNamedTemplate, { label: stillTemplate.label })} /></figure><figure><figcaption>{c.gsStillResult}</figcaption>{gpuPreview && gpuResultKind === "image" ? <img src={gpuPreview} alt={xumengStudioFill(c.gsNamedResult, { label: stillTemplate.label })} /> : <div className={s.empty}><p>{busy ? c.gsMakingImage : c.gsShowsHere}</p></div>}</figure></div> : !selected && gpuPreview ? <div className={s.preview}><img src={gpuPreview} alt={template?.label ?? c.gsResults} /></div> : !selected && actionTemplate ? <GenerationActionPreview template={actionTemplate}/> : !selected && stillTemplate ? <figure className={s.actionPreview} aria-label={xumengStudioFill(c.gsNamedFrame, { label: stillTemplate.label })}><img src={stillTemplate.demoPosterUrl} alt="" /><figcaption><strong>{xumengStudioFill(c.gsFrameLabel, { label: stillTemplate.label })}</strong><span>{c.gsPutIn}</span></figcaption></figure> : <div className={s.preview}>{selected?.status === "ready" && selected.assetUrl ? selected.kind === "image" ? <img src={selected.assetUrl} alt={selected.prompt} /> : <video key={selected.id} controls preload="metadata" src={selected.assetUrl} /> : <div className={s.empty}><Icon name={selected?.kind ?? kind} size={42} /><h3>{selected ? jobName(selected.status) : c.gsResultHere}</h3><p>{selected?.error ?? (selected && running(selected) ? selected.status === "unknown" ? c.gsUnknown : c.gsPolling : freeStill ? c.gsFreeEmpty : needsReference ? c.gsRefEmpty : c.gsTextEmpty)}</p></div>}</div>}
      {!selected && gpuPreview && gpuResultKind === "image" && <a className={s.tool} href={gpuPreview} download={`${template?.id ?? "krea2"}.png`} aria-label={c.gsDownloadImage} title={c.gsDownloadImage}><Icon name="download" size={16} /></a>}
      {!selected && gpuPreview && gpuResultKind === "video" && <a className={s.tool} href={gpuPreview} download={`${template?.id ?? "h3"}.mp4`} aria-label={c.gsDownloadVideo} title={c.gsDownloadVideo}><Icon name="download" size={16} /></a>}
      {selected && <div className={s.resultInfo}>{jobTemplateLabel(selected) && <span className={s.referenceTag}><Icon name="grid" size={14}/>{xumengStudioFill(c.gsTemplateTag, { label: jobTemplateLabel(selected) ?? "" })}</span>}{selected.referenceImage && <span className={s.referenceTag}><Icon name="image" size={14}/>{xumengStudioFill(c.gsUsedRef, { name: selected.referenceImage.name })}</span>}<p>{selected.prompt}</p><div><span>{date(selected.createdAt)} · {selected.aspectRatio}{selected.duration ?  ` · ${xumengStudioFill(c.gsSeconds, { n: selected.duration })}` : ""}</span><strong>{selected.status === "ready" ? xumengStudioFill(c.gsCharged, { credits: points(selected.chargedCredits) }) : running(selected) ? xumengStudioFill(c.gsReserved, { credits: points(selected.reservedCredits) }) : c.gsNotCharged}</strong></div>{selected.status === "ready" && <p className={s.fine}>{selected.costBasis === "frozen_sku" ? c.gsFrozen : c.gsProviderCost}{selected.exceedsReservation ? c.gsCapped : ""}</p>}{selected.assetUrl && <a className={s.tool} href={selected.assetUrl} download={`${selected.id}.${selected.mimeType === "image/jpeg" ? "jpg" : selected.mimeType === "image/webp" ? "webp" : selected.kind === "image" ? "png" : "mp4"}`} aria-label={c.gsDownload} title={c.gsDownload}><Icon name="download" size={16} /></a>}{!running(selected) && (confirmDelete === selected.id ? <div className={s.deleteConfirm}><span>{c.gsDeleteAsk}</span><button disabled={busy} onClick={() => void remove(selected.id)}>{c.gsConfirmDelete}</button><button disabled={busy} onClick={() => setConfirmDelete("")}>{c.gsCancel}</button></div> : <button type="button" className={s.tool} aria-label={c.gsDeleteTask} title={c.gsDeleteTask} disabled={busy} onClick={() => setConfirmDelete(selected.id)}><Icon name="trash" size={16} /></button>)}</div>}
      <div className={s.sectionTitle}><h2>{c.gsMyHistory}</h2><button className={s.tool} type="button" aria-label={c.gsRefreshJobs} title={c.gsRefreshJobs} disabled={busy} onClick={() => { setError(""); void refresh(true); }}><Icon name="refresh" size={16} /></button></div>
      {jobs.length ? <div className={s.history}>{jobs.map(job => <button key={job.id} aria-pressed={job.id === selectedId} onClick={() => { setSelectedId(job.id); setConfirmDelete(""); }}><Icon name={job.kind} size={20} /><span><strong>{job.prompt}</strong><small>{date(job.createdAt)}{jobTemplateLabel(job) ? ` · ${jobTemplateLabel(job)}` : ""} · {jobName(job.status)}</small></span><b>{job.status === "ready" ? `${points(job.chargedCredits)} 金币` : jobName(job.status)}</b></button>)}</div> : <p className={s.fine}>{loading ? c.gsReading : c.gsNoJobs}</p>}
    </section></div>}
    <dialog ref={replacementDialog} className={s.replacementDialog} aria-labelledby="generation-template-replace-title" onCancel={event => { event.preventDefault(); setPendingTemplate(null); }}>
      {pendingTemplate && <><h2 id="generation-template-replace-title">{xumengStudioFill(c.gsReplaceQ, { label: pendingTemplate.label })}</h2><p>{template ? xumengStudioFill(c.gsReplaceKept, { label: template.label }) : c.gsReplaceOld}{c.gsReplaceRef}</p><div><button type="button" className={s.secondary} onClick={() => setPendingTemplate(null)}>{c.gsKeepCurrent}</button><button type="button" className={s.primary} disabled={busy || uploadingReference || checkingReference} onClick={() => applyTemplate(pendingTemplate)}>{c.gsUseTemplate}</button></div></>}
    </dialog>
  </main>;
}
