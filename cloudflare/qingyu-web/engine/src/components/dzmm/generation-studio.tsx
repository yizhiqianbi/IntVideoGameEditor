"use client";
/* eslint-disable @next/next/no-img-element -- private R2 media is rendered by the standalone Vite client. */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDzmmBillingUsage } from "../../lib/dzmm-billing-client";
import { createGeneration, deleteGeneration, fetchGenerationConfig, fetchGenerationJobs, GenerationError, quoteGeneration, recoverGeneration, refreshGeneration,
  parseGenerationReference, type GenerationReference, type GenerationConfig, type GenerationInput, type GenerationJob, type GenerationKind, type GenerationQuote } from "../../lib/xumeng-generation";
import { recoverGenerationReferenceWithDeadline } from "../../lib/xumeng-reference-recovery";
import { getGenerationTemplate, type GenerationTemplate } from "../../lib/xumeng-generation-templates";
import { requestKrea2Still } from "../../lib/xumeng-krea2-bridge";
import { requestH3ReferenceVideo } from "../../lib/xumeng-h3-r2v";
import { KREA2_STYLES, type Krea2StyleId } from "../../lib/xumeng-krea2-styles";
import { STUDIO_STILL_CREDITS } from "../../lib/xumeng-studio-still-billing";
import { compileGenerationTemplateDraft, createGenerationTemplateDraft, restoreGenerationTemplateDrafts, restoreGenerationWorkspaceDraft,
  type GenerationTemplateDrafts } from "../../lib/xumeng-generation-draft";
import GenerationTemplateLibrary from "./generation-template-library";
import GenerationReferenceInput from "./generation-reference";
import GenerationActionPreview from "./generation-action-preview";
import Icon from "./icons";
import s from "./generation-studio.module.css";

type Props = { userId: string; isGuest: boolean; onRequireAccount: () => void; onRecharge?: () => void };
const names: Record<GenerationJob["status"], string> = { pending: "已提交", processing: "生成中", ready: "已完成", failed: "未完成", unknown: "等待提交核对" };
const running = (job: GenerationJob) => job.finalizedAt === null;
const message = (error: unknown) => error instanceof Error ? error.message : "连接中断，请刷新任务核对。";
const points = (value: number) => value.toLocaleString("zh-CN");
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const jobTemplateLabel = (job: GenerationJob) => { const template = getGenerationTemplate(job.templateId); return template?.kind === job.kind ? template.label : null; };
type Submission = { fingerprint: string; requestId: string; expectedMaxCredits?: number; status: "submitted" | "awaiting_confirmation" };

export default function GenerationStudio({ userId, isGuest, onRequireAccount, onRecharge }: Props) {
  const [kind, setKind] = useState<GenerationKind>("image");
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
  const mounted = useRef(false);
  const draftHydrationEpoch = useRef(0);
  const action = useRef<AbortController | null>(null);
  const referenceAction = useRef<AbortController | null>(null);
  const refreshing = useRef(false);
  const creating = useRef(false);
  const gpuPreviewUrl = useRef<string | null>(null);
  const gpuReferenceImage = useRef("");
  const gpuFileInput = useRef<HTMLInputElement | null>(null);
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
  const gpuStill = Boolean(template?.krea2Lora);
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
    catch (failure) { compiledPrompt = ""; templateError = message(failure); }
  }
  const hasLegacyDraft = editorMode === "legacy";
  const draftKey = `qingyu-generation-draft:${userId}`;
  const submitKey = `qingyu-generation-request:${userId}`;
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
          setError("参考图已过期或删除，请重新上传；画面描述已保留。");
        } else {
          // A failed lookup does not prove deletion. Preserve the saved identity
          // so the draft can recover after a temporary service/network failure.
          setReferenceRecoveryError(failure instanceof GenerationError && failure.code === "generation_reference_timeout"
            ? "参考图验证超时，原图信息和描述已保留。请重试恢复后再生成。"
            : "暂时无法验证参考图，原图和描述已保留。请重试恢复后再生成。");
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
    } catch (failure) { if (mounted.current) setError(message(failure)); }
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
      try { library = JSON.parse(sessionStorage.getItem(`qingyu-generation-library:${userId}`) ?? "null"); } catch { /* Optional earlier parameter drafts. */ }
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
        } catch { setReferenceImage(null); setError("保存的参考图信息已失效，请重新上传；画面描述已保留。"); } }
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
      .catch(failure => { if (!controller.signal.aborted && mounted.current) setError(message(failure)); })
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
  function applyTemplate(value: GenerationTemplate) {
    if (busy || uploadingReference || checkingReference) return;
    if (kind !== value.kind) setModelId("");
    setTemplateDrafts(previous => previous[value.id] ? previous : { ...previous, [value.id]: createGenerationTemplateDraft(value) });
    setKind(value.kind); setTemplateId(value.id); setEditorMode("template"); setAspectRatio(value.aspectRatio); setUseReferenceImage(true);
    if (value.kind === "video") setDuration(5);
    replaceGpuPreview(""); setGpuResultKind("image");
    setQuote(null); setError(""); setNotice(""); setSelectedId(""); setWorkspaceMode("create");
    setPendingTemplate(null);
    requestAnimationFrame(() => templateHeading.current?.focus({ preventScroll: true }));
  }
  function selectTemplate(value: GenerationTemplate) {
    if (busy || uploadingReference || checkingReference) return;
    if (template?.id === value.id) { setWorkspaceMode("create"); return; }
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
    if (!template && !hasLegacyDraft) { setWorkspaceMode("templates"); setError("请先选择一个生成模板。"); return; }
    if (templateError) { setError(templateError); return; }
    if (uploadingReference || checkingReference || (needsReference && referenceRecoveryError)) return;
    if (needsReference && !referenceImage) { setError("请先上传参考图。"); return; }
    if (needsReference && !model?.supportsReferenceImage) { setError("当前模型不支持参考图，请选择支持的模型。"); return; }
    if (!input.prompt) { setError(needsReference ? "请描述你希望怎样修改这张图，或画面接下来怎样运动。" : "先描述你想生成的画面。"); return; }
    creating.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); action.current = controller;
    try { const value = await quoteGeneration(input, controller.signal); if (mounted.current) setQuote({ input, value }); }
    catch (failure) { if (!controller.signal.aborted && mounted.current) setError(message(failure)); }
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
      setNotice("已找到原任务，未重复提交或预留 Credit。新一轮生成请点击“新任务”。");
      await refresh();
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        if (failure instanceof GenerationError && failure.code === "generation_request_missing") {
          rememberSubmission({ fingerprint, requestId: previousSubmission.requestId, status: "awaiting_confirmation" });
          setQuote(null); setNotice("未找到已提交任务。请重新查看报价并确认，系统会沿用原请求编号防止重复提交。");
        } else setError(message(failure));
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
      setNotice(job.status === "ready" ? "生成完成，结果已保存。" : "任务已保存，可以离开页面，稍后在历史里查看。");
      await refresh();
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        if (failure instanceof GenerationError && failure.code === "generation_quote_changed") {
          rememberSubmission({ fingerprint, requestId, status: "awaiting_confirmation" });
          setQuote(null); setError(message(failure));
        } else setError(`${message(failure)} 请先刷新任务；相同内容重试会核对原任务。`);
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
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size) {
      setError("请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const probe = new Image();
      probe.onload = () => {
        if (!mounted.current) return;
        gpuReferenceImage.current = encoded;
        setGpuReference({ name: file.name, url: dataUrl, width: probe.naturalWidth, height: probe.naturalHeight, byteLength: file.size });
        setError("");
      };
      probe.onerror = () => { if (mounted.current) setError("这张参考图无法读取，请换一张。"); };
      probe.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }
  async function generateOnGpu() {
    if (!template?.krea2Lora || busy) return;
    if (!gpuReferenceImage.current) { setError("请先上传参考图。"); return; }
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setError(""); setNotice(""); setSelectedId("");
    try {
      const still = await requestKrea2Still({ templateId: template.id, prompt: compiledPrompt, image: gpuReferenceImage.current, style: styleId }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setGpuResultKind("image");
      replaceGpuPreview(URL.createObjectURL(still.image));
      setNotice(`已扣 ${points(still.chargedCredits)} Credit。`);
      const usage = await fetchDzmmBillingUsage(userId).catch(() => null);
      if (mounted.current && usage && usage.accountId === userId) setBalance(usage.availableBalance);
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(message(failure));
    } finally { if (action.current === controller && mounted.current) setBusy(false); }
  }
  async function generateOnH3() {
    if (!h3Video || !template || busy) return;
    if (!gpuReferenceImage.current) { setError("请先上传参考图。"); return; }
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setBusy(true); setError(""); setNotice("正在按参考图和动作模板出片。"); setSelectedId("");
    try {
      const video = await requestH3ReferenceVideo({ templateId: template.id, prompt: compiledPrompt, image: gpuReferenceImage.current }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setGpuResultKind("video");
      replaceGpuPreview(URL.createObjectURL(video));
      setNotice("成片已生成。");
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) { setNotice(""); setError(message(failure)); }
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
    } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { creating.current = false; if (mounted.current) setBusy(false); }
  }
  function newGeneration() { requestIds.current.clear(); setSubmission(null); try { sessionStorage.removeItem(submitKey); } catch {} setQuote(null); setSelectedId("");
    setWorkspaceMode(template || hasLegacyDraft ? "create" : "templates"); setNotice(template ? "修改模板参数，查看报价后创建新任务。" : hasLegacyDraft ? "旧描述已保留，可修改后查看报价，或选择模板。" : "选择模板，填写参数后查看报价。"); }

  return <main className={s.workspace}>
    <header className={s.header}><div><span className={s.eyebrow}>晴屿 · 生成工作台</span><h1>生图与视频</h1><p>左边看视频动作，右边选画面。上传参考图后再确认。</p></div>{isGuest ? <button className={s.wallet} onClick={onRequireAccount}>登录使用<Icon name="chevron" size={14} /></button> : onRecharge ? <button className={s.wallet} onClick={onRecharge}>{balance === null ? "查看钱包" : `${points(balance)} Credit`}<Icon name="chevron" size={14} /></button> : <span className={s.wallet}>收款暂时关闭</span>}</header>
    {error && <div className={s.error} role="alert">{error}<button onClick={() => setError("")} aria-label="关闭生成错误"><Icon name="close" size={16} /></button></div>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {recovering && workspaceMode === "templates" && <div className={s.recoveryBanner} role="status"><p>有一笔生成提交需要核对。你可以先读取原任务，再继续编辑模板。</p><button type="button" className={s.secondary} disabled={busy || loading} onClick={() => { setWorkspaceMode("create"); void recoverSubmission(); }}>核对原任务</button></div>}
    <div className={s.workspaceNav}><div role="group" aria-label="生成工作台视图"><button type="button" aria-pressed={workspaceMode === "templates"} disabled={busy || uploadingReference || checkingReference} onClick={() => setWorkspaceMode("templates")}><Icon name="grid" size={16}/>模板广场</button><button type="button" aria-pressed={workspaceMode === "create"} disabled={busy || uploadingReference || checkingReference || (!template && !hasLegacyDraft && !recovering)} onClick={() => setWorkspaceMode("create")}><Icon name="sparkles" size={16}/>{hasLegacyDraft ? "已保存的描述" : "模板生成"}</button></div><button type="button" className={s.historyLink} disabled={busy || uploadingReference || checkingReference} onClick={() => { setWorkspaceMode("create"); requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: "instant", block: "start" })); }}><Icon name="book" size={15}/>生成历史</button></div>
    <GenerationTemplateLibrary userId={userId} visible={workspaceMode === "templates"} busy={busy || uploadingReference || checkingReference} onSelect={selectTemplate}/>
    {workspaceMode === "create" && <div className={s.layout}><section className={s.controls} aria-label="生成设置">
      <div className={s.templateHeading}><div><span>{kind === "image" ? "图片生成" : "视频生成"}</span><h2 ref={templateHeading} tabIndex={-1}>{template?.label ?? (hasLegacyDraft ? "已保存的描述" : "先选择一个模板")}</h2><p>{template?.description ?? (hasLegacyDraft ? "原描述已保留。选择模板后，会先向你确认替换。" : "按用途选择模板，再填写画面中的内容。")}</p></div><button className={s.secondary} type="button" disabled={busy || uploadingReference || checkingReference} onClick={() => setWorkspaceMode("templates")}>{template ? "更换模板" : "选择模板"}</button></div>
      {hasLegacyDraft && <div className={s.creationModes} role="group" aria-label="生成素材方式">{([
        { reference: true, label: kind === "image" ? "参考图生图" : "参考图生视频" },
        { reference: false, label: kind === "image" ? "文字生图" : "文字生视频" },
      ] as const).map(value => <button key={value.label} type="button" aria-pressed={useReferenceImage === value.reference} disabled={busy || uploadingReference || checkingReference} onClick={() => chooseReference(value.reference)}><Icon name={value.reference ? "image" : kind} size={17}/>{value.label}</button>)}</div>}
      {gpuStill && <section className={s.styleChoices} aria-label="风格">
        <div className={s.referenceHeading}><strong>风格</strong></div>
        <div role="group">{KREA2_STYLES.map(item => <button type="button" key={item.id} aria-pressed={styleId === item.id} disabled={busy} onClick={() => setStyleId(item.id)}>{item.label}</button>)}</div>
      </section>}
      {(gpuStill || h3Video) && <section className={s.reference} aria-label="参考图片">
        <div className={s.referenceHeading}><strong>参考图片</strong><span>必填 · 1 张</span></div>
        <input ref={gpuFileInput} className={s.fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择参考图片文件" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; chooseGpuReference(file); }} />
        {gpuReference ? <div className={s.referenceSelected}><img src={gpuReference.url} alt={`参考图：${gpuReference.name}`} /><div><strong>{gpuReference.name}</strong><span>{gpuReference.width} × {gpuReference.height} · {(gpuReference.byteLength / 1024).toFixed(0)} KB</span><div><button type="button" disabled={busy} onClick={() => gpuFileInput.current?.click()}>更换图片</button><button type="button" disabled={busy} onClick={() => { gpuReferenceImage.current = ""; setGpuReference(null); }}>移除</button></div></div></div>
          : <button type="button" className={s.referenceUpload} disabled={busy} onClick={() => gpuFileInput.current?.click()}><Icon name="plus" size={22} /><strong>上传参考图</strong><span>PNG / JPG / WebP</span></button>}
        <p>{h3Video ? "把参考图里的人放进这条动作模板。动作、服装、房间和镜头跟着模板。" : "把参考图里的人放进这张模板图。姿势、服装和画面跟着模板。"}</p>
      </section>}
      {needsReference && <GenerationReferenceInput accountId={userId} value={referenceImage} required={Boolean(template)} actionParticipants={actionTemplate?.actionParticipants} disabled={busy || checkingReference} isGuest={isGuest} video={kind === "video"} onRequireAccount={onRequireAccount} onUploading={setUploadingReference} onError={setError} onChange={value => { setReferenceImage(value); setReferenceRecoveryError(""); setQuote(null); }} />}
      {checkingReference && <p className={s.fine} role="status">正在恢复参考图片…</p>}
      {needsReference && referenceRecoveryError && <div className={s.error} role="alert"><span>{referenceRecoveryError}</span><button type="button" disabled={busy || uploadingReference || checkingReference} onClick={retryReference}>重试恢复参考图</button></div>}
      {template && templateDraft && <div className={s.parameterFields} role="group" aria-label="模板参数">
        {template.fields.map((field, index) => <label key={`${template.id}-${field.id}`}>{field.label}<span>{(templateDraft.values[field.id] ?? "").length} / 1,000</span><textarea ref={index === 0 ? promptInput : undefined} rows={2} maxLength={1000} required disabled={busy} placeholder={field.placeholder} value={templateDraft.values[field.id] ?? ""} onChange={event => changeTemplateField(field.id, event.target.value)}/>{field.description && <small>{field.description}</small>}</label>)}
        <label>{actionTemplate ? "动作补充" : "补充要求"} <em>选填</em><span>{templateDraft.additionalRequirements.length} / 1,000</span><textarea rows={2} maxLength={1000} disabled={busy} placeholder={actionTemplate ? "可不填。例如：动作轻一些、节奏慢一些。" : "例如：保留原图的人物和服装，调整背景或动作。"} value={templateDraft.additionalRequirements} onChange={event => changeAdditionalRequirements(event.target.value)}/></label>
        {templateError && <p className={s.parameterError} role="status">{templateError}</p>}
        <details className={s.descriptionPreview}><summary>查看生成描述<span>{compiledPrompt.length} / 4,000</span></summary><p>{compiledPrompt || "填写完整参数后，生成描述会显示在这里。"}</p></details>
      </div>}
      {hasLegacyDraft && <label className={s.prompt}>原画面描述<span>{prompt.length} / 4,000</span><textarea ref={promptInput} rows={7} maxLength={4000} disabled={busy} value={prompt} onChange={event => { setPrompt(event.target.value); setQuote(null); }} /></label>}
      {!gpuStill && !h3Video && <div className={s.options}><label>生成模型<select disabled={busy || loading} value={model?.id ?? ""} onChange={event => { setModelId(event.target.value); setQuote(null); }}>{models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>画面比例<select disabled={busy || loading} value={aspect} onChange={event => { setAspectRatio(event.target.value); setQuote(null); }}>{model?.aspectRatios.map(value => <option key={value}>{value}</option>)}</select></label>{kind === "video" && <label>片段时长<select disabled={busy || loading} value={seconds} onChange={event => { setDuration(Number(event.target.value)); setQuote(null); }}>{model?.durations.map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label>}</div>}
      {needsReference && model && !model.supportsReferenceImage && <p className={s.error}>当前模型不支持参考图，请更换模型。</p>}
      {!gpuStill && !h3Video && template && aspect !== aspectRatio && <p className={s.fine}>当前模型使用 {aspect}；模板建议 {aspectRatio}。</p>}
      <p className={s.fine}>{h3Video ? "参考图和这条动作模板一起出片，大约几分钟。这次不预留 Credit。" : gpuStill ? `风格、参考图和模板图一起出图，每次扣除 ${points(STUDIO_STILL_CREDITS)} Credit。失败不扣。` : stillBlocked ? "这个画面先记下来，现在还不能生成。" : `${model?.resolutions[0] ?? (kind === "image" ? "1K" : "720p")} · 每次生成一个${kind === "image" ? "图片" : "无声视频"} · 成本 × 3`}</p>
      {gpuStill && <div className={s.quote}><strong>每次 {points(STUDIO_STILL_CREDITS)} Credit</strong><span>出图成功后扣除，失败会退回预留。</span></div>}
      {gpuStill && studioStillShort && <p className={s.error}>可用 Credit 不足，每次出图需要 {points(STUDIO_STILL_CREDITS)} Credit。{onRecharge ? <button onClick={onRecharge}>去充值</button> : <span>收款暂时关闭，请稍后再试。</span>}</p>}
      {!gpuStill && !h3Video && !recovering && currentQuote && <div className={s.quote}><strong>预计 {points(currentQuote.estimatedCredits)} Credit</strong><span>最多预留 {points(currentQuote.maxCredits)}，完成后按费用结算并返还剩余。</span></div>}
      {!gpuStill && !h3Video && !recovering && balance !== null && currentQuote && balance < currentQuote.maxCredits && <p className={s.error}>可用余额不足以预留本次任务。{onRecharge ? <button onClick={onRecharge}>去充值</button> : <span>收款暂时关闭，请稍后再试。</span>}</p>}
      <button className={s.primary} disabled={busy || loading || (h3Video ? Boolean(templateError) || (!isGuest && !gpuReference) : gpuStill ? Boolean(templateError) || (!isGuest && !gpuReference) || studioStillShort : (stillBlocked && !recovering) || (!recovering && (uploadingReference || checkingReference || (!template && !hasLegacyDraft) || Boolean(templateError) || (!isGuest && needsReference && (!referenceImage || !model?.supportsReferenceImage || Boolean(referenceRecoveryError))) || (!isGuest && !config?.enabled) || (currentQuote !== null && balance !== null && balance < currentQuote.maxCredits))))} onClick={h3Video ? (isGuest ? onRequireAccount : () => void generateOnH3()) : gpuStill ? (isGuest ? onRequireAccount : () => void generateOnGpu()) : isGuest ? onRequireAccount : recovering ? recoverSubmission : currentQuote ? generate : getQuote}><Icon name={busy || recovering ? "refresh" : "sparkles"} size={17} />{busy && h3Video ? "正在出片…" : busy && gpuStill ? "正在出图…" : busy ? "正在处理，请稍候…" : h3Video ? (isGuest ? "登录后生成" : !gpuReference ? "请先上传参考图" : "生成这条视频") : gpuStill ? (isGuest ? "登录后生成" : !gpuReference ? "请先上传参考图" : `生成这张图 · ${points(STUDIO_STILL_CREDITS)} Credit`) : stillBlocked && !recovering ? "暂时不能生成" : isGuest ? "登录并开始" : recovering ? "核对原任务" : uploadingReference ? "正在上传参考图…" : checkingReference ? "正在恢复参考图…" : needsReference && !referenceImage ? "请先上传参考图" : currentQuote ? `确认生成 · 预留 ${points(currentQuote.maxCredits)} Credit` : "查看本次报价"}</button>
      {recovering && <p className={s.fine}>核对只读取原任务{previousSubmission.expectedMaxCredits ? `（原确认上限 ${points(previousSubmission.expectedMaxCredits)} Credit）` : ""}，不会重复生成或新增预留。</p>}
      {!gpuStill && !h3Video && !loading && config && !config.enabled && <p className={s.fine}>生成服务尚未连接，可先填写和保存描述。</p>}
    </section><section ref={results} className={s.results} aria-label="生成结果">
      <div className={s.sectionTitle}><h2>{selected ? names[selected.status] : h3Video && actionTemplate ? (gpuPreview ? "生成结果" : "模板动作示范") : gpuStill && stillTemplate ? "参考图、模板和成图" : gpuPreview ? "生成结果" : actionTemplate ? "模板动作示范" : stillTemplate ? "画面模板" : "生成预览"}</h2><button className={s.secondary} disabled={busy} onClick={newGeneration}><Icon name="plus" size={14} />新任务</button></div>
      {!selected && h3Video && actionTemplate ? <div className={s.r2vCompare} ref={compare}><figure><figcaption>参考图</figcaption>{gpuReference ? <img src={gpuReference.url} alt={`参考图：${gpuReference.name}`} /> : <div className={s.empty}><p>上传参考图后显示在这里。</p></div>}</figure><figure><figcaption>模板</figcaption><video src={actionTemplate.demoVideoUrl} controls muted playsInline preload="metadata" /></figure><figure><figcaption>成片</figcaption>{gpuPreview && gpuResultKind === "video" ? <video src={gpuPreview} controls playsInline preload="metadata" /> : <div className={s.empty}><p>{busy ? "正在出片…" : "生成后显示在这里。"}</p></div>}</figure><button type="button" className={s.secondary} onClick={playTogether}>同时播放</button></div> : !selected && gpuStill && stillTemplate ? <div className={s.r2vCompare}><figure><figcaption>参考图</figcaption>{gpuReference ? <img src={gpuReference.url} alt={`参考图：${gpuReference.name}`} /> : <div className={s.empty}><p>上传参考图后显示在这里。</p></div>}</figure><figure><figcaption>模板</figcaption><img src={stillTemplate.demoPosterUrl} alt={`${stillTemplate.label}模板`} /></figure><figure><figcaption>成图</figcaption>{gpuPreview && gpuResultKind === "image" ? <img src={gpuPreview} alt={`${stillTemplate.label}成图`} /> : <div className={s.empty}><p>{busy ? "正在出图…" : "生成后显示在这里。"}</p></div>}</figure></div> : !selected && gpuPreview ? <div className={s.preview}><img src={gpuPreview} alt={template?.label ?? "生成结果"} /></div> : !selected && actionTemplate ? <GenerationActionPreview template={actionTemplate}/> : !selected && stillTemplate ? <figure className={s.actionPreview} aria-label={`${stillTemplate.label}画面模板`}><img src={stillTemplate.demoPosterUrl} alt="" /><figcaption><strong>画面模板 · {stillTemplate.label}</strong><span>把参考图里的人放进这张模板。</span></figcaption></figure> : <div className={s.preview}>{selected?.status === "ready" && selected.assetUrl ? selected.kind === "image" ? <img src={selected.assetUrl} alt={selected.prompt} /> : <video key={selected.id} controls preload="metadata" src={selected.assetUrl} /> : <div className={s.empty}><Icon name={selected?.kind ?? kind} size={42} /><h3>{selected ? names[selected.status] : "生成结果会显示在这里"}</h3><p>{selected?.error ?? (selected && running(selected) ? selected.status === "unknown" ? "提交结果尚未确认。请刷新任务核对；系统不会重复提交，预留最多保留 30 分钟。" : "任务已提交，页面每 30 秒核对进度。" : needsReference ? "上传参考图，填写模板参数，查看报价后再生成。" : "填写模板参数，查看报价后再生成。")}</p></div>}</div>}
      {!selected && gpuPreview && gpuResultKind === "image" && <a className={s.secondary} href={gpuPreview} download={`${template?.id ?? "krea2"}.png`}><Icon name="download" size={15} />下载这张图</a>}
      {!selected && gpuPreview && gpuResultKind === "video" && <a className={s.secondary} href={gpuPreview} download={`${template?.id ?? "h3"}.mp4`}><Icon name="download" size={15} />下载这条视频</a>}
      {selected && <div className={s.resultInfo}>{jobTemplateLabel(selected) && <span className={s.referenceTag}><Icon name="grid" size={14}/>模板 · {jobTemplateLabel(selected)}</span>}{selected.referenceImage && <span className={s.referenceTag}><Icon name="image" size={14}/>使用参考图 · {selected.referenceImage.name}</span>}<p>{selected.prompt}</p><div><span>{date(selected.createdAt)} · {selected.aspectRatio}{selected.duration ? ` · ${selected.duration} 秒` : ""}</span><strong>{selected.status === "ready" ? `已扣 ${points(selected.chargedCredits)} Credit` : running(selected) ? `预留 ${points(selected.reservedCredits)} Credit` : "本次未扣费"}</strong></div>{selected.status === "ready" && <p className={s.fine}>{selected.costBasis === "frozen_sku" ? "供应商未返回独立费用，按任务创建时冻结的官方单价结算。" : "根据供应商返回的费用结算。"}{selected.exceedsReservation ? "本次费用超过预留，扣费已按预留上限封顶。" : ""}</p>}{selected.assetUrl && <a className={s.secondary} href={selected.assetUrl} download={`${selected.id}.${selected.mimeType === "image/jpeg" ? "jpg" : selected.mimeType === "image/webp" ? "webp" : selected.kind === "image" ? "png" : "mp4"}`}><Icon name="download" size={15} />下载结果</a>}{!running(selected) && (confirmDelete === selected.id ? <div className={s.deleteConfirm}><span>删除结果文件和历史？已消费 Credit 不会退还。</span><button disabled={busy} onClick={() => void remove(selected.id)}>确认删除</button><button disabled={busy} onClick={() => setConfirmDelete("")}>取消</button></div> : <button className={s.textButton} disabled={busy} onClick={() => setConfirmDelete(selected.id)}>删除此任务</button>)}</div>}
      <div className={s.sectionTitle}><h2>我的生成历史</h2><button className={s.secondary} disabled={busy} onClick={() => { setError(""); void refresh(true); }}><Icon name="refresh" size={14} />刷新任务</button></div>
      {jobs.length ? <div className={s.history}>{jobs.map(job => <button key={job.id} aria-pressed={job.id === selectedId} onClick={() => { setSelectedId(job.id); setConfirmDelete(""); }}><Icon name={job.kind} size={20} /><span><strong>{job.prompt}</strong><small>{date(job.createdAt)}{jobTemplateLabel(job) ? ` · ${jobTemplateLabel(job)}` : ""} · {names[job.status]}</small></span><b>{job.status === "ready" ? `${points(job.chargedCredits)} Credit` : names[job.status]}</b></button>)}</div> : <p className={s.fine}>{loading ? "正在读取…" : "还没有生成任务。完成的图片和视频会保存在这里。"}</p>}
    </section></div>}
    <dialog ref={replacementDialog} className={s.replacementDialog} aria-labelledby="generation-template-replace-title" onCancel={event => { event.preventDefault(); setPendingTemplate(null); }}>
      {pendingTemplate && <><h2 id="generation-template-replace-title">改用“{pendingTemplate.label}”？</h2><p>{template ? `当前“${template.label}”的参数已保留，之后可以切回继续编辑。` : "当前原描述会保留到你确认替换为止。"}参考图保持不变，生成前需重新查看报价。</p><div><button type="button" className={s.secondary} onClick={() => setPendingTemplate(null)}>取消，保留当前内容</button><button type="button" className={s.primary} disabled={busy || uploadingReference || checkingReference} onClick={() => applyTemplate(pendingTemplate)}>确认使用模板</button></div></>}
    </dialog>
  </main>;
}
